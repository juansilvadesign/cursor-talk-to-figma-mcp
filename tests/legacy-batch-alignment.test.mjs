import assert from "node:assert/strict";
import test from "node:test";

import { BATCH_OUTCOMES } from "../src/talk_to_figma_mcp/batch-receipt.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.4 Phase 4.1 / 4.2 — additive alignment of the three shipped batch tools.
 *
 * Finding 2 of the audit is that one concept had three vocabularies —
 * `replacementsApplied` / `annotationsApplied` / `nodesDeleted`, each with its own
 * `*Failed` and `total*` spelling. A fourth generic implementation that did not share
 * the vocabulary would have made it four, so all four now read from one module.
 *
 * ⛔ The alignment is ADDITIVE. Every legacy field keeps its exact spelling and meaning,
 * including `success: successCount > 0` — Finding 1 — which is documented as legacy
 * rather than corrected, so no consumer breaks. `outcome` is the field that cannot lie.
 */

const FRAME = "10:1";
const TEXT = "10:2";
const FOOTER = "10:5";
const MISSING = "9:9";

function assertUnifiedShape(reply, expected) {
  assert.ok(BATCH_OUTCOMES.includes(reply.outcome), `unknown outcome ${reply.outcome}`);
  assert.equal(reply.outcome, expected.outcome);
  assert.equal(reply.total, expected.total);
  assert.equal(reply.succeeded, expected.succeeded);
  assert.equal(reply.failed, expected.failed);
  assert.equal(
    reply.succeeded + reply.failed + reply.skipped,
    reply.total,
    "the unified counts must sum to the unified total",
  );
}

test("set_multiple_text_contents reports the unified vocabulary additively", async () => {
  const harness = await loadPluginHarness();
  const reply = await harness.command("set_multiple_text_contents", {
    nodeId: FRAME,
    text: [
      { nodeId: TEXT, text: "Replaced" },
      { nodeId: FOOTER, text: "Also replaced" },
    ],
  });

  assertUnifiedShape(reply, { outcome: "all_succeeded", total: 2, succeeded: 2, failed: 0 });

  // ⛔ Every legacy field, untouched.
  assert.equal(reply.success, true);
  assert.equal(reply.nodeId, FRAME);
  assert.equal(reply.replacementsApplied, 2);
  assert.equal(reply.replacementsFailed, 0);
  assert.equal(reply.totalReplacements, 2);
  assert.equal(reply.results.length, 2);
  assert.equal(reply.completedInChunks, 1);
  assert.ok(reply.commandId);
});

test("delete_multiple_nodes reports the unified vocabulary additively", async () => {
  const harness = await loadPluginHarness();
  const reply = await harness.command("delete_multiple_nodes", {
    nodeIds: ["10:3", "10:4"],
  });

  assertUnifiedShape(reply, { outcome: "all_succeeded", total: 2, succeeded: 2, failed: 0 });
  assert.equal(reply.success, true);
  assert.equal(reply.nodesDeleted, 2);
  assert.equal(reply.nodesFailed, 0);
  assert.equal(reply.totalNodes, 2);
  assert.equal(reply.results.length, 2);
  assert.equal(harness.getNode("10:3"), null);
});

test("the legacy success flag still lies, and outcome is what does not", async () => {
  // ⭐ Finding 1, preserved on purpose and now surrounded by the truth. One deletion of
  // two succeeds: `success: true` is what every consumer sees today, and it is the reason
  // the unified enum exists. Correcting `success` would be the breaking change Phase 4
  // was explicitly scoped to avoid — so both live side by side and the caller migrates
  // deliberately.
  const harness = await loadPluginHarness();
  const reply = await harness.command("delete_multiple_nodes", {
    nodeIds: ["10:4", MISSING],
  });

  assert.equal(reply.success, true, "legacy success is successCount > 0 — unchanged");
  assert.equal(reply.nodesDeleted, 1);
  assert.equal(reply.nodesFailed, 1);
  assertUnifiedShape(reply, { outcome: "partial", total: 2, succeeded: 1, failed: 1 });
});

test("nothing succeeding reports all_failed rather than a truthy aggregate", async () => {
  const harness = await loadPluginHarness();
  const reply = await harness.command("delete_multiple_nodes", {
    nodeIds: [MISSING, "9:8"],
  });

  assert.equal(reply.success, false);
  assertUnifiedShape(reply, { outcome: "all_failed", total: 2, succeeded: 0, failed: 2 });
});

test("set_multiple_annotations reports the unified vocabulary and real progress", async () => {
  const harness = await loadPluginHarness();
  const reply = await harness.command("set_multiple_annotations", {
    nodeId: FRAME,
    annotations: [
      { nodeId: TEXT, labelMarkdown: "first" },
      { nodeId: FOOTER, labelMarkdown: "second" },
    ],
  });

  assert.equal(reply.totalAnnotations, 2);
  assert.equal(reply.annotationsApplied + reply.annotationsFailed, 2);
  assertUnifiedShape(reply, {
    outcome: reply.annotationsApplied === 2 ? "all_succeeded" : reply.outcome,
    total: 2,
    succeeded: reply.annotationsApplied,
    failed: reply.annotationsFailed,
  });

  // 4.3: the "chunked" declaration is finally backed by emissions.
  const updates = harness.messages.filter(
    (message) =>
      message.type === "command_progress" &&
      message.commandType === "set_multiple_annotations",
  );
  assert.equal(updates[0].status, "started");
  assert.equal(updates.at(-1).status, "completed");
  assert.equal(updates.at(-1).processedItems, 2);
  assert.equal(updates.at(-1).progress, 100);
});

test("an empty text list is vacuous, not a new failure mode", async () => {
  // set_multiple_text_contents accepts an empty array today. Adding a field must not add
  // a throw to a shipped tool, so the zero case is reported explicitly.
  const harness = await loadPluginHarness();
  const reply = await harness.command("set_multiple_text_contents", {
    nodeId: FRAME,
    text: [],
  });

  assert.equal(reply.total, 0);
  assert.equal(reply.succeeded, 0);
  assert.equal(reply.failed, 0);
  assert.equal(reply.outcome, "all_succeeded");
  assert.equal(reply.totalReplacements, 0);
});
