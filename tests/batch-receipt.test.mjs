import assert from "node:assert/strict";
import test from "node:test";

import {
  BATCH_ERROR_CODES,
  BATCH_ERROR_CODE_DELIVERY,
  BATCH_OUTCOMES,
  EXCLUDED_BATCH_OPERATIONS,
  NON_ATOMIC_BATCH_OPERATIONS,
  OPERATION_STATUSES,
  V1_BATCH_OPERATIONS,
  classifyOutcome,
  disallowedOperations,
  duplicateOperationIds,
  partialApplicationPossible,
  summarizeOperations,
  truncateResult,
  utf8ByteLength,
} from "../src/talk_to_figma_mcp/batch-receipt.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const op = (status) => ({ id: `op-${status}`, status });

test("the aggregate cannot report success when nothing succeeded", () => {
  // Finding 1 of the R2.4 audit: all three shipped batch tools return
  // `success: successCount > 0`, so a batch of 100 where 99 fail reports true. The
  // outcome enum has to make that shape unrepresentable.
  const operations = [
    ...Array.from({ length: 99 }, (_, index) => ({ id: `op-${index}`, status: "failed" })),
    { id: "op-99", status: "succeeded" },
  ];

  const summary = summarizeOperations(operations);
  assert.equal(summary.outcome, "partial");
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 99);
  assert.equal(summary.total, 100);

  const allFailed = summarizeOperations(
    operations.map((entry) => ({ ...entry, status: "failed" })),
  );
  assert.equal(allFailed.outcome, "all_failed");
});

test("no combination of counts classifies as succeeded without a success", () => {
  for (let failed = 0; failed <= 4; failed += 1) {
    for (let skipped = 0; skipped <= 4; skipped += 1) {
      const total = failed + skipped;
      if (total === 0) continue;
      const outcome = classifyOutcome({ total, succeeded: 0, failed, skipped });
      assert.equal(
        outcome,
        "all_failed",
        `succeeded=0 failed=${failed} skipped=${skipped} must be all_failed`,
      );
    }
  }
});

test("classifyOutcome covers the whole enum and refuses incoherent counts", () => {
  assert.equal(classifyOutcome({ total: 2, succeeded: 2, failed: 0, skipped: 0 }), "all_succeeded");
  assert.equal(classifyOutcome({ total: 2, succeeded: 1, failed: 0, skipped: 1 }), "partial");
  assert.equal(classifyOutcome({ total: 2, succeeded: 0, failed: 2, skipped: 0 }), "all_failed");
  assert.equal(
    classifyOutcome({
      total: 2,
      succeeded: 0,
      failed: 0,
      skipped: 2,
      refusedPrevalidation: true,
    }),
    "refused_prevalidation",
  );

  // Coherence is checked before either override, so even a refusal has to be backed by
  // counts that sum. In the handler a refusal is always all-skipped, so it always does —
  // and an aggregate that cannot be built from incoherent counts is one fewer way for a
  // receipt to disagree with the operations it summarizes.
  assert.throws(
    () => classifyOutcome({ total: 3, succeeded: 1, failed: 1, skipped: 0 }),
    /do not sum to total/,
  );
  assert.throws(
    () => classifyOutcome({ total: 0, succeeded: 0, failed: 0, skipped: 0 }),
    /at least one operation/,
  );
  assert.throws(
    () =>
      classifyOutcome({
        total: 3,
        succeeded: 0,
        failed: 0,
        skipped: 1,
        refusedPrevalidation: true,
      }),
    /do not sum to total/,
  );
});

test("a clean dry run is `prevalidated`, never `all_failed`", () => {
  // A prevalidateOnly batch applies nothing by design, so every operation is skipped and
  // succeeded === 0. Without its own outcome that lands on `all_failed` — a fresh
  // instance of Finding 1, an aggregate misreporting what happened.
  const dryRun = summarizeOperations(
    [op("skipped"), op("skipped"), { id: "op-3", status: "skipped" }],
    { prevalidateOnly: true },
  );
  assert.equal(dryRun.outcome, "prevalidated");
  assert.equal(dryRun.skipped, 3);
  assert.equal(dryRun.succeeded, 0);

  // A dry run that would have been refused still reports the refusal: "what would
  // happen" is the only question a dry run is asked, so the refusal wins.
  const refusedDryRun = summarizeOperations([op("skipped")], {
    prevalidateOnly: true,
    refusedPrevalidation: true,
  });
  assert.equal(refusedDryRun.outcome, "refused_prevalidation");
});

