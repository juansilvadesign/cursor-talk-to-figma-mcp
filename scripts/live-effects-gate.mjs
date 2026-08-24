#!/usr/bin/env node

/**
 * R2.7 item 1.2 — the `set_effects` live gate.
 *
 * This is deliberately a live instrument, not a second copy of the harness. It proves the
 * new JSON_REST_V1 read channel moves after a real Figma effects write, checks the five
 * semantic refusals arrive from the handler that owns them, and removes its scratch page on
 * either outcome. Run `bun run build`, reload the DEV plugin, then:
 *
 *   node scripts/live-effects-gate.mjs --channel=<DEV-plugin-channel>
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
    "Usage: node scripts/live-effects-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<dir>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// Derived after `contract:generate` for R2.7 item 1.2. Do not copy another gate's pins:
// this item changes the stable get_node_info result shape, spends 1.9.0, and therefore
// moves both runtime identities and the capability fingerprint.
const expectedRuntime = {
  // Re-pinned to the R2.7 FINAL build at the end-of-release re-pin, 2026-08-23. ⚠️ The note
  // that stood here described item 1.2's read-source repair — "`code.js` alone changed, the
  // server ID, fingerprint, schema and tool count all held" — which was true when written and
  // is false of this pin: item 1.3 moved BOTH build IDs and the fingerprint, and the tool
  // count went 62 → 64. Deleted rather than reworded, because a stale note about which pins
  // moved is the same class of lie as a stale pin.
  serverBuildId: "r2-server-a0afdc880ab0",
  pluginBuildId: "r2-plugin-0ace9ed58f34",
  schemaVersion: "1.9.0",
  fingerprint:
    "sha256:f636ecab99cc39989f6b79abaf06549a4e954f818f23d6fa2a369b08b6142fc0",
  toolCount: 65,
};

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const scratchPageName = `R2.7 1.2 effects gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.7-effects-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({ name: "talk-to-figma-r2.7-effects-gate", version: "1.0.0" });
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

// A schema refusal throws from MCP validation, while a handler refusal comes back through
// the server wrapper as an error result. The layer is a tested result: silently moving a
// cross-field rule into Zod would make the handler's named refusal unreachable.
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
  assert.equal(
    runtime.plugin?.buildId,
    expectedRuntime.pluginBuildId,
    "plugin build is stale — reload the DEV plugin before this gate",
  );
  assert.equal(runtime.plugin?.apiVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.plugin?.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.compatibility.status, "compatible");
  assert.deepEqual(runtime.compatibility.issues, []);
  assert.ok(
    runtime.plugin?.supportedCommands.includes("set_effects"),
    "plugin lacks set_effects — reload the DEV plugin",
  );
}

function nodeFromInfo(value) {
  return value?.document ?? value;
}

function summarizeEffects(effects) {
  if (!Array.isArray(effects)) return effects;
  return effects.map((effect) => ({
    type: effect.type,
    radius: effect.radius,
    spread: effect.spread,
    offset: effect.offset,
    visible: effect.visible,
    blendMode: effect.blendMode,
  }));
}

const record = {
  gate: "R2.7 1.2 set_effects",
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
  stillOwed: [],
  success: false,
};

let scratchPageId = null;
let originalPageId = null;
let failure = null;

try {
  await client.connect(transport);

  // 1. Published surface — read the running server rather than trusting this source file.
  const inventory = await client.listTools();
  const tool = inventory.tools.find((entry) => entry.name === "set_effects");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(tool, "set_effects is not in the published tool surface");

  const schema = tool.inputSchema ?? {};
  const description = String(tool.description ?? "");
  const effectsSchema = schema.properties?.effects ?? {};
  const effectsArray = (effectsSchema.anyOf ?? []).find((entry) => entry.type === "array");
  const effectSchema = effectsArray?.items ?? {};
  const publishedTypes = effectSchema.properties?.type?.enum ?? [];
  record.checks.publishedSchema = {
    required: (schema.required ?? []).includes("effects"),
    nullable: JSON.stringify(effectsSchema).includes('"null"'),
    minItems: effectsArray?.minItems,
    maxItems: effectsArray?.maxItems,
    types: publishedTypes,
    allowsTopLevelEffectPassthrough: effectSchema.additionalProperties === true,
    saysNullClears: /effects: null/.test(description),
    saysReadBack: /read back.*rather than echoed/s.test(description),
    saysStyleMayDetach: /may detach a bound effect style/.test(description),
  };
  assert.equal(record.checks.publishedSchema.required, true);
  assert.equal(record.checks.publishedSchema.nullable, true);
  assert.equal(record.checks.publishedSchema.minItems, 1);
  assert.equal(record.checks.publishedSchema.maxItems, 16);
  assert.deepEqual(publishedTypes, [
    "DROP_SHADOW",
    "INNER_SHADOW",
    "LAYER_BLUR",
    "BACKGROUND_BLUR",
  ]);
  assert.equal(publishedTypes.includes("NOISE"), false, "NOISE must remain absent");
  assert.equal(publishedTypes.includes("TEXTURE"), false, "TEXTURE must remain absent");
  assert.equal(record.checks.publishedSchema.allowsTopLevelEffectPassthrough, true);
  assert.equal(record.checks.publishedSchema.saysNullClears, true);
  assert.equal(record.checks.publishedSchema.saysReadBack, true);
  assert.equal(record.checks.publishedSchema.saysStyleMayDetach, true);

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

  // 2. Scratch page and read-channel instrument check. A read that is undefined before and
  // after is not agreement: it is the exact `filterFigmaNode` vacuum this release repairs.
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
    currentPageId: originalPageId,
  };

  scratchPageId = await callNodeId("create_page", { name: scratchPageName });
  await call("set_current_page", { pageId: scratchPageId });
  const target = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 160,
    height: 160,
    name: "effects target",
  });

  const readNode = async (nodeId) => nodeFromInfo((await callJson("get_node_info", { nodeId })).value);
  const before = await readNode(target);
  const initialEffects = before?.effects;
  const requested = {
    type: "DROP_SHADOW",
    color: { r: 0.12, g: 0.24, b: 0.48, a: 0.7 },
    offset: { x: 7, y: 9 },
    radius: 13,
    // The sign is a platform question, deliberately not bounded by the tool. The gate
    // records what Figma returns instead of inventing a claim before it is measured.
    spread: -3,
    visible: true,
    blendMode: "MULTIPLY",
    showShadowBehindNode: true,
  };
  const receipt = (await callJson("set_effects", { nodeId: target, effects: [requested] })).value;
  const after = await readNode(target);
  const afterEffects = after?.effects;

  record.checks.readChannel = {
    before: summarizeEffects(initialEffects),
    after: summarizeEffects(afterEffects),
    usable:
      Array.isArray(afterEffects) &&
      afterEffects.length === 1 &&
      JSON.stringify(initialEffects) !== JSON.stringify(afterEffects),
    exportedFields: {
      effects: Object.hasOwn(after ?? {}, "effects"),
      effectStyleId: Object.hasOwn(after ?? {}, "effectStyleId"),
      clipsContent: Object.hasOwn(after ?? {}, "clipsContent"),
      absoluteRenderBounds: Object.hasOwn(after ?? {}, "absoluteRenderBounds"),
    },
  };
  assert.equal(record.checks.readChannel.usable, true, "get_node_info did not report a moving effects value");
  assert.deepEqual(record.checks.readChannel.exportedFields, {
    effects: true,
    effectStyleId: true,
    clipsContent: true,
    absoluteRenderBounds: true,
  }, "the complete R2.7 read-shape repair must reach the live JSON_REST_V1 response");
  assert.equal(afterEffects[0]?.type, "DROP_SHADOW");
  assert.equal(afterEffects[0]?.radius, requested.radius);
  assert.equal(afterEffects[0]?.spread, requested.spread);
  assert.equal(receipt.effectCount, 1);
  assert.equal(receipt.previousReadable, true);
  assert.equal(Object.hasOwn(receipt, "previousMixed"), false, "effects must not claim a mixed state it cannot represent");
  assert.ok(Array.isArray(receipt.effects), "receipt must read the written effects back from Figma");
  record.checks.write = {
    requested,
    receipt: {
      effectCount: receipt.effectCount,
      previousReadable: receipt.previousReadable,
      styleIdBefore: receipt.styleIdBefore,
      styleIdAfter: receipt.styleIdAfter,
      styleReadable: receipt.styleReadable,
      styleDetached: receipt.styleDetached,
      effects: summarizeEffects(receipt.effects),
    },
  };

  // 2b. The shapes this gate never used to send: every OMITTED optional field.
  //
  // 🔴 This section exists because the gate was green while the tool was broken. Its one
  // successful shadow above supplies `visible` and `blendMode`, and its field-omission
  // probes are all refused by the handler before they ever reach Figma — so the platform's
  // own union validation was never exercised, and `set_effects` shipped `stable` while a
  // DROP_SHADOW omitting either field was refused outright. Measured 2026-08-23 by the R2
  // acceptance fixture, not by this gate.
  //
  // ⭐ The lesson is not "add a case": the gate only ever sent the shapes that worked, so
  // its green was evidence about its own inputs. A minimal effect of each type is the shape
  // a generic client writes from reading the schema, so that is what has to be sent.
  const minimalWrites = {
    DROP_SHADOW: { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 2 }, radius: 4 },
    INNER_SHADOW: { type: "INNER_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 2 }, radius: 4 },
    LAYER_BLUR: { type: "LAYER_BLUR", radius: 5 },
    BACKGROUND_BLUR: { type: "BACKGROUND_BLUR", radius: 5 },
  };
  record.checks.omittedOptionals = {};
  for (const [type, effect] of Object.entries(minimalWrites)) {
    const minimal = (await callJson("set_effects", { nodeId: target, effects: [effect] })).value;
    const stored = (await readNode(target))?.effects?.[0];
    // The platform must ACCEPT it, and the fields it requires must be present on the node.
    assert.equal(minimal.effectCount, 1, `a minimal ${type} was not accepted by Figma`);
    assert.equal(stored?.type, type);
    assert.equal(stored?.visible, true, `${type} must carry the platform-required visible`);
    const isShadow = type === "DROP_SHADOW" || type === "INNER_SHADOW";
    assert.equal(
      stored?.blendMode,
      isShadow ? "NORMAL" : undefined,
      `${type} blendMode must be filled for shadows and absent for blurs`,
    );
    record.checks.omittedOptionals[type] = {
      sent: effect,
      storedVisible: stored?.visible,
      storedBlendMode: stored?.blendMode ?? null,
    };
  }

  // Restore the section-2 shadow so the refusal probes below compare against the state they
  // were written for, rather than against whatever this section left behind.
  await callJson("set_effects", { nodeId: target, effects: [requested] });

  // 3. Five semantic refusals. All have to be handled after Zod because each depends on a
  // sibling field, a missing sibling, an unknown key preserved by passthrough, or the node.
  const refusals = {
    crossTypeField: await callExpectingRefusal("set_effects", {
      nodeId: target,
      effects: [{ type: "LAYER_BLUR", radius: 5, color: { r: 0, g: 0, b: 0 } }],
    }),
    shadowOnlyField: await callExpectingRefusal("set_effects", {
      nodeId: target,
      effects: [{
        type: "INNER_SHADOW",
        color: { r: 0, g: 0, b: 0 },
        offset: { x: 1, y: 1 },
        radius: 4,
        showShadowBehindNode: true,
      }],
    }),
    missingRequiredField: await callExpectingRefusal("set_effects", {
      nodeId: target,
      effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0 }, radius: 4 }],
    }),
    unknownField: await callExpectingRefusal("set_effects", {
      nodeId: target,
      effects: [{ type: "LAYER_BLUR", radius: 4, invented: true }],
    }),
    noEffectsSurface: await callExpectingRefusal("set_effects", {
      nodeId: scratchPageId,
      effects: [{ type: "LAYER_BLUR", radius: 4 }],
    }),
  };
  const declaredOwner = Object.fromEntries(
    Object.keys(refusals).map((key) => [key, "handler"]),
  );
  record.checks.refusals = Object.fromEntries(
    Object.entries(refusals).map(([key, value]) => [
      key,
      { refused: value.refused, layer: value.layer, message: value.message.slice(0, 300) },
    ]),
  );
  for (const [key, value] of Object.entries(refusals)) {
    assert.equal(value.refused, true, `${key} was accepted`);
    assert.equal(value.layer, declaredOwner[key], `${key} arrived from ${value.layer}, not its handler owner`);
  }
  assert.match(refusals.crossTypeField.message, /color.*LAYER_BLUR/i);
  assert.match(refusals.shadowOnlyField.message, /showShadowBehindNode.*INNER_SHADOW/i);
  assert.match(refusals.missingRequiredField.message, /DROP_SHADOW requires offset/i);
  assert.match(refusals.unknownField.message, /invented.*not valid.*LAYER_BLUR/i);
  assert.match(refusals.noEffectsSurface.message, /PAGE.*does not support effects/i);

  const afterRefusals = await readNode(target);
  record.checks.refusals.documentUntouched =
    JSON.stringify(afterRefusals?.effects) === JSON.stringify(afterEffects);
  assert.equal(record.checks.refusals.documentUntouched, true, "a refused effect write changed the target");

  // 4. Clearing must be visible in the independent read channel, not only in the receipt.
  const cleared = (await callJson("set_effects", { nodeId: target, effects: null })).value;
  const afterClear = await readNode(target);
  record.checks.clear = {
    cleared: cleared.cleared,
    effectCount: cleared.effectCount,
    readEffects: summarizeEffects(afterClear?.effects),
  };
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.effectCount, 0);
  assert.deepEqual(afterClear?.effects, [], "the independent read channel must witness the clear as []");

  // A fresh node cannot answer the detachment question — no fork tool binds an effect
  // style. Preserve the reading and say that limitation out loud rather than treating
  // `styleDetached: false` on an unstyled node as a platform conclusion.
  if (receipt.styleIdBefore === null) {
    record.stillOwed.push(
      "effect-style detachment is UNMEASURED: the fork has no tool that binds an effect style to the scratch node. The receipt is verified to report its readings, but a bound style must be prepared by hand before promotion can quote a platform result.",
    );
  }

  record.success = true;
} catch (error) {
  failure = error;
  record.error = { message: error?.message ?? String(error), stack: error?.stack };
} finally {
  // Cleanup must run after a failed assertion too: the gate's evidence is never permission
  // to leave a test page in the owner's file.
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
          JSON.stringify((pagesAfter.pages ?? []).map((page) => page.id)) ===
            JSON.stringify(record.baseline?.pageIds),
      };
    } catch (cleanupError) {
      record.cleanup = {
        pageId: scratchPageId,
        error: String(cleanupError.message ?? cleanupError),
      };
    }
  }
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  await client.close().catch(() => {});
  process.stderr.write(`report: ${reportPath}\n`);
}

if (failure) {
  process.stderr.write(`R2.7 1.2 effects live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.7 1.2 effects live gate PASSED\n");
