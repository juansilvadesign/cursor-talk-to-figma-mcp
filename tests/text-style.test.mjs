import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.5 Phase 3 — `set_text_style`, the typography write surface.
 *
 * ⛔ The rule this file exists to hold is plan item 3.2: **validate-all-then-write from
 * birth**. `set_text_style` is a twelve-field write, which is the exact shape F4 proves
 * broken in three ops that ship today — `setAxisAlign`, `setLayoutSizing` and
 * `setItemSpacing` each validate their first field, WRITE it, then validate the second
 * and throw, so a `failed` result sits on top of a changed document.
 *
 * ⭐ Asserting that a call THREW does not assert WHEN it threw. A throw-only test cannot
 * tell validate-all-first from validate-as-you-go, so every refusal case below asserts
 * the **side-effect channel is empty** — the node's own properties, byte-for-byte — and
 * puts the invalid parameter LAST, so a validate-as-you-go implementation would have
 * written the eleven valid ones before reaching it.
 *
 * ⛔ CC6, stated: the harness supplies the font inventory and decides which faces refuse
 * to load. These cases therefore prove the ORDER of operations, the refusal policy and
 * the mixed-font semantics. They do not prove what a real Figma refuses or when. That
 * half is owed to the live gate.
 */

const SINGLE = "10:2"; // Title — Inter/Regular, fontSize 24
const MIXED = "20:2"; // Mixed Heading — Inter/Bold + Inter/Regular
const BRANDED = "20:3"; // Branded Label — Custom Sans/Bold, absent from the machine
const FRAME = "10:1";

const ALL_TWELVE = {
  fontFamily: "Inter",
  fontStyle: "Bold",
  fontSize: 32,
  lineHeight: { value: 40, unit: "PIXELS" },
  letterSpacing: { value: -2, unit: "PERCENT" },
  textCase: "UPPER",
  textDecoration: "UNDERLINE",
  textAlignHorizontal: "CENTER",
  textAlignVertical: "BOTTOM",
  paragraphSpacing: 8,
  paragraphIndent: 12,
  textAutoResize: "HEIGHT",
};

// The eleven node properties the tool can assign. Read straight off the live fixture
// node, not off the reply, so a snapshot cannot be fooled by what the tool chose to say.
const WRITABLE = [
  "fontName",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "textCase",
  "textDecoration",
  "textAlignHorizontal",
  "textAlignVertical",
  "paragraphSpacing",
  "paragraphIndent",
  "textAutoResize",
];

// The plugin runs inside a `vm` context, so an object IT built has a different
// Object.prototype than this realm's and `deepStrictEqual` rejects it as "same
// structure but not reference-equal". Re-hydrating here compares the value, which is
// what these assertions are about.
function plainOf(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function snapshot(node) {
  const out = {};
  for (const key of WRITABLE) {
    const value = node[key];
    out[key] = typeof value === "symbol" ? "«symbol»" : JSON.stringify(value);
  }
  return out;
}

async function refuses(harness, nodeId, params, matcher) {
  const node = harness.getNode(nodeId);
  const before = snapshot(node);
  await assert.rejects(() => harness.command("set_text_style", { nodeId, ...params }), matcher);
  // ⛔ The load-bearing half. Without this the test passes on a validate-as-you-go
  // implementation that wrote eleven fields and then threw on the twelfth.
  assert.deepEqual(
    snapshot(node),
    before,
    "the node must be byte-identical after a refusal — a refusal that mutates is F4",
  );
}

test("applies all twelve parameters to a single-font node and reports what it wrote", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_text_style", {
    nodeId: SINGLE,
    ...ALL_TWELVE,
  });

  assert.equal(result.id, SINGLE);
  assert.equal(result.scope, "node");
  assert.equal(result.appliedFieldCount, 12);
  assert.deepEqual(result.appliedFields.sort(), Object.keys(ALL_TWELVE).sort());

  const node = harness.getNode(SINGLE);
  assert.deepEqual(plainOf(node.fontName), { family: "Inter", style: "Bold" });
  assert.equal(node.fontSize, 32);
  assert.deepEqual(plainOf(node.lineHeight), { value: 40, unit: "PIXELS" });
  assert.deepEqual(plainOf(node.letterSpacing), { value: -2, unit: "PERCENT" });
  assert.equal(node.textCase, "UPPER");
  assert.equal(node.textDecoration, "UNDERLINE");
  assert.equal(node.textAlignHorizontal, "CENTER");
  assert.equal(node.textAlignVertical, "BOTTOM");
  assert.equal(node.paragraphSpacing, 8);
  assert.equal(node.paragraphIndent, 12);
  assert.equal(node.textAutoResize, "HEIGHT");

  // The reply's own read-back must agree with the document, or it is decoration.
  assert.equal(result.after.fontSize, 32);
  assert.deepEqual(result.after.fontName, { family: "Inter", style: "Bold" });
  assert.equal(result.before.fontSize, 24);
});

