#!/usr/bin/env node

/**
 * R2.5 — the typography live gate.
 *
 * What this proves that the 169 offline tests cannot: that `set_text_style`'s
 * validate-all-then-write guarantee holds when the judge is **real Figma** rather than a
 * fixture. Offline, the harness decides which fonts refuse to load and which assignments
 * throw; here Figma decides, and the question is whether the document is still untouched
 * afterwards.
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

// ⛔ Pinned for R2.5 Phase 3. BOTH halves moved — `set_text_style` is a new tool, so the
// plugin's command list and the server's capability IDs both changed, which moves the
// fingerprint too. On this step every pin would catch a stale build; that is luck, not a
// property. R2.4 moved the server twice with schema, tool count AND fingerprint all
// holding still, so `serverBuildId` remains the only pin that fails on every stale
// build, and CC4 requires it regardless of what the others happen to catch this time.
const expectedRuntime = {
  serverBuildId: "r2-server-a30e91f4f88e",
  pluginBuildId: "r2-plugin-0bc82334ff83",
  schemaVersion: "1.7.0",
  fingerprint:
    "sha256:05ac28c502317e859f0cb20934397764519d4c44d57aa31cdfef703663734d42",
  toolCount: 56,
};

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const scratchPageName = `R2.5 typography gate ${new Date().toISOString()}`;
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2.5-live-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r2.5-text-style-gate",
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
 * The eleven writable typography properties, read back off the LIVE node. The gate
 * compares this whole object across a refusal; anything that moved is a partial write.
 */
const WRITABLE = [
  "fontName",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "textCase",
  "textDecoration",
  "textAlignHorizontal",
  "textAlignVertical",
  "paragraphSpacing",
  "paragraphIndent",
  "textAutoResize",
];

