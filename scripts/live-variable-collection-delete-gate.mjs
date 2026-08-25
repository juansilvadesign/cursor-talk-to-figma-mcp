#!/usr/bin/env node

/**
 * R3-A collection-cleanup addendum — live gate for `delete_variable_collection`.
 *
 * This gate proves the capability that makes `create_variable_collection` safely rerunnable:
 * it creates a collection it owns, proves the non-empty refusal before any cleanup, removes
 * only the gate-owned variable, then removes the now-empty collection and fresh-reads the
 * document back to its exact baseline. The collection is deliberately built by the fork's
 * own create tool — no UI setup or hand-created target can prove that opt-in gate leg.
 *
 * ⛔ Run ONLY on a disposable Figma file. A channel is transport, not evidence that its
 * document is safe. The handler refuses non-empty collections, but this gate still creates
 * and removes live document resources and relies on a cross-frame read for final proof.
 *
 *   node scripts/live-variable-collection-delete-gate.mjs \
 *     --channel=<DEV-plugin-channel-for-a-disposable-file> \
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

if (!options.channel) {
  process.stderr.write(
    "Usage: node scripts/live-variable-collection-delete-gate.mjs --channel=<DEV-plugin-channel-for-a-disposable-file> --disposable-target=true [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
  );
  process.exit(2);
}
if (options["disposable-target"] !== "true") {
  process.stderr.write(
    "Refusing to run: pass --disposable-target=true only after the channel is connected to a disposable Figma file. This gate creates and removes a variable collection and a variable.\n",
  );
  process.exit(2);
}

// Derived from runtime-metadata.ts after the R3-A collection-cleanup generation. Do not
// re-pin this script without a fresh run on a disposable target — a source edit is not live
// evidence. `release` is asserted too: an unparsed pin can drift while still looking present.
const expectedRuntime = {
  serverBuildId: "r3-a-server-b5649366daef",
  pluginBuildId: "r3-a-plugin-7f0d5389634e",
  schemaVersion: "1.18.0",
  fingerprint:
    "sha256:de4144fe6776b8283bc8c8af06f6517d69acc3d97271fee2f1c9a8ce338999e9",
  release: "R3-A",
  toolCount: 77,
};

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const probeCollectionName = `__R3A Collection Delete Probe ${stamp}`;
const probeVariableName = `__R3A Collection Delete Variable ${stamp}`;
const probeIdentityKey = `  caller://r3a/collection-delete/${stamp} — do not normalize  `;
const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3a-collection-delete-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r3a-collection-delete-gate",
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
      const message = error && typeof error.message === "string"
        ? error.message
        : String(error);
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
    "create_variable_collection",
    "create_variable",
    "delete_variable",
    "delete_variable_collection",
    "get_variable_capabilities",
  ]) {
    assert.ok(
      runtime.plugin?.supportedCommands.includes(command),
      `plugin lacks ${command} — reload the DEV plugin`,
    );
  }
}

function canonicalInventory(payload) {
  assert.equal(payload.supported, true, "get_variable_capabilities must be supported");
  assert.equal(payload.complete, true, "collection inventory must be complete");
  assert.ok(Array.isArray(payload.collections), "collection inventory must be an array");
  return payload.collections
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
      key: collection.key,
      defaultModeId: collection.defaultModeId,
      isRemote: collection.isRemote,
      modeCount: collection.modeCount,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

async function readInventory() {
  const payload = (await callJson("get_variable_capabilities")).value;
  return { payload, collections: canonicalInventory(payload) };
}

function byId(collections, id) {
  return collections.find((collection) => collection.id === id) || null;
}

const record = {
  gate: "R3-A delete_variable_collection",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  disposableTargetAcknowledged: true,
  artifactDirectory,
  expectedRuntime,
  artifactHashes: {
    server: await sha256OfFile(serverPath),
    plugin: await sha256OfFile(pluginPath),
  },
  checks: {},
  cleanup: [],
  stillOwed: [
    "Run only on a disposable Figma file. This gate creates a collection and variable, then removes only the resources it created.",
  ],
  success: false,
};

let connected = false;
let failure = null;
let probeCollectionId = null;
let probeVariableId = null;
let baselineCollections = null;

async function cleanup() {
  if (!connected || !probeCollectionId) return;

  const current = await readInventory();
  if (!byId(current.collections, probeCollectionId)) {
    record.cleanup.push({ collectionId: probeCollectionId, alreadyAbsent: true });
    probeCollectionId = null;
    probeVariableId = null;
    return;
  }

  if (probeVariableId) {
    try {
      const variableRemoval = (await callJson("delete_variable", {
        variableId: probeVariableId,
        confirm: true,
      })).value;
      record.cleanup.push({
        variableId: probeVariableId,
        outcome: variableRemoval.outcome,
        observation: variableRemoval.observation ?? null,
      });
      probeVariableId = null;
    } catch (error) {
      record.cleanup.push({
        variableId: probeVariableId,
        error: error && typeof error.message === "string" ? error.message : String(error),
      });
    }
  }

  try {
    const collectionRemoval = (await callJson("delete_variable_collection", {
      collectionId: probeCollectionId,
      confirm: true,
    })).value;
    const after = await readInventory();
    const absentAfterFreshRead = byId(after.collections, probeCollectionId) === null;
    record.cleanup.push({
      collectionId: probeCollectionId,
      outcome: collectionRemoval.outcome,
      observation: collectionRemoval.observation ?? null,
      absentAfterFreshRead,
    });
    assert.equal(
      absentAfterFreshRead,
      true,
      `cleanup collection ${probeCollectionId} still resolves after a fresh read`,
    );
    probeCollectionId = null;
  } catch (error) {
    record.cleanup.push({
      collectionId: probeCollectionId,
      error: error && typeof error.message === "string" ? error.message : String(error),
    });
    throw error;
  }
}

try {
  await client.connect(transport);

  // ── 0. Published surface and runtime ────────────────────────────────────────────────
  const published = await client.listTools();
  assert.equal(published.tools.length, expectedRuntime.toolCount);
  const tool = published.tools.find(
    (entry) => entry.name === "delete_variable_collection",
  );
  assert.ok(tool, "delete_variable_collection is not in the published tool surface");
  const schema = tool.inputSchema ?? {};
  const description = String(tool.description ?? "");
  assert.deepEqual(schema.required ?? [], ["collectionId", "confirm"]);
  assert.equal(schema.properties?.confirm?.const, true);
  assert.match(description, /EMPTY local variable collection/);
  assert.match(description, /collection_not_empty/);
  assert.match(description, /removal_unconfirmed/);
  record.checks.publishedSurface = {
    toolCount: published.tools.length,
    required: schema.required ?? [],
    description,
  };

  await joinWithRetry();
  connected = true;
  const runtime = (await callJson("get_runtime_info")).value;
  assertRuntime(runtime);
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId ?? null,
    release: runtime.server.release,
    compatibility: runtime.compatibility.status,
  };

  // ── 1. Baseline and a collection this gate owns ─────────────────────────────────────
  const baseline = await readInventory();
  baselineCollections = baseline.collections;
  record.checks.baseline = baseline.collections;

  const created = (await callJson("create_variable_collection", {
    name: probeCollectionName,
    identityKey: probeIdentityKey,
  })).value;
  assert.equal(created.success, true, `collection create refused: ${JSON.stringify(created)}`);
  assert.equal(created.outcome, "created");
  assert.equal(created.created, true);
  assert.equal(created.matchedBy, null);
  assert.equal(created.identityKeyStatus, "stored");
  assert.ok(created.defaultMode, "Figma-created default mode must be published");
  probeCollectionId = created.collection.id;

  const afterCreate = await readInventory();
  assert.equal(afterCreate.collections.length, baseline.collections.length + 1);
  const createdFresh = byId(afterCreate.collections, probeCollectionId);
  assert.ok(createdFresh, "created collection is absent from a later inventory read");
  assert.equal(createdFresh.name, probeCollectionName);
  assert.equal(createdFresh.defaultModeId, created.defaultMode.id);
  record.checks.createdCollection = {
    receipt: created,
    freshInventory: createdFresh,
  };

  // ── 2. Prove the non-empty refusal on the gate-owned collection ──────────────────────
  const variable = (await callJson("create_variable", {
    collectionId: probeCollectionId,
    name: probeVariableName,
    resolvedType: "STRING",
  })).value;
  assert.equal(variable.success, true, `variable create refused: ${JSON.stringify(variable)}`);
  assert.equal(variable.created, true);
  probeVariableId = variable.variable.id;

  // `confirm` is a schema refusal, not a handler receipt. Treat both valid MCP refusal
  // shapes as proof, then make the typed handler refusal below do the membership evidence.
  let missingConfirmShape = null;
  try {
    const raw = await callRaw("delete_variable_collection", {
      collectionId: probeCollectionId,
    });
    missingConfirmShape = raw.isError ? "isError" : "accepted";
    assert.notEqual(
      missingConfirmShape,
      "accepted",
      "a delete call without confirm reached the plugin",
    );
  } catch (_) {
    missingConfirmShape = "threw";
  }

  const nonEmpty = (await callJson("delete_variable_collection", {
    collectionId: probeCollectionId,
    confirm: true,
  })).value;
  assert.equal(nonEmpty.success, false);
  assert.equal(nonEmpty.outcome, "refused");
  assert.equal(nonEmpty.refusal?.code, "collection_not_empty");
  assert.equal(nonEmpty.blastRadius?.variableCount, 1);
  assert.deepEqual(nonEmpty.blastRadius?.variableIds, [probeVariableId]);
  const afterRefusal = await readInventory();
  assert.ok(
    byId(afterRefusal.collections, probeCollectionId),
    "the non-empty refusal removed the collection",
  );
  record.checks.refusals = {
    missingConfirm: missingConfirmShape,
    nonEmpty,
    collectionStillPresentAfterFreshRead: true,
  };

  // ── 3. Empty it explicitly, then delete and cross-frame prove the collection ─────────
  const variableRemoval = (await callJson("delete_variable", {
    variableId: probeVariableId,
    confirm: true,
  })).value;
  probeVariableId = null;
  record.checks.variableCleanup = variableRemoval;

  const collectionRemoval = (await callJson("delete_variable_collection", {
    collectionId: probeCollectionId,
    confirm: true,
  })).value;
  const afterRemoval = await readInventory();
  const absentAfterFreshRead = byId(afterRemoval.collections, probeCollectionId) === null;
  assert.equal(
    absentAfterFreshRead,
    true,
    "the deleted collection still resolves in a later collection inventory read",
  );

  if (collectionRemoval.success) {
    assert.equal(collectionRemoval.outcome, "deleted");
    assert.equal(collectionRemoval.removalObserved, true);
    assert.ok(
      ["lookup_missed", "removed_flag", "property_access_threw", "local_collection_inventory"].includes(
        collectionRemoval.observation?.observedBy,
      ),
      `a successful collection removal must name an observation signal; got ${JSON.stringify(collectionRemoval.observation?.observedBy)}`,
    );
  } else {
    assert.equal(collectionRemoval.outcome, "removal_unconfirmed");
    assert.equal(collectionRemoval.verificationDeferred, true);
    assert.equal(collectionRemoval.observation?.observedBy, null);
  }
  record.checks.collectionRemoval = {
    receipt: collectionRemoval,
    absentAfterFreshRead,
  };
  probeCollectionId = null;

  assert.deepEqual(
    afterRemoval.collections,
    baseline.collections,
    "the successful gate did not restore the exact pre-run collection inventory",
  );
  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error && typeof error.message === "string" ? error.message : String(error);
} finally {
  try {
    await cleanup();
    if (record.success && baselineCollections) {
      const restored = await readInventory();
      assert.deepEqual(
        restored.collections,
        baselineCollections,
        "cleanup did not restore the exact pre-run collection inventory",
      );
      record.restored = true;
      record.stillOwed = [];
    }
  } catch (cleanupError) {
    if (!failure) {
      failure = cleanupError;
      record.success = false;
      record.failure = cleanupError && typeof cleanupError.message === "string"
        ? cleanupError.message
        : String(cleanupError);
    }
  }
  record.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  await client.close().catch(() => undefined);
}

if (failure) {
  process.stderr.write(`R3-A collection-delete gate FAILED: ${record.failure}\n`);
  process.stderr.write(`Report: ${reportPath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`R3-A collection-delete gate PASSED: ${reportPath}\n`);
}
