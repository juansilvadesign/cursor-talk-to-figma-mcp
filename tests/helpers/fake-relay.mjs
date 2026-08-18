/**
 * A relay + plugin standing in for the live pair, so the MCP WRAPPER layer can be
 * asserted offline.
 *
 * ⭐ This exists because of what the 5.6 live pass recorded: the offline suite proved
 * Phase 4.1 by calling the plugin handler directly, and every test passed while two of
 * the three tools discarded the result on its way to a consumer. A test that loads the
 * layer it is verifying can only ever prove that layer. The only way to catch a wrapper
 * that drops a field is to send a real MCP `callTool` through a real transport and read
 * what comes back — which is what this makes cheap enough to run in `node --test`.
 *
 * Two fakes, and it matters which is which:
 *   - The RELAY is faked (a ~40-line rebuild of `src/socket.ts`'s join/broadcast rules)
 *     because the real one is a Bun script hardcoded to port 3055 and would collide with
 *     a live session.
 *   - The PLUGIN is NOT faked. Commands run through the same `vm` harness the rest of
 *     the suite uses, executing the real `src/cursor_mcp_plugin/code.js`. So the unified
 *     fields these tests read are computed by the shipping plugin code, not planted by
 *     the test — the distinction that made three green live runs meaningless once.
 */

import { WebSocketServer } from "ws";

import { loadPluginHarness } from "./plugin-harness.mjs";

/**
 * The relay's contract, reimplemented: join registers a socket against a channel and is
 * acknowledged twice (a human-readable line, then the `{id, result}` the MCP server's
 * pending-request table is actually waiting on); a message is broadcast to every OTHER
 * socket in the channel; progress updates are forwarded the same way.
 */
export async function startFakeRelay() {
  const channels = new Map();
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "system", message: "Please join a channel to start chatting" }));

    socket.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (data.type === "join") {
        if (!channels.has(data.channel)) channels.set(data.channel, new Set());
        channels.get(data.channel).add(socket);
        socket.send(JSON.stringify({
          type: "system",
          message: `Joined channel: ${data.channel}`,
          channel: data.channel,
        }));
        socket.send(JSON.stringify({
          type: "system",
          message: { id: data.id, result: "Connected to channel: " + data.channel },
          channel: data.channel,
        }));
        return;
      }

      const peers = channels.get(data.channel);
      if (!peers || !peers.has(socket)) return;

      if (data.type === "message") {
        for (const peer of peers) {
          if (peer === socket || peer.readyState !== peer.OPEN) continue;
          peer.send(JSON.stringify({
            type: "broadcast",
            message: data.message,
            sender: "peer",
            channel: data.channel,
          }));
        }
        return;
      }

      if (data.type === "progress_update") {
        for (const peer of peers) {
          if (peer === socket || peer.readyState !== peer.OPEN) continue;
          peer.send(JSON.stringify(data));
        }
      }
    });

    socket.on("close", () => {
      for (const peers of channels.values()) peers.delete(socket);
    });
  });

  return {
    port: wss.address().port,
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}

/**
 * Join `channel` as the plugin half, answering commands out of the real plugin source.
 *
 * ⚠️ The reply shape is copied from `ui.html`'s `sendSuccessResponse` /
 * `sendErrorResponse`, including the detail that an error still carries `result: {}` —
 * the MCP server checks `error` first, so getting this wrong would silently turn every
 * plugin refusal into a resolved call.
 */
export async function attachFakePlugin({ port, channel, harnessOptions = {} }) {
  const { default: WebSocket } = await import("ws");
  const harness = await loadPluginHarness(harnessOptions);
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const seen = [];

  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ id: "plugin-join", type: "join", channel }));

  socket.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (data.type !== "broadcast" || !data.message?.command) return;

    const { id, command, params } = data.message;
    seen.push({ command, params });
    try {
      const result = await harness.command(command, params || {});
      socket.send(JSON.stringify({ id, type: "message", channel, message: { id, result } }));
    } catch (error) {
      socket.send(JSON.stringify({
        id,
        type: "message",
        channel,
        message: { id, error: error instanceof Error ? error.message : String(error), result: {} },
      }));
    }
  });

  // The MCP server's join resolves on the relay's ack, not on ours, so it can race ahead
  // and probe get_runtime_info before this socket has been registered to the channel.
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    harness,
    commandsSeen: seen,
    close() {
      socket.terminate();
    },
  };
}
