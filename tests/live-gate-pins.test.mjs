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
  "live-batch-gate.mjs":
    "R2.6 Phase 1, schema 1.7.0 — PASSED on channel kw7qggwv, 2026-08-20. Item 2.0 moved every pin, so this needs re-pinning before its next run; it is NOT re-pinned here, because a gate re-pinned without being re-run is exactly the e02d1b2 defect.",
  // ⛔ Added by item 2.1, and it is the SECOND gate to land here for the same reason.
  // This one PASSED two days ago — 2026-08-22, channel 7l9ymck4, first run — against the
  // build 2.1 has just replaced. Its result stands for the build it ran on; what it can
  // no longer do is start. ⛔ It is deliberately NOT re-pinned in this change, because
  // this change cannot re-run it: re-pinning and re-running have to travel together, or
  // the pin becomes a claim nobody tested. Re-pin + re-run it in the same live session as
  // live-layout-gate.mjs, then delete this entry.
  "live-text-style-gate.mjs":
    "R2.6 item 2.0, schema 1.8.0 — PASSED on channel 7l9ymck4, 2026-08-22. Item 2.1 moved both build IDs, the fingerprint and the tool count (56 → 57); the schema HELD at 1.8.0, because a new tool is additive. Re-pin and re-run before its result is quoted against this tree.",
  // ⛔ THIRD, added by item 2.2 — and this one passed HOURS ago, twice, on the build 2.2
  // has just replaced. That it is the freshest result in the repo changes nothing: a gate
  // is stale when its pins stop describing the tree, not when its result gets old.
  // ⛔ Not re-pinned here, for the third time and the same reason: this change cannot
  // re-run it. Re-pinning and re-running travel together or the pin is a claim nobody
  // tested (`e02d1b2`).
  // ⚠️ THREE stale gates is now a backlog, not an incident. The owner's standing call of
  // 2026-08-22 is to re-pin and re-run the set ONCE after the layout tools land — 2.3 and
  // 2.4 are still outstanding, so that moment has not arrived.
  "live-layout-gate.mjs":
    "R2.6 item 2.1, schema 1.8.0 — PASSED on channel mzg3tlfl, 2026-08-22, run twice. Item 2.2 moved both build IDs and the fingerprint and took the tool count 57 → 58; the schema HELD at 1.8.0 again, because a new tool is additive. Re-pin and re-run before its result is quoted against this tree.",
  // ⛔ FOURTH, added by item 2.3 — and the pattern is now fully regular: each layout item
  // stales its predecessor's gate on the way in. This one passed on `2bcdtr5b` earlier the
  // same day.
  // ⚠️ The owner's standing call names THIS moment as the one that has not arrived yet:
  // re-pin and re-run the set ONCE after the layout tools land. 2.4 is still outstanding,
  // so the backlog goes to four rather than being worked now — re-pinning four gates in a
  // change that can only re-run one is four claims and one test.
  "live-constraints-gate.mjs":
    "R2.6 item 2.2, schema 1.8.0 — PASSED on channel 2bcdtr5b, 2026-08-22. Item 2.3 moved both build IDs and the fingerprint and took the tool count 58 → 59; the schema HELD at 1.8.0 again, because a new tool is additive. Re-pin and re-run before its result is quoted against this tree.",
  // ⛔ FIFTH, added by item 2.4 — and this is the entry that ENDS the pattern rather than
  // continuing it. 2.4 is the last of the four layout tools, so no sixth item will stale a
  // sixth gate. ⚠️ The owner's standing call named THIS moment: re-pin and re-run the set
  // ONCE after the layout tools land. That moment has now arrived, and the backlog is FIVE
  // rather than the four the plan predicted — 2.3's own gate joined it on the way out.
  // ⛔ Still not re-pinned here, for the fifth time and the same reason: this change can
  // only re-run one gate, and re-pinning five while running one is five claims and one
  // test (`e02d1b2`).
  "live-size-limits-gate.mjs":
    "R2.6 item 2.3, schema 1.8.0 — PASSED on channel o2vws4ph, 2026-08-22, run twice. Item 2.4 moved both build IDs and the fingerprint and took the tool count 59 → 60; the schema HELD at 1.8.0. ⚠️ Two independent changes moved serverBuildId here — the new tool, and the CC1 repair that walked 2.1/2.2/2.3 back to additive-preview. Re-pin and re-run before its result is quoted against this tree.",
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
