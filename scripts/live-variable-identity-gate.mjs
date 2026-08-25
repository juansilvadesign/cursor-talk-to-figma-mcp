#!/usr/bin/env node

/**
 * R3-A Phase 3 — live gate for layered variable resource identity.
 *
 * ⛔ This gate creates one variable, stores private plugin data, then deletes it. Run it
 * ONLY on a disposable Figma file: a channel is transport, not evidence that its document
 * is safe, and a failed cleanup can leave a real variable behind.
 *
 *   node scripts/live-variable-identity-gate.mjs \
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
      "Usage: node scripts/live-variable-identity-gate.mjs --channel=<DEV-plugin-channel-for-a-disposable-file> --collection-id=<existing-local-collection-id> --disposable-target=true [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
    );
    process.exit(2);
  }
}
if (options["disposable-target"] !== "true") {
  process.stderr.write(
    "Refusing to run: pass --disposable-target=true only after the channel is connected to a disposable Figma file. This gate creates and deletes a variable, and a failed cleanup can leave a mutation behind.\n",
  );
  process.exit(2);
}

// Derived from runtime-metadata.ts after R3-A Phase 3 contract generation. Do not re-pin
// this script without a fresh run on a disposable target — a source edit is not live evidence.
const expectedRuntime = {
  serverBuildId: "r3-a-server-7839c39d5302",
  pluginBuildId: "r3-a-plugin-07a616c3b48d",
  schemaVersion: "1.16.0",
  fingerprint:
    "sha256:34d09270ff74084cd134712e864bc891adbac5283e3bee625e330d043448db68",
  toolCount: 76,
};

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const variableName = `__R3A Identity Gate ${stamp}`;
// Leading/trailing spaces, punctuation and Unicode are deliberate: the only legal operation
// on this caller-owned value is exact string equality, not a consumer naming convention.
const identityKey = `  r3a://identity/${stamp} — opaque  `;
const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3a-variable-identity-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r3a-variable-identity-gate",
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
  assert.ok(
    runtime.plugin?.supportedCommands.includes("create_variable"),
    "plugin lacks create_variable — reload the DEV plugin",
  );
}

function allVariables(snapshot) {
  return (snapshot.collections || []).flatMap((collection) =>
    (collection.modes || []).flatMap((mode) => mode.variables || []),
  );
}

function uniqueVariables(snapshot) {
  return [...new Map(allVariables(snapshot).map((variable) => [variable.id, variable])).values()];
}

function variableById(snapshot, variableId) {
  return uniqueVariables(snapshot).find((variable) => variable.id === variableId) || null;
}

const record = {
  gate: "R3-A Phase 3 variable resource identity",
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
    "Run only on a disposable Figma file. The gate deletes its own variable, but failed cleanup can leave a document mutation behind.",
  ],
  success: false,
};

let connected = false;
let createdVariableId = null;
let failure = null;

async function cleanupCreatedVariable() {
  if (!connected || !createdVariableId) return;
  const variableId = createdVariableId;
  const cleanupRecord = { variableId };
  try {
    cleanupRecord.receipt = (await callJson("delete_variable", {
      variableId,
      confirm: true,
    })).value;
    // A later command is the authoritative deletion observation when Figma defers the
    // lookup, so do not mistake a truthful `removal_unconfirmed` receipt for cleanup failure.
    const after = (await callJson("get_variables")).value;
    cleanupRecord.absentAfterFreshRead = variableById(after, variableId) === null;
    assert.equal(
      cleanupRecord.absentAfterFreshRead,
      true,
      `cleanup variable ${variableId} still resolves after a fresh read`,
    );
    createdVariableId = null;
  } catch (error) {
    cleanupRecord.error = error && typeof error.message === "string" ? error.message : String(error);
    throw error;
  } finally {
    record.cleanup.push(cleanupRecord);
  }
}

try {
  await client.connect(transport);
  connected = true;

  const inventory = await client.listTools();
  const createTool = inventory.tools.find((tool) => tool.name === "create_variable");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(createTool, "create_variable is not in the published tool surface");
  assert.match(String(createTool.description), /Resolution is fixed/i);
  assert.match(String(createTool.description), /created and matchedBy/i);
  record.checks.inventory = {
    toolCount: inventory.tools.length,
    description: String(createTool.description),
  };

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
  assert.ok(target, `collection ${options["collection-id"]} is not a visible local collection`);
  assert.equal(target.isRemote, false);
  record.checks.target = {
    id: target.id,
    name: target.name,
    modeCount: target.modeCount,
  };

  const first = (await callJson("create_variable", {
    collectionId: target.id,
    name: variableName,
    resolvedType: "STRING",
    identityKey,
  })).value;
  if (first.created === true && typeof first.variable?.id === "string") {
    createdVariableId = first.variable.id;
  }
  assert.equal(first.success, true);
  assert.equal(first.outcome, "created");
  assert.equal(first.created, true);
  assert.equal(first.matchedBy, null);
  assert.equal(first.identityKeyStatus, "stored");
  assert.equal(typeof first.variable?.id, "string");

  const nameMatch = (await callJson("create_variable", {
    collectionId: target.id,
    name: variableName,
    resolvedType: "STRING",
    identityKey,
  })).value;
  assert.equal(nameMatch.success, true);
  assert.equal(nameMatch.created, false);
  assert.equal(nameMatch.matchedBy, "name");
  assert.equal(nameMatch.identityKeyStatus, "already_stored");
  assert.equal(nameMatch.variable?.id, first.variable.id);

  const identityMatch = (await callJson("create_variable", {
    collectionId: target.id,
    name: `${variableName} renamed intent`,
    resolvedType: "STRING",
    identityKey,
  })).value;
  assert.equal(identityMatch.success, true);
  assert.equal(identityMatch.created, false);
  assert.equal(identityMatch.matchedBy, "identityKey");
  assert.equal(identityMatch.variable?.id, first.variable.id);

  const idMatch = (await callJson("create_variable", {
    collectionId: target.id,
    name: variableName,
    resolvedType: "STRING",
    id: first.variable.id,
    identityKey,
  })).value;
  assert.equal(idMatch.success, true);
  assert.equal(idMatch.created, false);
  assert.equal(idMatch.matchedBy, "id");
  assert.equal(idMatch.variable?.id, first.variable.id);

  const typeConflict = (await callJson("create_variable", {
    collectionId: target.id,
    name: variableName,
    resolvedType: "COLOR",
  })).value;
  assert.equal(typeConflict.success, false);
  assert.equal(typeConflict.outcome, "refused");
  assert.equal(typeConflict.created, false);
  assert.equal(typeConflict.matchedBy, null);
  assert.equal(typeConflict.refusal?.code, "name_type_conflict");

  const afterIdentity = (await callJson("get_variables")).value;
  const found = variableById(afterIdentity, first.variable.id);
  assert.ok(found, "the created identity variable is absent from the fresh read");
  assert.equal(found.name, variableName, "identity fallback must not rename the matched variable");
  const gateVariables = uniqueVariables(afterIdentity).filter(
    (variable) => variable.name === variableName,
  );
  assert.equal(gateVariables.length, 1, "identity reruns must still own exactly one variable");

  record.checks.identity = { first, nameMatch, identityMatch, idMatch, typeConflict };
  record.checks.freshRead = { variable: found, sameNameCount: gateVariables.length };
  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error && typeof error.message === "string" ? error.message : String(error);
} finally {
  try {
    await cleanupCreatedVariable();
    if (record.success) record.stillOwed = [];
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
  process.stderr.write(`R3-A Phase 3 variable-identity gate FAILED: ${record.failure}\n`);
  process.stderr.write(`Report: ${reportPath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`R3-A Phase 3 variable-identity gate PASSED: ${reportPath}\n`);
}
