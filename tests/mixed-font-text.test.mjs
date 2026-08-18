import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.5 Phase 1 — the mixed-font text defect.
 *
 * `TASKS.md` carried it as a known generic write defect for four releases:
 * *"Mixed-font text can fail `set_multiple_text_contents` with
 * `loadFontAsync: Cannot unwrap symbol`."*
 *
 * The cause is one line. `setTextContent` pre-loaded `node.fontName` before delegating
 * to `setCharacters`, and on a node carrying more than one font `node.fontName` is
 * `figma.mixed` — a symbol, which `loadFontAsync` cannot unwrap. The pre-load was
 * **redundant**: `setCharacters` branches on `figma.mixed` and loads a concrete font
 * itself, in every branch.
 *
 * ⛔ Both tools share the one defect site. `set_multiple_text_contents` has no font path
 * of its own — it calls `setTextContent` per replacement — so a fixture that exercised
 * only the single-node tool would have left the tool the defect was *reported* against
 * untested.
 *
 * ⭐ Why no offline test caught this for four releases: the harness's `loadFontAsync` was
 * `async () => undefined`, which accepts a symbol happily, and `getRangeFontName`
 * returned the node's own `fontName`. The harness could not build a mixed-font node, so
 * the suite was not silent about this case — it was structurally unable to reach it.
 */

const MIXED = "20:2";
const MIXED_PARENT = "20:1";
const SINGLE = "10:2";
const SINGLE_PARENT = "10:1";

test("the fixture node is genuinely mixed, and the harness models it as Figma does", async () => {
  // ⛔ Guard first. Every assertion below is meaningful only if this node really carries
  // two fonts; if the fixture ever flattens to a single font, the rest of this file
  // would pass while testing nothing.
  const harness = await loadPluginHarness();
  const node = harness.getNode(MIXED);
  assert.ok(node, "fixture node 20:2 is missing");
  assert.equal(node.type, "TEXT");
  assert.equal(
    typeof node.fontName,
    "symbol",
    "a multi-font node must report figma.mixed, not a font object",
  );

  // A range spanning both runs is mixed; a range inside one run is a concrete font.
  // Modelling only the first half would let the fix pass by reading a symbol where
  // Figma hands back a real font.
  assert.equal(typeof node.getRangeFontName(0, node.characters.length), "symbol");
  assert.deepEqual(node.getRangeFontName(0, 1), { family: "Inter", style: "Bold" });
  assert.deepEqual(node.getRangeFontName(20, 21), { family: "Inter", style: "Regular" });
});

test("set_text_content rewrites a mixed-font node instead of failing to unwrap a symbol", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_text_content", {
    nodeId: MIXED,
    text: "Rewritten",
  });

  assert.equal(result.characters, "Rewritten");
  assert.equal(harness.getNode(MIXED).characters, "Rewritten");

  // ⭐ The font actually loaded must be the first character's real font. Asserting only
  // that the call returned would not distinguish the fix from a blind fallback that
  // silently retyped the node in Inter Regular.
  assert.ok(
    harness.isFontLoaded("Inter", "Bold"),
    `expected the first character's font to be loaded; loaded: ${JSON.stringify(harness.fontLoads)}`,
  );
});

test("set_multiple_text_contents rewrites a mixed-font node — the tool the defect was reported against", async () => {
  const harness = await loadPluginHarness();
  const reply = await harness.command("set_multiple_text_contents", {
    nodeId: MIXED_PARENT,
    text: [{ nodeId: MIXED, text: "Batch rewritten" }],
  });

  assert.equal(reply.outcome, "all_succeeded");
  assert.equal(reply.succeeded, 1);
  assert.equal(reply.failed, 0);
  assert.equal(harness.getNode(MIXED).characters, "Batch rewritten");
});

test("a mixed-font failure does not report success through the batch receipt", async () => {
  // The batch marks an entry successful when nothing threw. Before the fix the throw
  // made this `all_failed`; the risk after the fix is the opposite — a silent skip
  // reported as a success — so pin the pair together rather than the count alone.
  const harness = await loadPluginHarness();
  const reply = await harness.command("set_multiple_text_contents", {
    nodeId: MIXED_PARENT,
    text: [{ nodeId: MIXED, text: "Pinned" }],
  });
  assert.equal(reply.succeeded, 1);
  assert.equal(
    harness.getNode(MIXED).characters,
    "Pinned",
    "a succeeded receipt must sit on top of a document that actually changed",
  );
});

test("single-font text is unaffected by the mixed-font fix", async () => {
  // The deleted pre-load was redundant, not wrong, on a single-font node. This is the
  // regression guard for the ordinary path it also ran on.
  const harness = await loadPluginHarness();
  const result = await harness.command("set_text_content", {
    nodeId: SINGLE,
    text: "Still works",
  });
  assert.equal(result.characters, "Still works");
  assert.deepEqual(result.fontName, { family: "Inter", style: "Regular" });
  assert.ok(harness.isFontLoaded("Inter", "Regular"));

  const reply = await harness.command("set_multiple_text_contents", {
    nodeId: SINGLE_PARENT,
    text: [{ nodeId: SINGLE, text: "Batch still works" }],
  });
  assert.equal(reply.outcome, "all_succeeded");
  assert.equal(harness.getNode(SINGLE).characters, "Batch still works");
});
