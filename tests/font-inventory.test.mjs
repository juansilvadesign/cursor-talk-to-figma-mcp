import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.5 Phase 2 — `get_available_fonts` and `check_fonts`.
 *
 * ⚠️ CC6, stated once for the whole file: the fixture supplies the inventory, so every
 * PASS here proves the WINDOW, the FILTER, the SORT and the available-vs-loadable split.
 * None of them proves what a real machine's `listAvailableFontsAsync()` returns, or how
 * large it is. That half is owed to R2.5's live gate, exactly as F3's reachability is.
 *
 * What the fixture CAN express, and what no earlier fixture could: a face that is listed
 * in the inventory and still refuses to load. `Helvetica Neue / Condensed Bold` is in
 * `fonts` and in `unavailableFonts` at the same time, which is the entire reason
 * `check_fonts` reports `available` and `loadable` as two fields rather than one.
 */

// The fixture's 8 faces in the order the tools must produce: family, then style, by
// code unit. The fixture itself is deliberately unsorted, so an assertion against this
// list fails if the sort is dropped.
const SORTED_FACES = [
  { family: "Helvetica Neue", style: "Condensed Bold" },
  { family: "Inter", style: "Bold" },
  { family: "Inter", style: "Regular" },
  { family: "Inter", style: "Semi Bold" },
  { family: "Inter", style: "Thin" },
  { family: "Roboto", style: "Bold" },
  { family: "Roboto", style: "Regular" },
  { family: "Zapfino", style: "Regular" },
];

test("get_available_fonts sorts the inventory deterministically, family then style", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("get_available_fonts", {});

  assert.equal(result.supported, true);
  assert.deepEqual(result.fonts, SORTED_FACES);
  // The fixture's own order is not this one. If the handler returned Figma's order
  // untouched, `offset` paging would be repeatable only by luck.
  const fixtureOrder = await harness.command("get_available_fonts", {});
  assert.notDeepEqual(fixtureOrder.fonts[0], { family: "Roboto", style: "Regular" });
  assert.equal(result.complete, true);
  assert.deepEqual(result.limitations, []);
});

test("whole-inventory counts keep their meaning against a window", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("get_available_fonts", { limit: 3 });

  assert.equal(result.pagination.returned, 3);
  assert.equal(result.fonts.length, 3);
  // The three counts describe the MACHINE, not the three faces returned. A window that
  // moved them would make truncation invisible, which is the defect R2.0 paid off.
  assert.equal(result.fontCount, 8);
  assert.equal(result.familyCount, 4);
  assert.equal(result.matchCount, 8);
  assert.equal(result.pagination.hasMore, true);
  assert.equal(result.complete, false);
  assert.match(result.limitations.join(" "), /Returned 3 of 8 matching faces/);
});

test("paging reassembles the inventory exactly once, with no gap and no overlap", async () => {
  const harness = await loadPluginHarness();
  const pages = [];
  // 0, 3, 6, and one past the end at 9.
  for (let offset = 0; offset <= 9; offset += 3) {
    const page = await harness.command("get_available_fonts", { limit: 3, offset });
    pages.push(page);
  }

  assert.deepEqual(
    pages.flatMap((page) => page.fonts),
    SORTED_FACES,
  );
  assert.deepEqual(
    pages.map((page) => page.pagination.hasMore),
    [true, true, false, false],
  );
  assert.equal(pages[2].complete, true);
  // An offset past the end is an empty window, not an error and not a wrapped page.
  assert.deepEqual(pages[3].fonts, []);
  assert.equal(pages[3].fontCount, 8);
});

test("the family filter narrows the window without touching the totals", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("get_available_fonts", { family: "Inter" });

  assert.deepEqual(
    result.fonts,
    SORTED_FACES.filter((face) => face.family === "Inter"),
  );
  assert.equal(result.matchCount, 4);
  // Still the machine's totals. `matchCount` is the only count the filter moves.
  assert.equal(result.fontCount, 8);
  assert.equal(result.familyCount, 4);
  assert.deepEqual(result.filter, { family: "Inter" });
  assert.equal(result.complete, true);
});

test("a filter miss is declared, because it reads identically to an absent family", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("get_available_fonts", { family: "inter" });

  assert.deepEqual(result.fonts, []);
  assert.equal(result.matchCount, 0);
  // ⭐ `fonts: []` alone would let a misspelling and a genuinely missing family read the
  // same. The reply says which possibility it cannot rule out.
  assert.match(
    result.limitations.join(" "),
    /exact, case-sensitive family match/,
  );
  assert.equal(result.complete, true);
});

