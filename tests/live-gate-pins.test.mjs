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
// ✅✅ **THE SIXTEEN-GATE RE-PIN IS DONE — 2026-08-24, channel `qsacbwae`.** Every live gate
// that pins a build was re-pinned to `r3-a-server-c4d037a645e3` ↔ `r3-a-plugin-fe0b1e03325c`,
// schema 1.14.0, fingerprint `sha256:edf5e2e9…cab57a37`, 71 tools, and RE-RUN once each on one
// channel. Their entries are DELETED rather than reworded — the declaration and the run
// travelled together, which is the whole rule. **This ledger is now EMPTY for the first time
// since R2.1**: every gate in `scripts/` pins the build this tree produces.
//
// ⭐ **The set was SIXTEEN, not fifteen, and the sixteenth was created by this release.**
// R3-A Phase 4 moved both build ids beneath `live-variable-identity-gate.mjs` — the tree's one
// current-build gate an hour before — so a gate that had just passed twice became unrunnable
// and joined the set it was never meant to be in. ⛔ Shipping a phase re-stales every gate,
// including the one that accepted the phase before it.
//
// ⭐ **The three older R2.1/R2.2/R2.4 gates were folded in here after being declined TWICE.**
// Both refusals rested on *"it costs a gate re-run"* — a re-run that Phase 3 had already made
// unavoidable, so the stated price had fallen to zero. ⛔ Re-read a cost-based refusal
// whenever the build moves; the argument does not have to change for the answer to.
//
// ⭐ **The pins were proved CHECKED in BOTH directions, in this same pass.**
// (1) *Stale declaration*: with all sixteen re-pinned but still declared, this very test went
// RED and named `live-batch-gate.mjs`. (2) *assertRuntime*: a throwaway copy of
// `live-clips-content-gate.mjs` carrying `r3-a-plugin-000000000000` exited **1** naming both
// ids (expected `000000000000`, received `fe0b1e03325c`), and a separate read confirmed the
// document still held its **25** pages — the refusal fired before touching anything. The copy
// was then deleted. Sixteen greens whose refusal leg was never fired would be a set of
// unfired assertions.
//
// 🔴 **`live-variable-mode-gate.mjs` needed its precondition REBUILT before it could run, and
// the Phase 4 cleanup is what removed it.** That gate requires a collection already AT the
// mode ceiling, because Figma's refusal is its evidence — and Phase 4 had just taken
// *"8. Dimensions"* from 10 modes to 4. It was re-inflated 4 → 10 with `add_variable_mode`,
// run, then returned to 4 with `remove_variable_mode`. ⛔ A gate whose evidence is a platform
// LIMIT depends on document state that other work can silently destroy; net-zero re-inflation
// is only possible because Phase 4 shipped the tool that reverses it.
//
// 🔴 **FOUR OF THE SIXTEEN FAILED ON THE FIRST PASS, AND NOT ONE WAS A TOOL DEFECT.** All
// four were defects in the GATES, invisible until something forced them to run:
//   ① `live-export-gate` + `live-create-page-gate` asserted `runtime.server.release === "R2"`.
//      The re-pin script updated the five keys `readPins` parses; `release` is a SIXTH pin
//      these two also assert, so both refused at assertRuntime.
//   ② `live-plugin-data-gate` carried the SAME stale `release: "R2"` and PASSED — because it
//      declares the pin and never asserts it. ⛔ A pin nothing reads cannot go stale loudly:
//      it looks like coverage and provides none. The assertion was added here.
//   ③ `live-variable-write-gate` asserted `create_variable`'s description matches
//      /not an upsert/i — the Phase 2 contract. Phase 3 DELIBERATELY made it a create-or-match
//      resolver, so the gate contradicted the shipped tool. Replaced with /Resolution is fixed/
//      and /never falls through to create/, both of which are ABSENT from the Phase 2
//      description (`git show fc65db5`), so the new assertion discriminates the two contracts
//      rather than matching whatever is present — the known-bad leg a changed assertion owes.
//   ④ `live-export-gate` hardcoded `nodeId = "1113:5031"`, a node in ANOTHER document, plus a
//      fixed over-limit scale of 3 that only exceeds the 16 MP ceiling for nodes above
//      ~1.78 MPx. It now takes `--node-id` and DERIVES the over-limit scale from the node's
//      measured bounds, then asserts the platform's own reported ceiling matches the one the
//      derivation assumed. ⛔ A gate bound to one file's node ids can only ever be re-run
//      against that file.
//
// ⚠️ **THE SIXTEEN DO NOT SHARE ONE VERDICT PROTOCOL — three shapes, and reading the wrong
// one mislabels a clean run.** 15 write `success: true` into `report.json`;
// `live-batch-gate` does too but prints NO `PASSED` line, so its exit 0 is not a verdict; and
// `live-export-gate` writes NO `success` field at all — its verdict is exit 0 plus
// `failure: null`. A runner that reads only `success` scores a passing export gate as FAIL
// forever. Read each gate's own signal, or normalise the protocol before trusting a tally.
// ✅✅ **THE NINETEEN-GATE RE-PIN + RE-RUN IS PAID — 2026-08-25, channel `wi3cjzy3`.** The
// `get_variable_capabilities` stability promotion moved `serverBuildId`
// `r3-a-server-7839c39d5302` → **`r3-a-server-d0897984aeb6`** and the fingerprint
// `sha256:34d09270…` → `sha256:b67c85d4…`, staling all nineteen — including the capabilities
// gate that had just passed twice, because shipping a phase re-stales the gate that accepted
// the phase before it. All nineteen were re-pinned in one pass and **RE-RUN once each — ALL
// NINETEEN PASSED**, verdicts read from each `report.json` by its own protocol. The document
// was confirmed byte-identical afterwards from a separate client session: 25 pages with no
// scratch leftovers, all 9 collections at their original mode counts, `knownGoodAtLeast` back
// to 4, current page restored.
//
// ⭐ **A FOURTH PIN SHAPE, AND THE BUILD ID IS BLIND TO IT BY CONSTRUCTION.** This promotion
// changed `code.js` — its generated metadata block now reads `apiVersion: "1.17.0"` and the
// new fingerprint — while `pluginBuildId` **HELD** at `r3-a-plugin-07a616c3b48d`, because
// that id hashes the file with the metadata block STRIPPED. So the operator consequence is
// *reload the DEV plugin AND respawn the server*, and no pin in `expectedRuntime` can tell
// you that: `pluginBuildId` is identical on both sides of an incompatible pair.
// 🔴 **MEASURED, not reasoned.** Running the capabilities gate against the un-reloaded
// plugin refused at `join_channel` — earlier than `assertRuntime` — with
// `Plugin API mismatch: expected 1.17.0, received 1.16.0` and
// `plugin=r3-a-plugin-07a616c3b48d, compatibility=incompatible`. The server's own preflight
// caught it on `apiVersion` + `capabilityFingerprint`; the build id agreed with itself the
// whole time.
//
// 🔴 **`live-variable-mode-gate` NEEDED ITS PRECONDITION REBUILT AGAIN, and this is the
// second time.** Its evidence is a platform LIMIT, so it requires a collection already AT the
// ceiling — and the file had drifted to *"7. Grids"* 4 / *"8. Dimensions"* 3. "7. Grids" was
// inflated 4 → 10 with `add_variable_mode` (six named `_gatefill_*` modes, ids recorded), the
// gate run — Figma refused verbatim `in addMode: Limited to 10 modes only`, `modeCeiling
// {value:10, status:"observed"}` — then returned to 4 by removing exactly those six recorded
// ids, zero failures. ⛔ Net-zero is only possible because the fork ships the tool that
// reverses it; a gate whose evidence is a platform limit depends on document state that
// ordinary work silently destroys.
//
// ⚠️ **THE VERDICT-PROTOCOL SPLIT IS REAL AND IT FIRED THIS RUN.** 18 of the 19 were read
// from `report.json` `success`; `live-export-gate` writes NO `success` field and was read as
// exit 0 + `failure: null`. A runner keyed only on `success` would have scored a passing
// export gate as FAIL — the failure this file's older comment predicted, now observed.
// ✅✅ **THE TWENTY-GATE RE-PIN + RE-RUN IS PAID — 2026-08-25, channel `2v56aacl`.**
// `delete_variable_collection` moved the release to `r3-a-server-b5649366daef` ↔
// `r3-a-plugin-7f0d5389634e`, schema 1.18.0, fingerprint `sha256:de4144fe…999e9`, 77 tools;
// every prior gate was therefore re-pinned and re-run once, while the new dedicated deletion
// gate became #20. **ALL TWENTY PASSED.** Its bad-pin proof came first: a throwaway copy with
// `r3-a-plugin-000000000000` exited 1 at `assertRuntime`, with no baseline/creation check in
// its report, so the green run cannot be mistaken for an unfired refusal assertion.
//
// 🔴 **The ceiling gate's precondition was rebuilt and paid back in this run.** "7. Grids"
// went 4 → 10 via six recorded short-name modes; Figma refused `in addMode: Limited to 10
// modes only`; then exactly those six ids were removed, restoring the original four modes.
// A separate final client compared all nine collection summaries against the pre-run baseline
// and confirmed 25 pages with current page `0:1`. The new deletion gate and the
// collections/bindings opt-in leg both observed owned-collection absence through the independent
// local collection inventory.