test("⛔ the invalid parameter is LAST and NOTHING is written — validate-all-then-write", async () => {
  const harness = await loadPluginHarness();
  // Eleven valid parameters, then one bad enum. A validate-as-you-go implementation
  // writes all eleven before it reaches the twelfth; this is exactly the F4 shape.
  await refuses(
    harness,
    SINGLE,
    { ...ALL_TWELVE, textAutoResize: "SOMETIMES" },
    /textAutoResize must be one of/,
  );
});

test("⛔ an unloadable font refuses the whole call, including the eleven valid fields", async () => {
  const harness = await loadPluginHarness({
    // Listed in the fixture inventory AND refusing to load — Phase 2's available-vs-
    // loadable split, now on the write side.
    unavailableFonts: ["Helvetica Neue::Condensed Bold"],
  });
  await refuses(
    harness,
    SINGLE,
    { ...ALL_TWELVE, fontFamily: "Helvetica Neue", fontStyle: "Condensed Bold" },
    /could not load 1 font .* wrote nothing/s,
  );
});

test("⛔ it REFUSES rather than substituting Inter — no fallback load is even attempted", async () => {
  const harness = await loadPluginHarness({
    unavailableFonts: ["Ghost Sans::Regular"],
  });
  const node = harness.getNode(SINGLE);
  const beforeFont = { ...node.fontName };

  await assert.rejects(
    () =>
      harness.command("set_text_style", {
        nodeId: SINGLE,
        fontFamily: "Ghost Sans",
        fontStyle: "Regular",
        fontSize: 48,
      }),
    /refuses rather than substituting Inter/,
  );

  // ⭐ The distinguishing assertion. `setCharacters` answers a refused load by loading
  // Inter and retyping the node — F2. If this tool ever grew that path, the node would
  // still be Inter/Regular here and a font-name check alone would look identical.
  assert.deepEqual(plainOf(node.fontName), beforeFont, "the font must be untouched");
  assert.equal(node.fontSize, 24, "the size must not have been written either");
});

test("fontSubstituted is a permanent false, present on the success path", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_text_style", {
    nodeId: SINGLE,
    fontFamily: "Inter",
    fontStyle: "Bold",
  });
  // Not `assert.ok(!result.fontSubstituted)` — an absent field would satisfy that, and
  // the whole point of the field is that an absence must never read as an answer.
  assert.equal(
    Object.hasOwn(result, "fontSubstituted"),
    true,
    "the declaration must be present, not merely falsy",
  );
  assert.equal(result.fontSubstituted, false);
});

test("a mixed-font node is unified when a font is supplied, and says the runs were discarded", async () => {
  const harness = await loadPluginHarness();
  const node = harness.getNode(MIXED);
  assert.equal(typeof node.fontName, "symbol", "guard: the fixture node must start mixed");

  const result = await harness.command("set_text_style", {
    nodeId: MIXED,
    fontFamily: "Inter",
    fontStyle: "Semi Bold",
    fontSize: 30,
  });

  assert.equal(result.wasMixed, true);
  assert.equal(result.fontUnified, true);
  assert.deepEqual(result.appliedFont, { family: "Inter", style: "Semi Bold" });
  // The node really stopped being mixed — asserted through the range API, not just the
  // scalar, because a data property could have been overwritten while the runs survived.
  assert.deepEqual(plainOf(node.getRangeFontName(0, node.characters.length)), {
    family: "Inter",
    style: "Semi Bold",
  });
  assert.match(result.limitations.join(" "), /per-character font runs are gone/);
});

test("⭐ a still-mixed node reports the string MIXED — the symbol must not vanish", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_text_style", {
    nodeId: MIXED,
    textAlignHorizontal: "RIGHT",
  });

  assert.equal(result.wasMixed, true);
  assert.equal(result.fontUnified, false);
  // ⛔ `JSON.stringify` renders a symbol as `undefined`, which DROPS THE KEY. Without
  // the sentinel this key would be absent and read as "not reported" rather than "this
  // node holds more than one font". `harness.command` JSON-clones the reply, so this
  // assertion runs against the same serialisation an MCP consumer receives.
  assert.equal(
    Object.hasOwn(result.after, "fontName"),
    true,
    "the key must survive serialisation",
  );
  assert.equal(result.after.fontName, "MIXED");
  assert.equal(result.before.fontName, "MIXED");
  assert.equal(harness.getNode(MIXED).textAlignHorizontal, "RIGHT");
});

