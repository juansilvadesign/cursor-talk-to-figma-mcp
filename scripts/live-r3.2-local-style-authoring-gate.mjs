#!/usr/bin/env node

/**
 * R3.2 live gate — local-style authoring.
 *
 * This is intentionally a pending, executable acceptance gate rather than evidence of a
 * completed run. It may only run on an owner-confirmed disposable Figma file. It records a
 * full four-kind local-style and page baseline, owns every created style by an opaque
 * private marker, detaches every recorded scratch consumer, deletes every owned style,
 * deletes the scratch page, then opens a separate MCP client session to compare the final
 * baseline. There is no allow-permanent escape hatch.
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
  "Usage: node scripts/live-r3.2-local-style-authoring-gate.mjs --channel=<DEV-plugin-channel> --disposable-target=true --remote-style-id=<known-remote-paint-style-id> [--output-dir=<dir>] [--server=<dist-server-path>]",
  "This gate creates local styles, attaches them to scratch nodes, changes an effect, and deletes every owned style and its scratch page in finally.",
);
if (options["allow-permanent"] !== undefined) {
  process.stderr.write(
    "Refusing to run: R3.2 local-style cleanup has no allow-permanent mode. Use an owner-confirmed disposable Figma file.\n",
  );
  process.exit(2);
}
const remoteStyleId =
  typeof options["remote-style-id"] === "string" && options["remote-style-id"].length > 0
    ? options["remote-style-id"]
    : null;
if (!remoteStyleId) {
  process.stderr.write(
    "Refusing to run: R3.2 acceptance requires --remote-style-id for a real remote paint-style control. Do not substitute a local ID or report remote refusal as passed without a measured control.\n",
  );
  process.exit(2);
}

// Derived from runtime-metadata.ts after generation. A current pin makes this gate
// runnable; it does not claim this file was exercised against a live Figma document.
const expectedRuntime = {
  serverBuildId: "r3.2-server-c08e691bdcdc",
  pluginBuildId: "r3.2-plugin-98129b15fafd",
  schemaVersion: "1.20.0",
  fingerprint:
    "sha256:296fa709483c626473de84688cbeec970ad90cce22b6ce9c80f9f845bff5ca51",
  release: "R3.2",
  toolCount: 86,
};

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3.2-local-styles-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

const styleKinds = ["paint", "text", "effect", "grid"];
const styleBucketForKind = {
  paint: "colors",
  text: "texts",
  effect: "effects",
  grid: "grids",
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function pageBaseline(payload) {
  return canonical({
    currentPageId: payload.currentPageId ?? null,
    pages: (payload.pages ?? []).map((page) => ({
      id: page.id,
      name: page.name ?? null,
      childCount: page.childCount ?? null,
    })),
  });
}

function styleCreatePayload(kind) {
  if (kind === "paint") {
    return {
      paints: [
        { type: "SOLID", color: { r: 0.16, g: 0.42, b: 0.76, a: 0.9 } },
      ],
    };
  }
  if (kind === "text") {
    return {
      text: {
        fontFamily: "Inter",
        fontStyle: "Regular",
        fontSize: 18,
        lineHeight: { value: 24, unit: "PIXELS" },
      },
    };
  }
  if (kind === "effect") {
    return {
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          offset: { x: 0, y: 2 },
          radius: 4,
        },
      ],
    };
  }
  return {
    layoutGrids: [
      {
        pattern: "COLUMNS",
        alignment: "STRETCH",
        gutterSize: 24,
        count: 12,
        sectionSize: 72,
        visible: true,
      },
    ],
  };
}

function styleUpdatePayload(kind) {
  if (kind === "paint") {
    return {
      paints: [
        { type: "SOLID", color: { r: 0.8, g: 0.28, b: 0.18, a: 0.85 } },
      ],
    };
  }
  if (kind === "text") return { text: { fontSize: 19 } };
  if (kind === "effect") {
    return {
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.28 },
          offset: { x: 0, y: 3 },
          radius: 6,
        },
      ],
    };
  }
  return {
    layoutGrids: [
      {
        pattern: "COLUMNS",
        alignment: "STRETCH",
        gutterSize: 20,
        count: 12,
        sectionSize: 72,
        visible: true,
      },
    ],
  };
}

const record = {
  gate: "R3.2 local-style authoring",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  disposableTargetAcknowledged: true,
  liveAcceptance: "pending-until-this-gate-passes-with-a-real-remote-control-on-a-disposable-file",
  artifactDirectory,
  expectedRuntime,
  checks: {},
  cleanup: [],
  success: false,
};

const gate = await openR31Gate({
  root,
  options,
  expectedRuntime,
  name: "talk-to-figma-r3.2-local-style-authoring-gate",
  requiredCommands: [
    "get_styles",
    "get_local_style",
    "create_or_match_local_style",
    "update_local_style",
    "get_node_style_attachment",
    "set_local_style_attachment",
    "delete_local_style",
    "create_page",
    "set_current_page",
    "create_frame",
    "create_rectangle",
    "create_text",
    "set_effects",
    "get_pages",
    "delete_node",
  ],
});

let baseline = null;
let scratchPageId = null;
let originalPageId = null;
let primaryGateClosed = false;
let failure = null;
const createdStyles = [];
const attachments = [];

async function readFullBaseline(activeGate) {
  const [pages, styles] = await Promise.all([
    activeGate.callJson("get_pages"),
    activeGate.callJson("get_styles"),
  ]);
  const localStyles = [];
  for (const kind of styleKinds) {
    const bucket = styles.value[styleBucketForKind[kind]];
    for (const style of Array.isArray(bucket) ? bucket : []) {
      const read = await activeGate.callJson("get_local_style", {
        kind,
        styleId: style.id,
        includeConsumers: true,
      });
      assert.equal(read.value.success, true, `baseline style ${style.id} was not readable`);
      localStyles.push(read.value.style);
    }
  }
  return canonical({ pages: pageBaseline(pages.value), localStyles });
}

async function createOwnedStyle(kind) {
  const identityKey = `r3.2-live/${stamp}/${kind}`;
  const result = (await gate.callJson("create_or_match_local_style", {
    kind,
    name: `__R3.2 ${kind} ${stamp}`,
    identityKey,
    ...styleCreatePayload(kind),
  })).value;
  assert.equal(result.success, true, `${kind} style create refused: ${JSON.stringify(result)}`);
  assert.equal(result.action, "created", `${kind} style unexpectedly matched pre-existing data`);
  assert.equal(result.outcome, "confirmed");
  assert.equal(result.style?.identityStatus, "present");
  assert.equal(JSON.stringify(result).includes(identityKey), false, "private identity leaked into receipt");
  const owned = { kind, styleId: result.style.styleId, identityKey };
  createdStyles.push(owned);
  return owned;
}

async function attachAndRead(input) {
  const result = (await gate.callJson("set_local_style_attachment", input)).value;
  assert.equal(result.success, true, `attachment refused: ${JSON.stringify(result)}`);
  assert.equal(result.outcome, "confirmed");
  assert.equal(result.after?.styleId, input.styleId);
  attachments.push(input);
  const direct = (await gate.callJson("get_node_style_attachment", input)).value;
  assert.equal(direct.success, true);
  assert.equal(direct.attachment?.styleId, input.styleId);
  assert.equal(direct.attachment?.origin, "local");
  return { receipt: result, direct };
}

async function cleanupOwnedResources() {
  if (!scratchPageId) return;

  for (const attachment of [...attachments].reverse()) {
    try {
      const cleared = (await gate.callJson("set_local_style_attachment", {
        nodeId: attachment.nodeId,
        kind: attachment.kind,
        paintTarget: attachment.paintTarget,
        styleId: null,
      })).value;
      record.cleanup.push({
        step: "detach",
        nodeId: attachment.nodeId,
        kind: attachment.kind,
        paintTarget: attachment.paintTarget ?? null,
        outcome: cleared.outcome ?? null,
        styleIdAfter: cleared.after?.styleId ?? null,
      });
      assert.equal(cleared.success, true, `cleanup detach refused: ${JSON.stringify(cleared)}`);
      assert.equal(cleared.after?.styleId, null);
    } catch (error) {
      record.cleanup.push({
        step: "detach",
        nodeId: attachment.nodeId,
        kind: attachment.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  for (const style of [...createdStyles].reverse()) {
    try {
      const removed = (await gate.callJson("delete_local_style", {
        kind: style.kind,
        styleId: style.styleId,
        identityKey: style.identityKey,
        confirm: true,
      })).value;
      record.cleanup.push({
        step: "delete-style",
        kind: style.kind,
        styleId: style.styleId,
        removal: removed.removal ?? null,
      });
      assert.equal(removed.success, true, `cleanup style delete refused: ${JSON.stringify(removed)}`);
      assert.equal(removed.removal, "removed");
    } catch (error) {
      record.cleanup.push({
        step: "delete-style",
        kind: style.kind,
        styleId: style.styleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  if (originalPageId) await gate.call("set_current_page", { pageId: originalPageId });
  await gate.call("delete_node", { nodeId: scratchPageId });
  record.cleanup.push({ step: "delete-scratch-page", scratchPageId });
}

try {
  const { inventory, runtime } = await gate.connectAndAssert();
  const expectedTools = [
    "get_local_style",
    "create_or_match_local_style",
    "update_local_style",
    "get_node_style_attachment",
    "set_local_style_attachment",
    "delete_local_style",
  ];
  for (const name of expectedTools) {
    const tool = inventory.tools.find((entry) => entry.name === name);
    assert.ok(tool, `${name} is missing from the published MCP surface`);
    assert.equal(tool.resultStability, "additive-preview");
  }
  const deleteTool = inventory.tools.find((entry) => entry.name === "delete_local_style");
  assert.deepEqual(deleteTool.inputSchema?.required ?? [], ["kind", "styleId", "identityKey", "confirm"]);
  assert.equal(deleteTool.inputSchema?.properties?.confirm?.const, true);
  record.checks.publishedSurface = {
    toolCount: inventory.tools.length,
    tools: expectedTools,
    deleteRequired: deleteTool.inputSchema?.required ?? [],
  };
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId ?? null,
    release: runtime.server.release,
    compatibility: runtime.compatibility.status,
  };

  baseline = await readFullBaseline(gate);
  record.checks.baseline = baseline;
  originalPageId = baseline.pages.currentPageId;

  scratchPageId = await gate.callNodeId("create_page", {
    name: `__R3.2 local-style gate ${stamp}`,
  });
  await gate.call("set_current_page", { pageId: scratchPageId });
  const frameId = await gate.callNodeId("create_frame", {
    parentId: scratchPageId,
    name: "__R3.2 style frame",
    x: 0,
    y: 0,
    width: 480,
    height: 260,
  });
  const paintNodeId = await gate.callNodeId("create_rectangle", {
    parentId: frameId,
    name: "__R3.2 paint target",
    x: 24,
    y: 24,
    width: 120,
    height: 80,
  });
  const textNodeId = await gate.callNodeId("create_text", {
    parentId: frameId,
    name: "__R3.2 text target",
    x: 24,
    y: 144,
    text: "R3.2 local style",
    fontFamily: "Inter",
    fontStyle: "Regular",
  });

  const owned = {};
  for (const kind of styleKinds) owned[kind] = await createOwnedStyle(kind);

  // The two negative controls prove the local inventory is an authorization boundary.
  // A text ID cannot be used as paint, and an unknown ID cannot fall through to a native
  // setter. Both are checked before any successful paint attachment.
  const wrongKind = (await gate.callJson("set_local_style_attachment", {
    nodeId: paintNodeId,
    kind: "paint",
    styleId: owned.text.styleId,
  })).value;
  assert.equal(wrongKind.success, false);
  assert.equal(wrongKind.refusal?.code, "style_kind_mismatch");
  const unknown = (await gate.callJson("set_local_style_attachment", {
    nodeId: paintNodeId,
    kind: "paint",
    styleId: `__missing_r3_2_local_paint_${stamp}`,
  })).value;
  assert.equal(unknown.success, false);
  assert.equal(unknown.refusal?.code, "not_exact_local_style");
  record.checks.localBoundary = { wrongKind, unknown };

  const beforeRemoteAttachment = (await gate.callJson("get_node_style_attachment", {
    nodeId: paintNodeId,
    kind: "paint",
  })).value;
  const remoteRead = (await gate.callJson("get_local_style", {
    kind: "paint",
    styleId: remoteStyleId,
  })).value;
  const remoteUpdate = (await gate.callJson("update_local_style", {
    kind: "paint",
    styleId: remoteStyleId,
    identityKey: `r3.2-remote-control/${stamp}`,
    ...styleUpdatePayload("paint"),
  })).value;
  const remoteDelete = (await gate.callJson("delete_local_style", {
    kind: "paint",
    styleId: remoteStyleId,
    identityKey: `r3.2-remote-control/${stamp}`,
    confirm: true,
  })).value;
  const remoteAttachment = (await gate.callJson("set_local_style_attachment", {
    nodeId: paintNodeId,
    kind: "paint",
    styleId: remoteStyleId,
  })).value;
  const afterRemoteAttachment = (await gate.callJson("get_node_style_attachment", {
    nodeId: paintNodeId,
    kind: "paint",
  })).value;
  for (const [operation, result] of Object.entries({
    read: remoteRead,
    update: remoteUpdate,
    delete: remoteDelete,
    attachment: remoteAttachment,
  })) {
    assert.equal(result.success, false, `remote ${operation} unexpectedly succeeded`);
    assert.equal(result.refusal?.code, "remote_style_refused", `remote ${operation} used the wrong refusal`);
  }
  assert.deepEqual(
    afterRemoteAttachment.attachment,
    beforeRemoteAttachment.attachment,
    "remote refusal changed the node attachment",
  );
  record.checks.remoteRefusal = {
    status: "measured",
    beforeAttachment: beforeRemoteAttachment,
    read: remoteRead,
    update: remoteUpdate,
    delete: remoteDelete,
    attachment: remoteAttachment,
    afterAttachment: afterRemoteAttachment,
  };

  const attachmentsObserved = {
    paintFill: await attachAndRead({ nodeId: paintNodeId, kind: "paint", styleId: owned.paint.styleId }),
    paintStroke: await attachAndRead({ nodeId: paintNodeId, kind: "paint", paintTarget: "stroke", styleId: owned.paint.styleId }),
    text: await attachAndRead({ nodeId: textNodeId, kind: "text", styleId: owned.text.styleId }),
    effect: await attachAndRead({ nodeId: frameId, kind: "effect", styleId: owned.effect.styleId }),
    grid: await attachAndRead({ nodeId: frameId, kind: "grid", styleId: owned.grid.styleId }),
  };
  record.checks.attachments = attachmentsObserved;

  const effectWrite = (await gate.callJson("set_effects", {
    nodeId: frameId,
    effects: [
      {
        type: "DROP_SHADOW",
        color: { r: 0, g: 0, b: 0, a: 0.2 },
        offset: { x: 0, y: 2 },
        radius: 4,
      },
    ],
  })).value;
  assert.equal(effectWrite.styleIdBefore, owned.effect.styleId);
  record.checks.effectDetachObservation = effectWrite;

  const updates = {};
  for (const kind of styleKinds) {
    const update = (await gate.callJson("update_local_style", {
      kind,
      styleId: owned[kind].styleId,
      identityKey: owned[kind].identityKey,
      ...styleUpdatePayload(kind),
    })).value;
    assert.equal(update.success, true, `${kind} style update refused: ${JSON.stringify(update)}`);
    assert.equal(update.outcome, "confirmed");
    const after = (await gate.callJson("get_local_style", {
      kind,
      styleId: owned[kind].styleId,
      includeConsumers: true,
    })).value;
    assert.equal(after.success, true);
    assert.equal(after.style?.identityStatus, "present");
    updates[kind] = { update, after };
  }
  record.checks.updates = updates;

  const protectedDelete = (await gate.callJson("delete_local_style", {
    kind: "paint",
    styleId: owned.paint.styleId,
    identityKey: owned.paint.identityKey,
    confirm: true,
  })).value;
  assert.equal(protectedDelete.success, false);
  assert.equal(protectedDelete.refusal?.code, "style_has_consumers");
  record.checks.consumerProtectedDelete = protectedDelete;

  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  try {
    await cleanupOwnedResources();
  } catch (cleanupError) {
    if (!failure) failure = cleanupError;
    record.success = false;
    record.cleanupFailure = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }

  await gate.close();
  primaryGateClosed = true;

  if (baseline) {
    let verifier = null;
    try {
      // A fresh server/client session is deliberately used for the final baseline read. It
      // cannot reuse in-process style objects or a stale handler result from the mutating
      // session, which is the independent-cleanup observation R3.2 requires.
      verifier = await openR31Gate({
        root,
        options,
        expectedRuntime,
        name: "talk-to-figma-r3.2-local-style-authoring-verifier",
        requiredCommands: ["get_pages", "get_styles", "get_local_style"],
      });
      await verifier.connectAndAssert();
      const after = await readFullBaseline(verifier);
      record.cleanup.push({
        step: "independent-baseline-read",
        restored: JSON.stringify(after) === JSON.stringify(baseline),
      });
      assert.deepEqual(after, baseline, "independent client did not observe the exact pre-run baseline");
    } catch (verificationError) {
      if (!failure) failure = verificationError;
      record.success = false;
      record.verificationFailure = verificationError instanceof Error
        ? verificationError.message
        : String(verificationError);
    } finally {
      await verifier?.close();
    }
  }

  record.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  if (!primaryGateClosed) await gate.close();
  process.stderr.write(`report: ${reportPath}\n`);
}

if (failure) throw failure;
if (!record.success) {
  throw new Error("R3.2 local-style authoring gate completed without a success verdict");
}
process.stdout.write("R3.2 local-style authoring live gate PASSED\n");
