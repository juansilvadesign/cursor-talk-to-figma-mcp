import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
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
  assert.equal(snapshot.tools.length, 53);
  assert.equal(snapshot.prompts.length, 6);
  assert.ok(snapshot.tools.every((tool) => ["read", "write", "connection"].includes(tool.direction)));
  assert.ok(snapshot.tools.every((tool) => ["stable", "additive-preview", "legacy"].includes(tool.resultStability)));
  assert.ok(
    snapshot.tools.every((tool) =>
      ["local", "preflight", "standard", "heavy_read", "heavy_batch"].includes(
        tool.timeoutClass,
      ),
    ),
  );
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

test("the current contract stays backwards compatible with every frozen release baseline", async () => {
  const built = await buildContract();
  const baselineDir = path.join(root, "contracts/baselines");
  const baselineFiles = (await readdir(baselineDir))
    .filter((name) => name.endsWith("-public-contract.json"))
    .sort();

  assert.ok(
    baselineFiles.length > 0,
    "at least one frozen release baseline must exist",
  );

  for (const file of baselineFiles) {
    const baseline = JSON.parse(
      await readFile(path.join(baselineDir, file), "utf8"),
    );
    assert.deepEqual(
      compatibilityErrors(baseline, built.contract),
      [],
      `current contract broke compatibility with ${file}`,
    );
  }
});

test("result stability may be strengthened across releases but never weakened", async () => {
  const snapshot = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  );

  const strengthened = structuredClone(snapshot);
  const promoted = strengthened.tools.find(
    (tool) => tool.name === "get_node_variables",
  );
  assert.equal(promoted.resultStability, "additive-preview");
  promoted.resultStability = "stable";
  assert.deepEqual(compatibilityErrors(snapshot, strengthened), []);

  const weakened = structuredClone(snapshot);
  weakened.tools.find((tool) => tool.name === "get_node_variables").resultStability =
    "legacy";
  assert.match(
    compatibilityErrors(snapshot, weakened).join("\n"),
    /get_node_variables\.resultStability was weakened/,
  );
});

test("every read whose cost scales with the file declares the heavy budget", async () => {
  // R1's live gate found export_node_as_image running on the 30s default while every
  // other cost-scaling read declared the heavy class — and 30s is precisely the budget
  // the multi-megabyte exports filePath exists for will exceed. get_node_variables is
  // here for the same reason: a bounded scan of up to 5000 nodes is still not a 30s job.
  const built = await buildContract();
  const byName = new Map(built.contract.tools.map((tool) => [tool.name, tool]));

  for (const name of [
    "get_document_info",
    "get_pages",
    "get_styles",
    "get_local_components",
    "export_node_as_image",
    "get_node_variables",
  ]) {
    assert.equal(
      byName.get(name).timeoutClass,
      "heavy_read",
      `${name} must declare the heavy read budget`,
    );
  }
});

test("export declares its bounded cost preflight and explicit large-request override", async () => {
  const built = await buildContract();
  const exported = built.contract.tools.find(
    (tool) => tool.name === "export_node_as_image",
  );

  assert.equal(exported.progress.pluginUpdates, "preflight_and_encoding");
  assert.deepEqual(exported.inputSchema.properties.allowLargeExport, {
    type: "boolean",
    default: false,
    description:
      "Explicitly accept the risk of a PNG/JPG export above the 16 MP safety ceiling (default: false). A timed-out Figma export cannot be cancelled and may leave the plugin unresponsive; prefer reducing scale or exporting a smaller node.",
  });
  assert.ok(
    !exported.inputSchema.required.includes("allowLargeExport"),
    "existing callers must remain valid and receive the safe default",
  );
});

test("a timeout budget may be raised across releases but never lowered", async () => {
  const snapshot = JSON.parse(
    await readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  );

  // Raising is what R2 did to export_node_as_image. It cannot break a consumer that
  // was already prepared to wait less, so the guard must allow it.
  const raised = structuredClone(snapshot);
  const raisedTool = raised.tools.find((tool) => tool.name === "get_node_info");
  assert.equal(raisedTool.timeoutClass, "standard");
  raisedTool.timeoutClass = "heavy_read";
  assert.deepEqual(compatibilityErrors(snapshot, raised), []);

  // Lowering is the real break: a call that used to finish starts timing out.
  const lowered = structuredClone(snapshot);
  lowered.tools.find((tool) => tool.name === "get_styles").timeoutClass =
    "standard";
  assert.match(
    compatibilityErrors(snapshot, lowered).join("\n"),
    /get_styles\.timeoutClass was lowered/,
  );
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
