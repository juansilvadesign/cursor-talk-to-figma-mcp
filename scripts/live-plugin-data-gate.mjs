#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
    "Usage: node scripts/live-plugin-data-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

const expectedRuntime = {
  release: "R3-A",
  serverBuildId: "r3-a-server-7839c39d5302",
  pluginBuildId: "r3-a-plugin-07a616c3b48d",
  schemaVersion: "1.16.0",
  fingerprint:
    "sha256:34d09270ff74084cd134712e864bc891adbac5283e3bee625e330d043448db68",
};

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const scratchPageName = `R2.3 Gate ${stamp}`;
const namespace = "r2_3_gate";
const serverPath = path.resolve(options.server || path.join(root, "dist/server.js"));
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.3-live-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

const client = new Client({
  name: "talk-to-figma-r2.3-plugin-data-gate",
  version: "1.0.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: root,
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

// A refusal is an expected outcome in this gate, and it arrives in two shapes:
// a tool error result, or a thrown protocol error when the MCP schema rejects the
// argument before dispatch. R2.2's first run scored the second shape as a crash.
async function callExpectingRefusal(name, args = {}, timeout = 60_000) {
  const started = Date.now();
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
  const durationMs = Date.now() - started;
  assert.ok(
    refused,
    `${name} was expected to refuse ${JSON.stringify(args)} but it succeeded: ${message}`,
  );
  return { message, durationMs, layer };
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
  assert.equal(runtime.server.buildId, expectedRuntime.serverBuildId);
  assert.equal(runtime.server.schemaVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.server.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.plugin?.buildId, expectedRuntime.pluginBuildId);
  assert.equal(runtime.plugin?.apiVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.plugin?.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.compatibility.status, "compatible");
  assert.deepEqual(runtime.compatibility.issues, []);
  // ⛔ ADDED 2026-08-25. This gate CARRIED `release: "R2"` for eight releases and never
  // asserted it, so the pin was decoration — it looked like coverage and provided none.
  // Its two siblings (`live-export-gate`, `live-create-page-gate`) DO assert release, and
  // both correctly refused at the sixteen-gate re-run while this one sailed through on a
  // stale pin. A pin nothing reads cannot go stale loudly.
  assert.equal(runtime.server.release, expectedRuntime.release);
  assert.equal(runtime.plugin?.release, expectedRuntime.release);
  for (const tool of ["get_plugin_data", "set_plugin_data"]) {
    assert.ok(runtime.server.supportedTools.includes(tool), `server lacks ${tool}`);
    assert.ok(runtime.plugin?.supportedCommands.includes(tool), `plugin lacks ${tool}`);
  }
}

const record = {
  ranAt: new Date().toISOString(),
  channel: options.channel,
  serverPath,
  artifactDirectory,
  namespace,
  scratchPageName,
};

let scratchPageId = null;
let failure = null;

try {
  await client.connect(transport);
  const inventory = await client.listTools();
  record.inventory = { toolCount: inventory.tools.length };

  await joinWithRetry();
  const runtimeBefore = await callJson("get_runtime_info");
  record.runtimeBefore = runtimeBefore.value;
  assertRuntime(runtimeBefore.value);

  const pagesBefore = await callJson("get_pages", {}, 120_000);
  const baselineCount = pagesBefore.value.pageCount;

  // Dogfood R2.2: the gate writes metadata onto a page it created, so nothing
  // pre-existing in the document is ever touched.
  const page = await callJson("create_page", { name: scratchPageName });
  scratchPageId = page.value.id;
  record.scratchPage = page.value;

  // 1 — private store round-trip.
  const wrote = await callJson("set_plugin_data", {
    nodeId: scratchPageId,
    key: "capture-id",
    value: "run-7",
  });
  record.privateWrite = wrote.value;
  assert.equal(wrote.value.store, "private");
  assert.equal(wrote.value.namespace, null);
  assert.equal(wrote.value.operation, "set");
  assert.equal(wrote.value.existed, false);
  assert.equal(wrote.value.bytes, 5);
  assert.equal(wrote.value.nodeType, "PAGE");

  const readPrivate = await callJson("get_plugin_data", { nodeId: scratchPageId });
  record.privateRead = readPrivate.value;
  assert.equal(readPrivate.value.store, "private");
  assert.equal(readPrivate.value.keyCount, 1);
  assert.equal(readPrivate.value.entries[0].key, "capture-id");
  assert.equal(readPrivate.value.entries[0].value, "run-7");
  assert.equal(readPrivate.value.entries[0].present, true);
  assert.equal(readPrivate.value.complete, true);

  // 2 — the shared store is a different store, and namespaces are isolated.
  const wroteShared = await callJson("set_plugin_data", {
    nodeId: scratchPageId,
    key: "capture-id",
    value: "shared-run-7",
    namespace,
  });
  record.sharedWrite = wroteShared.value;
  assert.equal(wroteShared.value.store, "shared");
  assert.equal(wroteShared.value.namespace, namespace);

  const readShared = await callJson("get_plugin_data", {
    nodeId: scratchPageId,
    namespace,
  });
  record.sharedRead = readShared.value;
  assert.equal(readShared.value.entries[0].value, "shared-run-7");

  const readPrivateAgain = await callJson("get_plugin_data", {
    nodeId: scratchPageId,
    key: "capture-id",
  });
  assert.equal(
    readPrivateAgain.value.entries[0].value,
    "run-7",
    "the shared write must not have overwritten the private store",
  );

  const otherNamespace = await callJson("get_plugin_data", {
    nodeId: scratchPageId,
    namespace: "somebody_else",
  });
  record.foreignNamespace = otherNamespace.value;
  assert.equal(otherNamespace.value.keyCount, 0, "namespaces must be isolated");

  // 3 — an absent key is reported absent, not as an empty value.
  const absent = await callJson("get_plugin_data", {
    nodeId: scratchPageId,
    key: "never-set",
  });
  record.absentKey = absent.value;
  assert.equal(absent.value.entries[0].present, false);
  assert.equal(absent.value.entries[0].value, "");

  // 4 — key paging, with the count staying a whole-node total.
  for (let index = 0; index < 4; index++) {
    await call("set_plugin_data", {
      nodeId: scratchPageId,
      key: `k${index}`,
      value: `v${index}`,
    });
  }
  const paged = await callJson("get_plugin_data", {
    nodeId: scratchPageId,
    limit: 2,
    offset: 0,
  });
  record.paged = paged.value;
  assert.equal(paged.value.keyCount, 5, "4 added + capture-id");
  assert.equal(paged.value.pagination.returned, 2);
  assert.equal(paged.value.pagination.hasMore, true);
  assert.equal(paged.value.complete, false);

  // 5 — a large value is truncated in the reply but reported at true length.
  await call("set_plugin_data", {
    nodeId: scratchPageId,
    key: "big",
    value: "z".repeat(5000),
  });
  const truncated = await callJson("get_plugin_data", {
    nodeId: scratchPageId,
    key: "big",
    maxValueBytes: 100,
  });
  record.truncated = truncated.value;
  assert.equal(truncated.value.entries[0].value.length, 100);
  assert.equal(truncated.value.entries[0].bytes, 5000);
  assert.equal(truncated.value.entries[0].truncated, true);
  assert.equal(truncated.value.complete, false);

  // 6 — UTF-8 byte accounting, measured against a real Figma write.
  const unicode = await callJson("set_plugin_data", {
    nodeId: scratchPageId,
    key: "unicode",
    value: "é→😀",
  });
  record.unicode = unicode.value;
  assert.equal(unicode.value.bytes, 9, "2 + 3 + 4 UTF-8 bytes, not 5 UTF-16 units");

  // 7 — refusals.
  record.refusals = {
    emptyString: await callExpectingRefusal("set_plugin_data", {
      nodeId: scratchPageId,
      key: "capture-id",
      value: "",
    }),
    oversize: await callExpectingRefusal("set_plugin_data", {
      nodeId: scratchPageId,
      key: "huge",
      value: "z".repeat(100001),
    }),
    missingNode: await callExpectingRefusal("get_plugin_data", { nodeId: "0:404404" }),
    badNamespace: await callExpectingRefusal("get_plugin_data", {
      nodeId: scratchPageId,
      namespace: "   ",
    }),
    badLimit: await callExpectingRefusal("get_plugin_data", {
      nodeId: scratchPageId,
      limit: 0,
    }),
  };
  assert.match(record.refusals.emptyString.message, /cannot be stored/);
  assert.match(record.refusals.oversize.message, /per-entry ceiling/);

  const afterRefusals = await callJson("get_plugin_data", {
    nodeId: scratchPageId,
    key: "capture-id",
  });
  assert.equal(
    afterRefusals.value.entries[0].value,
    "run-7",
    "the refused empty-string write must not have deleted the key",
  );

  // 8 — null removes, and removing an absent key says so.
  const removed = await callJson("set_plugin_data", {
    nodeId: scratchPageId,
    key: "capture-id",
    value: null,
  });
  record.removed = removed.value;
  assert.equal(removed.value.operation, "removed");
  assert.equal(removed.value.existed, true);
  assert.equal(removed.value.bytes, null);

  const removeAbsent = await callJson("set_plugin_data", {
    nodeId: scratchPageId,
    key: "capture-id",
    value: null,
  });
  record.removeAbsent = removeAbsent.value;
  assert.equal(removeAbsent.value.operation, "noop_absent");
  assert.equal(removeAbsent.value.existed, false);

  const runtimeStarted = Date.now();
  const runtimeAfter = await callJson("get_runtime_info");
  record.runtimeAfter = {
    compatibility: runtimeAfter.value.compatibility,
    durationMs: Date.now() - runtimeStarted,
  };
  assertRuntime(runtimeAfter.value);

  record.baselineCount = baselineCount;
  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  // Clean up on BOTH paths. R2.2's first gate aborted before cleanup and left
  // three pages in a real document; a gate that mutates owns its wreckage.
  if (scratchPageId) {
    try {
      const deleted = await call("delete_node", { nodeId: scratchPageId });
      record.cleanup = { pageId: scratchPageId, reply: deleted.text };
      const pagesAfter = await callJson("get_pages", {}, 120_000);
      record.pagesAfterCleanup = pagesAfter.value.pageCount;
      record.cleanupRestoredBaseline =
        record.baselineCount === undefined
          ? null
          : pagesAfter.value.pageCount === record.baselineCount;
    } catch (cleanupError) {
      record.cleanupError =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
  }
  await client.close().catch(() => undefined);
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        reportPath,
        channel: record.channel,
        success: Boolean(record.success),
        toolCount: record.inventory?.toolCount ?? null,
        runtime: record.runtimeBefore
          ? {
              server: record.runtimeBefore.server.buildId,
              plugin: record.runtimeBefore.plugin?.buildId,
              schema: record.runtimeBefore.server.schemaVersion,
              compatibility: record.runtimeBefore.compatibility.status,
            }
          : null,
        privateWrite: record.privateWrite,
        sharedWrite: record.sharedWrite,
        foreignNamespaceKeyCount: record.foreignNamespace?.keyCount ?? null,
        absentKeyPresent: record.absentKey?.entries?.[0]?.present ?? null,
        paged: record.paged?.pagination ?? null,
        truncatedBytes: record.truncated?.entries?.[0]?.bytes ?? null,
        unicodeBytes: record.unicode?.bytes ?? null,
        refusals: record.refusals,
        removed: record.removed?.operation ?? null,
        removeAbsent: record.removeAbsent?.operation ?? null,
        cleanup: record.cleanup?.reply ?? null,
        cleanupRestoredBaseline: record.cleanupRestoredBaseline ?? null,
        cleanupError: record.cleanupError ?? null,
        runtimeAfterMs: record.runtimeAfter?.durationMs ?? null,
        failure: record.failure,
      },
      null,
      2,
    )}\n`,
  );
}

if (failure) throw failure;
