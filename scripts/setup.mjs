#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

run("bun", ["install", "--frozen-lockfile"]);
run("bun", ["run", "build"]);

const serverPath = path.join(root, "dist/server.js");
const config = {
  mcpServers: {
    TalkToFigma: {
      command: process.execPath,
      args: [serverPath],
    },
  },
};
const serialized = `${JSON.stringify(config, null, 2)}\n`;

await mkdir(path.join(root, ".cursor"), { recursive: true });
await Promise.all([
  writeFile(path.join(root, ".cursor/mcp.json"), serialized),
  writeFile(path.join(root, ".mcp.json"), serialized),
]);

process.stdout.write(
  `Local fork MCP configuration written for ${serverPath}\nNo npm \"latest\" package is selected.\n`,
);
