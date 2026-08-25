#!/usr/bin/env node

/**
 * R2.7 item 1.1 — the fill live gate. The first VISUAL gate.
 *
 * ⛔ **THIS GATE EXISTS FOR TWO READINGS THE OFFLINE SUITE CANNOT SETTLE, AND BOTH ARE
 * PLATFORM QUESTIONS.** 31 offline tests and a 12/12 mutation run say the tool reports what
 * it reads. Neither says what Figma DOES.
 *
 *   ① **Does assigning `fills` detach a bound paint style?** The receipt reports
 *      `styleIdBefore` / `styleIdAfter` / `styleDetached` as three readings precisely
 *      because the answer is unknown. The harness models BOTH worlds on request and
 *      NEITHER by default — encoding one would be 2.3's fiction, green offline against a
 *      rule Figma does not have. §5 measures it.
 *   ② **Does the angle convention aim where the schema says it aims?** The schema publishes
 *      "0 is left-to-right, 90 is top-to-bottom". Reading `gradientTransform` back only
 *      echoes what `gradientTransformFromAngle` computed — arithmetic agreeing with itself
 *      — and the offline determinant check proves only that it is *a* rotation, not which
 *      way it turns. ⭐ A sign-flipped convention agrees at 0 degrees, which is the one
 *      anchor the derivation has. §6 settles it by RENDERING.
 *
 * ⭐ **THE CURRENCY FOR ② IS PIXELS, and it has to be.** Every property channel in this
 * repo would answer with the same matrix this fork wrote. `export_node_as_image` renders
 * the node and hands back bytes — a different tool, on a different code path, with no stake
 * in the answer. A 90-degree red→blue ramp on a tall node has a red TOP and a blue BOTTOM;
 * the sign-flipped convention puts them the other way round. That is a reading no echo can
 * fabricate. See [[feedback_a_zero_valued_write_reads_as_no_write]] — measure in a
 * different currency — and [[feedback_a_read_helper_that_writes_is_not_a_read]] for why the
 * probe must not be the tool under test.
 *
 * 🔴 **AND THE OBVIOUS CHANNEL IS A TRAP, AGAIN.** `get_node_info` exports `JSON_REST_V1`
 * through `filterFigmaNode`, which keeps a subset. Whether `fills` survives that filter is
 * itself unverified — and if it does not, before and after both read `undefined` and
 * undefined-vs-undefined **passes vacuously**. That is how the typography gate got burned
 * and how the clips gate nearly did. §2 therefore proves the read channel reports real,
 * MOVING values before a single equality is trusted, and falls back to the receipt's own
 * read-back (which is a plugin-side `node.fills` read, not an echo) when it does not.
 *
 * ⚠️ **A REFUSAL IS AN EXPECTED OUTCOME HERE** — §4 drives cases this tool is supposed to
 * refuse, and a schema-level refusal THROWS while a handler-level one returns `isError`.
 * Scoring correct behaviour as FAIL is a mistake this project has made three times. See
 * [[feedback_a_gate_refusal_is_an_expected_outcome]].
 *
 * ⚠️ **CC7: keep the Figma tab in the FOREGROUND.** A backgrounded tab throttles the
 * plugin's JS and made a passing gate fail twice at 2x its normal elapsed time.
 * See [[feedback_a_reproducible_failure_can_be_environmental]].
 *
 * Usage:
 *   node scripts/live-fill-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<dir>]
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
    "Usage: node scripts/live-fill-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<dir>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// ⛔ PINNED to R2.7 item 1.1, derived from `runtime-metadata.ts` after the regeneration —
// never carried forward from R2.6. The answer to "which halves moved" has differed on
// nearly every one of eleven steps in this project.
//
// This step's shape is **2.1/2.2/2.3's first shape**: a new tool is additive, so BOTH build
// IDs moved (`r2-server-975ccb3ce8b9` → `r2-server-b8086c604b60`,
// `r2-plugin-1eee5a6f3bd9` → `r2-plugin-d8537626e9db`), the fingerprint moved
// (`sha256:f229f6ec…` → `sha256:07e3fff4…`), the tool count moved 60 → 61, and the
// **SCHEMA HELD at 1.8.0**. ⚠️ R2.7 is the release that spends `1.8.0` → `1.9.0`, but item
// 1.1 does not spend it: a new tool cannot break anything, so there is nothing to bump for.
// The bump belongs to whichever R2.7 item changes a `stable` tool's result shape — the
// `filterFigmaNode` read-layer repair is the one already named for it.
//
// ⭐ Operator consequence: `pluginBuildId` MOVED, so the **DEV plugin must be re-run in
// Figma** before this gate. `assertRuntime` reads the live plugin build and refuses before
// touching the document, so a stale plugin costs a refusal and not a dirty file. ⛔ Never
// trust `compatibility: "compatible"` for this — it means the two RUNNING halves agree with
// each other, never that they agree with this tree.
//
// ⛔ AND RUN `bun run build` FIRST. `bun run contract:generate` writes the metadata but does
// NOT rebuild `dist/`, and this gate spawns its own server from `dist/server.js`. Five gates
// refused at `assertRuntime` for exactly this reason at R2.6 acceptance.
// ⚠️ RE-PINNED once inside this item, and the second move is a shape this project has not
// seen before: **ONLY `pluginBuildId` moved** (`d8537626e9db` → `959345dd8f16`). The edit
// was a COMMENT in `code.js` — a correction to an over-claim about Figma normalizing paints
// — and `pluginBuildId` hashes `code.js` + `ui.html` + `manifest.json` as BYTES, so a
// comment moves it. `serverBuildId` held because `server.ts` and `contractPayload` were
// untouched; the fingerprint held because no `capabilityId` changed.
// ⭐ It is the exact INVERSE of R2.6 acceptance, where only `serverBuildId` moved. ⛔ Which
// is the standing lesson: re-derive from `runtime-metadata.ts` every single time. The answer
// has now differed on nearly every one of twelve steps, and both single-sided shapes have
// now occurred.
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
  serverBuildId: "r3-a-server-cfce6484d54a",
  pluginBuildId: "r3-a-plugin-07a616c3b48d",
  schemaVersion: "1.15.0",
  fingerprint:
    "sha256:5e6dcb91bd57c355bd6a2c3e9bb58cf393d6c01bca1d8cb847e69a4d9fee1af3",
  toolCount: 76,
};

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const scratchPageName = `R2.7 1.1 fill gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.7-fill-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({ name: "talk-to-figma-r2.7-fill-gate", version: "1.0.0" });
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

/**
 * ⛔ A refusal is an EXPECTED outcome, and `layer` is the reading that matters. A
 * schema-level refusal THROWS out of the transport; a handler-level one comes back as
 * `isError`. Collapsing the two would make "Zod caught it" and "the tool caught it"
 * indistinguishable, and this tool deliberately splits its refusals between them.
 */
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
    runtime.plugin?.supportedCommands.includes("set_fill"),
    "plugin lacks set_fill — re-run the DEV plugin",
  );
}

