#!/usr/bin/env node

/**
 * R3-A Phase 2 — live gate for the rest of the plan table: `create_variable_collection`,
 * `rename_variable_mode`, `set_variable_metadata`, `bind_variable_to_node` and
 * `bind_variable_to_paint`.
 *
 * ⛔ Run ONLY on a disposable Figma file. This gate adds a mode, creates and deletes
 * variables, and creates and deletes a scratch page. A channel is transport, not evidence
 * that its document is safe.
 *
 *   node scripts/live-variable-collections-bindings-gate.mjs \
 *     --channel=<DEV-plugin-channel-for-a-disposable-file> \
 *     --collection-id=<local-collection-with-ROOM-FOR-ONE-MORE-MODE> \
 *     --disposable-target=true \
 *     [--allow-permanent-collection=true]
 *
 * ⛔ WHY `--allow-permanent-collection` IS A SEPARATE ACKNOWLEDGEMENT, AND NOT A FLAG THIS
 * GATE SETS FOR ITSELF. This fork ships NO tool that deletes a variable collection. Every
 * other resource this gate creates — the probe mode, the probe variables, the scratch page —
 * is removed by a fork tool at the end, which is what makes the gate rerunnable. A created
 * COLLECTION cannot be, so each run of that leg leaves one behind permanently, removable
 * only by hand in Figma's UI. That is the Phase 1.3 residue hazard one level up and strictly
 * worse, so the create legs stay opt-in and the debris is reported in `stillOwed` rather than
 * discovered later. Without the flag the collection legs are SKIPPED, not faked.
 *
 * ⭐ THE MEASUREMENT THIS GATE EXISTS FOR: nothing Figma documents says whether a
 * `renameMode()` becomes visible from inside the calling frame. The offline harness refuses
 * to assume — its default models "no in-frame signal" — so `rename_variable_mode` ships with
 * a `rename_unconfirmed` branch that may be the ONLY branch reachable live, exactly as
 * `delete_variable`'s success branch once was. This gate records which signal actually fired.
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

for (const option of ["channel", "collection-id"]) {
  if (!options[option]) {
    process.stderr.write(
      "Usage: node scripts/live-variable-collections-bindings-gate.mjs --channel=<DEV-plugin-channel-for-a-disposable-file> --collection-id=<local-collection-id-with-mode-headroom> --disposable-target=true [--allow-permanent-collection=true] [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
    );
    process.exit(2);
  }
}
if (options["disposable-target"] !== "true") {
  process.stderr.write(
    "Refusing to run: pass --disposable-target=true only after the channel is connected to a disposable Figma file. This gate adds a mode, creates and deletes variables, and creates and deletes a page.\n",
  );
  process.exit(2);
}
const allowPermanentCollection = options["allow-permanent-collection"] === "true";

// Derived from runtime-metadata.ts after the R3-A Phase 2 collections/bindings generation.
// Do not re-pin this script without a fresh run on a disposable target — a source edit is
// not live evidence.
const expectedRuntime = {
  serverBuildId: "r3-a-server-ee635141d2de",
  pluginBuildId: "r3-a-plugin-fc619cfa8b1f",
  schemaVersion: "1.15.0",
  fingerprint:
    "sha256:5e6dcb91bd57c355bd6a2c3e9bb58cf393d6c01bca1d8cb847e69a4d9fee1af3",
  toolCount: 76,
};

const NEW_COMMANDS = Object.freeze([
  "create_variable_collection",
  "rename_variable_mode",
  "set_variable_metadata",
  "bind_variable_to_node",
  "bind_variable_to_paint",
]);

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const probeModeName = `__R3A CB Mode ${stamp}`;
const probeModeRenamed = `__R3A CB Mode Renamed ${stamp}`;
const probeCollectionName = `__R3A CB Collection ${stamp}`;
const probeFloatName = `__R3A CB Float ${stamp}`;
const probeColorName = `__R3A CB Color ${stamp}`;
const scratchPageName = `R3-A CB gate ${new Date().toISOString()}`;
const opaqueIdentity = `  caller://r3a-cb/${stamp} — do not normalize  `;

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3a-collections-bindings-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r3a-collections-bindings-gate",
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

async function joinWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      return await call("join_channel", { channel: options.channel });
    } catch (error) {
      lastError = error;
      const message =
        error && typeof error.message === "string" ? error.message : String(error);
      if (!/Not connected to Figma/.test(message) || attempt === 10) throw error;
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
    "plugin build is stale — reload the DEV plugin before this gate",
  );
  assert.equal(runtime.plugin?.apiVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.plugin?.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.compatibility.status, "compatible");
  assert.deepEqual(runtime.compatibility.issues, []);
  for (const command of NEW_COMMANDS) {
    assert.ok(
      runtime.plugin?.supportedCommands.includes(command),
      `plugin lacks ${command} — reload the DEV plugin`,
    );
  }
}

/**
 * A FRESH read on a later call — the cross-frame instrument every `*_unconfirmed` receipt
 * asks the caller to run. Narrowed to one variable type for the same reason the Phase 4
 * gate narrows it: `collection.modes` is built unconditionally, and the type filter only
 * shrinks a per-mode payload nothing here reads.
 */
