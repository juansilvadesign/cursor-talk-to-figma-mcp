import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// R2 acceptance promotion is deliberately waiting on one thing this repository cannot
// manufacture: a live DEV-plugin channel. The ten names below are not a hand-wave around
// the pin rule; they are the complete set that must be re-pinned and run once when that
// channel arrives. The first nine were stale after Phase 2. Promotion then changed only
// serverBuildId, which also staled Phase 2's own SVG/CROP gate — a tenth script that the
// earlier nine-gate checklist did not count.
//
// ✅ The representative fixture HAS now been run — 2026-08-23, channel `w113vf7y`, PASSED
// twice on the promoted build `r2-server-a0afdc880ab0` ↔ `r2-plugin-2741d7f5f374`, every
// measured value agreeing across runs including a byte-identical export. This comment
// previously ended "and has not been run", which stayed true only until it was.
// ⛔ The ten below are still owed: the fixture is the acceptance ACT, not the re-pin.
const R2_ACCEPTANCE_REPIN_PENDING = Object.freeze([
  "live-batch-gate.mjs",
  "live-text-style-gate.mjs",
  "live-layout-gate.mjs",
  "live-constraints-gate.mjs",
  "live-size-limits-gate.mjs",
  "live-clips-content-gate.mjs",
  "live-fill-gate.mjs",
  "live-effects-gate.mjs",
  "live-opacity-blend-gate.mjs",
  "live-svg-crop-gate.mjs",
]);

/**
 * ⛔ **Editing a gate is not exercising it.**
 *
 * R2.6 Phase 1 found the R2.4 live gate had been UNRUNNABLE since `e02d1b2`: it carried a
 * `capabilityFingerprint` from a tree that had moved on, so it would have failed at
 * `assertRuntime` before reaching a single check. Nothing noticed, because the gate was
 * *edited* in that commit and never *re-run* on it. Phase 1 then had to re-pin it twice
 * before it would start.
 *
 * A gate cannot be run offline — that is the whole point of a gate. What CAN be checked
 * offline is the one failure that makes a gate silently useless: pins that no longer
 * describe this tree. So every `scripts/live-*.mjs` must either pin the CURRENT build, or
 * say out loud which earlier release it belongs to.
 *
 * ⭐ Both directions are enforced. An undeclared gate whose pins drifted fails, and a
 * DECLARED gate whose pins match again fails too — a stale declaration is the same class
 * of lie as a stale pin, and `NON_ATOMIC_BATCH_OPERATIONS` learned that the hard way.
 */