// ✅✅ **R3.1 RE-PIN + RE-RUN IS PAID — 2026-08-26, channel `o7plmvfm`.** The three
// measurement-enabler gates (`create_group`, `set_range_font`, and `set_fill_style`) all
// passed on the owner-confirmed disposable file. Every twenty historical runner was then
// re-pinned to `r3.1-server-beff31768985` ↔ `r3.1-plugin-ed16fbb94fa9`, schema `1.19.0`,
// fingerprint `sha256:69007c…02d576d`, and re-run once; all twenty passed. The full current
// pinned roster is therefore **23/23 green**. A separate final client read confirmed the
// baseline: 25 pages, current page `0:1`, and all nine local collections at their original
// mode counts. The ceiling gate's six temporary modes were removed explicitly after its run.
//
// R3.2 changes both halves of the runtime and adds a style-resource lifecycle. None of the
// twenty-three earlier gates has been re-run on that pair, so each is explicitly historical
// rather than silently re-pinned. Replacing their pins without executing them would fabricate
// live evidence. The new R3.2 gate below is current and *pending*, which makes it runnable
// without claiming it has passed.
const GATES_PINNED_TO_AN_EARLIER_RELEASE = Object.freeze({
  "live-batch-gate.mjs": "R3.1",
  "live-clips-content-gate.mjs": "R3.1",
  "live-constraints-gate.mjs": "R3.1",
  "live-create-page-gate.mjs": "R3.1",
  "live-effects-gate.mjs": "R3.1",
  "live-export-gate.mjs": "R3.1",
  "live-fill-gate.mjs": "R3.1",
  "live-layout-gate.mjs": "R3.1",
  "live-opacity-blend-gate.mjs": "R3.1",
  "live-plugin-data-gate.mjs": "R3.1",
  "live-r3.1-fill-style-gate.mjs": "R3.1",
  "live-r3.1-group-gate.mjs": "R3.1",
  "live-r3.1-range-font-gate.mjs": "R3.1",
  "live-size-limits-gate.mjs": "R3.1",
  "live-svg-crop-gate.mjs": "R3.1",
  "live-text-style-gate.mjs": "R3.1",
  "live-variable-capabilities-gate.mjs": "R3.1",
  "live-variable-collection-delete-gate.mjs": "R3.1",
  "live-variable-collections-bindings-gate.mjs": "R3.1",
  "live-variable-identity-gate.mjs": "R3.1",
  "live-variable-mode-gate.mjs": "R3.1",
  "live-variable-mode-removal-gate.mjs": "R3.1",
  "live-variable-write-gate.mjs": "R3.1",
});

