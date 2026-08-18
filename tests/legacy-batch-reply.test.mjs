/**
 * R2.4 Phase 4.1 — the reply formatter, pinned directly.
 *
 * ⚠️ This file is the CHEAP half of the proof and cannot stand alone: it loads the
 * formatter and asserts the formatter, which is the exact shape of coverage that let the
 * original defect ship. `tests/wrapper-end-to-end.test.mjs` is what proves the wrappers
 * are wired to this module at all. What this file adds is the cases a live-ish stack
 * makes awkward — a plugin build with no unified fields, an empty batch, the chunk line.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  annotationsReply,
  chunkLine,
  textContentsReply,
  unifiedFields,
} from "../src/talk_to_figma_mcp/legacy-batch-reply.mjs";

const RESULT = Object.freeze({
  outcome: "partial",
  total: 3,
  succeeded: 2,
  failed: 1,
  skipped: 0,
  success: true,
  nodeId: "10:1",
  replacementsApplied: 2,
  replacementsFailed: 1,
  totalReplacements: 3,
  completedInChunks: 1,
  results: [
    { success: true, nodeId: "10:2" },
    { success: true, nodeId: "10:5" },
    { success: false, nodeId: "9:9", error: "Node not found" },
  ],
});

test("the receipt is appended, never substituted for the prose", () => {
  const content = textContentsReply(RESULT, 3);
  assert.equal(content.length, 3);
  assert.match(content[0].text, /^Starting text replacement for 3 nodes\./);
  assert.match(content[1].text, /Text replacement completed:/);
  // ⛔ The receipt is LAST, so `content[0]` and `content[1]` — the only two positions a
  // pre-4.1 consumer knew about — still hold exactly what they held before.
  assert.deepEqual(JSON.parse(content[2].text), RESULT);
});

test("the prose keeps its exact legacy wording and indentation", () => {
  const content = textContentsReply(RESULT, 3);
  assert.equal(
    content[1].text,
    "\n      Text replacement completed:\n" +
      "      - 2 of 3 successfully updated\n" +
      "      - 1 failed\n" +
      "      - Processed in 1 batches\n" +
      "      " +
      "\n\nNodes that failed:\n- 9:9: Node not found",
  );
});

test("a plugin that reports no chunks is described, not invented", () => {
  // ⚠️ Both wrappers used to print `completedInChunks || 1`. set_multiple_annotations
  // has never reported that field — it processes one annotation at a time — so the tool
  // announced "Processed in 1 batches" for work that was never batched.
  assert.equal(chunkLine(undefined), "- Processed one at a time (this tool does not chunk)");
  assert.equal(chunkLine(1), "- Processed in 1 batches");
  assert.equal(chunkLine(4), "- Processed in 4 batches");

  const content = annotationsReply(
    { outcome: "all_succeeded", total: 1, succeeded: 1, failed: 0, skipped: 0, annotationsApplied: 1, annotationsFailed: 0, results: [] },
    1,
  );
  assert.doesNotMatch(content[0].text, /batches of 5/);
  assert.match(content[0].text, /one at a time/);
  assert.doesNotMatch(content[1].text, /Processed in 1 batches/);
});

test("a pre-4.1 plugin degrades to its own reply rather than throwing", () => {
  // The formatter runs inside a tool handler, so a plugin build older than Phase 4.1 has
  // to produce a reply, not an exception. The receipt then carries whatever that build
  // did send, and `unifiedFields` reports the absence honestly instead of defaulting.
  const legacyOnly = { success: true, replacementsApplied: 1, replacementsFailed: 0, results: [] };
  const content = textContentsReply(legacyOnly, 1);
  assert.equal(content.length, 3);
  assert.deepEqual(JSON.parse(content[2].text), legacyOnly);
  assert.equal(unifiedFields(legacyOnly), null);
  assert.deepEqual(unifiedFields(RESULT), {
    outcome: "partial",
    total: 3,
    succeeded: 2,
    failed: 1,
    skipped: 0,
  });
});

test("an empty batch still formats, because the tool already accepted one", () => {
  // Both tools short-circuit an empty array before reaching the formatter today, but the
  // plugin's own vacuous case is `all_succeeded / total 0` rather than a throw. Adding a
  // field must not add a failure mode to a tool that already shipped.
  const empty = { outcome: "all_succeeded", total: 0, succeeded: 0, failed: 0, skipped: 0 };
  const content = annotationsReply(empty, 0);
  assert.equal(JSON.parse(content[2].text).outcome, "all_succeeded");
  assert.match(content[1].text, /- 0 of 0 successfully applied/);
});

test("unifiedFields refuses anything that is not a unified reply", () => {
  assert.equal(unifiedFields(null), null);
  assert.equal(unifiedFields("outcome"), null);
  assert.equal(unifiedFields({ outcome: 7 }), null);
});
