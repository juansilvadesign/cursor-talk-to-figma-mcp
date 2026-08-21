import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.6 Phase 2 item 2.0 — `create_text` gains `set_text_style`'s twelve parameters.
 *
 * ⛔ The F4 shape on a CREATE tool is not a half-written node, it is a node that exists
 * at all. `set_text_style` refuses by leaving the node byte-identical; `create_text` can
 * only refuse by leaving the page's child list unchanged. Every refusal case below
 * asserts that side-effect channel — the page — and puts the invalid parameter LAST, so
 * a validate-as-you-go implementation would already have created the node and written
 * eleven properties before reaching it. Asserting only that it threw would survive that,
 * exactly as `feedback_asserting_it_threw_does_not_assert_when_it_threw` predicts.
 *
 * ⭐ Two defects this file reproduced BEFORE the fix, both on the current source:
 *
 *   1. `setCharacters` was called without `await` (`code.js:1802`), so the reply read
 *      `textNode.characters` while the write was still a pending microtask and reported
 *      `""` for text it did in fact write. The lie was ORDER-DEPENDENT: the `parentId`
 *      path awaits `getNodeByIdAsync` on the way out, which let the microtask land, so
 *      the same tool reported the truth or a lie depending on an unrelated parameter.
 *   2. An unknown enum was not validated at all — it was ignored, silently, and the node
 *      was created anyway.
 *
 * ⛔ CC6, stated: the harness supplies the font inventory and decides which faces refuse
 * to load. These cases prove the ORDER of operations, the refusal policy and the reply's
 * honesty. What real Figma refuses, and when, is owed to the live gate.
 */

const PAGE = "1:1"; // Page One — the fixture's current page
const FRAME = "10:1"; // a frame on Page One, for the parentId path

// The twelve typography parameters create_text now shares with set_text_style.
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

function plainOf(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * ⛔ The load-bearing helper. A create tool's side-effect channel is the page's child
 * list, so a refusal is only proven by counting it — a `rejects` on its own passes
 * happily over an orphaned empty text node.
 */
async function refusesAndCreatesNothing(harness, params, matcher) {
  const page = harness.getNode(PAGE);
  const before = page.children.length;
  await assert.rejects(() => harness.command("create_text", params), matcher);
  assert.equal(
    page.children.length,
    before,
    "a refused create_text must leave the page's child list unchanged — an orphan node is F4 wearing a different hat",
  );
}

test("writes all twelve typography parameters onto the node it creates", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("create_text", {
    x: 10,
    y: 20,
    text: "Styled",
    name: "Styled label",
    ...ALL_TWELVE,
  });

  const node = harness.getNode(result.id);
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

  // The reply's read-back must agree with the document, or it is decoration.
  assert.equal(result.style.fontSize, 32);
  assert.deepEqual(result.style.fontName, { family: "Inter", style: "Bold" });
  assert.equal(result.appliedFieldCount, 12);
  assert.deepEqual(result.appliedFields.sort(), Object.keys(ALL_TWELVE).sort());
  assert.equal(result.fontSource, "explicit");
});

test("⛔ the reply's characters is the text that was actually written", async () => {
  const harness = await loadPluginHarness();
  // ⭐ NO parentId. That path awaits `getNodeByIdAsync` on the way out, which let the
  // un-awaited character write land before the reply was built — so the defect hid on
  // the parented path and appeared only here. A test that passed parentId would have
  // reported green over it.
  const result = await harness.command("create_text", {
    x: 0,
    y: 0,
    text: "Hello",
  });

  assert.equal(result.characters, "Hello");
  assert.equal(harness.getNode(result.id).characters, "Hello");
});

test("the reply's characters is correct on the parented path too", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("create_text", {
    x: 0,
    y: 0,
    text: "Nested",
    parentId: FRAME,
  });

  assert.equal(result.characters, "Nested");
  assert.equal(result.parentId, FRAME);
  assert.equal(harness.getNode(result.id).characters, "Nested");
});

test("⛔ the invalid parameter is LAST and NO node is created — validate-all-then-create", async () => {
  const harness = await loadPluginHarness();
  await refusesAndCreatesNothing(
    harness,
    { x: 0, y: 0, text: "Refused", ...ALL_TWELVE, textAutoResize: "SOMETIMES" },
    /textAutoResize must be one of/,
  );
});

test("⛔ every invalid parameter is reported, not just the first", async () => {
  const harness = await loadPluginHarness();
  await refusesAndCreatesNothing(
    harness,
    {
      x: 0,
      y: 0,
      text: "Refused",
      textCase: "SHOUTY",
      textDecoration: "SQUIGGLE",
      paragraphIndent: -4,
    },
    (error) => {
      assert.match(error.message, /textCase must be one of/);
      assert.match(error.message, /textDecoration must be one of/);
      assert.match(error.message, /paragraphIndent must be at least 0/);
      assert.match(error.message, /refused 3 invalid parameters/);
      return true;
    },
  );
});

test("⛔ fontWeight and fontFamily/fontStyle are refused together — one of them would be discarded", async () => {
  const harness = await loadPluginHarness();
  await refusesAndCreatesNothing(
    harness,
    {
      x: 0,
      y: 0,
      text: "Collision",
      fontWeight: 700,
      fontFamily: "Roboto",
      fontStyle: "Regular",
    },
    /fontWeight cannot be combined with fontFamily\/fontStyle/,
  );
});

test("⛔ fontFamily without fontStyle is refused rather than guessed", async () => {
  const harness = await loadPluginHarness();
  await refusesAndCreatesNothing(
    harness,
    { x: 0, y: 0, text: "Half a pair", fontFamily: "Roboto" },
    /fontFamily and fontStyle must be supplied together/,
  );
});

