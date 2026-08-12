import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import * as batchReceipt from "../src/talk_to_figma_mcp/batch-receipt.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A frame with two children in tests/fixtures/small-document.json.
const FRAME = "10:1";
const MISSING = "9:9";

function operation(id, op, nodeId, params) {
  return params === undefined ? { id, op, nodeId } : { id, op, nodeId, params };
}

// The mirror's values are constructed inside a `vm` realm, so their prototypes are not
// this realm's Array/Object and deepStrictEqual would reject identical data. Comparing
// the serialized form is the actual question being asked: do the two copies hold the
// same values?
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function autoLayoutHarness() {
  const harness = await loadPluginHarness();
  await harness.command("set_layout_mode", {
    nodeId: FRAME,
    layoutMode: "VERTICAL",
    layoutWrap: "NO_WRAP",
  });
  return harness;
}

test("prevalidation resolves every target and reports the scope before writing", async () => {
  const harness = await loadPluginHarness();
  const before = harness.getNode(FRAME).name;

  const receipt = await harness.command("apply_batch", {
    operations: [
      operation("op-1", "rename_node", FRAME, { name: "Renamed" }),
      operation("op-2", "delete_node", MISSING),
    ],
    onError: "stop",
  });

  // D1: the prevalidation block is returned either way — that is what satisfies
  // "destructive batch operations report their resolved scope before mutation."
  assert.equal(receipt.outcome, "refused_prevalidation");
  assert.deepEqual(receipt.prevalidation.resolved, [
    { id: "op-1", nodeId: FRAME, name: "Dashboard", type: "FRAME", childCount: 2 },
  ]);
  assert.deepEqual(receipt.prevalidation.unresolved, [
    { id: "op-2", nodeId: MISSING, reason: "node_not_found" },
  ]);

  // 2.4: one bad target leaves ZERO observable mutations.
  assert.equal(harness.getNode(FRAME).name, before, "the batch must have written nothing");
  assert.ok(receipt.operations.every((entry) => entry.status === "skipped"));
  assert.equal(receipt.complete, true, "a refusal is a final, total decision");
});

test("the refusal is atomic even when the good operation comes last", async () => {
  // Ordering matters: a naive executor that validates lazily would have applied op-1
  // before ever reaching the unresolvable op-2. The resolve pass is total and runs first.
  const harness = await loadPluginHarness();
  const before = harness.getNode(FRAME).width;

  const receipt = await harness.command("apply_batch", {
    operations: [
      operation("op-1", "resize_node", FRAME, { width: 999, height: 999 }),
      operation("op-2", "rename_node", MISSING, { name: "nope" }),
      operation("op-3", "resize_node", FRAME, { width: 111, height: 111 }),
    ],
    onError: "stop",
  });

  assert.equal(receipt.outcome, "refused_prevalidation");
  assert.equal(harness.getNode(FRAME).width, before);
});

test("onError continue skips the unresolvable target and applies the rest", async () => {
  const harness = await loadPluginHarness();

  const receipt = await harness.command("apply_batch", {
    operations: [
      operation("op-1", "rename_node", FRAME, { name: "Applied" }),
      operation("op-2", "rename_node", MISSING, { name: "nope" }),
    ],
    onError: "continue",
  });

  assert.equal(receipt.outcome, "partial");
  assert.equal(receipt.succeeded, 1);
  assert.equal(receipt.skipped, 1);
  assert.equal(receipt.failed, 0);
  assert.equal(receipt.total, 2);
  assert.equal(harness.getNode(FRAME).name, "Applied");

  const [applied, skipped] = receipt.operations;
  assert.equal(applied.status, "succeeded");
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.error.code, "node_not_found");

  // Every operation was decided, so the run is complete even though one was skipped.
  assert.equal(receipt.complete, true);
});

test("prevalidateOnly is a real dry run: a full report, and nothing written", async () => {
  const harness = await loadPluginHarness();
  const before = harness.getNode(FRAME).name;

  const receipt = await harness.command("apply_batch", {
    operations: [
      operation("op-1", "rename_node", FRAME, { name: "NotApplied" }),
      operation("op-2", "delete_node", FRAME),
    ],
    prevalidateOnly: true,
  });

  assert.equal(receipt.outcome, "prevalidated");
  assert.equal(receipt.prevalidateOnly, true);
  assert.equal(receipt.skipped, 2);
  assert.equal(harness.getNode(FRAME).name, before, "a dry run must not write");
  assert.ok(harness.getNode(FRAME), "a dry run must not delete");

  // D7: the destructive operation's blast radius is visible before committing to it.
  const deleteTarget = receipt.prevalidation.resolved.find((entry) => entry.id === "op-2");
  assert.equal(deleteTarget.type, "FRAME");
  assert.equal(deleteTarget.childCount, 2);
});