const GATES_PINNED_TO_AN_EARLIER_RELEASE = Object.freeze({
  "live-export-gate.mjs":
    "R2.1, schema 1.2.1. Last run against that build; re-pin and re-run before its result is quoted again.",
  "live-create-page-gate.mjs":
    "R2.2, schema 1.3.0. Last run against that build; re-pin and re-run before its result is quoted again.",
  "live-plugin-data-gate.mjs":
    "R2.4, schema 1.4.0. Last run against that build; re-pin and re-run before its result is quoted again.",
  // ✅ THE R2.7 BACKLOG IS CLEARED — 2026-08-23, channel `3az2oicz`.
  //
  // EIGHT entries lived here at once, and they arrived in three waves. Item 1.1 (`set_fill`)
  // moved both build IDs and staled the six that R2.6 had just cleared — `live-batch-gate`,
  // `live-text-style-gate`, `live-layout-gate`, `live-constraints-gate`,
  // `live-size-limits-gate`, `live-clips-content-gate`. Item 1.2 (`set_effects`) then staled
  // `live-fill-gate`, and item 1.3 (`set_opacity`/`set_blend_mode`) staled
  // `live-effects-gate`. Each item re-ran only its OWN gate and declined to re-pin the rest,
  // because a change that can only re-run one gate cannot honestly re-pin eight — that is
  // eight claims and one test, the defect `e02d1b2` created. The set was done ONCE at the
  // release's end: all eight re-pinned to the R2.7 final build
  // (`r2-server-d95951a3ce93` ↔ `r2-plugin-364f8001f2d1`, schema 1.9.0, 64 tools) and all
  // eight RE-RUN on one channel, each once. Their entries are deleted rather than reworded —
  // the declaration and the run travelled together, which is the whole rule.
  //
  // ⚠️ The six were green on `sa6ggz00`, `live-fill` on `yoq962bg` and `live-effects` on
  // `5982svqp`. Nothing about those results is withdrawn — they are results about builds
  // this tree no longer produces, which is exactly why they could not be quoted forward.
  //
  // ⭐ **A PIN EDIT DOES NOT MOVE THE BUILD, and that is what makes an eight-gate re-pin
  // possible in one pass.** The standing worry — recorded in MEMORY.md as "each re-pin
  // moves serverBuildId, so re-derive" — was WRONG, and it is worth keeping named because
  // it is what made the backlog look unworkable twice now. `serverBuildId` is
  // `sha256(server.ts + contractPayload)` and `pluginBuildId` hashes
  // `code.js` + `ui.html` + `manifest.json` (`scripts/contract-lib.mjs:605`). `scripts/`
  // is hashed by NEITHER. So these eight could never have staled each other; what staled
  // them was the *item* landing above them, every time.
  //
  // ⛔ The three entries above are a DIFFERENT case and stay: `live-export-gate.mjs`,
  // `live-create-page-gate.mjs` and `live-plugin-data-gate.mjs` belong to R2.1/R2.2/R2.4
  // and were part of neither the R2.6 nor the R2.7 backlog. They are owed a re-pin and a
  // re-run together whenever their results are next quoted. Folding them into this pass was
  // put to the owner on 2026-08-23 and declined — the scope was the eight.
  //
  // 🔴 **AND THE BACKLOG IS BACK AT NINE — staled by R2.7 PHASE 2, same day, hours later.**
  // The `set_image_fill` CROP repair changed `code.js` and `server.ts`, moving both build IDs
  // beneath every gate that had just been re-pinned. ⚠️ **The ninth is new to the set:**
  // `live-opacity-blend-gate.mjs` was the one gate NOT in the end-of-Phase-1 eight — it pinned
  // that build and had been run on it — so Phase 2 is the change that finally staled it.
  //
  // ⛔ NOT RE-PINNED, and the rule is the same one as every previous time: a change that can
  // re-run only its own gate cannot honestly re-pin nine. ⭐ **This is the cost the owner
  // chose with eyes open.** Phase 2 was sequenced BEFORE R2 acceptance precisely so the
  // promotion of `additive-preview` → `stable` (which rewrites `contractPayload.tools` and so
  // moves `serverBuildId` again) lands first and the whole set is re-pinned and re-run ONCE,
  // at acceptance, rather than once per stage.
  //
  // ⚠️ All nine were green on `3az2oicz` against the end-of-Phase-1 build
  // (`r2-server-d95951a3ce93` ↔ `r2-plugin-364f8001f2d1`) — eight in the re-pin pass and
  // `live-opacity-blend` on `shtlklfy` before it. Nothing about those results is withdrawn;
  // they are results about a build this tree no longer produces.
  "live-batch-gate.mjs":
    "End-of-R2.7-Phase-1 build, schema 1.9.0, 64 tools. Green on 3az2oicz; staled by Phase 2's set_image_fill CROP repair moving both build IDs. Re-pin and re-run with the R2 acceptance set.",
  "live-text-style-gate.mjs":
    "End-of-R2.7-Phase-1 build, schema 1.9.0, 64 tools. Green on 3az2oicz; staled by Phase 2's set_image_fill CROP repair moving both build IDs. Re-pin and re-run with the R2 acceptance set.",
  "live-layout-gate.mjs":
    "End-of-R2.7-Phase-1 build, schema 1.9.0, 64 tools. Green on 3az2oicz; staled by Phase 2's set_image_fill CROP repair moving both build IDs. Re-pin and re-run with the R2 acceptance set.",
  "live-constraints-gate.mjs":
    "End-of-R2.7-Phase-1 build, schema 1.9.0, 64 tools. Green on 3az2oicz; staled by Phase 2's set_image_fill CROP repair moving both build IDs. Re-pin and re-run with the R2 acceptance set.",
  "live-size-limits-gate.mjs":
    "End-of-R2.7-Phase-1 build, schema 1.9.0, 64 tools. Green on 3az2oicz; staled by Phase 2's set_image_fill CROP repair moving both build IDs. Re-pin and re-run with the R2 acceptance set.",
  "live-clips-content-gate.mjs":
    "End-of-R2.7-Phase-1 build, schema 1.9.0, 64 tools. Green on 3az2oicz; staled by Phase 2's set_image_fill CROP repair moving both build IDs. Re-pin and re-run with the R2 acceptance set.",
  "live-fill-gate.mjs":
    "End-of-R2.7-Phase-1 build, schema 1.9.0, 64 tools. Green on 3az2oicz; staled by Phase 2's set_image_fill CROP repair moving both build IDs. Re-pin and re-run with the R2 acceptance set.",
  "live-effects-gate.mjs":
    "End-of-R2.7-Phase-1 build, schema 1.9.0, 64 tools. Green on 3az2oicz; staled by Phase 2's set_image_fill CROP repair moving both build IDs. Re-pin and re-run with the R2 acceptance set.",
  // ⭐ The ninth, and the first time this gate has ever been declared. It pinned the
  // end-of-Phase-1 build and was run on it (`shtlklfy`, twice), which is exactly why it sat
  // out the eight-gate re-pin. Phase 2 staled it like all the others.
  "live-opacity-blend-gate.mjs":
    "R2.7 item 1.3 build, schema 1.9.0, 64 tools. Green on shtlklfy, run twice; staled by Phase 2's set_image_fill CROP repair moving both build IDs. Re-pin and re-run with the R2 acceptance set.",
  // Phase 2's own gate was current until the acceptance promotion changed
  // `contractPayload.tools`. The plugin, fingerprint, schema and tool count still match;
  // `serverBuildId` alone proves the server artifact is no longer the one that produced the
  // recorded CROP renders. The R2 fixture does not exercise CROP's transform matrix, so it
  // cannot honestly supersede this gate.
  "live-svg-crop-gate.mjs":
    "R2.7 Phase 2 build, schema 1.9.0, 65 tools. Green on sdg5mr5m twice; staled by the R2 acceptance stability promotion moving serverBuildId only. Re-pin and re-run with the complete R2 acceptance set.",
});

