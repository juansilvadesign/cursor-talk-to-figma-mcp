import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.5 Phase 1.5 — does a SKIPPED text write report success?
 *
 * `setCharacters` returns `false` when the character assignment throws, and logs
 * *"Failed to set characters. Skipped."* to a console no consumer reads. `setTextContent`
 * discarded that return value, so the reply said the write happened. The batch tool then
 * marked the entry `success: true` because nothing threw — and the unified
 * `succeeded`/`total` counters R2.4 added are computed from those per-entry flags.
 *
 * ⛔ That would be R2.4 audit finding (1) — *"the aggregate lies"* — reappearing one layer
 * BELOW the aggregate that was fixed to stop lying.
 *
 * ⚠️ REACHABILITY IS NOT PROVEN HERE. This suite proves the *reporting* mechanism: given a
 * refused write, what did the tools say? It does NOT prove how often Figma refuses a
 * character write whose font is loaded. The refusal is injected by the harness, so by the
 * standing rule — *when the test supplies the signal, it proves the parser, not the
 * source* — the trigger is exactly the part this file does not establish. Settle that at
 * the live gate; until then the fix is defensible on its own terms, because discarding a
 * callee's documented failure return is a defect regardless of how often it fires.
 */

const TEXT = "10:2";
const FRAME = "10:1";

test("a refused character write is reported as a failure, not as success", async () => {
  const harness = await loadPluginHarness({
    strictFontLoading: true,
    refuseCharacterWrite: [TEXT],
  });

  await assert.rejects(
    () => harness.command("set_text_content", { nodeId: TEXT, text: "Never applied" }),
    /skipped|refused/i,
    "a write that did not happen must not return a success reply",
  );

  assert.notEqual(
    harness.getNode(TEXT).characters,
    "Never applied",
    "guard: the write really was refused, so the assertion above is about a real no-op",
  );
});

test("the batch receipt does not count a refused write as succeeded", async () => {
  const harness = await loadPluginHarness({
    strictFontLoading: true,
    refuseCharacterWrite: [TEXT],
  });

  const reply = await harness.command("set_multiple_text_contents", {
    nodeId: FRAME,
    text: [{ nodeId: TEXT, text: "Never applied" }],
  });

  assert.equal(reply.succeeded, 0, "a refused write must not be counted as succeeded");
  assert.equal(reply.failed, 1);
  assert.equal(reply.outcome, "all_failed");
  assert.notEqual(harness.getNode(TEXT).characters, "Never applied");
});

test("an applied write still reports success under the same strict harness", async () => {
  // ⛔ Without this, both assertions above would pass on a harness that refused
  // everything — the failure mode where a test proves only that nothing works.
  const harness = await loadPluginHarness({ strictFontLoading: true });
  const reply = await harness.command("set_text_content", {
    nodeId: TEXT,
    text: "Applied",
  });
  assert.equal(reply.characters, "Applied");
  assert.equal(harness.getNode(TEXT).characters, "Applied");
});