async function readCollection(collectionId) {
  const snapshot = (await callJson("get_variables", { types: ["BOOLEAN"] })).value;
  return (
    (snapshot.collections || []).find((collection) => collection.id === collectionId) ||
    null
  );
}

async function readCollectionNames() {
  const snapshot = (await callJson("get_variables", { types: ["BOOLEAN"] })).value;
  return (snapshot.collections || []).map((collection) => collection.name);
}

function findMode(collection, predicate) {
  return (collection?.modes || []).find(predicate) || null;
}

/** The independent read channel for a binding: a different command, in a later frame. */
async function readNodeBindings(nodeId) {
  const snapshot = (await callJson("get_node_variables", { nodeId })).value;
  const records = [];
  for (const entry of snapshot.nodes || []) {
    for (const binding of entry.variables || entry.bindings || []) {
      records.push({ nodeId: entry.id ?? nodeId, ...binding });
    }
  }
  return { snapshot, records };
}

const record = {
  gate: "R3-A Phase 2 variable collections and bindings",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  collectionId: options["collection-id"],
  disposableTargetAcknowledged: true,
  permanentCollectionAcknowledged: allowPermanentCollection,
  artifactDirectory,
  expectedRuntime,
  artifactHashes: {
    server: await sha256OfFile(serverPath),
    plugin: await sha256OfFile(pluginPath),
  },
  checks: {},
  cleanup: [],
  stillOwed: [
    "Run only on a disposable Figma file. This gate adds a mode, creates and deletes variables, and creates and deletes a page.",
  ],
  success: false,
};

let connected = false;
let failure = null;
let probeModeId = null;
let probeFloatId = null;
let probeColorId = null;
let scratchPageId = null;
let originalPageId = null;

async function cleanup() {
  if (!connected) return;

  // Order matters: the page holds the nodes that reference the variables, so it goes first.
  if (scratchPageId) {
    try {
      if (originalPageId) await call("set_current_page", { pageId: originalPageId });
      const deleted = await call("delete_node", { nodeId: scratchPageId });
      record.cleanup.push({ scratchPageId, reply: deleted.text });
      scratchPageId = null;
    } catch (error) {
      record.cleanup.push({ scratchPageId, error: String(error?.message ?? error) });
    }
  }

  for (const [label, id] of [
    ["probeFloat", probeFloatId],
    ["probeColor", probeColorId],
  ]) {
    if (!id) continue;
    try {
      const receipt = (await callJson("delete_variable", { variableId: id, confirm: true }))
        .value;
      record.cleanup.push({ [label]: id, outcome: receipt.outcome });
    } catch (error) {
      record.cleanup.push({ [label]: id, error: String(error?.message ?? error) });
    }
  }

  // ⭐ Reversible only because Phase 4 shipped the tool that reverses it — the same reason
  // the Phase 1.3 residues were unclearable for two releases.
  if (probeModeId) {
    try {
      const receipt = (await callJson("remove_variable_mode", {
        collectionId: options["collection-id"],
        modeId: probeModeId,
        confirm: true,
      })).value;
      const after = await readCollection(options["collection-id"]);
      record.cleanup.push({
        probeModeId,
        outcome: receipt.outcome,
        absentAfterFreshRead: findMode(after, (mode) => mode.id === probeModeId) === null,
      });
      probeModeId = null;
    } catch (error) {
      record.cleanup.push({ probeModeId, error: String(error?.message ?? error) });
    }
  }
}

