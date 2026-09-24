import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertR33SlotStableFindings, classifyR33InstanceChildVerdict,
  classifyR33SlotCreateFrameVerdict, classifyR33SlotSetParentVerdict,
  isR33KnownStableFinding, KNOWN_G2_STABLE_TOOL_FINDINGS,
  KNOWN_STABLE_TOOL_FINDINGS,
} from "../scripts/r3.3-live-gate-lib.mjs";
import { buildContract } from "../scripts/contract-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = [
  "live-r3.3-component-authoring-gate.mjs",
  "live-r3.3-slots-gate.mjs",
  "live-r3.3-instance-child-gate.mjs",
  "live-clips-content-gate.mjs",
];

test("G1–G4 require disposable authorization before opening a client", async () => {
  for (const script of scripts) {
    const source = await readFile(path.join(root, "scripts", script), "utf8");
    const legacy = script === "live-clips-content-gate.mjs";
    const guard = source.indexOf(legacy
      ? 'if (options["disposable-target"] !== "true")'
      : "requireDisposableTarget(options");
    const client = source.indexOf(legacy ? "new Client(" : "runR33Gate(");
    assert.ok(guard >= 0 && client > guard, `${script} opens a client before the guard`);
    assert.match(source, /disposable-target=true/);
  }
  const g1 = await readFile(path.join(root, "scripts", scripts[0]), "utf8");
  assert.ok(g1.indexOf('if (!options["remote-instance-id"])') < g1.indexOf("runR33Gate("));
  const g3 = await readFile(path.join(root, "scripts", scripts[2]), "utf8");
  assert.match(g3, /tool: "set_opacity"[^\n]*renderWitness: true/);
  assert.match(g3, /export_node_as_image/);
});

test("G3 verdicts fail closed on false success and main-component leakage", () => {
  const classify = (values) => classifyR33InstanceChildVerdict({
    succeeded: false, error: "Figma refused", childMoved: false, mainMoved: false,
    ...values,
  });
  assert.equal(classify({ succeeded: true, childMoved: false }), "false_success");
  assert.equal(classify({ succeeded: true, childMoved: true, mainMoved: true }), "leaked_to_main");
  assert.equal(classify({ succeeded: true, childMoved: true }), "applied_as_override");
  assert.equal(classify({}), "refused_by_platform");
  assert.equal(classify({ error: "must be a frame" }), "refused_by_handler");
  assert.equal(classify({ childMoved: true }), "refused_but_mutated");
  assert.equal(classify({ childMoved: true, mainMoved: true }), "refused_but_mutated");
});

test("G3 allows only the measured resize_node stable-tool finding", () => {
  assert.deepEqual(KNOWN_STABLE_TOOL_FINDINGS, { resize_node: "false_success" });
  assert.equal(isR33KnownStableFinding("resize_node", "false_success"), true);
  assert.equal(isR33KnownStableFinding("resize_node", "applied_as_override"), false);
  assert.equal(isR33KnownStableFinding("set_fill_color", "false_success"), false);
});

test("G2 set_parent distinguishes preserved, reported, aliased, and dangling IDs", () => {
  const originalId = "10:1";
  const canonicalId = "I10:2;10:3;10:4";
  const alias = { resolves: true, id: canonicalId };
  const classify = (values) => classifyR33SlotSetParentVerdict({
    originalId, canonicalId, replyText: "Moved node 10:1 into Slot",
    originalIdLookup: alias, ...values,
  });
  assert.equal(classify({ canonicalId: originalId }), "id_preserved");
  assert.equal(classify({ replyText: `Moved node 10:1 into Slot as ${canonicalId}` }),
    "new_id_reported");
  assert.equal(classify({}), "new_id_unreported_original_is_alias");
  assert.equal(classify({ originalIdLookup: { resolves: false } }),
    "new_id_unreported_original_dangling");
  assert.equal(classify({ originalIdLookup: { resolves: true, id: "10:9" } }),
    "new_id_unreported_original_dangling");
  assert.equal(classify({ originalIdLookup: { resolves: false, id: canonicalId } }),
    "new_id_unreported_original_dangling");
});

