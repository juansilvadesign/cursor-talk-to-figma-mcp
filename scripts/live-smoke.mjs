#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
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
    "Usage: node scripts/live-smoke.mjs --channel=<DEV-plugin-channel> [--output=<json-path>]\n",
  );
  process.exit(2);
}

const serverPath = path.resolve(options.server || path.join(root, "dist/server.js"));
const client = new Client({ name: "talk-to-figma-r0-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: root,
  stderr: "inherit",
});

function textContent(result) {
  return (result.content || [])
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
}

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = textContent(result);
  if (result.isError || /^Error\b/.test(text)) {
    throw new Error(`${name} failed: ${text || "unknown MCP error"}`);
  }
  return { result, text };
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

function createdNodeId(text) {
  const match = /\bID:\s*([0-9]+:[0-9]+)/.exec(text);
  if (!match) throw new Error(`Could not parse created node ID from: ${text}`);
  return match[1];
}

const createdIds = [];
const record = {
  ranAt: new Date().toISOString(),
  serverPath,
  runtime: null,
  read: null,
  write: { created: [], readBack: null, cleaned: [] },
};

try {
  await client.connect(transport);
  await joinWithRetry();

  const runtimeCall = await call("get_runtime_info");
  record.runtime = JSON.parse(runtimeCall.text);
  if (record.runtime.compatibility.status !== "compatible") {
    throw new Error(
      `Runtime preflight is ${record.runtime.compatibility.status}: ${record.runtime.compatibility.issues.join(" ")}`,
    );
  }

  const readCall = await call("get_document_info", {
    summary: true,
    limit: 5,
    offset: 0,
    familyLimit: 5,
  });
  const read = JSON.parse(readCall.text);
  if (read.children.length > 5 || read.pagination.limit !== 5) {
    throw new Error("Bounded read returned outside the requested limit");
  }
  record.read = {
    scope: read.scope,
    pageId: read.currentPage.id,
    childCount: read.currentPage.childCount,
    returned: read.pagination.returned,
    hasMore: read.pagination.hasMore,
  };

  const smokeName = `R0 Smoke ${Date.now()}`;
  const frameCall = await call("create_frame", {
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    name: smokeName,
    layoutMode: "VERTICAL",
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    itemSpacing: 8,
  });
  const frameId = createdNodeId(frameCall.text);
  createdIds.push(frameId);
  record.write.created.push({ type: "FRAME", id: frameId, name: smokeName });

  const textCall = await call("create_text", {
    x: 0,
    y: 0,
    text: "R0 reversible smoke",
    name: "R0 Smoke Text",
    parentId: frameId,
  });
  const textId = createdNodeId(textCall.text);
  createdIds.push(textId);
  record.write.created.push({ type: "TEXT", id: textId, name: "R0 Smoke Text" });

  const readBackCall = await call("get_node_info", { nodeId: frameId });
  const readBack = JSON.parse(readBackCall.text);
  if (readBack.id !== frameId || !readBack.children?.some((node) => node.id === textId)) {
    throw new Error("Created frame/text could not be read back exactly");
  }
  record.write.readBack = {
    frameId,
    frameName: readBack.name,
    textId,
    childCount: readBack.children.length,
  };
} finally {
  for (const nodeId of [...createdIds].reverse()) {
    try {
      await call("delete_node", { nodeId });
      record.write.cleaned.push(nodeId);
    } catch (error) {
      record.write.cleanupError = error.message;
    }
  }
  await client.close().catch(() => undefined);
}

const serialized = `${JSON.stringify(record, null, 2)}\n`;
if (options.output) {
  await writeFile(path.resolve(options.output), serialized);
}
process.stdout.write(serialized);
