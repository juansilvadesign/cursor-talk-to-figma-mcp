#!/usr/bin/env node

/**
 * R2.6 item 2.1 — the layout live gate.
 *
 * What this proves that the 221 offline tests cannot:
 *
 *  ⭐ **That the write DOES something.** Offline, `node.layoutGrow = 1` stores a number in
 *     a fixture object and every assertion reads that same number back. Nothing runs a
 *     layout engine. Here Figma does, so `layoutGrow: 1` inside a fixed-height VERTICAL
 *     frame must make the child GROW — measured as geometry through `get_node_info`, a
 *     different channel from the one that wrote. A property-only gate would pass happily
 *     over a tool that stored three values and moved nothing.
 *
 *  ⭐ **That the `layoutMode unset` refusal is reachable at all.** The offline fixture
 *     gives every node a `layoutMode: "NONE"` default — pages included — so the branch
 *     for a parent with NO such property had to be reached by `delete`ing it in the test.
 *     Real Figma's PageNode genuinely has no `layoutMode`, so a page-level node hits that
 *     arm naturally, and this is the first thing to execute it for real.
 *
 *  ⭐ **That the premise behind refusing STRETCH is true.** `set_layout_child` refuses
 *     `layoutAlign: "STRETCH"` on the claim that it is the legacy spelling of what
 *     `set_layout_sizing` writes as counter-axis FILL. That claim is the whole
 *     justification for narrowing the enum — so §7 MEASURES it rather than asserting it,
 *     and records the answer either way. ⛔ A design decision resting on an untested
 *     platform claim is what "test a stated constraint, don't build on it" is about.
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
 * 🔴 And one trap this gate is shaped by: **a before/after comparison over fields that are
 * absent reads exactly like agreement.** All three properties are unset on a fresh node,
 * so every refusal case below writes a KNOWN state first and asserts THAT survived — never
 * `undefined` before against `undefined` after.
 *
 * Every write lands on a scratch page this gate creates and deletes.
 *
 * Usage:
 *   node scripts/live-layout-gate.mjs --channel=<DEV-plugin-channel> \
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

if (!options.channel) {
  process.stderr.write(
    "Usage: node scripts/live-layout-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// ⛔ PINNED to R2.6 item 2.1. Which halves moved is DIFFERENT from the step before it:
// both build IDs moved, the fingerprint moved and the tool count moved 56 → 57, but the
// schema HELD at 1.8.0 — a new tool is additive, so 2.0's bump still covers this tree.
//
// ⭐ Read that as an operator instruction: the DEV plugin **must** be re-run before this
// gate, because `code.js` changed. The gate spawns its own server from `dist/server.js`,
// so the server half needs no respawn *here* — an interactive MCP session does.
//
// ⚠️ Six releases running, this answer has changed shape every time. ⛔ Do not carry it
// forward — re-derive which halves moved from `runtime-metadata.ts` on every release.
const expectedRuntime = {
  serverBuildId: "r2-server-92dc135f665b",
  pluginBuildId: "r2-plugin-3f7c7cd69133",
  schemaVersion: "1.8.0",
  fingerprint:
    "sha256:1865d8179b594d68a7a394c3d8e0c7982800671a0e05b3ed99d344056b7ebb09",
  toolCount: 57,
};

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const scratchPageName = `R2.6 2.1 layout gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.6-layout-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r2.6-layout-gate",
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
    runtime.plugin?.supportedCommands.includes("set_layout_child"),
    "plugin lacks set_layout_child — re-run the DEV plugin",
  );
}

/**
 * ⛔ The INDEPENDENT channel, and the trap it is shaped by.
 *
 * `get_node_info` exports `JSON_REST_V1`. The typography gate learned the hard way that
 * reaching for plugin-API property names against that shape returns all-null, and that
 * null-before compared with null-after **passes vacuously**. So the load-bearing read
 * here is GEOMETRY — `absoluteBoundingBox`, which REST certainly carries — and the layout
 * properties are recorded as whatever the channel happens to report rather than asserted
 * blind. `assertGeometryChannelWorks` proves the numbers are real before any comparison.
 */
