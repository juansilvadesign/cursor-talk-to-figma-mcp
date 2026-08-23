/**
 * R2.4 Phase 4.1 — the wrapper layer, asserted through a real MCP transport.
 *
 * ⭐ The defect this file exists for was not a bug in the plugin. Phase 4.1 gave all
 * three shipped batch tools the unified `outcome/succeeded/failed/skipped/total`, and
 * `tests/legacy-batch-alignment.test.mjs` proved it — by calling the plugin handler.
 * Two of the three MCP wrappers then threw those fields away while formatting prose, and
 * every offline test stayed green because not one of them crossed the wrapper.
 *
 * So the assertions below are deliberately made at the only place that can catch it: the
 * return value of `client.callTool`, over stdio, through a relay, from the real plugin
 * source. Nothing in this file supplies an `outcome` — if the wrapper drops it, no
 * amount of test-side generosity puts it back.
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { BATCH_OUTCOMES } from "../src/talk_to_figma_mcp/batch-receipt.mjs";
import { attachFakePlugin, startFakeRelay } from "./helpers/fake-relay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FRAME = "10:1";
const TEXT = "10:2";
const FOOTER = "10:5";
const MISSING = "9:9";

/**
 * Stand up relay + plugin + a connected MCP client, joined to a channel and past the
 * compatibility preflight, then hand them to `body` and tear all three down.
 */
