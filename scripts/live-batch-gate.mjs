#!/usr/bin/env node

/**
 * R2.4 5.5 — the `apply_batch` live gate.
 *
 * What this proves that the 98 offline tests cannot: that the contract holds against a
 * real Figma document, over the real transport, on the pinned server↔plugin pair.
 *
 * ⛔ Three traps this script is shaped by, each already paid for once:
 *
 *  1. A refusal is an EXPECTED outcome, and it arrives in two shapes. The plugin throws
 *     for an envelope refusal (duplicate `id`, disallowed `op`) and the MCP tool wrapper
 *     catches it into an error *result*; a schema-level rejection never reaches the
 *     wrapper and arrives as a thrown protocol error. `callExpectingRefusal` records
 *     which layer answered instead of scoring either as a crash.
 *  2. A gate that mutates cleans up in a `finally`, not on the success path. R2.2's
 *     first run aborted mid-gate and left three pages in a real document.
 *  3. A rebuild reaches neither running side. This script spawns its own server from
 *     `dist/server.js`, so a green run proves the BUILD — never the calling session's
 *     connection. It pins the exact pair and hashes both artifacts before starting, so
 *     the artifact exercised is provably the artifact documented.
 *
 * Every write lands on a scratch page this gate creates and deletes. The only
 * operations that name a real node are inside a `prevalidateOnly` batch, which writes
 * nothing by construction — that is how total prevalidation gets observed against real
 * content at zero risk.
 *
 * Usage:
 *   node scripts/live-batch-gate.mjs --channel=<DEV-plugin-channel> \
 *        [--output-dir=<artifact-directory>] [--server=<dist-server-path>]
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The gate asserts live replies against the SHIPPED vocabulary, not against string
// literals retyped here. A drift between the module and the runtime becomes a failure.
import {
  BATCH_ERROR_CODES,
  BATCH_ERROR_CODE_DELIVERY,
  BATCH_OUTCOMES,
  NON_ATOMIC_BATCH_OPERATIONS,
  V1_BATCH_OPERATIONS,
} from "../src/talk_to_figma_mcp/batch-receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

if (!options.channel) {
  process.stderr.write(
    "Usage: node scripts/live-batch-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

const expectedRuntime = {
  release: "R2",
  serverBuildId: "r2-server-9239fd0bc71b",
  pluginBuildId: "r2-plugin-d0342abb6c4a",
  schemaVersion: "1.5.0",
  fingerprint:
    "sha256:a87b5d98e8ef24f73d461c7d05cdd59e43bcf20d6c11a5cfdfc6e47128835704",
  toolCount: 53,
};

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const scratchPageName = `R2.4 Gate ${stamp}`;
const serverPath = path.resolve(options.server || path.join(root, "dist/server.js"));
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.4-live-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r2.4-batch-gate",
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

async function callRaw(name, args = {}, timeout = 120_000) {
  return client.callTool(
    { name, arguments: args },
    undefined,
    { timeout, maxTotalTimeout: timeout },
  );
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

// Several create tools answer in prose with the JSON or the id embedded. Parsing that
// here keeps the gate honest about what the tools actually return today.
async function callEmbeddedJson(name, args = {}) {
  const called = await call(name, args);
  const start = called.text.indexOf("{");
  const end = called.text.lastIndexOf("}");
  assert.ok(start >= 0 && end > start, `${name} returned no JSON object: ${called.text}`);
  return { ...called, value: JSON.parse(called.text.slice(start, end + 1)) };
}

async function callIdFromProse(name, args = {}) {
  const called = await call(name, args);
  const match = called.text.match(/with ID:\s*([^.\s]+)/);
  assert.ok(match, `${name} returned no node id: ${called.text}`);
  return { ...called, id: match[1] };
}

/**
 * A refusal is an expected outcome. `layer` records HOW it arrived:
 *   "handler" — the plugin threw and the tool wrapper caught it into an error result
 *   "schema"  — the MCP schema rejected the argument before dispatch, so it threw
 * BATCH_ERROR_CODE_DELIVERY calls both halves "thrown"; through this transport only the
 * schema half is literally thrown, and the gate records the distinction rather than
 * flattening it.
 */