test("every classified outcome and status is a declared member of its enum", () => {
  assert.deepEqual(BATCH_OUTCOMES, [
    "all_succeeded",
    "partial",
    "all_failed",
    "prevalidated",
    "refused_prevalidation",
  ]);
  assert.deepEqual(OPERATION_STATUSES, ["succeeded", "failed", "skipped"]);

  const summary = summarizeOperations([op("succeeded"), op("failed"), op("skipped")]);
  assert.ok(BATCH_OUTCOMES.includes(summary.outcome));
  assert.equal(summary.outcome, "partial");

  assert.throws(
    () => summarizeOperations([{ id: "op-1", status: "ok" }]),
    /unknown operation status/,
  );
});

test("duplicate operation ids are detected, because receipts correlate by id", () => {
  // D8: a caller that reorders or filters its own operations must not have to re-derive
  // which receipt belongs to which request. That only holds if ids are unique.
  assert.deepEqual(
    duplicateOperationIds([{ id: "a" }, { id: "b" }, { id: "a" }, { id: "b" }, { id: "c" }]),
    ["a", "b"],
  );
  assert.deepEqual(duplicateOperationIds([{ id: "a" }, { id: "b" }]), []);
  assert.equal(BATCH_ERROR_CODES.DUPLICATE_OPERATION_ID, "duplicate_operation_id");
});

test("the v1 allowlist is exactly the fifteen node-scoped mutations, with no duplicates", () => {
  assert.equal(V1_BATCH_OPERATIONS.length, 15);
  assert.equal(new Set(V1_BATCH_OPERATIONS).size, 15);
  assert.deepEqual([...V1_BATCH_OPERATIONS].sort(), [...V1_BATCH_OPERATIONS]);
  assert.ok(V1_BATCH_OPERATIONS.includes("delete_node"));
  assert.ok(V1_BATCH_OPERATIONS.includes("set_plugin_data"));
});

test("creates are pinned ABSENT from v1 — mutate-only is a decision, not an oversight", () => {
  // The R2.2 precedent: `create_page`'s `onDuplicate` pins `"reuse"` absent with a test
  // so its absence cannot be read as an oversight and quietly added later. Admitting a
  // create would degrade prevalidation from total to partial, because a created node's
  // id does not exist at prevalidation time.
  const creates = V1_BATCH_OPERATIONS.filter((name) => name.startsWith("create_"));
  assert.deepEqual(creates, [], "v1 apply_batch must accept no create operation");

  const refused = disallowedOperations([
    { id: "op-1", op: "create_frame" },
    { id: "op-2", op: "create_page" },
  ]);
  assert.equal(refused.length, 2);
  assert.ok(refused.every((entry) => /mutate-only/.test(entry.reason)));
});

test("the other exclusions are refused with their recorded reason", () => {
  const refused = disallowedOperations([
    { id: "op-1", op: "export_node_as_image" },
    { id: "op-2", op: "join_channel" },
    { id: "op-3", op: "delete_multiple_nodes" },
    { id: "op-4", op: "not_a_command" },
    { id: "op-5", op: "rename_node" },
  ]);

  assert.deepEqual(
    refused.map((entry) => entry.id),
    ["op-1", "op-2", "op-3", "op-4"],
    "an allowlisted op must not be refused",
  );
  assert.match(refused[0].reason, /binary payloads/);
  assert.match(refused[1].reason, /connection plumbing/);
  assert.match(refused[2].reason, /batch of batches/);
  assert.match(refused[3].reason, /not a v1 batch operation/);

  // Nothing may be both allowed and excluded.
  for (const name of Object.keys(EXCLUDED_BATCH_OPERATIONS)) {
    assert.ok(
      !V1_BATCH_OPERATIONS.includes(name),
      `${name} is both allowlisted and excluded`,
    );
  }
});