test("a dry run that would be refused reports the refusal, not a clean prevalidation", async () => {
  const harness = await loadPluginHarness();
  const receipt = await harness.command("apply_batch", {
    operations: [operation("op-1", "delete_node", MISSING)],
    onError: "stop",
    prevalidateOnly: true,
  });
  assert.equal(receipt.outcome, "refused_prevalidation");
});

test("every operation failing reports all_failed, never success", async () => {
  // Finding 1 end to end: the shipped batch tools return `success: successCount > 0`, so
  // this exact shape reports true today in all three of them.
  const harness = await loadPluginHarness();

  const receipt = await harness.command("apply_batch", {
    operations: [
      // A TEXT-only operation aimed at a FRAME: resolves, then fails on execution.
      operation("op-1", "set_text_content", FRAME, { text: "nope" }),
      operation("op-2", "set_text_content", FRAME, { text: "also nope" }),
    ],
    onError: "continue",
  });

  assert.equal(receipt.outcome, "all_failed");
  assert.equal(receipt.succeeded, 0);
  assert.equal(receipt.failed, 2);
  assert.ok(receipt.operations.every((entry) => entry.error.code === "operation_failed"));
});

test("under stop, a failure halts the run and the remainder is never attempted", async () => {
  const harness = await loadPluginHarness();

  const receipt = await harness.command("apply_batch", {
    operations: [
      operation("op-1", "rename_node", FRAME, { name: "First" }),
      operation("op-2", "set_text_content", FRAME, { text: "fails on a FRAME" }),
      operation("op-3", "rename_node", FRAME, { name: "NeverReached" }),
    ],
    onError: "stop",
  });

  assert.equal(receipt.outcome, "partial");
  assert.equal(receipt.succeeded, 1);
  assert.equal(receipt.failed, 1);
  assert.equal(receipt.skipped, 1);
  assert.equal(receipt.operations[2].error.code, "stopped_after_failure");
  assert.equal(harness.getNode(FRAME).name, "First", "the halted operation must not run");
  assert.equal(receipt.complete, false, "a cut-short run is not complete");
});

test("a first-operation failure under stop is all_failed, not partial", async () => {
  const harness = await loadPluginHarness();
  const receipt = await harness.command("apply_batch", {
    operations: [
      operation("op-1", "set_text_content", FRAME, { text: "fails" }),
      operation("op-2", "rename_node", FRAME, { name: "NeverReached" }),
    ],
    onError: "stop",
  });

  assert.equal(receipt.outcome, "all_failed");
  assert.equal(receipt.succeeded, 0);
});

test("a failed non-atomic operation declares that the document may have changed", async () => {
  // ⛔ The contract assumed per-operation atomicity and it is false. This is the receipt
  // half of the finding: the caller is told to re-read rather than assume a no-op.
  const harness = await autoLayoutHarness();

  const receipt = await harness.command("apply_batch", {
    operations: [
      operation("op-1", "set_item_spacing", FRAME, {
        itemSpacing: 20,
        counterAxisSpacing: 10,
      }),
    ],
    onError: "continue",
  });

  const entry = receipt.operations[0];
  assert.equal(entry.status, "failed");
  assert.equal(entry.partialApplicationPossible, true);
  assert.match(entry.partialApplicationReason, /proven/);
  assert.equal(
    harness.getNode(FRAME).itemSpacing,
    20,
    "the write really did land under a failed receipt",
  );
});

test("a failed atomic operation says the document was not changed", async () => {
  const harness = await loadPluginHarness();
  const receipt = await harness.command("apply_batch", {
    operations: [operation("op-1", "set_text_content", FRAME, { text: "fails" })],
    onError: "continue",
  });

  assert.equal(receipt.operations[0].status, "failed");
  assert.equal(receipt.operations[0].partialApplicationPossible, false);
  assert.equal(receipt.operations[0].partialApplicationReason, undefined);
});

