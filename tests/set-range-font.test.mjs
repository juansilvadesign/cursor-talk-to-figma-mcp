import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const MIXED = "20:2";
const NON_TEXT = "30:1";
const TARGET = { start: 13, end: 20 };
const REQUESTED = { family: "Inter", style: "Semi Bold" };

function fontAt(harness, start, end) {
  return JSON.parse(
    JSON.stringify(harness.getNode(MIXED).getRangeFontName(start, end)),
  );
}

test("changes only the named interval, loads its exact face, and reports direct range read-back", async () => {
  const harness = await loadPluginHarness({ strictRangeFontLoading: true });
  assert.deepEqual(fontAt(harness, 0, 13), { family: "Inter", style: "Bold" });
  assert.deepEqual(fontAt(harness, 13, 26), { family: "Inter", style: "Regular" });

  const result = await harness.command("set_range_font", {
    nodeId: MIXED,
    ...TARGET,
    fontFamily: REQUESTED.family,
    fontStyle: REQUESTED.style,
  });

  assert.equal(result.scope, "text_range");
  assert.deepEqual(result.requestedFont, REQUESTED);
  assert.deepEqual(result.before.font, { family: "Inter", style: "Regular" });
  assert.deepEqual(result.after.font, REQUESTED);
  assert.equal(result.readbackMatchesRequested, true);
  assert.equal(harness.isFontLoaded("Inter", "Semi Bold"), true);

  // The outside runs are the discriminator: a node-level write would replace the bold
  // prefix and the remaining regular suffix too, while a true range write leaves both.
  assert.deepEqual(fontAt(harness, 0, 13), { family: "Inter", style: "Bold" });
  assert.deepEqual(fontAt(harness, 13, 20), REQUESTED);
  assert.deepEqual(fontAt(harness, 20, 26), { family: "Inter", style: "Regular" });
  assert.equal(typeof harness.getNode(MIXED).fontName, "symbol");
});

test("an invalid range refuses before font loading or any character-range mutation", async () => {
  const harness = await loadPluginHarness({ strictRangeFontLoading: true });
  const before = [fontAt(harness, 0, 13), fontAt(harness, 13, 26)];

  await assert.rejects(
    () =>
      harness.command("set_range_font", {
        nodeId: MIXED,
        start: 20,
        end: 20,
        fontFamily: REQUESTED.family,
        fontStyle: REQUESTED.style,
      }),
    /requires a non-empty \[start, end\).*wrote nothing/s,
  );

  assert.deepEqual([fontAt(harness, 0, 13), fontAt(harness, 13, 26)], before);
  assert.deepEqual(harness.fontLoads, []);
});

test("an unloadable requested face refuses without changing any range", async () => {
  const harness = await loadPluginHarness({
    strictRangeFontLoading: true,
    unavailableFonts: ["Inter::Semi Bold"],
  });
  const before = [fontAt(harness, 0, 13), fontAt(harness, 13, 26)];

  await assert.rejects(
    () =>
      harness.command("set_range_font", {
        nodeId: MIXED,
        ...TARGET,
        fontFamily: REQUESTED.family,
        fontStyle: REQUESTED.style,
      }),
    /could not load Inter Semi Bold.*wrote nothing/s,
  );

  assert.deepEqual([fontAt(harness, 0, 13), fontAt(harness, 13, 26)], before);
});

test("the receipt is a range read-back, not an echo of a silently discarded write", async () => {
  const harness = await loadPluginHarness({
    strictRangeFontLoading: true,
    ignoreRangeFontWrites: [MIXED],
  });

  const result = await harness.command("set_range_font", {
    nodeId: MIXED,
    ...TARGET,
    fontFamily: REQUESTED.family,
    fontStyle: REQUESTED.style,
  });

  assert.deepEqual(result.after.font, { family: "Inter", style: "Regular" });
  assert.equal(result.readbackMatchesRequested, false);
  assert.deepEqual(fontAt(harness, 13, 20), { family: "Inter", style: "Regular" });
});

test("a non-TEXT target is refused before the face is loaded", async () => {
  const harness = await loadPluginHarness({ strictRangeFontLoading: true });

  await assert.rejects(
    () =>
      harness.command("set_range_font", {
        nodeId: NON_TEXT,
        start: 0,
        end: 1,
        fontFamily: REQUESTED.family,
        fontStyle: REQUESTED.style,
      }),
    /requires a TEXT node.*wrote nothing/s,
  );

  assert.deepEqual(harness.fontLoads, []);
});
