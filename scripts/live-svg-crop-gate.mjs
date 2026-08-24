#!/usr/bin/env node

/**
 * R2.7 Phase 2 — `create_node_from_svg` and the `set_image_fill` CROP repair.
 *
 * ⛔ **THIS GATE EXISTS BECAUSE A RECEIPT LIED AND NOTHING COULD CATCH IT.** Measured live
 * 2026-08-23: `set_image_fill` with `scaleMode: "CROP"` and no `imageTransform` was ACCEPTED
 * by Figma, stored with the identity matrix `[[1,0,0],[0,1,0]]`, reported by `JSON_REST_V1`
 * as `scaleMode: "STRETCH"`, and rendered as a distortion — while the receipt echoed the
 * requested `"CROP"` straight back. ⭐ **Reading the mode back would not have caught it**: the
 * plugin node answers `"CROP"` too, so both vocabularies agree while the pixels disagree.
 * `CROP` and `STRETCH` are two id spaces for one stored state, the third time this fork has
 * been bitten by that shape.
 *
 * ⭐ **THE CURRENCY IS THEREFORE RENDERED BYTES, NOT THE MODE NAME.** §5 does not ask Figma
 * what mode it stored — it asks what the node PAINTS, through `export_node_as_image`, a tool
 * written years before this one and knowing nothing about crops. The probe image carries a
 * black bar on its far left and a white bar on its far right precisely so a stretch and a
 * centre-crop are distinguishable: a stretch keeps both markers, a centre-crop keeps neither.
 * ⚠️ An earlier probe had its colour boundary at the image's centre, which made a squash and
 * a centre-crop produce IDENTICAL pixels — the two hypotheses were indistinguishable and the
 * "measurement" was worthless. Byte inequality across distinct transforms proves they are
 * DISTINGUISHABLE, never which is which; direction is confirmed by eye from the retained PNGs.
 *
 * What this gate proves that the 18 offline tests cannot:
 *
 *  ⭐ **That Figma HONOURS a supplied transform** — §5. The offline harness stores whatever
 *     paint it is handed, so a transform that Figma ignored would look identical offline. This
 *     is the one claim the whole CROP repair rests on and it was UNVERIFIED until this gate.
 *
 *  ⭐ **What an SVG actually expands into** — §3. The harness models structure only, and
 *     deliberately refuses to predict Figma's parser. `createdNodeCount` is a reading; here it
 *     meets the real parser for the first time.
 *
 *  ⭐ **That the non-idempotency is real, not just declared** — §4. `duplicatesOnRerun: true`
 *     is asserted against the page's actual child count across two calls.
 *
 * Run `bun run build`, reload the DEV plugin, then:
 *
 *   node scripts/live-svg-crop-gate.mjs --channel=<DEV-plugin-channel> \
 *     [--output-dir=<dir>] [--server=<dist-server-path>]
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
    "Usage: node scripts/live-svg-crop-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<dir>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// Derived from runtime-metadata.ts after R2.7 Phase 2's contract generation. The schema HOLDS
// at 1.9.0 — a new tool is additive — while the tool count and both build IDs move.
// ⛔ RE-PINNED 2026-08-24 for **R3-A PHASE 1.1** (`hasVariableWriteApi` in `code.js`), on
// channel `chvza8ab`. ⚠️ **THE EXACT INVERSE of the shape recorded above: only
// `pluginBuildId` moved** (`0ace9ed58f34` → `a34d76fc6bc6`). Phase 1.1 adds no MCP tool
// and no `capabilityId`, and `server.ts`/`contractPayload` are untouched, so
// `serverBuildId`, the schema, the fingerprint AND the tool count all HELD.
// ⭐ Operator consequence is therefore the OPPOSITE of the note above — the DEV plugin **DID**
// need reloading — and it was MEASURED before this re-pin, not assumed: live
// `get_runtime_info` reported `plugin.buildId: "r2-plugin-a34d76fc6bc6"`. ⛔ Never read
// `compatibility: "compatible"` for this; it only says the two RUNNING halves agree with
// each other, never that either agrees with this tree.
const expectedRuntime = {
  // ⭐ Moved by the description repair this gate's own §1 forced: the CROP/STRETCH warning
  // lived only on the `imageTransform` parameter, so a caller reading the tool description
  // never met it. `server.ts` alone changed, so `pluginBuildId` HELD and the fingerprint held
  // with it — a description is not part of the capability surface it hashes.
  serverBuildId: "r2-server-a0afdc880ab0",
  pluginBuildId: "r2-plugin-a34d76fc6bc6",
  schemaVersion: "1.9.0",
  fingerprint:
    "sha256:f636ecab99cc39989f6b79abaf06549a4e954f818f23d6fa2a369b08b6142fc0",
  toolCount: 65,
};

// 40×20. Black bar at x<4, white bar at x>=36, red/blue split at the middle. The EDGE markers
// are what make a stretch and a crop distinguishable; see the header.
const PROBE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAALklEQVR42mNgQAJ35ORIQnI2d0hC/5EAw6jFoxaPWjxq8ajFoxaPWjxq8cixGADsAtC+b9E2/gAAAABJRU5ErkJggg==";

// Three transforms that must produce three DIFFERENT renders. Identity is included on purpose:
// it is the matrix Figma silently supplied before this repair, so its render is the "stretch"
// the old bare CROP produced — the defect, reproduced deliberately as a comparison point.
const TRANSFORM_IDENTITY = [[1, 0, 0], [0, 1, 0]];
const TRANSFORM_LEFT_THIRD = [[0.34, 0, 0], [0, 1, 0]];
const TRANSFORM_RIGHT_THIRD = [[0.34, 0, 0.66], [0, 1, 0]];

// 🔴 **FIGMA STORES THE IMAGE TRANSFORM AS FLOAT32** — measured on this gate's first run
// against a real file: a requested 0.34 reads back as 0.3400000035762787, exactly
// Math.fround(0.34). This is item 1.3's layer-opacity finding on a second, unrelated field.
// ⭐ Asserting the FROUNDED matrix is STRICTER than asserting the one we sent: only an echo
// could hand back exactly 0.34, so this comparison is itself the live echo detector. ⛔ Do
// NOT relax this to a tolerance — the expected value is corrected to the one the platform can
// actually hold, and no approximate comparison is introduced.
// ⚠️ Note which case could not have found it: the IDENTITY matrix is all 1s and 0s, every one
// exactly representable, so it round-trips perfectly. A gate that only tested identity would
// have shipped believing the receipt was verified.
const frounded = (matrix) => matrix.map((row) => row.map((value) => Math.fround(value)));

const SVG_SOURCE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" width="60" height="40">' +
  '<rect x="0" y="0" width="60" height="40" fill="#e11d48"/>' +
  '<circle cx="20" cy="20" r="8" fill="#2563eb"/>' +
  '<circle cx="40" cy="20" r="8" fill="#16a34a"/>' +
  "</svg>";

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const scratchPageName = `R2.7 P2 svg / crop gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.7-p2-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({ name: "talk-to-figma-r2.7-p2-gate", version: "1.0.0" });
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

// `set_image_fill` keeps a historical prose line and appends its receipt underneath, so the
// whole reply is not JSON. ⛔ Parse the TRAILING object rather than the first `{` — the prose
// itself can contain braces (the transform is printed there), and taking the first one would
// read the human sentence as the machine receipt.
async function callTrailingJson(name, args = {}, timeout = 120_000) {
  const called = await call(name, args, timeout);
  const start = called.text.lastIndexOf("\n{");
  assert.ok(
    start >= 0,
    `${name} published no appended JSON receipt — the reply was: ${called.text}`,
  );
  return { ...called, value: JSON.parse(called.text.slice(start + 1)) };
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

// A schema refusal throws from MCP validation; a handler refusal reaches the plugin and comes
// back through the server wrapper. Naming the layer is what proves each owns its own question,
// rather than merely observing that a bad call failed somehow.
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
  for (const command of ["create_node_from_svg", "set_image_fill"]) {
    assert.ok(
      runtime.plugin?.supportedCommands.includes(command),
      `plugin lacks ${command} — reload the DEV plugin`,
    );
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
  gate: "R2.7 Phase 2 create_node_from_svg / set_image_fill CROP",
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

  // ── §1. Published surface — read the RUNNING server, never this source file ────────────
  const tools = (await client.listTools()).tools;
  const svgTool = tools.find((tool) => tool.name === "create_node_from_svg");
  const fillTool = tools.find((tool) => tool.name === "set_image_fill");
  assert.ok(svgTool, "create_node_from_svg is not published by the running server");
  assert.ok(fillTool, "set_image_fill is missing from the running server");
  const transformSchema = fillTool.inputSchema?.properties?.imageTransform;
  assert.ok(transformSchema, "set_image_fill publishes no imageTransform parameter");
  record.checks.publishedSurface = {
    toolCount: tools.length,
    svgToolPresent: true,
    imageTransformPublished: true,
    // ⛔ The description must carry the warning, not just the code comments. A caller reading
    // only the schema has to learn that a bare CROP is a stretch.
    cropWarningInDescription: /STRETCH/.test(fillTool.description || ""),
    idempotencyWarningInDescription: /NOT idempotent/.test(svgTool.description || ""),
  };
  assert.equal(tools.length, expectedRuntime.toolCount);
  assert.equal(record.checks.publishedSurface.cropWarningInDescription, true);
  assert.equal(record.checks.publishedSurface.idempotencyWarningInDescription, true);

  await joinWithRetry();
  const runtime = (await callJson("get_runtime_info")).value;
  assertRuntime(runtime);

  // ── §2. Baseline and an isolated scratch page ──────────────────────────────────────────
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
    currentPageId: originalPageId,
  };

  const created = (await callJson("create_page", { name: scratchPageName })).value;
  scratchPageId = created.id;
  await call("set_current_page", { pageId: scratchPageId });

  // ── §3. create_node_from_svg meets the real parser ─────────────────────────────────────
  const svgResult = (
    await callJson("create_node_from_svg", { svg: SVG_SOURCE, x: 0, y: 0, name: "svg-probe" })
  ).value;

  const svgInfo = nodeFromInfo((await callJson("get_node_info", { nodeId: svgResult.id })).value);
  record.checks.createFromSvg = {
    id: svgResult.id,
    type: svgResult.type,
    name: svgResult.name,
    createdNodeCount: svgResult.createdNodeCount,
    svgSourceLength: svgResult.svgSourceLength,
    duplicatesOnRerun: svgResult.duplicatesOnRerun,
    width: svgResult.width,
    height: svgResult.height,
    readBackType: svgInfo?.type,
  };
  assert.equal(svgResult.type, "FRAME", "createNodeFromSvg must return a FrameNode");
  assert.equal(svgResult.svgSourceLength, SVG_SOURCE.length);
  assert.equal(svgResult.duplicatesOnRerun, true);
  // ⛔ The count is asserted as ">1", not as a specific number. Figma's parser decides how many
  // nodes this SVG becomes and pinning that number here would pin a platform detail this gate
  // has no authority over — but a count of 1 would mean the traversal never descended.
  assert.ok(
    svgResult.createdNodeCount > 1,
    `createdNodeCount ${svgResult.createdNodeCount} — a real subtree must exceed its root`,
  );
  record.findings.push(
    `MEASURED: Figma's parser expanded a 3-element SVG into ${svgResult.createdNodeCount} nodes (${svgResult.width}x${svgResult.height}). The offline harness models structure only and never predicted this number.`,
  );

  // ── §4. Non-idempotency, MEASURED against the page rather than trusted from the flag ────
  const pageBeforeRerun = (await callJson("get_document_info")).value;
  const secondSvg = (
    await callJson("create_node_from_svg", { svg: SVG_SOURCE, x: 200, y: 0, name: "svg-probe-2" })
  ).value;
  const pageAfterRerun = (await callJson("get_document_info")).value;

  record.checks.nonIdempotent = {
    firstId: svgResult.id,
    secondId: secondSvg.id,
    childCountBefore: pageBeforeRerun.currentPage?.childCount,
    childCountAfter: pageAfterRerun.currentPage?.childCount,
    declared: secondSvg.duplicatesOnRerun,
  };
  assert.notEqual(secondSvg.id, svgResult.id, "a rerun must create a second subtree");
  assert.equal(
    pageAfterRerun.currentPage?.childCount,
    (pageBeforeRerun.currentPage?.childCount ?? 0) + 1,
    "the page must gain a second top-level frame — the declared duplication, observed",
  );

  // ── §5. THE CROP REPAIR, measured in rendered bytes ────────────────────────────────────
  //
  // ⛔ A bare CROP is refused now, so the identity render is produced DELIBERATELY by passing
  // the identity matrix — reproducing the old defect as a comparison point rather than
  // describing it. Three transforms must give three distinct byte streams; if any two match,
  // the transform is not reaching Figma and the whole repair is decorative.
  const cropNode = await callNodeId("create_rectangle", {
    x: 0,
    y: 120,
    width: 100,
    height: 100,
    name: "crop-probe",
  });
  const controlNode = await callNodeId("create_rectangle", {
    x: 150,
    y: 120,
    width: 100,
    height: 100,
    name: "crop-control",
  });

  await call("set_image_fill", {
    nodeId: controlNode,
    imageBase64: PROBE_PNG_BASE64,
    scaleMode: "FILL",
  });
  const controlBefore = await renderBytes(controlNode, "control-fill-before");

  const renders = {};
  for (const [label, imageTransform] of [
    ["identity", TRANSFORM_IDENTITY],
    ["left-third", TRANSFORM_LEFT_THIRD],
    ["right-third", TRANSFORM_RIGHT_THIRD],
  ]) {
    const reply = (
      await callTrailingJson("set_image_fill", {
        nodeId: cropNode,
        imageBase64: PROBE_PNG_BASE64,
        scaleMode: "CROP",
        imageTransform,
      })
    ).value;
    const render = await renderBytes(cropNode, `crop-${label}`);
    renders[label] = {
      requested: imageTransform,
      receiptTransform: reply.imageTransform,
      receiptTransformSource: reply.imageTransformSource,
      receiptScaleMode: reply.scaleMode,
      receiptScaleModeReadable: reply.scaleModeReadable,
      sha256: render.sha256,
      byteLength: render.byteLength,
      filePath: render.filePath,
    };
    assert.equal(reply.imageTransformSource, "caller");
    assert.deepEqual(
      reply.imageTransform,
      frounded(imageTransform),
      `${label}: the receipt must report the float32 the node actually holds, not the double that was sent`,
    );
  }

  // FILL on the same node, as a fourth distinct state.
  await call("set_image_fill", {
    nodeId: cropNode,
    imageBase64: PROBE_PNG_BASE64,
    scaleMode: "FILL",
  });
  renders.fill = await renderBytes(cropNode, "crop-as-fill").then((render) => ({
    sha256: render.sha256,
    byteLength: render.byteLength,
    filePath: render.filePath,
  }));

  const hashes = {
    identity: renders.identity.sha256,
    leftThird: renders["left-third"].sha256,
    rightThird: renders["right-third"].sha256,
    fill: renders.fill.sha256,
  };
  const distinct = new Set(Object.values(hashes));
  record.checks.cropRendersDistinct = { hashes, distinctCount: distinct.size };
  assert.equal(
    distinct.size,
    4,
    `four states must render four distinct byte streams; got ${distinct.size} — a repeated hash means Figma ignored the transform`,
  );

  const controlAfter = await renderBytes(controlNode, "control-fill-after");
  record.checks.controlHeld = {
    before: controlBefore.sha256,
    after: controlAfter.sha256,
    identical: controlBefore.sha256 === controlAfter.sha256,
  };
  assert.equal(
    record.checks.controlHeld.identical,
    true,
    "an untouched control must render byte-identical across the whole section",
  );
  record.findings.push(
    "MEASURED: Figma HONOURS a caller-supplied imageTransform. Identity, left-third, right-third and FILL produced four distinct renders on one node while an untouched control held byte-identical. This is the claim the whole CROP repair rests on and no offline test could reach it.",
  );

  // ── §6. The refusals, each from its declared layer, with the document untouched ─────────
  const sceneBefore = await renderBytes(cropNode, "scene-before-refusals");
  const refusals = {};

  refusals.bareCrop = await callExpectingRefusal("set_image_fill", {
    nodeId: cropNode,
    imageBase64: PROBE_PNG_BASE64,
    scaleMode: "CROP",
  });
  refusals.transformWithFill = await callExpectingRefusal("set_image_fill", {
    nodeId: cropNode,
    imageBase64: PROBE_PNG_BASE64,
    scaleMode: "FILL",
    imageTransform: TRANSFORM_LEFT_THIRD,
  });
  refusals.shortMatrix = await callExpectingRefusal("set_image_fill", {
    nodeId: cropNode,
    imageBase64: PROBE_PNG_BASE64,
    scaleMode: "CROP",
    imageTransform: [[1, 0, 0]],
  });
  refusals.emptySvg = await callExpectingRefusal("create_node_from_svg", { svg: "" });
  refusals.garbageSvg = await callExpectingRefusal("create_node_from_svg", {
    svg: "not markup at all",
  });

  record.checks.refusals = refusals;
  for (const [name, refusal] of Object.entries(refusals)) {
    assert.equal(refusal.refused, true, `${name} was not refused`);
  }
  // ⛔ The bare-CROP refusal must come from the HANDLER: the schema still accepts CROP as an
  // enum value, so a schema-layer refusal here would mean the enum had been narrowed instead
  // — a breaking change this repair deliberately did not make.
  assert.equal(
    refusals.bareCrop.layer,
    "handler",
    "a bare CROP must be refused by the handler, not by a narrowed schema enum",
  );
  assert.match(refusals.bareCrop.message, /requires imageTransform/);

  const sceneAfter = await renderBytes(cropNode, "scene-after-refusals");
  record.checks.refusalsLeftSceneUntouched = sceneBefore.sha256 === sceneAfter.sha256;
  assert.equal(
    record.checks.refusalsLeftSceneUntouched,
    true,
    "a refused write changed the rendered scene",
  );

  record.stillOwed.push(
    "The DIRECTION of each transform is established by INSPECTING the retained PNGs, not by an assertion inside this gate — byte inequality proves the four states are distinguishable, never which is which. Same limit as the gradient angle in live-fill-gate. ✅ CONFIRMED BY EYE 2026-08-23: left-third [[0.34,0,0],[0,1,0]] rendered the BLACK edge marker and red (the image's leftmost 34%); right-third [[0.34,0,0.66],[0,1,0]] rendered blue and the WHITE edge marker (its rightmost 34%). So column 3 is the OFFSET and a larger value moves the crop window rightward. Identity showed BOTH markers (the stretch the old bare CROP produced) and FILL showed NEITHER (a centre crop). ⛔ Re-confirm by eye if the transform plumbing is ever touched.",
  );
  record.stillOwed.push(
    "createdNodeCount is asserted as >1 rather than as an exact number. Figma's parser owns that number and pinning it here would pin a platform detail this gate cannot defend across Figma releases.",
  );
  record.stillOwed.push(
    "set_image_fill remains `stable` and its reply gained three fields (imageTransform, imageTransformSource, scaleModeReadable). compatibilityErrors() does not compare result shapes, so nothing mechanical guards them — only this gate.",
  );

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
          JSON.stringify((pagesAfter.pages ?? []).map((page) => page.id)) ===
            JSON.stringify(record.baseline?.pageIds),
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
  process.stderr.write(`R2.7 Phase 2 svg / crop live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.7 Phase 2 svg / crop live gate PASSED\n");
