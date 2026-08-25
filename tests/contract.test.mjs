import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildContract,
  compatibilityErrors,
  parityErrors,
} from "../scripts/contract-lib.mjs";
import { comparePluginRuntimeMetadata } from "../src/talk_to_figma_mcp/runtime-compatibility.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("public snapshot remains backwards compatible and generated metadata is current", async () => {
  const built = await buildContract();
  const snapshot = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  );
  assert.deepEqual(parityErrors(built.surface), []);
  assert.deepEqual(compatibilityErrors(snapshot, built.contract), []);
  // 67 → 70 at R3-A Phase 2 (`set_variable_value`, `create_variable`, `delete_variable`),
  // then 70 → 71 at Phase 4 (`remove_variable_mode`), then 71 → 76 when Phase 2's remaining
  // table landed (`create_variable_collection`, `rename_variable_mode`,
  // `set_variable_metadata`, `bind_variable_to_node`, `bind_variable_to_paint`), then
  // 76 → 77 for the conservative collection-cleanup tool (`delete_variable_collection`),
  // then 77 → 80 for R3.1's three additive measurement enablers (`create_group`,
  // `set_range_font`, `set_fill_style`). The literal is a tripwire, not bookkeeping: it is here
  // so a tool arriving or vanishing cannot pass unremarked.
  assert.equal(snapshot.tools.length, 80);
  assert.equal(snapshot.prompts.length, 6);
  assert.ok(snapshot.tools.every((tool) => ["read", "write", "connection"].includes(tool.direction)));
  assert.ok(snapshot.tools.every((tool) => ["stable", "additive-preview", "legacy"].includes(tool.resultStability)));
  assert.ok(
    snapshot.tools.every((tool) =>
      ["local", "preflight", "standard", "heavy_read", "heavy_batch"].includes(
        tool.timeoutClass,
      ),
    ),
  );
});

test("parity guard is observed failing when a dispatcher command disappears", async () => {
  const built = await buildContract();
  const broken = {
    ...built.surface,
    pluginCommands: built.surface.pluginCommands.filter(
      (command) => command !== "get_document_info",
    ),
  };
  assert.match(parityErrors(broken).join("\n"), /get_document_info.*dispatcher/);
});

test("the current contract stays backwards compatible with every frozen release baseline", async () => {
  const built = await buildContract();
  const baselineDir = path.join(root, "contracts/baselines");
  const baselineFiles = (await readdir(baselineDir))
    .filter((name) => name.endsWith("-public-contract.json"))
    .sort();

  assert.ok(
    baselineFiles.length > 0,
    "at least one frozen release baseline must exist",
  );

  for (const file of baselineFiles) {
    const baseline = JSON.parse(
      await readFile(path.join(baselineDir, file), "utf8"),
    );
    assert.deepEqual(
      compatibilityErrors(baseline, built.contract),
      [],
      `current contract broke compatibility with ${file}`,
    );
  }
});

/**
 * ⛔ **CC1, MECHANISED — because for three consecutive items it was not.**
 *
 * `getResultStability` returns `stable` for any tool not named in
 * `ADDITIVE_PREVIEW_RESULTS`, and `compatibilityErrors()` refuses to weaken a level. That
 * is F6, which the R2 cut called its highest-leverage finding: an unlisted tool is frozen
 * the moment it ships, on a reply shape no live gate has judged. R2.5's two tools honoured
 * CC1. R2.6's `set_layout_child`, `set_constraints` and `set_size_limits` did not — all
 * three shipped `stable` from birth, and only 2.2's deviation was ever written down.
 *
 * ⭐ Nothing in `bun run verify` could have caught it, because a default that is silently
 * WRONG and a decision that is deliberately right produce byte-identical contracts. This
 * test is the difference: a tool may be `stable` only if a frozen baseline already carries
 * it — meaning it survived a release and an acceptance — or if it is named below as a
 * deliberate act.
 *
 * ⚠️ The list is expected to be EMPTY almost always. It fills for exactly one window: from
 * a release's acceptance (which promotes its tools) until the next release freezes that
 * contract as a baseline (which makes the promotion visible here). Names that linger past
 * that window are the smell.
 */
