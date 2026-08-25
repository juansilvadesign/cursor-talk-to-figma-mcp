#!/usr/bin/env node

/**
 * R3-A Phase 2 — live gate for set_variable_value, create_variable and delete_variable.
 *
 * ⛔ This gate is intentionally target-explicit. It creates variables, changes values,
 * attempts a cycle refusal, and deletes its own resources. Even with that cleanup, run it
 * ONLY on a disposable Figma file: an interrupted or platform-refused cleanup can leave
 * real variables behind. A channel is a transport route, not proof of target safety, so an
 * operator must acknowledge the disposable target on every invocation.
 *
 *   node scripts/live-variable-write-gate.mjs \
 *     --channel=<DEV-plugin-channel-for-a-disposable-file> \
 *     --collection-id=<existing-local-collection-id> \
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
      "Usage: node scripts/live-variable-write-gate.mjs --channel=<DEV-plugin-channel-for-a-disposable-file> --collection-id=<existing-local-collection-id> --disposable-target=true [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
    );
    process.exit(2);
  }
}
if (options["disposable-target"] !== "true") {
  process.stderr.write(
    "Refusing to run: pass --disposable-target=true only after the channel is connected to a disposable Figma file. This gate creates and deletes variables, and a failed cleanup can leave mutations behind.\n",
  );
  process.exit(2);
}

// Derived from runtime-metadata.ts after Phase 2 contract generation. Do not re-pin this
// script without a fresh run on a disposable target — a source edit is not live evidence.
const expectedRuntime = {
  serverBuildId: "r3-a-server-c4d037a645e3",
  pluginBuildId: "r3-a-plugin-fe0b1e03325c",
  schemaVersion: "1.14.0",
  fingerprint:
    "sha256:edf5e2e98842d2fc201f44ab780eb2ed16757e481df433086ab7de56cab57a37",
  toolCount: 71,
};

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const sourceName = `__R3A Gate Source ${stamp}`;
const aliasName = `__R3A Gate Alias ${stamp}`;
const colorName = `__R3A Gate Color ${stamp}`;
const sourceValue = `r3a-${stamp}`;
const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3a-variable-write-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r3a-variable-write-gate",
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
      const message = error && typeof error.message === "string" ? error.message : String(error);
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
  for (const command of [
    "set_variable_value",
    "create_variable",
    "delete_variable",
  ]) {
    assert.ok(
      runtime.plugin?.supportedCommands.includes(command),
      `plugin lacks ${command} — reload the DEV plugin`,
    );
  }
}

function allVariables(snapshot) {
  return (snapshot.collections || []).flatMap((collection) =>
    (collection.modes || []).flatMap((mode) => mode.variables || []),
  );
}

// ⛔ get_variables emits one entry per (mode x variable). A flat find() by id returns
// whichever mode is ordered first, which is NOT necessarily the mode a write targeted, so it
// can neither confirm the targeted write nor detect a write that leaked into another mode.
// Absence is the one property that is legitimately mode-agnostic: a deleted variable must be
// gone from every mode.
function variableAnywhere(snapshot, id) {
  return allVariables(snapshot).find((variable) => variable.id === id) || null;
}

function collectionInSnapshot(snapshot, collectionId) {
  return (
    (snapshot.collections || []).find((collection) => collection.id === collectionId) || null
  );
}

function variableInMode(snapshot, collectionId, modeId, variableId) {
  const collection = collectionInSnapshot(snapshot, collectionId);
  const mode = (collection?.modes || []).find((entry) => entry.id === modeId);
  return (mode?.variables || []).find((variable) => variable.id === variableId) || null;
}

// Every mode's serialized value for one variable, keyed by modeId, so a later snapshot can be
// compared mode by mode against this baseline.
function valuesByMode(snapshot, collectionId, variableId) {
  const collection = collectionInSnapshot(snapshot, collectionId);
  const values = {};
  for (const mode of collection?.modes || []) {
    const found = (mode.variables || []).find((variable) => variable.id === variableId);
    if (found) values[mode.id] = found.value;
  }
  return values;
}

// A write must land in exactly the targeted mode and leave every other mode byte-identical to
// the baseline captured before the write. On a single-mode collection "wrote the named mode"
// and "wrote every mode" are the same bytes, so this check only means something against a
// multi-mode target.
function assertWriteIsolated({
  label,
  baseline,
  after,
  collectionId,
  targetModeId,
  variableId,
  expected,
}) {
  const targeted = variableInMode(after, collectionId, targetModeId, variableId);
  assert.ok(targeted, `${label}: variable is absent from the targeted mode ${targetModeId}`);
  if (typeof expected === "function") {
    expected(targeted.value, label);
  } else {
    assert.deepEqual(
      targeted.value,
      expected,
      `${label}: targeted mode does not hold the written value`,
    );
  }

  const afterValues = valuesByMode(after, collectionId, variableId);
  const leaked = [];
  for (const [modeId, priorValue] of Object.entries(baseline)) {
    if (modeId === targetModeId) continue;
    if (JSON.stringify(afterValues[modeId]) !== JSON.stringify(priorValue)) {
      leaked.push({ modeId, before: priorValue, after: afterValues[modeId] });
    }
  }
  assert.deepEqual(leaked, [], `${label}: the write leaked into non-targeted modes`);
  return {
    targetedValue: targeted.value,
    nonTargetModesCompared: Object.keys(baseline).length - 1,
    leaked,
  };
}

const record = {
  gate: "R3-A Phase 2 variable-write slice",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  collectionId: options["collection-id"],
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
    "This gate must run only on a disposable target. It performs best-effort cleanup, but no cleanup path makes an interrupted variable mutation safe for a real file.",
  ],
  success: false,
};

const createdVariableIds = [];
let connected = false;
let failure = null;

async function cleanupCreatedVariables() {
  if (!connected) return;
  while (createdVariableIds.length > 0) {
    const variableId = createdVariableIds.pop();
    try {
      const receipt = (await callJson("delete_variable", { variableId, confirm: true })).value;
      record.cleanup.push({ variableId, receipt });
    } catch (error) {
      record.cleanup.push({
        variableId,
        error: error && typeof error.message === "string" ? error.message : String(error),
      });
    }
  }
}

try {
  await client.connect(transport);
  connected = true;

  const inventory = await client.listTools();
  record.checks.inventory = {
    toolCount: inventory.tools.length,
    tools: ["set_variable_value", "create_variable", "delete_variable"].map((name) => {
      const tool = inventory.tools.find((entry) => entry.name === name);
      return {
        name,
        present: Boolean(tool),
        description: String(tool?.description ?? ""),
      };
    }),
  };
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  for (const tool of record.checks.inventory.tools) {
    assert.equal(tool.present, true, `${tool.name} is not in the published tool surface`);
  }
  assert.match(record.checks.inventory.tools[0].description, /exactly one of value or aliasOf/i);
  // ⛔ REPLACED 2026-08-25, and this is a CONTRACT CHANGE catching up, not a loosened gate.
  // Phase 2 published `create_variable` as "a direct create, not an upsert", and this line
  // asserted exactly that. R3-A Phase 3 DELIBERATELY made it a create-or-match resolver, so
  // the old assertion now contradicts the shipped contract — which is precisely why the
  // ledger said this gate could not be quoted for the Phase 3 source until it was re-run.
  //
  // The replacement pins the guarantee that SUCCEEDED "not an upsert" rather than deleting
  // it: matching is deterministic and never silently creates or overwrites. ⭐ Both phrases
  // are absent from the Phase 2 description (`git show fc65db5:src/talk_to_figma_mcp/server.ts`),
  // so this discriminates Phase 3 from Phase 2 instead of matching whatever is there —
  // the known-bad leg a changed assertion owes.
  assert.match(record.checks.inventory.tools[1].description, /Resolution is fixed/i);
  assert.match(
    record.checks.inventory.tools[1].description,
    /never falls through to create/i,
  );
  assert.match(record.checks.inventory.tools[2].description, /confirm must be literal true/i);

  await joinWithRetry();
  const runtime = (await callJson("get_runtime_info")).value;
  assertRuntime(runtime);
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId ?? null,
    compatibility: runtime.compatibility.status,
  };

  const capabilities = (await callJson("get_variable_capabilities")).value;
  assert.equal(capabilities.complete, true);
  const target = (capabilities.collections || []).find(
    (collection) => collection.id === options["collection-id"],
  );
  assert.ok(target, `collection ${options["collection-id"]} is not a local collection visible to this gate`);
  assert.equal(target.isRemote, false);
  assert.equal(typeof target.defaultModeId, "string");
  assert.ok(target.defaultModeId.length > 0);
  record.checks.target = {
    id: target.id,
    name: target.name,
    defaultModeId: target.defaultModeId,
    modeCount: target.modeCount,
  };

  const source = (await callJson("create_variable", {
    collectionId: target.id,
    name: sourceName,
    resolvedType: "STRING",
  })).value;
  assert.equal(source.success, true);
  assert.equal(source.outcome, "created");
  createdVariableIds.push(source.variable.id);

  const alias = (await callJson("create_variable", {
    collectionId: target.id,
    name: aliasName,
    resolvedType: "STRING",
  })).value;
  assert.equal(alias.success, true);
  assert.equal(alias.outcome, "created");
  createdVariableIds.push(alias.variable.id);

  const color = (await callJson("create_variable", {
    collectionId: target.id,
    name: colorName,
    resolvedType: "COLOR",
  })).value;
  assert.equal(color.success, true);
  assert.equal(color.outcome, "created");
  createdVariableIds.push(color.variable.id);

  // Baseline every mode BEFORE any write, so isolation is measured against what the
  // collection actually held rather than an assumed empty default.
  const baselineSnapshot = (await callJson("get_variables")).value;
  const baselines = {
    source: valuesByMode(baselineSnapshot, target.id, source.variable.id),
    alias: valuesByMode(baselineSnapshot, target.id, alias.variable.id),
    color: valuesByMode(baselineSnapshot, target.id, color.variable.id),
  };
  for (const [label, values] of Object.entries(baselines)) {
    assert.equal(
      Object.keys(values).length,
      target.modeCount,
      `${label}: baseline covers ${Object.keys(values).length} modes, expected ${target.modeCount}`,
    );
  }
  record.checks.baselines = baselines;

  const rawWrite = (await callJson("set_variable_value", {
    variableId: source.variable.id,
    modeId: target.defaultModeId,
    value: sourceValue,
  })).value;
  assert.equal(rawWrite.success, true);
  assert.equal(rawWrite.outcome, "applied");
  assert.equal(rawWrite.value, sourceValue);

  const colorWrite = (await callJson("set_variable_value", {
    variableId: color.variable.id,
    modeId: target.defaultModeId,
    value: { r: 1, g: 0, b: 0, a: 0 },
  })).value;
  assert.equal(colorWrite.success, true);
  assert.equal(colorWrite.value, "#ff000000");

  const aliasWrite = (await callJson("set_variable_value", {
    variableId: alias.variable.id,
    modeId: target.defaultModeId,
    aliasOf: source.variable.id,
  })).value;
  assert.equal(aliasWrite.success, true);
  assert.deepEqual(aliasWrite.assignment, { kind: "alias", aliasOf: source.variable.id });

  // One snapshot covering all three writes: each must land in the default mode only.
  const afterWrites = (await callJson("get_variables")).value;
  record.checks.isolation = {
    source: assertWriteIsolated({
      label: "raw string write",
      baseline: baselines.source,
      after: afterWrites,
      collectionId: target.id,
      targetModeId: target.defaultModeId,
      variableId: source.variable.id,
      expected: sourceValue,
    }),
    color: assertWriteIsolated({
      label: "raw color write",
      baseline: baselines.color,
      after: afterWrites,
      collectionId: target.id,
      targetModeId: target.defaultModeId,
      variableId: color.variable.id,
      expected: "#ff000000",
    }),
    alias: assertWriteIsolated({
      label: "alias write",
      baseline: baselines.alias,
      after: afterWrites,
      collectionId: target.id,
      targetModeId: target.defaultModeId,
      variableId: alias.variable.id,
      // Pin the two load-bearing fields rather than the whole object, so an extra field
      // Figma may add cannot fail a correct write.
      expected: (value, label) => {
        assert.equal(value?.type, "VARIABLE_ALIAS", `${label}: targeted mode is not an alias`);
        assert.equal(value?.id, source.variable.id, `${label}: alias points at the wrong variable`);
      },
    }),
  };

  const cycle = (await callJson("set_variable_value", {
    variableId: source.variable.id,
    modeId: target.defaultModeId,
    aliasOf: alias.variable.id,
  })).value;
  assert.equal(cycle.success, false);
  assert.equal(cycle.outcome, "refused");
  assert.equal(cycle.refusal?.code, "alias_cycle");

  const beforeDeletes = (await callJson("get_variables")).value;
  const sourceBeforeDelete = variableInMode(
    beforeDeletes,
    target.id,
    target.defaultModeId,
    source.variable.id,
  );
  assert.ok(
    sourceBeforeDelete,
    "source variable is absent from the targeted mode after the refused cycle",
  );
  assert.equal(sourceBeforeDelete.value, sourceValue, "a refused cycle must preserve the prior raw value");
  // A refusal must also leave every other mode exactly as the baseline had it.
  record.checks.cycleIsolation = assertWriteIsolated({
    label: "refused cycle",
    baseline: baselines.source,
    after: beforeDeletes,
    collectionId: target.id,
    targetModeId: target.defaultModeId,
    variableId: source.variable.id,
    expected: sourceValue,
  });

  // ⛔ A platform that commits remove() at frame end CANNOT confirm the absence from inside
  // the deleting frame, so the receipt is accepted as either an observed deletion or an
  // explicit deferral — never as a bare success. The authoritative instrument is the
  // cross-frame re-read below, which is also the only thing that separates a real deletion
  // from a remove() that did nothing.
  const deletionReceipts = [];
  for (const created of [alias, color, source]) {
    const deletion = (await callJson("delete_variable", {
      variableId: created.variable.id,
      confirm: true,
    })).value;
    const observedDeletion =
      deletion.success === true &&
      deletion.outcome === "deleted" &&
      deletion.removalObserved === true;
    const declaredDeferral =
      deletion.success === false &&
      deletion.outcome === "removal_unconfirmed" &&
      deletion.removalObserved === false &&
      deletion.verificationDeferred === true &&
      deletion.partialApplicationPossible === true &&
      deletion.refusal?.code === "delete_not_observed_in_frame";
    assert.ok(
      observedDeletion || declaredDeferral,
      `delete_variable returned neither an observed deletion nor a declared deferral: ${JSON.stringify(deletion)}`,
    );
    deletionReceipts.push({
      variableId: created.variable.id,
      outcome: deletion.outcome,
      removalObserved: deletion.removalObserved,
      verificationDeferred: deletion.verificationDeferred ?? null,
      observation: deletion.observation ?? null,
    });
  }
  record.checks.deletions = deletionReceipts;

  const afterDeletes = (await callJson("get_variables")).value;
  for (const created of [source, alias, color]) {
    assert.equal(
      variableAnywhere(afterDeletes, created.variable.id),
      null,
      `the cross-frame re-read still resolves ${created.variable.id}: the deletion did not happen`,
    );
    // Only drop it from the cleanup list once absence is PROVEN, so an unconfirmed delete
    // is still retried by cleanupCreatedVariables().
    const index = createdVariableIds.indexOf(created.variable.id);
    if (index !== -1) createdVariableIds.splice(index, 1);
  }

  record.checks.writes = { source, alias, color, rawWrite, colorWrite, aliasWrite, cycle };
  record.stillOwed = [];
  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error && typeof error.message === "string" ? error.message : String(error);
} finally {
  await cleanupCreatedVariables();
  record.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  await client.close().catch(() => undefined);
}

if (failure) {
  process.stderr.write(`R3-A Phase 2 variable-write gate FAILED: ${record.failure}\n`);
  process.stderr.write(`Report: ${reportPath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`R3-A Phase 2 variable-write gate PASSED: ${reportPath}\n`);
}
