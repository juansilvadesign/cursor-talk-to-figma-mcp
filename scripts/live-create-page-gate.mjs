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
    "Usage: node scripts/live-create-page-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// The exact R2.2 pair. Verified BEFORE any mutation: the R2.1 gate proved its worth by
// correctly refusing to measure an R1 runtime, and a page-creating write is worse to
// attribute to the wrong build than a read is.
const expectedRuntime = {
  release: "R3-A",
  serverBuildId: "r3-a-server-d0897984aeb6",
  pluginBuildId: "r3-a-plugin-07a616c3b48d",
  schemaVersion: "1.17.0",
  fingerprint:
    "sha256:b67c85d4b655cc5c7f10aa28dd55f450b63f2a292a06585b49d39559bd6e4fbd",
};

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const baseName = `R2.2 Gate ${stamp}`;
const serverPath = path.resolve(options.server || path.join(root, "dist/server.js"));
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.2-live-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

const client = new Client({
  name: "talk-to-figma-r2.2-create-page-gate",
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

// A refusal is a first-class outcome here, not an exception: the whole point of the
// default duplicate policy is that it refuses. Capture the message instead of throwing.
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
    // A schema-level rejection — an unsupported enum value, a non-integer index —
    // surfaces as a thrown MCP protocol error, never as a tool result. That is the
    // stronger refusal of the two: it never reaches Figma at all. The gate has to
    // accept both shapes, or it mistakes the better outcome for a crash.
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
  assert.ok(
    runtime.server.supportedTools.includes("create_page"),
    "server does not expose create_page",
  );
  assert.ok(
    runtime.plugin?.supportedCommands.includes("create_page"),
    "plugin does not dispatch create_page",
  );
  assert.ok(
    runtime.plugin?.capabilityIds.includes("figma.command.create_page@1"),
    "plugin does not declare the create_page capability",
  );
}

function pageSignature(pages) {
  return pages.pages.map((page) => `${page.id}:${page.name}`);
}

const record = {
  ranAt: new Date().toISOString(),
  channel: options.channel,
  serverPath,
  artifactDirectory,
  baseName,
};

const createdPageIds = [];
let failure = null;

try {
  await client.connect(transport);

  const inventory = await client.listTools();
  record.inventory = {
    toolCount: inventory.tools.length,
    createPagePresent: inventory.tools.some((tool) => tool.name === "create_page"),
  };
  assert.equal(record.inventory.createPagePresent, true);

  await joinWithRetry();

  const runtimeBefore = await callJson("get_runtime_info");
  record.runtimeBefore = runtimeBefore.value;
  assertRuntime(runtimeBefore.value);

  const pagesBefore = await callJson("get_pages", {}, 120_000);
  record.pagesBefore = pagesBefore.value;
  const baselineSignature = pageSignature(pagesBefore.value);
  const baselineCount = pagesBefore.value.pageCount;
  const baselineCurrentPageId = pagesBefore.value.currentPageId;

  // 1 — append a uniquely named page under the default policy.
  const appendStarted = Date.now();
  const appended = await callJson("create_page", { name: baseName });
  record.appended = { ...appended.value, durationMs: Date.now() - appendStarted };
  createdPageIds.push(appended.value.id);

  assert.equal(appended.value.name, baseName);
  assert.equal(appended.value.index, baselineCount, "no index must append last");
  assert.equal(appended.value.requestedIndex, null);
  assert.equal(appended.value.pageCount, baselineCount + 1);
  assert.equal(appended.value.onDuplicate, "error");
  assert.equal(appended.value.duplicateNameExisted, false);
  assert.deepEqual(appended.value.existingPageIds, []);

  // 2 — the document agrees, and creating did not navigate.
  const pagesAfterAppend = await callJson("get_pages", {}, 120_000);
  record.pagesAfterAppend = pagesAfterAppend.value;
  assert.equal(pagesAfterAppend.value.pageCount, baselineCount + 1);
  assert.equal(pagesAfterAppend.value.pages.at(-1).id, appended.value.id);
  assert.equal(
    pagesAfterAppend.value.currentPageId,
    baselineCurrentPageId,
    "create_page must not switch the active page",
  );

  // 3 — the same name is refused by default, and the refusal is actionable.
  const refusal = await callExpectingRefusal("create_page", { name: baseName });
  record.duplicateRefused = refusal;
  assert.match(refusal.message, /already exists/);
  assert.ok(
    refusal.message.includes(appended.value.id),
    `refusal must name the colliding page id: ${refusal.message}`,
  );
  assert.match(refusal.message, /onDuplicate/);

  const pagesAfterRefusal = await callJson("get_pages", {}, 120_000);
  record.pagesAfterRefusal = pagesAfterRefusal.value;
  assert.equal(
    pagesAfterRefusal.value.pageCount,
    baselineCount + 1,
    "a refused create must not mutate the document",
  );

  // 4 — the same name is created only when explicitly allowed, and says so.
  const allowed = await callJson("create_page", {
    name: baseName,
    onDuplicate: "allow",
  });
  record.duplicateAllowed = allowed.value;
  createdPageIds.push(allowed.value.id);
  assert.equal(allowed.value.onDuplicate, "allow");
  assert.equal(allowed.value.duplicateNameExisted, true);
  assert.deepEqual(allowed.value.existingPageIds, [appended.value.id]);
  assert.notEqual(allowed.value.id, appended.value.id, "allow creates, it does not reuse");

  // 5 — an explicit index places the page, and the receipt reports the observed slot.
  const positionedName = `${baseName} First`;
  const positioned = await callJson("create_page", {
    name: positionedName,
    index: 0,
  });
  record.positioned = positioned.value;
  createdPageIds.push(positioned.value.id);
  assert.equal(positioned.value.requestedIndex, 0);
  assert.equal(positioned.value.index, 0);

  const pagesAfterPositioned = await callJson("get_pages", {}, 120_000);
  record.pagesAfterPositioned = pagesAfterPositioned.value;
  assert.equal(pagesAfterPositioned.value.pages[0].id, positioned.value.id);
  assert.equal(
    pagesAfterPositioned.value.pages[1].id,
    pagesBefore.value.pages[0].id,
    "inserting at 0 must shift the previous first page, not replace it",
  );

  // 6 — invalid input is refused before the document is touched.
  const countBeforeInvalid = pagesAfterPositioned.value.pageCount;
  record.invalidInput = {
    emptyName: await callExpectingRefusal("create_page", { name: "   " }),
    unsupportedPolicy: await callExpectingRefusal("create_page", {
      name: `${baseName} Policy`,
      onDuplicate: "reuse",
    }),
    negativeIndex: await callExpectingRefusal("create_page", {
      name: `${baseName} Index`,
      index: -1,
    }),
    outOfRangeIndex: await callExpectingRefusal("create_page", {
      name: `${baseName} Index`,
      index: countBeforeInvalid + 5,
    }),
  };

  const pagesAfterInvalid = await callJson("get_pages", {}, 120_000);
  record.pagesAfterInvalid = pagesAfterInvalid.value;
  assert.equal(
    pagesAfterInvalid.value.pageCount,
    countBeforeInvalid,
    "no rejected call may leave a page behind",
  );

  // 7 — remove exactly what this gate created, in reverse.
  record.cleanup = [];
  for (const pageId of [...createdPageIds].reverse()) {
    const deleted = await call("delete_node", { nodeId: pageId });
    record.cleanup.push({ pageId, reply: deleted.text });
  }

  // 8 — the document is back to its baseline, page for page.
  const pagesAfterCleanup = await callJson("get_pages", {}, 120_000);
  record.pagesAfterCleanup = pagesAfterCleanup.value;
  assert.equal(pagesAfterCleanup.value.pageCount, baselineCount);
  assert.deepEqual(
    pageSignature(pagesAfterCleanup.value),
    baselineSignature,
    "cleanup must restore the exact page list, in order",
  );
  assert.equal(pagesAfterCleanup.value.currentPageId, baselineCurrentPageId);

  // 9 — the plugin is still healthy; a write gate that wedges the session is not a pass.
  const runtimeStarted = Date.now();
  const runtimeAfter = await callJson("get_runtime_info");
  record.runtimeAfter = {
    ...runtimeAfter.value,
    durationMs: Date.now() - runtimeStarted,
  };
  assertRuntime(runtimeAfter.value);

  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error instanceof Error ? error.stack || error.message : String(error);
  record.createdPageIdsAtFailure = createdPageIds;
} finally {
  await client.close().catch(() => undefined);
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        reportPath,
        ranAt: record.ranAt,
        channel: record.channel,
        success: Boolean(record.success),
        runtime: record.runtimeBefore
          ? {
              server: record.runtimeBefore.server.buildId,
              plugin: record.runtimeBefore.plugin?.buildId,
              schema: record.runtimeBefore.server.schemaVersion,
              compatibility: record.runtimeBefore.compatibility.status,
            }
          : null,
        appended: record.appended,
        duplicateRefused: record.duplicateRefused,
        duplicateAllowed: record.duplicateAllowed,
        positioned: record.positioned,
        invalidInput: record.invalidInput,
        cleanupCount: record.cleanup?.length ?? 0,
        pagesRestored: record.pagesAfterCleanup?.pageCount ?? null,
        runtimeAfterMs: record.runtimeAfter?.durationMs ?? null,
        failure: record.failure,
      },
      null,
      2,
    )}\n`,
  );
}

if (failure) throw failure;