// ✅ **EMPTIED AT R2.7's OPENING ACT, 2026-08-23 — the CC3 debt is paid.** This list
// carried seven names: R2.5's `get_available_fonts` / `check_fonts` / `set_text_style`
// (promoted 2026-08-19 on `ohipqdhg`) and R2.6's four layout tools (promoted 2026-08-22 on
// `sa6ggz00`). All seven were `stable` by a decision that was made, recorded and earned —
// but with no frozen baseline vouching for any of them, because CC3's per-release freeze
// was skipped twice running and the gap widened 3 → 7 as a recorded choice.
//
// R2.7 freezes BOTH, as its first act rather than its last: `r2.5-public-contract.json`
// (from `e02d1b2`, the R2.5 acceptance commit — `1.7.0`, 56 tools) and
// `r2.6-public-contract.json` (from `36ba158`, the R2.6 acceptance commit — `1.8.0`, 60
// tools). Both are the contracts that were actually accepted, lifted from git, not
// reconstructions. `frozenToolNames()` now finds all seven, so the guard passes on the
// baselines themselves and this list has nothing left to excuse.
//
// ⚠️ **The R2.6 baseline is byte-identical to `contracts/public-contract.json` today**
// (`sha256:aebc8dfe…67d8b3`), so its replay is currently a tautology — it compares the
// contract to itself and cannot fail in either direction. Only the R2.5 baseline is a real
// check until `set_fill` moves the contract to `1.9.0`. ⛔ Do not read this release's green
// replay as evidence the R2.6 baseline works; it earns that on the next contract change.
//
// ⛔ **From here the seven are permanently `stable` and the walk-back is BREAKING** —
// `compatibilityErrors()` iterates the baseline's tools and rejects weakening a level by
// name, and now a baseline carries them. R2.6 was the last release in which the CC1 repair
// cost nothing; that window is closed by this file.
//
// ✅ **THE R3-A ACCEPTANCE FREEZE IS PAID — 2026-08-25, and this list is `[]` again.**
// `r3-a-public-contract.json` freezes `contracts/public-contract.json` at `R3-A` /
// `1.15.0` / 76 tools — the exact build that passed the **18-gate live pass** on channel
// `4k1jsjpo` (pair `r3-a-server-cfce6484d54a` ↔ `r3-a-plugin-07a616c3b48d`, fingerprint
// `sha256:5e6dcb91…9fee1af3`). ⭐ A baseline records the build that was LIVE-VALIDATED, not
// the tree's newest state, which is why the freeze was cut BEFORE the Phase 2 promotion
// rather than after it.
//
// That single act absorbed all TEN names this list used to carry — R2.7's five
// (`create_node_from_svg`, `set_blend_mode`, `set_effects`, `set_fill`, `set_opacity`) and
// R3-A's five (`add_variable_mode`, `create_variable`, `delete_variable`,
// `remove_variable_mode`, `set_variable_value`) — because they were never ten deliberate
// acts, only ONE missing freeze counted twice. As predicted, freezing moved no build ID
// (`contracts/baselines/` feeds neither `serverSource` nor `contractPayload`), so all
// eighteen live gates stayed pinned and their pass stayed valid across this commit.
//
// ⭐ **THE FREEZE ALSO PRE-AUTHORISES THE PHASE 2 PROMOTION, and that is why the order
// matters.** `frozenToolNames()` collects every tool name a baseline carries *regardless of
// its `resultStability`*, so the five Phase 2 tools — `create_variable_collection`,
// `rename_variable_mode`, `set_variable_metadata`, `bind_variable_to_node`,
// `bind_variable_to_paint` — are `everFrozen` from this baseline while still recorded in it
// as `additive-preview`. Promoting them to `stable` therefore passes CC1 with this list
// EMPTY. ⛔ Had the promotion been done first, all five would have had to be re-added here,
// recreating the exact debt the freeze just cleared.
//
// ⛔ **Keep this list empty.** A new tool ships `additive-preview` (add it to
// `ADDITIVE_PREVIEW_RESULTS` in the same commit that registers it); promotion is an
// acceptance act that a frozen baseline must already vouch for. Re-adding a name here is
// borrowing against the next freeze, and the comment above is what that debt looks like
// after two releases of interest.
const ACCEPTED_SINCE_LAST_BASELINE = [];

async function frozenToolNames() {
  const baselineDir = path.join(root, "contracts/baselines");
  const baselineFiles = (await readdir(baselineDir)).filter((name) =>
    name.endsWith("-public-contract.json"),
  );
  const names = new Set();
  for (const file of baselineFiles) {
    const baseline = JSON.parse(
      await readFile(path.join(baselineDir, file), "utf8"),
    );
    for (const tool of baseline.tools) names.add(tool.name);
  }
  return names;
}

/** The guard itself, so the test below can run it against a contract it has mutated. */
function bornFrozenTools(contract, everFrozen) {
  return contract.tools
    .filter((tool) => tool.resultStability === "stable")
    .map((tool) => tool.name)
    .filter(
      (name) =>
        !everFrozen.has(name) && !ACCEPTED_SINCE_LAST_BASELINE.includes(name),
    );
}

