/**
 * R2.7 item 1.3 — node-layer opacity and blend mode.
 *
 * 1.2 already spent the only R2.7 public-contract bump. The important assertion here is
 * therefore twofold: these stable write tools retain direct read-back receipts, and neither
 * property leaks into stable get_node_info as a side effect.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildContract } from "../scripts/contract-lib.mjs";
import {
  EXCLUDED_BATCH_OPERATIONS,
  V1_BATCH_OPERATIONS,
} from "../src/talk_to_figma_mcp/batch-receipt.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const TARGET = "10:3"; // RECTANGLE, explicitly seeded as opacity 1 / NORMAL in the fixture
const ROOT = "0:0"; // DOCUMENT, deliberately outside BlendMixin

const LAYER_BLEND_MODES = [
  "PASS_THROUGH",
  "NORMAL",
  "DARKEN",
  "MULTIPLY",
  "LINEAR_BURN",
  "COLOR_BURN",
  "LIGHTEN",
  "SCREEN",
  "LINEAR_DODGE",
  "COLOR_DODGE",
  "OVERLAY",
  "SOFT_LIGHT",
  "HARD_LIGHT",
  "DIFFERENCE",
  "EXCLUSION",
  "HUE",
  "SATURATION",
  "COLOR",
  "LUMINOSITY",
];

test("set_opacity preserves a real zero and reports the node's post-write reading", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_opacity", {
    nodeId: TARGET,
    opacity: 0,
  });

  assert.equal(result.id, TARGET);
  assert.equal(result.type, "RECTANGLE");
  assert.equal(result.previousOpacity, 1);
  assert.equal(result.previousOpacityReadable, true);
  assert.equal(result.opacity, 0, "zero is a write, not a missing value");
  assert.equal(result.opacityReadable, true);
  assert.equal(result.changed, true);
  assert.equal(harness.getNode(TARGET).opacity, 0);
});

test("set_opacity is a read-back, not an echo", async () => {
  // Instrument, not a claim about Figma: a setter which accepts and discards the value
  // makes a private echo observably wrong without assuming any platform normalization.
  const harness = await loadPluginHarness({ ignoreOpacityWrites: [TARGET] });
  const result = await harness.command("set_opacity", {
    nodeId: TARGET,
    opacity: 0.35,
  });

  assert.equal(result.previousOpacity, 1);
  assert.equal(result.opacity, 1, "the receipt must report the value still on the node");
  assert.equal(result.changed, false);
  assert.equal(harness.getNode(TARGET).opacity, 1);
});

test("set_opacity refuses invalid input and nodes without the opacity surface before writing", async () => {
  const harness = await loadPluginHarness();
  const before = harness.getNode(TARGET).opacity;

  for (const opacity of [undefined, -0.01, 1.01, Infinity, "0.5"]) {
    await assert.rejects(
      () => harness.command("set_opacity", { nodeId: TARGET, opacity }),
      /requires opacity to be a finite number from 0 to 1/,
    );
    assert.equal(harness.getNode(TARGET).opacity, before);
  }

  await assert.rejects(
    () => harness.command("set_opacity", { nodeId: ROOT, opacity: 0.5 }),
    /DOCUMENT and does not support layer opacity/,
  );
  assert.equal("opacity" in harness.getNode(ROOT), false);
});

test("set_blend_mode accepts every published layer mode, including PASS_THROUGH", async () => {
  const harness = await loadPluginHarness();

  let previous = "NORMAL";
  for (const blendMode of LAYER_BLEND_MODES) {
    const result = await harness.command("set_blend_mode", { nodeId: TARGET, blendMode });
    assert.equal(result.previousBlendMode, previous);
    assert.equal(result.previousBlendModeReadable, true);
    assert.equal(result.blendMode, blendMode);
    assert.equal(result.blendModeReadable, true);
    assert.equal(result.changed, previous !== blendMode);
    previous = blendMode;
  }
  assert.equal(harness.getNode(TARGET).blendMode, "LUMINOSITY");

  const repeated = await harness.command("set_blend_mode", {
    nodeId: TARGET,
    blendMode: "LUMINOSITY",
  });
  assert.equal(repeated.changed, false, "same-value writes report their observed no-op");
});

test("set_blend_mode is a read-back, not an echo", async () => {
  const harness = await loadPluginHarness({ ignoreBlendModeWrites: [TARGET] });
  const result = await harness.command("set_blend_mode", {
    nodeId: TARGET,
    blendMode: "SCREEN",
  });

  assert.equal(result.previousBlendMode, "NORMAL");
  assert.equal(result.blendMode, "NORMAL");
  assert.equal(result.changed, false);
  assert.equal(harness.getNode(TARGET).blendMode, "NORMAL");
});

test("set_blend_mode refuses invalid modes and nodes without the blend surface before writing", async () => {
  const harness = await loadPluginHarness();
  const before = harness.getNode(TARGET).blendMode;

  for (const blendMode of [undefined, "NOT_A_MODE", "normal", 42]) {
    await assert.rejects(
      () => harness.command("set_blend_mode", { nodeId: TARGET, blendMode }),
      /requires blendMode to be one of/,
    );
    assert.equal(harness.getNode(TARGET).blendMode, before);
  }

  await assert.rejects(
    () => harness.command("set_blend_mode", { nodeId: ROOT, blendMode: "NORMAL" }),
    /DOCUMENT and does not support layer blendMode/,
  );
  assert.equal("blendMode" in harness.getNode(ROOT), false);
});

test("the stable get_node_info result stays unchanged; only the new receipts expose layer readings", async () => {
  const harness = await loadPluginHarness();
  const before = await harness.command("get_node_info", { nodeId: TARGET });

  await harness.command("set_opacity", { nodeId: TARGET, opacity: 0.4 });
  await harness.command("set_blend_mode", { nodeId: TARGET, blendMode: "SCREEN" });
  const after = await harness.command("get_node_info", { nodeId: TARGET });

  for (const [label, node] of [
    ["before", before],
    ["after", after],
  ]) {
    assert.equal(
      Object.hasOwn(node, "opacity"),
      false,
      `${label}: get_node_info must not grow an opacity field without a new contract version`,
    );
    assert.equal(
      Object.hasOwn(node, "blendMode"),
      false,
      `${label}: get_node_info must not grow a blendMode field without a new contract version`,
    );
  }
});

test("the public contract keeps two stable node writes while R3-A schema 1.18.0 holds", async () => {
  const built = await buildContract();
  const opacityTool = built.contract.tools.find((entry) => entry.name === "set_opacity");
  const blendTool = built.contract.tools.find((entry) => entry.name === "set_blend_mode");

  assert.ok(opacityTool, "set_opacity must be registered");
  assert.ok(blendTool, "set_blend_mode must be registered");
  for (const tool of [opacityTool, blendTool]) {
    assert.equal(tool.resultStability, "stable");
    assert.equal(tool.direction, "write");
    assert.equal(tool.scope, "node");
    assert.equal(tool.progress.pluginUpdates, "none");
  }

  assert.deepEqual(opacityTool.inputSchema.required, ["nodeId", "opacity"]);
  assert.equal(opacityTool.inputSchema.properties.opacity.minimum, 0);
  assert.equal(opacityTool.inputSchema.properties.opacity.maximum, 1);

  assert.deepEqual(blendTool.inputSchema.required, ["nodeId", "blendMode"]);
  assert.deepEqual(blendTool.inputSchema.properties.blendMode.enum, LAYER_BLEND_MODES);
  assert.ok(
    blendTool.inputSchema.properties.blendMode.enum.includes("PASS_THROUGH"),
    "PASS_THROUGH belongs to the node-level surface even though paint/effect schemas exclude it",
  );

  // 1.16.0 → 1.17.0 promoted `get_variable_capabilities` (2026-08-25); 1.18.0 then adds
  // `delete_variable_collection` as additive-preview. These two tools' frozen promises are
  // unchanged by either event — that is exactly what this test asserts.
  assert.equal(built.contract.publicContractVersion, "1.18.0");
  assert.equal(built.contract.serverSchemaVersion, "1.18.0");
  assert.equal(built.release.pluginApiVersion, "1.18.0");
});

test("both R2.7 item 1.3 tools are explicitly absent from v1 apply_batch", () => {
  for (const operation of ["set_opacity", "set_blend_mode"]) {
    assert.equal(V1_BATCH_OPERATIONS.includes(operation), false);
    assert.ok(EXCLUDED_BATCH_OPERATIONS[operation]);
  }
  assert.equal(V1_BATCH_OPERATIONS.length, 15, "CC8 keeps the allowlist at 15 through R2.7");
});
