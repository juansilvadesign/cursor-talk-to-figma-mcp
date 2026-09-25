#!/usr/bin/env node

// G6 compares readback against a table recorded independently by the owner in Figma's UI.
import { writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseGateOptions, requireDisposableTarget } from "./r3.1-live-gate-lib.mjs";
import { classifyR331ReactionsVerdict, runR331ReadGate } from "./r3.3.1-live-gate-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseGateOptions();
const usage = "Usage: node scripts/live-r3.3.1-reactions-gate.mjs --channel=<channel> --disposable-target=true --fixture=<owner-recorded-json> --no-reaction-node-id=<id> [--output-dir=<dir>]";
if (!options.channel || options["disposable-target"] !== "true") {
  writeSync(2, `${usage}\n`);
  process.exit(2);
}
requireDisposableTarget(options, usage, "G6 requires an owner-confirmed disposable Figma file.");
if (!options.fixture || !options["no-reaction-node-id"]) {
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

let fixtureRows;
try { fixtureRows = JSON.parse(await readFile(path.resolve(options.fixture), "utf8")); }
catch { fixtureRows = null; }

await runR331ReadGate({
  root, options, expectedRuntime, name: "R3.3.1 G6 reactions",
  requiredCommands: ["get_reactions", "get_node_info"],
  allowedTools: ["get_reactions", "get_node_info"],
  observe: async (read) => {
    const observations = {};
    const destinations = {};
    if (Array.isArray(fixtureRows)) {
      for (const row of fixtureRows) {
        if (typeof row?.nodeId === "string") {
          observations[row.nodeId] = await read("get_reactions", { nodeIds: [row.nodeId] });
        }
        for (const action of row?.actions || []) {
          if (typeof action.destinationId === "string" && !destinations[action.destinationId]) {
            destinations[action.destinationId] = await read("get_node_info", {
              nodeId: action.destinationId,
            });
          }
        }
      }
    }
    const control = await read("get_reactions", {
      nodeIds: [options["no-reaction-node-id"]],
    });
    return { fixtureRows, observations, destinations, control };
  },
  classify: classifyR331ReactionsVerdict,
});