test("a host without listAvailableFontsAsync answers null counts, never zero", async () => {
  const harness = await loadPluginHarness({ fontInventoryApi: false });
  const result = await harness.command("get_available_fonts", {});

  assert.equal(result.supported, false);
  // ⛔ 0 would read as "this machine has no fonts installed" — a real finding rather
  // than the absence of one. code.js already carries that lesson for another count.
  assert.equal(result.fontCount, null);
  assert.equal(result.familyCount, null);
  assert.equal(result.matchCount, null);
  assert.deepEqual(result.fonts, []);
  assert.equal(result.complete, false);
  assert.match(result.limitations.join(" "), /does not expose listAvailableFontsAsync/);
});

test("timeBudgetMs bounds the reply and says so, because it cannot bound the fetch", async () => {
  const harness = await loadPluginHarness({
    fontListNeverResolves: true,
    runTimers: true,
  });
  const result = await harness.command("get_available_fonts", { timeBudgetMs: 250 });

  assert.equal(result.supported, true);
  assert.equal(result.coverage.inventoryFetched, false);
  assert.equal(result.coverage.budgetExhausted, true);
  // ⛔ The one field that stops `budgetExhausted` from being read as "work was skipped".
  // Figma's listAvailableFontsAsync takes no cancellation signal; the call was abandoned
  // mid-flight and is still running.
  assert.equal(result.coverage.budgetCancelsFetch, false);
  assert.equal(result.fontCount, null);
  assert.equal(result.complete, false);
  assert.match(result.limitations.join(" "), /abandoned rather than stopped/);
});

test("check_fonts reports available and loadable as two facts that can disagree", async () => {
  const harness = await loadPluginHarness({
    unavailableFonts: ["Helvetica Neue::Condensed Bold"],
  });
  const result = await harness.command("check_fonts", {
    fonts: [
      { family: "Inter", style: "Regular" },
      { family: "Helvetica Neue", style: "Condensed Bold" },
    ],
  });

  assert.deepEqual(result.results[0], {
    requested: { family: "Inter", style: "Regular" },
    available: true,
    familyAvailable: true,
    loadable: true,
    error: null,
    loadMs: 0,
  });
  // ⭐ The case the whole tool exists for: the face IS in the inventory and still will
  // not load. A single `available` field would have answered `true` and the caller's
  // write would then have been substituted to Inter without a word.
  assert.equal(result.results[1].available, true);
  assert.equal(result.results[1].loadable, false);
  assert.match(result.results[1].error, /is not available/);

  assert.equal(result.availableCount, 2);
  assert.equal(result.loadableCount, 1);
  assert.deepEqual(result.missing, [
    { family: "Helvetica Neue", style: "Condensed Bold" },
  ]);
  assert.equal(result.complete, true);
});

test("familyAvailable separates a misspelled style from an absent family", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("check_fonts", {
    fonts: [
      { family: "Inter", style: "Blond" },
      { family: "Ghost", style: "Bold" },
    ],
  });

  const [styleMiss, familyMiss] = result.results;
  assert.equal(styleMiss.available, false);
  assert.equal(styleMiss.familyAvailable, true, "Inter exists, 'Blond' does not");
  assert.equal(familyMiss.available, false);
  assert.equal(familyMiss.familyAvailable, false, "no Ghost face at all");
  // Both are absent from the inventory, and the harness's loadFontAsync accepts any
  // well-formed pair, so `loadable` cannot separate them. `familyAvailable` is the only
  // field that tells a caller whether to fix the style or pick another family.
  assert.equal(styleMiss.loadable, true);
  assert.equal(familyMiss.loadable, true);
});

test("the plugin — not the test — is what attempts the load", async () => {
  const harness = await loadPluginHarness();
  assert.deepEqual(harness.fontLoads, []);

  await harness.command("check_fonts", {
    fonts: [
      { family: "Roboto", style: "Bold" },
      { family: "Zapfino", style: "Regular" },
    ],
  });

  // CC6: `loadable: true` is supplied by the harness, so it proves nothing on its own.
  // What IS observable offline is that the handler really called loadFontAsync, with the
  // exact pairs asked for and in order — the difference between probing and guessing.
  assert.deepEqual(harness.fontLoads, [
    { family: "Roboto", style: "Bold" },
    { family: "Zapfino", style: "Regular" },
  ]);
  assert.equal(harness.isFontLoaded("Roboto", "Bold"), true);
});

test("every pair is validated before any font is loaded", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    harness.command("check_fonts", {
      fonts: [
        { family: "Inter", style: "Regular" },
        { family: "Roboto", style: "Bold" },
        { family: "Inter", style: 42 },
      ],
    }),
    /fonts\[2\] must be \{family, style\}/,
  );

  // ⭐ The throw alone would pass with validation interleaved into the probe loop. This
  // is the assertion that proves the ORDER: two valid pairs preceded the bad one and
  // neither was loaded, so the caller was not charged for work the tool then refused to
  // report. Same shape as the atomicity debt F4 names.
  assert.deepEqual(harness.fontLoads, []);
});

