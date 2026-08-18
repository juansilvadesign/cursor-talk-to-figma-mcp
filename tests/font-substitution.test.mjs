import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

// ⚠️ `harness.getNode()` hands back the live node from inside the `vm` realm, so an object
// the plugin constructed there has a different `Object.prototype` than this file's.
// `deepStrictEqual` compares prototypes and reports "same structure but not
// reference-equal" — a real failure message for a non-failure. Normalise before
// comparing. Replies from `harness.command()` do not need this: they are JSON-cloned
// into this realm on the way out.
const realm = (value) => JSON.parse(JSON.stringify(value));

/**
 * R2.5 Phase 1.4 — the silent font substitution.
 *
 * When a node's real font will not load, `setCharacters` catches, writes a `console.warn`
 * nobody reads, then loads Inter and assigns it: `node.fontName = fallbackFont`. The
 * node's TYPEFACE changes as a side effect of setting its text, and every field of the
 * old reply was consistent with nothing having happened.
 *
 * ⛔ A console line is not a contract surface. `fontSubstituted` is reported as `false`
 * on the ordinary path too — an absent field cannot be told apart from a field the
 * writer forgot, which is the same reasoning that made `complete` and `present` explicit
 * in the read contract.
 */

const BRANDED = "20:3";
const PLAIN = "10:2";
const UNAVAILABLE = ["Custom Sans::Bold"];

test("a substituted font is reported, with both the requested and the applied face", async () => {
  const harness = await loadPluginHarness({ unavailableFonts: UNAVAILABLE });
  const result = await harness.command("set_text_content", {
    nodeId: BRANDED,
    text: "Rebranded",
  });

  assert.equal(result.characters, "Rebranded");
  assert.equal(result.fontSubstituted, true);
  assert.equal(result.requestedFont, "Custom Sans Bold");
  assert.equal(result.appliedFont, "Inter Regular");

  // ⭐ The reply must describe the document, not the intent: the node really was retyped.
  assert.deepEqual(realm(harness.getNode(BRANDED).fontName), {
    family: "Inter",
    style: "Regular",
  });
});

test("no substitution reports false rather than staying silent", async () => {
  const harness = await loadPluginHarness({ unavailableFonts: UNAVAILABLE });
  const result = await harness.command("set_text_content", {
    nodeId: PLAIN,
    text: "Unchanged face",
  });

  assert.equal(result.fontSubstituted, false);
  assert.equal(result.appliedFont, "Inter Regular");
  assert.deepEqual(realm(harness.getNode(PLAIN).fontName), {
    family: "Inter",
    style: "Regular",
  });
});

test("the substitution flag tracks the font, not the text write", async () => {
  // ⛔ Guard against the flag degenerating into "did anything happen": with the font
  // available, the identical call must report no substitution.
  const harness = await loadPluginHarness({ unavailableFonts: [] });
  const result = await harness.command("set_text_content", {
    nodeId: BRANDED,
    text: "Rebranded",
  });
  assert.equal(result.fontSubstituted, false);
  assert.equal(result.appliedFont, "Custom Sans Bold");
  assert.deepEqual(realm(harness.getNode(BRANDED).fontName), {
    family: "Custom Sans",
    style: "Bold",
  });
});