async function callExpectingRefusal(name, args = {}, timeout = 120_000) {
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
  assert.ok(
    runtime.server.supportedTools.includes("apply_batch"),
    "server lacks apply_batch — it is still on a pre-1.5.0 build",
  );
  assert.ok(
    runtime.plugin?.supportedCommands.includes("apply_batch"),
    "plugin lacks apply_batch — re-run the DEV plugin, it holds code.js from launch",
  );
}

/** Every receipt, whatever the outcome, has to satisfy the contract's own invariants. */
function assertReceiptInvariants(receipt, context) {
  assert.ok(
    BATCH_OUTCOMES.includes(receipt.outcome),
    `${context}: unknown outcome ${JSON.stringify(receipt.outcome)}`,
  );
  assert.equal(
    receipt.total,
    receipt.operations.length,
    `${context}: total disagrees with the receipts it summarizes`,
  );
  const counted = { succeeded: 0, failed: 0, skipped: 0 };
  for (const operation of receipt.operations) counted[operation.status] += 1;
  assert.equal(receipt.succeeded, counted.succeeded, `${context}: succeeded count`);
  assert.equal(receipt.failed, counted.failed, `${context}: failed count`);
  assert.equal(receipt.skipped, counted.skipped, `${context}: skipped count`);
  // Finding 1, unrepresentable: nothing succeeded can never read as any kind of success.
  if (receipt.succeeded === 0 && !receipt.prevalidateOnly && receipt.outcome !== "refused_prevalidation") {
    assert.equal(receipt.outcome, "all_failed", `${context}: succeeded === 0 must be all_failed`);
  }
  // Every failure declares whether the document may have changed under it.
  for (const operation of receipt.operations) {
    if (operation.status !== "failed") continue;
    assert.equal(
      operation.partialApplicationPossible,
      Object.hasOwn(NON_ATOMIC_BATCH_OPERATIONS, operation.op),
      `${context}: ${operation.id} misdeclares partialApplicationPossible`,
    );
  }
  const byId = new Map(receipt.operations.map((operation) => [operation.id, operation]));
  assert.equal(byId.size, receipt.operations.length, `${context}: receipt ids are not unique`);
  return byId;
}

const record = {
  ranAt: new Date().toISOString(),
  channel: options.channel,
  serverPath,
  scratchPageName,
  artifactDirectory,
  expectedRuntime,
  artifactHashes: {
    server: await sha256OfFile(serverPath),
    plugin: await sha256OfFile(pluginPath),
  },
  checks: {},
  findings: [],
};

let scratchPageId = null;
let originalPageId = null;
let failure = null;