test("every non-atomic op is allowlisted, and every error code declares its delivery", () => {
  for (const name of Object.keys(NON_ATOMIC_BATCH_OPERATIONS)) {
    assert.ok(
      V1_BATCH_OPERATIONS.includes(name),
      `${name} is flagged non-atomic but is not a v1 operation`,
    );
  }
  // ⛔ R2.6 Phase 1 made these three atomic and REMOVED them from the map. If one comes
  // back, a caller is being told to re-read a node that cannot have changed.
  assert.equal(partialApplicationPossible("set_item_spacing"), false);
  assert.equal(partialApplicationPossible("set_axis_align"), false);
  assert.equal(partialApplicationPossible("set_layout_sizing"), false);
  // The two the reordering does not reach stay declared, and stay proven.
  assert.equal(partialApplicationPossible("move_node"), true);
  assert.equal(partialApplicationPossible("set_stroke_color"), true);
  assert.equal(partialApplicationPossible("rename_node"), false);
  assert.equal(partialApplicationPossible("delete_node"), false);

  // ⭐ Restate the count rather than leave the old one to rot: SIX declared, TWO proven.
  // Pinned as an assertion so the next edit to the map has to face the number.
  const declared = Object.keys(NON_ATOMIC_BATCH_OPERATIONS);
  const proven = declared.filter((op) =>
    NON_ATOMIC_BATCH_OPERATIONS[op].startsWith("proven:"),
  );
  assert.equal(declared.length, 6, "six operations stay declared non-atomic");
  assert.deepEqual(proven.sort(), ["move_node", "set_stroke_color"]);

  // Every code has to say which half of the contract it arrives in, because a consumer
  // writes different handling for a thrown refusal than for a receipt entry.
  assert.deepEqual(
    Object.values(BATCH_ERROR_CODES).sort(),
    Object.keys(BATCH_ERROR_CODE_DELIVERY).sort(),
  );
  for (const delivery of Object.values(BATCH_ERROR_CODE_DELIVERY)) {
    assert.ok(["thrown", "receipt"].includes(delivery));
  }
});

test("the three fixed layout ops validate every field before the first write", async () => {
  // ⛔ Trap #4 of the plan: verify a platform assumption before designing around it. The
  // contract ASSUMED per-operation atomicity; the probe found these three writing field 1,
  // then validating field 2 and throwing. R2.6 Phase 1 reordered all three into
  // validate-all-then-write, and this test is the thing that holds them there.
  //
  // ⭐ The invalid parameter goes LAST and the assertion is that the node is UNCHANGED
  // afterwards. That pairing is the whole point: a throw-only assertion would survive
  // moving the write back above the validation — it would still throw, just after
  // dirtying the document — which is the exact mutation this test exists to kill.
  const cases = [
    {
      op: "set_item_spacing",
      params: { itemSpacing: 20, counterAxisSpacing: 10 },
      throws: /layoutWrap set to WRAP/,
    },
    {
      op: "set_axis_align",
      params: { primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "BASELINE" },
      throws: /BASELINE alignment is only valid/,
    },
    {
      op: "set_layout_sizing",
      params: { layoutSizingHorizontal: "HUG", layoutSizingVertical: "FILL" },
      throws: /FILL sizing is only valid/,
    },
  ];

  // `parent` is dropped at every depth because the fixture's back-references make the
  // tree cyclic; everything these three handlers can write survives the round trip.
  const snapshot = (node) =>
    JSON.stringify(node, (key, value) => (key === "parent" ? undefined : value));

  for (const testCase of cases) {
    const harness = await loadPluginHarness();
    await harness.command("set_layout_mode", {
      nodeId: "10:1",
      layoutMode: "VERTICAL",
      layoutWrap: "NO_WRAP",
    });
    const before = snapshot(harness.getNode("10:1"));

    await assert.rejects(
      () => harness.command(testCase.op, { nodeId: "10:1", ...testCase.params }),
      testCase.throws,
      `${testCase.op} was expected to throw`,
    );
    assert.equal(
      snapshot(harness.getNode("10:1")),
      before,
      `${testCase.op} threw but left the node changed — the reordering regressed`,
    );
    assert.equal(
      partialApplicationPossible(testCase.op),
      false,
      `${testCase.op} is atomic now, so the contract must not declare it non-atomic`,
    );
  }
});

test("sizes are UTF-8 bytes, not UTF-16 units", () => {
  // R2.3 verified this against a real Figma write: "é→😀" is 9 bytes and 4 units.
  assert.equal(utf8ByteLength("é→😀"), 9);
  assert.equal("é→😀".length, 4);
  assert.equal(utf8ByteLength(""), 0);
  assert.equal(utf8ByteLength("abc"), 3);
  assert.equal(
    utf8ByteLength("é→😀"),
    Buffer.byteLength("é→😀", "utf8"),
    "the sandbox-safe implementation must agree with Node's",
  );
});

test("a truncated result reports its true size and stays parseable", () => {
  const big = { note: "x".repeat(500) };
  const truncated = truncateResult(big, 50);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.bytes, utf8ByteLength(JSON.stringify(big)));
  assert.equal(typeof truncated.result, "string", "half a JSON object is not parseable");
  assert.equal(utf8ByteLength(truncated.result), 50);

  const small = truncateResult({ ok: true }, 2000);
  assert.equal(small.truncated, false);
  assert.deepEqual(small.result, { ok: true });
  assert.equal(small.bytes, utf8ByteLength(JSON.stringify({ ok: true })));

  const empty = truncateResult(undefined, 2000);
  assert.deepEqual(empty, { result: null, bytes: 0, truncated: false });
});
