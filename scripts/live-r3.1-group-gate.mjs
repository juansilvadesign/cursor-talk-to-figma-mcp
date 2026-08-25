#!/usr/bin/env node

/**
 * R3.1 live gate — native group creation / ownership for a constraints measurement.
 *
 * This creates every fixture on an owned scratch page. It first proves that a duplicate
 * member request refuses without changing the frame, then groups two explicitly resolved
 * rectangles, keeps a third rectangle as an ungrouped control, and independently reads the
 * hierarchy and absolute bounds through get_node_info. Finally it asks set_constraints to
 * operate on the grouped child, proving the new group is usable as the intended owner.
 *
 * Run only against an owner-confirmed disposable Figma file:
 *   node scripts/live-r3.1-group-gate.mjs --channel=<DEV-plugin-channel> \
 *     --disposable-target=true [--output-dir=<dir>] [--server=<dist-server-path>]
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
  "Usage: node scripts/live-r3.1-group-gate.mjs --channel=<DEV-plugin-channel> --disposable-target=true [--output-dir=<dir>] [--server=<dist-server-path>]",
  "This gate creates a page, frame, rectangles, and a group before deleting the page in finally.",
);

// Derived from runtime-metadata.ts after the R3.1 generation. A matching pin makes this
// runner runnable; it is not evidence that the runner was executed on a live Figma file.
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
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3.1-group-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");
const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

function nodeFromInfo(value) {
  return value?.document ?? value;
}

function childIds(node) {
  return (node?.children ?? []).map((child) => child.id);
}

function bounds(node, label) {
  const box = node?.absoluteBoundingBox;
  for (const key of ["x", "y", "width", "height"]) {
    assert.equal(typeof box?.[key], "number", `${label} has no numeric ${key} bound`);
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

const record = {
  gate: "R3.1 create_group",
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
  name: "talk-to-figma-r3.1-group-gate",
  requiredCommands: [
    "create_group",
    "create_page",
    "set_current_page",
    "create_frame",
    "create_rectangle",
    "set_constraints",
    "get_node_info",
    "delete_node",
  ],
});

let scratchPageId = null;
let originalPageId = null;
let baselinePageIds = null;
let failure = null;

try {
  const { inventory, runtime } = await gate.connectAndAssert();
  const groupTool = inventory.tools.find((tool) => tool.name === "create_group");
  assert.ok(groupTool, "create_group is not in the published MCP inventory");
  assert.deepEqual(groupTool.inputSchema?.required ?? [], ["nodeIds", "parentId"]);
  assert.equal(groupTool.inputSchema?.properties?.nodeIds?.minItems, 1);
  assert.equal(groupTool.inputSchema?.properties?.nodeIds?.maxItems, 100);
  record.checks.publishedSurface = {
    required: groupTool.inputSchema?.required ?? [],
    resultStability: groupTool.resultStability ?? null,
    description: groupTool.description,
  };
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId ?? null,
    compatibility: runtime.compatibility.status,
  };

  const pagesBefore = (await gate.callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  baselinePageIds = (pagesBefore.pages ?? []).map((page) => page.id);
  record.checks.baseline = {
    pageCount: pagesBefore.pageCount ?? baselinePageIds.length,
    currentPageId: originalPageId,
    pageIds: baselinePageIds,
  };

  scratchPageId = await gate.callNodeId("create_page", {
    name: `__R3.1 group gate ${stamp}`,
  });
  await gate.call("set_current_page", { pageId: scratchPageId });

  const frameId = await gate.callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 500,
    height: 260,
    name: "__R3.1 group parent",
    parentId: scratchPageId,
  });
  const firstId = await gate.callNodeId("create_rectangle", {
    x: 20,
    y: 20,
    width: 80,
    height: 40,
    name: "__R3.1 grouped first",
    parentId: frameId,
  });
  const secondId = await gate.callNodeId("create_rectangle", {
    x: 180,
    y: 80,
    width: 100,
    height: 50,
    name: "__R3.1 grouped second",
    parentId: frameId,
  });
  const controlId = await gate.callNodeId("create_rectangle", {
    x: 360,
    y: 20,
    width: 60,
    height: 40,
    name: "__R3.1 ungrouped control",
    parentId: frameId,
  });

  const readNode = async (id) => nodeFromInfo((await gate.callJson("get_node_info", { nodeId: id })).value);
  const [firstBefore, secondBefore, frameBefore] = await Promise.all([
    readNode(firstId),
    readNode(secondId),
    readNode(frameId),
  ]);
  const firstBoundsBefore = bounds(firstBefore, "first before grouping");
  const secondBoundsBefore = bounds(secondBefore, "second before grouping");
  const childrenBefore = childIds(frameBefore);

  // Bad input is deliberate: if duplicate validation happens after grouping, the frame's
  // hierarchy is the side-effect channel that exposes it.
  const duplicateRefusal = await gate.callExpectingRefusal("create_group", {
    nodeIds: [firstId, firstId],
    parentId: frameId,
  });
  const frameAfterRefusal = await readNode(frameId);
  assert.deepEqual(childIds(frameAfterRefusal), childrenBefore);
  record.checks.duplicateRefusal = {
    ...duplicateRefusal,
    frameChildrenUnchanged: true,
  };

  const created = (await gate.callJson("create_group", {
    nodeIds: [firstId, secondId],
    parentId: frameId,
    index: 0,
  })).value;
  assert.equal(created.type, "GROUP");
  assert.equal(created.parentId, frameId);
  assert.deepEqual(created.memberIds, [firstId, secondId]);
  assert.equal(created.absoluteBoundsPreserved, true);

  // Independent hierarchy and geometry reads: neither comes from the create_group reply.
  const [groupAfter, frameAfter, firstAfter, secondAfter] = await Promise.all([
    readNode(created.id),
    readNode(frameId),
    readNode(firstId),
    readNode(secondId),
  ]);
  assert.equal(groupAfter.type, "GROUP");
  assert.deepEqual(childIds(groupAfter), [firstId, secondId]);
  assert.ok(childIds(frameAfter).includes(created.id), "group is absent from its explicit parent");
  assert.ok(childIds(frameAfter).includes(controlId), "ungrouped control moved into the group");
  assert.deepEqual(bounds(firstAfter, "first after grouping"), firstBoundsBefore);
  assert.deepEqual(bounds(secondAfter, "second after grouping"), secondBoundsBefore);

  // The new ownership boundary has the one consumer R3.1 needs: set_constraints receives
  // the grouped child and names the GROUP parent rather than silently treating it as page
  // content. Geometry resolution under a later resize remains the constraints gate's job.
  const constraints = (await gate.callJson("set_constraints", {
    nodeId: firstId,
    horizontal: "MAX",
  })).value;
  assert.equal(constraints.parentId, created.id);
  assert.equal(constraints.parentType, "GROUP");
  record.checks.groupOwnership = {
    receipt: created,
    independentHierarchy: {
      groupChildren: childIds(groupAfter),
      frameChildren: childIds(frameAfter),
      controlRemainedUngrouped: childIds(frameAfter).includes(controlId),
      firstBoundsBefore,
      firstBoundsAfter: bounds(firstAfter, "first after grouping"),
      secondBoundsBefore,
      secondBoundsAfter: bounds(secondAfter, "second after grouping"),
    },
    groupedConstraintReceipt: constraints,
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
process.stdout.write("R3.1 create_group live gate PASSED\n");