test("budget exhaustion skips the remainder and reports complete: false", async () => {
  const harness = await loadPluginHarness();
  const original = harness.getNode(FRAME).name;

  // The fixture clock only advances when something advances it, so the budget is driven
  // deterministically rather than by wall time: the first operation's own execution
  // pushes the clock past the budget.
  const node = harness.getNode(FRAME);
  let renames = 0;
  Object.defineProperty(node, "name", {
    get: () => original,
    set: () => {
      renames += 1;
      harness.advanceClock(5000);
    },
    configurable: true,
  });

  const receipt = await harness.command("apply_batch", {
    operations: [
      operation("op-1", "rename_node", FRAME, { name: "one" }),
      operation("op-2", "rename_node", FRAME, { name: "two" }),
      operation("op-3", "rename_node", FRAME, { name: "three" }),
    ],
    onError: "continue",
    timeBudgetMs: 1000,
  });

  assert.equal(renames, 1, "only the first operation should have been attempted");
  assert.equal(receipt.succeeded, 1);
  assert.equal(receipt.skipped, 2);
  assert.equal(receipt.complete, false);
  assert.equal(receipt.timing.budgetExhausted, true);
  assert.ok(
    receipt.operations
      .slice(1)
      .every((entry) => entry.error.code === "budget_exhausted"),
  );
});

test("results are truncated to maxResultBytes while reporting their true size", async () => {
  const harness = await loadPluginHarness();
  const receipt = await harness.command("apply_batch", {
    operations: [operation("op-1", "rename_node", FRAME, { name: "x".repeat(400) })],
    maxResultBytes: 40,
  });

  const entry = receipt.operations[0];
  assert.equal(entry.status, "succeeded");
  assert.equal(entry.resultTruncated, true);
  assert.equal(typeof entry.result, "string", "half a JSON object is not parseable");
  assert.equal(batchReceipt.utf8ByteLength(entry.result), 40);
  assert.ok(entry.resultBytes > 400, "the true size is still reported");
});

test("the envelope's nodeId wins over a nodeId hidden inside params", async () => {
  // D1: nodeId is lifted onto the envelope because it is the field prevalidation
  // resolves. If params could override it, the executed target would not be the
  // reported one and the whole prevalidation guarantee would be decorative.
  const harness = await loadPluginHarness();
  const receipt = await harness.command("apply_batch", {
    operations: [
      { id: "op-1", op: "rename_node", nodeId: FRAME, params: { nodeId: MISSING, name: "Wins" } },
    ],
  });

  assert.equal(receipt.outcome, "all_succeeded");
  assert.equal(harness.getNode(FRAME).name, "Wins");
});

test("envelope refusals throw, because they cannot be expressed as a receipt", async () => {
  const harness = await loadPluginHarness();

  // A duplicate id makes the receipt's id-correlation undefined (D8).
  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: [
          operation("dup", "rename_node", FRAME, { name: "a" }),
          operation("dup", "rename_node", FRAME, { name: "b" }),
        ],
      }),
    /duplicate_operation_id/,
  );

  // An excluded op has no handler and therefore no receipt entry shape.
  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: [operation("op-1", "create_frame", FRAME)],
      }),
    /operation_not_allowed.*mutate-only/s,
  );
  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: [operation("op-1", "export_node_as_image", FRAME)],
      }),
    /operation_not_allowed.*binary payloads/s,
  );

  assert.equal(harness.getNode(FRAME).name, "Dashboard", "a refused envelope writes nothing");
});

test("the envelope bounds are enforced in the plugin, not only by the schema", async () => {
  const harness = await loadPluginHarness();

  await assert.rejects(
    () => harness.command("apply_batch", { operations: [] }),
    /non-empty array/,
  );
  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: Array.from({ length: 201 }, (_, index) =>
          operation(`op-${index}`, "rename_node", FRAME, { name: "x" }),
        ),
      }),
    /201 entries, above the 200 per-batch ceiling/,
  );
  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: [operation("op-1", "rename_node", FRAME, { name: "x" })],
        timeBudgetMs: 999999,
      }),
    /timeBudgetMs must be between/,
  );
  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: [{ id: "", op: "rename_node", nodeId: FRAME }],
      }),
    /non-empty caller-supplied id/,
  );
  await assert.rejects(
    () => harness.command("apply_batch", { operations: [{ id: "op-1", op: "rename_node" }] }),
    /requires a nodeId/,
  );
});

