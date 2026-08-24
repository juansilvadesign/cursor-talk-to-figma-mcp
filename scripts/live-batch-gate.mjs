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
import { unifiedFields } from "../src/talk_to_figma_mcp/legacy-batch-reply.mjs";

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

// ⛔ Re-pinned for R2.4 ACCEPTANCE (apply_batch promoted to `stable`, which moves the
// contract and therefore the server build). The tool COUNT is unchanged at 53 — 3.1 added a parameter, Phase
// 4 added reply fields and 4.1 changed only a wrapper, none of which is a new tool — so
// the count alone would have happily accepted the old pair.
//
// ⭐ And this time the FINGERPRINT did not move either. 4.1 is server-side only, so the
// capability IDs and `serverSchemaVersion` it hashes are untouched, and a stale
// `dist/server.js` would sail past the fingerprint check that caught the last stale pair.
// `serverBuildId` is the only pin that fails on it — which is the whole reason a
// fingerprint is a PAIRING check and not a contract hash, stated once more in the one
// place that has to act on it.
//
// 🔴 **R2.6 Phase 1 found the limit of that claim, by measuring it.** `serverBuildId` is
// `sha256(server.ts + contractPayload)` — `SERVER_PATH` in `scripts/contract-lib.mjs` is
// `server.ts` ALONE. `batch-receipt.mjs` ships inside `dist/server.js` and is hashed by
// NOTHING. Mutating it alone and regenerating produced byte-identical runtime metadata:
// every pin here held still. So "serverBuildId is the only pin that fails on a stale
// build" is true only for changes that reach `server.ts` or the contract; a server change
// outside those two is invisible to all four pins at once. ⛔ Phase 1 is caught only
// because it also moved `code.js`, and therefore `pluginBuildId`. Do not read a green
// preflight as proof the server half is fresh.
//
// ⚠️ The fingerprint below was STALE from `e02d1b2` until R2.6 Phase 1 — it read
// `sha256:a6ca7f4a…` against a tree whose fingerprint was `sha256:05ac28c5…`, so this gate
// would have failed at `assertRuntime` before reaching a single check. It went unnoticed
// because the gate was edited in that commit and never re-run on it.
//
// ⛔ RE-PINNED 2026-08-22 to R2.6 item 2.4, the LAST of the four layout tools — the
// owner's standing call to re-pin and re-run the stale set ONCE, now that the set is
// closed at five. This gate had sat at R2.6 Phase 1 (`1.7.0`, 56 tools) across four items,
// so this is the largest jump of the five: the schema moved 1.7.0 → 1.8.0 (item 2.0's
// widening of `create_text`), the tool count moved 56 → 60 (2.1 `set_layout_child`,
// 2.2 `set_constraints`, 2.3 `set_size_limits`, 2.4 `set_clips_content`), and both build
// IDs and the fingerprint moved several times over.
//
// ⭐ **A pin edit does NOT move the build, and that is what makes a five-gate re-pin
// coherent.** `serverBuildId` is `sha256(server.ts + contractPayload)` and `pluginBuildId`
// hashes `code.js` + `ui.html` + `manifest.json` (`scripts/contract-lib.mjs:605`).
// `scripts/` is hashed by NEITHER. So re-pinning these five cannot stale each other, and
// the standing worry that "each re-pin moves `serverBuildId`" was wrong — what staled each
// gate was the *item* landing above it, never the pin.
//
// ⛔ RE-PINNED AGAIN 2026-08-22 for **R2.6 ACCEPTANCE** — the promotion of the four layout
// tools `additive-preview` → `stable`. ⚠️ A FIFTH PIN SHAPE, and it is 2.3's dangerous one:
// **ONLY `serverBuildId` moved** (`fb30663ee0f1` → `975ccb3ce8b9`). The promotion rewrites
// `contractPayload.tools`, which `serverBuildId` hashes — but it touches no `capabilityId`,
// no schema version and no `code.js`, so the fingerprint, the schema, the tool count AND
// `pluginBuildId` all HELD. ⛔ A fingerprint check alone would wave this stale build
// straight through; the build ID is the only pin that catches it, which is why CC4 pins it.
//
// ⭐ Operator consequence, and it is the OPPOSITE of every layout item: the DEV plugin does
// **NOT** need re-running — the plugin half did not move. Only an interactive MCP session
// needs a respawn, and the gate spawns its own server from `dist/server.js`.
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
  serverBuildId: "r3-a-server-af8987322467",
  pluginBuildId: "r3-a-plugin-b5ee1c0b619a",
  schemaVersion: "1.11.0",
  fingerprint:
    "sha256:6a68b351880d0b204d1cdf90f14cb8258ce8bfe69bc5db4fbf0be7b14deb6428",
  toolCount: 67,
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
  // ⭐ 3.1 is observable ONLY here. The server consumes each `progress_update` to reset the
  // inactivity timer and logs it to stderr; it never forwards one to the MCP client as a
  // protocol notification. Leaving this on "ignore" would make the contract's "with
  // progress updates" claim unobservable from the outside — a hand-written behavioural
  // claim with nothing asserting it against the runtime, which is Finding 4 exactly.
  stderr: "pipe",
});

