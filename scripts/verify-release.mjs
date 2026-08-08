#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  process.stdout.write(`> ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, ["scripts/generate-contract.mjs"]);
run(process.execPath, ["--check", "src/cursor_mcp_plugin/code.js"]);
run(process.execPath, ["--test"]);
run("bun", ["run", "build"]);

const [snapshotText, runtimeText, distText] = await Promise.all([
  readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  readFile(path.join(root, "src/talk_to_figma_mcp/runtime-metadata.ts"), "utf8"),
  readFile(path.join(root, "dist/server.js"), "utf8"),
]);
const snapshot = JSON.parse(snapshotText);
const missing = [...snapshot.tools, ...snapshot.prompts]
  .map((entry) => entry.name)
  .filter((name) => !distText.includes(JSON.stringify(name)));
if (missing.length > 0) {
  throw new Error(`dist/server.js is missing registrations: ${missing.join(", ")}`);
}
for (const identity of [
  snapshot.capabilityFingerprint,
  /"serverBuildId":\s*"([^"]+)"/.exec(runtimeText)?.[1],
]) {
  if (!identity || !distText.includes(identity)) {
    throw new Error(`dist/server.js is missing runtime identity ${identity}`);
  }
}

process.stdout.write(
  `${snapshot.release} offline gate passed: ${snapshot.tools.length} tools, ${snapshot.prompts.length} prompts, source/runtime parity verified.\n`,
);
