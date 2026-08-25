#!/usr/bin/env node

/**
 * R2.5 + R2.6 item 2.0 — the typography live gate.
 *
 * What this proves that the 186 offline tests cannot: that `set_text_style`'s
 * validate-all-then-write guarantee holds when the judge is **real Figma** rather than a
 * fixture. Offline, the harness decides which fonts refuse to load and which assignments
 * throw; here Figma decides, and the question is whether the document is still untouched
 * afterwards.
 *
 * ⭐ Sections 6–9 extend that question to `create_text`, which R2.6 item 2.0 put on the
 * same twelve-parameter surface. The guarantee has a different SHAPE there: a create tool
 * cannot leave a node byte-identical, it can only leave the page's child list unchanged —
 * so every refusal is scored by counting children through `get_document_info`, a
 * different channel from the one that creates. A `rejects` assertion alone would pass
 * happily over an orphaned empty text node, which is what F4 looks like on this tool.
 *
 * ⛔ Three traps inherited from the R2.4 gate, each already paid for once:
 *
 *  1. A refusal is an EXPECTED outcome and arrives in two shapes — the plugin throws and
 *     the wrapper catches it into an error *result*, or the Zod schema rejects the
 *     argument before dispatch and it arrives thrown. Scoring either as a crash has
 *     failed this project three times.
 *  2. A gate that mutates cleans up in a `finally`, not on the success path.
 *  3. A rebuild reaches neither running side. This script spawns its own server from
 *     `dist/server.js`, so the SERVER half is always fresh — but the Figma DEV plugin
 *     holds `code.js` from launch, so a stale plugin is the failure mode this pins for.
 *     ⛔ `compatibility: "compatible"` only means the two RUNNING halves match each
 *     other; it says nothing about whether they match this tree.
 *
 * ⭐ It also discharges what R2.5's earlier phases could only record:
 *     • Phase 2's CC6 debt — the fixture supplies 8 faces; a real machine's inventory
 *       size, and whether `offset` paging is actually repeatable, can only be seen here.
 *     • Phase 3's refusal policy — that an absent font produces an error and NOT a
 *       silent Inter substitution, on real Figma.
 *
 * Every write lands on a scratch page this gate creates and deletes. ⛔ Existing content
 * is never written to: the mixed-font case, if the document has one, is exercised on a
 * CLONE placed on the scratch page, never on the original.
 *
 * Usage:
 *   node scripts/live-text-style-gate.mjs --channel=<DEV-plugin-channel> \
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
    "Usage: node scripts/live-text-style-gate.mjs --channel=<DEV-plugin-channel> [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}

// ⛔ RE-PINNED for R2.6 item 2.0 — and this time EVERY pin moved, which is the opposite
// of the step before it. `create_text` grew twelve parameters (server + plugin), and the
// contract bump to 1.8.0 put a new `serverSchemaVersion` inside `capabilityFingerprint`.
// So: server build moved, plugin build moved, fingerprint moved, schema moved. Only the
// tool count held still, because 2.0 is a WIDENING and adds no tool.
//
// ⭐ Read that as an operator instruction, not trivia: the DEV plugin **must** be re-run
// before this gate, because `code.js` changed. The gate spawns its own server from
// `dist/server.js`, so the server half needs no respawn *here* — an interactive MCP
// session is a different story and needs one.
//
// ⚠️ The last five releases have each flipped this answer. ⛔ Do not carry it forward —
// re-derive which halves moved from `runtime-metadata.ts` every time.
//
// ⛔ RE-PINNED 2026-08-22 to R2.6 item 2.4, the LAST of the four layout tools — the
// owner's standing call to re-pin and re-run the stale set ONCE, now that the set is
// closed at five. Since this gate last ran (item 2.0, channel `7l9ymck4`), four additive
// items landed: both build IDs and the fingerprint moved each time, the tool count moved
// 56 → 60, and the **schema HELD at 1.8.0 throughout** — 2.0 spent this release's one bump
// and a new tool is additive.
//
// ⭐ **A pin edit does NOT move the build.** `serverBuildId` is
// `sha256(server.ts + contractPayload)`; `scripts/` is hashed by nothing
// (`scripts/contract-lib.mjs:605`). That is why five gates can be re-pinned to one pair in
// one pass without staling each other — the *items* staled them, never the pins.
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
const scratchPageName = `R2.5+2.6 typography gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.5-2.6-live-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r2.5-2.6-text-style-gate",
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

async function callEmbeddedJson(name, args = {}) {
  const called = await call(name, args);
  const start = called.text.indexOf("{");
  const end = called.text.lastIndexOf("}");
  assert.ok(start >= 0 && end > start, `${name} returned no JSON object: ${called.text}`);
  return { ...called, value: JSON.parse(called.text.slice(start, end + 1)) };
}

/**
 * The create tools do NOT answer in one shape, and R2.6 added a fourth: `create_page`
 * embeds JSON; `create_frame` and `create_section` answer prose (`… with ID: 1:2`);
 * `clone_node` answers `with new ID:`; and `create_text` now answers **both** — the
 * historical prose line, then its receipt on the next line, because three gates parse
 * that first line and `clone_node` already proved what rewording one costs.
 * Accepting every shape here keeps the gate honest about what the tools actually return
 * today rather than about what a consumer might wish they returned.
 */
