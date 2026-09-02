#!/usr/bin/env node

/**
 * R3.2.1 live gate — original IMAGE-fill extraction.
 *
 * This is deliberately read-only. It proves that a caller can name one exact paint on
 * one node, receive its original Figma image bytes on disk, and preserve the paint
 * metadata that defines its placement without rasterizing or changing the containing node.
 *
 * Usage:
 *   node scripts/live-image-fill-export-gate.mjs \
 *     --channel <figma-channel> --node-id <node-id> --paint-index <index>
 */

import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedRuntime = {
  serverBuildId: "r3.2.1-server-cbd2531f8a0e",
  pluginBuildId: "r3.2.1-plugin-ad75ba5fe779",
  schemaVersion: "1.21.0",
  fingerprint: "sha256:f6f9c2bb7f12264f754f81afb2715fa3ba613208bec65b5713da639bc979902d",
  release: "R3.2.1",
  toolCount: 87,
};

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    options[key] = value;
    index += 1;
  }
  if (!options.channel) throw new Error("--channel is required");
  if (!options["node-id"]) throw new Error("--node-id is required");
  const paintIndex = Number.parseInt(options["paint-index"] || "", 10);
  if (!Number.isInteger(paintIndex) || paintIndex < 0) {
    throw new Error("--paint-index must be a non-negative integer");
  }
  return {
    channel: options.channel,
    nodeId: options["node-id"],
    paintIndex,
    serverPath: path.resolve(options.server || path.join(root, "dist/server.js")),
    outputDir: options["output-dir"]
      ? path.resolve(options["output-dir"])
      : null,
  };
}

function textContent(result) {
  return (result.content || [])
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
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

const options = parseArgs(process.argv.slice(2));
const artifactDirectory = options.outputDir || await mkdtemp(
  path.join(os.tmpdir(), "talk-to-figma-image-fill-live-"),
);
await mkdir(artifactDirectory, { recursive: true });
const assetPath = path.join(
  artifactDirectory,
  `node-${options.nodeId.replaceAll(":", "_")}-fill-${options.paintIndex}.asset`,
);
const reportPath = path.join(artifactDirectory, "report.json");
const client = new Client({ name: "talk-to-figma-r3.2.1-image-fill-gate", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [options.serverPath],
  cwd: root,
  stderr: "ignore",
});

async function call(name, args = {}, timeout = 120_000) {
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout, maxTotalTimeout: timeout },
  );
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

const report = {
  ranAt: new Date().toISOString(),
  channel: options.channel,
  nodeId: options.nodeId,
  paintIndex: options.paintIndex,
  serverPath: options.serverPath,
  artifactDirectory,
  assetPath,
  runtime: null,
  fillBefore: null,
  receipt: null,
  fillAfter: null,
  success: false,
  failure: null,
};

let failure;
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  assert.equal(toolNames.length, expectedRuntime.toolCount);
  for (const required of [
    "join_channel",
    "get_runtime_info",
    "get_node_info",
    "export_image_fill",
  ]) {
    assert.ok(toolNames.includes(required), `Runtime tool surface is missing ${required}`);
  }

  await joinWithRetry();
  const runtime = (await callJson("get_runtime_info")).value;
  assertRuntime(runtime);
  report.runtime = runtime;

  const before = (await callJson("get_node_info", { nodeId: options.nodeId })).value;
  const beforeFill = before.fills?.[options.paintIndex];
  assert.ok(beforeFill, `node ${options.nodeId} has no fill at index ${options.paintIndex}`);
  assert.equal(beforeFill.type, "IMAGE", "the selected fill must be IMAGE");
  report.fillBefore = beforeFill;

  const receipt = (await callJson("export_image_fill", {
    nodeId: options.nodeId,
    paintIndex: options.paintIndex,
    filePath: assetPath,
  })).value;
  assert.equal(receipt.nodeId, options.nodeId);
  assert.equal(receipt.paintIndex, options.paintIndex);
  assert.equal(receipt.delivery, "file");
  assert.equal(receipt.path, assetPath);
  assert.equal(receipt.imageFill?.type, "IMAGE");
  assert.equal(receipt.imageFill?.scaleMode, beforeFill.scaleMode);
  assert.equal(typeof receipt.imageHash, "string");
  assert.ok(receipt.imageHash.length > 0);
  assert.equal(await pathExists(assetPath), true, "the receipt must name a real artifact");
  const bytes = await readFile(assetPath);
  assert.equal(bytes.length, receipt.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), receipt.sha256);
  assert.ok(receipt.mimeType.startsWith("image/"), `unexpected image MIME ${receipt.mimeType}`);
  report.receipt = receipt;

  const after = (await callJson("get_node_info", { nodeId: options.nodeId })).value;
  assert.deepEqual(after, before, "a read-only image-fill export must not change the node");
  report.fillAfter = after.fills?.[options.paintIndex] || null;
  report.success = true;
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
  report.failure = failure.message;
} finally {
  await client.close().catch(() => undefined);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (failure) {
  console.error(`Image-fill live gate failed: ${failure.message}`);
  console.error(reportPath);
  process.exitCode = 1;
} else {
  console.log(`Image-fill live gate passed: ${reportPath}`);
}
