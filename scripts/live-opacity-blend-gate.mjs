#!/usr/bin/env node

/**
 * R2.7 item 1.3 — `set_opacity` and `set_blend_mode` live gate.
 *
 * This gate has an unusual deliberate assertion: get_node_info MUST NOT expose either
 * field. Item 1.2 spent the R2.7 bump on a different stable-read repair, so publishing
 * opacity or blendMode there would be a breaking result-shape expansion. The new tools'
 * own receipts are the additive read-back channel; rendered pixels are the independent
 * currency that proves the writes resolve in Figma.
 *
 * Run `bun run build`, reload the DEV plugin, then:
 *
 *   node scripts/live-opacity-blend-gate.mjs --channel=<DEV-plugin-channel>
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

if (!options.channel) {
  process.stderr.write(
    "Usage: node scripts/live-opacity-blend-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<dir>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// Derived from runtime-metadata.ts after R2.7 item 1.3's contract generation. The schema
// deliberately HOLDS at 1.9.0: two additive tools move both build IDs and the capability
// fingerprint, but must not consume R3-A's 1.10.0.
const expectedRuntime = {
  serverBuildId: "r2-server-d95951a3ce93",
  pluginBuildId: "r2-plugin-364f8001f2d1",
  schemaVersion: "1.9.0",
  fingerprint:
    "sha256:9b7abf647c2737391aec8486049081b8456d6c20563724c2c549446bda1dacb4",
  toolCount: 64,
};

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

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const scratchPageName = `R2.7 1.3 opacity / blend gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.7-opacity-blend-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({ name: "talk-to-figma-r2.7-opacity-blend-gate", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: root,
  stderr: "pipe",
});

function textContent(result) {
  return (result.content || [])
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
}

async function callRaw(name, args = {}, timeout = 120_000) {
  return client.callTool({ name, arguments: args }, undefined, {
    timeout,
    maxTotalTimeout: timeout,
  });
}

async function call(name, args = {}, timeout = 120_000) {
  const result = await callRaw(name, args, timeout);
  const text = textContent(result);
  if (result.isError || /^Error\b/.test(text)) {
    throw new Error(`${name} failed: ${text || "unknown MCP error"}`);
  }
  return { result, text };
}

async function callJson(name, args = {}, timeout = 120_000) {
  const called = await call(name, args, timeout);
  return { ...called, value: JSON.parse(called.text) };
}

async function callNodeId(name, args = {}) {
  const called = await call(name, args);
  const start = called.text.indexOf("{");
  const end = called.text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(called.text.slice(start, end + 1));
    if (parsed?.id) return parsed.id;
  }
  const match = called.text.match(/with (?:new )?ID:\s*([^.\s]+)/);
  assert.ok(match, `${name} returned neither JSON nor a prose node id: ${called.text}`);
  return match[1];
}

// Schema refusals throw from MCP validation. A node-surface refusal reaches the plugin and
// returns through the server wrapper. The distinction proves that each layer owns its own
// question, rather than merely observing that a malformed call failed somehow.
async function callExpectingRefusal(name, args = {}, timeout = 120_000) {
  let message;
  let refused;
  let layer;
  try {
    const result = await callRaw(name, args, timeout);
    message = textContent(result);
    refused = Boolean(result.isError) || /^Error\b/.test(message);
    layer = "handler";
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
    refused = true;
    layer = "schema";
  }
  return { message, layer, refused };
}

async function joinWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      return await call("join_channel", { channel: options.channel });
    } catch (error) {
      lastError = error;
      if (!/Not connected to Figma/.test(error.message) || attempt === 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

function assertRuntime(runtime) {
  assert.equal(runtime.server.buildId, expectedRuntime.serverBuildId);
  assert.equal(runtime.server.schemaVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.server.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.plugin?.buildId, expectedRuntime.pluginBuildId, "plugin build is stale — reload the DEV plugin before this gate");
  assert.equal(runtime.plugin?.apiVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.plugin?.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.compatibility.status, "compatible");
  assert.deepEqual(runtime.compatibility.issues, []);
  for (const command of ["set_opacity", "set_blend_mode"]) {
    assert.ok(runtime.plugin?.supportedCommands.includes(command), `plugin lacks ${command} — reload the DEV plugin`);
  }
}

function nodeFromInfo(value) {
  return value?.document ?? value;
}

async function renderBytes(nodeId, label) {
  const filePath = path.join(artifactDirectory, `${label}.png`);
  const reply = await callJson("export_node_as_image", {
    nodeId,
    format: "PNG",
    scale: 1,
    filePath,
  });
  const bytes = await readFile(filePath).catch(() => null);
  return {
    receipt: reply.value,
    filePath,
    byteLength: bytes ? bytes.length : null,
    sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : null,
  };
}

const record = {
  gate: "R2.7 1.3 set_opacity / set_blend_mode",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  artifactDirectory,
  expectedRuntime,
  artifactHashes: {
    server: await sha256OfFile(serverPath),
    plugin: await sha256OfFile(pluginPath),
  },
  checks: {},
  findings: [],
  success: false,
};

let scratchPageId = null;
let originalPageId = null;
let failure = null;

try {
  await client.connect(transport);

  // 1. Published surface — inspect the running server, never this source file.
  const inventory = await client.listTools();
  const opacityTool = inventory.tools.find((entry) => entry.name === "set_opacity");
  const blendTool = inventory.tools.find((entry) => entry.name === "set_blend_mode");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(opacityTool, "set_opacity is not in the published tool surface");
  assert.ok(blendTool, "set_blend_mode is not in the published tool surface");

  const opacitySchema = opacityTool.inputSchema ?? {};
  const blendSchema = blendTool.inputSchema ?? {};
  const opacityDescription = String(opacityTool.description ?? "");
  const blendDescription = String(blendTool.description ?? "");
  record.checks.publishedSchema = {
    opacityRequired: (opacitySchema.required ?? []).includes("opacity"),
    opacityMinimum: opacitySchema.properties?.opacity?.minimum,
    opacityMaximum: opacitySchema.properties?.opacity?.maximum,
    blendModeRequired: (blendSchema.required ?? []).includes("blendMode"),
    layerBlendModes: blendSchema.properties?.blendMode?.enum ?? null,
    saysOpacityReadBack: /read back.*rather than echoing/s.test(opacityDescription),
    saysBlendReadBack: /read back.*rather than echoing/s.test(blendDescription),
    saysStableReadHolds:
      /get_node_info intentionally does not gain an opacity field/.test(opacityDescription) &&
      /get_node_info intentionally does not gain a blendMode field/.test(blendDescription),
  };
  assert.equal(record.checks.publishedSchema.opacityRequired, true);
  assert.equal(record.checks.publishedSchema.opacityMinimum, 0);
  assert.equal(record.checks.publishedSchema.opacityMaximum, 1);
  assert.equal(record.checks.publishedSchema.blendModeRequired, true);
  assert.deepEqual(record.checks.publishedSchema.layerBlendModes, LAYER_BLEND_MODES);
  assert.equal(record.checks.publishedSchema.saysOpacityReadBack, true);
  assert.equal(record.checks.publishedSchema.saysBlendReadBack, true);
  assert.equal(record.checks.publishedSchema.saysStableReadHolds, true);

  await joinWithRetry();
  const runtime = (await callJson("get_runtime_info")).value;
  assertRuntime(runtime);
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin.buildId,
    schemaVersion: runtime.server.schemaVersion,
    fingerprint: runtime.server.capabilityFingerprint,
    compatibility: runtime.compatibility.status,
  };

  // 2. Scratch scene: blue background below a red target is the independent pixel
  // measurement for opacity and blend mode. A separate untouched control proves that
  // changing the target did not merely perturb export state.
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
    currentPageId: originalPageId,
  };

  scratchPageId = await callNodeId("create_page", { name: scratchPageName });
  await call("set_current_page", { pageId: scratchPageId });
  const scene = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 160,
    height: 160,
    name: "opacity / blend scene",
  });
  const background = await callNodeId("create_rectangle", {
    x: 0,
    y: 0,
    width: 160,
    height: 160,
    name: "blue background",
    parentId: scene,
  });
  const target = await callNodeId("create_rectangle", {
    x: 0,
    y: 0,
    width: 160,
    height: 160,
    name: "red opacity / blend target",
    parentId: scene,
  });
  const control = await callNodeId("create_rectangle", {
    x: 220,
    y: 0,
    width: 80,
    height: 80,
    name: "UNTOUCHED control",
  });
  await call("set_fill", { nodeId: background, paints: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }] });
  await call("set_fill", { nodeId: target, paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] });
  await call("set_fill", { nodeId: control, paints: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }] });

  // This absence is intentional, not a dead read channel. Exposing these fields here
  // would widen a stable response after 1.2 spent the release bump. The receipts below
  // are therefore the public read-back channel for this item.
  const readBefore = nodeFromInfo((await callJson("get_node_info", { nodeId: target })).value);
  record.checks.stableReadHeldBefore = {
    opacityPublished: Object.hasOwn(readBefore, "opacity"),
    blendModePublished: Object.hasOwn(readBefore, "blendMode"),
  };
  assert.deepEqual(record.checks.stableReadHeldBefore, {
    opacityPublished: false,
    blendModePublished: false,
  });

  // 3. Opacity resolves in pixels. The receipt reads the direct node property, while the
  // red-over-blue scene gives a separate result that an echo cannot fabricate.
  const opaqueScene = await renderBytes(scene, "3-scene-opaque");
  const controlBefore = await renderBytes(control, "3-control-before");
  const opacityReceipt = (await callJson("set_opacity", { nodeId: target, opacity: 0.35 })).value;
  const transparentScene = await renderBytes(scene, "3-scene-opacity-035");
  const controlAfterOpacity = await renderBytes(control, "3-control-after-opacity");
  record.checks.opacity = {
    receipt: {
      previousOpacity: opacityReceipt.previousOpacity,
      previousOpacityReadable: opacityReceipt.previousOpacityReadable,
      opacity: opacityReceipt.opacity,
      opacityReadable: opacityReceipt.opacityReadable,
      changed: opacityReceipt.changed,
    },
    opaqueSceneSha: opaqueScene.sha256,
    transparentSceneSha: transparentScene.sha256,
    controlBeforeSha: controlBefore.sha256,
    controlAfterSha: controlAfterOpacity.sha256,
    pixelsChanged: opaqueScene.sha256 !== transparentScene.sha256,
    controlHeld: controlBefore.sha256 === controlAfterOpacity.sha256,
  };
  assert.equal(opacityReceipt.opacity, 0.35);
  assert.equal(opacityReceipt.opacityReadable, true);
  assert.equal(opacityReceipt.changed, true);
  assert.equal(record.checks.opacity.pixelsChanged, true, "opacity write did not change rendered scene bytes");
  assert.equal(record.checks.opacity.controlHeld, true, "untouched control changed during opacity probe");

  // Restore opacity before the blend measurement. The receipt must show the preceding
  // .35, which prevents a handler from inventing both receipts independently.
  const restoreOpacity = (await callJson("set_opacity", { nodeId: target, opacity: 1 })).value;
  assert.equal(restoreOpacity.previousOpacity, 0.35);
  assert.equal(restoreOpacity.opacity, 1);

  // 4. Layer blend mode resolves against the blue sibling. Normal, MULTIPLY and SCREEN
  // need not have a hard-coded PNG interpretation here; three distinct rendered byte
  // streams prove Figma applied distinguishable layer modes. PASS_THROUGH is exercised
  // separately on the frame because it is valid on the layer surface but intentionally
  // absent from paint/effect tools.
  const normalReceipt = (await callJson("set_blend_mode", { nodeId: target, blendMode: "NORMAL" })).value;
  const normalScene = await renderBytes(scene, "4-scene-normal");
  const multiplyReceipt = (await callJson("set_blend_mode", { nodeId: target, blendMode: "MULTIPLY" })).value;
  const multiplyScene = await renderBytes(scene, "4-scene-multiply");
  const screenReceipt = (await callJson("set_blend_mode", { nodeId: target, blendMode: "SCREEN" })).value;
  const screenScene = await renderBytes(scene, "4-scene-screen");
  const passThroughReceipt = (await callJson("set_blend_mode", { nodeId: scene, blendMode: "PASS_THROUGH" })).value;
  record.checks.blendMode = {
    normal: { previous: normalReceipt.previousBlendMode, readBack: normalReceipt.blendMode, changed: normalReceipt.changed, sha256: normalScene.sha256 },
    multiply: { previous: multiplyReceipt.previousBlendMode, readBack: multiplyReceipt.blendMode, changed: multiplyReceipt.changed, sha256: multiplyScene.sha256 },
    screen: { previous: screenReceipt.previousBlendMode, readBack: screenReceipt.blendMode, changed: screenReceipt.changed, sha256: screenScene.sha256 },
    passThrough: { previous: passThroughReceipt.previousBlendMode, readBack: passThroughReceipt.blendMode, changed: passThroughReceipt.changed },
    normalVsMultiply: normalScene.sha256 !== multiplyScene.sha256,
    multiplyVsScreen: multiplyScene.sha256 !== screenScene.sha256,
  };
  assert.equal(normalReceipt.blendMode, "NORMAL");
  assert.equal(multiplyReceipt.blendMode, "MULTIPLY");
  assert.equal(screenReceipt.blendMode, "SCREEN");
  assert.equal(passThroughReceipt.blendMode, "PASS_THROUGH");
  assert.equal(record.checks.blendMode.normalVsMultiply, true, "NORMAL and MULTIPLY rendered identically over a blue sibling");
  assert.equal(record.checks.blendMode.multiplyVsScreen, true, "MULTIPLY and SCREEN rendered identically over a blue sibling");

  const readAfter = nodeFromInfo((await callJson("get_node_info", { nodeId: target })).value);
  record.checks.stableReadHeldAfter = {
    opacityPublished: Object.hasOwn(readAfter, "opacity"),
    blendModePublished: Object.hasOwn(readAfter, "blendMode"),
  };
  assert.deepEqual(record.checks.stableReadHeldAfter, {
    opacityPublished: false,
    blendModePublished: false,
  });

  // 5. Two boundary refusals and two node-surface refusals. No refusal may alter the
  // scene's rendered state, and the declared ownership split must match what arrived.
  const sceneBeforeRefusals = await renderBytes(scene, "5-before-refusals");
  const refusals = {
    opacityOutOfRange: await callExpectingRefusal("set_opacity", { nodeId: target, opacity: 1.01 }),
    opacityNoSurface: await callExpectingRefusal("set_opacity", { nodeId: scratchPageId, opacity: 0.5 }),
    blendModeInvalid: await callExpectingRefusal("set_blend_mode", { nodeId: target, blendMode: "NOT_A_MODE" }),
    blendModeNoSurface: await callExpectingRefusal("set_blend_mode", { nodeId: scratchPageId, blendMode: "NORMAL" }),
  };
  const declaredOwner = {
    opacityOutOfRange: "schema",
    opacityNoSurface: "handler",
    blendModeInvalid: "schema",
    blendModeNoSurface: "handler",
  };
  record.checks.refusals = Object.fromEntries(
    Object.entries(refusals).map(([key, value]) => [
      key,
      { refused: value.refused, layer: value.layer, message: value.message.slice(0, 300), declared: declaredOwner[key] },
    ]),
  );
  for (const [key, value] of Object.entries(refusals)) {
    assert.equal(value.refused, true, `${key} was accepted`);
    assert.equal(value.layer, declaredOwner[key], `${key} arrived from ${value.layer}, not its declared ${declaredOwner[key]} owner`);
  }
  assert.match(refusals.opacityNoSurface.message, /PAGE.*does not support layer opacity/);
  assert.match(refusals.blendModeNoSurface.message, /PAGE.*does not support layer blendMode/);
  const sceneAfterRefusals = await renderBytes(scene, "5-after-refusals");
  record.checks.refusals.documentUntouched = sceneBeforeRefusals.sha256 === sceneAfterRefusals.sha256;
  assert.equal(record.checks.refusals.documentUntouched, true, "a refused opacity/blend-mode write changed the scene");

  record.success = true;
} catch (error) {
  failure = error;
  record.error = { message: error?.message ?? String(error), stack: error?.stack };
} finally {
  // A passing reading never grants permission to leave a scratch page in the owner's file.
  if (scratchPageId) {
    try {
      if (originalPageId) await call("set_current_page", { pageId: originalPageId });
      const deleted = await call("delete_node", { nodeId: scratchPageId });
      const pagesAfter = (await callJson("get_pages")).value;
      record.cleanup = {
        pageId: scratchPageId,
        reply: deleted.text,
        baselineRestored:
          (pagesAfter.pageCount ?? pagesAfter.pages?.length) === record.baseline?.pageCount &&
          pagesAfter.currentPageId === originalPageId &&
          JSON.stringify((pagesAfter.pages ?? []).map((page) => page.id)) === JSON.stringify(record.baseline?.pageIds),
      };
    } catch (cleanupError) {
      record.cleanup = { pageId: scratchPageId, error: String(cleanupError.message ?? cleanupError) };
    }
  }
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  await client.close().catch(() => {});
  process.stderr.write(`report: ${reportPath}\n`);
}

if (failure) {
  process.stderr.write(`R2.7 1.3 opacity / blend live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.7 1.3 opacity / blend live gate PASSED\n");
