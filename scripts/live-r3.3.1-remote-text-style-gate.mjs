#!/usr/bin/env node

// G5 reads an owner-confirmed disposable file. Its target and controls are arguments,
// and the remote attachment is observed independently before the token read.
import { writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseGateOptions, requireDisposableTarget } from "./r3.1-live-gate-lib.mjs";
import { classifyR331RemoteTextStyleVerdict, runR331ReadGate } from "./r3.3.1-live-gate-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseGateOptions();
const usage = "Usage: node scripts/live-r3.3.1-remote-text-style-gate.mjs --channel=<channel> --disposable-target=true --target-node-id=<id> --text-control-node-id=<id> --paint-control-node-id=<id> [--container-node-id=<id>] [--output-dir=<dir>]";
if (!options.channel || options["disposable-target"] !== "true") {
  writeSync(2, `${usage}\n`);
  process.exit(2);
}
requireDisposableTarget(options, usage, "G5 requires an owner-confirmed disposable Figma file.");
if (!options["target-node-id"] || !options["text-control-node-id"] || !options["paint-control-node-id"]) {
  writeSync(2, `${usage}\n`);
  process.exit(2);
}

const expectedRuntime = {
  serverBuildId: "r3.3.1-server-9c8cb843a656",
  pluginBuildId: "r3.3.1-plugin-41fd0e925b27",
  schemaVersion: "1.23.0",
  fingerprint: "sha256:541d14db086baaf326b751b2d2ebbbdd3dcacd81a68e5674584fcc19d204b2a1",
  release: "R3.3.1",
  toolCount: 103,
};

await runR331ReadGate({
  root, options, expectedRuntime, name: "R3.3.1 G5 remote TEXT style",
  requiredCommands: ["get_node_style_attachment", "get_node_variables"],
  allowedTools: ["get_node_style_attachment", "get_node_variables"],
  observe: async (read) => {
    const attachment = await read("get_node_style_attachment", {
      nodeId: options["target-node-id"], kind: "text",
    });
    // Independent observation is deliberately first. A nonremote target is unmeasured.
    if (attachment?.value?.attachment?.origin !== "remote") return { attachment };
    const target = await read("get_node_variables", { nodeId: options["target-node-id"] });
    const container = options["container-node-id"]
      ? await read("get_node_variables", { nodeId: options["container-node-id"] }) : null;
    const textControl = await read("get_node_variables", { nodeId: options["text-control-node-id"] });
    const paintControl = await read("get_node_variables", { nodeId: options["paint-control-node-id"] });
    return { attachment, target, container, textControl, paintControl,
      hasContainer: Boolean(options["container-node-id"]) };
  },
  classify: classifyR331RemoteTextStyleVerdict,
});