async function geometryOf(nodeId) {
  const info = await callJson("get_node_info", { nodeId });
  const node = info.value?.document ?? info.value;
  const box = node?.absoluteBoundingBox ?? node?.absoluteRenderBounds ?? {};
  return {
    x: typeof box.x === "number" ? box.x : null,
    y: typeof box.y === "number" ? box.y : null,
    width: typeof box.width === "number" ? box.width : node?.size?.x ?? null,
    height: typeof box.height === "number" ? box.height : node?.size?.y ?? null,
    // Recorded, never asserted blind — REST's coverage of these is what §3 measures.
    restLayoutGrow: node?.layoutGrow ?? null,
    restLayoutAlign: node?.layoutAlign ?? null,
    restLayoutPositioning: node?.layoutPositioning ?? null,
  };
}

function assertGeometryChannelWorks(snapshot, context) {
  assert.equal(
    typeof snapshot.height,
    "number",
    `${context}: the geometry channel returned no numeric height — every comparison below would be vacuous`,
  );
  assert.ok(
    snapshot.height > 0,
    `${context}: height read back as ${snapshot.height}; a zero would make a growth assertion meaningless`,
  );
}

/**
 * ⛔ There is deliberately NO "read the three properties" helper here.
 *
 * The obvious one — call `set_layout_child` with a no-op `layoutPositioning: "AUTO"` and
 * read its receipt — is a WRITE. Using it to check "the refusal did not mutate" would
 * measure the claim with an instrument that mutates, and using it to observe ABSOLUTE
 * would revert the very state it asserts. Both were written and removed here rather than
 * shipped.
 *
 * So every did-it-mutate question below is answered through GEOMETRY instead, which is
 * both independent of the write channel and a strictly stronger claim: a seeded
 * `layoutGrow: 1` makes the child fill its parent, so a refusal that partially wrote
 * `layoutGrow: 0` would COLLAPSE it. `restLayoutGrow`/`Align`/`Positioning` are recorded
 * from `get_node_info` for information — whether REST carries them at all is something
 * §3 measures rather than assumes.
 */

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
  const layoutTool = inventory.tools.find((tool) => tool.name === "set_layout_child");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(layoutTool, "set_layout_child is not in the published tool surface");

  const publishedSchema = JSON.stringify(layoutTool.inputSchema);
  const description = String(layoutTool.description ?? "");
  record.checks.publishedSchema = {
    // ⭐ STRETCH must be PUBLISHED, because the refusal is a handler decision with a
    // message that names its replacement. A schema that omitted it would answer a
    // semantic decision with a generic enum error and make the handler rule unreachable.
    publishesStretch: /"STRETCH"/.test(publishedSchema),
    // layoutGrow stays a bare number for the same reason: the 0|1 pin is the plugin's.
    growIsPlainNumber: /"layoutGrow":\{"type":"number"\}/.test(publishedSchema),
    // No x/y — placement stays move_node's job (one stage, one job).
    declaresNoPlacement: !/"x"|"y"/.test(publishedSchema),
    describesRefusalNotSilentDiscard:
      /REFUSED rather than silently discarded/i.test(description),
    namesTheStretchReplacement: /set_layout_sizing/.test(description),
  };
  assert.ok(record.checks.publishedSchema.publishesStretch, "STRETCH must be published, then refused");
  assert.ok(record.checks.publishedSchema.growIsPlainNumber, "layoutGrow must publish as a bare number");
  assert.ok(record.checks.publishedSchema.declaresNoPlacement, "the surface must not carry x/y");
  assert.ok(
    record.checks.publishedSchema.describesRefusalNotSilentDiscard,
    "the published description must state the refuse-not-discard policy",
  );
  assert.ok(
    record.checks.publishedSchema.namesTheStretchReplacement,
    "the published description must name set_layout_sizing as STRETCH's replacement",
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

  // ── 2. Scratch page and a REAL auto-layout frame with real children ─────────────
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    currentPageId: originalPageId,
    pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
  };

  scratchPageId = await callNodeId("create_page", { name: scratchPageName });
  await call("set_current_page", { pageId: scratchPageId });

  const frameId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 400,
    height: 600,
    name: "gate-autolayout-parent",
    parentId: scratchPageId,
  });
  await call("set_layout_mode", { nodeId: frameId, layoutMode: "VERTICAL" });
  // ⛔ Load-bearing: a HUGging parent has no free space, so layoutGrow would have nothing
  // to grow into and §3's measurement would read "no change" for the wrong reason.
  await call("set_layout_sizing", {
    nodeId: frameId,
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "FIXED",
  });
  await call("resize_node", { nodeId: frameId, width: 400, height: 600 });

  const childId = await callNodeId("create_rectangle", {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    name: "gate-child-a",
    parentId: frameId,
  });
  const siblingId = await callNodeId("create_rectangle", {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    name: "gate-child-b",
    parentId: frameId,
  });

  // ── 3. ⭐ THE WRITE DOES SOMETHING — geometry, on an independent channel ─────────
  const before = await geometryOf(childId);
  assertGeometryChannelWorks(before, "before layoutGrow");

  const growReceipt = (
    await callJson("set_layout_child", { nodeId: childId, layoutGrow: 1 })
  ).value;
  const after = await geometryOf(childId);
  assertGeometryChannelWorks(after, "after layoutGrow");

  record.checks.growActuallyGrows = {
    heightBefore: before.height,
    heightAfter: after.height,
    grew: after.height > before.height,
    appliedFields: growReceipt.appliedFields,
    parentLayoutMode: growReceipt.parentLayoutMode,
    // What REST turned out to carry for the three properties. Recorded, not assumed.
    restReportsGrow: after.restLayoutGrow,
    restReportsAlign: after.restLayoutAlign,
    restReportsPositioning: after.restLayoutPositioning,
  };
  assert.deepEqual(growReceipt.appliedFields, ["layoutGrow"]);
  assert.equal(growReceipt.parentLayoutMode, "VERTICAL");
  // ⛔ THE assertion this gate exists for. Offline this number cannot move.
  assert.ok(
    after.height > before.height + 100,
    `layoutGrow: 1 did not grow the child — height went ${before.height} → ${after.height}. Offline this is unobservable: the fixture stores the number and no layout engine runs.`,
  );

  // And 0 puts it back, which is the falsy-guard bug measured rather than argued.
  await call("set_layout_child", { nodeId: childId, layoutGrow: 0 });
  const afterZero = await geometryOf(childId);
  record.checks.growZeroReverts = {
    heightAfterZero: afterZero.height,
    reverted: afterZero.height < after.height,
  };
  assert.ok(
    afterZero.height < after.height,
    `layoutGrow: 0 did not shrink the child back — an \`if (layoutGrow)\` guard would skip this write entirely and report success`,
  );

  // ── 4. Refusals, measured through GEOMETRY against a KNOWN seeded state ─────────
  // ⭐ Seed layoutGrow: 1 so the child FILLS its parent. Every refusal below is then
  // scored by re-measuring height: a partial write of `layoutGrow: 0` would collapse it
  // from ~550 back to 50, which no property read could hide. ⛔ This is the non-vacuous
  // shape — an unset-before/unset-after comparison would pass over a tool that never
  // wrote anything at all.
  await call("set_layout_child", { nodeId: childId, layoutGrow: 1, layoutAlign: "MIN" });
  const seeded = await geometryOf(childId);
  assertGeometryChannelWorks(seeded, "seeded state");
  assert.ok(
    seeded.height > before.height + 100,
    `the seed did not take — the child is ${seeded.height} tall, so every refusal check below would be vacuous`,
  );

  const stretch = await callExpectingRefusal("set_layout_child", {
    nodeId: childId,
    layoutAlign: "STRETCH",
  });
  const afterStretch = await geometryOf(childId);
  record.checks.stretchRefused = {
    layer: stretch.layer,
    namesReplacement: /set_layout_sizing/.test(stretch.message),
    message: stretch.message.slice(0, 240),
    heightHeld: afterStretch.height === seeded.height,
    heightAfter: afterStretch.height,
  };
  assert.equal(stretch.layer, "handler", "the STRETCH rule must live in the plugin, not the schema");
  assert.ok(record.checks.stretchRefused.namesReplacement);
  assert.equal(
    afterStretch.height,
    seeded.height,
    "the STRETCH refusal changed the child's size — it mutated on the way to refusing",
  );

  // ⛔ The valid field arrives FIRST and the refused one LAST, so a validate-as-you-go
  // implementation would have written layoutGrow: 0 before reaching STRETCH — and the
  // height would collapse. This is F4, measured by a layout engine rather than a fixture.
  const growThenStretch = await callExpectingRefusal("set_layout_child", {
    nodeId: childId,
    layoutGrow: 0,
    layoutAlign: "STRETCH",
  });
  const afterGrowThenStretch = await geometryOf(childId);
  record.checks.validateAllThenWrite = {
    layer: growThenStretch.layer,
    heightBefore: seeded.height,
    heightAfter: afterGrowThenStretch.height,
    heightHeld: afterGrowThenStretch.height === seeded.height,
  };
  assert.equal(
    afterGrowThenStretch.height,
    seeded.height,
    "layoutGrow: 0 was written before the STRETCH refusal — the child collapsed, which is F4 live",
  );

  const outOfRange = await callExpectingRefusal("set_layout_child", {
    nodeId: childId,
    layoutGrow: 0.5,
  });
  const collision = await callExpectingRefusal("set_layout_child", {
    nodeId: childId,
    layoutPositioning: "ABSOLUTE",
    layoutGrow: 1,
  });
  const empty = await callExpectingRefusal("set_layout_child", { nodeId: childId });
  const afterAll = await geometryOf(childId);
  record.checks.handlerRefusals = {
    outOfRangeLayer: outOfRange.layer,
    collisionLayer: collision.layer,
    collisionNamesTheField: /cannot be combined with layoutGrow/.test(collision.message),
    emptyLayer: empty.layer,
    heightStillSeeded: afterAll.height === seeded.height,
  };
  assert.equal(outOfRange.layer, "handler", "the 0|1 pin must live in the plugin, not the schema");
  assert.equal(collision.layer, "handler");
  assert.equal(empty.layer, "handler", "the zero-property refusal must come from the plugin");
  assert.ok(record.checks.handlerRefusals.collisionNamesTheField);
  assert.equal(
    afterAll.height,
    seeded.height,
    "three more refusals left the child a different size — validate-all-then-write does not hold live",
  );

  // ⭐ The schema layer, and what it does NOT prove. Recorded in the gate's own words so
  // a reader cannot bank a handler guarantee this leg never tested.
  const schemaRefusal = await callExpectingRefusal("set_layout_child", {
    nodeId: childId,
    layoutAlign: "SIDEWAYS",
  });
  record.checks.schemaRefusal = {
    layer: schemaRefusal.layer,
    provesAboutHandler: "nothing — the call never reached the plugin",
  };
  assert.equal(schemaRefusal.layer, "schema");

  // ── 5. ⭐ THE LIVE-ONLY BRANCH: a parent with no layoutMode property at all ──────
  const looseId = await callNodeId("create_rectangle", {
    x: 500,
    y: 0,
    width: 100,
    height: 50,
    name: "gate-page-level",
    parentId: scratchPageId,
  });
  const noLayoutMode = await callExpectingRefusal("set_layout_child", {
    nodeId: looseId,
    layoutGrow: 1,
  });
  record.checks.pageParentRefused = {
    layer: noLayoutMode.layer,
    // ⭐ Real Figma's PageNode has NO layoutMode. Offline the fixture defaults every node
    // to "NONE", so this arm had to be reached by deleting the property in a test.
    reportsUnsetNotNone: /layoutMode unset/.test(noLayoutMode.message),
    message: noLayoutMode.message.slice(0, 240),
  };
  assert.equal(noLayoutMode.layer, "handler");
  assert.ok(
    record.checks.pageParentRefused.reportsUnsetNotNone,
    `a page-level node must report "layoutMode unset", not "NONE" — got: ${noLayoutMode.message}`,
  );

  // And the NONE arm, told apart from the one above by the message rather than assumed
  // equivalent to it.
  const plainFrameId = await callNodeId("create_frame", {
    x: 500,
    y: 200,
    width: 200,
    height: 200,
    name: "gate-plain-frame",
    parentId: scratchPageId,
  });
  await call("set_parent", { nodeId: looseId, parentId: plainFrameId });
  const noneParent = await callExpectingRefusal("set_layout_child", {
    nodeId: looseId,
    layoutGrow: 1,
  });
  record.checks.noneParentRefused = {
    layer: noneParent.layer,
    reportsNone: /layoutMode NONE/.test(noneParent.message),
  };
  assert.ok(
    record.checks.noneParentRefused.reportsNone,
    `a plain-frame child must report "layoutMode NONE", not "unset" — got: ${noneParent.message}`,
  );

  // ── 6. ⭐ ABSOLUTE really leaves the flow — proven by POSITION, not by a receipt ──
  // An AUTO child's x is owned by the parent's layout; an ABSOLUTE one honours its own.
  // ⛔ move_node is only called AFTER the switch, so this never depends on how Figma
  // treats a positional write to a node the layout engine still controls.
  const frameBox = await geometryOf(frameId);
  const siblingAuto = await geometryOf(siblingId);
  assertGeometryChannelWorks(siblingAuto, "sibling while AUTO");
  // ⛔ Vacuity guard for the X axis specifically: a null x would make the arithmetic
  // below NaN, and `Math.abs(NaN) < 1` is false — so this would fail for the RIGHT
  // reason but report the WRONG one. Fail on the missing channel instead.
  for (const [label, value] of [["frame", frameBox.x], ["sibling", siblingAuto.x]]) {
    assert.equal(
      typeof value,
      "number",
      `${label} reported no numeric x — the geometry channel cannot answer the ABSOLUTE question on this build`,
    );
  }

  await call("set_layout_child", { nodeId: siblingId, layoutPositioning: "ABSOLUTE" });
  await call("move_node", { nodeId: siblingId, x: frameBox.x + 250, y: frameBox.y + 40 });
  const siblingAbsolute = await geometryOf(siblingId);

  record.checks.absoluteLeavesTheFlow = {
    xWhileAuto: siblingAuto.x,
    xWhileAbsolute: siblingAbsolute.x,
    movedBy: siblingAbsolute.x - siblingAuto.x,
    honouredTheMove: Math.abs(siblingAbsolute.x - (frameBox.x + 250)) < 1,
  };
  assert.ok(
    record.checks.absoluteLeavesTheFlow.honouredTheMove,
    `an ABSOLUTE child did not honour its own x — expected ~${frameBox.x + 250}, read ${siblingAbsolute.x}. While AUTO the parent owns this coordinate, so this is what proves the switch took effect at all.`,
  );

  // ── 7. ⭐ THE PREMISE: is STRETCH really set_layout_sizing's counter-axis FILL? ──
  // §4's refusal is justified ONLY if the two spellings are the same write. This MEASURES
  // that instead of asserting it, and records the answer either way — including "could
  // not be measured", which is a third outcome and not a pass.
  await call("set_layout_child", { nodeId: siblingId, layoutPositioning: "AUTO" });
  await call("set_layout_sizing", {
    nodeId: siblingId,
    layoutSizingHorizontal: "FILL",
  });
  const afterFill = await geometryOf(siblingId);
  const reportedAlign = afterFill.restLayoutAlign;
  record.checks.stretchPremise = {
    claim:
      'set_layout_child refuses layoutAlign: "STRETCH" on the claim that it is the legacy spelling of set_layout_sizing counter-axis FILL',
    channel: "get_node_info (JSON_REST_V1)",
    counterAxisFillReportsAlignAs: reportedAlign,
    // ⛔ Three outcomes, not two. `null` means REST does not carry the field on this
    // build — which is NOT evidence for the claim, and must never be scored as such.
    verdict:
      reportedAlign === null
        ? "unmeasured"
        : reportedAlign === "STRETCH"
          ? "holds"
          : "contradicted",
  };
  if (record.checks.stretchPremise.verdict === "holds") {
    record.findings.push(
      'MEASURED, not assumed: after set_layout_sizing({ layoutSizingHorizontal: "FILL" }), Figma reports layoutAlign as "STRETCH". The two spellings are one document write, so refusing STRETCH removes a genuine duplicate rather than a convenience.',
    );
  } else if (record.checks.stretchPremise.verdict === "contradicted") {
    record.findings.push(
      `🔴 THE PREMISE DOES NOT HOLD. After set_layout_sizing counter-axis FILL, layoutAlign reads ${JSON.stringify(reportedAlign)} rather than "STRETCH". set_layout_child's STRETCH refusal is therefore removing a value that may not be reachable any other way — revisit it before 2.2–2.4 land.`,
    );
  } else {
    record.stillOwed.push(
      'The STRETCH premise is UNMEASURED, not confirmed: get_node_info (JSON_REST_V1) does not report layoutAlign on this build, so the gate could not observe what counter-axis FILL writes. ⛔ Do not read this run as evidence for the refusal — the tool ships a narrowed enum on an untested platform claim until a channel that carries layoutAlign exists.',
    );
  }

  // ── 8. The batch surface still excludes it, live ────────────────────────────────
  const batchRefusal = await callExpectingRefusal("apply_batch", {
    operations: [{ id: "a", op: "set_layout_child", nodeId: childId, layoutGrow: 1 }],
  });
  record.checks.batchExcluded = {
    layer: batchRefusal.layer,
    message: batchRefusal.message.slice(0, 200),
  };

  record.stillOwed.push(
    "2.2–2.4 (set_constraints, set_size_limits, set_clips_content) are not built and not covered here. This gate is item 2.1 alone, per the owner's split-scope decision.",
  );
  record.stillOwed.push(
    "live-batch-gate.mjs and live-text-style-gate.mjs both pin builds this tree no longer produces. They are declared stale by name in tests/live-gate-pins.test.mjs and are owed a re-pin AND a re-run — together, in one change, because re-pinning without re-running is the e02d1b2 defect.",
  );
  record.stillOwed.push(
    "Whether layoutGrow interacts with textAutoResize on a TEXT child is untested. The plan flags textAutoResize x layoutSizing as a cross-release interaction and says to land the child-layout tools before asserting combined behaviour — so it is deliberately NOT asserted here.",
  );

  record.success = true;
} catch (error) {
  failure = error;
  record.success = false;
  record.error = { message: error?.message ?? String(error), stack: error?.stack };
} finally {
  // ⛔ Cleanup lives here, not on the success path. An aborted gate that leaves a page
  // behind has happened once already.
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
      record.cleanup = { pageId: scratchPageId, error: String(cleanupError.message ?? cleanupError) };
    }
  }
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  await client.close().catch(() => {});
  process.stderr.write(`report: ${reportPath}\n`);
}

if (failure) {
  process.stderr.write(`R2.6 2.1 layout live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.6 2.1 layout live gate PASSED\n");
