#!/usr/bin/env node

/**
 * R3-A Phase 1.3 — add_variable_mode ceiling-refusal live gate.
 *
 * Run this only against a disposable Figma file and a local collection that the operator
 * already knows is at its plan ceiling. The gate does not create a collection, add a
 * throwaway mode, or remove anything for cleanup. Its single add_variable_mode call is the
 * caller-requested write whose Figma refusal is the evidence.
 *
 *   node scripts/live-variable-mode-gate.mjs \
 *     --channel=<DEV-plugin-channel> \
 *     --collection-id=<local-collection-id-at-ceiling> \
 *     --name=<requested-new-mode-name>
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

for (const option of ["channel", "collection-id", "name"]) {
  if (!options[option]) {
    process.stderr.write(
      "Usage: node scripts/live-variable-mode-gate.mjs --channel=<DEV-plugin-channel> --collection-id=<local-collection-id-at-ceiling> --name=<requested-new-mode-name> [--output-dir=<dir>] [--server=<dist-server-path>]\n",
    );
    process.exit(2);
  }
}

// Derived from runtime-metadata.ts after Phase 1.3's contract generation. This gate has
// not been run yet; these pins make it runnable against the exact 67-tool build, not a
// fabricated claim that an earlier Phase 1.2 result covers the new command.
const expectedRuntime = {
  serverBuildId: "r3-a-server-af8987322467",
  pluginBuildId: "r3-a-plugin-b5ee1c0b619a",
  schemaVersion: "1.11.0",
  fingerprint:
    "sha256:6a68b351880d0b204d1cdf90f14cb8258ce8bfe69bc5db4fbf0be7b14deb6428",
  toolCount: 67,
};

const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3a-variable-mode-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r3a-variable-mode-gate",
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
    runtime.plugin?.supportedCommands.includes("add_variable_mode"),
    "plugin lacks add_variable_mode — reload the DEV plugin",
  );
}

function collectionById(capabilities) {
  return (capabilities.collections || []).find(
    (collection) => collection.id === options["collection-id"],
  );
}

const record = {
  gate: "R3-A Phase 1.3 add_variable_mode ceiling refusal",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  collectionId: options["collection-id"],
  requestedModeName: options.name,
  artifactDirectory,
  expectedRuntime,
  artifactHashes: {
    server: await sha256OfFile(serverPath),
    plugin: await sha256OfFile(pluginPath),
  },
  checks: {},
  findings: [],
  stillOwed: [
    "Run only on a disposable file and a local collection already at its actual plan ceiling; this gate intentionally performs no setup or cleanup mutations.",
  ],
  success: false,
};

let failure = null;

try {
  await client.connect(transport);

  // Read the published server surface rather than trusting the checked-out source.
  const inventory = await client.listTools();
  const tool = inventory.tools.find((entry) => entry.name === "add_variable_mode");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(tool, "add_variable_mode is not in the published tool surface");
  const schema = tool.inputSchema ?? {};
  const description = String(tool.description ?? "");
  record.checks.publishedSchema = {
    required: schema.required ?? [],
    callerRequested: /caller-requested write/i.test(description),
    forbidsTemporaryProbe: /never creates a temporary collection or mode/i.test(description),
    forbidsRemoval: /nor calls removeMode/i.test(description),
    preservesRefusal: /refusal text verbatim/i.test(description),
  };
  assert.deepEqual(record.checks.publishedSchema.required, ["collectionId", "name"]);
  assert.equal(record.checks.publishedSchema.callerRequested, true);
  assert.equal(record.checks.publishedSchema.forbidsTemporaryProbe, true);
  assert.equal(record.checks.publishedSchema.forbidsRemoval, true);
  assert.equal(record.checks.publishedSchema.preservesRefusal, true);

  await joinWithRetry();
  const runtime = (await callJson("get_runtime_info")).value;
  assertRuntime(runtime);
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId ?? null,
    compatibility: runtime.compatibility.status,
  };

  // This is an inventory read only. It establishes the known-good count that must come
  // back in the refusal receipt; it never learns a plan limit by mutating the file.
  const beforeCapabilities = (await callJson("get_variable_capabilities")).value;
  assert.equal(beforeCapabilities.complete, true);
  const before = collectionById(beforeCapabilities);
  assert.ok(
    before,
    `collection ${options["collection-id"]} is not a local collection visible to get_variable_capabilities`,
  );
  assert.equal(before.isRemote, false);
  assert.equal(typeof before.modeCount, "number");
  record.checks.before = {
    modeCount: before.modeCount,
    modeCeiling: beforeCapabilities.modeCeiling,
  };

  // The one and only write. If it succeeds, the supplied collection was not at its ceiling;
  // do NOT add cleanup here, because the whole point is to avoid a speculative delete.
  const receipt = (
    await callJson("add_variable_mode", {
      collectionId: options["collection-id"],
      name: options.name,
    })
  ).value;
  record.checks.receipt = receipt;
  assert.equal(
    receipt.success,
    false,
    "add_variable_mode succeeded, so this collection was not at its plan ceiling. Do not remove the created mode with this gate; inspect the disposable file and choose a collection that is already limited.",
  );
  assert.equal(receipt.outcome, "refused");
  assert.equal(receipt.collection?.id, before.id);
  assert.equal(receipt.collection?.modeCountBefore, before.modeCount);
  assert.equal(receipt.collection?.modeCountAfter, before.modeCount);
  assert.equal(receipt.mode, null);
  assert.equal(typeof receipt.refusal, "string");
  const match = /^in addMode: Limited to (\d+) modes only\.?$/.exec(receipt.refusal);
  assert.ok(match, `Figma did not return its documented addMode ceiling refusal: ${receipt.refusal}`);
  const observedLimit = Number(match[1]);
  assert.equal(receipt.modeCeiling?.status, "observed");
  assert.equal(receipt.modeCeiling?.value, observedLimit);
  assert.equal(receipt.modeCeiling?.knownGoodAtLeast, before.modeCount);
  assert.match(receipt.modeCeiling?.limitation ?? "", /No create\/delete probe was performed/i);

  // A separate post-refusal read is evidence that the failed request did not change the
  // collection. The gate owns no cleanup path because it owns no created resource.
  const afterCapabilities = (await callJson("get_variable_capabilities")).value;
  assert.equal(afterCapabilities.complete, true);
  const after = collectionById(afterCapabilities);
  assert.ok(after, "target collection disappeared after the refusal");
  assert.equal(after.modeCount, before.modeCount);
  record.checks.after = {
    modeCount: after.modeCount,
    modeCeiling: afterCapabilities.modeCeiling,
  };
  record.stillOwed = [];
  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error && typeof error.message === "string" ? error.message : String(error);
} finally {
  record.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  await client.close().catch(() => undefined);
}

if (failure) {
  process.stderr.write(`R3-A Phase 1.3 variable-mode gate FAILED: ${record.failure}\n`);
  process.stderr.write(`Report: ${reportPath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`R3-A Phase 1.3 variable-mode gate PASSED: ${reportPath}\n`);
}