test("⛔ every invalid parameter is reported, not just the first", async () => {
  const harness = await loadPluginHarness();
  const node = harness.getNode(SINGLE);
  const before = snapshot(node);

  await assert.rejects(
    () =>
      harness.command("set_text_style", {
        nodeId: SINGLE,
        fontSize: -5,
        textCase: "SHOUTY",
        textDecoration: "WAVY",
      }),
    (error) => {
      assert.match(error.message, /refused 3 invalid parameters/);
      assert.match(error.message, /fontSize must be at least 1/);
      assert.match(error.message, /textCase must be one of/);
      assert.match(error.message, /textDecoration must be one of/);
      return true;
    },
  );
  assert.deepEqual(snapshot(node), before);
});

test("fontFamily and fontStyle are one decision — half a pair is refused", async () => {
  const harness = await loadPluginHarness();
  await refuses(harness, SINGLE, { fontFamily: "Inter" }, /must be supplied together/);
  await refuses(harness, SINGLE, { fontStyle: "Bold" }, /must be supplied together/);
});

test("lineHeight AUTO refuses a value rather than discarding it", async () => {
  const harness = await loadPluginHarness();
  await refuses(
    harness,
    SINGLE,
    { lineHeight: { unit: "AUTO", value: 24 } },
    /must be omitted when unit is AUTO/,
  );
  // …and the legitimate AUTO shape is accepted.
  const result = await harness.command("set_text_style", {
    nodeId: SINGLE,
    lineHeight: { unit: "AUTO" },
  });
  assert.deepEqual(result.after.lineHeight, { unit: "AUTO" });
});

test("a bare number is refused for lineHeight and letterSpacing", async () => {
  const harness = await loadPluginHarness();
  await refuses(harness, SINGLE, { lineHeight: 24 }, /must be an object \{value, unit\}/);
  await refuses(harness, SINGLE, { letterSpacing: 2 }, /must be an object \{value, unit\}/);
  await refuses(
    harness,
    SINGLE,
    { letterSpacing: { value: 2, unit: "AUTO" } },
    /letterSpacing\.unit must be one of PIXELS, PERCENT/,
  );
});

test("a call that would change nothing is refused rather than reported as success", async () => {
  const harness = await loadPluginHarness();
  await refuses(harness, SINGLE, {}, /needs at least one property to write/);
});

test("a non-TEXT node is refused before anything is read off it", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_text_style", { nodeId: FRAME, fontSize: 20 }),
    /is not a text node/,
  );
});

test("⭐ the node's EXISTING fonts are loaded before any write, so a missing one refuses", async () => {
  // Custom Sans is on the node and absent from the machine. Figma refuses to modify any
  // property of a text node whose current font is unloaded — not only the font itself —
  // so even a pure alignment change must be refused here rather than half-applied.
  const harness = await loadPluginHarness({
    unavailableFonts: ["Custom Sans::Bold"],
  });
  await refuses(
    harness,
    BRANDED,
    { textAlignHorizontal: "CENTER" },
    /Custom Sans Bold/,
  );
});

test("⭐ a mixed node loads EVERY face it carries, not the symbol and not just one", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_text_style", {
    nodeId: MIXED,
    textCase: "UPPER",
  });
  // `fontName` on this node is figma.mixed and names no face at all, so an
  // implementation reading it would have loaded nothing and left Figma to refuse the
  // write for a font it never saw.
  assert.deepEqual(result.fontsLoaded, [
    { family: "Inter", style: "Bold" },
    { family: "Inter", style: "Regular" },
  ]);
});

test("the published contract keeps set_text_style additive-preview, node-scoped and silent", async () => {
  const { readFile } = await import("node:fs/promises");
  const contract = JSON.parse(
    await readFile(new URL("../contracts/public-contract.json", import.meta.url), "utf8"),
  );
  const tool = contract.tools.find((entry) => entry.name === "set_text_style");
  assert.ok(tool, "set_text_style must be in the published contract");
  // CC1: a new tool that is not in ADDITIVE_PREVIEW_RESULTS falls through to `stable`
  // and is frozen the day it ships, without ever having faced a live gate.
  assert.equal(tool.resultStability, "additive-preview");
  assert.equal(tool.direction, "write");
  assert.equal(tool.scope, "node");
  assert.equal(tool.timeoutClass, "standard");
  assert.equal(tool.progress.pluginUpdates, "none");
  // D2: ranges are internal. No offsets may appear in the public surface.
  const schema = JSON.stringify(tool.inputSchema);
  assert.equal(/"start"|"end"|"rangeStart"/.test(schema), false, "D2: no range offsets");
});