try {
  await client.connect(transport);
  const inventory = await client.listTools();
  record.inventory = {
    toolCount: inventory.tools.length,
    hasApplyBatch: inventory.tools.some((tool) => tool.name === "apply_batch"),
  };
  assert.equal(record.inventory.toolCount, expectedRuntime.toolCount);
  assert.ok(record.inventory.hasApplyBatch, "apply_batch is not in the tool surface");

  await joinWithRetry();
  const runtimeBefore = await callJson("get_runtime_info");
  record.runtimeBefore = runtimeBefore.value;
  assertRuntime(runtimeBefore.value);

  const pagesBefore = await callJson("get_pages");
  originalPageId = pagesBefore.value.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.value.pageCount,
    currentPageId: originalPageId,
    pageIds: (pagesBefore.value.pages || []).map((page) => page.id),
  };

  // ---- real-node discovery, bounded ----
  // get_document_info is the light, paged read; get_node_info on a real SYD page would
  // pull an 11k-node subtree, which is the wedge R2.0 was written to retire.
  let realNodes = [];
  let realPage = null;
  for (const page of pagesBefore.value.pages || []) {
    if (page.id !== originalPageId) await call("set_current_page", { pageId: page.id });
    const info = await callJson("get_document_info", { limit: 5 });
    const children = (info.value.children || []).filter((child) => child.id);
    if (children.length > 0) {
      realPage = { id: page.id, name: page.name };
      realNodes = children.slice(0, 2).map((child) => ({
        id: child.id,
        name: child.name,
        type: child.type,
      }));
      break;
    }
  }
  assert.ok(
    realNodes.length > 0,
    "no page in this document has a top-level child — open the SYD copy, not an empty file",
  );
  record.realPage = realPage;
  record.realNodes = realNodes;

  // ---- the scratch workspace ----
  const page = await callJson("create_page", { name: scratchPageName });
  scratchPageId = page.value.id;
  record.scratchPage = page.value;
  await call("set_current_page", { pageId: scratchPageId });

  const layoutFrame = await callIdFromProse("create_frame", {
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    name: "gate-layout",
    parentId: scratchPageId,
  });
  for (const index of [0, 1]) {
    await callEmbeddedJson("create_rectangle", {
      x: index * 60,
      y: 0,
      width: 50,
      height: 50,
      name: `gate-layout-child-${index}`,
      parentId: layoutFrame.id,
    });
  }
  await call("set_layout_mode", { nodeId: layoutFrame.id, layoutMode: "HORIZONTAL" });
  await call("set_item_spacing", { nodeId: layoutFrame.id, itemSpacing: 16 });

  const deleteFrame = await callIdFromProse("create_frame", {
    x: 0,
    y: 260,
    width: 300,
    height: 160,
    name: "gate-delete-target",
    parentId: scratchPageId,
  });
  for (const index of [0, 1, 2]) {
    await callEmbeddedJson("create_rectangle", {
      x: index * 40,
      y: 0,
      width: 30,
      height: 30,
      name: `gate-delete-child-${index}`,
      parentId: deleteFrame.id,
    });
  }

  const probeRect = await callEmbeddedJson("create_rectangle", {
    x: 0,
    y: 480,
    width: 80,
    height: 80,
    name: "gate-probe-rect",
    parentId: scratchPageId,
  });
  const probeRectId = probeRect.value.id;

  const probeText = await callIdFromProse("create_text", {
    x: 0,
    y: 600,
    text: "before",
    name: "gate-probe-text",
    parentId: scratchPageId,
  });

  record.fixture = {
    layoutFrameId: layoutFrame.id,
    deleteFrameId: deleteFrame.id,
    probeRectId,
    probeTextId: probeText.id,
  };

  // ⭐ Recorded as a finding, not smuggled into the ops: batch `params` go STRAIGHT to
  // the plugin handler, so they are in the handler's shape, not the standalone tool's.
  // `set_fill_color` is flat r/g/b/a as a tool and `{color:{…}}` as a handler. The tool
  // description's "Same shape as the standalone tool of the same name" is false for it.
  const fillParams = { color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } };

  // ---- check 1 — prevalidateOnly against REAL nodes, writing nothing ----
  const dryOperations = realNodes.map((node, index) => ({
    id: `real-${index}`,
    op: "rename_node",
    nodeId: node.id,
    params: { name: "gate-would-rename" },
  }));
  // D7 on real content: a destructive op reports its blast radius BEFORE anything is
  // written, and a dry run writes nothing — so this is the one way to observe the scope
  // report on a node we are not willing to lose. Unconditional: an earlier revision
  // derived it from realNodes.length and silently skipped it on a one-child page.
  dryOperations.push({
    id: "real-destructive",
    op: "delete_node",
    nodeId: realNodes[realNodes.length - 1].id,
  });
  dryOperations.push({
    id: "scratch-dry",
    op: "rename_node",
    nodeId: probeRectId,
    params: { name: "gate-would-rename-scratch" },
  });
  const dryRun = await callJson("apply_batch", {
    operations: dryOperations,
    prevalidateOnly: true,
  });
  const dry = dryRun.value;
  record.checks.dryRun = dry;
  assertReceiptInvariants(dry, "dry run");
  assert.equal(dry.outcome, "prevalidated");
  assert.equal(dry.prevalidateOnly, true);
  assert.equal(dry.complete, true);
  assert.equal(dry.succeeded, 0);
  assert.equal(dry.failed, 0);
  assert.equal(dry.skipped, dryOperations.length);
  assert.equal(dry.prevalidation.unresolved.length, 0);
  assert.equal(dry.prevalidation.resolved.length, dryOperations.length);
  for (const [index, node] of realNodes.entries()) {
    const resolved = dry.prevalidation.resolved.find((entry) => entry.id === `real-${index}`);
    assert.ok(resolved, `real-${index} missing from the resolved scope`);
    assert.equal(resolved.nodeId, node.id);
    assert.equal(resolved.name, node.name, "the reported scope must name the real node");
    assert.equal(resolved.type, node.type);
  }
  const destructiveScopeOnRealContent = dry.prevalidation.resolved.find(
    (entry) => entry.id === "real-destructive",
  );
  assert.ok(destructiveScopeOnRealContent, "the destructive dry op resolved no scope");
  assert.ok(
    destructiveScopeOnRealContent.childCount === null ||
      Number.isInteger(destructiveScopeOnRealContent.childCount),
    "a destructive op must report a childCount or an explicit null for a leaf",
  );
  record.checks.destructiveScopeOnRealContent = destructiveScopeOnRealContent;

  // The dry run must have changed nothing on the real page. Verified with the same light
  // read used to discover them — a rename would move the name, a delete the entry.
  await call("set_current_page", { pageId: realPage.id });
  const realAfterDry = await callJson("get_document_info", { limit: 5 });
  const realChildren = new Map(
    (realAfterDry.value.children || []).map((child) => [child.id, child.name]),
  );
  for (const node of realNodes) {
    assert.equal(
      realChildren.get(node.id),
      node.name,
      `the dry run altered real node ${node.id} — prevalidateOnly must write nothing`,
    );
  }
  record.checks.realNodesUnchangedAfterDryRun = true;
  await call("set_current_page", { pageId: scratchPageId });

  // ---- check 2 — one bad target under "stop" refuses the whole batch ----
  const ghostNodeId = "999999:999999";
  const mixedOperations = (renamed) => [
    { id: "good-rename", op: "rename_node", nodeId: probeRectId, params: { name: renamed } },
    { id: "bad-target", op: "set_fill_color", nodeId: ghostNodeId, params: fillParams },
    { id: "good-text", op: "set_text_content", nodeId: probeText.id, params: { text: "after" } },
  ];

  const stopped = await callJson("apply_batch", {
    operations: mixedOperations("gate-renamed-under-stop"),
    onError: "stop",
  });
  record.checks.stop = stopped.value;
  const stopById = assertReceiptInvariants(stopped.value, "stop");
  assert.equal(stopped.value.outcome, "refused_prevalidation");
  assert.equal(stopped.value.complete, true);
  assert.equal(stopped.value.succeeded, 0);
  assert.equal(stopped.value.skipped, 3);
  assert.equal(stopped.value.prevalidation.unresolved.length, 1);
  assert.equal(stopped.value.prevalidation.unresolved[0].reason, BATCH_ERROR_CODES.NODE_NOT_FOUND);
  assert.equal(stopById.get("bad-target").error.code, BATCH_ERROR_CODES.NODE_NOT_FOUND);
  assert.equal(stopById.get("good-rename").status, "skipped");

  const afterStop = await callJson("get_node_info", { nodeId: probeRectId });
  assert.equal(
    afterStop.value.name,
    "gate-probe-rect",
    "an atomic refusal must not have applied the good operations",
  );
  const textAfterStop = await callJson("get_node_info", { nodeId: probeText.id });
  assert.equal(textAfterStop.value.characters, "before");
  record.checks.stopWroteNothing = true;

  // ---- check 3 — the same batch under "continue" is an honest partial ----
  const continued = await callJson("apply_batch", {
    operations: mixedOperations("gate-renamed-under-continue"),
    onError: "continue",
  });
  record.checks.continue = continued.value;
  const continueById = assertReceiptInvariants(continued.value, "continue");
  assert.equal(continued.value.outcome, "partial");
  assert.equal(continued.value.succeeded, 2);
  assert.equal(continued.value.skipped, 1);
  assert.equal(continued.value.failed, 0);
  assert.equal(continued.value.complete, true);
  assert.equal(continueById.get("bad-target").error.code, BATCH_ERROR_CODES.NODE_NOT_FOUND);

  const afterContinue = await callJson("get_node_info", { nodeId: probeRectId });
  assert.equal(afterContinue.value.name, "gate-renamed-under-continue");
  const textAfterContinue = await callJson("get_node_info", { nodeId: probeText.id });
  assert.equal(textAfterContinue.value.characters, "after");
  record.checks.continueAppliedTheRest = true;

  // ---- check 4 — the two envelope refusals ----
  record.checks.refusals = {
    duplicateId: await callExpectingRefusal("apply_batch", {
      operations: [
        { id: "same", op: "rename_node", nodeId: probeRectId, params: { name: "a" } },
        { id: "same", op: "rename_node", nodeId: probeRectId, params: { name: "b" } },
      ],
    }),
    disallowedOp: await callExpectingRefusal("apply_batch", {
      operations: [{ id: "creates-are-absent", op: "create_frame", nodeId: probeRectId }],
    }),
  };
  assert.match(
    record.checks.refusals.duplicateId.message,
    new RegExp(BATCH_ERROR_CODES.DUPLICATE_OPERATION_ID),
  );
  assert.equal(BATCH_ERROR_CODE_DELIVERY[BATCH_ERROR_CODES.DUPLICATE_OPERATION_ID], "thrown");
  assert.equal(BATCH_ERROR_CODE_DELIVERY[BATCH_ERROR_CODES.OPERATION_NOT_ALLOWED], "thrown");
  // The allowlist is enforced twice and the OUTER layer answers first: `create_frame` is
  // not in the tool's inline z.enum, so it never reaches the plugin's own check.
  assert.equal(record.checks.refusals.disallowedOp.layer, "schema");
  assert.ok(
    !V1_BATCH_OPERATIONS.includes("create_frame"),
    "creates must stay absent from the allowlist",
  );

  const afterRefusals = await callJson("get_node_info", { nodeId: probeRectId });
  assert.equal(
    afterRefusals.value.name,
    "gate-renamed-under-continue",
    "a refused envelope must not have applied its first operation",
  );

  // ---- check 5 — non-atomicity, live ----
  // Three probes. `set_item_spacing` is the PROVEN case: its handler writes itemSpacing
  // and then rejects counterAxisSpacing on a non-WRAP frame, by its own explicit check.
  // ⚠️ No read tool surfaces itemSpacing — both filterFigmaNode copies drop it — so it is
  // read back INDIRECTLY as the gap between the two auto-layout children, whose
  // absoluteBoundingBox does survive the filter. `move_node` and `set_stroke_color`
  // corroborate with directly observable fields.
  const gapOfChildren = (info) => {
    const kids = (info.children || [])
      .filter((child) => child.absoluteBoundingBox)
      .sort((left, right) => left.absoluteBoundingBox.x - right.absoluteBoundingBox.x);
    if (kids.length < 2) return null;
    return (
      kids[1].absoluteBoundingBox.x -
      (kids[0].absoluteBoundingBox.x + kids[0].absoluteBoundingBox.width)
    );
  };
  const layoutBefore = await callJson("get_node_info", { nodeId: layoutFrame.id });
  const gapBefore = gapOfChildren(layoutBefore.value);
  const rectBefore = await callJson("get_node_info", { nodeId: probeRectId });
  const xBefore = rectBefore.value.absoluteBoundingBox?.x ?? null;
  const atomicity = await callJson("apply_batch", {
    operations: [
      {
        id: "spacing",
        op: "set_item_spacing",
        nodeId: layoutFrame.id,
        params: { itemSpacing: 24, counterAxisSpacing: 8 },
      },
      {
        id: "move",
        op: "move_node",
        nodeId: probeRectId,
        params: { x: (xBefore ?? 0) + 120, y: "not-a-number" },
      },
      {
        id: "stroke",
        op: "set_stroke_color",
        nodeId: probeRectId,
        params: { color: { r: 1, g: 0, b: 0, a: 1 }, weight: "thick" },
      },
      { id: "ok", op: "rename_node", nodeId: probeText.id, params: { name: "gate-still-works" } },
    ],
    onError: "continue",
    maxResultBytes: 8,
    timeBudgetMs: 60000,
  });
  record.checks.atomicity = atomicity.value;
  const atomicById = assertReceiptInvariants(atomicity.value, "atomicity");
  assert.equal(atomicity.value.complete, true, "continue must not stop on a failure");
  assert.equal(atomicById.get("ok").status, "succeeded");
  // 3.5 truncation, live: the reply is cut but the true size is still reported.
  assert.equal(atomicById.get("ok").resultTruncated, true);
  assert.ok(atomicById.get("ok").resultBytes > 8);

  const spacing = atomicById.get("spacing");
  assert.equal(spacing.status, "failed", "counterAxisSpacing on a non-WRAP frame must throw");
  assert.equal(spacing.partialApplicationPossible, true);
  assert.equal(
    spacing.partialApplicationReason,
    NON_ATOMIC_BATCH_OPERATIONS.set_item_spacing,
    "the declared reason must be the shipped one",
  );

  const layoutAfter = await callJson("get_node_info", { nodeId: layoutFrame.id });
  const gapAfter = gapOfChildren(layoutAfter.value);
  const rectAfter = await callJson("get_node_info", { nodeId: probeRectId });
  const xAfter = rectAfter.value.absoluteBoundingBox?.x ?? null;
  const move = atomicById.get("move");
  const stroke = atomicById.get("stroke");
  record.checks.observedPartialApplication = {
    move: {
      status: move.status,
      xBefore,
      xAfter,
      partiallyApplied: move.status === "failed" && xBefore !== null && xAfter === xBefore + 120,
      error: move.error?.message ?? null,
    },
    stroke: {
      status: stroke.status,
      strokesBefore: rectBefore.value.strokes ?? null,
      strokesAfter: rectAfter.value.strokes ?? null,
      partiallyApplied:
        stroke.status === "failed" &&
        JSON.stringify(rectBefore.value.strokes ?? null) !==
          JSON.stringify(rectAfter.value.strokes ?? null),
      error: stroke.error?.message ?? null,
    },
    itemSpacing: {
      status: spacing.status,
      // The fixture is built at itemSpacing 16 and the failed op asks for 24.
      gapBefore,
      gapAfter,
      partiallyApplied: spacing.status === "failed" && gapBefore === 16 && gapAfter === 24,
      readBackMethod:
        "gap between the two auto-layout children, from absoluteBoundingBox — no read tool surfaces itemSpacing directly",
      error: spacing.error?.message ?? null,
    },
  };
  // The contract's claim is that a `failed` receipt can sit on a CHANGED document. At
  // least one probe has to demonstrate it live, or the declaration is unsupported and
  // that is a finding, not a pass.
  assert.ok(
    record.checks.observedPartialApplication.itemSpacing.partiallyApplied ||
      record.checks.observedPartialApplication.move.partiallyApplied ||
      record.checks.observedPartialApplication.stroke.partiallyApplied,
    "no probe reproduced a partial application live — re-examine the claim",
  );

  // ---- check 6 — a destructive op reports its scope, checked before and after ----
  const deleteBefore = await callJson("get_node_info", { nodeId: deleteFrame.id });
  const childIds = (deleteBefore.value.children || []).map((child) => child.id);
  assert.equal(childIds.length, 3);
  const destructive = await callJson("apply_batch", {
    operations: [{ id: "drop", op: "delete_node", nodeId: deleteFrame.id }],
    onError: "stop",
  });
  record.checks.destructive = destructive.value;
  const destructiveById = assertReceiptInvariants(destructive.value, "destructive");
  assert.equal(destructive.value.outcome, "all_succeeded");
  assert.equal(destructive.value.complete, true);
  const scope = destructive.value.prevalidation.resolved[0];
  assert.equal(
    scope.childCount,
    childIds.length,
    "the reported scope must match the document before the write",
  );
  assert.equal(destructiveById.get("drop").status, "succeeded");

  record.checks.destructiveAfter = {
    reportedChildCount: scope.childCount,
    frameGone: await callExpectingRefusal("get_node_info", { nodeId: deleteFrame.id }),
    // The subtree goes with it: childCount reports DIRECT children, and the delete takes
    // the whole tree — so a child id must also be unresolvable afterwards.
    childGone: await callExpectingRefusal("get_node_info", { nodeId: childIds[0] }),
  };

  // ---- check 7 — the plugin still answers, unwedged ----
  const runtimeStarted = Date.now();
  const runtimeAfter = await callJson("get_runtime_info");
  record.runtimeAfter = {
    compatibility: runtimeAfter.value.compatibility,
    durationMs: Date.now() - runtimeStarted,
  };
  assertRuntime(runtimeAfter.value);

  record.findings.push(
    "batch params are in the PLUGIN HANDLER shape, not the standalone tool's: set_fill_color/set_stroke_color take {color:{r,g,b,a}} in a batch but flat r,g,b,a as tools. The apply_batch description's \"Same shape as the standalone tool of the same name\" is wrong for those two.",
    "params is z.record(z.any()), so per-operation arguments get no schema validation — a wrong-shaped param fails plugin-side and arrives as a receipt entry rather than a schema throw.",
    "operation_not_allowed is unreachable through this transport: the tool's inline z.enum rejects a disallowed op first, so the plugin's own allowlist check never answers a live consumer.",
  );
  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  // ⛔ Both paths. A gate that mutates owns its wreckage — and the current page has to
  // move off the scratch page before it can be removed.
  if (scratchPageId) {
    try {
      if (originalPageId) await call("set_current_page", { pageId: originalPageId });
      const deleted = await call("delete_node", { nodeId: scratchPageId });
      record.cleanup = { pageId: scratchPageId, reply: deleted.text };
      const pagesAfter = await callJson("get_pages");
      record.pagesAfterCleanup = {
        pageCount: pagesAfter.value.pageCount,
        currentPageId: pagesAfter.value.currentPageId,
      };
      record.cleanupRestoredBaseline =
        pagesAfter.value.pageCount === record.baseline?.pageCount &&
        pagesAfter.value.currentPageId === originalPageId &&
        JSON.stringify((pagesAfter.value.pages || []).map((page) => page.id)) ===
          JSON.stringify(record.baseline?.pageIds);
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
              fingerprint: record.runtimeBefore.server.capabilityFingerprint,
              compatibility: record.runtimeBefore.compatibility.status,
            }
          : null,
        outcomes: {
          dryRun: record.checks.dryRun?.outcome ?? null,
          stop: record.checks.stop?.outcome ?? null,
          continue: record.checks.continue?.outcome ?? null,
          atomicity: record.checks.atomicity?.outcome ?? null,
          destructive: record.checks.destructive?.outcome ?? null,
        },
        refusals: record.checks.refusals ?? null,
        observedPartialApplication: record.checks.observedPartialApplication ?? null,
        destructiveScope: record.checks.destructiveAfter?.reportedChildCount ?? null,
        cleanup: record.cleanup?.reply ?? null,
        cleanupRestoredBaseline: record.cleanupRestoredBaseline ?? null,
        cleanupError: record.cleanupError ?? null,
        runtimeAfterMs: record.runtimeAfter?.durationMs ?? null,
        findings: record.findings,
        failure: record.failure,
      },
      null,
      2,
    )}\n`,
  );
}

if (failure) throw failure;
