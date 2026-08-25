import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export function parseGateOptions(argumentsList = process.argv.slice(2)) {
  return Object.fromEntries(
    argumentsList.map((argument) => {
      const [key, ...rest] = argument.replace(/^--/, "").split("=");
      return [key, rest.join("=")];
    }),
  );
}

export function requireDisposableTarget(options, usage, risk) {
  if (!options.channel) {
    process.stderr.write(`${usage}\n`);
    process.exit(2);
  }
  if (options["disposable-target"] !== "true") {
    process.stderr.write(
      `Refusing to run: pass --disposable-target=true only after the channel is connected to an owner-confirmed disposable Figma file. ${risk}\n`,
    );
    process.exit(2);
  }
}

function textContent(result) {
  return (result.content || [])
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
}

export async function openR31Gate({
  root,
  options,
  expectedRuntime,
  name,
  requiredCommands,
}) {
  const serverPath = options.server
    ? path.resolve(options.server)
    : path.join(root, "dist/server.js");
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: root,
    stderr: "pipe",
  });

  async function callRaw(toolName, args = {}, timeout = 120_000) {
    return client.callTool({ name: toolName, arguments: args }, undefined, {
      timeout,
      maxTotalTimeout: timeout,
    });
  }

  async function call(toolName, args = {}, timeout = 120_000) {
    const result = await callRaw(toolName, args, timeout);
    const text = textContent(result);
    if (result.isError || /^Error\b/.test(text)) {
      throw new Error(`${toolName} failed: ${text || "unknown MCP error"}`);
    }
    return { result, text };
  }

  async function callJson(toolName, args = {}, timeout = 120_000) {
    const called = await call(toolName, args, timeout);
    return { ...called, value: JSON.parse(called.text) };
  }

  async function callNodeId(toolName, args = {}) {
    const called = await call(toolName, args);
    const start = called.text.indexOf("{");
    const end = called.text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(called.text.slice(start, end + 1));
      if (parsed?.id) return parsed.id;
    }
    const match = called.text.match(/with (?:new )?ID:\s*([^.\s]+)/);
    assert.ok(match, `${toolName} returned neither JSON nor a prose node id: ${called.text}`);
    return match[1];
  }

  async function callExpectingRefusal(toolName, args = {}, timeout = 120_000) {
    let message;
    let layer;
    try {
      const result = await callRaw(toolName, args, timeout);
      message = textContent(result);
      assert.ok(
        result.isError || /^Error\b/.test(message),
        `${toolName} was expected to refuse ${JSON.stringify(args)} but succeeded: ${message}`,
      );
      layer = "handler";
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      layer = "schema";
    }
    return { layer, message };
  }

  async function joinWithRetry() {
    let lastError;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        return await call("join_channel", { channel: options.channel });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!/Not connected to Figma/.test(message) || attempt === 10) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw lastError;
  }

  function assertRuntime(runtime) {
    assert.equal(runtime.server.release, expectedRuntime.release);
    assert.equal(runtime.server.buildId, expectedRuntime.serverBuildId);
    assert.equal(runtime.server.schemaVersion, expectedRuntime.schemaVersion);
    assert.equal(runtime.server.capabilityFingerprint, expectedRuntime.fingerprint);
    assert.equal(runtime.plugin?.release, expectedRuntime.release);
    assert.equal(
      runtime.plugin?.buildId,
      expectedRuntime.pluginBuildId,
      "plugin build is stale — reload the DEV plugin before this gate",
    );
    assert.equal(runtime.plugin?.apiVersion, expectedRuntime.schemaVersion);
    assert.equal(runtime.plugin?.serverSchemaVersion, expectedRuntime.schemaVersion);
    assert.equal(runtime.plugin?.capabilityFingerprint, expectedRuntime.fingerprint);
    assert.equal(runtime.compatibility.status, "compatible");
    assert.deepEqual(runtime.compatibility.issues, []);
    for (const command of requiredCommands) {
      assert.ok(runtime.server.supportedTools.includes(command), `server lacks ${command}`);
      assert.ok(
        runtime.plugin?.supportedCommands.includes(command),
        `plugin lacks ${command} — reload the DEV plugin`,
      );
    }
  }

  async function connectAndAssert() {
    await client.connect(transport);
    const inventory = await client.listTools();
    assert.equal(inventory.tools.length, expectedRuntime.toolCount);
    await joinWithRetry();
    const runtime = (await callJson("get_runtime_info")).value;
    assertRuntime(runtime);
    return { inventory, runtime };
  }

  return {
    serverPath,
    client,
    call,
    callRaw,
    callJson,
    callNodeId,
    callExpectingRefusal,
    connectAndAssert,
    close: () => client.close().catch(() => undefined),
  };
}