function readPins(source) {
  const block = /const expectedRuntime = \{([\s\S]*?)\n\};/.exec(source);
  if (!block) return null;
  const pins = {};
  for (const key of ["serverBuildId", "pluginBuildId", "schemaVersion", "fingerprint"]) {
    const match = new RegExp(`${key}:\\s*\\n?\\s*"([^"]+)"`).exec(block[1]);
    if (match) pins[key] = match[1];
  }
  const toolCount = /toolCount:\s*(\d+)/.exec(block[1]);
  if (toolCount) pins.toolCount = Number(toolCount[1]);
  return pins;
}

test("every live gate either pins THIS build or declares the release it belongs to", async () => {
  const [runtimeText, contractText, entries] = await Promise.all([
    readFile(path.join(root, "src/talk_to_figma_mcp/runtime-metadata.ts"), "utf8"),
    readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
    readdir(path.join(root, "scripts")),
  ]);
  const runtime = JSON.parse(
    runtimeText.slice(runtimeText.indexOf("{"), runtimeText.lastIndexOf("}") + 1),
  );
  const contract = JSON.parse(contractText);
  const current = {
    serverBuildId: runtime.serverBuildId,
    pluginBuildId: runtime.pluginBuildId,
    schemaVersion: runtime.serverSchemaVersion,
    fingerprint: runtime.capabilityFingerprint,
    toolCount: contract.tools.length,
  };

  const gateFiles = entries.filter(
    (name) => name.startsWith("live-") && name.endsWith(".mjs"),
  );
  // ⛔ Vacuity guard: a glob that matched nothing would pass this test in silence.
  assert.ok(gateFiles.length >= 5, `expected the live gates to be discoverable, found ${gateFiles.length}`);

  let currentGates = 0;
  for (const name of gateFiles) {
    const pins = readPins(await readFile(path.join(root, "scripts", name), "utf8"));
    if (!pins) continue; // live-smoke.mjs pins nothing — it asserts no build.

    const matches = Object.entries(pins).every(([key, value]) => current[key] === value);
    const declared = Object.hasOwn(GATES_PINNED_TO_AN_EARLIER_RELEASE, name);

    if (declared) {
      assert.equal(
        matches,
        false,
        `${name} is declared as pinned to an earlier release, but its pins match this build. Re-run it and remove the declaration — a stale declaration makes a current gate look untrustworthy.`,
      );
      continue;
    }

    currentGates += 1;
    // Compared over the keys the gate actually pins — a gate that pins four of the five
    // is still current, and inventing a fifth key here would fail it for the wrong reason.
    const expected = Object.fromEntries(
      Object.keys(pins).map((key) => [key, current[key]]),
    );
    assert.deepEqual(
      pins,
      expected,
      `${name} pins a build this tree no longer produces, and would fail at assertRuntime before reaching a single check. Re-pin it in the change that moved the build, or declare which release it belongs to.`,
    );
  }

  if (currentGates === 0) {
    // Normally this is a release-blocking failure: a current gate is what proves a live
    // build is runnable. R2 acceptance is the intentionally narrow exception while a live
    // channel is unavailable. Pin every affected script as stale rather than pretending a
    // metadata-only server move did not happen, then remove this branch when the one-pass
    // re-pin/run finishes.
    assert.equal(
      R2_ACCEPTANCE_REPIN_PENDING.length,
      10,
      "the R2 acceptance exception must name all ten affected scripts, including SVG/CROP",
    );
    assert.deepEqual(
      R2_ACCEPTANCE_REPIN_PENDING.filter(
        (name) => !Object.hasOwn(GATES_PINNED_TO_AN_EARLIER_RELEASE, name),
      ),
      [],
      "every R2 acceptance gate awaiting a channel must be declared stale rather than silently unrunnable",
    );
  } else {
    assert.ok(
      currentGates >= 1,
      "no live gate pins the current build — a release with no runnable gate is a release nobody can accept",
    );
  }
});
