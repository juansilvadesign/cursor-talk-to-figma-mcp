#!/usr/bin/env node

/**
 * R2.6 item 2.4 — the clips-content live gate. The LAST of the four layout gates.
 *
 * ⛔ **THE PROBLEM THIS GATE IS SHAPED BY: A BOOLEAN CANNOT FALSIFY ITSELF.** Every earlier
 * layout tool had a reading that could come out wrong — 2.3's four independent fields, 2.2's
 * un-named axis surviving a merge, 2.1's grow tracking a parent resize. This one writes one
 * field with two values. Write `false`, read back `false`: a tool that applied the change and
 * a tool that echoed its own argument print the same receipt, and so does a tool that wrote
 * nothing at all if the node already held `false`. That is item 2.1's false green in its
 * purest form — see [[feedback_a_zero_valued_write_reads_as_no_write]] — and the fix is the
 * one that lesson names: **measure in a different currency.**
 *
 * ⭐ **THE CURRENCY, AND IT IS GENUINELY INDEPENDENT.** Clipping is a statement about what
 * the node PAINTS, which Figma answers separately from what it stores:
 * `absoluteRenderBounds` extends past `absoluteBoundingBox` exactly when content spills out.
 * This gate does not read that through `set_clips_content`, and it does not read it through
 * `get_node_info` either — it reads it through **`export_node_as_image`'s preflight**, which
 * reports `boundsWidth`/`boundsHeight` off `absoluteRenderBounds` and declares its
 * `boundsSource`. A different tool, a different code path, written years before this one and
 * knowing nothing about clipping. A frame that clips reports its own 200; the same frame
 * unclipped reports 250. Two different numbers from a witness with no stake in the answer.
 *
 * 🔴 **AND THE CHANNEL THAT LOOKS OBVIOUS IS A TRAP.** `get_node_info` exports
 * `JSON_REST_V1` and `filterFigmaNode` keeps a small subset — it carries
 * `absoluteBoundingBox` and carries **neither `clipsContent` nor `absoluteRenderBounds`**.
 * Both would read `undefined` before the write and `undefined` after it, and
 * undefined-before against undefined-after **passes vacuously**. That is exactly how the
 * typography gate got burned, and [[feedback_a_failed_curl_reuses_the_previous_body]] is the
 * general shape: a symmetric failure reads precisely like agreement. §3 therefore proves the
 * export channel reports real, MOVING numbers before a single equality is trusted.
 *
 * What this gate proves that the 25 offline tests cannot:
 *
 *  ⭐ **That the write RESOLVES** — §3. Offline the render geometry is computed by a harness
 *     this author wrote, opt-in, and every assertion reads back that same model. Here Figma
 *     decides, and the discrimination is between two states of one node plus an untouched
 *     CONTROL: clip → 200, unclip → 250, control → 200 throughout.
 *
 *  ⭐ **Whether the receipt's own second currency is USABLE** — §4, and this is an open
 *     question with a three-way verdict rather than an assertion. The handler reads
 *     `absoluteRenderBounds` immediately after the assignment, inside the same call. Whether
 *     Figma has recomputed it by then is unmeasured, so the gate compares the receipt against
 *     the independent export reading and records `synchronous` / `deferred` / `unmeasured`.
 *     ⛔ It does NOT fail on `deferred`. A deferred recompute would make `renderBoundsChanged`
 *     honest but useless in-call, which is a finding about the field's value, not a defect in
 *     the write.
 *
 *  🔴 **The eligibility rule, MEASURED** — §5, and this is 2.3's section repeated on purpose.
 *     There the handler's probe asked whether the node *exposes* the property, and every
 *     ineligible case turned out to be refused by Figma mid-write instead
 *     ([[feedback_a_readable_property_is_not_a_writable_one]]). Here the probe is a presence
 *     test again — defensible, because `clipsContent` is a boolean with no unset value to
 *     hide in — but "defensible" is not "measured". §5 puts ten contexts against real Figma
 *     and asserts that every refusal came from THIS HANDLER, naming its own rule, rather than
 *     from a raw platform string. ⛔ SECTION and a frame nested inside an INSTANCE are the two
 *     the offline harness deliberately does not model, because guessing would be the fiction
 *     2.3 shipped.
 *
 *  ⛔ **That a refusal leaves NOTHING behind** — §6.
 *
 *  ⭐ **That a no-op is a success and not a change** — §7, and it carries the discriminator
 *     that keeps `renderBoundsChanged: null` readable: a real measurement that found no
 *     movement must be `false`, never `null`, or the field means two different things.
 *
 * ⛔ Three traps inherited from the gates before it, each already paid for once:
 *
 *  1. A refusal is an EXPECTED outcome and arrives in two shapes — the plugin throws and the
 *     wrapper catches it into an error *result* (`layer: "handler"`), or Zod rejects the
 *     argument before dispatch and it arrives thrown (`layer: "schema"`). Scoring either as a
 *     crash has failed this project three times.
 *  2. A gate that mutates cleans up in a `finally`, not on the success path.
 *  3. A rebuild reaches neither running side. This script spawns its own server from
 *     `dist/server.js`, so the SERVER half is always fresh — but the Figma DEV plugin holds
 *     `code.js` from launch, so a stale plugin is the failure mode this pins for.
 *     ⛔ `compatibility: "compatible"` only means the two RUNNING halves match each other.
 *
 * Every write lands on a scratch page this gate creates and deletes.
 *
 * Usage:
 *   node scripts/live-clips-content-gate.mjs --channel=<DEV-plugin-channel> \
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
    "Usage: node scripts/live-clips-content-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<dir>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// ⛔ PINNED to R2.6 item 2.4. Derived from `runtime-metadata.ts` after the regeneration, not
// carried forward from 2.3 — this project's answer to "which halves moved" has changed shape
// on nearly every one of ten steps.
//
// This step's shape: **both build IDs moved, the fingerprint moved, the tool count moved
// 59 → 60, and the SCHEMA HELD at 1.8.0** — 2.1/2.2's shape, and not 2.3's second move,
// which touched only the build IDs. ⚠️ Two independent things moved `serverBuildId` here: a
// new tool, and the CC1 repair that walked `set_layout_child`, `set_constraints` and
// `set_size_limits` back to `additive-preview`. A stability change rewrites
// `contractPayload.tools`, which `serverBuildId` hashes.
//
// ⭐ Read that as an operator instruction: the DEV plugin **must** be re-run before this
// gate, because `code.js` changed. The gate spawns its own server from `dist/server.js`, so
// the server half needs no respawn *here* — an interactive MCP session does.
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
  serverBuildId: "r2-server-a0afdc880ab0",
  pluginBuildId: "r2-plugin-a34d76fc6bc6",
  schemaVersion: "1.9.0",
  fingerprint:
    "sha256:f636ecab99cc39989f6b79abaf06549a4e954f818f23d6fa2a369b08b6142fc0",
  toolCount: 65,
};

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const scratchPageName = `R2.6 2.4 clips content gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.6-clips-content-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r2.6-clips-content-gate",
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
  return { message, layer, refused };
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
    runtime.plugin?.supportedCommands.includes("set_clips_content"),
    "plugin lacks set_clips_content — re-run the DEV plugin",
  );
}

/**
 * ⛔ THE INDEPENDENT CHANNEL, and the reason this gate can conclude anything at all.
 *
 * `export_node_as_image`'s preflight reads `absoluteRenderBounds` and reports
 * `boundsWidth`/`boundsHeight` along with a `boundsSource` naming which property it used. It
 * is a different tool, on a different code path, that predates this one and knows nothing
 * about clipping — so it cannot be wrong in the same direction as `set_clips_content`.
 *
 * ⭐ `boundsSource` is the built-in instrument. If it answers `"node-width-height"`, the
 * render-bounds property did not resolve and every width comparison below would be reading
 * the node's own fixed size — identical before and after, which reads exactly like "clipping
 * has no effect". A symmetric failure that looks like agreement, again.
 *
 * ⛔ SVG, not PNG, and deliberately: the preflight's megapixel ceiling applies to raster
 * formats only (`limitApplied`), and this gate must never be the thing that trips a safety
 * refusal it is not testing. The preflight geometry is computed before the format branch.
 * ⛔ `filePath` keeps the bytes on disk and out of the transcript.
 */
