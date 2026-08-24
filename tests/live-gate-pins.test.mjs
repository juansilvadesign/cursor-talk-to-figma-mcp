import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ✅✅ **THE R2 ACCEPTANCE RE-PIN IS DONE — 2026-08-24, channel `6cbroncs`.** All TEN were
// re-pinned to `r2-server-a0afdc880ab0` ↔ `r2-plugin-0ace9ed58f34`, schema 1.9.0,
// fingerprint `sha256:f636ecab…6142fc0`, 65 tools, and all ten RE-RUN once each on one
// channel. All ten PASSED. Their entries below are DELETED rather than reworded — the
// declaration and the run travelled together, which is the whole rule.
//
// ⚠️ The list that stood here (`R2_ACCEPTANCE_REPIN_PENDING`) and the `currentGates === 0`
// branch that consumed it are both gone: they existed only to describe a tree where no gate
// pinned the current build, and that is no longer this tree. A standing exception outlives
// its cause silently, which is the failure this file exists to catch.
//
// ⭐ The acceptance fixture ran FIRST, on 2026-08-23/channel `w113vf7y`, and it is what
// found the `set_effects` defect that this build fixes — two schema-`.optional()` fields
// Figma actually requires. The gates were green across that entire defect, because the only
// effect shapes they ever sent were the shapes that already worked. `live-effects-gate.mjs`
// now sends a minimal effect of each of the four types for exactly that reason.

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
  // ✅✅ **THE R3-A PHASE 1.2 RE-PIN IS DONE — 2026-08-24, channel `6a07fm2h`.** The same
  // TEN were re-pinned to `r3-a-server-0d303490d152` ↔ `r3-a-plugin-6ed0aab0ecdc`, schema
  // 1.10.0, fingerprint `sha256:b367651f…751279`, 66 tools, and RE-RUN once each on one
  // channel. **All ten PASSED**, each on a fresh scratch page of the six-page file
  // `SYD (SaveYourDay) - Spaceapps`, each restoring that baseline; a separate read after
  // the pass confirmed the file's own six pages. Their entries are DELETED rather than
  // reworded — the declaration and the run travelled together, which is the whole rule.
  //
  // ⭐ **The build this pass pinned is NOT the build Phase 1.2 first shipped.** The live
  // validation of `get_variable_capabilities` on channel `mlag5jfc` found that `isRemote`
  // could never be `true`: the inventory comes from `getLocalVariableCollectionsAsync()`,
  // which returns LOCAL collections only, so the field's observed `false` was its only
  // reachable value and `localCollectionCount` could never differ from `collectionCount`.
  // Fixing that (a declared `remoteCollectionInventoryAvailable: false` plus the limitation,
  // in every branch) moved BOTH ids off `12c88b765a45` ↔ `122b65ca30e9` BEFORE this re-pin —
  // ⛔ a plugin/server fix is sequenced before a re-pin, never after, or the set re-stales
  // and pays twice.
  //
  // ⭐ **A THIRD pin shape: both build IDs moved and the fingerprint HELD.** That fix
  // changed a public tool description and the result payload, yet `capabilityFingerprint`,
  // schema 1.10.0 and the 66-tool count were all byte-identical across it —
  // `scripts/contract-lib.mjs:591` hashes only `{serverSchemaVersion, capabilityIds}`, so
  // descriptions and result shapes are outside it by construction. R2.6 moved only the
  // server id; R3-A 1.1 moved only the plugin id; this moved both while the fingerprint
  // said "identical". The build IDs are again the only pin that caught it.
  //
  // ⭐ **The pins were proved CHECKED, not merely present.** A throwaway copy of
  // `live-clips-content-gate.mjs` pinned to `r3-a-plugin-000000000000` refused at
  // `assertRuntime` — exit 1, naming both ids, no scratch page created, the six-page file
  // untouched — and this very test went RED first, in the *stale declaration* direction:
  // with the ten re-pinned but still declared, it named `live-batch-gate.mjs` and refused.
  //
  // ⚠️ Three of the ten reports state "13 gate(s) are declared as pinned to an earlier
  // release". That was TRUE WHEN THEY RAN — these ten entries were still in this file. It
  // is 3 from here on. A count read out of a report is a reading of the tree at run time,
  // not a standing fact.
  // ✅✅ **THE R3-A PHASE 1.1 RE-PIN IS DONE — 2026-08-24, channel `chvza8ab`.** The same
  // TEN were re-pinned to `r2-server-a0afdc880ab0` ↔ `r2-plugin-a34d76fc6bc6`, schema
  // 1.9.0, fingerprint `sha256:f636ecab…6142fc0`, 65 tools, and RE-RUN once each on one
  // channel. **All ten PASSED**, each on a fresh scratch page, each restoring the file's own
  // six pages. Their entries are deleted rather than reworded — the declaration and the run
  // travelled together, which is the whole rule.
  //
  // ⭐ **A PIN SHAPE THIS FILE HAD NOT SEEN: only `pluginBuildId` moved.** Phase 1.1 adds
  // `hasVariableWriteApi()` to `code.js` and NO MCP tool, so `serverBuildId`, the schema,
  // the fingerprint AND the tool count all held — the exact inverse of R2.6 acceptance,
  // where only `serverBuildId` moved. ⛔ It is also the shape a fingerprint check waves
  // straight through, in the opposite direction from R2.6's: here the capability surface is
  // genuinely identical and the artifact RUNNING IN FIGMA is not, so the build ID is again
  // the only pin that can catch it.
  //
  // ⭐ **The DEV-plugin reload was MEASURED before the re-pin, not assumed** — live
  // `get_runtime_info` reported `plugin.buildId: "r2-plugin-a34d76fc6bc6"`, and all ten
  // reports record that same id against channel `chvza8ab`. ⛔ Never
  // `compatibility: "compatible"`, which only says the two RUNNING halves agree with each
  // other.
  //
  // 🔴 **And the pins were proved CHECKED, not merely present.** A throwaway copy of
  // `live-clips-content-gate.mjs` carrying `r2-plugin-000000000000` refused at
  // `assertRuntime` — exit 1, naming both ids, no baseline read, no scratch page created,
  // the six-page file untouched. Ten greens whose refusal leg was never fired would be a
  // measurement of the inputs, not of the pins.
  //
  // ─────────────────────────────────────────────────────────────────────────────────────
  //
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
  // ✅✅ **AND THE BACKLOG ROSE TO TEN AND WAS THEN CLEARED — 2026-08-24, `6cbroncs`.**
  // Phase 2's `set_image_fill` CROP repair re-staled the eight and pulled in a ninth
  // (`live-opacity-blend-gate.mjs`, until then never declared); the acceptance stability
  // promotion moved `serverBuildId` again and pulled in a tenth (`live-svg-crop-gate.mjs`).
  // All ten were re-pinned and re-run once each, on one channel, and all ten PASSED.
  //
  // ⚠️ Those ten were green on `3az2oicz`/`shtlklfy`/`sdg5mr5m` against builds this tree no
  // longer produces. Nothing about those results is withdrawn — they simply could not be
  // quoted forward, which is the entire reason this ledger exists.
  //
  // 🔴 **AND THE RE-RUN EARNED ITS KEEP.** The pass did not merely reproduce nine old greens:
  // `set_effects` was found broken FIRST by the acceptance fixture, not by any gate here, and
  // the fix moved `pluginBuildId` one more time before the re-pin. ⭐ Every gate had been
  // green straight through that defect, because a gate only ever sends the shapes its author
  // already knew worked. A green gate is evidence about ITS INPUTS.
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

  // ⚠️ The `R3_A_PHASE_1_2_REPIN_PENDING` set and the `currentGates === 0` branch that
  // consumed it are GONE, not commented out. They existed only to describe a tree in which
  // no gate pinned the current build, and after the 2026-08-24 re-pin/re-run on channel
  // `6a07fm2h` that is no longer this tree. A standing exception outlives its cause
  // silently, which is the failure this file exists to catch — the same deletion R3-A
  // Phase 1.1 made for the same reason.
  assert.ok(
    currentGates >= 1,
    "no live gate pins the current build — a release with no runnable gate is a release nobody can accept",
  );
});
