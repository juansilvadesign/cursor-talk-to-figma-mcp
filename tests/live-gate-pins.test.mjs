import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  // ✅ THE R2.6 BACKLOG IS CLEARED — 2026-08-22, channel `sa6ggz00`.
  //
  // Five entries lived here at once: `live-batch-gate.mjs` (R2.6 Phase 1),
  // `live-text-style-gate.mjs` (item 2.0), `live-layout-gate.mjs` (2.1),
  // `live-constraints-gate.mjs` (2.2) and `live-size-limits-gate.mjs` (2.3). Each layout
  // item staled its predecessor's gate on the way in, and each declined to re-pin, because
  // a change that can only re-run ONE gate cannot honestly re-pin five — that is five
  // claims and one test (`e02d1b2`). The owner's standing call was to do the set ONCE
  // after the layout tools landed. 2.4 was the last of them, so it was done: all five
  // re-pinned to the item 2.4 build and all five RE-RUN on one channel, each once, all
  // five green. Their entries are deleted rather than reworded — the declaration and the
  // run travelled together, which is the whole rule.
  //
  // ⭐ **A PIN EDIT DOES NOT MOVE THE BUILD, and that is what made a five-gate re-pin
  // possible in one pass.** The standing worry — recorded in MEMORY.md as "each re-pin
  // moves serverBuildId, so re-derive" — was WRONG, and it is worth naming because it is
  // what made the backlog look unworkable. `serverBuildId` is
  // `sha256(server.ts + contractPayload)` and `pluginBuildId` hashes
  // `code.js` + `ui.html` + `manifest.json` (`scripts/contract-lib.mjs:605`). `scripts/`
  // is hashed by NEITHER. So these five could never have staled each other; what staled
  // them was the *item* landing above them, every time.
  //
  // ⛔ The three entries above are a DIFFERENT case and stay: `live-export-gate.mjs`,
  // `live-create-page-gate.mjs` and `live-plugin-data-gate.mjs` belong to R2.1/R2.2/R2.4
  // and were never part of the R2.6 backlog. They are owed a re-pin and a re-run together
  // whenever their results are next quoted.
  //
  // 🔴 **AND THE BACKLOG IS BACK — all six, staled by R2.7 item 1.1 on 2026-08-23.**
  // `set_fill` moved BOTH build IDs (`r2-server-975ccb3ce8b9` → `r2-server-b8086c604b60`,
  // `r2-plugin-1eee5a6f3bd9` → `r2-plugin-d8537626e9db`) and the fingerprint
  // (`sha256:f229f6ec…` → `sha256:07e3fff4…`), which is the 2.1/2.2/2.3 shape: a new tool
  // is additive, so the schema HELD at `1.8.0`, but every pin below it moved.
  //
  // ⛔ NOT RE-PINNED, and that is the rule applying rather than an omission. A change that
  // can only re-run ONE gate cannot honestly re-pin six — that would be six claims and one
  // test, which is precisely the defect `e02d1b2` created and R2.6 Phase 1 had to repair.
  // R2.7 re-pins and re-runs the set ONCE at its end, exactly as R2.6 did after 2.4.
  //
  // ⚠️ The six were green on `sa6ggz00` against the R2.6-accepted build, and nothing about
  // that result is withdrawn — it is a result about a build this tree no longer produces.
  "live-batch-gate.mjs":
    "R2.6-accepted build, schema 1.8.0. Green on sa6ggz00; staled by R2.7 1.1 moving both build IDs. Re-pin and re-run with the R2.7 set.",
  "live-text-style-gate.mjs":
    "R2.6-accepted build, schema 1.8.0. Green on sa6ggz00; staled by R2.7 1.1 moving both build IDs. Re-pin and re-run with the R2.7 set.",
  "live-layout-gate.mjs":
    "R2.6-accepted build, schema 1.8.0. Green on sa6ggz00; staled by R2.7 1.1 moving both build IDs. Re-pin and re-run with the R2.7 set.",
  "live-constraints-gate.mjs":
    "R2.6-accepted build, schema 1.8.0. Green on sa6ggz00; staled by R2.7 1.1 moving both build IDs. Re-pin and re-run with the R2.7 set.",
  "live-size-limits-gate.mjs":
    "R2.6-accepted build, schema 1.8.0. Green on sa6ggz00; staled by R2.7 1.1 moving both build IDs. Re-pin and re-run with the R2.7 set.",
  "live-clips-content-gate.mjs":
    "R2.6-accepted build, schema 1.8.0. Green on sa6ggz00; staled by R2.7 1.1 moving both build IDs. Re-pin and re-run with the R2.7 set.",
  // `live-fill-gate` was the only gate pinned to the R2.7 item 1.1 build. Item 1.2 changes
  // the exported read shape and spends the 1.9.0 bump, so its runtime preflight must now
  // refuse rather than falsely presenting a 1.1 result as a 1.2 result. It joins the set for
  // the single end-of-R2.7 re-pin/re-run; this change has not exercised that earlier gate.
  "live-fill-gate.mjs":
    "R2.7 item 1.1 build, schema 1.8.0. Green before item 1.2; staled by item 1.2 changing the read shape and runtime pins. Re-pin and re-run with the R2.7 set.",
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

  assert.ok(
    currentGates >= 1,
    "no live gate pins the current build — a release with no runnable gate is a release nobody can accept",
  );
});