let exportSequence = 0;
async function renderBoundsOf(nodeId, label) {
  exportSequence += 1;
  const filePath = path.join(
    artifactDirectory,
    `probe-${String(exportSequence).padStart(2, "0")}-${label}.svg`,
  );
  const exported = await callJson("export_node_as_image", {
    nodeId,
    format: "SVG",
    scale: 1,
    filePath,
  });
  const preflight = exported.value?.preflight ?? {};
  return {
    width: preflight.boundsWidth ?? null,
    height: preflight.boundsHeight ?? null,
    source: preflight.boundsSource ?? null,
    nodeWidth: preflight.nodeWidth ?? null,
    nodeHeight: preflight.nodeHeight ?? null,
  };
}

function assertRenderChannelWorks(reading, context) {
  assert.equal(
    reading.source,
    "absoluteRenderBounds",
    `${context}: the export preflight fell back to node width/height, so absoluteRenderBounds did not resolve and every comparison in this gate would be vacuous`,
  );
  for (const key of ["width", "height"]) {
    assert.equal(
      typeof reading[key],
      "number",
      `${context}: the render channel returned a non-numeric ${key}`,
    );
    assert.ok(
      Number.isFinite(reading[key]),
      `${context}: ${key} read back as ${reading[key]}`,
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
let failure = null;

try {
  await client.connect(transport);

  // ── 1. The published surface, read from the runtime and never from the source ────
  const inventory = await client.listTools();
  const tool = inventory.tools.find((entry) => entry.name === "set_clips_content");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(tool, "set_clips_content is not in the published tool surface");

  const schema = tool.inputSchema ?? {};
  const description = String(tool.description ?? "");
  record.checks.publishedSchema = {
    clipsContentType: schema.properties?.clipsContent?.type,
    required: schema.required ?? [],
    // ⛔ REQUIRED is the whole shape of this tool. An optional boolean would make "not
    // supplied" indistinguishable from `false` at the boundary, which is the
    // absence-reads-as-an-answer trap the receipt's `renderBoundsChanged: null` exists to
    // avoid one layer down.
    clipsContentRequired: (schema.required ?? []).includes("clipsContent"),
    namesTheCarriers: /COMPONENT_SET/.test(description) && /INSTANCE/.test(description),
    describesTheGroupRefusal: /GROUP/.test(description),
    describesTheNoop: /changed: false/.test(description),
    describesTheRenderCurrency: /absoluteRenderBounds/.test(description),
    // ⭐ The null-is-not-zero declaration, published rather than merely implemented. A
    // caller who reads `overflow: null` as "no overflow" has been misled by the contract.
    describesTheNullMeasurement: /null render measurement/i.test(description),
  };
  assert.equal(
    record.checks.publishedSchema.clipsContentType,
    "boolean",
    "clipsContent must publish as a plain boolean — Zod owns this type in full",
  );
  assert.ok(
    record.checks.publishedSchema.clipsContentRequired,
    "clipsContent must be REQUIRED; an optional boolean cannot distinguish absent from false",
  );
  assert.ok(
    record.checks.publishedSchema.namesTheCarriers,
    "the published description must name which node types carry clipsContent — it is the tool's only refusal",
  );
  assert.ok(
    record.checks.publishedSchema.describesTheGroupRefusal,
    "the published description must state that a GROUP is refused, and why",
  );
  assert.ok(
    record.checks.publishedSchema.describesTheNoop,
    "the published description must state that a no-op write succeeds with changed: false",
  );
  assert.ok(
    record.checks.publishedSchema.describesTheNullMeasurement,
    "the published description must state that a null render measurement is not zero overflow",
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

  // ── 2. Scratch page, a frame with a child that genuinely overflows, and a CONTROL ──
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    currentPageId: originalPageId,
    pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
  };

  scratchPageId = await callNodeId("create_page", { name: scratchPageName });
  await call("set_current_page", { pageId: scratchPageId });

  // The subject: 200×200, holding a 100×100 child at (150,150) so it spills 50px past the
  // right and bottom edges. ⛔ The child must be given a FILL — an invisible child has no
  // render bounds to contribute, and the whole gate would then measure nothing.
  const subjectId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    name: "gate-clip-subject",
    parentId: scratchPageId,
  });
  const overflowId = await callNodeId("create_rectangle", {
    x: 150,
    y: 150,
    width: 100,
    height: 100,
    name: "gate-overflow-child",
    parentId: subjectId,
  });
  await call("set_fill_color", { nodeId: overflowId, r: 1, g: 0, b: 0, a: 1 });

  // ⭐ The CONTROL, and it is not decoration. 2.2's gate filed a false RED because its only
  // reading was arithmetic that could not come out any other way; the repair was a control
  // clone. This frame gets the identical overflowing child and is never written to, so
  // "the numbers moved" can be separated from "something else on this page moves numbers".
  const controlId = await callNodeId("create_frame", {
    x: 400,
    y: 0,
    width: 200,
    height: 200,
    name: "gate-clip-control",
    parentId: scratchPageId,
  });
  const controlChildId = await callNodeId("create_rectangle", {
    x: 150,
    y: 150,
    width: 100,
    height: 100,
    name: "gate-control-child",
    parentId: controlId,
  });
  await call("set_fill_color", { nodeId: controlChildId, r: 0, g: 0, b: 1, a: 1 });

  // ── 3. ⭐ THE HEADLINE — clipping RESOLVES, in a currency the tool does not control ──
  //
  // Three readings of one node plus a control, all through `export_node_as_image`:
  //   clipping (Figma's default for a new frame) → 200 wide
  //   unclipped                                  → 250 wide, the child's spill included
  //   clipping again                             → 200 wide
  // A tool that stored the boolean and applied nothing leaves all three at the same number,
  // and so does a tool that echoed its argument. ⛔ The instrument check runs FIRST: if the
  // export preflight fell back to node width/height, every one of these would read 200 for
  // reasons that have nothing to do with clipping.
  const clippedBefore = await renderBoundsOf(subjectId, "subject-clipped-before");
  assertRenderChannelWorks(clippedBefore, "before any write");
  const controlBefore = await renderBoundsOf(controlId, "control-before");
  assertRenderChannelWorks(controlBefore, "control, before any write");

  const unclipReceipt = (
    await callJson("set_clips_content", { nodeId: subjectId, clipsContent: false })
  ).value;
  const unclipped = await renderBoundsOf(subjectId, "subject-unclipped");

  const reclipReceipt = (
    await callJson("set_clips_content", { nodeId: subjectId, clipsContent: true })
  ).value;
  const reclipped = await renderBoundsOf(subjectId, "subject-reclipped");
  const controlAfter = await renderBoundsOf(controlId, "control-after");

  record.checks.clippingResolves = {
    clippedBefore: { width: clippedBefore.width, height: clippedBefore.height },
    unclipped: { width: unclipped.width, height: unclipped.height },
    reclipped: { width: reclipped.width, height: reclipped.height },
    control: {
      before: { width: controlBefore.width, height: controlBefore.height },
      after: { width: controlAfter.width, height: controlAfter.height },
      held:
        controlBefore.width === controlAfter.width &&
        controlBefore.height === controlAfter.height,
    },
    separated: unclipped.width !== clippedBefore.width,
    roundTripped:
      reclipped.width === clippedBefore.width &&
      reclipped.height === clippedBefore.height,
  };

  assert.ok(
    unclipped.width > clippedBefore.width,
    `🔴 UNCLIPPING DID NOT CHANGE WHAT THE NODE RENDERS: ${clippedBefore.width} → ${unclipped.width}. Either the write did not resolve, or the receipt is reporting an argument rather than a document.`,
  );
  assert.equal(
    unclipped.width,
    clippedBefore.width + 50,
    "the unclipped render bounds must include the child's 50px spill on the right",
  );
  assert.equal(
    unclipped.height,
    clippedBefore.height + 50,
    "the unclipped render bounds must include the child's 50px spill on the bottom",
  );
  assert.ok(
    record.checks.clippingResolves.roundTripped,
    "re-clipping must return the render bounds to the node's own box — the write has to work in both directions, not just once",
  );
  assert.ok(
    record.checks.clippingResolves.control.held,
    "the untouched CONTROL moved — something other than set_clips_content is changing render bounds on this page, and §3 concludes nothing",
  );
  record.findings.push(
    `Clipping RESOLVES and round-trips: ${clippedBefore.width}×${clippedBefore.height} clipped → ${unclipped.width}×${unclipped.height} unclipped → ${reclipped.width}×${reclipped.height} re-clipped, measured through export_node_as_image's preflight (boundsSource: absoluteRenderBounds) rather than through the tool under test. The untouched control held at ${controlAfter.width}×${controlAfter.height}.`,
  );

  // ── 4. ⭐ Is the receipt's own second currency USABLE? A three-way verdict ─────────
  //
  // The handler reads `absoluteRenderBounds` immediately after the assignment, in the same
  // call. Whether Figma has recomputed it by that point is genuinely unknown, and the tool
  // never claimed it had — `renderBoundsChanged` is `null` when either reading is missing,
  // precisely so an unmeasured platform behaviour cannot be reported as "nothing happened".
  //
  // ⛔ This section does NOT fail on `deferred`. A deferred recompute makes the field honest
  // and useless in-call, which is a finding about the field's value rather than a defect in
  // the write — §3 already proved the write resolves. Failing here would be encoding a
  // guess about the platform as a requirement, which is 2.3's decision ③ mistake inverted.
  const independentUnclipped = unclipped.width;
  const receiptUnclippedWidth =
    unclipReceipt.render?.after?.renderBounds?.width ?? null;
  const receiptClippedWidth =
    unclipReceipt.render?.before?.renderBounds?.width ?? null;

  let receiptCurrency;
  if (receiptUnclippedWidth === null || receiptClippedWidth === null) {
    receiptCurrency = "unmeasured";
  } else if (receiptUnclippedWidth === independentUnclipped) {
    receiptCurrency = "synchronous";
  } else if (receiptUnclippedWidth === receiptClippedWidth) {
    receiptCurrency = "deferred";
  } else {
    receiptCurrency = "disagrees";
  }

  record.checks.receiptSecondCurrency = {
    verdict: receiptCurrency,
    receiptBeforeWidth: receiptClippedWidth,
    receiptAfterWidth: receiptUnclippedWidth,
    independentAfterWidth: independentUnclipped,
    renderBoundsChanged: unclipReceipt.renderBoundsChanged ?? null,
    overflowBefore: unclipReceipt.render?.before?.overflow ?? null,
    overflowAfter: unclipReceipt.render?.after?.overflow ?? null,
    // ⛔ The one assertion this section DOES make: null must never have become false.
    nullNeverBecameFalse:
      receiptCurrency !== "unmeasured" ||
      unclipReceipt.renderBoundsChanged === null,
  };
  assert.ok(
    record.checks.receiptSecondCurrency.nullNeverBecameFalse,
    "🔴 the receipt reported renderBoundsChanged: false while its own render readings were unavailable — an absence was published as a measurement",
  );
  assert.notEqual(
    receiptCurrency,
    "disagrees",
    `🔴 the receipt's post-write render width (${receiptUnclippedWidth}) matches neither its pre-write reading (${receiptClippedWidth}) nor the independent channel (${independentUnclipped}) — the tool is reporting a third number from somewhere`,
  );
  record.findings.push(
    `The receipt's own render currency is ${receiptCurrency.toUpperCase()}: it read ${receiptClippedWidth} before and ${receiptUnclippedWidth} after, against ${independentUnclipped} from the independent channel. ${
      receiptCurrency === "synchronous"
        ? "Figma recomputes absoluteRenderBounds within the call, so renderBoundsChanged is usable by a caller."
        : receiptCurrency === "deferred"
          ? "⚠️ Figma had NOT recomputed absoluteRenderBounds by the time the handler read it back, so renderBoundsChanged reports false on a write that did resolve. Honest, but not usable in-call — the caller must re-read."
          : "The platform did not answer, and the tool correctly propagated null rather than reporting false."
    }`,
  );
  if (receiptCurrency !== "synchronous") {
    record.stillOwed.push(
      `renderBoundsChanged is ${receiptCurrency} on this build, so a caller cannot use the receipt alone to tell whether the write changed what renders. §3's independent reading is the currency that works. Revisit the field's documentation before R2.6 acceptance.`,
    );
  }

  // ── 5. 🔴 THE ELIGIBILITY MATRIX — 2.3's section, repeated because it earned it ────
  //
  // Ten contexts. For each: does Figma carry `clipsContent`, and — the question 2.3's first
  // run answered differently from every expectation — is the refusal OURS or the platform's?
  // ⛔ The two the offline harness deliberately does not model are SECTION and a frame nested
  // inside an INSTANCE. Guessing at them offline would be the fiction 2.3 shipped; measuring
  // them here is what lets the harness be corrected from evidence.
  const sectionId = await callNodeId("create_section", {
    x: 0,
    y: 400,
    width: 300,
    height: 200,
    name: "gate-section",
  });
  const groupSourceId = await callNodeId("create_rectangle", {
    x: 700,
    y: 0,
    width: 60,
    height: 60,
    name: "gate-group-member",
    parentId: scratchPageId,
  });
  const looseRectId = await callNodeId("create_rectangle", {
    x: 700,
    y: 100,
    width: 60,
    height: 60,
    name: "gate-loose-rect",
    parentId: scratchPageId,
  });
  const looseTextId = await callNodeId("create_text", {
    x: 700,
    y: 200,
    text: "gate text",
    name: "gate-loose-text",
    parentId: scratchPageId,
  });
  const nestedFrameId = await callNodeId("create_frame", {
    x: 20,
    y: 20,
    width: 100,
    height: 100,
    name: "gate-nested-frame",
    parentId: subjectId,
  });

  const contexts = [
    { context: "FRAME on a page", nodeId: subjectId, expected: "accepted" },
    { context: "FRAME nested inside a FRAME", nodeId: nestedFrameId, expected: "accepted" },
    { context: "SECTION", nodeId: sectionId, expected: "unmeasured" },
    { context: "RECTANGLE", nodeId: looseRectId, expected: "refused" },
    { context: "TEXT", nodeId: looseTextId, expected: "refused" },
    { context: "PAGE", nodeId: scratchPageId, expected: "refused" },
    { context: "RECTANGLE that will be grouped", nodeId: groupSourceId, expected: "refused" },
  ];

  const eligibility = [];
  for (const entry of contexts) {
    const attempt = await callExpectingRefusal("set_clips_content", {
      nodeId: entry.nodeId,
      clipsContent: false,
    });
    eligibility.push({
      ...entry,
      accepted: !attempt.refused,
      layer: attempt.refused ? attempt.layer : null,
      message: attempt.refused ? attempt.message : null,
      // ⛔ THE QUESTION 2.3's FIRST RUN EXISTED TO ANSWER. A refusal carrying this handler's
      // own sentence is a validation-phase decision; a raw platform string means Figma
      // refused during the write and the handler never had a rule at all.
      refusedByHandlerRule: attempt.refused
        ? /does not carry clipsContent/.test(attempt.message)
        : null,
    });
  }

  record.checks.eligibility = eligibility;

  const accepted = eligibility.filter((row) => row.accepted);
  const refused = eligibility.filter((row) => !row.accepted);
  assert.ok(
    accepted.length >= 2,
    "no context was accepted, so the matrix is measuring a broken tool rather than an eligibility rule",
  );
  assert.ok(
    refused.length >= 3,
    "no context was refused, so the matrix cannot separate a carrier from a non-carrier",
  );

  for (const row of eligibility.filter((entry) => entry.expected === "accepted")) {
    assert.ok(
      row.accepted,
      `${row.context} was expected to carry clipsContent and was refused: ${row.message}`,
    );
  }
  for (const row of eligibility.filter((entry) => entry.expected === "refused")) {
    assert.ok(
      !row.accepted,
      `${row.context} was expected to be refused and Figma accepted the write`,
    );
    assert.ok(
      row.refusedByHandlerRule,
      `🔴 ${row.context} was refused, but NOT by this handler's rule — the message was "${row.message}". That is 2.3's defect exactly: the eligibility probe measured the wrong thing and Figma refused mid-write instead.`,
    );
    assert.equal(
      row.layer,
      "handler",
      `${row.context} must be refused at the handler layer, not the schema layer`,
    );
  }

  const sectionRow = eligibility.find((row) => row.context === "SECTION");
  record.findings.push(
    `SECTION: ${
      sectionRow.accepted
        ? "CARRIES clipsContent and the write was accepted. ⛔ The offline harness does NOT model this — CLIPS_CONTENT_CARRIERS omits SECTION deliberately, as unmeasured. It is now measured, and the harness should gain it."
        : `does NOT carry clipsContent (refused at layer ${sectionRow.layer}${sectionRow.refusedByHandlerRule ? ", by this handler's own rule" : ", by the platform"}). The offline harness's omission of SECTION was correct.`
    }`,
  );

  // ── 6. ⛔ A refusal leaves NOTHING behind ────────────────────────────────────────
  //
  // One assignment means partial application is structurally impossible, so this is cheap —
  // but cheap is not the same as unnecessary. 2.3's §6b exists because a refusal that
  // happens mid-write is invisible until someone measures the node afterwards.
  const rectBefore = (await callJson("get_node_info", { nodeId: looseRectId })).value;
  await callExpectingRefusal("set_clips_content", {
    nodeId: looseRectId,
    clipsContent: true,
  });
  const rectAfter = (await callJson("get_node_info", { nodeId: looseRectId })).value;
  record.checks.refusalIsInert = {
    byteIdentical: JSON.stringify(rectBefore) === JSON.stringify(rectAfter),
    // ⚠️ The instrument: `get_node_info` filters JSON_REST_V1 and carries neither
    // clipsContent nor absoluteRenderBounds, so this comparison can only catch a refusal
    // that moved something the filter DOES keep. Recorded so the check is not read as
    // stronger than it is.
    channelCarriesClipsContent: Object.hasOwn(
      rectBefore?.document ?? rectBefore ?? {},
      "clipsContent",
    ),
  };
  assert.ok(
    record.checks.refusalIsInert.byteIdentical,
    "a refused set_clips_content changed the node — a refusal that mutates is F4",
  );
  if (!record.checks.refusalIsInert.channelCarriesClipsContent) {
    record.stillOwed.push(
      "get_node_info cannot report clipsContent: filterFigmaNode keeps a JSON_REST_V1 subset that carries absoluteBoundingBox but neither clipsContent nor absoluteRenderBounds. So the read layer cannot witness this tool's own property, and §6's byte-comparison only covers the fields the filter keeps. ⛔ Adding them is a result-shape change to a `stable` read tool, which needs a publicContractVersion bump — R2.6 spent its 1.8.0, so this belongs to R2.7.",
    );
  }

  // ── 7. ⭐ The no-op, and the discriminator that keeps `null` readable ─────────────
  //
  // Writing the value the node already holds must SUCCEED and report `changed: false`. And
  // `renderBoundsChanged` must come back `false` rather than `null` here — the platform did
  // answer, and it answered "nothing moved". If a real measurement of no movement were
  // reported as null, the field would mean two different things at once and a caller could
  // not read either of them.
  //
  // ⛔ THIS SECTION ESTABLISHES ITS OWN PRECONDITION, and the reason is a defect this gate
  // shipped with. It used to open by asserting `previous === true` "because §3 re-clipped
  // the subject" — true when written, and falsified 110 lines later by §5's matrix, which
  // writes `clipsContent: false` to `subjectId` itself as its accepted FRAME case. The tool
  // answered `previous: false` honestly and the gate called it a failure.
  // [[feedback_a_status_marker_that_was_true_when_written]]. A no-op test must depend on the
  // value it just wrote, never on one a distant section left behind — so the SETTLING write
  // below is the precondition, and only the SECOND write is the measurement.
  const settleReceipt = (
    await callJson("set_clips_content", { nodeId: subjectId, clipsContent: true })
  ).value;
  const beforeNoop = await renderBoundsOf(subjectId, "subject-before-noop");

  const noopReceipt = (
    await callJson("set_clips_content", { nodeId: subjectId, clipsContent: true })
  ).value;
  const afterNoop = await renderBoundsOf(subjectId, "subject-after-noop");

  record.checks.noop = {
    // ⭐ Recorded, never asserted on: this is what §5 left behind. It is evidence that the
    // settling write is load-bearing, and it goes red-flag-shaped if a future edit removes
    // the matrix's write to the subject and nobody notices this section stopped being a test.
    settledFrom: settleReceipt.previous,
    settleChanged: settleReceipt.changed,
    previous: noopReceipt.previous,
    applied: noopReceipt.clipsContent,
    changed: noopReceipt.changed,
    renderBoundsChanged: noopReceipt.renderBoundsChanged,
    // ⛔ Measured against the bounds read immediately BEFORE the no-op, never against §3's
    // `reclipped`. Comparing to `reclipped` is how this guard read "held" straight through a
    // real 250 → 200 re-clip: both ends are 200, so a no-op and a re-clip are the same
    // number. [[feedback_a_zero_valued_write_reads_as_no_write]] — a check whose two
    // outcomes print identically cannot fail in either direction.
    independentWidthHeld: afterNoop.width === beforeNoop.width,
    noopWidth: beforeNoop.width,
  };
  assert.equal(
    noopReceipt.previous,
    true,
    "the settling write did not take, so the no-op measurement has no precondition",
  );
  assert.equal(noopReceipt.clipsContent, true);
  assert.equal(
    noopReceipt.changed,
    false,
    "writing the value the node already holds is not a change",
  );
  assert.ok(
    record.checks.noop.independentWidthHeld,
    "a no-op moved the render bounds, which means it was not a no-op",
  );
  if (receiptCurrency === "synchronous") {
    assert.equal(
      noopReceipt.renderBoundsChanged,
      false,
      "on a build where the receipt's render reading is synchronous, a measured no-movement must be false and never null",
    );
  }

  // ── 8. 🔴 The harness's carrier model, READ rather than asserted ─────────────────
  //
  // ⛔ This section reads the harness FILE. Its 2.3 ancestor hardcoded a belief about the
  // harness and kept emitting a red "go fix this" finding after the harness was already
  // correct — [[feedback_a_status_marker_that_was_true_when_written]]. A gate that reports an
  // already-repaired defect in alarming red costs someone an afternoon fixing correct code.
  const harnessSource = await readFile(
    path.join(root, "tests/helpers/plugin-harness.mjs"),
    "utf8",
  );
  const carrierBlock = /const CLIPS_CONTENT_CARRIERS = new Set\(\[([\s\S]*?)\]\)/.exec(
    harnessSource,
  );
  const harnessCarriers = carrierBlock
    ? [...carrierBlock[1].matchAll(/"([A-Z_]+)"/g)].map((match) => match[1])
    : null;

  record.checks.harnessModel = {
    harnessCarriers,
    harnessModelsSection: Boolean(harnessCarriers?.includes("SECTION")),
    liveSectionCarries: sectionRow.accepted,
    agrees: Boolean(harnessCarriers) &&
      harnessCarriers.includes("SECTION") === sectionRow.accepted,
  };
  assert.ok(
    harnessCarriers && harnessCarriers.length > 0,
    "CLIPS_CONTENT_CARRIERS could not be read out of the harness — this check would silently prove nothing",
  );
  if (!record.checks.harnessModel.agrees) {
    record.findings.push(
      `🔴 The offline harness and Figma disagree about SECTION: the harness ${
        record.checks.harnessModel.harnessModelsSection ? "models it as a carrier" : "omits it"
      } and Figma ${sectionRow.accepted ? "accepts" : "refuses"} the write. Correct CLIPS_CONTENT_CARRIERS from this measurement — same class as the type-rule fiction 2.3 shipped.`,
    );
  }

  // ── 9. What is still owed ────────────────────────────────────────────────────────
  //
  // ⛔ `stillOwed`, never `findings` — a debt reported as a finding reads as a defect.
  record.stillOwed.push(
    "The ECHO discrimination stays FIXTURE-ONLY. Offline, `ignoreClipsContentWrites` models a node that accepts the write and keeps its old value, which is the only construction that separates a receipt echoing its argument from one reading the node back. Live, every accepted context stored what it was handed, so both implementations would have printed the same receipt here. ⭐ What §3 proves instead is stronger in a different direction — that the WRITE resolves — but it is not the same claim.",
  );
  record.stillOwed.push(
    "Whether a node inside an INSTANCE accepts the write is UNMEASURED — the matrix nests a frame inside a plain frame, not inside an instance, because this gate creates no component to instantiate. Figma restricts some writes on instance children, and that is the context most likely to make a readable property unwritable.",
  );

  record.success = true;
} catch (error) {
  failure = error;
  record.success = false;
  record.error = { message: error?.message ?? String(error), stack: error?.stack };
} finally {
  // ⛔ Cleanup lives here, not on the success path. An aborted gate that leaves a page
  // behind has happened once already. ⭐ Everything this gate creates is parented into the
  // scratch page — including the SECTION, which `create_section` places on the current page
  // and the current page is the scratch one — so there is no second cleanup path.
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
  process.stderr.write(`R2.6 2.4 clips content live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.6 2.4 clips content live gate PASSED\n");
