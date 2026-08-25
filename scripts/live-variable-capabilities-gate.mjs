#!/usr/bin/env node

/**
 * R3-A — `get_variable_capabilities` differential live gate.
 *
 * This is the gate the tool never had. `get_variable_capabilities` is the last R3-A tool at
 * `additive-preview`, and its only live evidence so far was an ad-hoc re-run inside another
 * tool's gate, which is not a scripted verdict.
 *
 * ⛔ **THE DESIGN PROBLEM THIS GATE EXISTS TO AVOID.** Most of this tool's receipt is
 * CONSTANT. `modeCeiling.value` is `null` on every return path (`unknownModeCeiling()`),
 * `remoteCollectionInventoryAvailable` is literal `false`, and `document.permissionVerified`
 * is literal `false`. Asserting those is asserting a literal against itself: green for every
 * possible document, in every possible Figma state, forever. A gate built only from them
 * would be decoration. They ARE checked below — a declared limitation that silently starts
 * lying is worth catching — but they are recorded under `declaredLimitations` and are
 * explicitly NOT this gate's evidence.
 *
 * ⭐ **The evidence is the DIFFERENTIAL.** Read the inventory, drive one real mode-count
 * change through a DIFFERENT tool (`add_variable_mode`), and require this tool's next read to
 * track it: the target collection up exactly one, every other collection untouched, and
 * `modeCeiling.knownGoodAtLeast` agreeing across three independent derivations — the payload's
 * own, a recomputation from the payload's collections, and a prediction made BEFORE the write
 * from the pre-write inventory. A stale, cached, or fabricated inventory fails that. Then
 * `remove_variable_mode` restores the file and the inventory must return, canonically, to the
 * exact pre-gate baseline.
 *
 * ⛔ **This gate CREATES a resource, so it OWNS the cleanup** — the opposite of
 * `live-variable-mode-gate.mjs`, whose evidence is a refusal and which therefore owns none.
 * Cleanup runs in `finally`, including on assertion failure, and a cleanup that cannot be
 * verified is reported in `stillOwed` with the exact mode id a human must remove by hand.
 *
 * ⛔ `create_variable_collection` is deliberately NOT used to build a scratch target: no tool
 * in this fork can remove a collection, so that path leaves permanent debris. The
 * add/remove mode pair is the one net-zero write this fork can actually reverse.
 *
 *   node scripts/live-variable-capabilities-gate.mjs \
 *     --channel=<DEV-plugin-channel-for-a-disposable-file> \
 *     --collection-id=<local-collection-BELOW-its-mode-ceiling> \
 *     --disposable-target=true
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
      "Usage: node scripts/live-variable-capabilities-gate.mjs --channel=<DEV-plugin-channel-for-a-disposable-file> --collection-id=<local-collection-BELOW-its-mode-ceiling> --disposable-target=true [--mode-name=<name>] [--output-dir=<dir>] [--server=<dist-server-path>]\n",
    );
    process.exit(2);
  }
}
if (options["disposable-target"] !== "true") {
  process.stderr.write(
    "Refusing to run: pass --disposable-target=true only after the channel is connected to a disposable Figma file. This gate adds a real mode to a real local collection and then removes it; if the removal cannot be verified, the mode stays in the document and its undo history.\n",
  );
  process.exit(2);
}

// Pins for the R3-A 1.17.0 build (76 tools). `release` is asserted, not merely declared:
// a pin nothing reads cannot go stale loudly, which is exactly how live-plugin-data-gate
// carried `release: "R2"` through a green run.
const expectedRuntime = {
  serverBuildId: "r3-a-server-d0897984aeb6",
  pluginBuildId: "r3-a-plugin-07a616c3b48d",
  schemaVersion: "1.17.0",
  fingerprint:
    "sha256:b67c85d4b655cc5c7f10aa28dd55f450b63f2a292a06585b49d39559bd6e4fbd",
  release: "R3-A",
  toolCount: 76,
};

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3a-variable-capabilities-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

const probeModeName =
  options["mode-name"] || `r3a-cap-gate-${Date.now().toString(36)}`;

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r3a-variable-capabilities-gate",
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
  assert.equal(runtime.server.release, expectedRuntime.release);
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
  for (const command of [
    "get_variable_capabilities",
    "get_variables",
    "add_variable_mode",
    "remove_variable_mode",
  ]) {
    assert.ok(
      runtime.plugin?.supportedCommands.includes(command),
      `plugin lacks ${command} — reload the DEV plugin`,
    );
  }
}

// Ordering from getLocalVariableCollectionsAsync() is not a documented guarantee, so the
// baseline comparison is canonical rather than byte-identical. Sorting is the only
// normalisation applied — no field is dropped to make a comparison pass.
function canonicalInventory(capabilities) {
  return {
    scope: capabilities.scope,
    supported: capabilities.supported,
    complete: capabilities.complete,
    readApiAvailable: capabilities.readApiAvailable,
    writeApiAvailable: capabilities.writeApiAvailable,
    collectionInventoryAvailable: capabilities.collectionInventoryAvailable,
    remoteCollectionInventoryAvailable:
      capabilities.remoteCollectionInventoryAvailable,
    collectionCount: capabilities.collectionCount,
    localCollectionCount: capabilities.localCollectionCount,
    knownGoodAtLeast: capabilities.modeCeiling?.knownGoodAtLeast ?? null,
    collections: (capabilities.collections || [])
      .map((collection) => ({
        id: collection.id,
        name: collection.name,
        key: collection.key,
        defaultModeId: collection.defaultModeId,
        isRemote: collection.isRemote,
        modeCount: collection.modeCount,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

function maxLocalModeCount(inventory) {
  const local = inventory.collections.filter((collection) => !collection.isRemote);
  return local.length > 0
    ? Math.max(...local.map((collection) => collection.modeCount))
    : null;
}

function assertSelfConsistent(capabilities, label) {
  assert.equal(capabilities.scope, "document", `${label}: scope`);
  assert.equal(capabilities.supported, true, `${label}: supported`);
  assert.equal(capabilities.complete, true, `${label}: complete`);
  assert.ok(Array.isArray(capabilities.collections), `${label}: collections array`);
  const inventory = canonicalInventory(capabilities);
  assert.equal(
    capabilities.collectionCount,
    inventory.collections.length,
    `${label}: collectionCount disagrees with the collections it returned`,
  );
  assert.equal(
    capabilities.localCollectionCount,
    inventory.collections.filter((collection) => !collection.isRemote).length,
    `${label}: localCollectionCount disagrees with the collections it returned`,
  );
  for (const collection of inventory.collections) {
    assert.equal(typeof collection.id, "string", `${label}: collection id`);
    assert.equal(typeof collection.name, "string", `${label}: collection name`);
    assert.equal(
      typeof collection.defaultModeId,
      "string",
      `${label}: collection defaultModeId`,
    );
    assert.ok(
      Number.isSafeInteger(collection.modeCount) && collection.modeCount >= 1,
      `${label}: collection ${collection.id} reported modeCount ${collection.modeCount}`,
    );
  }
  // DERIVED, and therefore falsifiable: knownGoodAtLeast is documented as the largest local
  // mode count this document actually shows, not a plan figure.
  assert.equal(
    capabilities.modeCeiling?.knownGoodAtLeast ?? null,
    maxLocalModeCount(inventory),
    `${label}: modeCeiling.knownGoodAtLeast is not the largest local modeCount in the same payload`,
  );
  return inventory;
}

const record = {
  gate: "R3-A get_variable_capabilities differential inventory tracking",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  collectionId: options["collection-id"],
  probeModeName,
  disposableTargetAcknowledged: true,
  artifactDirectory,
  expectedRuntime,
  artifactHashes: {
    server: await sha256OfFile(serverPath),
    plugin: await sha256OfFile(pluginPath),
  },
  evidence: {},
  declaredLimitations: {},
  cleanup: { createdModeId: null, removed: null, verifiedBy: null },
  checks: {},
  findings: [],
  stillOwed: [
    "Run only against a disposable Figma file. This gate adds one real mode and then removes it.",
  ],
  success: false,
};

let failure = null;
let createdModeId = null;
let restored = false;

try {
  await client.connect(transport);

  // ── 0. published surface ──────────────────────────────────────────────────────────────
  // Read the server's own published tool list, not the checked-out source.
  const inventoryTools = await client.listTools();
  assert.equal(inventoryTools.tools.length, expectedRuntime.toolCount);
  const tool = inventoryTools.tools.find(
    (entry) => entry.name === "get_variable_capabilities",
  );
  assert.ok(tool, "get_variable_capabilities is not in the published tool surface");
  const schema = tool.inputSchema ?? {};
  const description = String(tool.description ?? "");
  record.checks.publishedSchema = {
    // The zero-argument contract, asserted against the PUBLISHED schema.
    properties: Object.keys(schema.properties ?? {}),
    required: schema.required ?? [],
    readOnlyPreflight: /read-only preflight/i.test(description),
    forbidsProbe: /no create\/delete probe is performed/i.test(description),
    localOnlyInventory: /inventory is LOCAL-ONLY/i.test(description),
    absenceIsNotEvidence: /NOT evidence that the file references none/i.test(description),
  };
  assert.deepEqual(record.checks.publishedSchema.properties, []);
  assert.deepEqual(record.checks.publishedSchema.required, []);
  assert.equal(record.checks.publishedSchema.readOnlyPreflight, true);
  assert.equal(record.checks.publishedSchema.forbidsProbe, true);
  assert.equal(record.checks.publishedSchema.localOnlyInventory, true);
  assert.equal(record.checks.publishedSchema.absenceIsNotEvidence, true);

  await joinWithRetry();
  const runtime = (await callJson("get_runtime_info")).value;
  assertRuntime(runtime);
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId ?? null,
    release: runtime.server.release,
    compatibility: runtime.compatibility.status,
  };

  // ── 1. baseline read ──────────────────────────────────────────────────────────────────
  const beforePayload = (await callJson("get_variable_capabilities")).value;
  const before = assertSelfConsistent(beforePayload, "before");
  record.checks.before = before;

  // ⚠️ NOT EVIDENCE — declared limitations, recorded so a constant that silently starts
  // lying is still caught, but kept out of `evidence` because none of them can fail for
  // any document this gate could be pointed at.
  record.declaredLimitations = {
    modeCeilingValue: beforePayload.modeCeiling?.value ?? null,
    modeCeilingStatus: beforePayload.modeCeiling?.status ?? null,
    remoteCollectionInventoryAvailable:
      beforePayload.remoteCollectionInventoryAvailable,
    documentEditable: beforePayload.document?.editable ?? null,
    documentPermissionVerified: beforePayload.document?.permissionVerified ?? null,
    editorContextAllowsWrites:
      beforePayload.document?.editorContextAllowsWrites ?? null,
    limitationCount: (beforePayload.limitations || []).length,
    note: "Constants on every return path in code.js. Green for every possible input; they discriminate nothing and are not this gate's verdict.",
  };
  assert.equal(beforePayload.modeCeiling?.value, null);
  assert.equal(beforePayload.modeCeiling?.status, "unknown");
  assert.equal(beforePayload.remoteCollectionInventoryAvailable, false);
  assert.equal(beforePayload.document?.permissionVerified, false);
  assert.ok((beforePayload.limitations || []).length >= 2);

  const target = before.collections.find(
    (collection) => collection.id === options["collection-id"],
  );
  assert.ok(
    target,
    `collection ${options["collection-id"]} is not a local collection visible to get_variable_capabilities`,
  );
  assert.equal(target.isRemote, false);

  // ── 2. cross-instrument agreement ─────────────────────────────────────────────────────
  // `get_variables` derives its mode list independently (an array of per-mode objects built
  // from collection.modes) from the shape `get_variable_capabilities` reports (a count off
  // the same collection). A narrow `types` filter keeps the call cheap; it filters
  // VARIABLES, never collections or modes, so mode counts stay complete. variableCount is
  // deliberately NOT asserted, because the filter does make that number partial.
  const variablesPayload = (await callJson("get_variables", { types: ["BOOLEAN"] })).value;
  assert.equal(variablesPayload.supported, true, "get_variables reports the API unsupported");
  assert.equal(variablesPayload.complete, true, "get_variables reports an incomplete read");
  const fromVariables = (variablesPayload.collections || [])
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
      key: collection.key,
      defaultModeId: collection.defaultModeId,
      modeCount: Array.isArray(collection.modes) ? collection.modes.length : null,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const fromCapabilities = before.collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    key: collection.key,
    defaultModeId: collection.defaultModeId,
    modeCount: collection.modeCount,
  }));
  assert.deepEqual(
    fromCapabilities,
    fromVariables,
    "get_variable_capabilities and get_variables disagree about the local collection inventory",
  );
  record.evidence.crossInstrument = {
    instrument: "get_variables",
    collectionsCompared: fromVariables.length,
    agreed: true,
  };
  assert.ok(
    fromVariables.length >= 1,
    "vacuity guard: the cross-instrument check compared zero collections",
  );

  // ── 3. purity ─────────────────────────────────────────────────────────────────────────
  // A read that mutated anything — or that answered from a cache built at plugin load —
  // shows up as a second read that does not match the first.
  const repeatPayload = (await callJson("get_variable_capabilities")).value;
  const repeat = assertSelfConsistent(repeatPayload, "repeat");
  assert.deepEqual(repeat, before, "two consecutive reads of an unchanged document disagree");
  record.evidence.purity = { consecutiveReadsIdentical: true };

  // ── 4. THE DIFFERENTIAL ───────────────────────────────────────────────────────────────
  // Predict BEFORE the write. A prediction made after the fact is a description.
  const predictedTargetModeCount = target.modeCount + 1;
  const predictedKnownGoodAtLeast = Math.max(
    before.knownGoodAtLeast ?? 0,
    predictedTargetModeCount,
  );
  record.evidence.differential = {
    targetModeCountBefore: target.modeCount,
    predictedTargetModeCount,
    knownGoodAtLeastBefore: before.knownGoodAtLeast,
    predictedKnownGoodAtLeast,
  };

  const addReceipt = (
    await callJson("add_variable_mode", {
      collectionId: options["collection-id"],
      name: probeModeName,
    })
  ).value;
  record.checks.addReceipt = addReceipt;
  assert.equal(
    addReceipt.success,
    true,
    `add_variable_mode did not create a mode, so the differential cannot run. If this is a ceiling refusal, this collection is AT its mode ceiling — point --collection-id at a collection BELOW its ceiling. Receipt: ${JSON.stringify(addReceipt)}`,
  );
  assert.equal(addReceipt.outcome, "created");
  assert.equal(typeof addReceipt.mode?.id, "string");
  createdModeId = addReceipt.mode.id;
  record.cleanup.createdModeId = createdModeId;
  assert.equal(addReceipt.collection?.modeCountBefore, target.modeCount);
  assert.equal(addReceipt.collection?.modeCountAfter, predictedTargetModeCount);

  const afterAddPayload = (await callJson("get_variable_capabilities")).value;
  const afterAdd = assertSelfConsistent(afterAddPayload, "after-add");
  record.checks.afterAdd = afterAdd;

  const afterTarget = afterAdd.collections.find(
    (collection) => collection.id === options["collection-id"],
  );
  assert.ok(afterTarget, "target collection disappeared from the inventory after the add");
  assert.equal(
    afterTarget.modeCount,
    predictedTargetModeCount,
    "get_variable_capabilities did not track the mode this gate actually added",
  );

  // No leakage: every OTHER collection must be byte-for-byte what it was.
  assert.deepEqual(
    afterAdd.collections.filter((collection) => collection.id !== target.id),
    before.collections.filter((collection) => collection.id !== target.id),
    "a write to one collection changed how the inventory reports the others",
  );
  assert.equal(afterAdd.collectionCount, before.collectionCount);
  assert.equal(afterAdd.localCollectionCount, before.localCollectionCount);

  // Three derivations of the same number, one of which was written down before the write.
  assert.equal(
    afterAddPayload.modeCeiling?.knownGoodAtLeast,
    maxLocalModeCount(afterAdd),
    "knownGoodAtLeast disagrees with the payload it shipped in",
  );
  assert.equal(
    afterAddPayload.modeCeiling?.knownGoodAtLeast,
    predictedKnownGoodAtLeast,
    "knownGoodAtLeast did not move to the value predicted from the pre-write inventory",
  );
  record.evidence.differential.observedTargetModeCount = afterTarget.modeCount;
  record.evidence.differential.observedKnownGoodAtLeast =
    afterAddPayload.modeCeiling?.knownGoodAtLeast ?? null;
  record.evidence.differential.trackedTheWrite = true;

  // ── 5. restore, then verify the restore across a frame ────────────────────────────────
  const removeReceipt = (
    await callJson("remove_variable_mode", {
      collectionId: options["collection-id"],
      modeId: createdModeId,
      confirm: true,
    })
  ).value;
  record.checks.removeReceipt = removeReceipt;
  // ⛔ `removal_unconfirmed` is NOT a failure. Figma may commit removeMode() at frame end,
  // and the plugin says so rather than claiming a removal it cannot see. The cross-frame
  // re-read below is the instrument that settles it — that is exactly what code.js names.
  assert.ok(
    removeReceipt.outcome === "removed" || removeReceipt.outcome === "removal_unconfirmed",
    `remove_variable_mode refused: ${JSON.stringify(removeReceipt)}`,
  );
  record.cleanup.removed = removeReceipt.outcome;

  const afterRemovePayload = (await callJson("get_variable_capabilities")).value;
  const afterRemove = assertSelfConsistent(afterRemovePayload, "after-remove");
  record.checks.afterRemove = afterRemove;
  assert.deepEqual(
    afterRemove,
    before,
    "the document did not return to its pre-gate inventory; a probe mode may still be present",
  );
  restored = true;
  record.cleanup.verifiedBy = "cross_frame_get_variable_capabilities";
  record.evidence.restoredToBaseline = true;

  record.stillOwed = [];
  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error && typeof error.message === "string" ? error.message : String(error);
} finally {
  // The gate created a real resource. It cleans up even when an assertion above failed —
  // and when it cannot verify the cleanup, it says so in stillOwed rather than exiting quiet.
  if (createdModeId && !restored) {
    try {
      const rescue = (
        await callJson("remove_variable_mode", {
          collectionId: options["collection-id"],
          modeId: createdModeId,
          confirm: true,
        })
      ).value;
      record.cleanup.rescue = rescue;
      const confirm = (await callJson("get_variable_capabilities")).value;
      const stillThere = (confirm.collections || []).find(
        (collection) => collection.id === options["collection-id"],
      );
      record.cleanup.rescueVerified = Boolean(
        stillThere && stillThere.modeCount === record.evidence?.differential?.targetModeCountBefore,
      );
      if (!record.cleanup.rescueVerified) {
        record.stillOwed.push(
          `Remove mode ${createdModeId} from collection ${options["collection-id"]} by hand: this gate created it and could not verify its removal.`,
        );
      }
    } catch (cleanupError) {
      record.cleanup.rescueError =
        cleanupError && typeof cleanupError.message === "string"
          ? cleanupError.message
          : String(cleanupError);
      record.stillOwed.push(
        `Remove mode ${createdModeId} from collection ${options["collection-id"]} by hand: this gate created it and its cleanup call threw.`,
      );
    }
  }
  record.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  await client.close().catch(() => undefined);
}

if (failure) {
  process.stderr.write(`R3-A variable-capabilities gate FAILED: ${record.failure}\n`);
  if (record.stillOwed.length > 0) {
    for (const owed of record.stillOwed) process.stderr.write(`STILL OWED: ${owed}\n`);
  }
  process.stderr.write(`Report: ${reportPath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`R3-A variable-capabilities gate PASSED: ${reportPath}\n`);
}
