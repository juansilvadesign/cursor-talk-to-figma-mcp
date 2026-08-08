import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildContract,
  compatibilityErrors,
  parityErrors,
} from "../scripts/contract-lib.mjs";
import { comparePluginRuntimeMetadata } from "../src/talk_to_figma_mcp/runtime-compatibility.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("public snapshot remains backwards compatible and generated metadata is current", async () => {
  const built = await buildContract();
  const snapshot = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  );
  assert.deepEqual(parityErrors(built.surface), []);
  assert.deepEqual(compatibilityErrors(snapshot, built.contract), []);
  assert.equal(snapshot.tools.length, 49);
  assert.equal(snapshot.prompts.length, 6);
  assert.ok(snapshot.tools.every((tool) => ["read", "write", "connection"].includes(tool.direction)));
  assert.ok(snapshot.tools.every((tool) => ["stable", "additive-preview", "legacy"].includes(tool.resultStability)));
});

test("parity guard is observed failing when a dispatcher command disappears", async () => {
  const built = await buildContract();
  const broken = {
    ...built.surface,
    pluginCommands: built.surface.pluginCommands.filter(
      (command) => command !== "get_document_info",
    ),
  };
  assert.match(parityErrors(broken).join("\n"), /get_document_info.*dispatcher/);
});

test("snapshot guard rejects removals and incompatible parameters but accepts additive optional fields", async () => {
  const snapshot = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  );
  const broken = structuredClone(snapshot);
  const nodeInfo = broken.tools.find((tool) => tool.name === "get_node_info");
  delete nodeInfo.inputSchema.properties.nodeId;
  assert.match(compatibilityErrors(snapshot, broken).join("\n"), /nodeId was removed/);

  const additive = structuredClone(snapshot);
  additive.tools
    .find((tool) => tool.name === "get_node_info")
    .inputSchema.properties.preview = { type: "boolean" };
  assert.deepEqual(compatibilityErrors(snapshot, additive), []);
});

test("README tool and prompt names exactly match the generated inventory", async () => {
  const [built, readme] = await Promise.all([
    buildContract(),
    readFile(path.join(root, "README.md"), "utf8"),
  ]);
  const toolsSection = readme.split("## MCP Tools")[1]?.split("## Development")[0];
  assert.ok(toolsSection, "README must contain an MCP Tools section");
  const [toolText, promptText = ""] = toolsSection.split("### MCP Prompts");
  const extract = (text) =>
    [...text.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]).sort();
  assert.deepEqual(
    extract(toolText),
    built.contract.tools.map((tool) => tool.name).sort(),
  );
  assert.deepEqual(
    extract(promptText),
    built.contract.prompts.map((prompt) => prompt.name).sort(),
  );
});

test("the direct plugin runtime parses independently of the server build", () => {
  const result = spawnSync(
    process.execPath,
    ["--check", "src/cursor_mcp_plugin/code.js"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("runtime preflight accepts the exact pair and rejects stale or incomplete plugins", async () => {
  const { runtime } = await buildContract();
  const plugin = {
    buildId: runtime.pluginBuildId,
    apiVersion: runtime.pluginApiVersion,
    serverSchemaVersion: runtime.serverSchemaVersion,
    relayProtocolVersion: runtime.relayProtocolVersion,
    capabilityFingerprint: runtime.capabilityFingerprint,
    supportedCommands: [...runtime.supportedCommands],
  };
  const compatible = comparePluginRuntimeMetadata(
    runtime,
    plugin,
    "2026-08-07T00:00:00.000Z",
  );
  assert.equal(compatible.status, "compatible");
  assert.deepEqual(compatible.issues, []);

  const stale = comparePluginRuntimeMetadata(runtime, {
    ...plugin,
    buildId: "old-plugin",
    capabilityFingerprint: "sha256:old",
    supportedCommands: plugin.supportedCommands.filter(
      (command) => command !== "get_runtime_info",
    ),
  });
  assert.equal(stale.status, "incompatible");
  assert.match(stale.issues.join("\n"), /Plugin build mismatch/);
  assert.match(stale.issues.join("\n"), /Capability fingerprint mismatch/);
  assert.match(stale.issues.join("\n"), /missing commands: get_runtime_info/);
});