const GATES_PENDING_LIVE_ACCEPTANCE = Object.freeze({
  "live-r3.2-local-style-authoring-gate.mjs": "R3.2 local-style authoring",
});

function readPins(source) {
  const block = /const expectedRuntime = \{([\s\S]*?)\n\};/.exec(source);
  if (!block) return null;
  const pins = {};
  // ⛔ `release` JOINED THIS LIST 2026-08-25, and the gap it closes was real. `readPins`
  // parsed five keys; `live-export-gate` and `live-create-page-gate` ALSO assert
  // `runtime.server.release` in their own assertRuntime. So this test reported "every live
  // gate pins THIS build" while both were pinned to `release: "R2"` and would refuse before
  // reaching a single check — and the sixteen-gate re-run is what found it, not this test.
  // A pins check only covers the pins it PARSES.
  for (const key of ["serverBuildId", "pluginBuildId", "schemaVersion", "fingerprint", "release"]) {
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
    release: runtime.release,
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
    const pending = Object.hasOwn(GATES_PENDING_LIVE_ACCEPTANCE, name);

    assert.equal(
      declared && pending,
      false,
      `${name} cannot be both historical and pending current acceptance`,
    );

    if (declared) {
      assert.equal(
        matches,
        false,
        `${name} is declared as pinned to an earlier release, but its pins match this build. Re-run it and remove the declaration — a stale declaration makes a current gate look untrustworthy.`,
      );
      continue;
    }

    if (pending) {
      assert.equal(
        matches,
        true,
        `${name} is pending live acceptance but is not runnable against this exact build. Regenerate its pins; do not mark it passed.`,
      );
      currentGates += 1;
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

test("the R3.2 local-style gate is explicitly disposable-only and pending live acceptance", async () => {
  const source = await readFile(
    path.join(root, "scripts", "live-r3.2-local-style-authoring-gate.mjs"),
    "utf8",
  );
  assert.match(source, /--disposable-target=true/);
  assert.match(source, /requireDisposableTarget\(/);
  assert.match(source, /owner-confirmed disposable Figma file/);
  assert.match(source, /no allow-permanent mode/);
  assert.match(source, /independent client/i);
  assert.ok(
    Object.hasOwn(
      GATES_PENDING_LIVE_ACCEPTANCE,
      "live-r3.2-local-style-authoring-gate.mjs",
    ),
  );
});

// ⛔ THE LIST IS DERIVED, NOT ENUMERATED — and it used to be enumerated, naming four files.
// A hardcoded roster cannot fail for the one case that matters: a NEW variable gate that
// forgot the acknowledgement is simply absent from the list, so the test passes by not
// looking. Same family as `readPins` parsing five keys while a sixth went stale unnoticed —
// a check only covers what it ENUMERATES, so enumerate the SLOT, not the known members.
test("every R3-A variable live gate requires an explicit disposable-target acknowledgement", async () => {
  const entries = await readdir(path.join(root, "scripts"));
  const variableGates = entries.filter(
    (name) => name.startsWith("live-variable-") && name.endsWith(".mjs"),
  );
  assert.ok(
    variableGates.length >= 5,
    `expected the R3-A variable gates to be discoverable, found ${variableGates.length}`,
  );

  for (const name of variableGates) {
    const source = await readFile(path.join(root, "scripts", name), "utf8");
    assert.match(source, /--disposable-target=true/, `${name} must document the flag`);
    assert.match(
      source,
      /options\["disposable-target"\] !== "true"/,
      `${name} must REFUSE to run without the acknowledgement, not merely document it`,
    );
    assert.match(source, /disposable Figma file/, `${name} must say why`);
  }
});

// ⛔ A gate whose `expectedRuntime` block is renamed, reformatted past the regex, or deleted
// vanishes from the pins check in SILENCE — `readPins` returns null and the loop `continue`s.
// The test above cannot see that; this one can, because it counts.
test("every live gate except live-smoke publishes pins this test can parse", async () => {
  const entries = await readdir(path.join(root, "scripts"));
  const gateFiles = entries.filter(
    (name) => name.startsWith("live-") && name.endsWith(".mjs"),
  );
  const parsed = [];
  const unparsed = [];
  for (const name of gateFiles) {
    const pins = readPins(await readFile(path.join(root, "scripts", name), "utf8"));
    (pins ? parsed : unparsed).push(name);
  }

  assert.deepEqual(
    unparsed,
    ["live-smoke.mjs"],
    "live-smoke asserts no build and is the ONLY gate allowed to publish no pins",
  );
  // ⚠️ A literal, so a gate that stops being pinned cannot pass as a shorter list. 17 at the
  // 2026-08-25 re-pin; 18 once the collections/bindings gate landed in the same change; 19
  // once `live-variable-capabilities-gate.mjs` gave `get_variable_capabilities` the scripted
  // verdict it had been promoted-blocked on; 20 once `delete_variable_collection` gained its
  // dedicated disposable-file deletion-and-restoration gate; 23 when R3.1 added its three
  // dedicated measurement-enabler gates; 24 when R3.2 added its explicitly pending
  // local-style lifecycle gate.
  assert.equal(
    parsed.length,
    24,
    `expected 24 pinned live gates, found ${parsed.length}: ${parsed.join(", ")}`,
  );
});