test("delete_node inside a batch really deletes, and reports the subtree it takes", async () => {
  const harness = await loadPluginHarness();
  const children = harness.getNode(FRAME).children.map((child) => child.id);
  assert.equal(children.length, 2);

  const receipt = await harness.command("apply_batch", {
    operations: [operation("op-1", "delete_node", FRAME)],
  });

  assert.equal(receipt.outcome, "all_succeeded");
  assert.equal(receipt.prevalidation.resolved[0].childCount, 2);
  assert.equal(harness.getNode(FRAME), null);
  for (const child of children) {
    assert.equal(harness.getNode(child), null, "the subtree went with the frame");
  }
});

test("the plugin's mirrored vocabulary matches the module exactly", async () => {
  // ⛔ code.js cannot `import`, so the vocabulary exists twice. Finding 2 is what three
  // independent dialects of one concept cost; a convention would not have stopped it.
  const harness = await loadPluginHarness();
  const mirror = harness.globals("batchVocabulary")();

  for (const name of [
    "BATCH_OUTCOMES",
    "OPERATION_STATUSES",
    "BATCH_ERROR_CODES",
    "V1_BATCH_OPERATIONS",
    "EXCLUDED_BATCH_OPERATIONS",
    "NON_ATOMIC_BATCH_OPERATIONS",
  ]) {
    assert.deepEqual(
      plain(mirror[name]),
      plain(batchReceipt[name]),
      `${name} drifted from the module`,
    );
  }

  // Behaviour, not just data: the same inputs must classify the same way in both copies.
  const cases = [
    { total: 3, succeeded: 3, failed: 0, skipped: 0 },
    { total: 3, succeeded: 0, failed: 2, skipped: 1 },
    { total: 3, succeeded: 1, failed: 1, skipped: 1 },
    { total: 3, succeeded: 0, failed: 0, skipped: 3, prevalidateOnly: true },
    { total: 3, succeeded: 0, failed: 0, skipped: 3, refusedPrevalidation: true },
  ];
  for (const input of cases) {
    assert.equal(
      mirror.classifyOutcome(input),
      batchReceipt.classifyOutcome(input),
      `classifyOutcome drifted for ${JSON.stringify(input)}`,
    );
  }

  const receipts = [
    { id: "a", status: "succeeded" },
    { id: "b", status: "failed" },
    { id: "c", status: "skipped" },
  ];
  assert.deepEqual(
    plain(mirror.summarizeOperations(receipts)),
    plain(batchReceipt.summarizeOperations(receipts)),
  );
  assert.deepEqual(
    plain(mirror.duplicateOperationIds([{ id: "a" }, { id: "a" }, { id: "b" }])),
    plain(batchReceipt.duplicateOperationIds([{ id: "a" }, { id: "a" }, { id: "b" }])),
  );
  assert.deepEqual(
    plain(mirror.disallowedOperations([{ id: "1", op: "create_page" }, { id: "2", op: "nope" }])),
    plain(batchReceipt.disallowedOperations([{ id: "1", op: "create_page" }, { id: "2", op: "nope" }])),
  );
  assert.deepEqual(
    plain(mirror.truncateResult({ note: "y".repeat(300) }, 50)),
    plain(batchReceipt.truncateResult({ note: "y".repeat(300) }, 50)),
  );
  for (const op of batchReceipt.V1_BATCH_OPERATIONS) {
    assert.equal(
      mirror.partialApplicationPossible(op),
      batchReceipt.partialApplicationPossible(op),
    );
  }

  // The plugin keeps its own R2.3 utf8ByteLength rather than mirroring a third copy, so
  // assert the two independent implementations agree — including on surrogate pairs.
  for (const value of ["", "abc", "é→😀", "😀".repeat(5), "aé😀z"]) {
    assert.equal(mirror.utf8ByteLength(value), batchReceipt.utf8ByteLength(value), value);
    assert.equal(mirror.utf8ByteLength(value), Buffer.byteLength(value, "utf8"), value);
  }
});

test("every allowlisted operation is bound to a handler, and only those are", async () => {
  const harness = await loadPluginHarness();
  const handlers = harness.globals("batchOperationHandlers")();

  assert.deepEqual(
    Object.keys(handlers).sort(),
    [...batchReceipt.V1_BATCH_OPERATIONS].sort(),
    "the handler map and the allowlist must be the same set",
  );
  for (const [name, handler] of Object.entries(handlers)) {
    assert.equal(typeof handler, "function", `${name} has no handler`);
  }
});