test("G2 create_frame distinguishes canonical, alias, and wrong reply IDs", () => {
  const replyId = "10:5";
  const canonicalId = "I10:2;10:3;10:6";
  const classify = (values) => classifyR33SlotCreateFrameVerdict({
    replyId, canonicalId, replyIdLookup: { resolves: true, id: canonicalId },
    ...values,
  });
  assert.equal(classify({ replyId: canonicalId }), "reply_id_is_canonical");
  assert.equal(classify({}), "reply_id_is_alias");
  assert.equal(classify({ replyIdLookup: { resolves: false } }),
    "reply_id_not_created_node");
  assert.equal(classify({ replyIdLookup: { resolves: true, id: "10:9" } }),
    "reply_id_not_created_node");
  assert.equal(classify({ replyIdLookup: { resolves: false, id: canonicalId } }),
    "reply_id_not_created_node");
});

test("G2 allows only the measured stable-tool alias findings", () => {
  const measured = {
    set_parent: "new_id_unreported_original_is_alias",
    create_frame: "reply_id_is_alias",
  };
  assert.deepEqual(KNOWN_G2_STABLE_TOOL_FINDINGS, measured);
  assertR33SlotStableFindings(measured);
  assert.throws(() => assertR33SlotStableFindings({
    ...measured, set_parent: "new_id_unreported",
  }), /G2 stable-tool findings changed/);
  assert.throws(() => assertR33SlotStableFindings({
    ...measured, create_frame: "reply_id_not_created_node",
  }), /G2 stable-tool findings changed/);
  assert.throws(() => assertR33SlotStableFindings({ set_parent: measured.set_parent }),
    /G2 stable-tool findings changed/);
});

test("R3.3 adds exactly 16 preview tools while every frozen stable tool stays byte-identical", async () => {
  const [current, previous, plugin] = await Promise.all([
    readFile(path.join(root, "contracts/public-contract.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "contracts/baselines/r3.2.1-public-contract.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "src/cursor_mcp_plugin/code.js"), "utf8"),
  ]);
  const old = new Map(previous.tools.map((entry) => [entry.name, entry]));
  const additions = current.tools.filter((entry) => !old.has(entry.name));
  assert.deepEqual(additions.map((entry) => entry.name).sort(), [
    "get_component", "create_or_match_component", "create_component_from_node",
    "create_or_match_instance", "delete_component", "combine_as_variants",
    "add_component_property", "edit_component_property", "delete_component_property",
    "bind_component_property", "set_instance_properties", "swap_instance_component",
    "reset_instance_overrides", "detach_instance", "create_slot", "reset_slot",
  ].sort());
  for (const tool of additions) assert.equal(tool.resultStability, "additive-preview", tool.name);
  const rebuilt = await buildContract();
  const rebuiltByName = new Map(rebuilt.contract.tools.map((entry) => [entry.name, entry]));
  for (const tool of additions) {
    assert.equal(rebuiltByName.get(tool.name)?.resultStability, "additive-preview", tool.name);
  }
  const now = new Map(current.tools.map((entry) => [entry.name, entry]));
  for (const tool of previous.tools.filter((entry) => entry.resultStability === "stable")) {
    assert.equal(JSON.stringify(now.get(tool.name)), JSON.stringify(tool), tool.name);
  }
  assert.equal(current.publicContractVersion, "1.22.0");
  const batchBody = plugin.slice(plugin.indexOf("const BATCH_ALLOWED_COMMANDS"),
    plugin.indexOf("const BATCH_ALLOWED_COMMANDS") + 4000);
  for (const tool of additions) assert.doesNotMatch(batchBody, new RegExp(`"${tool.name}"`));
});