test("a tool may only be `stable` once a frozen baseline carries it (CC1 / F6)", async () => {
  const built = await buildContract();
  const everFrozen = await frozenToolNames();
  assert.ok(everFrozen.size > 0, "at least one frozen baseline must exist");

  const bornFrozen = bornFrozenTools(built.contract, everFrozen);
  assert.deepEqual(
    bornFrozen,
    [],
    `these tools ship \`stable\` without ever having faced a release: ${bornFrozen.join(
      ", ",
    )}. Per CC1 every new tool ships \`additive-preview\` — add it to ADDITIVE_PREVIEW_RESULTS in the same commit that registers it. Promotion is an acceptance act, and once a baseline freezes the \`stable\` level the walk-back is breaking.`,
  );
});

test("the CC1 guard is observed FAILING when a new tool falls through to `stable`", async () => {
  // ⛔ A guard nobody has watched fail is a guard nobody has tested — and this one has to
  // be watched, because the defect it pins was invisible for three items precisely by
  // producing a contract that looks correct. So the guard is RUN against a contract
  // mutated into the exact shape it exists to catch, rather than re-stating its condition.
  // 🔴 This test used to name `set_clips_content` as its victim and assert that tool was
  // `additive-preview` — an instrument pinned to the IMPLEMENTATION rather than to the
  // question. R2.6 acceptance promoted `set_clips_content` to `stable`, which is exactly
  // the change the guard exists to permit, and the meta-test failed on it: a correct act
  // made the probe declare itself worthless. Worse, after that promotion NO real tool is
  // both `additive-preview` and absent from every baseline, so there was no replacement
  // victim to name — re-pointing it at another tool would only reset the same trap.
  //
  // ⭐ The fix is to stop borrowing a real tool at all. The victim is SYNTHESIZED: a name
  // no baseline can ever carry, injected as `stable`. That encodes the question — "does
  // the guard name a tool that fell through the default?" — and it cannot be falsified by
  // any future promotion. See feedback_an_instrument_pinned_to_the_implementation.
  const built = await buildContract();
  const everFrozen = await frozenToolNames();

  const victimName = "__cc1_probe_tool_that_no_baseline_carries__";
  assert.ok(
    !everFrozen.has(victimName),
    "the synthesized victim must be absent from every baseline, or this test proves nothing",
  );

  const fellThrough = structuredClone(built.contract);
  fellThrough.tools.push({
    ...built.contract.tools[0],
    name: victimName,
    resultStability: "stable",
  });

  assert.deepEqual(
    bornFrozenTools(fellThrough, everFrozen),
    [victimName],
    "the guard must name the tool that fell through the default",
  );

  // ⛔ And the negative leg, or the test above passes for a guard that flags EVERYTHING:
  // the same synthesized tool at `additive-preview` must NOT be reported.
  const compliant = structuredClone(built.contract);
  compliant.tools.push({
    ...built.contract.tools[0],
    name: victimName,
    resultStability: "additive-preview",
  });
  assert.deepEqual(
    bornFrozenTools(compliant, everFrozen),
    [],
    "the guard must not flag a new tool that correctly ships additive-preview",
  );
});

test("result stability may be strengthened across releases but never weakened", async () => {
  const snapshot = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  );

  const strengthened = structuredClone(snapshot);
  const promoted = strengthened.tools.find(
    (tool) => tool.name === "get_node_variables",
  );
  assert.equal(promoted.resultStability, "additive-preview");
  promoted.resultStability = "stable";
  assert.deepEqual(compatibilityErrors(snapshot, strengthened), []);

  const weakened = structuredClone(snapshot);
  weakened.tools.find((tool) => tool.name === "get_node_variables").resultStability =
    "legacy";
  assert.match(
    compatibilityErrors(snapshot, weakened).join("\n"),
    /get_node_variables\.resultStability was weakened/,
  );
});

test("every read whose cost scales with the file declares the heavy budget", async () => {
  // R1's live gate found export_node_as_image running on the 30s default while every
  // other cost-scaling read declared the heavy class — and 30s is precisely the budget
  // the multi-megabyte exports filePath exists for will exceed. get_node_variables is
  // here for the same reason: a bounded scan of up to 5000 nodes is still not a 30s job.
  const built = await buildContract();
  const byName = new Map(built.contract.tools.map((tool) => [tool.name, tool]));

  for (const name of [
    "get_document_info",
    "get_pages",
    "get_styles",
    "get_local_components",
    "export_node_as_image",
    "get_node_variables",
  ]) {
    assert.equal(
      byName.get(name).timeoutClass,
      "heavy_read",
      `${name} must declare the heavy read budget`,
    );
  }
});