test("the registered schema's inline enum equals the shared allowlist", async () => {
  // ⚠️ The allowlist has to be spelled inline in server.ts: the contract generator
  // re-evaluates each schema's SOURCE TEXT through Function("z", …), where `z` is the
  // only binding in scope, so an imported constant is a ReferenceError at generation
  // time. This test is what keeps the duplicated literal honest.
  const source = await readFile(
    path.join(root, "src/talk_to_figma_mcp/server.ts"),
    "utf8",
  );
  const sourceFile = ts.createSourceFile(
    "server.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let schemaNode = null;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "tool" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "apply_batch"
    ) {
      schemaNode = node.arguments[2];
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(schemaNode, "apply_batch must be registered in server.ts");

  const schemaText = schemaNode.getText(sourceFile);
  const enumMatch = /z\s*\.enum\(\[([\s\S]*?)\]\)/.exec(schemaText);
  assert.ok(enumMatch, "the op allowlist must be an inline z.enum");
  const inlineOps = [...enumMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(
    inlineOps,
    [...batchReceipt.V1_BATCH_OPERATIONS],
    "the inline enum drifted from V1_BATCH_OPERATIONS",
  );

  // Same trap, same fix: the numeric ceilings are inline literals too, and they have to
  // match the ones the plugin actually enforces at runtime.
  assert.match(schemaText, /\.max\(200\)/, "the operation ceiling must be inline");
  assert.match(schemaText, /\.max\(240000\)/, "the budget ceiling must be inline");
  const plugin = await readFile(
    path.join(root, "src/cursor_mcp_plugin/code.js"),
    "utf8",
  );
  assert.match(plugin, /const BATCH_MAX_OPERATIONS = 200;/);
  assert.match(plugin, /const BATCH_MAX_TIME_BUDGET_MS = 240000;/);
});

test("apply_batch declares heavy_batch, and the batch budget outlasts it nowhere", async () => {
  const snapshot = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  );
  const tool = snapshot.tools.find((entry) => entry.name === "apply_batch");
  assert.ok(tool, "apply_batch must be in the public contract");
  assert.equal(tool.timeoutClass, "heavy_batch");
  assert.equal(tool.direction, "write");
  assert.equal(tool.pluginCommand, "apply_batch");

  // The contract must not claim progress the plugin does not emit — Finding 4 is exactly
  // that drift. 3.1 moved this from "none" to "chunked" in the SAME change that added the
  // chunking, and tests/progress-declaration.test.mjs checks it against code.js.
  assert.equal(tool.progress.pluginUpdates, "chunked");

  // The server arms the transport past the plugin's own ceiling, so the batch budget
  // always fires first and the caller gets a receipt instead of a transport error.
  const server = await readFile(
    path.join(root, "src/talk_to_figma_mcp/server.ts"),
    "utf8",
  );
  assert.match(server, /const BATCH_MAX_TIME_BUDGET_MS = 240000;/);
  assert.match(server, /const BATCH_TIMEOUT_SLACK_MS = 30000;/);
});

// ---------------------------------------------------------------------------
// R2.4 3.1 / 3.2 — chunked progress and the tunable yield
// ---------------------------------------------------------------------------

function progressUpdates(harness) {
  return harness.messages.filter(
    (message) =>
      message.type === "command_progress" && message.commandType === "apply_batch",
  );
}

function renames(count) {
  return Array.from({ length: count }, (_, index) =>
    operation(`op-${index}`, "rename_node", FRAME, { name: `name-${index}` }),
  );
}

test("the executor chunks by 5 and reports progress in the shipped shape", async () => {
  const harness = await loadPluginHarness();
  const receipt = await harness.command("apply_batch", { operations: renames(12) });

  assert.equal(receipt.outcome, "all_succeeded");
  const updates = progressUpdates(harness);
  assert.equal(updates[0].status, "started");
  assert.equal(updates.at(-1).status, "completed");

  // 12 operations at 5 per chunk is 3 chunks: started, two in_progress, one completed.
  const executorUpdates = updates.slice(1);
  assert.equal(executorUpdates.length, 3);
  assert.deepEqual(
    executorUpdates.map((update) => update.status),
    ["in_progress", "in_progress", "completed"],
  );
  assert.deepEqual(
    executorUpdates.map((update) => update.processedItems),
    [5, 10, 12],
    "processedItems must count receipts, not chunks",
  );
  for (const update of executorUpdates) {
    assert.equal(update.totalItems, 12);
    assert.equal(update.chunkSize, 5);
    assert.equal(update.totalChunks, 3);
  }
  assert.equal(executorUpdates.at(-1).progress, 100);
});

test("a dry run closes its progress stream instead of leaving it open", async () => {
  const harness = await loadPluginHarness();
  await harness.command("apply_batch", {
    operations: renames(3),
    prevalidateOnly: true,
  });

  const updates = progressUpdates(harness);
  assert.deepEqual(
    updates.map((update) => update.status),
    ["started", "completed"],
    "a dry run is a completed unit of work, not an abandoned one",
  );
  assert.match(updates.at(-1).message, /nothing written/);
});

test("the default pause is 0, so a batch never awaits a timer", async () => {
  // Load WITHOUT runTimers: the harness leaves a non-zero delay pending forever, so if
  // the executor awaited one by default this test would hang rather than fail. That is
  // the assertion — the default really is a no-op yield.
  const harness = await loadPluginHarness();
  const receipt = await harness.command("apply_batch", { operations: renames(12) });
  assert.equal(receipt.outcome, "all_succeeded");
  assert.equal(receipt.timing.elapsedMs, 0);
});

test("chunkPauseMs yields between chunks, never before the first", async () => {
  const harness = await loadPluginHarness({ runTimers: true });
  const receipt = await harness.command("apply_batch", {
    operations: renames(12),
    chunkPauseMs: 100,
  });

  assert.equal(receipt.outcome, "all_succeeded");
  // 3 chunks means 2 gaps, never 3 — a pause before the first chunk is pure latency.
  assert.equal(receipt.timing.elapsedMs, 200);
});

test("the pause is clamped to the budget, so it cannot overshoot the ceiling", async () => {
  // ⛔ Skipping the pause only once the budget is spent is not enough: a 5 s pause on a
  // 6 s budget would still land at 10 s and make timeBudgetMs a lie.
  const harness = await loadPluginHarness({ runTimers: true });
  const receipt = await harness.command("apply_batch", {
    operations: renames(12),
    chunkPauseMs: 5000,
    timeBudgetMs: 6000,
    onError: "continue",
  });

  assert.ok(
    receipt.timing.elapsedMs <= 6000,
    `the run took ${receipt.timing.elapsedMs} ms against a 6000 ms budget`,
  );
  assert.equal(receipt.timing.budgetExhausted, true);
  assert.equal(receipt.complete, false);
  assert.equal(receipt.succeeded, 10, "two chunks land before the budget is spent");
  assert.ok(
    receipt.operations.slice(10).every((entry) => entry.error.code === "budget_exhausted"),
  );
});

test("chunkPauseMs is bounded in the plugin, not only by the schema", async () => {
  const harness = await loadPluginHarness();
  for (const chunkPauseMs of [-1, 5001, "fast"]) {
    await assert.rejects(
      () => harness.command("apply_batch", { operations: renames(1), chunkPauseMs }),
      /chunkPauseMs must be between 0 and 5000 ms/,
      `chunkPauseMs ${JSON.stringify(chunkPauseMs)} must be refused`,
    );
  }
});

test("the registered chunkPauseMs literals equal the runtime constants", async () => {
  const server = await readFile(
    path.join(root, "src/talk_to_figma_mcp/server.ts"),
    "utf8",
  );
  assert.match(server, /const BATCH_DEFAULT_CHUNK_PAUSE_MS = 0;/);
  assert.match(server, /const BATCH_MAX_CHUNK_PAUSE_MS = 5000;/);
  assert.match(server, /const BATCH_CHUNK_SIZE = 5;/);
  // Same inline-literal trap as the op enum: the schema's source text is re-evaluated
  // with `z` as the only binding, so the ceiling cannot reference the constant above it.
  assert.match(server, /chunkPauseMs: z[\s\S]*?\.max\(5000\)/);

  const plugin = await readFile(
    path.join(root, "src/cursor_mcp_plugin/code.js"),
    "utf8",
  );
  assert.match(plugin, /const BATCH_CHUNK_SIZE = 5;/);
  assert.match(plugin, /const BATCH_DEFAULT_CHUNK_PAUSE_MS = 0;/);
  assert.match(plugin, /const BATCH_MAX_CHUNK_PAUSE_MS = 5000;/);
});
