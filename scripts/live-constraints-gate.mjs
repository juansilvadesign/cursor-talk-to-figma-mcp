#!/usr/bin/env node

/**
 * R2.6 item 2.2 — the constraints live gate.
 *
 * What this proves that the 224 offline tests cannot:
 *
 *  ⭐ **That the write DOES something.** Offline, `node.constraints = {…}` stores an object
 *     in a fixture and every assertion reads that same object back. Nothing resolves a
 *     constraint. Here Figma does, so the load-bearing measurement is what happens to a
 *     child's OFFSETS when its parent is resized: a MIN-constrained child holds its LEFT
 *     offset, a MAX-constrained child holds its RIGHT offset, a STRETCH-constrained child
 *     holds both and changes width. A tool that stored the strings and moved nothing would
 *     leave every child sitting where it was, and §3 would catch it.
 *
 *  ⭐ **That the un-named axis genuinely SURVIVES.** This is the risk the merge creates.
 *     `constraints` is one object property, so writing one axis means reading the current
 *     pair, merging, and assigning both — and a read-modify-write that read wrong would
 *     silently reset the other axis to whatever it guessed. Offline that is checked
 *     against a fixture. §4 checks it against Figma, in geometry: after writing only the
 *     horizontal axis, the child must still behave VERTICALLY like the CENTER it was
 *     seeded with, not like the MIN a rebuilt-from-scratch object would produce.
 *
 *  ⭐ **That the layering decision is real through the transport.** 2.1 put its narrow
 *     rules in the PLUGIN so a semantic refusal would not arrive as a generic enum error.
 *     2.2 splits deliberately the other way: all five constraint values are legal, so the
 *     ENUM lives in Zod (`layer: "schema"`), while the three context refusals — an in-flow
 *     auto-layout child, a PAGE parent, a node with no constraints property — can only be
 *     judged by looking at the document, so they live in the plugin (`layer: "handler"`).
 *     §5 asserts which layer answered each one. Offline, both look identical.
 *
 *  ⭐ **That a PageNode really has no `constraints`.** The offline harness models
 *     ConstraintMixin by node type rather than handing every node a default — the fix for
 *     the blanket `layoutMode: "NONE"` that item 2.1 had to work around with a `delete`
 *     inside a test. §5c is still the first thing to put that model against real Figma.
 *
 *  🔴 **That the premise behind the auto-layout refusal is TRUE.** `set_constraints`
 *     refuses an in-flow auto-layout child on the claim that Figma stores constraints
 *     there and never applies them. That claim is the entire justification for the
 *     refusal, so §7 MEASURES it: the same stored constraint is observed while the child
 *     is ABSOLUTE (where it must be honoured) and again once it is back in the flow (where
 *     it must not be). Two measurements, opposite outcomes, one stored value.
 *     ⛔ "Test a stated constraint, don't build on it" — and note that §7 can return
 *     THREE answers. An `unmeasured` verdict lands in `stillOwed` and must NEVER be read
 *     as confirmation.
 *
 * ⭐ One precondition this gate depends on, and which its own §3 proves rather than
 *    assumes: `resize_node` calls `node.resize()`, NOT `resizeWithoutConstraints()`. Had
 *    it been the latter, every measurement here would read "constraints do nothing" and
 *    the gate would produce a confident FALSE RED against a correct tool. A green §3 — a
 *    MAX child that moves while its MIN sibling holds — is only possible under a
 *    constraint-honouring resize, so the precondition is entailed by the result.
 *
 * ⛔ Three traps inherited from the gates before it, each already paid for once:
 *
 *  1. A refusal is an EXPECTED outcome and arrives in two shapes — the plugin throws and
 *     the wrapper catches it into an error *result* (`layer: "handler"`), or Zod rejects
 *     the argument before dispatch and it arrives thrown (`layer: "schema"`). Scoring
 *     either as a crash has failed this project three times.
 *  2. A gate that mutates cleans up in a `finally`, not on the success path.
 *  3. A rebuild reaches neither running side. This script spawns its own server from
 *     `dist/server.js`, so the SERVER half is always fresh — but the Figma DEV plugin
 *     holds `code.js` from launch, so a stale plugin is the failure mode this pins for.
 *     ⛔ `compatibility: "compatible"` only means the two RUNNING halves match each
 *     other; it says nothing about whether they match this tree.
 *
 * 🔴 And the trap this gate is shaped by, inherited straight from item 2.1's first run:
 * **a check whose two outcomes read identically cannot fail in either direction.** 2.1
 * scored a refusal by asserting a height held, having written `layoutGrow: 0`, which
 * changes no height — so the check was decorative. Every measurement below is therefore a
 * DISCRIMINATION between two children, or between two states of one child, chosen so the
 * bug's reading and the fix's reading are different numbers.
 *
 * Every write lands on a scratch page this gate creates and deletes.
 *
 * Usage:
 *   node scripts/live-constraints-gate.mjs --channel=<DEV-plugin-channel> \
 *        [--group-child=<nodeId>] [--output-dir=<dir>] [--server=<dist-server-path>]
 *
 *   --group-child is OPTIONAL and enables §6. The fork ships no group-creation tool, so
 *   the gate cannot author a group child; point this at a hand-made rectangle inside a
 *   group and §6 measures whether a group resolves constraints. Omit it and §6 reports
 *   `unmeasured` — which is a gap, not a pass.
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
    "Usage: node scripts/live-constraints-gate.mjs --channel=<DEV-plugin-channel> [--group-child=<nodeId>] [--output-dir=<dir>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// ⛔ PINNED to R2.6 item 2.2. Which halves moved: both build IDs moved, the fingerprint
// moved and the tool count moved 57 → 58, but the schema HELD at 1.8.0 — a new tool is
// additive, so item 2.0's bump still covers this tree. That is the SAME shape as 2.1 and
// a DIFFERENT shape from 2.0, which moved the schema too.
//
// ⭐ Read that as an operator instruction: the DEV plugin **must** be re-run before this
// gate, because `code.js` changed. The gate spawns its own server from `dist/server.js`,
// so the server half needs no respawn *here* — an interactive MCP session does.
//
// ⚠️ Seven releases running, this answer has changed shape almost every time. ⛔ Do not
// carry it forward — re-derive which halves moved from `runtime-metadata.ts` every time.
const expectedRuntime = {
  serverBuildId: "r2-server-06f75969aa1d",
  pluginBuildId: "r2-plugin-e82230c1bbb1",
  schemaVersion: "1.8.0",
  fingerprint:
    "sha256:8ceaf9d212e9fc1520dd510c2f039b0548676edc63ecfc20607b2317a93b236f",
  toolCount: 58,
};

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const scratchPageName = `R2.6 2.2 constraints gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.6-constraints-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r2.6-constraints-gate",
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
    runtime.plugin?.supportedCommands.includes("set_constraints"),
    "plugin lacks set_constraints — re-run the DEV plugin",
  );
}

/**
 * ⛔ The INDEPENDENT channel, and the currency this whole gate is denominated in.
 *
 * `get_node_info` exports `JSON_REST_V1`, and the typography gate learned that reaching
 * for plugin-API property names against that shape returns all-null — where null-before
 * against null-after passes vacuously. So nothing here is measured by reading back
 * `constraints`. It is measured in OFFSETS, which is what a constraint actually means:
 * the distance a constraint promises to preserve when the parent resizes. `left`/`right`/
 * `top`/`bottom` are derived from two `absoluteBoundingBox` reads, so they survive the
 * parent being anywhere on the canvas.
 *
 * ⭐ Deliberately NOT a `set_constraints` call with a no-op argument. That would be a
 * WRITE used as a read — the instrument that reverts the state it asserts, which this
 * project has shipped once already.
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
    // Recorded, never asserted blind — whether REST carries `constraints` at all is
    // something §3 measures rather than assumes, exactly as 2.1 did with layoutAlign.
    restConstraints: node?.constraints ?? null,
  };
}

async function offsetsOf(childId, parentId) {
  const [child, parent] = await Promise.all([boxOf(childId), boxOf(parentId)]);
  return {
    left: child.x - parent.x,
    right: parent.x + parent.width - (child.x + child.width),
    top: child.y - parent.y,
    bottom: parent.y + parent.height - (child.y + child.height),
    width: child.width,
    height: child.height,
    restConstraints: child.restConstraints,
  };
}

function assertOffsetChannelWorks(offsets, context) {
  for (const key of ["left", "right", "top", "bottom", "width", "height"]) {
    assert.equal(
      typeof offsets[key],
      "number",
      `${context}: the offset channel returned a non-numeric ${key} — every comparison below would be vacuous`,
    );
    assert.ok(
      Number.isFinite(offsets[key]),
      `${context}: ${key} read back as ${offsets[key]}`,
    );
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
// ⛔ Tracked separately from the scratch page. §6 clones a node the OPERATOR supplied, and
// `clone_node` lands the clone beside its original — on their page, not ours. It is moved
// into the scratch frame immediately, but if THAT call is what fails, the clone is an
// orphan on a real document and deleting the scratch page would not reach it.
let groupCloneId = null;
let groupControlCloneId = null;
let failure = null;

try {
  await client.connect(transport);

  // ── 1. The published surface, read from the runtime and never from the source ────
  const inventory = await client.listTools();
  const tool = inventory.tools.find((entry) => entry.name === "set_constraints");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(tool, "set_constraints is not in the published tool surface");

  const schema = tool.inputSchema ?? {};
  const description = String(tool.description ?? "");
  const axisValues = (axis) => schema.properties?.[axis]?.enum ?? null;
  record.checks.publishedSchema = {
    horizontalEnum: axisValues("horizontal"),
    verticalEnum: axisValues("vertical"),
    required: schema.required ?? [],
    // ⛔ Both axes OPTIONAL is the owner's decision made visible in the contract. If a
    // future change makes one required, every caller that relied on the carry-over
    // silently starts clobbering the other axis, and this is the line that notices.
    bothAxesOptional:
      !(schema.required ?? []).includes("horizontal") &&
      !(schema.required ?? []).includes("vertical"),
    describesTheCarryOver: /carried over/i.test(description),
    describesTheAutoLayoutRefusal: /auto-layout/i.test(description),
    namesTheWayIn: /layoutPositioning/i.test(description),
  };
  const FIVE = ["MIN", "CENTER", "MAX", "STRETCH", "SCALE"];
  assert.deepEqual(
    [...(axisValues("horizontal") ?? [])].sort(),
    [...FIVE].sort(),
    "the horizontal axis must publish all five values Figma defines — none is refused here",
  );
  assert.deepEqual(
    [...(axisValues("vertical") ?? [])].sort(),
    [...FIVE].sort(),
    "the vertical axis must publish all five values Figma defines",
  );
  assert.ok(
    record.checks.publishedSchema.bothAxesOptional,
    "both axes must be optional — a required pair makes every call a two-axis overwrite",
  );
  assert.ok(
    record.checks.publishedSchema.describesTheCarryOver,
    "the published description must state that an omitted axis is carried over",
  );
  assert.ok(
    record.checks.publishedSchema.namesTheWayIn,
    "the published description must name the ABSOLUTE escape hatch, not just the refusal",
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

  // ── 2. Scratch page, a PLAIN frame, and two children with room to move ──────────
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    currentPageId: originalPageId,
    pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
  };

  scratchPageId = await callNodeId("create_page", { name: scratchPageName });
  await call("set_current_page", { pageId: scratchPageId });

  // ⛔ layoutMode stays NONE. An auto-layout parent is the case this tool REFUSES, so the
  // primary surface needs a plain frame — the same hole the offline fixture had.
  const frameId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 400,
    height: 600,
    name: "gate-static-parent",
    parentId: scratchPageId,
  });

  const minChildId = await callNodeId("create_rectangle", {
    x: 20,
    y: 20,
    width: 80,
    height: 40,
    name: "gate-min-child",
    parentId: frameId,
  });
  const maxChildId = await callNodeId("create_rectangle", {
    x: 20,
    y: 100,
    width: 80,
    height: 40,
    name: "gate-max-child",
    parentId: frameId,
  });
  const stretchChildId = await callNodeId("create_rectangle", {
    x: 20,
    y: 200,
    width: 80,
    height: 40,
    name: "gate-stretch-child",
    parentId: frameId,
  });

  // ── 3. ⭐ THE WRITE DOES SOMETHING — three children, one resize, three outcomes ──
  //
  // The DISCRIMINATION this gate turns on. Same parent, same resize, three constraints:
  //   MIN     → holds its LEFT offset, its right offset grows
  //   MAX     → holds its RIGHT offset, its left offset grows
  //   STRETCH → holds BOTH offsets, so its own width grows
  // A tool that stored the strings and applied nothing leaves all three identical to MIN,
  // and no two of these readings are the same number. ⛔ This is what item 2.1's first
  // run got wrong: it scored a claim whose pass and fail readings were identical.
  const minBefore = await offsetsOf(minChildId, frameId);
  assertOffsetChannelWorks(minBefore, "before the constraint writes");

  const minReceipt = (
    await callJson("set_constraints", { nodeId: minChildId, horizontal: "MIN" })
  ).value;
  const maxReceipt = (
    await callJson("set_constraints", { nodeId: maxChildId, horizontal: "MAX" })
  ).value;
  const stretchReceipt = (
    await callJson("set_constraints", { nodeId: stretchChildId, horizontal: "STRETCH" })
  ).value;

  assert.deepEqual(minReceipt.requestedFields, ["horizontal"]);
  assert.deepEqual(minReceipt.preservedFields, ["vertical"]);
  assert.equal(minReceipt.parentType, "FRAME");
  assert.equal(
    minReceipt.parentLayoutMode,
    "NONE",
    "a plain FRAME must report layoutMode NONE — if this is null the parent is not what the gate built",
  );

  // Widen the parent by 200. Everything below is measured against that single move.
  await call("resize_node", { nodeId: frameId, width: 600, height: 600 });
  const minAfter = await offsetsOf(minChildId, frameId);
  const maxAfter = await offsetsOf(maxChildId, frameId);
  const stretchAfter = await offsetsOf(stretchChildId, frameId);
  await call("resize_node", { nodeId: frameId, width: 400, height: 600 });

  record.checks.constraintsResolve = {
    parentWidth: { before: 400, after: 600 },
    min: { leftBefore: minBefore.left, leftAfter: minAfter.left, widthAfter: minAfter.width },
    max: { rightBefore: minBefore.right, rightAfter: maxAfter.right, leftAfter: maxAfter.left },
    stretch: { widthBefore: 80, widthAfter: stretchAfter.width },
    // ⛔ Recorded, not asserted: whether REST carries `constraints` at all. A null here is
    // a gap in the read channel, never evidence about the write.
    restReportsConstraints: minAfter.restConstraints,
  };

  assert.equal(
    minAfter.left,
    20,
    `a MIN-constrained child must hold its left offset across a parent resize; it read ${minAfter.left}`,
  );
  assert.equal(
    maxAfter.right,
    300,
    `a MAX-constrained child must hold its RIGHT offset across a parent resize; it read ${maxAfter.right}. If this equals the MIN child's behaviour the constraint was stored and never applied.`,
  );
  assert.ok(
    maxAfter.left > minAfter.left + 100,
    `the MAX child must have MOVED where the MIN child did not — left offsets read ${minAfter.left} and ${maxAfter.left}. Equal values mean set_constraints wrote a string that Figma ignored.`,
  );
  assert.ok(
    stretchAfter.width > 200,
    `a STRETCH-constrained child must have GROWN with its parent; width read ${stretchAfter.width}`,
  );
  record.findings.push(
    `MEASURED: one parent resize (400 → 600) produced three different geometries — MIN held left at ${minAfter.left}, MAX held right at ${maxAfter.right} and moved to left ${maxAfter.left}, STRETCH grew to width ${stretchAfter.width}. Offline none of these numbers can move, and no two of them agree.`,
  );

  // ── 4. ⭐ THE UN-NAMED AXIS SURVIVES — the merge, measured in geometry ───────────
  //
  // The risk the merge creates: a read-modify-write that read wrong would reset the axis
  // the caller never named, and the receipt — built from the same wrong read — would agree
  // with itself. So the second axis is checked by BEHAVIOUR, not by the receipt.
  const mergeChildId = await callNodeId("create_rectangle", {
    x: 20,
    y: 300,
    width: 80,
    height: 40,
    name: "gate-merge-child",
    parentId: frameId,
  });
  await call("set_constraints", {
    nodeId: mergeChildId,
    horizontal: "MAX",
    vertical: "CENTER",
  });
  const mergeReceipt = (
    await callJson("set_constraints", { nodeId: mergeChildId, horizontal: "MIN" })
  ).value;

  const mergeBefore = await offsetsOf(mergeChildId, frameId);
  await call("resize_node", { nodeId: frameId, width: 400, height: 900 });
  const mergeAfter = await offsetsOf(mergeChildId, frameId);
  await call("resize_node", { nodeId: frameId, width: 400, height: 600 });

  const verticalCentreMoved = mergeAfter.top - mergeBefore.top;
  record.checks.mergePreservesTheOtherAxis = {
    receiptPrevious: mergeReceipt.previous,
    receiptConstraints: mergeReceipt.constraints,
    preservedFields: mergeReceipt.preservedFields,
    parentHeight: { before: 600, after: 900 },
    topBefore: mergeBefore.top,
    topAfter: mergeAfter.top,
    movedBy: verticalCentreMoved,
    // A CENTER child keeps its centre offset, so +300 of parent height moves it +150.
    // A child reset to MIN holds its top at exactly where it was.
    behavesAsCenter: verticalCentreMoved > 100,
  };
  assert.deepEqual(
    mergeReceipt.previous,
    { horizontal: "MAX", vertical: "CENTER" },
    "the receipt did not report the state it merged from",
  );
  assert.deepEqual(mergeReceipt.constraints, { horizontal: "MIN", vertical: "CENTER" });
  assert.deepEqual(mergeReceipt.preservedFields, ["vertical"]);
  // ⛔ The load-bearing one: the receipt could say CENTER while the document held MIN.
  assert.ok(
    record.checks.mergePreservesTheOtherAxis.behavesAsCenter,
    `the un-named vertical axis did NOT survive the merge: a CENTER child should move ~150 when the parent grows 300, and this one moved ${verticalCentreMoved}. A reset to MIN reads as 0.`,
  );
  record.findings.push(
    `MEASURED: writing only \`horizontal\` left the vertical axis genuinely CENTER — the child moved ${verticalCentreMoved}px when the parent grew 300px. A read-modify-write that reset it would have moved 0, and the receipt alone could not tell the two apart.`,
  );

  // ── 5. The refusals, and WHICH LAYER answered each ───────────────────────────────
  //
  // ⭐ The split is the design decision under test. All five constraint values are legal,
  // so the ENUM is Zod's (`schema`); the three context rules need the document, so they
  // are the plugin's (`handler`). Offline both look identical — only the transport can
  // tell them apart.

  // 5a. An in-flow auto-layout child. Built for real, not simulated.
  const autoFrameId = await callNodeId("create_frame", {
    x: 700,
    y: 0,
    width: 400,
    height: 600,
    name: "gate-autolayout-parent",
    parentId: scratchPageId,
  });
  await call("set_layout_mode", { nodeId: autoFrameId, layoutMode: "VERTICAL" });
  const flowChildId = await callNodeId("create_rectangle", {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    name: "gate-flow-child",
    parentId: autoFrameId,
  });
  const flowRefusal = await callExpectingRefusal("set_constraints", {
    nodeId: flowChildId,
    horizontal: "MAX",
  });
  record.checks.inFlowRefused = {
    layer: flowRefusal.layer,
    namesAbsolute: /ABSOLUTE/.test(flowRefusal.message),
    message: flowRefusal.message.slice(0, 300),
  };
  assert.equal(
    flowRefusal.layer,
    "handler",
    "the auto-layout refusal must be answered by the PLUGIN — it is a judgement about the document, not the argument",
  );
  assert.ok(
    record.checks.inFlowRefused.namesAbsolute,
    "the refusal must name the way IN (layoutPositioning: ABSOLUTE), not only the way out",
  );

  // 5b. A top-level node on the PAGE. Real Figma's PageNode is the point.
  const looseId = await callNodeId("create_rectangle", {
    x: 0,
    y: 800,
    width: 80,
    height: 40,
    name: "gate-loose-child",
    parentId: scratchPageId,
  });
  const pageParentRefusal = await callExpectingRefusal("set_constraints", {
    nodeId: looseId,
    horizontal: "MAX",
  });
  record.checks.pageParentRefused = {
    layer: pageParentRefusal.layer,
    message: pageParentRefusal.message.slice(0, 300),
  };
  assert.equal(pageParentRefusal.layer, "handler");
  assert.match(pageParentRefusal.message, /PAGE/);

  // 5c. ⭐ A node that genuinely has NO `constraints` property. The offline harness models
  // this by node type instead of handing every node a default — the fix for the blanket
  // `layoutMode: "NONE"` that item 2.1 had to reach with a `delete` inside a test. This is
  // still the first thing to put that model against real Figma.
  const noPropertyRefusal = await callExpectingRefusal("set_constraints", {
    nodeId: scratchPageId,
    horizontal: "MIN",
  });
  record.checks.noConstraintsPropertyRefused = {
    layer: noPropertyRefusal.layer,
    saysPage: /PAGE/.test(noPropertyRefusal.message),
    saysNoProperty: /no constraints property/.test(noPropertyRefusal.message),
    message: noPropertyRefusal.message.slice(0, 300),
  };
  assert.equal(noPropertyRefusal.layer, "handler");
  assert.ok(
    record.checks.noConstraintsPropertyRefused.saysNoProperty,
    "a PAGE must be refused for HAVING NO constraints property — if this reports the parent rule instead, real PageNodes carry a constraints value and the offline model is wrong",
  );

  // 5d. A zero-field call — refused, never answered "done".
  const emptyRefusal = await callExpectingRefusal("set_constraints", {
    nodeId: minChildId,
  });
  record.checks.zeroFieldRefused = {
    layer: emptyRefusal.layer,
    message: emptyRefusal.message.slice(0, 200),
  };
  assert.equal(emptyRefusal.layer, "handler");

  // 5e. A bad enum — and this one must arrive from the SCHEMA. ⚠️ Opposite of 2.1, on
  // purpose: there is no semantic decision behind these five values, so a generic type
  // error is the honest answer and Zod is the cheapest place to give it.
  const enumRefusal = await callExpectingRefusal("set_constraints", {
    nodeId: minChildId,
    horizontal: "MIDDLE",
  });
  record.checks.badEnumRefused = {
    layer: enumRefusal.layer,
    message: enumRefusal.message.slice(0, 200),
  };
  assert.equal(
    enumRefusal.layer,
    "schema",
    "the enum is published closed, so Zod must answer it before dispatch — a handler answer means the schema quietly widened",
  );

  // 5f. ⛔ And no refusal moved the document. Measured in the same currency as §3: the
  // MIN child was seeded MIN, so it still holds its left offset across a resize. A
  // partial write would have changed which offset it holds.
  await call("resize_node", { nodeId: frameId, width: 600, height: 600 });
  const minStillMin = await offsetsOf(minChildId, frameId);
  await call("resize_node", { nodeId: frameId, width: 400, height: 600 });
  record.checks.refusalsDidNotMutate = {
    leftAfterAllRefusals: minStillMin.left,
    stillBehavesAsMin: minStillMin.left === 20,
  };
  assert.equal(
    minStillMin.left,
    20,
    "a refusal changed the seeded child's constraint — validate-all-then-write regressed",
  );

  // ── 6. 🔴 The GROUP premise — three verdicts, and `unmeasured` is the default ────
  //
  // `set_constraints` deliberately does NOT refuse a GROUP parent. Whether Figma resolves
  // a group child's constraints against the enclosing frame is a platform claim this repo
  // has not verified, and an unverified refusal is worse than none because it reads as
  // authoritative. ⛔ The fork ships no group-creation tool, so this gate cannot author
  // the case; pass --group-child=<nodeId> pointing at a hand-made one to measure it.
  if (options["group-child"]) {
    // ⛔ The operator's node is CLONED and the clone is measured. Nothing here resizes,
    // reparents or writes to the node they supplied — a gate that mutates a real document
    // outside its own scratch page is not a gate, it is an edit. The clone is moved into
    // the scratch frame immediately so it dies with the page in the `finally`, and
    // `groupCloneId` is tracked in case the reparent is what fails.
    const supplied = options["group-child"];
    const suppliedInfo = (await callJson("get_node_info", { nodeId: supplied })).value;
    const suppliedNode = suppliedInfo?.document ?? suppliedInfo;

    // Forgiving about which end of the pair was named: a GROUP resolves to its first
    // child, anything else is used as-is. Naming the group is the likelier mistake and it
    // is not worth a failed run.
    const targetChildId =
      suppliedNode?.type === "GROUP"
        ? (suppliedNode.children ?? [])[0]?.id
        : supplied;
    const groupNodeId =
      suppliedNode?.type === "GROUP" ? supplied : null;
    assert.ok(
      targetChildId,
      `--group-child=${supplied} is a GROUP with no children — there is nothing to constrain`,
    );

    record.checks.groupPremise = {
      claim:
        "set_constraints allows a GROUP parent rather than refusing on an unverified claim; this measures whether a group child's constraint actually RESOLVES",
      suppliedNodeId: supplied,
      suppliedType: suppliedNode?.type ?? null,
      suppliedChildId: targetChildId,
      measuredOn:
        "two CLONES inside the scratch page — the supplied node is never written to, resized or reparented",
    };

    // ⛔ TWO clones, and the second is a CONTROL. §6's first run measured the child's
    // offsets WITHIN its group and read 0 → 0 — which is not a result, it is arithmetic: a
    // single-child group's bounding box IS its child's box, so those offsets are pinned at
    // zero and the check could not have come out any other way. It scored a false 🔴.
    // ⭐ The repair is the shape §3 already uses and that this file's own header preaches:
    // measure against the FRAME (the reference a constraint actually resolves against), and
    // DISCRIMINATE between two objects under one resize. Clone A's child gets MAX; clone
    // B's child is left exactly as supplied. If both land in the same place, nothing
    // resolved; if they separate, the constraint did.
    groupCloneId = await callNodeId("clone_node", { nodeId: groupNodeId ?? supplied });
    await call("set_parent", { nodeId: groupCloneId, parentId: frameId, x: 20, y: 400 });
    groupControlCloneId = await callNodeId("clone_node", { nodeId: groupNodeId ?? supplied });
    await call("set_parent", {
      nodeId: groupControlCloneId,
      parentId: frameId,
      x: 20,
      y: 480,
    });

    const cloneInfo = (await callJson("get_node_info", { nodeId: groupCloneId })).value;
    const cloneNode = cloneInfo?.document ?? cloneInfo;
    const cloneChildId = (cloneNode?.children ?? [])[0]?.id ?? null;
    const controlInfo = (await callJson("get_node_info", { nodeId: groupControlCloneId })).value;
    const controlNode = controlInfo?.document ?? controlInfo;
    const controlChildId = (controlNode?.children ?? [])[0]?.id ?? null;

    record.checks.groupPremise.cloneId = groupCloneId;
    record.checks.groupPremise.cloneChildId = cloneChildId;
    record.checks.groupPremise.controlCloneId = groupControlCloneId;
    record.checks.groupPremise.controlChildId = controlChildId;
    record.checks.groupPremise.cloneType = cloneNode?.type ?? null;

    if (!cloneChildId || !controlChildId || cloneNode?.type !== "GROUP") {
      record.checks.groupPremise.verdict = "unmeasured";
      record.stillOwed.push(
        `§6 could not measure: the clone of ${supplied} came back as ${cloneNode?.type ?? "null"} with ${(cloneNode?.children ?? []).length} children. ⛔ Not evidence either way.`,
      );
    } else {
      const groupReceipt = (
        await callJson("set_constraints", { nodeId: cloneChildId, horizontal: "MAX" })
      ).value;
      record.checks.groupPremise.accepted = true;
      record.checks.groupPremise.parentType = groupReceipt.parentType;
      record.checks.groupPremise.parentLayoutMode = groupReceipt.parentLayoutMode;
      // ⛔ The control is NOT written to. Whatever the supplied node's constraint was, it
      // stays — so the two differ in exactly one thing: the MAX this gate wrote.
      record.checks.groupPremise.controlWasWrittenTo = false;

      // ⭐ Everything is measured against the FRAME. A constraint resolves against the
      // enclosing frame, not against the group, and measuring against the group is what
      // produced the vacuous zeros the first time.
      const testedBefore = await offsetsOf(cloneChildId, frameId);
      const controlBefore = await offsetsOf(controlChildId, frameId);
      await call("resize_node", { nodeId: frameId, width: 600, height: 600 });
      const testedAfter = await offsetsOf(cloneChildId, frameId);
      const controlAfter = await offsetsOf(controlChildId, frameId);
      await call("resize_node", { nodeId: frameId, width: 400, height: 600 });

      const testedHeldItsRight = Math.abs(testedAfter.right - testedBefore.right) < 1;
      const testedMoved = Math.abs(testedAfter.left - testedBefore.left) > 1;
      const controlMoved = Math.abs(controlAfter.left - controlBefore.left) > 1;
      // 🔴 THE INSTRUMENT CHECK, rebuilt. The old one asked "did the group move?" and was
      // satisfied by a move that had nothing to do with the reading underneath it. This one
      // asks the question that can actually invalidate the comparison: did the TESTED and
      // CONTROL children behave identically? If they did, either nothing resolved or the
      // control was already MAX — and those two are indistinguishable from here.
      const separated = Math.abs(testedAfter.left - controlAfter.left) > 1;

      record.checks.groupPremise.measurements = {
        referenceFrame: "the enclosing FRAME, not the group — a constraint resolves against the frame",
        parentFrameWidth: { before: 400, after: 600 },
        tested: {
          leftBefore: testedBefore.left,
          leftAfter: testedAfter.left,
          rightBefore: testedBefore.right,
          rightAfter: testedAfter.right,
          heldItsRight: testedHeldItsRight,
          moved: testedMoved,
        },
        control: {
          leftBefore: controlBefore.left,
          leftAfter: controlAfter.left,
          rightBefore: controlBefore.right,
          rightAfter: controlAfter.right,
          moved: controlMoved,
        },
        separated,
      };

      record.checks.groupPremise.verdict = !separated
        ? "unmeasured"
        : testedHeldItsRight && testedMoved
          ? "holds"
          : "inert";

      if (record.checks.groupPremise.verdict === "holds") {
        record.findings.push(
          `MEASURED: a group child's constraint DOES resolve, against the enclosing frame. Two identical cloned groups, one resize (400 → 600): the child written to MAX held its right offset (${testedAfter.right}) and moved left ${testedBefore.left} → ${testedAfter.left}, while the untouched control stayed at left ${controlAfter.left}. Allowing a GROUP parent rather than refusing on an unverified claim was the right call.`,
        );
      } else if (record.checks.groupPremise.verdict === "inert") {
        record.findings.push(
          `🔴 MEASURED: a group child's constraint resolves, but NOT as MAX. The two clones separated (tested left ${testedAfter.left} vs control ${controlAfter.left}), so something was applied, yet the tested child did not hold its right offset (${testedBefore.right} → ${testedAfter.right}). Investigate before 2.3/2.4 lean on group behaviour.`,
        );
      } else {
        record.stillOwed.push(
          `The GROUP premise is UNMEASURED: the tested and control children ended in the same place (left ${testedAfter.left} vs ${controlAfter.left}), so either the constraint did not resolve or the supplied node was already MAX — and this run cannot tell those apart. ⛔ Not evidence that constraints are inert inside a group.`,
        );
      }
    }
  } else {
    record.checks.groupPremise = { verdict: "unmeasured", suppliedNodeId: null };
    record.stillOwed.push(
      "The GROUP premise is UNMEASURED, not confirmed. set_constraints allows a GROUP parent rather than refusing on an unverified claim, and this gate could not author the case: the fork ships no group-creation tool. ⛔ Do not read this run as evidence either way — re-run with --group-child=<a rectangle inside a hand-made group> to measure it.",
    );
  }

  // ── 7. 🔴 THE AUTO-LAYOUT PREMISE — the claim the whole refusal rests on ─────────
  //
  // `set_constraints` refuses an in-flow auto-layout child because Figma is said to store
  // the constraint there and never apply it. Measure it: the SAME stored constraint is
  // observed twice — once while the child is ABSOLUTE (it must be honoured) and once back
  // in the flow (it must not be). Two readings that must differ.
  //
  // ⚠️ Reaching the write at all needs the ABSOLUTE escape hatch, which is also the proof
  // that the refusal is not a blanket ban hiding its own way through.
  await call("set_layout_child", { nodeId: flowChildId, layoutPositioning: "ABSOLUTE" });
  await call("set_constraints", { nodeId: flowChildId, horizontal: "MAX" });

  const absBefore = await offsetsOf(flowChildId, autoFrameId);
  await call("resize_node", { nodeId: autoFrameId, width: 600, height: 600 });
  const absAfter = await offsetsOf(flowChildId, autoFrameId);
  await call("resize_node", { nodeId: autoFrameId, width: 400, height: 600 });

  const honouredWhileAbsolute = Math.abs(absAfter.right - absBefore.right) < 1;
  const movedWhileAbsolute = Math.abs(absAfter.left - absBefore.left) > 100;

  await call("set_layout_child", { nodeId: flowChildId, layoutPositioning: "AUTO" });
  const flowBefore = await offsetsOf(flowChildId, autoFrameId);
  await call("resize_node", { nodeId: autoFrameId, width: 600, height: 600 });
  const flowAfter = await offsetsOf(flowChildId, autoFrameId);
  await call("resize_node", { nodeId: autoFrameId, width: 400, height: 600 });

  const honouredInFlow = Math.abs(flowAfter.right - flowBefore.right) < 1 &&
    Math.abs(flowAfter.left - flowBefore.left) > 100;

  record.checks.autoLayoutIgnoresConstraintsPremise = {
    claim:
      "set_constraints refuses an in-flow auto-layout child on the claim that Figma stores the constraint there and never applies it",
    absolute: {
      leftBefore: absBefore.left,
      leftAfter: absAfter.left,
      rightBefore: absBefore.right,
      rightAfter: absAfter.right,
      honoured: honouredWhileAbsolute && movedWhileAbsolute,
    },
    inFlow: {
      leftBefore: flowBefore.left,
      leftAfter: flowAfter.left,
      rightBefore: flowBefore.right,
      rightAfter: flowAfter.right,
      honoured: honouredInFlow,
    },
    // ⛔ THREE outcomes. If the ABSOLUTE leg did not honour the constraint either, the
    // instrument itself failed and NOTHING can be concluded about the in-flow leg — that
    // is `unmeasured`, and it must never be scored as support for the refusal.
    verdict: !(honouredWhileAbsolute && movedWhileAbsolute)
      ? "unmeasured"
      : honouredInFlow
        ? "contradicted"
        : "holds",
  };

  const premise = record.checks.autoLayoutIgnoresConstraintsPremise.verdict;
  if (premise === "holds") {
    record.findings.push(
      `MEASURED, not assumed: the SAME stored MAX constraint was honoured while the child was ABSOLUTE (left ${absBefore.left} → ${absAfter.left}, right held at ${absAfter.right}) and ignored once it returned to the flow (left ${flowBefore.left} → ${flowAfter.left}). Refusing the in-flow case removes a write Figma genuinely discards.`,
    );
  } else if (premise === "contradicted") {
    record.findings.push(
      `🔴 THE PREMISE DOES NOT HOLD. An in-flow auto-layout child honoured its constraint (left ${flowBefore.left} → ${flowAfter.left}, right held at ${flowAfter.right}). set_constraints is refusing a call Figma would have applied — revisit the rule before 2.3 and 2.4 land.`,
    );
  } else {
    record.stillOwed.push(
      `The auto-layout premise is UNMEASURED, not confirmed: the ABSOLUTE leg did not honour the constraint either (left ${absBefore.left} → ${absAfter.left}), so the instrument failed and the in-flow reading proves nothing. ⛔ Do not read this run as evidence for the refusal.`,
    );
  }

  // ── 8. The batch surface still excludes it, live ────────────────────────────────
  const batchRefusal = await callExpectingRefusal("apply_batch", {
    operations: [
      { id: "a", op: "set_constraints", nodeId: minChildId, params: { horizontal: "MAX" } },
    ],
  });
  record.checks.batchExcluded = {
    layer: batchRefusal.layer,
    message: batchRefusal.message.slice(0, 200),
  };

  record.stillOwed.push(
    "2.3 and 2.4 (set_size_limits, set_clips_content) are not built and not covered here. This gate is item 2.2 alone, per the owner's one-tool-at-a-time decision.",
  );
  record.stillOwed.push(
    "THREE gates now pin builds this tree no longer produces — live-batch-gate.mjs, live-text-style-gate.mjs and live-layout-gate.mjs. All three are declared stale by name in tests/live-gate-pins.test.mjs and are owed a re-pin AND a re-run together, because re-pinning without re-running is the e02d1b2 defect. Owner's standing call of 2026-08-22: do it once, after the layout tools land.",
  );
  record.stillOwed.push(
    "set_constraints ships at resultStability `stable` from birth, following item 2.1 rather than R2.5's hold-at-additive-preview. If this gate had found a reply-shape defect, fixing it would need a publicContractVersion bump — and 1.9.0 is reserved for R2.7. The exposure window is this session; it is named here so the choice is on the record.",
  );
  record.stillOwed.push(
    "SCALE is published and round-trips offline, but no geometry check here distinguishes SCALE from STRETCH on a single-axis resize. It is the one of the five values whose live behaviour this gate does not measure.",
  );

  record.success = true;
} catch (error) {
  failure = error;
  record.success = false;
  record.error = { message: error?.message ?? String(error), stack: error?.stack };
} finally {
  // ⛔ Cleanup lives here, not on the success path. An aborted gate that leaves a page
  // behind has happened once already.
  // ⛔ The operator's clone first, and independently of the page delete: if the reparent
  // failed, this orphan is the only thing this gate left on a document it does not own.
  // Deleting an id already removed with the scratch page is a harmless no-op; leaving one
  // behind on someone's real page is not.
  record.cloneCleanup = [];
  for (const cloneId of [groupCloneId, groupControlCloneId].filter(Boolean)) {
    try {
      await call("delete_node", { nodeId: cloneId });
      record.cloneCleanup.push({ cloneId, deleted: true });
    } catch (cloneError) {
      // A clone already gone with the scratch page raises here, and that is the expected
      // path — recorded as `alreadyGone` rather than as a failure.
      record.cloneCleanup.push({
        cloneId,
        deleted: false,
        alreadyGone: /not found|Node with ID/i.test(String(cloneError.message ?? cloneError)),
        error: String(cloneError.message ?? cloneError).slice(0, 200),
      });
    }
  }

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
  process.stderr.write(`R2.6 2.2 constraints live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.6 2.2 constraints live gate PASSED\n");
