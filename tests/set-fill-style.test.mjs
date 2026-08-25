import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const LOCAL_STYLE = "style-paint-1";
const REMOTE_STYLE = "style-paint-remote";
const REMOTE_BOUND_NODE = "10:3";
const LOCAL_BOUND_NODE = "10:2";
const NO_FILL_STYLE_SURFACE = "40:1";

test("attaches an exact local paint style through the async API and reads it back", async () => {
  const harness = await loadPluginHarness();
  assert.equal(harness.getNode(REMOTE_BOUND_NODE).fillStyleId, REMOTE_STYLE);

  const result = await harness.command("set_fill_style", {
    nodeId: REMOTE_BOUND_NODE,
    styleId: LOCAL_STYLE,
  });

  assert.equal(result.action, "attached");
  assert.equal(result.styleIdBefore, REMOTE_STYLE);
  assert.equal(result.styleIdAfter, LOCAL_STYLE);
  assert.deepEqual(result.localStyle, { id: LOCAL_STYLE, name: "Brand/Primary" });
  assert.equal(result.readbackMatchesRequested, true);
  assert.equal(result.outcome, "confirmed");
  assert.equal(harness.getNode(REMOTE_BOUND_NODE).fillStyleId, LOCAL_STYLE);
});

test("null clears the attachment and reports the normalized null read-back", async () => {
  const harness = await loadPluginHarness();

  const result = await harness.command("set_fill_style", {
    nodeId: LOCAL_BOUND_NODE,
    styleId: null,
  });

  assert.equal(result.action, "cleared");
  assert.equal(result.styleIdBefore, LOCAL_STYLE);
  assert.equal(result.styleIdAfter, null);
  assert.equal(result.readbackMatchesRequested, true);
  assert.equal(harness.getNode(LOCAL_BOUND_NODE).fillStyleId, "");
});

test("refuses a remote/library style before changing the node's existing attachment", async () => {
  const harness = await loadPluginHarness();
  const before = harness.getNode(REMOTE_BOUND_NODE).fillStyleId;

  await assert.rejects(
    () =>
      harness.command("set_fill_style", {
        nodeId: REMOTE_BOUND_NODE,
        styleId: REMOTE_STYLE,
      }),
    /refuses remote\/library paint style.*wrote nothing/s,
  );

  assert.equal(harness.getNode(REMOTE_BOUND_NODE).fillStyleId, before);
});

test("a silently discarded async attachment produces an unconfirmed read-back, not an echo", async () => {
  const harness = await loadPluginHarness({
    ignoreFillStyleWrites: [REMOTE_BOUND_NODE],
  });

  const result = await harness.command("set_fill_style", {
    nodeId: REMOTE_BOUND_NODE,
    styleId: LOCAL_STYLE,
  });

  assert.equal(result.styleIdAfter, REMOTE_STYLE);
  assert.equal(result.readbackMatchesRequested, false);
  assert.equal(result.outcome, "unconfirmed");
  assert.equal(harness.getNode(REMOTE_BOUND_NODE).fillStyleId, REMOTE_STYLE);
});

test("refuses unsupported nodes and missing async attachment API before any write", async () => {
  const noSurface = await loadPluginHarness();
  await assert.rejects(
    () => noSurface.command("set_fill_style", { nodeId: NO_FILL_STYLE_SURFACE, styleId: LOCAL_STYLE }),
    /no fill-style surface.*nothing was written/s,
  );

  const noApi = await loadPluginHarness({
    fillStyleAttachmentApiMissing: [REMOTE_BOUND_NODE],
  });
  const before = noApi.getNode(REMOTE_BOUND_NODE).fillStyleId;
  await assert.rejects(
    () => noApi.command("set_fill_style", { nodeId: REMOTE_BOUND_NODE, styleId: LOCAL_STYLE }),
    /no asynchronous fill-style attachment API.*nothing was written/s,
  );
  assert.equal(noApi.getNode(REMOTE_BOUND_NODE).fillStyleId, before);
});
