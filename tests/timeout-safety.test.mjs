import assert from "node:assert/strict";
import test from "node:test";

import { runtimeCompatibilityAfterTimeout } from "../src/talk_to_figma_mcp/timeout-safety.mjs";

test("an export timeout latches document operations until runtime health is re-probed", () => {
  const current = {
    status: "compatible",
    checkedAt: "2026-08-10T12:00:00.000Z",
    issues: [],
    plugin: { buildId: "r2-plugin-known" },
  };
  const latched = runtimeCompatibilityAfterTimeout(
    current,
    "export_node_as_image",
    "2026-08-10T12:02:00.000Z",
  );

  assert.equal(latched.status, "incompatible");
  assert.equal(latched.checkedAt, "2026-08-10T12:02:00.000Z");
  assert.deepEqual(latched.plugin, current.plugin);
  assert.match(latched.issues.join("\n"), /call get_runtime_info/);
  assert.match(latched.issues.join("\n"), /may still be encoding/);
});

test("timeouts from other commands do not trigger the export-specific latch", () => {
  const current = {
    status: "compatible",
    checkedAt: "2026-08-10T12:00:00.000Z",
    issues: [],
    plugin: { buildId: "r2-plugin-known" },
  };
  assert.equal(
    runtimeCompatibilityAfterTimeout(
      current,
      "get_document_info",
      "2026-08-10T12:02:00.000Z",
    ),
    current,
  );
});