/**
 * ⭐ THE PIXEL PROBE — the independent channel, and the only thing that can settle §6.
 *
 * `export_node_as_image` renders the node and returns base64 PNG bytes. This reads a few
 * pixels out of it WITHOUT a PNG library, by asking Figma for a deliberately tiny render
 * and comparing the average colour of the top half against the bottom half. A full decoder
 * is not needed and would be a second thing to get wrong.
 *
 * ⛔ It decodes nothing itself. `export_node_as_image` writes to a file, and the RAW BYTES
 * are hashed and compared BETWEEN renders. Two gradients that differ only in direction
 * produce different bytes; a gradient and its mirror image produce different bytes. That is
 * the discrimination §6 needs, and it needs no interpretation of the pixel format at all.
 */
async function renderBytes(nodeId, label) {
  const filePath = path.join(artifactDirectory, `${label}.png`);
  const reply = await callJson("export_node_as_image", {
    nodeId,
    format: "PNG",
    scale: 1,
    filePath,
  });
  const bytes = await readFile(filePath).catch(() => null);
  return {
    receipt: reply.value,
    filePath,
    byteLength: bytes ? bytes.length : null,
    sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : null,
  };
}

const record = {
  gate: "R2.7 1.1 set_fill",
  startedAt: new Date().toISOString(),
  channel: options.channel,
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

  // ── 1. The published surface, read from the RUNTIME and never from the source ──────
  const inventory = await client.listTools();
  const tool = inventory.tools.find((entry) => entry.name === "set_fill");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(tool, "set_fill is not in the published tool surface");

  const schema = tool.inputSchema ?? {};
  const description = String(tool.description ?? "");
  const paintsSchema = schema.properties?.paints ?? {};
  const paintItems =
    (paintsSchema.anyOf ?? []).find((entry) => entry.type === "array")?.items ?? {};
  const angleDescription = String(paintItems.properties?.angle?.description ?? "");

  record.checks.publishedSchema = {
    paintsRequired: (schema.required ?? []).includes("paints"),
    paintsNullable: JSON.stringify(paintsSchema).includes('"null"'),
    paintTypes: paintItems.properties?.type?.enum ?? null,
    blendModes: paintItems.properties?.blendMode?.enum ?? null,
    // ⛔ Published, not merely implemented. A caller who reads the contract must learn the
    // things that will otherwise surprise them at runtime.
    declaresNullClears: /paints: null/.test(description),
    declaresEmptyRefused: /empty array is refused/.test(description),
    // 🔴 THIS CHECK READ THE WRONG STRING ON ITS FIRST RUN and failed a correct tool. It
    // tested the TOOL description for the angle convention, but a per-parameter fact lives
    // in the PARAMETER's description — which is both where it is and where it belongs.
    // ⭐ The gate found a defect in itself before it touched the document, which is the
    // cheap direction for that to happen.
    declaresAngleConvention:
      /0 is left-to-right/.test(angleDescription) &&
      /90 is top-to-bottom/.test(angleDescription),
    declaresStyleDetachRisk: /may detach that style/.test(description),
    declaresReadBackNotEcho: /read back.*rather than the argument/s.test(description),
    declaresLegacyDivergence: /set_fill_color/.test(description),
  };

  assert.ok(record.checks.publishedSchema.paintsRequired, "paints must be REQUIRED");
  assert.ok(
    record.checks.publishedSchema.paintsNullable,
    "paints must publish as nullable — null is the clear, and an absent field is refused",
  );
  assert.deepEqual(
    record.checks.publishedSchema.paintTypes,
    [
      "SOLID",
      "GRADIENT_LINEAR",
      "GRADIENT_RADIAL",
      "GRADIENT_ANGULAR",
      "GRADIENT_DIAMOND",
    ],
    "the published paint types must be exactly the five this tool implements",
  );
  assert.ok(
    !(record.checks.publishedSchema.blendModes ?? []).includes("PASS_THROUGH"),
    "PASS_THROUGH is a node-level mode for groups; publishing it would be F5's CROP defect again",
  );
  for (const [key, label] of [
    ["declaresNullClears", "that null clears every fill"],
    ["declaresEmptyRefused", "that an empty array is refused"],
    ["declaresAngleConvention", "which way an angle points"],
    ["declaresStyleDetachRisk", "that a bound paint style may be detached"],
    ["declaresReadBackNotEcho", "that the reply is read back rather than echoed"],
    ["declaresLegacyDivergence", "how it relates to legacy set_fill_color"],
  ]) {
    assert.ok(
      record.checks.publishedSchema[key],
      `the published description must state ${label}`,
    );
  }

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

  // ── 2. Scratch page and the INSTRUMENT CHECK on the read channel ───────────────────
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
    currentPageId: originalPageId,
  };

  scratchPageId = await callNodeId("create_page", { name: scratchPageName });
  await call("set_current_page", { pageId: scratchPageId });

  const target = await callNodeId("create_rectangle", {
    x: 0,
    y: 0,
    width: 100,
    height: 300,
    name: "fill target",
  });
  const control = await callNodeId("create_rectangle", {
    x: 200,
    y: 0,
    width: 100,
    height: 300,
    name: "UNTOUCHED control",
  });

  /**
   * 🔴 THE INSTRUMENT CHECK, and this gate cannot conclude anything without it. If
   * `filterFigmaNode` drops `fills`, then `get_node_info` answers `undefined` before AND
   * after every write, and undefined-vs-undefined passes vacuously — a symmetric failure
   * reading exactly like agreement. So the channel is proved to MOVE before any equality
   * over it is trusted, and if it cannot, the gate says so and falls back to the receipt's
   * own read-back rather than quietly trusting a dead channel.
   */
  const readFillsVia = async (nodeId) => {
    const info = await callJson("get_node_info", { nodeId });
    const node = info.value?.document ?? info.value;
    return node?.fills ?? null;
  };

  const beforeProbe = await readFillsVia(target);
  await call("set_fill", {
    nodeId: target,
    paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
  });
  const afterProbe = await readFillsVia(target);

  record.checks.readChannel = {
    before: beforeProbe,
    after: afterProbe,
    // ⭐ The discriminator: the channel is USABLE only if it reported something that MOVED.
    // Both null is the vacuous case and is reported as such, never as agreement.
    usable:
      JSON.stringify(beforeProbe) !== JSON.stringify(afterProbe) && afterProbe !== null,
    verdict: null,
  };
  record.checks.readChannel.verdict = record.checks.readChannel.usable
    ? "get_node_info carries fills and reports a real change"
    : "get_node_info does NOT carry usable fills through filterFigmaNode — equalities over this channel would pass vacuously, so §3-§5 rely on the receipt's plugin-side read-back instead";
  if (!record.checks.readChannel.usable) {
    record.findings.push(
      "The read layer cannot witness this tool's own property: filterFigmaNode's JSON_REST_V1 subset does not carry usable `fills`. This is the same gap recorded for `clipsContent` at R2.6 2.4, and fixing it is a result-shape change to a `stable` tool — it needs R2.7's 1.9.0 bump.",
    );
  }

  // ── 3. The write RESOLVES, measured in pixels against an untouched CONTROL ─────────
  const targetRed = await renderBytes(target, "3-target-red");
  const controlBlank = await renderBytes(control, "3-control-blank");

  await call("set_fill", {
    nodeId: target,
    paints: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }],
  });
  const targetBlue = await renderBytes(target, "3-target-blue");
  const controlAfter = await renderBytes(control, "3-control-after");

  record.checks.writeResolves = {
    targetRedSha: targetRed.sha256,
    targetBlueSha: targetBlue.sha256,
    controlBefore: controlBlank.sha256,
    controlAfter: controlAfter.sha256,
    targetChanged: targetRed.sha256 !== targetBlue.sha256,
    controlHeld: controlBlank.sha256 === controlAfter.sha256,
  };
  assert.ok(
    record.checks.writeResolves.targetChanged,
    "red and blue rendered to identical bytes — the fill did not resolve, or the export is not rendering the fill",
  );
  assert.ok(
    record.checks.writeResolves.controlHeld,
    "the UNTOUCHED control changed — the probe is measuring something other than this write",
  );

  // ── 4. Refusals, and WHICH LAYER answers each ─────────────────────────────────────
  // ⚠️ Every case below is a PASS when it refuses. The split is the point: Zod owns the
  // enums and the array bounds, the handler owns everything about the node and about pairs
  // of arguments that Zod cannot see.
  const refusals = {};
  refusals.emptyArray = await callExpectingRefusal("set_fill", {
    nodeId: target,
    paints: [],
  });
  refusals.badBlendMode = await callExpectingRefusal("set_fill", {
    nodeId: target,
    paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, blendMode: "PASS_THROUGH" }],
  });
  refusals.alphaCollision = await callExpectingRefusal("set_fill", {
    nodeId: target,
    paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 0.5 }, opacity: 0.9 }],
  });
  refusals.aimCollision = await callExpectingRefusal("set_fill", {
    nodeId: target,
    paints: [
      {
        type: "GRADIENT_LINEAR",
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
        ],
        angle: 90,
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    ],
  });
  refusals.outOfRange = await callExpectingRefusal("set_fill", {
    nodeId: target,
    paints: [{ type: "SOLID", color: { r: 255, g: 0, b: 0 } }],
  });

  record.checks.refusals = Object.fromEntries(
    Object.entries(refusals).map(([key, value]) => [
      key,
      { refused: value.refused, layer: value.layer, message: value.message.slice(0, 300) },
    ]),
  );
  for (const [key, value] of Object.entries(refusals)) {
    assert.ok(value.refused, `${key} was ACCEPTED — this tool must refuse it`);
  }
  // ⭐ The two pair-refusals are the tool's own, and must NOT come from the schema: Zod
  // cannot see that two fields mean the same thing. If these report `layer: "schema"` the
  // split has collapsed and the handler's refusal is unreachable through the transport.
  assert.equal(
    refusals.alphaCollision.layer,
    "handler",
    "the color.a x opacity refusal must come from the HANDLER — Zod cannot see a semantic collision",
  );
  assert.equal(
    refusals.aimCollision.layer,
    "handler",
    "the gradientTransform x angle refusal must come from the HANDLER",
  );

  /**
   * 🔴 WHICH LAYER ANSWERS IS A RESULT, NOT A FORMALITY — and the first run found that two
   * handler refusals are UNREACHABLE through the transport.
   *
   * `emptyArray` and `outOfRange` both refuse at `schema`: Zod's `.min(1)` and `.min(0)
   * .max(1)` fire before the plugin is reached, so the handler's far better messages —
   * "Pass null to remove every fill — an empty array and null would be two ways to say one
   * thing" and "Figma colour channels are 0-1 floats, not 0-255 bytes" — are never what a
   * real MCP caller sees.
   *
   * ⚠️ That is NOT a defect and the schema is not loosened to expose them: a structured,
   * earlier refusal is the better outcome, and the handler checks remain correct
   * defence-in-depth because the plugin dispatcher is a SECOND entry point.
   * ⛔ What it DOES mean is that the offline tests asserting those two messages are testing
   * the second entry point only, and prove nothing about the caller's experience. Recorded
   * rather than left implicit — the same correction `create_text`'s gate made when it noted
   * that a schema-layer refusal "proves nothing about the handler".
   */
  // ⛔ OWNERSHIP IS DECLARED, AND THE CHECK IS A MISMATCH — not a description of whatever
  // happened. An instrument that merely reports the layers would print the same thing
  // whether the split were right or catastrophically wrong. This encodes the QUESTION
  // ("does each refusal arrive from the layer that is supposed to own it?"), so it survives
  // a future change instead of pinning today's answer. See
  // [[feedback_an_instrument_pinned_to_the_implementation]].
  //
  // `schema` — Zod owns every enum and every bound, per 2.2's split: all values are legal,
  //   so a wrong one is a caller mistake best refused at the boundary with the legal set
  //   named. The handler repeats these checks because the plugin dispatcher is a SECOND
  //   entry point, not because they should surface here.
  // `handler` — the two SEMANTIC collisions. Zod cannot see that two fields mean the same
  //   thing, so if either of these ever reports `schema` the split has collapsed and the
  //   tool's own refusal has become unreachable.
  const declaredOwner = {
    emptyArray: "schema",
    badBlendMode: "schema",
    outOfRange: "schema",
    alphaCollision: "handler",
    aimCollision: "handler",
  };
  record.checks.refusals.layerSplit = Object.fromEntries(
    Object.entries(refusals).map(([key, value]) => [
      key,
      { declared: declaredOwner[key], observed: value.layer },
    ]),
  );
  const mismatched = Object.entries(refusals)
    .filter(([key, value]) => declaredOwner[key] !== value.layer)
    .map(([key, value]) => `${key} (declared ${declaredOwner[key]}, observed ${value.layer})`);
  record.checks.refusals.ownershipMismatches = mismatched;
  assert.deepEqual(
    mismatched,
    [],
    `a refusal arrived from the wrong layer: ${mismatched.join("; ")}. A handler refusal that reports \`schema\` is UNREACHABLE through the transport; a schema refusal that reports \`handler\` means the boundary stopped validating`,
  );

  // ⚠️ Recorded because it is easy to misread the three `schema` rows above as a defect.
  // They are by design — but the consequence is real: `set_fill`'s handler messages for
  // those three ("Pass null to remove every fill…", "Figma colour channels are 0-1 floats,
  // not 0-255 bytes") are never what an MCP caller sees, so the offline tests asserting
  // them exercise the plugin's second entry point only and say nothing about the caller's
  // experience. The same correction `create_text`'s gate made when it noted a schema-layer
  // refusal "proves nothing about the handler".
  record.checks.refusals.handlerMessagesUnreachableByDesign = Object.entries(declaredOwner)
    .filter(([, owner]) => owner === "schema")
    .map(([key]) => key);

  // ⛔ The document must be untouched by all five. A refusal that mutated is the whole
  // reason validate-all-then-write exists.
  const afterRefusals = await renderBytes(target, "4-after-refusals");
  record.checks.refusals.documentUntouched =
    afterRefusals.sha256 === targetBlue.sha256;
  assert.ok(
    record.checks.refusals.documentUntouched,
    "a refused call changed the rendered node — the write phase ran before validation finished",
  );

  // ── 5. THE STYLE QUESTION — measured, not assumed ─────────────────────────────────
  // ⭐ This is the reading the whole receipt shape was built around, and neither answer is
  // a failure. What WOULD be a failure is the receipt reporting one thing while the
  // document holds another.
  const styles = (await callJson("get_styles")).value;
  const paintStyles =
    styles.paintStyles ?? styles.paint ?? styles.styles?.paint ?? [];
  record.checks.styleDetach = {
    paintStyleCount: Array.isArray(paintStyles) ? paintStyles.length : null,
    measured: false,
    verdict: null,
  };

  if (Array.isArray(paintStyles) && paintStyles.length > 0) {
    // A style exists in this file, so the question is answerable here.
    const styled = await callNodeId("create_rectangle", {
      x: 400,
      y: 0,
      width: 100,
      height: 100,
      name: "styled node",
    });
    // ⛔ There is no fork tool that BINDS a paint style — that is R3 work. So this leg can
    // only run against a node that already carries one, and cannot manufacture the state.
    // Recorded honestly rather than faked with a node that has no style.
    const receiptBefore = (await callJson("set_fill", {
      nodeId: styled,
      paints: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }],
    })).value;
    record.checks.styleDetach.receipt = {
      styleIdBefore: receiptBefore.styleIdBefore,
      styleIdAfter: receiptBefore.styleIdAfter,
      styleDetached: receiptBefore.styleDetached,
      styleReadable: receiptBefore.styleReadable,
    };
    record.checks.styleDetach.measured = receiptBefore.styleIdBefore !== null;
    record.checks.styleDetach.verdict = record.checks.styleDetach.measured
      ? receiptBefore.styleDetached
        ? "MEASURED: assigning fills DETACHES a bound paint style"
        : "MEASURED: assigning fills LEAVES a bound paint style attached"
      : "UNMEASURED: the scratch node carries no bound style, and no fork tool can bind one (R3 work)";
  } else {
    record.checks.styleDetach.verdict =
      "UNMEASURED: this file has no local paint styles to bind";
  }

  if (!record.checks.styleDetach.measured) {
    record.stillOwed.push(
      "styleDetached is still UNMEASURED against real Figma. No fork tool binds a paint style (`set_fill_style` would be R3), so this gate cannot manufacture the precondition. ⛔ The receipt reports it as a READING and never as a claim, which is what makes the tool correct under either answer — but the question is open, and promoting set_fill to `stable` on the strength of this gate does not close it.",
    );
    record.findings.push(
      "§5 could not construct a node with a bound paint style. To close it, bind one by hand in the Figma file before the next run, on a node the gate can find by name.",
    );
  }

  // ── 6. THE ANGLE CONVENTION — settled by RENDERING, not by reading the matrix back ──
  // ⭐ THE READING THAT COULD NOT BE TAKEN OFFLINE. A red→blue ramp at 90 degrees and the
  // same ramp at 270 degrees are mirror images: the schema says 90 puts red at the TOP.
  // Reading `gradientTransform` back would only echo `gradientTransformFromAngle`, and the
  // offline determinant check proves only that it is *a* rotation, not which way it turns.
  // ⛔ These two renders MUST differ. If they are byte-identical the angle is not reaching
  // the render at all, and every angle-based claim in the schema is unfounded.
  const rampStops = [
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
  ];
  const rampAt = async (angle, label) => {
    const reply = (await callJson("set_fill", {
      nodeId: target,
      paints: [{ type: "GRADIENT_LINEAR", gradientStops: rampStops, angle }],
    })).value;
    const render = await renderBytes(target, label);
    return { angle, aim: reply.gradientAim?.[0] ?? null, sha256: render.sha256, filePath: render.filePath };
  };

  const ramp90 = await rampAt(90, "6-ramp-090");
  const ramp270 = await rampAt(270, "6-ramp-270");
  const ramp0 = await rampAt(0, "6-ramp-000");

  record.checks.angleConvention = {
    ramp90: { sha256: ramp90.sha256, aim: ramp90.aim, png: ramp90.filePath },
    ramp270: { sha256: ramp270.sha256, aim: ramp270.aim, png: ramp270.filePath },
    ramp0: { sha256: ramp0.sha256, aim: ramp0.aim, png: ramp0.filePath },
    angleReachesTheRender: ramp90.sha256 !== ramp270.sha256,
    axisIsRealNotDecorative: ramp90.sha256 !== ramp0.sha256,
    verdict: null,
  };
  assert.ok(
    record.checks.angleConvention.angleReachesTheRender,
    "90 and 270 degrees rendered to IDENTICAL bytes — the angle is not reaching the render, so the schema's convention is unfounded",
  );
  assert.ok(
    record.checks.angleConvention.axisIsRealNotDecorative,
    "0 and 90 degrees rendered to identical bytes — the gradient axis does not rotate",
  );
  // ⚠️ WHAT THIS DOES *NOT* SETTLE, stated rather than glossed. Byte inequality proves the
  // angle MOVES the render and that 90 and 270 are distinguishable. It does NOT prove red
  // is at the TOP at 90 degrees — that needs a human to look at the two PNGs, or a decoder
  // this gate deliberately does not carry. The files are kept for exactly that.
  record.checks.angleConvention.verdict =
    "MEASURED: the angle reaches the render and 0/90/270 are mutually distinguishable. ✅ THE DIRECTION WAS SETTLED BY INSPECTION on 2026-08-23 against this gate's own PNGs: 0deg renders red LEFT -> blue right; 90deg renders red TOP -> blue bottom; 270deg is its exact mirror (blue top). That matches the published '0 is left-to-right, 90 is top-to-bottom' exactly, and positively excludes the sign-flipped convention, which would have put blue at the top at 90deg. ⛔ This gate still carries no PNG decoder — it proves DISTINGUISHABILITY mechanically, and the direction is re-confirmed by looking at the three files it keeps.";
  record.stillOwed.push(
    "The angle's DIRECTION is established by INSPECTING the three PNGs this gate retains, not by an assertion inside it — byte inequality proves 0/90/270 are distinguishable, never which is which. ✅ Confirmed 2026-08-23 (90deg = red at TOP, matching the schema). ⛔ Re-confirm by eye if gradientTransformFromAngle is ever touched: the offline determinant check proves the transform is A rotation, never which way it turns, and a sign flip survived the whole offline suite once already.",
  );

  // ── 7. null clears, and the clear is visible in pixels ────────────────────────────
  const cleared = (await callJson("set_fill", { nodeId: target, paints: null })).value;
  const clearedRender = await renderBytes(target, "7-cleared");
  record.checks.clear = {
    cleared: cleared.cleared,
    fillCount: cleared.fillCount,
    previousCount: Array.isArray(cleared.previous) ? cleared.previous.length : null,
    renderChanged: clearedRender.sha256 !== ramp0.sha256,
  };
  assert.equal(cleared.cleared, true, "paints: null must report cleared");
  assert.equal(cleared.fillCount, 0, "paints: null must leave zero fills");
  assert.ok(
    record.checks.clear.renderChanged,
    "clearing every fill did not change the render — the clear did not resolve",
  );

  record.success = true;
} catch (error) {
  failure = error;
  record.success = false;
  record.error = { message: error?.message ?? String(error), stack: error?.stack };
} finally {
  // ⛔ Cleanup lives here, not on the success path. Everything this gate creates is
  // parented into the scratch page, so there is one cleanup path.
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
  process.stderr.write(`R2.7 1.1 fill live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.7 1.1 fill live gate PASSED\n");
