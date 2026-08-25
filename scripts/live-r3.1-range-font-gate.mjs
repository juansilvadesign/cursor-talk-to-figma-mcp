#!/usr/bin/env node

/**
 * R3.1 live gate — exact range-font mutation.
 *
 * The gate creates two identical text nodes on an owned scratch page. It proves invalid
 * range and absent-font refusal before the mutation, writes Inter/Bold only over the first
 * five characters of the probe, and uses the existing node-scoped set_text_style receipt as
 * an independent mixed-font witness: the probe must be mixed while its untouched control is
 * not. The range tool's own direct before/after range read is retained alongside that
 * independent contrast.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  openR31Gate,
  parseGateOptions,
  requireDisposableTarget,
} from "./r3.1-live-gate-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseGateOptions();
requireDisposableTarget(
  options,
  "Usage: node scripts/live-r3.1-range-font-gate.mjs --channel=<DEV-plugin-channel> --disposable-target=true [--output-dir=<dir>] [--server=<dist-server-path>]",
  "This gate creates text nodes, changes one character range, and deletes its scratch page in finally.",
);

const expectedRuntime = {
  serverBuildId: "r3.1-server-beff31768985",
  pluginBuildId: "r3.1-plugin-ed16fbb94fa9",
  schemaVersion: "1.19.0",
  fingerprint:
    "sha256:69007c224212caf1cc29b96b65dd8ca55eb93ce5e66101ed96fa2d53302d576d",
  release: "R3.1",
  toolCount: 80,
};

const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3.1-range-font-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");
const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const text = "R3.1 range font gate";
const range = { start: 0, end: 5 };

const record = {
  gate: "R3.1 set_range_font",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  disposableTargetAcknowledged: true,
  artifactDirectory,
  expectedRuntime,
  checks: {},
  cleanup: null,
  success: false,
};

const gate = await openR31Gate({
  root,
  options,
  expectedRuntime,
  name: "talk-to-figma-r3.1-range-font-gate",
  requiredCommands: [
    "set_range_font",
    "set_text_style",
    "create_page",
    "set_current_page",
    "create_text",
    "get_pages",
    "delete_node",
  ],
});

let scratchPageId = null;
let originalPageId = null;
let baselinePageIds = null;
let failure = null;

try {
  const { inventory, runtime } = await gate.connectAndAssert();
  const rangeTool = inventory.tools.find((tool) => tool.name === "set_range_font");
  assert.ok(rangeTool, "set_range_font is not in the published MCP inventory");
  assert.deepEqual(rangeTool.inputSchema?.required ?? [], [
    "nodeId",
    "start",
    "end",
    "fontFamily",
    "fontStyle",
  ]);
  assert.equal(rangeTool.inputSchema?.properties?.start?.minimum, 0);
  assert.equal(rangeTool.inputSchema?.properties?.end?.minimum, 0);
  record.checks.publishedSurface = {
    required: rangeTool.inputSchema?.required ?? [],
    resultStability: rangeTool.resultStability ?? null,
    description: rangeTool.description,
  };
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId ?? null,
    compatibility: runtime.compatibility.status,
  };

  const pagesBefore = (await gate.callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  baselinePageIds = (pagesBefore.pages ?? []).map((page) => page.id);
  scratchPageId = await gate.callNodeId("create_page", {
    name: `__R3.1 range font gate ${stamp}`,
  });
  await gate.call("set_current_page", { pageId: scratchPageId });

  const targetId = await gate.callNodeId("create_text", {
    x: 0,
    y: 0,
    text,
    name: "__R3.1 range target",
    parentId: scratchPageId,
    fontFamily: "Inter",
    fontStyle: "Regular",
  });
  const controlId = await gate.callNodeId("create_text", {
    x: 0,
    y: 80,
    text,
    name: "__R3.1 range control",
    parentId: scratchPageId,
    fontFamily: "Inter",
    fontStyle: "Regular",
  });

  // These refusal attempts happen before any intentional range mutation. The existing
  // node-scoped witness immediately afterwards must still see a non-mixed node.
  const invalidRange = await gate.callExpectingRefusal("set_range_font", {
    nodeId: targetId,
    start: range.end,
    end: range.end,
    fontFamily: "Inter",
    fontStyle: "Bold",
  });
  const absentFont = await gate.callExpectingRefusal("set_range_font", {
    nodeId: targetId,
    ...range,
    fontFamily: "Ghostly Absent Family",
    fontStyle: "Regular",
  });
  const beforeWitness = (await gate.callJson("set_text_style", {
    nodeId: targetId,
    textAlignHorizontal: "LEFT",
  })).value;
  assert.equal(beforeWitness.wasMixed, false, "a refused range call changed the target font runs");
  assert.notEqual(beforeWitness.before?.fontName, "MIXED");
  record.checks.refusals = {
    invalidRange,
    absentFont,
    nodeScopedWitnessAfterRefusals: beforeWitness,
  };

  const rangeReceipt = (await gate.callJson("set_range_font", {
    nodeId: targetId,
    ...range,
    fontFamily: "Inter",
    fontStyle: "Bold",
  })).value;
  assert.deepEqual(rangeReceipt.before?.font, { family: "Inter", style: "Regular" });
  assert.deepEqual(rangeReceipt.after?.font, { family: "Inter", style: "Bold" });
  assert.equal(rangeReceipt.readbackMatchesRequested, true);

  // This is a separate existing operation and a contrast control, not a second reading of
  // the range receipt. It proves that a partial range write created mixed node state and
  // that an otherwise identical untouched node did not become mixed by collateral effect.
  const [targetWitness, controlWitness] = await Promise.all([
    gate.callJson("set_text_style", {
      nodeId: targetId,
      textAlignHorizontal: "LEFT",
    }),
    gate.callJson("set_text_style", {
      nodeId: controlId,
      textAlignHorizontal: "LEFT",
    }),
  ]);
  assert.equal(targetWitness.value.wasMixed, true, "range target was not mixed after a partial font write");
  assert.equal(targetWitness.value.before?.fontName, "MIXED");
  assert.equal(controlWitness.value.wasMixed, false, "untouched control became mixed");
  assert.notEqual(controlWitness.value.before?.fontName, "MIXED");
  record.checks.rangeMutation = {
    receipt: rangeReceipt,
    independentMixedWitness: targetWitness.value,
    untouchedControlWitness: controlWitness.value,
  };
  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  if (scratchPageId) {
    try {
      if (originalPageId) await gate.call("set_current_page", { pageId: originalPageId });
      await gate.call("delete_node", { nodeId: scratchPageId });
      const pagesAfter = (await gate.callJson("get_pages")).value;
      record.cleanup = {
        deletedScratchPageId: scratchPageId,
        baselineRestored:
          JSON.stringify((pagesAfter.pages ?? []).map((page) => page.id)) ===
            JSON.stringify(baselinePageIds) &&
          pagesAfter.currentPageId === originalPageId,
      };
      assert.equal(record.cleanup.baselineRestored, true, "scratch-page cleanup did not restore the page baseline");
    } catch (cleanupError) {
      record.cleanup = {
        deletedScratchPageId: scratchPageId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      };
      if (!failure) failure = cleanupError;
    }
  }
  await gate.close();
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  process.stderr.write(`report: ${reportPath}\n`);
}

if (failure) throw failure;
process.stdout.write("R3.1 set_range_font live gate PASSED\n");
