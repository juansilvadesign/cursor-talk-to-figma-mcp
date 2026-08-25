#!/usr/bin/env node

/**
 * R2.6 item 2.3 — the size-limits live gate.
 *
 * What this proves that the 260 offline tests cannot:
 *
 *  ⭐ **That a limit CLAMPS rather than merely storing a number.** Offline, `node.maxWidth
 *     = 250` writes to a harness that clamps because this author told it to; every
 *     assertion then reads back the author's own model. Here Figma decides. So the
 *     load-bearing measurement is geometric: three siblings at the same width, given three
 *     different limits, must end at three DIFFERENT widths. A tool that stored the numbers
 *     and applied nothing leaves all three where they were, and §3 catches it.
 *
 *  ⭐ **That the pair rule reads the REAL stored value.** Decision ② is that validation is
 *     on the effective post-write pair — supplied merged over stored — so a lone
 *     `minWidth: 500` is refused against a `maxWidth: 300` the caller never mentioned.
 *     Offline that merge reads a fixture the same code wrote. §4 makes Figma hold the
 *     stored half: the max is written in one call and the conflicting min arrives in
 *     another, so the handler has to have gone back to the document to find it.
 *
 *  ⭐ **That the computed WRITE ORDER survives the real platform.** This is the half of the
 *     pair trap that validation cannot catch: the end state is valid, but two assignments
 *     pass through an intermediate one, and raising a floor before raising the ceiling
 *     hands Figma a momentary min > max. §5 runs both directions — bounds raised past the
 *     stored max, and bounds lowered below the stored min — which require OPPOSITE orders,
 *     so no constant ordering passes both.
 *     ⛔ Note honestly what §5 does NOT prove: whether Figma would have rejected the
 *     careless order. The fork exposes no other writer for these four properties, and this
 *     tool refuses every path that would produce the transient, so the premise is
 *     **unmeasurable through this surface**. It goes to `stillOwed`, never to `findings` —
 *     a check whose two outcomes read identically is the item 2.1 false green, and this one
 *     would read identically whether the ordering mattered or not.
 *
 *  🔴 **The eligibility rule itself — MEASURED, and it cost this gate its first run.**
 *     Decision ③ refused to encode the documented claim that min/max are an auto-layout
 *     feature, because an unverified refusal looks authoritative — 2.2's GROUP question,
 *     same shape. §6 was written expecting one of two answers, RESOLVES or INERT. Figma
 *     gave a third: it THROWS. So §6 is now a MATRIX of eight contexts, and what it
 *     established is that the rule is purely CONTEXTUAL — writable on auto-layout nodes and
 *     their children, and node TYPE is irrelevant. A RECTANGLE inside an auto-layout frame
 *     is accepted; a TEXT inside a plain frame is refused.
 *     ⛔ Two defects came out of that run, both in the tool and not the platform: the
 *     handler's eligibility probe read a property that is READABLE ON EVERY NODE (only the
 *     WRITE is gated, so it never once refused for the right reason), and the offline
 *     harness modelled a TYPE rule Figma does not have. §6 now asserts that every
 *     ineligible context is refused by THIS TOOL rather than by Figma mid-write — the
 *     acceptance test for that fix.
 *
 *  ⛔ **That an ineligible call leaves NOTHING behind.** §6b, and the reason it exists is
 *     the first run: with no context rule, Figma threw during the write phase, and the call
 *     stayed atomic only because the platform happened to reject the FIRST field. That is
 *     the platform's ordering, not this tool's guarantee, and on a tool that writes four
 *     independent fields it is the whole partial-application risk in one sentence.
 *
 *  ⭐ **That `null` genuinely REMOVES the limit.** Offline the clear is read back as a
 *     stored `null`. Live, reading it back is the trap: `get_node_info` answers
 *     `JSON_REST_V1`, where plugin-API property names come back null whether or not they
 *     were ever set — so null-before against null-after passes vacuously, which is exactly
 *     how the typography gate got burned. §8 therefore measures the clear BEHAVIOURALLY:
 *     with the max in force a resize past it is clamped back, and after the clear the same
 *     resize is allowed through. Two different numbers, and the first leg doubles as the
 *     instrument check.
 *
 * ⛔ Three traps inherited from the gates before it, each already paid for once:
 *
 *  1. A refusal is an EXPECTED outcome and arrives in two shapes — the plugin throws and
 *     the wrapper catches it into an error *result* (`layer: "handler"`), or Zod rejects
 *     the argument before dispatch and it arrives thrown (`layer: "schema"`). Scoring
 *     either as a crash has failed this project three times.
 *  2. A gate that mutates cleans up in a `finally`, not on the success path.
 *  3. A rebuild reaches neither running side. This script spawns its own server from
 *     `dist/server.js`, so the SERVER half is always fresh — but the Figma DEV plugin holds
 *     `code.js` from launch, so a stale plugin is the failure mode this pins for.
 *     ⛔ `compatibility: "compatible"` only means the two RUNNING halves match each other;
 *     it says nothing about whether they match this tree.
 *
 * 🔴 And the trap this gate is shaped by, inherited from item 2.1's first run and item
 * 2.2's: **a check whose two outcomes read identically cannot fail in either direction.**
 * Every measurement below is a DISCRIMINATION — between siblings under one operation, or
 * between two states of one node — chosen so the bug's reading and the fix's reading are
 * different numbers. Where no such discrimination exists, the result is `unmeasured` and
 * says so.
 *
 * Every write lands on a scratch page this gate creates and deletes.
 *
 * Usage:
 *   node scripts/live-size-limits-gate.mjs --channel=<DEV-plugin-channel> \
 *        [--output-dir=<dir>] [--server=<dist-server-path>]
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
    "Usage: node scripts/live-size-limits-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<dir>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// ⛔ PINNED to R2.6 item 2.3, AFTER the context-rule fix this gate's own first run forced.
//
// 🔴 A FOURTH PIN SHAPE, and the most dangerous one yet: **only the build IDs moved.** The
// fingerprint HELD at `sha256:89be6e6c…`, the schema held at 1.8.0, and the tool count held
// at 59 — while a real behaviour change shipped underneath (a new refusal, and a rewritten
// published description). The fingerprint hashes the capability SURFACE, so adding a rule
// inside an existing tool is invisible to it. ⛔ A green fingerprint is evidence about what
// it hashes and never about freshness; the build IDs are the only halves that moved here,
// and they are the reason the DEV plugin still has to be re-run.
//
// ⭐ Read that as an operator instruction: the DEV plugin **must** be re-run before this
// gate, because `code.js` changed. The gate spawns its own server from `dist/server.js`,
// so the server half needs no respawn *here* — an interactive MCP session does.
//
// ⚠️ Eight releases running, this answer has changed shape almost every time. ⛔ Do not
// carry it forward — re-derive which halves moved from `runtime-metadata.ts` every time.
//
// ⛔ RE-PINNED 2026-08-22 to R2.6 item 2.4, the LAST of the four layout tools — the
// owner's standing call to re-pin and re-run the stale set ONCE, now that the set is
// closed at five. Since this gate last ran (item 2.3, channel `o2vws4ph`, twice) exactly
// one item landed, and it took the shape 2.1 and 2.2 had: both build IDs and the
// fingerprint moved, the tool count moved 59 → 60, the schema HELD at 1.8.0. ⭐ TWO
// independent changes moved `serverBuildId` in that one item — `set_clips_content` itself,
// and the CC1 repair that walked 2.1/2.2/2.3 back off a silently-defaulted `stable`.
//
// ⭐ **A pin edit does NOT move the build.** `serverBuildId` is
// `sha256(server.ts + contractPayload)`; `scripts/` is hashed by nothing
// (`scripts/contract-lib.mjs:605`). Five gates re-pinned to one pair in one pass therefore
// cannot stale each other — the *items* staled them, never the pins.
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
  serverBuildId: "r3-a-server-7839c39d5302",
  pluginBuildId: "r3-a-plugin-07a616c3b48d",
  schemaVersion: "1.16.0",
  fingerprint:
    "sha256:34d09270ff74084cd134712e864bc891adbac5283e3bee625e330d043448db68",
  toolCount: 76,
};

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const scratchPageName = `R2.6 2.3 size limits gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.6-size-limits-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r2.6-size-limits-gate",
  version: "1.0.0",
});
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

/** The create tools answer in several shapes; only the id is needed here. */
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

