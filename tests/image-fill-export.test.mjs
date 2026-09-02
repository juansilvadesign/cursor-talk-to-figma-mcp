import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

function pngWith(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test("an exact IMAGE fill returns original bytes and its placement metadata without rasterizing the node", async () => {
  const bytes = pngWith(1280, 720);
  const harness = await loadPluginHarness({
    imageBytesByHash: { "fixture-image": bytes },
  });
  const node = harness.getNode("10:3");
  node.fills = [{
    ...node.fills[0],
    imageTransform: [[0.5, 0, 0.25], [0, 0.5, 0.25]],
  }];

  const result = await harness.command("export_image_fill", {
    nodeId: "10:3",
    paintIndex: 0,
    commandId: "image-fill-read",
  });

  assert.equal(result.nodeId, "10:3");
  assert.equal(result.paintIndex, 0);
  assert.equal(result.imageHash, "fixture-image");
  assert.deepEqual(result.imageFill, {
    type: "IMAGE",
    imageHash: "fixture-image",
    scaleMode: "FILL",
    imageTransform: [[0.5, 0, 0.25], [0, 0.5, 0.25]],
  });
  assert.deepEqual(Buffer.from(result.imageData, "base64"), bytes);
  assert.deepEqual(harness.imageReadCalls, ["fixture-image"]);
  assert.equal(harness.exportCalls.length, 0, "must not call node.exportAsync");

  const progress = harness.messages.filter(
    (message) =>
      message.type === "command_progress" &&
      message.commandId === "image-fill-read",
  );
  assert.deepEqual(progress.map((message) => message.status), [
    "started",
    "in_progress",
    "completed",
  ]);
});

test("a non-image fill, out-of-range index, missing image API, and missing image all refuse before a byte read", async () => {
  const solid = await loadPluginHarness();
  await assert.rejects(
    () => solid.command("export_image_fill", { nodeId: "10:2", paintIndex: 0 }),
    /is SOLID, not IMAGE/,
  );
  assert.deepEqual(solid.imageReadCalls, []);

  await assert.rejects(
    () => solid.command("export_image_fill", { nodeId: "10:3", paintIndex: 1 }),
    /outside node 10:3's 1 fill entries/,
  );
  assert.deepEqual(solid.imageReadCalls, []);

  const unavailableApi = await loadPluginHarness({ imageApi: false });
  await assert.rejects(
    () => unavailableApi.command("export_image_fill", { nodeId: "10:3", paintIndex: 0 }),
    /getImageByHash is unavailable/,
  );

  const missingImage = await loadPluginHarness({ imageBytesByHash: {} });
  await assert.rejects(
    () => missingImage.command("export_image_fill", { nodeId: "10:3", paintIndex: 0 }),
    /could not resolve imageHash/,
  );
});

test("a failed image-byte read emits an error progress receipt without changing the node", async () => {
  const harness = await loadPluginHarness({ imageReadError: "asset download failed" });
  const before = structuredClone(harness.getNode("10:3").fills);

  await assert.rejects(
    () => harness.command("export_image_fill", {
      nodeId: "10:3",
      paintIndex: 0,
      commandId: "image-fill-error",
    }),
    /Error exporting image fill: asset download failed/,
  );
  assert.deepEqual(harness.getNode("10:3").fills, before);
  const progress = harness.messages.filter(
    (message) =>
      message.type === "command_progress" &&
      message.commandId === "image-fill-error",
  );
  assert.deepEqual(progress.map((message) => message.status), ["started", "error"]);
});
