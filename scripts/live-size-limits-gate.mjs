#!/usr/bin/env node

/**
 * R2.6 item 2.3 — the size-limits live gate.
 *
 * What this proves that the 256 offline tests cannot:
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
 *  🔴 **That the ALLOW decision was right, or that it was not.** Decision ③ refused to
 *     encode the documented claim that min/max are an auto-layout feature, because an
 *     unverified refusal looks authoritative — 2.2's GROUP question, same shape. §6
 *     measures whether a limit resolves on a node outside ANY auto-layout context and
 *     returns THREE answers. `inert` is a finding telling a future reader to revisit the
 *     decision; `unmeasured` is a gap and must never be read as support for it.
 *
 *  🔴 **That the harness's carrier model matches Figma.** The offline fixture models these
 *     four properties as present on frame-likes and text and absent on a RECTANGLE, a GROUP
 *     and a PAGE — which is what makes the "no surface" refusal reachable offline without
 *     surgery. That is a MODEL of Figma's documentation, not a measurement. §7 puts it
 *     against the real platform, and if Figma disagrees the harness is what changes, since
 *     the handler asks the node rather than consulting a list.
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

// ⛔ PINNED to R2.6 item 2.3. Which halves moved: both build IDs moved, the fingerprint
// moved and the tool count moved 58 → 59, but the schema HELD at 1.8.0 — a new tool is
// additive, so item 2.0's bump still covers this tree. That is the SAME shape as 2.1 and
// 2.2, and a DIFFERENT shape from 2.0, which moved the schema too.
//
// ⭐ Read that as an operator instruction: the DEV plugin **must** be re-run before this
// gate, because `code.js` changed. The gate spawns its own server from `dist/server.js`,
// so the server half needs no respawn *here* — an interactive MCP session does.
//
// ⚠️ Eight releases running, this answer has changed shape almost every time. ⛔ Do not
// carry it forward — re-derive which halves moved from `runtime-metadata.ts` every time.
const expectedRuntime = {
  serverBuildId: "r2-server-de9d03651f55",
  pluginBuildId: "r2-plugin-81dba60db9dd",
  schemaVersion: "1.8.0",
  fingerprint:
    "sha256:89be6e6c668d147b17c58f9f1d7f454d8d60ad38657e13d935cf4142cea87f9d",
  toolCount: 59,
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

  // ── 6. 🔴 The open question: does a limit resolve OUTSIDE auto-layout? ───────────
  //
  // Decision ③ allowed this case rather than refusing it on the documented claim. §3 is the
  // instrument: it already proved a limit resolves INSIDE an auto-layout frame on this
  // build, so a null reading here is about the context and not about the tool.
  // ⛔ THREE outcomes, and the third is not a pass.
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
  const outsideControlId = await callNodeId("create_frame", {
    x: 20,
    y: 120,
    width: 300,
    height: 60,
    name: "gate-outside-control",
    parentId: plainFrameId,
  });

  const outsideBefore = await boxOf(outsideId);
  const outsideControlBefore = await boxOf(outsideControlId);
  const outsideReceipt = (
    await callJson("set_size_limits", { nodeId: outsideId, maxWidth: 150 })
  ).value;
  const outsideAfter = await boxOf(outsideId);
  const outsideControlAfter = await boxOf(outsideControlId);

  const instrumentWorked = record.checks.limitsClamp.separated;
  const outsideMoved = outsideAfter.width !== outsideBefore.width;
  const controlHeld = outsideControlAfter.width === outsideControlBefore.width;

  record.checks.resolvesOutsideAutoLayout = {
    tested: { before: outsideBefore.width, after: outsideAfter.width, limit: 150 },
    control: {
      before: outsideControlBefore.width,
      after: outsideControlAfter.width,
    },
    receiptResized: outsideReceipt.resized,
    parentLayoutMode: outsideReceipt.parentLayoutMode,
    // ⭐ The control must NOT have moved, or the two children are not separated and any
    // reading of the tested one is confounded — 2.2 §6's repair, applied at design time.
    separated: outsideMoved && controlHeld,
    verdict: !instrumentWorked
      ? "unmeasured"
      : !controlHeld
        ? "unmeasured"
        : outsideMoved
          ? "resolves"
          : "inert",
  };

  const outsideVerdict = record.checks.resolvesOutsideAutoLayout.verdict;
  if (outsideVerdict === "resolves") {
    record.findings.push(
      `MEASURED, not assumed: a size limit RESOLVES outside any auto-layout context — a child of a plain FRAME went ${outsideBefore.width} → ${outsideAfter.width} under maxWidth 150 while its untouched sibling held at ${outsideControlAfter.width}. Decision ③ was right to allow the case rather than refuse it on the documented auto-layout claim.`,
    );
  } else if (outsideVerdict === "inert") {
    record.findings.push(
      `🔴 A size limit is INERT outside auto-layout: the child held at ${outsideAfter.width} under maxWidth 150 while §3 proved the same write resolves inside an auto-layout frame. set_size_limits is storing a value Figma discards here, which is the silent discard 2.1 and 2.2 both refuse. Revisit decision ③ before 2.4 lands — the refusal now has the measurement it was waiting for.`,
    );
  } else {
    record.stillOwed.push(
      `The outside-auto-layout question is UNMEASURED, not answered: instrument=${instrumentWorked}, controlHeld=${controlHeld}. ⛔ Do not read this run as support for either decision.`,
    );
  }

  // ── 7. 🔴 The harness's carrier model, against Figma ─────────────────────────────
  //
  // The offline fixture models these four properties as absent on a RECTANGLE. That is a
  // model of Figma's documentation, and this is the first thing to put it against Figma.
  const rectId = await callNodeId("create_rectangle", {
    x: 0,
    y: 400,
    width: 100,
    height: 100,
    name: "gate-carrier-probe",
    parentId: scratchPageId,
  });
  let rectRefusal = null;
  let rectAccepted = null;
  try {
    rectAccepted = (
      await callJson("set_size_limits", { nodeId: rectId, maxWidth: 50 })
    ).value;
  } catch {
    rectAccepted = null;
  }
  if (!rectAccepted) {
    rectRefusal = await callExpectingRefusal("set_size_limits", {
      nodeId: rectId,
      maxWidth: 50,
    });
  }
  record.checks.carrierModel = {
    rectangleRefused: Boolean(rectRefusal),
    layer: rectRefusal?.layer ?? null,
    message: rectRefusal?.message?.slice(0, 300) ?? null,
    // ⭐ Recorded either way. A RECTANGLE that ACCEPTS the write means the harness is
    // over-refusing offline and the carrier Set is what changes — never the handler, which
    // asks the node.
    modelAgreesWithFigma: Boolean(rectRefusal),
  };
  if (rectRefusal) {
    record.findings.push(
      "The offline harness's carrier model matches Figma on the case it was built to reach: a RECTANGLE exposes no size limits and is refused for having no surface, not by a type allowlist.",
    );
  } else {
    record.findings.push(
      `🔴 A RECTANGLE ACCEPTED a size limit (resized=${rectAccepted?.resized}). The offline harness models these four properties as absent on a RECTANGLE, so the fixture is stricter than Figma and the "no surface" refusal is being reached offline for a case that does not exist. ⛔ Fix the harness's SIZE_LIMIT_CARRIERS, not the handler — the handler reads the node and was right.`,
    );
  }

  // ── 8. ⭐ The clear, measured behaviourally rather than by reading back a null ────
  //
  // Leg one is the instrument: with the max in force, a resize past it must be clamped
  // back. Leg two is the question: after the clear, the same resize must be allowed
  // through. Two different numbers. ⛔ Reading `maxWidth` back as null would have passed
  // against a node that never had one.
  const clearNodeId = await callNodeId("create_frame", {
    x: 0,
    y: 1100,
    width: 300,
    height: 60,
    name: "gate-clear-child",
    parentId: scratchPageId,
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
  record.stillOwed.push(
    "FOUR gates now pin builds this tree no longer produces — live-batch-gate.mjs, live-text-style-gate.mjs, live-layout-gate.mjs and now live-constraints-gate.mjs, which passed earlier the same day. All four are declared stale by name in tests/live-gate-pins.test.mjs and are owed a re-pin AND a re-run together, because re-pinning without re-running is the e02d1b2 defect. Owner's standing call of 2026-08-22: do it once, after the layout tools land — 2.4 is the last of them.",
  );
  record.stillOwed.push(
    "set_size_limits ships at resultStability `stable` from birth, following 2.1 and 2.2 rather than R2.5's hold-at-additive-preview. A reply-shape defect found later needs a publicContractVersion bump, and 1.9.0 is reserved for R2.7. The exposure window is this session; it is named here so the choice is on the record.",
  );
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