/** A refusal is an expected outcome; `layer` records which half answered. */
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
  assert.ok(
    refused,
    `${name} was expected to refuse ${JSON.stringify(args)} but it succeeded: ${message}`,
  );
  return { message, layer };
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
  assert.equal(
    runtime.plugin?.buildId,
    expectedRuntime.pluginBuildId,
    "plugin build is stale — re-run the DEV plugin, it holds code.js from launch",
  );
  assert.equal(runtime.plugin?.apiVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.plugin?.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.compatibility.status, "compatible");
  assert.deepEqual(runtime.compatibility.issues, []);
  assert.ok(
    runtime.plugin?.supportedCommands.includes("set_size_limits"),
    "plugin lacks set_size_limits — re-run the DEV plugin",
  );
}

/**
 * ⛔ The INDEPENDENT channel, and the currency this whole gate is denominated in.
 *
 * Nothing here is measured by reading `minWidth` back. `get_node_info` exports
 * `JSON_REST_V1`, and the typography gate learned that reaching for plugin-API property
 * names against that shape returns all-null — where null-before against null-after passes
 * vacuously. A size limit's whole meaning is what it does to the node's SIZE, so size is
 * what gets measured, from `absoluteBoundingBox`.
 *
 * ⭐ Deliberately NOT a `set_size_limits` call with a no-op argument. That would be a WRITE
 * used as a read — the instrument that reverts the state it asserts, which this project has
 * shipped once already.
 */