test("⛔ an unloadable font REFUSES and creates nothing — it never substitutes Inter", async () => {
  const harness = await loadPluginHarness({
    unavailableFonts: ["Ghost Sans::Regular"],
  });
  await refusesAndCreatesNothing(
    harness,
    {
      x: 0,
      y: 0,
      text: "Branded",
      fontFamily: "Ghost Sans",
      fontStyle: "Regular",
    },
    /could not load .*Ghost Sans Regular.*refuses rather than substituting/s,
  );
});

test("⛔ the DEFAULT font path refuses too when Inter cannot load — the substitution is not reintroduced by omission", async () => {
  const harness = await loadPluginHarness({
    unavailableFonts: ["Inter::Regular"],
  });
  // No typography parameters at all: the path every existing caller uses. Before this
  // change the load failure was swallowed by a try/catch and the node was created in
  // whatever font Figma happened to give it.
  await refusesAndCreatesNothing(
    harness,
    { x: 0, y: 0, text: "Plain" },
    /could not load .*Inter Regular/s,
  );
});

test("an omitted fontSize still writes the R1-era 14, not the platform's own default", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("create_text", { x: 0, y: 0, text: "Sized" });

  // ⛔ A fresh Figma text node is 12. The 14 is this tool's own default and has been
  // since R1 — dropping the write would silently resize every text node created by a
  // caller who never asked for a size, which is a behaviour change disguised as tidying.
  assert.equal(harness.getNode(result.id).fontSize, 14);
  assert.equal(result.fontSize, 14);
  // ...and it is NOT reported as something the caller applied.
  assert.ok(!result.appliedFields.includes("fontSize"));
});

test("⭐ fontSubstituted is a PERMANENT declaration — the key is present, not merely falsy", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("create_text", {
    x: 0,
    y: 0,
    text: "Declared",
  });

  assert.ok(
    Object.hasOwn(result, "fontSubstituted"),
    "an absent fontSubstituted reads as 'not reported', which is not the same answer as 'no'",
  );
  assert.equal(result.fontSubstituted, false);
  assert.deepEqual(result.requestedFont, { family: "Inter", style: "Regular" });
  assert.deepEqual(result.appliedFont, { family: "Inter", style: "Regular" });
});

test("the legacy fontWeight path is unchanged — 700 still means Inter Bold", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("create_text", {
    x: 5,
    y: 6,
    text: "Bold text",
    fontSize: 18,
    fontWeight: 700,
    fontColor: { r: 1, g: 0, b: 0, a: 1 },
    name: "Heading",
  });

  const node = harness.getNode(result.id);
  assert.deepEqual(plainOf(node.fontName), { family: "Inter", style: "Bold" });
  assert.equal(node.fontSize, 18);
  assert.equal(node.name, "Heading");
  assert.equal(result.fontSource, "fontWeight");
  // ⛔ Every field the R1-era reply carried is still carried. Removing one is breaking,
  // and this tool is `stable`.
  for (const key of [
    "id",
    "name",
    "x",
    "y",
    "width",
    "height",
    "characters",
    "fontSize",
    "fontWeight",
    "fontColor",
    "fontName",
    "fills",
  ]) {
    assert.ok(Object.hasOwn(result, key), `the reply lost its ${key} field`);
  }
  assert.equal(result.fontWeight, 700);
});

test("⭐ fontWeight is null — never absent — when the face was named explicitly", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("create_text", {
    x: 0,
    y: 0,
    text: "Named",
    fontFamily: "Roboto",
    fontStyle: "Bold",
  });

  assert.ok(
    Object.hasOwn(result, "fontWeight"),
    "JSON.stringify drops an undefined key, and a dropped key reads as 'not reported'",
  );
  assert.equal(result.fontWeight, null);
  assert.equal(result.fontSource, "explicit");
});

test("⛔ lineHeight AUTO refuses an accompanying value rather than discarding it", async () => {
  const harness = await loadPluginHarness();
  await refusesAndCreatesNothing(
    harness,
    {
      x: 0,
      y: 0,
      text: "Auto",
      lineHeight: { value: 20, unit: "AUTO" },
    },
    /lineHeight.value must be omitted when unit is AUTO/,
  );
});

test("⛔ a refused character write REMOVES the node it created", async () => {
  const harness = await loadPluginHarness({
    strictFontLoading: true,
    // Every dynamically created node lands on 900:N; the first one this suite creates in
    // this harness is 900:1.
    refuseCharacterWrite: ["900:1"],
  });
  await refusesAndCreatesNothing(
    harness,
    { x: 0, y: 0, text: "Never written" },
    /could not write its characters/,
  );
});

test("an alpha of 0 survives — a supplied value is never replaced by a default", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("create_text", {
    x: 0,
    y: 0,
    text: "Transparent",
    fontColor: { r: 0, g: 0, b: 0, a: 0 },
  });

  // `parseFloat(fontColor.a) || 1` read a legitimate 0 as absent and wrote 1 — a fully
  // transparent fill silently became a fully opaque one.
  assert.equal(harness.getNode(result.id).fills[0].opacity, 0);
});

test("⛔ a create_text that changes nothing it was asked to change cannot report success", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("create_text", {
    x: 0,
    y: 0,
    text: "Minimal",
  });

  // The minimal call applies no typography parameters, and says so rather than
  // reporting an empty list as if the caller had asked for something.
  assert.deepEqual(result.appliedFields, []);
  assert.equal(result.appliedFieldCount, 0);
  assert.equal(result.fontSource, "default");
  assert.ok(
    result.limitations.some((note) => /fontFamily\/fontStyle/.test(note)),
    "the default-font path must say that the face was chosen for the caller",
  );
});