test("export declares its bounded cost preflight and explicit large-request override", async () => {
  const built = await buildContract();
  const exported = built.contract.tools.find(
    (tool) => tool.name === "export_node_as_image",
  );

  assert.equal(exported.progress.pluginUpdates, "preflight_and_encoding");
  assert.deepEqual(exported.inputSchema.properties.allowLargeExport, {
    type: "boolean",
    default: false,
    description:
      "Explicitly accept the risk of a PNG/JPG export above the 16 MP safety ceiling (default: false). A timed-out Figma export cannot be cancelled and may leave the plugin unresponsive; prefer reducing scale or exporting a smaller node.",
  });
  assert.ok(
    !exported.inputSchema.required.includes("allowLargeExport"),
    "existing callers must remain valid and receive the safe default",
  );
});

test("a timeout budget may be raised across releases but never lowered", async () => {
  const snapshot = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  );

  // Raising is what R2 did to export_node_as_image. It cannot break a consumer that
  // was already prepared to wait less, so the guard must allow it.
  const raised = structuredClone(snapshot);
  const raisedTool = raised.tools.find((tool) => tool.name === "get_node_info");
  assert.equal(raisedTool.timeoutClass, "standard");
  raisedTool.timeoutClass = "heavy_read";
  assert.deepEqual(compatibilityErrors(snapshot, raised), []);

  // Lowering is the real break: a call that used to finish starts timing out.
  const lowered = structuredClone(snapshot);
  lowered.tools.find((tool) => tool.name === "get_styles").timeoutClass =
    "standard";
  assert.match(
    compatibilityErrors(snapshot, lowered).join("\n"),
    /get_styles\.timeoutClass was lowered/,
  );
});

test("snapshot guard rejects removals and incompatible parameters but accepts additive optional fields", async () => {
  const snapshot = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  );
  const broken = structuredClone(snapshot);
  const nodeInfo = broken.tools.find((tool) => tool.name === "get_node_info");
  delete nodeInfo.inputSchema.properties.nodeId;
  assert.match(compatibilityErrors(snapshot, broken).join("\n"), /nodeId was removed/);

  const additive = structuredClone(snapshot);
  additive.tools
    .find((tool) => tool.name === "get_node_info")
    .inputSchema.properties.preview = { type: "boolean" };
  assert.deepEqual(compatibilityErrors(snapshot, additive), []);
});

test("README tool and prompt names exactly match the generated inventory", async () => {
  const [built, readme] = await Promise.all([
    buildContract(),
    readFile(path.join(root, "README.md"), "utf8"),
  ]);
  const toolsSection = readme.split("## MCP Tools")[1]?.split("## Development")[0];
  assert.ok(toolsSection, "README must contain an MCP Tools section");
  const [toolText, promptText = ""] = toolsSection.split("### MCP Prompts");
  const extract = (text) =>
    [...text.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]).sort();
  assert.deepEqual(
    extract(toolText),
    built.contract.tools.map((tool) => tool.name).sort(),
  );
  assert.deepEqual(
    extract(promptText),
    built.contract.prompts.map((prompt) => prompt.name).sort(),
  );
});

test("the direct plugin runtime parses independently of the server build", () => {
  const result = spawnSync(
    process.execPath,
    ["--check", "src/cursor_mcp_plugin/code.js"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("runtime preflight accepts the exact pair and rejects stale or incomplete plugins", async () => {
  const { runtime } = await buildContract();
  const plugin = {
    buildId: runtime.pluginBuildId,
    apiVersion: runtime.pluginApiVersion,
    serverSchemaVersion: runtime.serverSchemaVersion,
    relayProtocolVersion: runtime.relayProtocolVersion,
    capabilityFingerprint: runtime.capabilityFingerprint,
    supportedCommands: [...runtime.supportedCommands],
  };
  const compatible = comparePluginRuntimeMetadata(
    runtime,
    plugin,
    "2026-08-07T00:00:00.000Z",
  );
  assert.equal(compatible.status, "compatible");
  assert.deepEqual(compatible.issues, []);

  const stale = comparePluginRuntimeMetadata(runtime, {
    ...plugin,
    buildId: "old-plugin",
    capabilityFingerprint: "sha256:old",
    supportedCommands: plugin.supportedCommands.filter(
      (command) => command !== "get_runtime_info",
    ),
  });
  assert.equal(stale.status, "incompatible");
  assert.match(stale.issues.join("\n"), /Plugin build mismatch/);
  assert.match(stale.issues.join("\n"), /Capability fingerprint mismatch/);
  assert.match(stale.issues.join("\n"), /missing commands: get_runtime_info/);
});
