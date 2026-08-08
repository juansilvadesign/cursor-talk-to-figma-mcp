#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  PLUGIN_PATH,
  SERVER_RUNTIME_PATH,
  SNAPSHOT_PATH,
  buildContract,
  compatibilityErrors,
  parityErrors,
  renderPluginRuntime,
  renderServerRuntime,
  renderSnapshot,
  withPluginRuntime,
} from "./contract-lib.mjs";

const mode = process.argv.includes("--write") ? "write" : "check";

async function writeAtomic(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, filePath);
}

const built = await buildContract();
const parity = parityErrors(built.surface);
if (parity.length > 0) {
  throw new Error(`Command parity failed:\n- ${parity.join("\n- ")}`);
}

const renderedSnapshot = renderSnapshot(built.contract);
const renderedServerRuntime = renderServerRuntime(built.runtime);
const renderedPluginRuntime = renderPluginRuntime(built.runtime);
const renderedPlugin = withPluginRuntime(
  built.sources.pluginSource,
  renderedPluginRuntime,
);

if (mode === "write") {
  await writeAtomic(SNAPSHOT_PATH, renderedSnapshot);
  await writeAtomic(SERVER_RUNTIME_PATH, renderedServerRuntime);
  await writeAtomic(PLUGIN_PATH, renderedPlugin);
  process.stdout.write(
    `Wrote ${built.contract.tools.length} tools, ${built.contract.prompts.length} prompts, and runtime metadata.\n`,
  );
} else {
  const [snapshotText, serverRuntimeText] = await Promise.all([
    readFile(SNAPSHOT_PATH, "utf8"),
    readFile(SERVER_RUNTIME_PATH, "utf8"),
  ]);
  const snapshot = JSON.parse(snapshotText);
  const compatibility = compatibilityErrors(snapshot, built.contract);
  const generatedErrors = [];
  if (serverRuntimeText !== renderedServerRuntime) {
    generatedErrors.push(
      "src/talk_to_figma_mcp/runtime-metadata.ts is stale",
    );
  }
  if (built.sources.pluginSource !== renderedPlugin) {
    generatedErrors.push("plugin runtime metadata is stale");
  }
  if (compatibility.length > 0 || generatedErrors.length > 0) {
    throw new Error(
      [
        ...compatibility.map((error) => `Contract: ${error}`),
        ...generatedErrors,
        "Run `bun run contract:generate` after reviewing the public change.",
      ].join("\n"),
    );
  }
  process.stdout.write(
    `Contract OK: ${built.contract.tools.length} tools, ${built.contract.prompts.length} prompts, ${built.surface.pluginCommands.length} plugin commands.\n`,
  );
}
