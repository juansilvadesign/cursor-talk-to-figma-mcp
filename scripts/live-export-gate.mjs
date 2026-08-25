#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
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
    "Usage: node scripts/live-export-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

const expectedRuntime = {
  release: "R3-A",
  serverBuildId: "r3-a-server-cfce6484d54a",
  pluginBuildId: "r3-a-plugin-07a616c3b48d",
  schemaVersion: "1.15.0",
  fingerprint:
    "sha256:5e6dcb91bd57c355bd6a2c3e9bb58cf393d6c01bca1d8cb847e69a4d9fee1af3",
};
// ⛔ WAS `const nodeId = "1113:5031"` — a node in a DIFFERENT document, which made this
// gate silently unrunnable anywhere else. The sixteen-gate re-pin found it: the gate did not
// fail on a stale pin, it failed with "Node not found", because the fixture it needs had
// never been part of its own contract. A gate bound to one file's node ids is a gate that
// can only ever be re-run against that file.
const nodeId = options["node-id"];
if (!nodeId) {
  process.stderr.write(
    "Usage: node scripts/live-export-gate.mjs --channel=<DEV-plugin-channel> --node-id=<node whose area exceeds ~1.78 MPx so an over-limit scale exists> [--output-dir=<dir>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}
// The megapixel ceiling this gate expects the PLATFORM to enforce. It is not used to decide
// the verdict — the refusal's own reported limit is asserted against it below — only to
// derive a scale that is guaranteed to be over it for THIS node.
const expectedMegapixelLimit = 16;
// ⭐ DERIVED from the node's measured bounds, not hardcoded. A fixed scale of 3 only trips a
// 16 MP ceiling for nodes above ~1.78 MPx; below that the export simply succeeds and the
// gate fails for a reason that has nothing to do with export safety.
let rejectedScale = null;
const preferredScale = 0.5;
const serverPath = path.resolve(options.server || path.join(root, "dist/server.js"));
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.1-live-"));
await mkdir(artifactDirectory, { recursive: true });

const rejectedPath = path.join(artifactDirectory, "rejected-3x.png");
const preferredPath = path.join(artifactDirectory, "preferred-0.5x.png");
const exportedPath = path.join(artifactDirectory, "accepted-safe.png");
const reportPath = path.join(artifactDirectory, "report.json");
const client = new Client({ name: "talk-to-figma-r2.1-export-gate", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: root,
  // The server's debug stream includes raw relay responses, including export base64.
  // The report below retains the useful diagnostics without echoing image bytes.
  stderr: "ignore",
});

function textContent(result) {
  return (result.content || [])
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
}

async function callRaw(name, args = {}, timeout = 60_000) {
  return client.callTool(
    { name, arguments: args },
    undefined,
    { timeout, maxTotalTimeout: timeout },
  );
}

async function call(name, args = {}, timeout = 60_000) {
  const result = await callRaw(name, args, timeout);
  const text = textContent(result);
  if (result.isError || /^Error\b/.test(text)) {
    throw new Error(`${name} failed: ${text || "unknown MCP error"}`);
  }
  return { result, text };
}

async function callJson(name, args = {}, timeout = 60_000) {
  const called = await call(name, args, timeout);
  return { ...called, value: JSON.parse(called.text) };
}

async function joinWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt++) {
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
  assert.equal(runtime.server.release, expectedRuntime.release);
  assert.equal(runtime.server.buildId, expectedRuntime.serverBuildId);
  assert.equal(runtime.server.schemaVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.server.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.plugin?.release, expectedRuntime.release);
  assert.equal(runtime.plugin?.buildId, expectedRuntime.pluginBuildId);
  assert.equal(runtime.plugin?.apiVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.plugin?.serverSchemaVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.plugin?.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.compatibility.status, "compatible");
  assert.deepEqual(runtime.compatibility.issues, []);
}

function parseRefusal(message) {
  const match = /node [^:]+:[^:]+: ([\d.]+)x([\d.]+) at scale ([\d.]+) projects to (\d+)x(\d+) \(([\d.]+) MP\), above the (\d+) MP safety ceiling/.exec(message);
  assert.ok(match, `Refusal did not report projected dimensions/MP/ceiling: ${message}`);
  return {
    boundsWidth: Number(match[1]),
    boundsHeight: Number(match[2]),
    scale: Number(match[3]),
    projectedWidth: Number(match[4]),
    projectedHeight: Number(match[5]),
    projectedMegapixels: Number(match[6]),
    megapixelLimit: Number(match[7]),
  };
}

function projectedMegapixels(boundsWidth, boundsHeight, scale) {
  return (Math.ceil(boundsWidth * scale) * Math.ceil(boundsHeight * scale)) / 1_000_000;
}

function chooseSafeScale(refusal) {
  if (
    projectedMegapixels(refusal.boundsWidth, refusal.boundsHeight, preferredScale) <=
    refusal.megapixelLimit
  ) {
    return preferredScale;
  }
  const exactCeiling = Math.sqrt(
    (refusal.megapixelLimit * 1_000_000) /
      (refusal.boundsWidth * refusal.boundsHeight),
  );
  const conservativeTenth = Math.floor(exactCeiling * 10) / 10;
  assert.ok(conservativeTenth > 0, "Could not derive a positive scale below the ceiling");
  return conservativeTenth;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function readPngDimensions(bytes) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bytes.length >= 24, "Exported PNG is too short to contain an IHDR chunk");
  assert.ok(bytes.subarray(0, 8).equals(pngSignature), "Exported file has no PNG signature");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const record = {
  ranAt: new Date().toISOString(),
  channel: options.channel,
  serverPath,
  artifactDirectory,
  nodeId,
  inventory: null,
  runtimeBefore: null,
  rejected: null,
  runtimeAfterRefusal: null,
  preferredScaleAttempt: null,
  runtimeAfterPreferredScale: null,
  accepted: null,
  runtimeAfterExport: null,
  pagesAfterExport: null,
};

let failure;
try {
  await client.connect(transport);

  const [tools, prompts] = await Promise.all([client.listTools(), client.listPrompts()]);
  const toolNames = tools.tools.map((tool) => tool.name);
  for (const requiredTool of [
    "export_node_as_image",
    "get_pages",
    "get_runtime_info",
    "join_channel",
  ]) {
    assert.ok(toolNames.includes(requiredTool), `Runtime tool surface is missing ${requiredTool}`);
  }
  record.inventory = {
    toolCount: toolNames.length,
    promptCount: prompts.prompts.length,
    requiredToolsPresent: true,
  };

  await joinWithRetry();
  const before = await callJson("get_runtime_info");
  assertRuntime(before.value);
  record.runtimeBefore = before.value;

  // ⭐ MEASURE THE NODE, THEN CHOOSE A SCALE THAT MUST BE REFUSED. The old gate hardcoded
  // scale 3 and trusted that it exceeded the ceiling — true only for the one node it named.
  // Here the over-limit condition is computed from the node's real bounds and then CONFIRMED
  // by the platform's own refusal numbers, so the refusal can never be incidental.
  const measured = (await callJson("get_node_info", { nodeId })).value;
  const bounds = measured.absoluteBoundingBox;
  assert.ok(
    bounds && Number.isFinite(bounds.width) && Number.isFinite(bounds.height),
    `node ${nodeId} has no finite absoluteBoundingBox, so no scale can be derived from it`,
  );
  const areaPx = bounds.width * bounds.height;
  // Smallest 0.1-step scale whose projection clears the ceiling, plus one step of margin so
  // float rounding cannot land exactly on it.
  const minimumOverLimitScale = Math.sqrt((expectedMegapixelLimit * 1_000_000) / areaPx);
  rejectedScale = Math.round((minimumOverLimitScale + 0.1) * 10) / 10;
  const projectedAtRejected = projectedMegapixels(bounds.width, bounds.height, rejectedScale);
  assert.ok(
    projectedAtRejected > expectedMegapixelLimit,
    `derived scale ${rejectedScale} projects ${projectedAtRejected} MP, which does not exceed the ${expectedMegapixelLimit} MP ceiling — pick a larger node`,
  );
  record.fixture = {
    nodeId,
    nodeName: measured.name,
    nodeType: measured.type,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
    areaPx,
    expectedMegapixelLimit,
    derivedRejectedScale: rejectedScale,
    projectedMegapixelsAtRejectedScale: projectedAtRejected,
  };

  const rejectedStarted = Date.now();
  const rejectedResult = await callRaw(
    "export_node_as_image",
    {
      nodeId,
      format: "PNG",
      scale: rejectedScale,
      filePath: rejectedPath,
    },
    130_000,
  );
  const rejectedDurationMs = Date.now() - rejectedStarted;
  const rejectedMessage = textContent(rejectedResult);
  assert.match(rejectedMessage, /^Error exporting node as image: Export preflight refused PNG/);
  assert.doesNotMatch(rejectedMessage, /timed out/i);
  assert.ok(
    rejectedDurationMs < 10_000,
    `Over-limit export took ${rejectedDurationMs} ms to refuse`,
  );
  const refusal = parseRefusal(rejectedMessage);
  // ⛔ The ceiling this gate DERIVED its scale from must be the ceiling the platform actually
  // enforces. Without this, a platform change to the limit would silently turn the derivation
  // into a guess and the refusal into luck.
  assert.equal(
    refusal.megapixelLimit,
    expectedMegapixelLimit,
    "the platform's megapixel ceiling moved; the derived scale is no longer known to exceed it",
  );
  assert.ok(refusal.projectedMegapixels > refusal.megapixelLimit);
  const rejectedFileExists = await pathExists(rejectedPath);
  assert.equal(rejectedFileExists, false, "Rejected export unexpectedly wrote a file");
  record.rejected = {
    scale: rejectedScale,
    durationMs: rejectedDurationMs,
    message: rejectedMessage,
    ...refusal,
    filePath: rejectedPath,
    fileExists: rejectedFileExists,
  };

  const afterRefusalStarted = Date.now();
  const afterRefusal = await callJson("get_runtime_info");
  const afterRefusalDurationMs = Date.now() - afterRefusalStarted;
  assertRuntime(afterRefusal.value);
  record.runtimeAfterRefusal = {
    durationMs: afterRefusalDurationMs,
    ...afterRefusal.value,
  };

  const acceptedScale = chooseSafeScale(refusal);
  if (acceptedScale !== preferredScale) {
    const preferredStarted = Date.now();
    const preferredResult = await callRaw(
      "export_node_as_image",
      {
        nodeId,
        format: "PNG",
        scale: preferredScale,
        filePath: preferredPath,
      },
      130_000,
    );
    const preferredDurationMs = Date.now() - preferredStarted;
    const preferredMessage = textContent(preferredResult);
    assert.match(preferredMessage, /^Error exporting node as image: Export preflight refused PNG/);
    assert.doesNotMatch(preferredMessage, /timed out/i);
    const preferredRefusal = parseRefusal(preferredMessage);
    assert.equal(preferredRefusal.scale, preferredScale);
    assert.ok(preferredRefusal.projectedMegapixels > preferredRefusal.megapixelLimit);
    const preferredFileExists = await pathExists(preferredPath);
    assert.equal(preferredFileExists, false, "Rejected preferred-scale export wrote a file");
    record.preferredScaleAttempt = {
      durationMs: preferredDurationMs,
      message: preferredMessage,
      ...preferredRefusal,
      filePath: preferredPath,
      fileExists: preferredFileExists,
      derivedSafeScale: acceptedScale,
    };

    const afterPreferredStarted = Date.now();
    const afterPreferred = await callJson("get_runtime_info");
    const afterPreferredDurationMs = Date.now() - afterPreferredStarted;
    assertRuntime(afterPreferred.value);
    record.runtimeAfterPreferredScale = {
      durationMs: afterPreferredDurationMs,
      ...afterPreferred.value,
    };
  }

  const acceptedStarted = Date.now();
  const accepted = await callJson(
    "export_node_as_image",
    {
      nodeId,
      format: "PNG",
      scale: acceptedScale,
      filePath: exportedPath,
    },
    130_000,
  );
  const acceptedDurationMs = Date.now() - acceptedStarted;
  assert.ok(acceptedDurationMs < 120_000, "Safe export exceeded the server's 120 s budget");
  assert.equal(
    accepted.result.content.some((entry) => entry.type === "image"),
    false,
    "filePath export leaked an inline image block",
  );

  const receipt = accepted.value;
  assert.equal(receipt.nodeId, nodeId);
  assert.equal(receipt.format, "PNG");
  assert.equal(receipt.scale, acceptedScale);
  assert.equal(receipt.mimeType, "image/png");
  assert.equal(receipt.delivery, "file");
  assert.equal(receipt.path, exportedPath);
  assert.equal(receipt.dimensionSource, "png-ihdr");
  assert.equal(receipt.preflight?.costKnown, true);
  assert.equal(receipt.preflight?.limitApplied, true);
  assert.equal(receipt.preflight?.overLimit, false);
  assert.equal(receipt.preflight?.overrideUsed, false);
  assert.ok(receipt.preflight?.projectedMegapixels <= receipt.preflight?.megapixelLimit);

  const diskBytes = await readFile(exportedPath);
  const diskHash = createHash("sha256").update(diskBytes).digest("hex");
  const diskDimensions = readPngDimensions(diskBytes);
  assert.equal(diskBytes.length, receipt.bytes);
  assert.equal(diskHash, receipt.sha256);
  assert.equal(diskDimensions.width, receipt.width);
  assert.equal(diskDimensions.height, receipt.height);
  record.accepted = {
    scale: acceptedScale,
    durationMs: acceptedDurationMs,
    receipt,
    diskVerification: {
      bytes: diskBytes.length,
      sha256: diskHash,
      ...diskDimensions,
      matchesReceipt: true,
    },
    inlineImageReturned: false,
  };

  const afterExportStarted = Date.now();
  const afterExport = await callJson("get_runtime_info");
  const afterExportDurationMs = Date.now() - afterExportStarted;
  assertRuntime(afterExport.value);
  record.runtimeAfterExport = {
    durationMs: afterExportDurationMs,
    ...afterExport.value,
  };

  const pagesStarted = Date.now();
  const pages = await callJson("get_pages", { includeChildCount: false });
  const pagesDurationMs = Date.now() - pagesStarted;
  assert.equal(pages.value.scope, "document");
  assert.ok(pages.value.pageCount > 0);
  assert.equal(pages.value.pages.length, pages.value.pageCount);
  record.pagesAfterExport = {
    durationMs: pagesDurationMs,
    scope: pages.value.scope,
    currentPageId: pages.value.currentPageId,
    pageCount: pages.value.pageCount,
    childCountIncluded: pages.value.childCountIncluded,
  };
} catch (error) {
  failure = error;
  record.failure = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  await client.close().catch(() => undefined);
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        reportPath,
        ranAt: record.ranAt,
        channel: record.channel,
        success: !failure,
        runtime: record.runtimeBefore
          ? {
              server: record.runtimeBefore.server.buildId,
              plugin: record.runtimeBefore.plugin?.buildId,
              compatibility: record.runtimeBefore.compatibility.status,
            }
          : null,
        rejected: record.rejected,
        preferredScaleAttempt: record.preferredScaleAttempt,
        accepted: record.accepted,
        runtimeAfterExport: record.runtimeAfterExport
          ? {
              durationMs: record.runtimeAfterExport.durationMs,
              compatibility: record.runtimeAfterExport.compatibility.status,
            }
          : null,
        pagesAfterExport: record.pagesAfterExport,
        failure: record.failure,
      },
      null,
      2,
    )}\n`,
  );
}

if (failure) throw failure;
