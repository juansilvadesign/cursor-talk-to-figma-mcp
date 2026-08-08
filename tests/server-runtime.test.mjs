import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { buildContract } from "../scripts/contract-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test(
  "source MCP server exposes the frozen inventory and server identity without a plugin",
  { timeout: 15000 },
  async () => {
    const built = await buildContract();
    const client = new Client({ name: "r0-offline-probe", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["src/talk_to_figma_mcp/server.ts"],
      cwd: root,
      stderr: "pipe",
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        built.contract.tools.map((tool) => tool.name).sort(),
      );

      const result = await client.callTool({
        name: "get_runtime_info",
        arguments: {},
      });
      const text = result.content.find((entry) => entry.type === "text")?.text;
      const runtime = JSON.parse(text);
      assert.equal(runtime.server.buildId, built.runtime.serverBuildId);
      assert.equal(
        runtime.server.capabilityFingerprint,
        built.runtime.capabilityFingerprint,
      );
      assert.equal(runtime.plugin, null);
      assert.equal(runtime.compatibility.status, "not_checked");
      assert.match(runtime.compatibility.issues.join("\n"), /join a channel/i);
    } finally {
      await client.close().catch(() => undefined);
    }
  },
);