async function callNodeId(name, args = {}) {
  const called = await call(name, args);
  const start = called.text.indexOf("{");
  const end = called.text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = JSON.parse(called.text.slice(start, end + 1));
    if (parsed?.id) return { ...called, id: parsed.id, value: parsed };
  }
  // ⛔ THREE reply shapes, not two. `create_page` embeds JSON; `create_text`,
  // `create_frame` and `create_section` answer prose "with ID:"; `clone_node` alone
  // answers "with **new** ID:" (server.ts:1288) and slipped through a matcher written
  // against the first two. Same class as the Phase 3 first run, one tool further on.
  // ⭐ The qualifier is matched explicitly rather than loosened to /ID:/ — an unknown
  // fourth shape must fail LOUDLY on the assert below, carrying the full text, rather
  // than silently capturing the wrong token and failing three calls later.
  const match = called.text.match(/with (?:new )?ID:\s*([^.\s]+)/);
  assert.ok(match, `${name} returned neither JSON nor a prose node id: ${called.text}`);
  return { ...called, id: match[1], value: null };
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
    runtime.plugin?.supportedCommands.includes("set_text_style"),
    "plugin lacks set_text_style — re-run the DEV plugin",
  );
}

/**
 * ⛔ An INDEPENDENT read of the node, and the trap it is shaped by.
 *
 * `get_node_info` exports `JSON_REST_V1` and `filterFigmaNode` keeps only a REST `style`
 * subset — `fontFamily`, `fontStyle`, `fontSize`, `textAlignHorizontal`, `letterSpacing`,
 * `lineHeightPx`. The plugin-API names this gate first reached for (`fontName`,
 * `textCase`, `paragraphIndent`, …) are simply ABSENT from that shape.
 *
 * 🔴 Reading them anyway would have returned all-null, and comparing all-null before a
 * refusal with all-null after it **passes vacuously** — a symmetric failure that reads
 * exactly like agreement. So this returns only fields the channel really carries, and
 * `assertReadChannelWorks` proves it reports real values before any equality is trusted.
 */
const REST_STYLE_FIELDS = [
  "fontFamily",
  "fontStyle",
  "fontSize",
  "textAlignHorizontal",
  "letterSpacing",
  "lineHeightPx",
];

async function restTypographyOf(nodeId) {
  const info = await callJson("get_node_info", { nodeId });
  const node = info.value?.document ?? info.value;
  const style = node?.style ?? {};
  const out = { characters: node?.characters ?? null };
  for (const key of REST_STYLE_FIELDS) out[key] = style[key] ?? null;
  return out;
}

/**
 * The scratch page's child count, read through `get_document_info` — a DIFFERENT channel
 * from the one that creates. ⛔ This is `create_text`'s side-effect channel: on a create
 * tool, "the refusal wrote nothing" can only mean "no node appeared", and a `rejects`
 * assertion on its own passes happily over an orphaned empty text node.
 */