async function withLiveStack(body, { harnessOptions } = {}) {
  const relay = await startFakeRelay();
  const channel = `offline-${Math.random().toString(36).slice(2, 10)}`;
  const plugin = await attachFakePlugin({ port: relay.port, channel, harnessOptions });

  const client = new Client({ name: "wrapper-e2e", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["src/talk_to_figma_mcp/server.ts", `--port=${relay.port}`],
    cwd: root,
    stderr: "pipe",
  });

  try {
    await client.connect(transport);

    // The server opens its relay socket from main() without awaiting it, so the first
    // join can land before the socket is OPEN and answer "Not connected to Figma" — an
    // error string inside an otherwise successful tool result. Retry the join rather
    // than sleeping a guessed amount, and let the LAST attempt's text be what gets
    // asserted, so a genuine failure still fails.
    let joinText = "";
    for (let attempt = 0; attempt < 25; attempt++) {
      const joined = await client.callTool({ name: "join_channel", arguments: { channel } });
      joinText = joined.content.map((entry) => entry.text).join("\n");
      if (/Successfully joined channel/.test(joinText)) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // ⛔ A failed join returns an error STRING with a 200-shaped result, so an
    // unasserted join would let every case below "pass" against a disconnected server.
    assert.match(joinText, /Successfully joined channel/, `join failed: ${joinText}`);
    await body({ client, plugin });
  } finally {
    await client.close().catch(() => undefined);
    plugin.close();
    await relay.close();
  }
}

/** The JSON receipt is the LAST content item; the prose blocks keep positions 0 and 1. */
function receipt(result) {
  const texts = result.content.filter((entry) => entry.type === "text").map((entry) => entry.text);
  const last = texts[texts.length - 1];
  try {
    return JSON.parse(last);
  } catch {
    assert.fail(
      `the reply carries no JSON receipt — the wrapper discarded the plugin's unified fields.\nlast content item was:\n${last}`,
    );
  }
}

function assertUnified(reply, expected) {
  assert.ok(BATCH_OUTCOMES.includes(reply.outcome), `unknown outcome ${reply.outcome}`);
  assert.equal(reply.outcome, expected.outcome);
  assert.equal(reply.total, expected.total);
  assert.equal(reply.succeeded, expected.succeeded);
  assert.equal(reply.failed, expected.failed);
  assert.equal(
    reply.succeeded + reply.failed + reply.skipped,
    reply.total,
    "the unified counts must sum to the unified total",
  );
}

test(
  "set_multiple_text_contents delivers the unified fields to an MCP consumer",
  { timeout: 30000 },
  async () => {
    await withLiveStack(async ({ client }) => {
      const result = await client.callTool({
        name: "set_multiple_text_contents",
        arguments: {
          nodeId: FRAME,
          text: [
            { nodeId: TEXT, text: "Replaced" },
            { nodeId: FOOTER, text: "Also replaced" },
          ],
        },
      });

      assertUnified(receipt(result), {
        outcome: "all_succeeded",
        total: 2,
        succeeded: 2,
        failed: 0,
      });

      // ⛔ Additive: the two prose items that shipped before are still first, still worded
      // the same way. This is the half of the change that must NOT be visible.
      const texts = result.content.map((entry) => entry.text);
      assert.match(texts[0], /^Starting text replacement for 2 nodes\./);
      assert.match(texts[1], /Text replacement completed:/);
      assert.match(texts[1], /- 2 of 2 successfully updated/);
      assert.match(texts[1], /- 0 failed/);

      // And every legacy field survives alongside the unified ones.
      const reply = receipt(result);
      assert.equal(reply.success, true);
      assert.equal(reply.nodeId, FRAME);
      assert.equal(reply.replacementsApplied, 2);
      assert.equal(reply.replacementsFailed, 0);
      assert.equal(reply.totalReplacements, 2);
    });
  },
);

test(
  "set_multiple_annotations delivers the unified fields to an MCP consumer",
  { timeout: 30000 },
  async () => {
    await withLiveStack(async ({ client }) => {
      const result = await client.callTool({
        name: "set_multiple_annotations",
        arguments: {
          nodeId: FRAME,
          annotations: [{ nodeId: TEXT, labelMarkdown: "annotated" }],
        },
      });

      const reply = receipt(result);
      assert.ok(BATCH_OUTCOMES.includes(reply.outcome), `unknown outcome ${reply.outcome}`);
      assert.equal(reply.total, 1);
      assert.equal(reply.succeeded + reply.failed + reply.skipped, reply.total);
      assert.equal(typeof reply.annotationsApplied, "number");

      const texts = result.content.map((entry) => entry.text);
      // ⚠️ The opening line no longer promises batching this tool has never done.
      assert.doesNotMatch(texts[0], /batches of 5/);
      assert.match(texts[0], /one at a time/);
      // ⚠️ …and the summary no longer fabricates a chunk count out of `|| 1`.
      assert.doesNotMatch(texts[1], /Processed in 1 batches/);
      assert.match(texts[1], /Processed one at a time/);
    });
  },
);

test(
  "delete_multiple_nodes keeps delivering the unified fields",
  { timeout: 30000 },
  async () => {
    await withLiveStack(async ({ client }) => {
      const result = await client.callTool({
        name: "delete_multiple_nodes",
        arguments: { nodeIds: ["10:3", "10:4"] },
      });

      assertUnified(receipt(result), {
        outcome: "all_succeeded",
        total: 2,
        succeeded: 2,
        failed: 0,
      });
      assert.equal(receipt(result).nodesDeleted, 2);
    });
  },
);

test(
  "a partial batch reports partial to the consumer, where the legacy success flag says true",
  { timeout: 30000 },
  async () => {
    await withLiveStack(async ({ client }) => {
      const result = await client.callTool({
        name: "set_multiple_text_contents",
        arguments: {
          nodeId: FRAME,
          text: [
            { nodeId: TEXT, text: "Replaced" },
            { nodeId: MISSING, text: "Never lands" },
          ],
        },
      });

      const reply = receipt(result);
      // ⭐ Finding 1, now visible to a consumer for the first time on this tool: the
      // legacy flag reports success for a batch that half failed, and `outcome` is the
      // field that does not. Before this change a caller had only the flag.
      assert.equal(reply.success, true);
      assertUnified(reply, { outcome: "partial", total: 2, succeeded: 1, failed: 1 });

      const texts = result.content.map((entry) => entry.text);
      assert.match(texts[1], /- 1 failed/);
      assert.match(texts[1], /Nodes that failed:/);
      assert.match(texts[1], new RegExp(MISSING));
    });
  },
);

test(
  "the plugin — not the test — is what supplies the unified fields",
  { timeout: 30000 },
  async () => {
    await withLiveStack(async ({ client, plugin }) => {
      const result = await client.callTool({
        name: "set_multiple_text_contents",
        arguments: { nodeId: FRAME, text: [{ nodeId: TEXT, text: "Replaced" }] },
      });

      // ⭐ The question to ask of any PASS: which component supplied the signal? Here the
      // relay carried a command the fake plugin answered out of the REAL plugin source,
      // and the fields below were computed there. Nothing in this file writes an outcome.
      const observed = plugin.commandsSeen.map((entry) => entry.command);
      assert.ok(
        observed.includes("set_multiple_text_contents"),
        `the plugin never received the command; observed ${JSON.stringify(observed)}`,
      );
      const direct = await plugin.harness.command("set_multiple_text_contents", {
        nodeId: FRAME,
        text: [{ nodeId: FOOTER, text: "Direct" }],
      });
      assert.equal(receipt(result).outcome, direct.outcome);
    });
  },
);

/**
 * R2.7 Phase 2. This tool is the exact defect class this FILE was created for: its wrapper
 * formats a prose sentence, and the CROP repair's whole value lives in fields that sentence
 * could quietly drop. `imageTransform` is what distinguishes a crop from a stretch — the mode
 * name cannot, in either vocabulary — so a wrapper that kept the prose and lost the receipt
 * would leave the repair working and unobservable, with every plugin-level test still green.
 */
test(
  "set_image_fill delivers its CROP receipt through the wrapper, not just a prose line",
  { timeout: 30000 },
  async () => {
    await withLiveStack(async ({ client }) => {
      const imageTransform = [[0.5, 0, 0.25], [0, 0.5, 0.25]];
      const result = await client.callTool({
        name: "set_image_fill",
        arguments: {
          nodeId: "10:3",
          imageBase64: Buffer.from("iVBORw0KGgo=", "base64").toString("base64"),
          scaleMode: "CROP",
          imageTransform,
        },
      });

      const texts = result.content
        .filter((entry) => entry.type === "text")
        .map((entry) => entry.text);
      const combined = texts.join("\n");

      // ⛔ The historical prose line is load-bearing — several gates parse it — so the
      // receipt is APPENDED, never substituted. Both halves are asserted so a future
      // "tidy-up" cannot drop either one silently.
      assert.match(combined, /Set image fill of node "/, "the historical prose line vanished");

      const start = combined.lastIndexOf("\n{");
      assert.ok(start >= 0, `the wrapper published no JSON receipt:\n${combined}`);
      const reply = JSON.parse(combined.slice(start + 1));

      assert.deepEqual(
        reply.imageTransform,
        imageTransform,
        "the wrapper dropped imageTransform — the one field that tells a crop from a stretch",
      );
      assert.equal(reply.imageTransformSource, "caller");
      assert.equal(reply.scaleModeReadable, true);
    });
  },
);

test(
  "a bare CROP is refused across the wrapper, and the refusal names the stretch",
  { timeout: 30000 },
  async () => {
    await withLiveStack(async ({ client }) => {
      const result = await client.callTool({
        name: "set_image_fill",
        arguments: {
          nodeId: "10:3",
          imageBase64: Buffer.from("iVBORw0KGgo=", "base64").toString("base64"),
          scaleMode: "CROP",
        },
      });
      const combined = result.content
        .filter((entry) => entry.type === "text")
        .map((entry) => entry.text)
        .join("\n");

      // ⛔ Refused by the HANDLER, not by a narrowed schema enum: CROP is still a valid
      // enum value, and narrowing it would have been a breaking change this repair avoided.
      assert.match(combined, /Error setting image fill/);
      assert.match(combined, /requires imageTransform/);
      assert.match(combined, /renders a STRETCH, not a crop/);
    });
  },
);