test("the pair cap is refused by name, not silently truncated", async () => {
  const harness = await loadPluginHarness();
  const fonts = Array.from({ length: 51 }, (unused, index) => ({
    family: "Inter",
    style: `Style ${index}`,
  }));

  await assert.rejects(
    harness.command("check_fonts", { fonts }),
    /51 pairs, above the 50-pair cap/,
  );
  assert.deepEqual(harness.fontLoads, []);
});

test("an exhausted budget skips pairs instead of calling them unavailable", async () => {
  const harness = await loadPluginHarness({ fontLoadMs: 100 });
  const fonts = SORTED_FACES.slice(0, 6);
  const result = await harness.command("check_fonts", { fonts, timeBudgetMs: 250 });

  assert.equal(result.requestedCount, 6);
  assert.equal(result.checkedCount, 3);
  assert.equal(result.skippedCount, 3);
  assert.equal(result.coverage.budgetExhausted, true);
  assert.equal(result.complete, false);
  // ⛔ The unprobed pairs are ABSENT from results. Emitting them with `available: false`
  // would report a fact the tool never established — a caller would then swap a font
  // that was on the machine all along.
  assert.equal(result.results.length, 3);
  assert.deepEqual(result.missing, []);
  assert.match(result.limitations.join(" "), /never probed and are absent from results/);
});

test("check_fonts still reports loadability on a host with no inventory API", async () => {
  const harness = await loadPluginHarness({
    fontInventoryApi: false,
    unavailableFonts: ["Zapfino::Regular"],
  });
  const result = await harness.command("check_fonts", {
    fonts: [
      { family: "Inter", style: "Regular" },
      { family: "Zapfino", style: "Regular" },
    ],
  });

  assert.equal(result.inventorySupported, false);
  // null, not false: the inventory could not be consulted, which is a different claim
  // from "this font is not installed".
  assert.equal(result.results[0].available, null);
  assert.equal(result.results[0].familyAvailable, null);
  assert.equal(result.fontCount, null);
  // Loadability is observed by attempting the load, so it survives the missing API.
  assert.equal(result.results[0].loadable, true);
  assert.equal(result.results[1].loadable, false);
  assert.equal(result.complete, false);
  assert.match(result.limitations.join(" "), /null rather than false/);
});

test("check_fonts emits the per-font progress its contract declares", async () => {
  const harness = await loadPluginHarness();
  await harness.command("check_fonts", {
    fonts: [
      { family: "Inter", style: "Regular" },
      { family: "Roboto", style: "Bold" },
    ],
  });

  const updates = harness.messages.filter(
    (message) => message.type === "command_progress",
  );
  const forCheck = updates.filter((update) => update.commandType === "check_fonts");

  // CC2: the declaration moved off "none" in the same change that added these calls, so
  // the pair can never be half-landed. Finding 4 is a map that describes work the
  // runtime does not do.
  assert.deepEqual(
    forCheck.map((update) => update.status),
    ["started", "in_progress", "in_progress", "completed"],
  );
  assert.deepEqual(
    forCheck.map((update) => update.processedItems),
    [0, 1, 2, 2],
  );
  assert.equal(forCheck[forCheck.length - 1].progress, 100);
});

test("get_available_fonts declares no progress, and emits none", async () => {
  const harness = await loadPluginHarness();
  await harness.command("get_available_fonts", {});

  const updates = harness.messages.filter(
    (message) => message.type === "command_progress",
  );
  // ⛔ One un-cancellable await plus an in-memory sort has no point between them to
  // report from. Declaring progress here would mint Finding 4 a third time, so the
  // contract says "none" and this asserts the runtime agrees.
  assert.deepEqual(updates, []);
});

test("an inventory API that throws surfaces the error, it is not read as an absent API", async () => {
  const harness = await loadPluginHarness({ fontListError: "font service unavailable" });

  // ⭐ A host that HAS no listAvailableFontsAsync and a host whose listAvailableFontsAsync
  // FAILS are different facts. Downgrading the second into `supported: false` would name
  // the wrong cause and hide a transient failure behind a permanent-sounding one.
  await assert.rejects(
    harness.command("get_available_fonts", {}),
    /font service unavailable/,
  );
  await assert.rejects(
    harness.command("check_fonts", { fonts: [{ family: "Inter", style: "Regular" }] }),
    /font service unavailable/,
  );
});