try {
  await client.connect(transport);
  await joinWithRetry();
  connected = true;

  const runtime = (await callJson("get_runtime_info")).value;
  assertRuntime(runtime);
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId,
    schemaVersion: runtime.server.schemaVersion,
    fingerprint: runtime.server.capabilityFingerprint,
  };

  const baselineCollection = await readCollection(options["collection-id"]);
  assert.ok(
    baselineCollection,
    `collection ${options["collection-id"]} was not found in this document`,
  );
  const pagesBefore = (await callJson("get_pages")).value;
  originalPageId = pagesBefore.currentPageId;
  record.baseline = {
    collectionName: baselineCollection.name,
    modeCount: baselineCollection.modes.length,
    modeNames: baselineCollection.modes.map((mode) => mode.name),
    defaultModeId: baselineCollection.defaultModeId,
    pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
    currentPageId: originalPageId,
  };

  // ── 1. create_variable_collection ────────────────────────────────────────────────────
  if (allowPermanentCollection) {
    const namesBefore = await readCollectionNames();
    const created = (await callJson("create_variable_collection", {
      name: probeCollectionName,
      identityKey: opaqueIdentity,
    })).value;
    assert.equal(created.success, true, `create refused: ${JSON.stringify(created)}`);
    assert.equal(created.outcome, "created");
    assert.equal(created.created, true);
    assert.equal(created.matchedBy, null);
    assert.equal(created.identityKeyStatus, "stored");
    // ⭐ The field the receipt exists for: Figma made a mode nobody named, and every
    // set_variable_value into this collection needs its ID.
    assert.ok(created.defaultMode, "the collection's own default mode must be published");
    assert.equal(created.defaultMode.id, created.collection.defaultModeId);
    assert.ok(
      !JSON.stringify(created).includes("do not normalize"),
      "the opaque identityKey must never be echoed back",
    );

    const byName = (await callJson("create_variable_collection", {
      name: probeCollectionName,
    })).value;
    assert.equal(byName.outcome, "matched");
    assert.equal(byName.matchedBy, "name");
    assert.equal(byName.collection.id, created.collection.id);

    const byKey = (await callJson("create_variable_collection", {
      name: `${probeCollectionName} elsewhere`,
      identityKey: opaqueIdentity,
    })).value;
    assert.equal(byKey.outcome, "matched");
    assert.equal(byKey.matchedBy, "identityKey");
    assert.equal(byKey.collection.id, created.collection.id);

    const wrongId = (await callJson("create_variable_collection", {
      name: `${probeCollectionName} never`,
      id: "VariableCollectionId:404:404",
    })).value;
    assert.equal(wrongId.success, false);
    assert.equal(wrongId.refusal.code, "collection_not_found");

    // The cross-frame proof that three idempotent calls created exactly one collection.
    const namesAfter = await readCollectionNames();
    const matches = namesAfter.filter((name) => name === probeCollectionName);
    assert.equal(matches.length, 1, "idempotent reruns must not duplicate the collection");
    assert.equal(
      namesAfter.length,
      namesBefore.length + 1,
      "exactly one collection may be added by this leg",
    );

    record.checks.createCollection = {
      collectionId: created.collection.id,
      defaultMode: created.defaultMode,
      matchedByName: byName.matchedBy,
      matchedByKey: byKey.matchedBy,
      wrongIdRefusal: wrongId.refusal.code,
      collectionCountBefore: namesBefore.length,
      collectionCountAfter: namesAfter.length,
    };
    record.stillOwed.push(
      `PERMANENT DEBRIS: variable collection "${probeCollectionName}" (${created.collection.id}) cannot be removed by this fork — no delete_variable_collection tool exists. Delete it by hand in Figma.`,
    );
  } else {
    record.checks.createCollection = { skipped: true };
    record.stillOwed.push(
      "create_variable_collection was NOT exercised live: --allow-permanent-collection=true was not passed, because a created collection cannot be removed by any tool in this fork.",
    );
  }

  // ── 2. rename_variable_mode, and the in-frame signal measurement ─────────────────────
  const addedMode = (await callJson("add_variable_mode", {
    collectionId: options["collection-id"],
    name: probeModeName,
  })).value;
  assert.equal(
    addedMode.success,
    true,
    `add_variable_mode refused — point --collection-id at a collection with mode headroom: ${JSON.stringify(addedMode.refusal ?? addedMode)}`,
  );
  probeModeId = addedMode.mode.id;

  const renamed = (await callJson("rename_variable_mode", {
    collectionId: options["collection-id"],
    modeId: probeModeId,
    name: probeModeRenamed,
  })).value;

  // ⛔ NOT asserted as success. Whether ANY in-frame signal observes a renameMode() is the
  // open question this gate answers; `rename_unconfirmed` is a CORRECT outcome, and scoring
  // it as FAIL would be the same mistake as grading a refusal gate's refusal.
  const renameFreshRead = await readCollection(options["collection-id"]);
  const renamedMode = findMode(renameFreshRead, (mode) => mode.id === probeModeId);
  assert.ok(renamedMode, "the probe mode vanished from the collection");
  assert.equal(
    renamedMode.name,
    probeModeRenamed,
    "the rename did not land, even read from a later frame",
  );

  const noop = (await callJson("rename_variable_mode", {
    collectionId: options["collection-id"],
    modeId: probeModeId,
    name: probeModeRenamed,
  })).value;
  assert.equal(noop.success, false);
  assert.equal(noop.refusal.code, "mode_name_unchanged");

  const duplicate = (await callJson("rename_variable_mode", {
    collectionId: options["collection-id"],
    modeId: probeModeId,
    name: record.baseline.modeNames[0],
  })).value;

  record.checks.renameMode = {
    modeId: probeModeId,
    nameBefore: probeModeName,
    nameAfter: probeModeRenamed,
    receiptOutcome: renamed.outcome,
    receiptSuccess: renamed.success,
    // ⭐ THE MEASUREMENT. null here means Figma commits a rename at frame end, exactly as
    // the offline harness's conservative default models — and that the deferred branch is
    // the live-reachable one.
    observedBy: renamed.observation?.observedBy ?? null,
    observation: renamed.observation ?? null,
    confirmedByFreshRead: renamedMode.name === probeModeRenamed,
    noopRefusal: noop.refusal.code,
    duplicateNameOutcome: duplicate.outcome,
    duplicateNameRefusal: duplicate.refusal?.code ?? null,
    duplicateNameMessage: duplicate.refusal?.message ?? null,
  };

  // ── 3. set_variable_metadata ─────────────────────────────────────────────────────────
  const floatVariable = (await callJson("create_variable", {
    collectionId: options["collection-id"],
    name: probeFloatName,
    resolvedType: "FLOAT",
  })).value;
  assert.equal(floatVariable.success, true);
  probeFloatId = floatVariable.variable.id;

  const colorVariable = (await callJson("create_variable", {
    collectionId: options["collection-id"],
    name: probeColorName,
    resolvedType: "COLOR",
  })).value;
  assert.equal(colorVariable.success, true);
  probeColorId = colorVariable.variable.id;

  await call("set_variable_value", {
    variableId: probeFloatId,
    modeId: record.baseline.defaultModeId,
    value: 16,
  });
  await call("set_variable_value", {
    variableId: probeColorId,
    modeId: record.baseline.defaultModeId,
    value: { r: 0.2, g: 0.4, b: 0.9, a: 1 },
  });

  const metadata = (await callJson("set_variable_metadata", {
    variableId: probeFloatId,
    name: `${probeFloatName} renamed`,
    description: "R3-A gate probe",
    scopes: ["GAP", "WIDTH_HEIGHT"],
  })).value;
  assert.equal(metadata.success, true, `metadata refused: ${JSON.stringify(metadata)}`);
  assert.equal(metadata.outcome, "updated");
  assert.deepEqual(metadata.appliedFields, ["name", "description", "scopes"]);

  // Clearing a description must be expressible — an empty string is a value here, unlike
  // set_plugin_data where Figma DEFINES "" as removal.
  const cleared = (await callJson("set_variable_metadata", {
    variableId: probeFloatId,
    description: "",
  })).value;
  assert.equal(cleared.success, true);
  assert.equal(cleared.fields.description.after, "");

  record.checks.metadata = {
    variableId: probeFloatId,
    appliedFields: metadata.appliedFields,
    fields: metadata.fields,
    clearedDescription: cleared.fields.description,
  };

  // ── 4. The bindings, on a scratch page this gate owns ────────────────────────────────
  scratchPageId = await callNodeId("create_page", { name: scratchPageName });
  await call("set_current_page", { pageId: scratchPageId });

  const frameId = await callNodeId("create_frame", {
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    name: "binding target",
  });
  await call("set_layout_mode", { nodeId: frameId, layoutMode: "HORIZONTAL" });

  const nodeBinding = (await callJson("bind_variable_to_node", {
    nodeId: frameId,
    field: "itemSpacing",
    variableId: probeFloatId,
  })).value;
  assert.equal(
    nodeBinding.success,
    true,
    `node binding refused: ${JSON.stringify(nodeBinding.refusal ?? nodeBinding)}`,
  );
  assert.equal(nodeBinding.observation.observedBy, "node_bound_variables");

  const nodeBindingRead = await readNodeBindings(frameId);
  const nodeBindingRecord = nodeBindingRead.records.find(
    (entry) => entry.variableId === probeFloatId,
  );
  assert.ok(
    nodeBindingRecord,
    `an independent read of node ${frameId} did not list the binding: ${JSON.stringify(nodeBindingRead.records)}`,
  );

  const rectangleId = await callNodeId("create_rectangle", {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    name: "paint target",
    parentId: frameId,
  });
  await call("set_fill_color", { nodeId: rectangleId, r: 1, g: 1, b: 1, a: 1 });

  const paintBinding = (await callJson("bind_variable_to_paint", {
    nodeId: rectangleId,
    paintTarget: "fills",
    paintIndex: 0,
    variableId: probeColorId,
  })).value;
  assert.equal(
    paintBinding.success,
    true,
    `paint binding refused: ${JSON.stringify(paintBinding.refusal ?? paintBinding)}`,
  );
  // ⭐ THE WRITE-BACK, PROVED BY THE PLATFORM. setBoundVariableForPaint returns a new paint
  // and mutates nothing; without the write-back this read finds no binding at all.
  assert.equal(paintBinding.observation.writeBackPerformed, true);

  const paintBindingRead = await readNodeBindings(rectangleId);
  const paintBindingRecord = paintBindingRead.records.find(
    (entry) => entry.variableId === probeColorId,
  );
  assert.ok(
    paintBindingRecord,
    `an independent read of node ${rectangleId} did not list the paint binding: ${JSON.stringify(paintBindingRead.records)}`,
  );

  const wrongType = (await callJson("bind_variable_to_paint", {
    nodeId: rectangleId,
    paintTarget: "fills",
    paintIndex: 0,
    variableId: probeFloatId,
  })).value;
  assert.equal(wrongType.success, false);
  assert.equal(wrongType.refusal.code, "paint_requires_color_variable");

  const outOfRange = (await callJson("bind_variable_to_paint", {
    nodeId: rectangleId,
    paintTarget: "fills",
    paintIndex: 9,
    variableId: probeColorId,
  })).value;
  assert.equal(outOfRange.success, false);
  assert.equal(outOfRange.refusal.code, "paint_index_out_of_range");

  record.checks.bindings = {
    frameId,
    rectangleId,
    nodeBinding: {
      field: nodeBinding.field,
      observedBy: nodeBinding.observation.observedBy,
      independentReadProperty: nodeBindingRecord.property,
    },
    paintBinding: {
      writeBackPerformed: paintBinding.observation.writeBackPerformed,
      observedBy: paintBinding.observation.observedBy,
      paintCount: paintBinding.paintCount,
      independentReadProperty: paintBindingRecord.property,
    },
    wrongTypeRefusal: wrongType.refusal.code,
    outOfRangeRefusal: outOfRange.refusal.code,
    outOfRangePaintCount: outOfRange.paintCount,
  };

  record.success = true;
} catch (error) {
  failure = error;
  record.failure =
    error && typeof error.message === "string" ? error.message : String(error);
} finally {
  try {
    await cleanup();
    const collectionAfter = await readCollection(options["collection-id"]).catch(() => null);
    const pagesAfter = await callJson("get_pages").catch(() => null);
    record.restored = {
      modeCount: collectionAfter?.modes.length ?? null,
      modeNames: collectionAfter?.modes.map((mode) => mode.name) ?? null,
      defaultModeId: collectionAfter?.defaultModeId ?? null,
      pageCount: pagesAfter?.value?.pageCount ?? null,
      currentPageId: pagesAfter?.value?.currentPageId ?? null,
    };
    if (record.success) {
      record.stillOwed = record.stillOwed.slice(1);
    }
  } catch (cleanupError) {
    if (!failure) {
      failure = cleanupError;
      record.success = false;
      record.failure =
        cleanupError && typeof cleanupError.message === "string"
          ? cleanupError.message
          : String(cleanupError);
    }
  }
  record.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  await client.close().catch(() => undefined);
}

if (failure) {
  process.stderr.write(
    `R3-A Phase 2 collections/bindings gate FAILED: ${record.failure}\n`,
  );
  process.stderr.write(`Report: ${reportPath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `R3-A Phase 2 collections/bindings gate PASSED: ${reportPath}\n`,
  );
}