async function scratchChildCount() {
  const info = (await callJson("get_document_info", { summary: true, limit: 1 })).value;
  assert.equal(
    info.currentPage?.id,
    scratchPageId,
    "the child count was read against the wrong page — the gate is not on its scratch page",
  );
  const count = info.currentPage?.childCount;
  assert.equal(
    typeof count,
    "number",
    `childCount must be a number, or every comparison against it is vacuous; got ${JSON.stringify(count)}`,
  );
  return count;
}

/** ⛔ Proves the read channel is not answering null to everything. */
function assertReadChannelWorks(snapshot, expected, context) {
  const populated = Object.values(snapshot).filter((value) => value !== null).length;
  assert.ok(
    populated >= 4,
    `${context}: the read channel returned ${populated} populated fields — an all-null snapshot would make every comparison below vacuous`,
  );
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(snapshot[key], value, `${context}: ${key} did not read back as written`);
  }
}

const ALL_TWELVE = {
  fontFamily: "Inter",
  fontStyle: "Bold",
  fontSize: 32,
  lineHeight: { value: 40, unit: "PIXELS" },
  letterSpacing: { value: -2, unit: "PERCENT" },
  textCase: "UPPER",
  textDecoration: "UNDERLINE",
  textAlignHorizontal: "CENTER",
  textAlignVertical: "BOTTOM",
  paragraphSpacing: 8,
  paragraphIndent: 12,
  textAutoResize: "HEIGHT",
};

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

  const inventory = await client.listTools();
  const styleTool = inventory.tools.find((tool) => tool.name === "set_text_style");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(styleTool, "set_text_style is not in the published tool surface");

  // ⭐ Read the PUBLISHED schema, never the source. This gate's predecessor spent two
  // runs filing a finding that quoted a sentence the description had already stopped
  // containing — a narrated claim with nothing checking it against the runtime.
  const publishedSchema = JSON.stringify(styleTool.inputSchema);
  record.checks.publishedSchema = {
    // D2: character ranges are internal. No offsets may appear in the public surface.
    declaresNoRangeOffsets: !/"start"|"end"|"rangeStart"/.test(publishedSchema),
    // 3.4: {value, unit} objects, never bare numbers.
    lineHeightIsObject: /"lineHeight":\{"type":"object"/.test(publishedSchema),
    letterSpacingIsObject: /"letterSpacing":\{"type":"object"/.test(publishedSchema),
    describesRefusalNotSubstitution:
      /REFUSED, never substituted|refused, never substituted/i.test(
        String(styleTool.description ?? ""),
      ),
  };
  assert.ok(record.checks.publishedSchema.declaresNoRangeOffsets, "D2 violated");
  assert.ok(record.checks.publishedSchema.lineHeightIsObject, "3.4 violated: lineHeight");
  assert.ok(record.checks.publishedSchema.letterSpacingIsObject, "3.4 violated: letterSpacing");
  assert.ok(
    record.checks.publishedSchema.describesRefusalNotSubstitution,
    "the published description must state the refuse-never-substitute policy",
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

  // ── CC6, Phase 2's standing debt ────────────────────────────────────────────────
  // The fixture supplies 8 faces. Only a real machine can say what the bounding is for.
  const fontsPage1 = (await callJson("get_available_fonts", { limit: 5 })).value;
  const fontsPage1Again = (await callJson("get_available_fonts", { limit: 5 })).value;
  const fontsPage2 = (await callJson("get_available_fonts", { limit: 5, offset: 5 })).value;
  record.checks.realInventory = {
    fontCount: fontsPage1.fontCount,
    familyCount: fontsPage1.familyCount,
    ceilingBelowInventory: fontsPage1.fontCount > 5000,
    // ⭐ The sort is a deterministic code-unit sort precisely so `offset` is repeatable.
    // Two identical requests returning different faces would make paging a lie.
    pagingRepeatable:
      JSON.stringify(fontsPage1.fonts) === JSON.stringify(fontsPage1Again.fonts),
    pagingAdvances: JSON.stringify(fontsPage1.fonts) !== JSON.stringify(fontsPage2.fonts),
    // The window must never rewrite the whole-inventory totals.
    totalsSurviveWindow: fontsPage2.fontCount === fontsPage1.fontCount,
  };
  assert.ok(record.checks.realInventory.fontCount > 100, "this is not a real inventory");
  assert.ok(record.checks.realInventory.pagingRepeatable, "offset paging is not repeatable");
  assert.ok(record.checks.realInventory.pagingAdvances, "offset did not advance the window");
  assert.ok(record.checks.realInventory.totalsSurviveWindow, "the window rewrote the totals");
  if (record.checks.realInventory.ceilingBelowInventory) {
    record.findings.push(
      `The machine reports ${fontsPage1.fontCount} faces, above get_available_fonts's 5000 limit ceiling, so the whole inventory cannot be returned in one call and offset paging is mandatory rather than optional on this host.`,
    );
  }

  // A font that certainly does not exist, and the case-sensitivity trap, live.
  const preflight = (
    await callJson("check_fonts", {
      fonts: [
        { family: "Inter", style: "Bold" },
        { family: "Ghostly Absent Family", style: "Regular" },
        { family: "inter", style: "Bold" },
      ],
    })
  ).value;
  record.checks.preflight = {
    interLoadable: preflight.results[0].loadable,
    absentFamily: {
      available: preflight.results[1].available,
      familyAvailable: preflight.results[1].familyAvailable,
      loadable: preflight.results[1].loadable,
    },
    // ⭐ A near miss on case reads as an ABSENT FAMILY, not as a wrong style — which is
    // why `familyAvailable` is a third fact rather than a nicety.
    lowercaseFamilyReadsAsAbsent: preflight.results[2].familyAvailable === false,
  };
  assert.equal(preflight.results[0].loadable, true, "Inter Bold must be loadable");
  assert.equal(preflight.results[1].loadable, false);

  // ── Scratch page ────────────────────────────────────────────────────────────────
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    currentPageId: originalPageId,
    pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
  };

  // ⛔ The mixed-font source is an EXPLICIT opt-in (`--mixed-node=<id>`), not a search.
  // The first run scanned the current page for one and the request TIMED OUT on real
  // content — `scan_text_nodes` over a production page is unbounded by nature, and a
  // two-minute search for an opportunistic extra is the wrong trade. The fork ships no
  // range-font setter, so a mixed node cannot be authored by these tools either; if none
  // is named the case is recorded as owed rather than faked.
  const mixedSourceId = options["mixed-node"] || null;
  record.checks.mixedNodeSource = mixedSourceId ? { provided: mixedSourceId } : { provided: null };

  const page = (await callEmbeddedJson("create_page", { name: scratchPageName })).value;
  scratchPageId = page.id;
  await call("set_current_page", { pageId: scratchPageId });

  const targetId = (
    await callNodeId("create_text", {
      x: 0,
      y: 0,
      text: "R2.5 typography gate",
      name: "gate-target",
      parentId: scratchPageId,
    })
  ).id;

  // ── 1. The happy path: all twelve fields, read back through an INDEPENDENT channel ──
  const applied = (await callJson("set_text_style", { nodeId: targetId, ...ALL_TWELVE })).value;
  const restAfterWrite = await restTypographyOf(targetId);
  // ⛔ Vacuity guard FIRST. Every comparison after this one is only meaningful because
  // the channel is proven here to report real values rather than nulls.
  assertReadChannelWorks(
    restAfterWrite,
    { fontFamily: "Inter", fontStyle: "Bold", fontSize: 32, textAlignHorizontal: "CENTER" },
    "happy path",
  );
  record.checks.appliedAllTwelve = {
    appliedFieldCount: applied.appliedFieldCount,
    fontSubstituted: applied.fontSubstituted,
    wasMixed: applied.wasMixed,
    pluginSnapshot: applied.after,
    independentReadBack: restAfterWrite,
  };
  assert.equal(applied.appliedFieldCount, 12);
  assert.equal(applied.fontSubstituted, false, "fontSubstituted must be a present false");
  assert.equal(
    Object.hasOwn(applied, "fontSubstituted"),
    true,
    "the declaration must be present, not merely falsy",
  );
  // The fields REST does not carry are still asserted, through the plugin's own snapshot.
  assert.equal(applied.after.textCase, "UPPER");
  assert.equal(applied.after.textAutoResize, "HEIGHT");
  assert.equal(applied.after.paragraphIndent, 12);

  /**
   * ⭐ A witness for the SIX fields REST cannot see. A refusal must not move any of the
   * eleven, but `get_node_info` only carries six of them — so after each refusal a
   * trivially-valid call is made whose `before` snapshot is taken by the plugin AFTER
   * the refusal. If the refusal wrote anything, that `before` diverges from the state
   * the happy path left behind.
   */
  const baselineSnapshot = JSON.stringify(applied.after);
  async function witnessUnchanged(label) {
    const witness = (
      await callJson("set_text_style", {
        nodeId: targetId,
        textAlignHorizontal: "CENTER", // already CENTER — a write that changes nothing
      })
    ).value;
    const unchanged = JSON.stringify(witness.before) === baselineSnapshot;
    if (!unchanged) {
      record.findings.push(
        `${label}: the plugin's own snapshot moved across a refusal — ${JSON.stringify(witness.before)}`,
      );
    }
    return unchanged;
  }

  // ── 2. ⛔ VALIDATE-ALL-THEN-WRITE, with Figma as the judge ───────────────────────
  // Eleven valid parameters and one bad enum, the bad one LAST. A validate-as-you-go
  // implementation writes the eleven and then throws — which is F4, and which a
  // throw-only assertion could not tell apart from a clean refusal.
  const beforeRefusal = await restTypographyOf(targetId);
  const refusal = await callExpectingRefusal("set_text_style", {
    nodeId: targetId,
    ...ALL_TWELVE,
    fontSize: 64,
    textCase: "LOWER",
    textAutoResize: "SOMETIMES",
  });
  const afterRefusal = await restTypographyOf(targetId);
  const refusalWitness = await witnessUnchanged("validate-all-then-write");
  record.checks.validateAllThenWrite = {
    layer: refusal.layer,
    message: refusal.message.slice(0, 300),
    independentReadUnchanged: JSON.stringify(beforeRefusal) === JSON.stringify(afterRefusal),
    pluginSnapshotUnchanged: refusalWitness,
    before: beforeRefusal,
    after: afterRefusal,
  };
  assert.equal(afterRefusal.fontSize, 32, "fontSize was written despite the refusal");
  assert.ok(
    record.checks.validateAllThenWrite.independentReadUnchanged,
    "a refused call MUTATED the document — this is F4, live",
  );
  assert.ok(
    record.checks.validateAllThenWrite.pluginSnapshotUnchanged,
    "a refused call moved one of the six fields REST cannot see",
  );

  // ── 3. ⛔ REFUSE, NEVER SUBSTITUTE, with Figma as the judge ──────────────────────
  const beforeFontRefusal = await restTypographyOf(targetId);
  const fontRefusal = await callExpectingRefusal("set_text_style", {
    nodeId: targetId,
    fontFamily: "Ghostly Absent Family",
    fontStyle: "Regular",
    fontSize: 11,
  });
  const afterFontRefusal = await restTypographyOf(targetId);
  const fontWitness = await witnessUnchanged("refuse-never-substitute");
  record.checks.refuseNeverSubstitute = {
    layer: fontRefusal.layer,
    message: fontRefusal.message.slice(0, 300),
    independentReadUnchanged:
      JSON.stringify(beforeFontRefusal) === JSON.stringify(afterFontRefusal),
    pluginSnapshotUnchanged: fontWitness,
    fontAfter: { family: afterFontRefusal.fontFamily, style: afterFontRefusal.fontStyle },
    sizeAfter: afterFontRefusal.fontSize,
  };
  // ⭐ The distinguishing fact. `setCharacters` answers a refused load by loading Inter
  // and retyping the node; had this tool grown that path the style would read Regular
  // here rather than the Bold the happy path left behind.
  assert.equal(afterFontRefusal.fontStyle, "Bold", "the font was substituted, not refused");
  assert.equal(afterFontRefusal.fontSize, 32, "the size was written despite the refusal");
  assert.ok(
    record.checks.refuseNeverSubstitute.independentReadUnchanged,
    "an unloadable font MUTATED the document",
  );
  assert.ok(record.checks.refuseNeverSubstitute.pluginSnapshotUnchanged);

  // ── 4. Half a font pair, and a zero-field call ───────────────────────────────────
  const halfPair = await callExpectingRefusal("set_text_style", {
    nodeId: targetId,
    fontFamily: "Inter",
  });
  const emptyCall = await callExpectingRefusal("set_text_style", { nodeId: targetId });
  record.checks.pairingAndMinimum = {
    halfPairLayer: halfPair.layer,
    halfPairRefused: /supplied together/.test(halfPair.message),
    emptyRefused: /at least one property/.test(emptyCall.message),
  };
  assert.ok(record.checks.pairingAndMinimum.halfPairRefused);
  assert.ok(record.checks.pairingAndMinimum.emptyRefused);

  // ── 5. Mixed-font unification, on a CLONE, only if the document has one ──────────
  if (mixedSourceId) {
    const cloneId = (await callNodeId("clone_node", { nodeId: mixedSourceId })).id;
    await call("set_parent", { nodeId: cloneId, parentId: scratchPageId });
    const unified = (
      await callJson("set_text_style", {
        nodeId: cloneId,
        fontFamily: "Inter",
        fontStyle: "Regular",
      })
    ).value;
    record.checks.mixedUnification = {
      source: mixedSourceId,
      clone: cloneId,
      wasMixed: unified.wasMixed,
      fontUnified: unified.fontUnified,
      beforeFontName: unified.before.fontName,
      limitations: unified.limitations,
    };
    assert.equal(unified.wasMixed, true, "the cloned node was not mixed after all");
    // ⛔ The symbol must have become the string "MIXED". JSON.stringify renders a symbol
    // as undefined, which DROPS the key — an absence that would read as "not reported".
    assert.equal(unified.before.fontName, "MIXED");
  } else {
    record.stillOwed.push(
      "Mixed-font unification (3.3) stays FIXTURE-ONLY. The fork ships no range-font setter, so a mixed node cannot be authored by these tools, and none was named with --mixed-node. `wasMixed: true` and the \"MIXED\" sentinel are proven offline and unproven live.",
    );
  }

  // ── 6. R2.6 item 2.0 — `create_text` on the same surface ────────────────────────
  // ⛔ The F4 shape on a create tool is not a half-written node, it is a node that
  // exists at all. Every refusal below is scored by counting the scratch page's
  // children through `get_document_info` — a DIFFERENT channel from the one that
  // creates — because a `rejects` on its own passes happily over an orphan.
  const beforeStyledCreate = await scratchChildCount();
  const styledCreate = await callEmbeddedJson("create_text", {
    x: 0,
    y: 120,
    text: "R2.6 create_text gate",
    name: "gate-created",
    parentId: scratchPageId,
    ...ALL_TWELVE,
  });
  const createdRest = await restTypographyOf(styledCreate.value.id);
  assertReadChannelWorks(
    createdRest,
    { fontFamily: "Inter", fontStyle: "Bold", fontSize: 32, textAlignHorizontal: "CENTER" },
    "styled create",
  );
  record.checks.styledCreate = {
    id: styledCreate.value.id,
    // ⭐ The un-awaited `setCharacters`, live. Offline this reply carried `""` for text
    // it had in fact written, and ONLY on the path without `parentId` — an unrelated
    // parameter decided whether the tool told the truth.
    charactersInReply: styledCreate.value.characters,
    fontSource: styledCreate.value.fontSource,
    fontSubstituted: styledCreate.value.fontSubstituted,
    appliedFieldCount: styledCreate.value.appliedFieldCount,
    pluginSnapshot: styledCreate.value.style,
    independentReadBack: createdRest,
    // ⛔ The prose first line must survive verbatim — three gates parse "with ID:".
    proseFirstLine: styledCreate.text.split("\n")[0],
  };
  assert.equal(styledCreate.value.characters, "R2.6 create_text gate");
  assert.equal(createdRest.characters, "R2.6 create_text gate", "the document disagrees with the reply");
  assert.equal(styledCreate.value.appliedFieldCount, 12);
  assert.equal(styledCreate.value.fontSource, "explicit");
  assert.equal(
    Object.hasOwn(styledCreate.value, "fontSubstituted"),
    true,
    "the declaration must be present, not merely falsy",
  );
  assert.equal(styledCreate.value.fontSubstituted, false);
  assert.match(
    record.checks.styledCreate.proseFirstLine,
    /^Created text ".*" with ID: \S+$/,
    "the R1-era prose line changed shape — every gate that parses creators breaks on this",
  );
  assert.equal(await scratchChildCount(), beforeStyledCreate + 1);

  // ── 7. ⛔ VALIDATE-ALL-THEN-CREATE, with Figma as the judge ──────────────────────
  //
  // 🔴 The invalid value has to be one the SCHEMA accepts. A bad enum (`textAutoResize:
  // "SOMETIMES"`) never reaches the plugin — Zod rejects it before dispatch — so "the
  // page is unchanged" would be trivially true and this check would pass vacuously while
  // asking nothing, the same shape as `undefined === undefined`. `{value, unit: "AUTO"}`
  // is a CROSS-FIELD rule: every field is individually well-typed, so it clears the
  // schema and is refused by the handler, which is the thing under test.
  //
  // ⭐ In the plugin's own validation order it lands THIRD — after the font pair and the
  // three numerics — so a validate-as-you-go implementation would already have written
  // `fontName`, `fontSize`, `paragraphSpacing` and `paragraphIndent` onto a node it had
  // already created.
  const beforeCreateRefusal = await scratchChildCount();
  const createRefusal = await callExpectingRefusal("create_text", {
    x: 0,
    y: 240,
    text: "never created",
    parentId: scratchPageId,
    ...ALL_TWELVE,
    lineHeight: { value: 20, unit: "AUTO" },
  });
  const afterCreateRefusal = await scratchChildCount();
  // ⛔ A schema-layer refusal here would mean the handler never ran. Assert the layer, or
  // a future tightening of the Zod schema silently turns this check vacuous.
  assert.equal(
    createRefusal.layer,
    "handler",
    "the schema refused before dispatch, so this proves NOTHING about the handler's validation order",
  );
  record.checks.validateAllThenCreate = {
    layer: createRefusal.layer,
    message: createRefusal.message.slice(0, 300),
    childCountBefore: beforeCreateRefusal,
    childCountAfter: afterCreateRefusal,
    orphanCreated: afterCreateRefusal !== beforeCreateRefusal,
  };
  assert.equal(
    afterCreateRefusal,
    beforeCreateRefusal,
    "a refused create_text left a node on the page — F4 on the create surface",
  );

  // The schema layer, recorded as its own fact rather than folded into the one above:
  // both refusal shapes must keep arriving, and this one is evidence about Zod only.
  const schemaRefusal = await callExpectingRefusal("create_text", {
    x: 0,
    y: 240,
    text: "never created",
    parentId: scratchPageId,
    textAutoResize: "SOMETIMES",
  });
  record.checks.createSchemaRefusal = {
    layer: schemaRefusal.layer,
    message: schemaRefusal.message.slice(0, 200),
    childCountUnchanged: (await scratchChildCount()) === beforeCreateRefusal,
    provesAboutHandler: "nothing — the call never reached the plugin",
  };
  assert.equal(schemaRefusal.layer, "schema");
  assert.ok(record.checks.createSchemaRefusal.childCountUnchanged);

  // ── 8. ⛔ REFUSE, NEVER SUBSTITUTE, on the create surface ────────────────────────
  // Before this change the load failure was swallowed and the node was created in
  // whatever face Figma supplied — F2, on a tool nobody was watching.
  const beforeFontCreate = await scratchChildCount();
  const createFontRefusal = await callExpectingRefusal("create_text", {
    x: 0,
    y: 240,
    text: "never created",
    parentId: scratchPageId,
    fontFamily: "Ghostly Absent Family",
    fontStyle: "Regular",
  });
  const afterFontCreate = await scratchChildCount();
  assert.equal(
    createFontRefusal.layer,
    "handler",
    "an absent font must be refused by the plugin, not by the schema — the schema cannot know what this machine has installed",
  );
  record.checks.createRefusesUnloadableFont = {
    layer: createFontRefusal.layer,
    message: createFontRefusal.message.slice(0, 300),
    refusedRatherThanSubstituted: /refuses rather than substituting/.test(
      createFontRefusal.message,
    ),
    childCountBefore: beforeFontCreate,
    childCountAfter: afterFontCreate,
  };
  assert.equal(
    afterFontCreate,
    beforeFontCreate,
    "an unloadable font created a node anyway — the substitution path is back",
  );

  // ── 9. The two-ways-to-name-one-face refusal, and the default path ──────────────
  const collision = await callExpectingRefusal("create_text", {
    x: 0,
    y: 240,
    text: "never created",
    parentId: scratchPageId,
    fontWeight: 700,
    fontFamily: "Inter",
    fontStyle: "Bold",
  });
  const beforeDefaultCreate = await scratchChildCount();
  // ⛔ NO parentId — the path the un-awaited write hid on. It lands on the scratch page
  // because the scratch page is current, so cleanup still reaches it.
  const defaultCreate = await callEmbeddedJson("create_text", {
    x: 200,
    y: 120,
    text: "R2.6 default font",
    name: "gate-default",
  });
  const defaultRest = await restTypographyOf(defaultCreate.value.id);
  record.checks.legacyAndCollision = {
    collisionLayer: collision.layer,
    collisionRefused: /cannot be combined with fontFamily\/fontStyle/.test(collision.message),
    defaultFontSource: defaultCreate.value.fontSource,
    // ⭐ 14 is this tool's own R1-era default; a fresh Figma text node is 12. Reading 12
    // here would mean the default write had been quietly dropped.
    defaultFontSize: defaultRest.fontSize,
    defaultCharactersInReply: defaultCreate.value.characters,
    defaultCharactersInDocument: defaultRest.characters,
    limitations: defaultCreate.value.limitations,
    childCountAfter: await scratchChildCount(),
  };
  assert.equal(collision.layer, "handler", "the collision rule lives in the plugin, not the schema");
  assert.ok(record.checks.legacyAndCollision.collisionRefused);
  assert.equal(defaultCreate.value.fontSource, "default");
  assert.equal(defaultRest.fontSize, 14, "the R1-era fontSize default was not written");
  assert.equal(
    defaultCreate.value.characters,
    "R2.6 default font",
    "the reply reported characters the document does not have — the un-awaited write is back",
  );
  assert.equal(defaultRest.characters, "R2.6 default font");
  assert.equal(record.checks.legacyAndCollision.childCountAfter, beforeDefaultCreate + 1);

  record.stillOwed.push(
    "F3 reachability (Phase 1) is unchanged by this gate. The offline harness INJECTS a refused character write; nothing here can make real Figma refuse one on demand, so whether that branch is reachable in production is still unestablished. ⛔ `create_text`'s rollback-on-refused-write sits on the SAME branch and is equally unproven live.",
  );
  record.stillOwed.push(
    "`available` ≠ `loadable` (R2.5 Phase 2) did not reproduce on this machine and is not discharged by a green run here: every listed face loaded and every unlisted one refused.",
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
  process.stderr.write(`R2.5+2.6 typography live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.5+2.6 typography live gate PASSED\n");