/** Every stderr line the spawned server wrote, in order. See `progressFramesSince`. */
const serverLog = [];
function captureServerLog() {
  if (!transport.stderr) return false;
  let pending = "";
  transport.stderr.setEncoding("utf8");
  transport.stderr.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) serverLog.push(line);
  });
  return true;
}

// `logger.info` writes this shape and nothing else does.
const PROGRESS_LINE = /^\[INFO\] Progress update for (\S+): (-?\d+)% - (.*)$/;

/**
 * Progress frames for one command, from a mark taken before the call. stderr is a
 * different OS pipe from the stdio protocol, so a frame the server logged just before it
 * answered can still be in flight when the result lands — hence `settle` at every call
 * site rather than reading the log the instant a tool returns.
 */
function progressFramesSince(mark, commandType) {
  const frames = [];
  for (let index = mark; index < serverLog.length; index++) {
    const match = PROGRESS_LINE.exec(serverLog[index]);
    if (match && match[1] === commandType) {
      frames.push({ progress: Number(match[2]), message: match[3] });
    }
  }
  return frames;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

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
  // The child process only exists after connect, so the stderr stream can only be
  // attached here. If it were ever unavailable, checks 7/9/10 would silently observe zero
  // frames and "pass" — so its absence is a hard failure, not a skipped check.
  record.serverLogCaptured = captureServerLog();
  assert.ok(record.serverLogCaptured, "server stderr is not capturable — 3.1 cannot be observed");
  const inventory = await client.listTools();
  record.inventory = {
    toolCount: inventory.tools.length,
    hasApplyBatch: inventory.tools.some((tool) => tool.name === "apply_batch"),
  };
  assert.equal(record.inventory.toolCount, expectedRuntime.toolCount);
  assert.ok(record.inventory.hasApplyBatch, "apply_batch is not in the tool surface");

  // ⭐ Read the PUBLISHED schema, not the source. This gate spent two runs filing a
  // finding that quoted a sentence the description had already stopped containing — a
  // narrated claim nothing checked. What a consumer is actually told about the param
  // shape is now asserted against the live tool listing.
  const applyBatchTool = inventory.tools.find((tool) => tool.name === "apply_batch");
  const publishedParamsDescription = String(
    applyBatchTool?.inputSchema?.properties?.operations?.items?.properties?.params?.description || "",
  );
  record.inventory.applyBatchDeclaresHandlerParamShape =
    /plugin handler/i.test(publishedParamsDescription) &&
    /set_fill_color/.test(publishedParamsDescription);
  assert.ok(
    record.inventory.applyBatchDeclaresHandlerParamShape,
    `apply_batch does not tell a consumer that params are the plugin-handler shape. Published description: ${publishedParamsDescription || "(none)"}`,
  );
  assert.doesNotMatch(
    String(applyBatchTool?.description || "") + publishedParamsDescription,
    /Same shape as the standalone tool/i,
    "apply_batch is back to claiming batch params match the standalone tools",
  );

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
  // `set_fill_color` is flat r/g/b/a as a tool and `{color:{…}}` as a handler. The
  // description now SAYS so — asserted below rather than narrated, because the finding
  // this gate used to file had outlived the defect: it quoted a sentence the description
  // stopped containing in 664135b and kept reporting it as live for two runs.
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

  // ⛔ R2.6 Phase 1 INVERTED this probe, deliberately. This gate accepted R2.4 by
  // OBSERVING set_item_spacing's partial application as evidence; the reorder makes that
  // observation false, so the gate that accepted the previous release must fail here —
  // and a release that breaks its predecessor's gate is not a regression. Failing to
  // notice would be.
  const spacing = atomicById.get("spacing");
  assert.equal(spacing.status, "failed", "counterAxisSpacing on a non-WRAP frame must throw");
  assert.equal(
    spacing.partialApplicationPossible,
    false,
    "set_item_spacing validates before it writes now, so nothing may be declared possible",
  );
  // ⛔ The reason field is only written when the possibility is declared, so BOTH sides of
  // the old equality now read `undefined` and `assert.equal` would pass VACUOUSLY — a
  // symmetric absence reading exactly like agreement. Assert the absence explicitly, and
  // assert the map no longer carries the key, so the two facts cannot drift apart.
  assert.ok(
    !Object.hasOwn(spacing, "partialApplicationReason"),
    "an atomic operation must not carry a partial-application reason",
  );
  assert.equal(
    NON_ATOMIC_BATCH_OPERATIONS.set_item_spacing,
    undefined,
    "set_item_spacing must be gone from the shipped non-atomic map",
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
      // ⭐ This probe changed SIDES in R2.6 Phase 1. It is now the atomicity witness:
      // the op still fails, and the gap must be untouched.
      partiallyApplied: spacing.status === "failed" && gapBefore === 16 && gapAfter === 24,
      atomic: spacing.status === "failed" && gapAfter === gapBefore,
      readBackMethod:
        "gap between the two auto-layout children, from absoluteBoundingBox — no read tool surfaces itemSpacing directly",
      error: spacing.error?.message ?? null,
    },
  };
  // ⛔ Figma is the judge of the reorder, not the fixture. The offline suite proves the
  // ORDER of operations against a fake; this proves the document did not move.
  assert.equal(
    record.checks.observedPartialApplication.itemSpacing.atomic,
    true,
    "set_item_spacing failed and still changed the gap — the reorder does not hold live",
  );
  assert.equal(
    record.checks.observedPartialApplication.itemSpacing.partiallyApplied,
    false,
    "set_item_spacing must no longer reproduce a partial application",
  );
  // The contract's claim is that a `failed` receipt can sit on a CHANGED document, and it
  // is still true of the six ops that stay declared. ⛔ Name the two survivors instead of
  // leaving an OR that silently narrowed from three probes to two: if both stop
  // reproducing, that is a finding about the declaration, not a quieter pass.
  assert.ok(
    record.checks.observedPartialApplication.move.partiallyApplied ||
      record.checks.observedPartialApplication.stroke.partiallyApplied,
    "neither move_node nor set_stroke_color reproduced a partial application — re-examine the claim",
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

  // ---- 3.1 / 3.2 fixture ----
  // Fifteen operations is three chunks of five, so it has exactly two inter-chunk gaps —
  // the smallest batch that can show a pause at all. The targets cycle over the scratch
  // nodes we still own (the delete-target frame is gone by now), and `rename_node` is the
  // cheapest real mutation there is, so the wall clock below is dominated by the pause
  // rather than by Figma's own work. That is what makes 3.2's number a measurement of the
  // pause instead of a measurement of the document.
  const CHUNK_SIZE = 5;
  const BATCH_OPERATION_COUNT = 15;
  const expectedChunks = Math.ceil(BATCH_OPERATION_COUNT / CHUNK_SIZE);
  const chunkPool = [probeRectId, probeText.id, layoutFrame.id];
  const chunkedOperations = (tag) =>
    Array.from({ length: BATCH_OPERATION_COUNT }, (_, index) => ({
      id: `${tag}-${index}`,
      op: "rename_node",
      nodeId: chunkPool[index % chunkPool.length],
      params: { name: `gate-${tag}-${index}` },
    }));

  // ---- check 7 — 3.1, chunked progress observed over the real transport ----
  const progressMark = serverLog.length;
  const chunked = await callJson("apply_batch", {
    operations: chunkedOperations("chunk"),
    onError: "continue",
    chunkPauseMs: 0,
    timeBudgetMs: 60000,
  });
  await settle();
  assertReceiptInvariants(chunked.value, "chunked");
  assert.equal(chunked.value.outcome, "all_succeeded");
  assert.equal(chunked.value.total, BATCH_OPERATION_COUNT);
  assert.equal(chunked.value.complete, true);
  const chunkFrames = progressFramesSince(progressMark, "apply_batch");
  record.checks.chunkedProgress = {
    operations: BATCH_OPERATION_COUNT,
    chunkSize: CHUNK_SIZE,
    expectedChunks,
    frameCount: chunkFrames.length,
    frames: chunkFrames,
    reachedComplete: chunkFrames.some((frame) => frame.progress === 100),
    pluginElapsedMs: chunked.value.timing?.elapsedMs ?? null,
  };
  // One "started" frame plus one per chunk. Fewer than that and the tool description's
  // "Runs in chunks of 5 with progress updates" is not true of the running plugin.
  assert.ok(
    chunkFrames.length >= expectedChunks + 1,
    `3.1 declares chunked progress; only ${chunkFrames.length} frame(s) reached the server for ${expectedChunks} chunks`,
  );
  assert.ok(
    record.checks.chunkedProgress.reachedComplete,
    "the final chunk must report 100% — a progress stream that never completes is worse than none",
  );

  // ---- check 8 — 3.2, the pause MEASURED on a real file ----
  // The plan blocks this offline on purpose: the default cannot be chosen honestly
  // without a number from a real document. Same batch, three pause settings, generous
  // budget so the ceiling never interferes.
  const pauseMeasurements = [];
  for (const chunkPauseMs of [0, 250, 1000]) {
    const startedAt = Date.now();
    const measured = await callJson("apply_batch", {
      operations: chunkedOperations(`pause${chunkPauseMs}`),
      onError: "continue",
      chunkPauseMs,
      timeBudgetMs: 60000,
    });
    const wallClockMs = Date.now() - startedAt;
    assertReceiptInvariants(measured.value, `pause ${chunkPauseMs}`);
    // The real question behind the default: does Figma actually need the breath? If ops
    // start failing at 0 the default is wrong, and that is a finding, not a pass.
    assert.equal(
      measured.value.outcome,
      "all_succeeded",
      `every operation must still succeed at chunkPauseMs=${chunkPauseMs}`,
    );
    pauseMeasurements.push({
      chunkPauseMs,
      // The pause is never taken before the first chunk, so it is paid (chunks - 1) times.
      sleepBudgetMs: chunkPauseMs * (expectedChunks - 1),
      pluginElapsedMs: measured.value.timing?.elapsedMs ?? null,
      wallClockMs,
      outcome: measured.value.outcome,
    });
  }
  const [zeroPause, midPause, fullPause] = pauseMeasurements;
  const observedPauseCostMs = fullPause.pluginElapsedMs - zeroPause.pluginElapsedMs;
  record.checks.pauseMeasurement = {
    method:
      `${BATCH_OPERATION_COUNT} rename_node ops over ${expectedChunks} chunks; pluginElapsedMs is the plugin's own timing.elapsedMs, which excludes transport`,
    measurements: pauseMeasurements,
    observedPauseCostMs,
    predictedPauseCostMs: fullPause.sleepBudgetMs,
    // Recorded rather than asserted: 250 ms × 2 gaps is 500 ms of signal, which is inside
    // run-to-run noise on a live file. Only the 1 s case is asserted below.
    midPauseTracksPrediction:
      midPause.pluginElapsedMs - zeroPause.pluginElapsedMs >= midPause.sleepBudgetMs * 0.5,
    conclusion:
      "the pause is pure additive latency — no operation needed it to succeed, so 0 is the honest default and the knob stays for callers who hit a wedge",
  };
  assert.ok(
    observedPauseCostMs >= fullPause.sleepBudgetMs * 0.8,
    `a ${fullPause.chunkPauseMs} ms pause over ${expectedChunks - 1} gaps should cost about ${fullPause.sleepBudgetMs} ms; observed ${observedPauseCostMs} ms`,
  );

  // ---- check 9 — the pause is CLAMPED to the remaining budget ----
  // ⭐ The load-bearing claim behind 3.2: "the pause is skipped once timeBudgetMs is spent,
  // so it can never push a run past its own ceiling." The maximum pause against the
  // minimum budget is the case that would expose a lie — an unclamped 5 s sleep would
  // overshoot a 1 s ceiling five-fold. This is simultaneously the Finding 5 regression:
  // progress updates reset the inactivity timer, so timeBudgetMs has to stay the binding
  // constraint or the batch loses its real ceiling.
  const clampMark = serverLog.length;
  const clampStartedAt = Date.now();
  const clamped = await callJson("apply_batch", {
    operations: chunkedOperations("clamp"),
    onError: "continue",
    chunkPauseMs: 5000, // the schema maximum
    timeBudgetMs: 1000, // the schema minimum
  });
  const clampWallClockMs = Date.now() - clampStartedAt;
  await settle();
  assertReceiptInvariants(clamped.value, "clamp");
  const clampFrames = progressFramesSince(clampMark, "apply_batch");
  record.checks.pauseClamp = {
    chunkPauseMs: 5000,
    timeBudgetMs: 1000,
    unclampedWouldBeMs: 5000 * (expectedChunks - 1),
    pluginElapsedMs: clamped.value.timing?.elapsedMs ?? null,
    wallClockMs: clampWallClockMs,
    budgetExhausted: clamped.value.timing?.budgetExhausted ?? null,
    complete: clamped.value.complete,
    outcome: clamped.value.outcome,
    succeeded: clamped.value.succeeded,
    skipped: clamped.value.skipped,
    progressFrameCount: clampFrames.length,
  };
  assert.equal(clamped.value.complete, false, "an exhausted budget must report complete: false");
  assert.equal(clamped.value.timing.budgetExhausted, true);
  assert.ok(
    clamped.value.skipped > 0,
    "the operations past the ceiling must be skipped, not silently dropped",
  );
  assert.ok(
    clamped.value.timing.elapsedMs <= 1000 + 750,
    `the pause overshot the ceiling: ${clamped.value.timing.elapsedMs} ms elapsed against a 1000 ms budget, so timeBudgetMs is not the binding constraint`,
  );
  // Finding 5 stays closed only if BOTH are true at once: frames were emitted (they reset
  // the inactivity timer) AND the budget still fired.
  assert.ok(
    clampFrames.length > 0,
    "no progress frames during the clamped run — the Finding 5 interaction is untested",
  );

  // ---- check 10 — Phase 4's additive vocabulary, as a live consumer sees it ----
  const legacyTargets = [];
  for (const index of [0, 1]) {
    const rect = await callEmbeddedJson("create_rectangle", {
      x: index * 40,
      y: 760,
      width: 30,
      height: 30,
      name: `gate-legacy-${index}`,
      parentId: scratchPageId,
    });
    legacyTargets.push(rect.value.id);
  }
  const deleteMany = await callJson("delete_multiple_nodes", { nodeIds: legacyTargets });
  record.checks.legacyAlignment = {
    delete_multiple_nodes: {
      surfaced: "json",
      legacy: {
        success: deleteMany.value.success,
        nodesDeleted: deleteMany.value.nodesDeleted,
        totalNodes: deleteMany.value.totalNodes,
      },
      unified: {
        outcome: deleteMany.value.outcome,
        total: deleteMany.value.total,
        succeeded: deleteMany.value.succeeded,
        failed: deleteMany.value.failed,
      },
    },
  };
  // 4.1, live: the unified quartet arrives WITHOUT disturbing the legacy spelling.
  assert.ok(
    BATCH_OUTCOMES.includes(deleteMany.value.outcome),
    "delete_multiple_nodes did not surface a unified outcome to a live consumer",
  );
  assert.equal(deleteMany.value.outcome, "all_succeeded");
  assert.equal(deleteMany.value.total, legacyTargets.length);
  assert.equal(deleteMany.value.succeeded, legacyTargets.length);
  assert.equal(deleteMany.value.success, true, "the legacy flag must keep its exact spelling");
  assert.equal(deleteMany.value.nodesDeleted, legacyTargets.length);

  // ⚠️ The other two shipped batch tools format their reply as PROSE in the MCP wrapper
  // and return no JSON at all, so whatever Phase 4 added to their plugin handlers cannot
  // reach a consumer through this transport. Observed, not asserted: the offline suite
  // pins the handler and it passes there — the gap is the wrapper, which is pre-existing
  // shipped behaviour and a 4.x follow-up, not a failure of this run.
  const textReply = await call("set_multiple_text_contents", {
    nodeId: scratchPageId,
    text: [{ nodeId: probeText.id, text: "gate-phase-4" }],
  });
  const annotationMark = serverLog.length;
  let annotationText = null;
  let annotationCallFailed = null;
  try {
    const annotationReply = await call("set_multiple_annotations", {
      nodeId: scratchPageId,
      annotations: [{ nodeId: probeRectId, labelMarkdown: "gate annotation" }],
    });
    annotationText = annotationReply.text;
  } catch (error) {
    // ⛔ Caught rather than thrown so the `finally` still deletes the scratch page — but
    // NOT swallowed. Through 5.6 a refusal and a successful prose reply were both just
    // "text", which is how a broken tool would have read as a working one.
    annotationCallFailed = error instanceof Error ? error.message : String(error);
    annotationText = annotationCallFailed;
  }
  await settle();
  // ⭐ This was a RECORDED observation through the 5.6 pass, and the run was green while
  // it read `false` on both tools — a gate telling you something and not failing over it.
  // Phase 4.1's fix made the fields survive the wrapper, so the observation is now an
  // ASSERTION: a wrapper that goes back to discarding them fails the gate rather than
  // filing a finding nobody reads.
  // The receipt is the LAST content item and `textContent()` joins items with a newline,
  // so it is exactly the last line — `JSON.stringify` never emits one.
  const unifiedFrom = (text) => {
    const lines = String(text).trim().split("\n");
    try {
      return unifiedFields(JSON.parse(lines[lines.length - 1]));
    } catch {
      return null;
    }
  };
  const assertUnifiedReaches = (tool, text, expectedTotal) => {
    const unified = unifiedFrom(text);
    assert.ok(
      unified,
      `${tool} returned no unified receipt to its MCP consumer — the wrapper discarded outcome/succeeded/failed/total. Reply was: ${String(text).trim().slice(0, 400)}`,
    );
    assert.ok(
      BATCH_OUTCOMES.includes(unified.outcome),
      `${tool} reported an unknown outcome ${unified.outcome}`,
    );
    assert.equal(unified.total, expectedTotal, `${tool} total`);
    assert.equal(
      unified.succeeded + unified.failed + unified.skipped,
      unified.total,
      `${tool} unified counts must sum to the unified total`,
    );
    return unified;
  };

  record.checks.legacyAlignment.set_multiple_text_contents = {
    surfaced: "json",
    unifiedFieldsVisibleToConsumer: true,
    unified: assertUnifiedReaches("set_multiple_text_contents", textReply.text, 1),
    reply: textReply.text.trim().slice(0, 400),
  };
  assert.equal(
    annotationCallFailed,
    null,
    `set_multiple_annotations did not answer this run, so its receipt could not be checked: ${annotationCallFailed}`,
  );
  record.checks.legacyAlignment.set_multiple_annotations = {
    surfaced: "json",
    unifiedFieldsVisibleToConsumer: true,
    unified: assertUnifiedReaches("set_multiple_annotations", annotationText, 1),
    // 4.3 gave this tool real per-item progress so its "chunked" declaration became true.
    progressFrames: progressFramesSince(annotationMark, "set_multiple_annotations").length,
    reply: String(annotationText).trim().slice(0, 400),
  };
  // ⚠️ The annotations wrapper also stopped announcing "batches of 5" and stopped
  // printing a chunk count it fabricated with `|| 1`. Both were describing work this
  // handler has never done — it processes one annotation at a time.
  assert.doesNotMatch(
    String(annotationText),
    /batches of 5|Processed in \d+ batches/,
    "set_multiple_annotations is claiming batching it does not do",
  );

  // ---- check 11 — the plugin still answers, unwedged ----
  const runtimeStarted = Date.now();
  const runtimeAfter = await callJson("get_runtime_info");
  record.runtimeAfter = {
    compatibility: runtimeAfter.value.compatibility,
    durationMs: Date.now() - runtimeStarted,
  };
  assertRuntime(runtimeAfter.value);

  record.findings.push(
    "batch params are in the PLUGIN HANDLER shape, not the standalone tool's: set_fill_color/set_stroke_color take {color:{r,g,b,a}} in a batch but flat r,g,b,a as tools \u2014 which the published schema now declares (asserted this run).",
    "params is z.record(z.any()), so per-operation arguments get no schema validation — a wrong-shaped param fails plugin-side and arrives as a receipt entry rather than a schema throw.",
    "operation_not_allowed is unreachable through this transport: the tool's inline z.enum rejects a disallowed op first, so the plugin's own allowlist check never answers a live consumer.",
  );
  if (!record.checks.legacyAlignment.set_multiple_text_contents.unifiedFieldsVisibleToConsumer) {
    record.findings.push(
      "Phase 4.1 reaches a live consumer for delete_multiple_nodes ONLY. set_multiple_text_contents and set_multiple_annotations format their MCP reply as prose (progressText + detailedResponse) and return no JSON, so the unified outcome/succeeded/failed/total the plugin now returns is discarded by the wrapper. The offline suite passes because it pins the plugin handler, which is the layer that was actually changed.",
    );
  }
  record.findings.push(
    `3.2 measured on a real file: ${record.checks.pauseMeasurement.observedPauseCostMs} ms observed for a 1000 ms pause over ${expectedChunks - 1} gaps (predicted ${record.checks.pauseMeasurement.predictedPauseCostMs} ms). Every operation succeeded at chunkPauseMs=0, so the pause bought nothing on this document — the 0 default is measured, not assumed.`,
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
  // The spawned server's own account of the run. On a failure this is usually the only
  // place the cause is written down, since the client only ever sees the timeout.
  record.serverLogTail = serverLog.slice(-60);
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
        chunkedProgress: record.checks.chunkedProgress
          ? {
              frameCount: record.checks.chunkedProgress.frameCount,
              expectedChunks: record.checks.chunkedProgress.expectedChunks,
              reachedComplete: record.checks.chunkedProgress.reachedComplete,
            }
          : null,
        pauseMeasurement: record.checks.pauseMeasurement
          ? {
              measurements: record.checks.pauseMeasurement.measurements,
              observedPauseCostMs: record.checks.pauseMeasurement.observedPauseCostMs,
              predictedPauseCostMs: record.checks.pauseMeasurement.predictedPauseCostMs,
            }
          : null,
        pauseClamp: record.checks.pauseClamp ?? null,
        legacyAlignment: record.checks.legacyAlignment ?? null,
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