async function typographyOf(nodeId) {
  const info = await callJson("get_node_info", { nodeId });
  const node = info.value?.document ?? info.value;
  const out = {};
  for (const key of WRITABLE) out[key] = node?.[key] ?? null;
  return out;
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

  // ⭐ Detect a mixed-font node WITHOUT writing to it. The fork ships no range-font
  // setter, so a mixed node cannot be authored by these tools — if the document has
  // none, the unification path stays fixture-only and is recorded as owed rather than
  // faked. If one exists it is CLONED onto the scratch page and the clone is unified;
  // the original is never touched.
  let mixedSourceId = null;
  try {
    const scan = (await callJson("scan_text_nodes", {
      nodeId: originalPageId,
      useChunking: true,
      chunkSize: 50,
    })).value;
    const candidates = (scan.textNodes ?? scan.nodes ?? []).filter(
      (node) => node.fontName === "MIXED" || node.fontName === null,
    );
    mixedSourceId = candidates[0]?.id ?? null;
    record.checks.mixedNodeSearch = {
      scanned: (scan.textNodes ?? scan.nodes ?? []).length,
      found: Boolean(mixedSourceId),
    };
  } catch (scanError) {
    record.checks.mixedNodeSearch = { error: String(scanError.message ?? scanError) };
  }

  const page = (await callEmbeddedJson("create_page", { name: scratchPageName })).value;
  scratchPageId = page.id;
  await call("set_current_page", { pageId: scratchPageId });

  const target = (
    await callEmbeddedJson("create_text", {
      x: 0,
      y: 0,
      text: "R2.5 typography gate",
      name: "gate-target",
      parentId: scratchPageId,
    })
  ).value;
  const targetId = target.id;

  // ── 1. The happy path: all twelve fields, read back off the document ─────────────
  const applied = (await callJson("set_text_style", { nodeId: targetId, ...ALL_TWELVE })).value;
  const afterWrite = await typographyOf(targetId);
  record.checks.appliedAllTwelve = {
    appliedFieldCount: applied.appliedFieldCount,
    fontSubstituted: applied.fontSubstituted,
    wasMixed: applied.wasMixed,
    readBack: afterWrite,
  };
  assert.equal(applied.appliedFieldCount, 12);
  assert.equal(applied.fontSubstituted, false, "fontSubstituted must be a present false");
  assert.equal(afterWrite.fontSize, 32, "Figma did not take the size");
  assert.equal(afterWrite.textCase, "UPPER");
  assert.equal(afterWrite.textAlignHorizontal, "CENTER");
  assert.deepEqual(afterWrite.fontName, { family: "Inter", style: "Bold" });

  // ── 2. ⛔ VALIDATE-ALL-THEN-WRITE, with Figma as the judge ───────────────────────
  // Eleven valid parameters and one bad enum, the bad one LAST. A validate-as-you-go
  // implementation writes the eleven and then throws — which is F4, and which a
  // throw-only assertion could not tell apart from a clean refusal.
  const beforeRefusal = await typographyOf(targetId);
  const refusal = await callExpectingRefusal("set_text_style", {
    nodeId: targetId,
    ...ALL_TWELVE,
    fontSize: 64,
    textCase: "LOWER",
    textAutoResize: "SOMETIMES",
  });
  const afterRefusal = await typographyOf(targetId);
  record.checks.validateAllThenWrite = {
    layer: refusal.layer,
    message: refusal.message.slice(0, 300),
    documentUnchanged: JSON.stringify(beforeRefusal) === JSON.stringify(afterRefusal),
    before: beforeRefusal,
    after: afterRefusal,
  };
  assert.ok(
    record.checks.validateAllThenWrite.documentUnchanged,
    "a refused call MUTATED the document — this is F4, live",
  );

  // ── 3. ⛔ REFUSE, NEVER SUBSTITUTE, with Figma as the judge ──────────────────────
  const beforeFontRefusal = await typographyOf(targetId);
  const fontRefusal = await callExpectingRefusal("set_text_style", {
    nodeId: targetId,
    fontFamily: "Ghostly Absent Family",
    fontStyle: "Regular",
    fontSize: 11,
  });
  const afterFontRefusal = await typographyOf(targetId);
  record.checks.refuseNeverSubstitute = {
    layer: fontRefusal.layer,
    message: fontRefusal.message.slice(0, 300),
    documentUnchanged:
      JSON.stringify(beforeFontRefusal) === JSON.stringify(afterFontRefusal),
    // ⭐ The distinguishing fact. `setCharacters` answers a refused load by loading Inter
    // and retyping the node; if this tool ever grew that path the font would be
    // Inter/Regular here rather than the Inter/Bold the happy path left behind.
    fontAfter: afterFontRefusal.fontName,
    sizeAfter: afterFontRefusal.fontSize,
  };
  assert.ok(
    record.checks.refuseNeverSubstitute.documentUnchanged,
    "an unloadable font MUTATED the document",
  );
  assert.equal(afterFontRefusal.fontSize, 32, "the size was written despite the refusal");

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
    const clone = (await callEmbeddedJson("clone_node", { nodeId: mixedSourceId })).value;
    await call("set_parent", { nodeId: clone.id, parentId: scratchPageId });
    const unified = (
      await callJson("set_text_style", {
        nodeId: clone.id,
        fontFamily: "Inter",
        fontStyle: "Regular",
      })
    ).value;
    record.checks.mixedUnification = {
      source: mixedSourceId,
      clone: clone.id,
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
      "Mixed-font unification (3.3) stays FIXTURE-ONLY. The fork ships no range-font setter, so a mixed node cannot be authored by these tools, and this document contains none to clone. `wasMixed: true` and the \"MIXED\" sentinel are proven offline and unproven live.",
    );
  }

  record.stillOwed.push(
    "F3 reachability (Phase 1) is unchanged by this gate. The offline harness INJECTS a refused character write; nothing here can make real Figma refuse one on demand, so whether that branch is reachable in production is still unestablished.",
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
  process.stderr.write(`R2.5 typography live gate FAILED: ${failure.message}\n`);
  process.exit(1);
}
process.stdout.write("R2.5 typography live gate PASSED\n");