async function boxOf(nodeId) {
  const info = await callJson("get_node_info", { nodeId });
  const node = info.value?.document ?? info.value;
  const box = node?.absoluteBoundingBox ?? node?.absoluteRenderBounds ?? {};
  return {
    x: typeof box.x === "number" ? box.x : null,
    y: typeof box.y === "number" ? box.y : null,
    width: typeof box.width === "number" ? box.width : (node?.size?.x ?? null),
    height: typeof box.height === "number" ? box.height : (node?.size?.y ?? null),
  };
}

function assertSizeChannelWorks(box, context) {
  for (const key of ["width", "height"]) {
    assert.equal(
      typeof box[key],
      "number",
      `${context}: the size channel returned a non-numeric ${key} — every comparison below would be vacuous`,
    );
    assert.ok(Number.isFinite(box[key]), `${context}: ${key} read back as ${box[key]}`);
  }
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
  stillOwed: [],
};

let scratchPageId = null;
let originalPageId = null;
let failure = null;

try {
  await client.connect(transport);

  // ── 1. The published surface, read from the runtime and never from the source ────
  const inventory = await client.listTools();
  const tool = inventory.tools.find((entry) => entry.name === "set_size_limits");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(tool, "set_size_limits is not in the published tool surface");

  const schema = tool.inputSchema ?? {};
  const description = String(tool.description ?? "");
  const typeOf = (field) => {
    const declared = schema.properties?.[field]?.type;
    return Array.isArray(declared) ? [...declared].sort() : declared;
  };
  const FIELDS = ["minWidth", "maxWidth", "minHeight", "maxHeight"];
  record.checks.publishedSchema = {
    types: Object.fromEntries(FIELDS.map((field) => [field, typeOf(field)])),
    required: schema.required ?? [],
    // ⛔ Every limit OPTIONAL is the whole preserve semantics. If a future change makes one
    // required, every caller that relied on the other three surviving starts overwriting
    // them, and this is the line that notices.
    allLimitsOptional: FIELDS.every(
      (field) => !(schema.required ?? []).includes(field),
    ),
    describesTheClear: /null/i.test(description),
    describesThePairRule: /pair/i.test(description),
    describesTheResize: /resiz/i.test(description),
    describesTheAutoLayoutRule: /auto-layout/i.test(description),
    namesTheWayIn: /set_layout_mode/i.test(description),
  };
  for (const field of FIELDS) {
    // ⭐ `["null","number"]` and not `"number"`. The nullable half IS the clear verb, and a
    // schema that published a bare number would make the one call that removes a limit
    // unrepresentable at the boundary — silently, from the caller's side.
    assert.deepEqual(
      typeOf(field),
      ["null", "number"],
      `${field} must publish as number|null — the null half is the clear verb`,
    );
  }
  assert.ok(
    record.checks.publishedSchema.allLimitsOptional,
    "all four limits must be optional — a required field turns every call into an overwrite",
  );
  assert.ok(
    record.checks.publishedSchema.describesTheClear,
    "the published description must state that null removes a limit",
  );
  assert.ok(
    record.checks.publishedSchema.describesThePairRule,
    "the published description must state that an axis is validated as a pair",
  );
  // ⛔ A refusal the caller cannot see coming is a refusal they will hit. 2.2's gate makes
  // the same demand of `set_constraints`, and for the same reason: naming the way in is
  // what separates a rule from an obstacle.
  assert.ok(
    record.checks.publishedSchema.describesTheAutoLayoutRule,
    "the published description must state the auto-layout requirement — it is the tool's largest refusal",
  );
  assert.ok(
    record.checks.publishedSchema.namesTheWayIn,
    "the published description must name set_layout_mode as the way in, not just the refusal",
  );

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

  // ── 2. Scratch page, an AUTO-LAYOUT frame, and three children of equal width ─────
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    currentPageId: originalPageId,
    pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
  };

  scratchPageId = await callNodeId("create_page", { name: scratchPageName });
  await call("set_current_page", { pageId: scratchPageId });

  // ⭐ AUTO-LAYOUT here, deliberately — the opposite of 2.2's gate. Figma documents min/max
  // as an auto-layout feature, so this is the context where a limit is MOST likely to
  // resolve, which makes it the right place for §3's instrument. §6 then asks the open
  // question outside any auto-layout at all.
  const alFrameId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    name: "gate-autolayout-parent",
    parentId: scratchPageId,
  });
  await call("set_layout_mode", { nodeId: alFrameId, layoutMode: "VERTICAL" });

  const shrinkId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 300,
    height: 60,
    name: "gate-shrink-child",
    parentId: alFrameId,
  });
  const growId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 300,
    height: 60,
    name: "gate-grow-child",
    parentId: alFrameId,
  });
  const controlId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 300,
    height: 60,
    name: "gate-control-child",
    parentId: alFrameId,
  });

  // ── 3. ⭐ THE LIMIT CLAMPS — three siblings, three limits, three widths ───────────
  //
  // The DISCRIMINATION this gate turns on. Same starting width, one operation each:
  //   maxWidth 200 → must SHRINK to 200
  //   minWidth 400 → must GROW to 400
  //   no limit     → must HOLD at 300
  // A tool that stored the numbers and applied nothing leaves all three at 300, and no two
  // of these readings are the same. ⛔ This is what item 2.1's first run got wrong: it
  // scored a claim whose pass and fail readings were identical.
  const shrinkBefore = await boxOf(shrinkId);
  const growBefore = await boxOf(growId);
  const controlBefore = await boxOf(controlId);
  assertSizeChannelWorks(shrinkBefore, "before the limit writes");
  assert.equal(
    shrinkBefore.width,
    growBefore.width,
    "the three children must start equal, or §3 compares nothing",
  );

  const shrinkReceipt = (
    await callJson("set_size_limits", { nodeId: shrinkId, maxWidth: 200 })
  ).value;
  const growReceipt = (
    await callJson("set_size_limits", { nodeId: growId, minWidth: 400 })
  ).value;

  const shrinkAfter = await boxOf(shrinkId);
  const growAfter = await boxOf(growId);
  const controlAfter = await boxOf(controlId);

  record.checks.limitsClamp = {
    shrink: { before: shrinkBefore.width, after: shrinkAfter.width, limit: 200 },
    grow: { before: growBefore.width, after: growAfter.width, limit: 400 },
    control: { before: controlBefore.width, after: controlAfter.width },
    receiptAgreesWithGeometry: {
      shrink:
        shrinkReceipt.resized === true &&
        shrinkReceipt.size?.after?.width === shrinkAfter.width,
      grow:
        growReceipt.resized === true &&
        growReceipt.size?.after?.width === growAfter.width,
    },
    separated:
      shrinkAfter.width !== growAfter.width &&
      shrinkAfter.width !== controlAfter.width &&
      growAfter.width !== controlAfter.width,
  };

  assert.equal(shrinkAfter.width, 200, "a maxWidth below the current width must shrink the node");
  assert.equal(growAfter.width, 400, "a minWidth above the current width must grow the node");
  assert.equal(
    controlAfter.width,
    controlBefore.width,
    "the untouched CONTROL must not move — if it did, something other than the limit is resizing these nodes",
  );
  assert.ok(
    record.checks.limitsClamp.separated,
    "the three children must end at three different widths, or §3 cannot tell a working tool from an inert one",
  );
  // ⭐ The receipt's own geometry claim, checked against the independent channel rather
  // than trusted. A `resized` flag that reported itself would be the echo this project
  // refuses everywhere else.
  assert.ok(
    record.checks.limitsClamp.receiptAgreesWithGeometry.shrink,
    "the receipt's size.after must match what the document actually holds",
  );
  assert.ok(
    record.checks.limitsClamp.receiptAgreesWithGeometry.grow,
    "the receipt's size.after must match what the document actually holds",
  );

  // ── 4. ⭐ The pair rule reads the value FIGMA holds, not one this process wrote ───
  //
  // The max was written in §3, in a separate call, and this call names only a min. For the
  // refusal to happen at all, the handler must have gone back to the document for the other
  // half of the pair. A tool comparing only its own arguments sees nothing wrong here.
  const beforePairRefusal = await boxOf(shrinkId);
  const pairRefusal = await callExpectingRefusal("set_size_limits", {
    nodeId: shrinkId,
    minWidth: 500,
  });
  const afterPairRefusal = await boxOf(shrinkId);
  record.checks.pairRuleAgainstStored = {
    layer: pairRefusal.layer,
    message: pairRefusal.message.slice(0, 300),
    namesTheStoredHalf: /already stored/.test(pairRefusal.message),
    geometryHeld: beforePairRefusal.width === afterPairRefusal.width,
  };
  assert.equal(
    pairRefusal.layer,
    "handler",
    "the pair rule can only be judged against the document, so it must answer from the plugin",
  );
  assert.ok(
    record.checks.pairRuleAgainstStored.namesTheStoredHalf,
    "the refusal must tell the caller which half it did not supply — that is the whole point of checking the stored value",
  );
  assert.ok(
    record.checks.pairRuleAgainstStored.geometryHeld,
    "a refusal must not resize the node — measured in geometry, not in the stored value",
  );

  // ── 5. ⭐ The computed write order, both directions, against the real platform ────
  //
  // Both legs end in a valid state, so validation cannot be what makes them pass. What
  // differs is the ORDER: raising past the stored max needs max-first, lowering below the
  // stored min needs min-first. No constant ordering satisfies both.
  const orderNodeId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 300,
    height: 60,
    name: "gate-order-child",
    parentId: alFrameId,
  });

  await call("set_size_limits", { nodeId: orderNodeId, minWidth: 100, maxWidth: 200 });
  const raise = (
    await callJson("set_size_limits", {
      nodeId: orderNodeId,
      minWidth: 500,
      maxWidth: 600,
    })
  ).value;

  const lower = (
    await callJson("set_size_limits", {
      nodeId: orderNodeId,
      minWidth: 100,
      maxWidth: 200,
    })
  ).value;

  record.checks.writeOrder = {
    raising: { writeOrder: raise.writeOrder, appliedFields: raise.appliedFields },
    lowering: { writeOrder: lower.writeOrder, appliedFields: lower.appliedFields },
    ordersDiffer:
      JSON.stringify(raise.writeOrder) !== JSON.stringify(lower.writeOrder),
  };
  assert.deepEqual(
    raise.writeOrder,
    ["maxWidth", "minWidth"],
    "raising both bounds past the stored max must write the max first",
  );
  assert.deepEqual(
    lower.writeOrder,
    ["minWidth", "maxWidth"],
    "lowering both bounds below the stored min must write the min first",
  );
  // ⭐ Both writes must have LANDED exactly. This is what separates "Figma accepted the
  // ordering" from "Figma silently coerced one of the values to keep the pair legal" — a
  // coercion would drop the field out of appliedFields.
  assert.deepEqual(
    [...raise.appliedFields].sort(),
    ["maxWidth", "minWidth"],
    "both raised bounds must be applied exactly, not coerced",
  );
  assert.deepEqual(
    [...lower.appliedFields].sort(),
    ["maxWidth", "minWidth"],
    "both lowered bounds must be applied exactly, not coerced",
  );
  assert.ok(
    record.checks.writeOrder.ordersDiffer,
    "the two directions must produce different orders, or the order is not being computed",
  );

  // ⛔ Named as a gap, not as a result. See the header: this surface cannot construct the
  // careless order, so whether Figma would have rejected it is not something this run can
  // answer. Both readings would look identical, which is the shape that has produced a
  // false green here twice.
  record.stillOwed.push(
    "The premise UNDER the write ordering — that Figma rejects a transient min > max — is UNMEASURABLE through this surface. set_size_limits is the fork's only writer for these four properties and it refuses every path that would produce the transient, so a run in which the ordering was unnecessary reads exactly like one in which it was load-bearing. The ordering is adopted as the SAFE direction (it costs nothing if unnecessary, and prevents a partial application if not), not as a measured fact. ⛔ Do not record this gate as having confirmed it.",
  );

  // ── 6. 🔴 The open question decision ③ deferred — MEASURED, and the answer is a
  //        THIRD outcome neither the decision nor this gate's first draft anticipated ──
  //
  // Decision ③ allowed a non-auto-layout context rather than refusing it on the documented
  // claim, and named two possible answers: the limit RESOLVES (allow was right) or it is
  // INERT (a silent discard, so refuse). Figma does neither — it THROWS
  // `Can only set maxWidth on auto layout nodes and their children`.
  //
  // ⭐ So this section is a MEASUREMENT, not a check. It probes a matrix of contexts and
  // records which the platform accepts, because the exact eligibility rule is what any
  // handler-side refusal would have to encode — and encoding a guess is what decision ③
  // was avoiding in the first place. Nothing here asserts a specific answer.
  const plainFrameId = await callNodeId("create_frame", {
    x: 0,
    y: 700,
    width: 500,
    height: 300,
    name: "gate-plain-parent",
    parentId: scratchPageId,
  });
  const outsideId = await callNodeId("create_frame", {
    x: 20,
    y: 20,
    width: 300,
    height: 60,
    name: "gate-outside-child",
    parentId: plainFrameId,
  });
  const alTextId = await callNodeId("create_text", {
    x: 0,
    y: 0,
    text: "gate-al-text",
    name: "gate-al-text",
    parentId: alFrameId,
  });
  const plainTextId = await callNodeId("create_text", {
    x: 20,
    y: 200,
    text: "gate-plain-text",
    name: "gate-plain-text",
    parentId: plainFrameId,
  });
  const alRectId = await callNodeId("create_rectangle", {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    name: "gate-al-rect",
    parentId: alFrameId,
  });
  const plainRectId = await callNodeId("create_rectangle", {
    x: 20,
    y: 240,
    width: 100,
    height: 100,
    name: "gate-plain-rect",
    parentId: plainFrameId,
  });

  // ⛔ A generous maximum, deliberately above every probe node's width, so acceptance does
  // not resize anything. This section asks WHETHER the platform accepts, not what the
  // limit does — §3 already answered that.
  const contexts = [
    { name: "FRAME, child of an auto-layout FRAME", nodeId: controlId },
    { name: "the auto-layout FRAME itself (child of PAGE)", nodeId: alFrameId },
    { name: "FRAME, child of a plain FRAME", nodeId: outsideId },
    { name: "plain FRAME, child of PAGE", nodeId: plainFrameId },
    { name: "TEXT, child of an auto-layout FRAME", nodeId: alTextId },
    { name: "TEXT, child of a plain FRAME", nodeId: plainTextId },
    { name: "RECTANGLE, child of an auto-layout FRAME", nodeId: alRectId },
    { name: "RECTANGLE, child of a plain FRAME", nodeId: plainRectId },
  ];

  const eligibility = [];
  for (const context of contexts) {
    try {
      const receipt = (
        await callJson("set_size_limits", { nodeId: context.nodeId, maxWidth: 2000 })
      ).value;
      eligibility.push({
        context: context.name,
        accepted: true,
        nodeType: receipt.type,
        parentType: receipt.parentType,
        parentLayoutMode: receipt.parentLayoutMode,
      });
    } catch (probeError) {
      const message = String(probeError.message ?? probeError);
      eligibility.push({
        context: context.name,
        accepted: false,
        // ⭐ WHICH LAYER refused, and after the first run this is the load-bearing column.
        // The first run measured all four refusals coming from FIGMA, during the write
        // phase — the handler's read-based probe could not see the difference, because
        // these properties are readable on every node and only the WRITE is gated. The
        // handler now owns the rule, so a platform refusal here means it has been lost.
        platformRefusal: /Can only set/.test(message),
        handlerRefusal: /auto-layout nodes and their children/.test(message),
        message: message.slice(0, 220),
      });
    }
  }
  record.checks.eligibilityMatrix = eligibility;
  record.findings.push(
    `MEASURED — the eligibility rule for min/max, and it is CONTEXTUAL rather than type-based: ${eligibility
      .map((row) => `${row.context} → ${row.accepted ? "ACCEPTED" : "REFUSED"}`)
      .join("; ")}.`,
  );

  // ⛔ The fix's own acceptance test. Every ineligible context must be refused by THIS
  // TOOL, before the write phase, with a message naming the way in — not by Figma throwing
  // mid-write. A run where these come back as platform refusals is a run where
  // "validate-all-then-write" is a claim the tool cannot back.
  const refusedByPlatform = eligibility.filter(
    (row) => !row.accepted && row.platformRefusal,
  );
  assert.deepEqual(
    refusedByPlatform.map((row) => row.context),
    [],
    "these contexts reached Figma and were refused there, so the handler's context rule did not fire — the write phase can still throw",
  );
  assert.ok(
    eligibility.some((row) => !row.accepted && row.handlerRefusal),
    "no context was refused by the handler's own rule — the matrix proves nothing about who owns it",
  );
  assert.ok(
    eligibility.some((row) => row.accepted),
    "no context was accepted — a rule that refuses everything would pass the checks above",
  );

  // ── 6b. ⛔ THE ONE THAT MATTERS: does the platform's throw leave a PARTIAL write? ──
  //
  // This item exists because it is the first layout tool where partial application is
  // genuinely possible, and the handler's write phase is commented "this block cannot
  // reject". Against real Figma that comment is FALSE — the platform rejects during the
  // write phase on an ineligible node. So the question is no longer theoretical: with two
  // fields requested and the write phase throwing, does the FIRST field land?
  //
  // ⭐ Measured in GEOMETRY, because a node that refuses the write also refuses to be read
  // through this tool. minWidth 400 on a 300-wide node would grow it; if the width moved,
  // the first write landed and the throw left the document changed.
  const partialProbeId = await callNodeId("create_frame", {
    x: 20,
    y: 400,
    width: 300,
    height: 60,
    name: "gate-partial-probe",
    parentId: plainFrameId,
  });
  const partialBefore = await boxOf(partialProbeId);
  assertSizeChannelWorks(partialBefore, "before the partial-application probe");
  const partialRefusal = await callExpectingRefusal("set_size_limits", {
    nodeId: partialProbeId,
    minWidth: 400,
    maxWidth: 500,
  });
  const partialAfter = await boxOf(partialProbeId);

  // ⛔ The instrument asks whether an ineligible context EXISTS, not which layer answers
  // it. Its first version tested for a PLATFORM refusal, which was true when the platform
  // owned the rule and became false the moment the handler took it over — so a correct fix
  // made the gate report that its own probe proved nothing. ⭐ An instrument pinned to the
  // implementation it is measuring fails on exactly the change it was built to verify.
  const ineligibleRefused = eligibility.some((row) => !row.accepted);
  record.checks.ineligibleCallIsAtomic = {
    refusalMessage: partialRefusal.message.slice(0, 250),
    layer: partialRefusal.layer,
    width: { before: partialBefore.width, after: partialAfter.width },
    // The instrument: if no context refused at all, this probe measured nothing.
    instrumentWorked: ineligibleRefused,
    held: partialBefore.width === partialAfter.width,
  };
  assert.ok(
    ineligibleRefused,
    "no context was refused by the platform, so the partial-application probe proves nothing",
  );
  assert.equal(
    partialAfter.width,
    partialBefore.width,
    "🔴 A TWO-FIELD CALL ON AN INELIGIBLE NODE LEFT A PARTIAL WRITE: the first field landed before the second was rejected, and the node changed size on a call that reported failure. This is exactly the partial application item 2.3 was built to prevent.",
  );
  record.checks.ineligibleCallIsAtomic.refusedBeforeTheWritePhase = /auto-layout nodes and their children/.test(
    partialRefusal.message,
  );
  assert.ok(
    record.checks.ineligibleCallIsAtomic.refusedBeforeTheWritePhase,
    "the two-field ineligible call must be refused by the handler's context rule, not by Figma during the write phase",
  );
  record.findings.push(
    `The ineligible two-field call is refused BEFORE the write phase and the node held at ${partialAfter.width}. ⛔ Worth recording why this check exists: on the FIRST run the handler had no context rule, Figma threw during the write phase instead, and the call happened to stay atomic only because the platform rejected the FIRST field. That was the platform's ordering, not this tool's guarantee.`,
  );

  // ── 7. 🔴 The harness's carrier model, against Figma ─────────────────────────────
  //
  // The offline fixture models these four properties as absent on a RECTANGLE, which is
  // what makes the "no surface" refusal reachable offline without surgery. §6's matrix
  // already probed a RECTANGLE in both contexts; this reads the verdict out of it.
  // ⛔ This section READS the harness rather than asserting a belief about it. Its first
  // version hardcoded `harnessModelsItAsAbsent: true` and pushed a red finding telling a
  // future reader to go fix `SIZE_LIMIT_CARRIERS` — which was true when written and became
  // false the moment the harness was corrected in the same session. A gate that reports an
  // already-repaired defect in alarming red is the status-marker trap, and it costs someone
  // an afternoon "fixing" correct code.
  const harnessSource = await readFile(
    path.join(root, "tests/helpers/plugin-harness.mjs"),
    "utf8",
  );
  const rectInAutoLayout = eligibility.find((row) =>
    row.context.startsWith("RECTANGLE, child of an auto-layout"),
  );
  const textInPlain = eligibility.find((row) =>
    row.context.startsWith("TEXT, child of a plain"),
  );
  const harnessModelsContext = /takesSizeLimits/.test(harnessSource);
  const harnessModelsType = /SIZE_LIMIT_CARRIERS/.test(harnessSource);

  record.checks.harnessModel = {
    liveSaysContextual:
      rectInAutoLayout?.accepted === true && textInPlain?.accepted === false,
    harnessModelsContext,
    harnessModelsType,
    agrees: harnessModelsContext && !harnessModelsType,
  };
  // ⭐ The discrimination: a RECTANGLE accepted inside auto-layout AND a TEXT refused
  // outside it. Either reading alone is consistent with a type rule; together they are not.
  assert.ok(
    record.checks.harnessModel.liveSaysContextual,
    "the matrix did not separate context from type, so nothing can be concluded about the harness's model",
  );
  assert.ok(
    record.checks.harnessModel.agrees,
    "Figma's rule is contextual but the offline harness still gates these properties by node TYPE — its eligibility tests are green against a fiction",
  );
  record.findings.push(
    "The offline harness models the same rule Figma enforces, and this is READ from the harness rather than assumed: a RECTANGLE inside an auto-layout frame was ACCEPTED live and a TEXT inside a plain frame was REFUSED, which no type-based rule can produce, and the harness gates the setter on context (`takesSizeLimits`) with no type allowlist left.",
  );

  // ── 8. ⭐ The clear, measured behaviourally rather than by reading back a null ────
  //
  // Leg one is the instrument: with the max in force, a resize past it must be clamped
  // back. Leg two is the question: after the clear, the same resize must be allowed
  // through. Two different numbers. ⛔ Reading `maxWidth` back as null would have passed
  // against a node that never had one.
  // ⛔ Parented into the AUTO-LAYOUT frame, not the page — §6 measured that a page child
  // cannot take a limit at all, so the first draft's node would have thrown here.
  const clearNodeId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 300,
    height: 60,
    name: "gate-clear-child",
    parentId: alFrameId,
  });
  await call("set_size_limits", { nodeId: clearNodeId, maxWidth: 200 });
  await call("resize_node", { nodeId: clearNodeId, width: 400, height: 60 });
  const whileLimited = await boxOf(clearNodeId);

  const clearReceipt = (
    await callJson("set_size_limits", { nodeId: clearNodeId, maxWidth: null })
  ).value;
  await call("resize_node", { nodeId: clearNodeId, width: 400, height: 60 });
  const afterClear = await boxOf(clearNodeId);

  record.checks.clearRemovesTheLimit = {
    whileLimited: whileLimited.width,
    afterClear: afterClear.width,
    receiptClearedFields: clearReceipt.clearedFields,
    receiptLimit: clearReceipt.limits?.maxWidth ?? null,
    // The instrument: if the limit never bit, the second leg proves nothing.
    limitWasInForce: whileLimited.width === 200,
    separated: whileLimited.width !== afterClear.width,
  };
  assert.deepEqual(
    clearReceipt.clearedFields,
    ["maxWidth"],
    "the receipt must report the clear as a clear, not as an ordinary write",
  );
  assert.ok(
    record.checks.clearRemovesTheLimit.limitWasInForce,
    `the instrument failed: a resize to 400 under maxWidth 200 came back ${whileLimited.width}, so the clear leg below would prove nothing`,
  );
  assert.equal(
    afterClear.width,
    400,
    "after the clear the node must accept the resize the limit previously refused",
  );

  // ── 9. The layering split, through the transport ────────────────────────────────
  const badType = await callExpectingRefusal("set_size_limits", {
    nodeId: clearNodeId,
    minWidth: "200",
  });
  const zero = await callExpectingRefusal("set_size_limits", {
    nodeId: clearNodeId,
    minWidth: 0,
  });
  const empty = await callExpectingRefusal("set_size_limits", { nodeId: clearNodeId });
  const pageRefusal = await callExpectingRefusal("set_size_limits", {
    nodeId: scratchPageId,
    maxWidth: 300,
  });

  record.checks.layerSplit = {
    badType: badType.layer,
    zero: zero.layer,
    empty: empty.layer,
    page: pageRefusal.layer,
    pageMessage: pageRefusal.message.slice(0, 250),
  };
  assert.equal(
    badType.layer,
    "schema",
    "a non-numeric limit is a TYPE error and Zod owns it — it must not reach the plugin",
  );
  assert.equal(
    zero.layer,
    "handler",
    "the zero rule belongs with the pair rule in the plugin, not split across two layers",
  );
  assert.equal(empty.layer, "handler", "the zero-field refusal is a handler decision");
  assert.equal(
    pageRefusal.layer,
    "handler",
    "a PAGE has no size-limit surface, which only the document can answer",
  );

  // ⛔ And no refusal moved the document, measured in the same currency as §3.
  const afterAllRefusals = await boxOf(clearNodeId);
  record.checks.refusalsAreInert = {
    width: { before: afterClear.width, after: afterAllRefusals.width },
    held: afterAllRefusals.width === afterClear.width,
  };
  assert.ok(
    record.checks.refusalsAreInert.held,
    "four refusals in a row must leave the node exactly where it was",
  );

  // ── 10. The batch surface still excludes it, live ───────────────────────────────
  const batchRefusal = await callExpectingRefusal("apply_batch", {
    operations: [
      {
        id: "a",
        op: "set_size_limits",
        nodeId: clearNodeId,
        params: { minWidth: 100 },
      },
    ],
  });
  record.checks.batchExcluded = {
    layer: batchRefusal.layer,
    message: batchRefusal.message.slice(0, 200),
  };

  record.stillOwed.push(
    "2.4 (set_clips_content) is not built and not covered here. This gate is item 2.3 alone, per the owner's one-tool-at-a-time decision.",
  );
  // ⛔ This slot used to hardcode "FOUR gates now pin builds this tree no longer
  // produces" — true when written, FALSE from 2026-08-22, when the whole stale set was
  // re-pinned to the item 2.4 build and re-run on channel sa6ggz00. ⭐ The fix is not a
  // corrected count: it is to stop asserting a belief and READ the declaration file —
  // the same repair §7 of this gate already needed for SIZE_LIMIT_CARRIERS.
  const staleGateDeclarations = [
    ...(await readFile(path.join(root, "tests/live-gate-pins.test.mjs"), "utf8")).matchAll(
      /^\s*"(live-[a-z-]+\.mjs)":/gm,
    ),
  ].map((match) => match[1]);
  if (staleGateDeclarations.length > 0) {
    record.stillOwed.push(
      `${staleGateDeclarations.length} gate(s) are declared as pinned to an earlier release in tests/live-gate-pins.test.mjs and are owed a re-pin AND a re-run together, because re-pinning without re-running is the e02d1b2 defect: ${staleGateDeclarations.join(", ")}.`,
    );
  }
  // ⛔ This slot used to assert "set_size_limits ships at resultStability `stable` from
  // birth" — true when written, FALSE from item 2.4's CC1 repair, which walked all four
  // layout tools back to additive-preview. Read the published contract.
  const publishedStability = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  ).tools.find((tool) => tool.name === "set_size_limits")?.resultStability;
  record.checks.publishedStability = publishedStability ?? null;
  if (publishedStability === "stable") {
    record.stillOwed.push(
      "set_size_limits is published at resultStability `stable`, so a reply-shape defect found later needs a publicContractVersion bump — and 1.9.0 is reserved for R2.7. Named here so the exposure is on the record.",
    );
  }
  record.stillOwed.push(
    "Whether Figma ROUNDS a fractional limit is not measured. The tool accepts 12.5 and compares the read-back exactly, so a platform that rounded would drop the field out of appliedFields rather than lie — but no leg here supplies a fractional value to a real node.",
  );

  record.success = true;
} catch (error) {
  failure = error;
  record.success = false;
  record.error = { message: error?.message ?? String(error), stack: error?.stack };
} finally {
  // ⛔ Cleanup lives here, not on the success path. An aborted gate that leaves a page
  // behind has happened once already. ⭐ Everything this gate creates is parented into the
  // scratch page, so unlike 2.2's there is no second cleanup path to get wrong.
  if (scratchPageId) {
    try {
      if (originalPageId) await call("set_current_page", { pageId: originalPageId });
      const deleted = await call("delete_node", { nodeId: scratchPageId });
      record.cleanup = { pageId: scratchPageId, reply: deleted.text };
      const pagesAfter = (await callJson("get_pages")).value;
      record.cleanup.baselineRestored =
        (pagesAfter.pageCount ?? pagesAfter.pages?.length) === record.baseline?.pageCount &&
        pagesAfter.currentPageId === originalPageId &&
        JSON.stringify((pagesAfter.pages ?? []).map((page) => page.id)) ===
          JSON.stringify(record.baseline?.pageIds);
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
  process.stderr.write(`R2.6 2.3 size limits live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.6 2.3 size limits live gate PASSED\n");
