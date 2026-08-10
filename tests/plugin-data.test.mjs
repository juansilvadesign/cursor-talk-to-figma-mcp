import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const NODE = "10:1";

test("plugin data round-trips through the private store", async () => {
  const harness = await loadPluginHarness();

  const written = await harness.command("set_plugin_data", {
    nodeId: NODE,
    key: "capture-id",
    value: "run-7",
  });
  assert.equal(written.store, "private");
  assert.equal(written.namespace, null);
  assert.equal(written.operation, "set");
  assert.equal(written.existed, false);
  assert.equal(written.previousBytes, null);
  assert.equal(written.bytes, 5);
  assert.equal(written.keyCount, 1);

  const read = await harness.command("get_plugin_data", { nodeId: NODE });
  assert.equal(read.store, "private");
  assert.equal(read.requestedKey, null);
  assert.equal(read.keyCount, 1);
  assert.deepEqual(read.entries, [
    { key: "capture-id", present: true, value: "run-7", bytes: 5, truncated: false },
  ]);
  assert.equal(read.complete, true);
  assert.deepEqual(read.limitations, []);
});

test("the shared store is namespaced and separate from the private store", async () => {
  const harness = await loadPluginHarness();

  await harness.command("set_plugin_data", {
    nodeId: NODE,
    key: "owner",
    value: "private-value",
  });
  await harness.command("set_plugin_data", {
    nodeId: NODE,
    key: "owner",
    value: "shared-value",
    namespace: "consumer",
  });

  const privateRead = await harness.command("get_plugin_data", {
    nodeId: NODE,
    key: "owner",
  });
  assert.equal(privateRead.store, "private");
  assert.equal(privateRead.entries[0].value, "private-value");

  const sharedRead = await harness.command("get_plugin_data", {
    nodeId: NODE,
    key: "owner",
    namespace: "consumer",
  });
  assert.equal(sharedRead.store, "shared");
  assert.equal(sharedRead.namespace, "consumer");
  assert.equal(sharedRead.entries[0].value, "shared-value");

  // A different namespace must not see it, or "consumers own their conventions"
  // is not true.
  const otherNamespace = await harness.command("get_plugin_data", {
    nodeId: NODE,
    namespace: "somebody-else",
  });
  assert.equal(otherNamespace.keyCount, 0);
  assert.deepEqual(otherNamespace.entries, []);
});

test("null removes a key, and the empty string is refused rather than silently deleting", async () => {
  const harness = await loadPluginHarness();

  await harness.command("set_plugin_data", { nodeId: NODE, key: "a", value: "x" });

  // Figma removes a key when it is written "", so an empty string is not a
  // storable value — it is a second, implicit spelling of delete. Refusing it
  // keeps null the only way to remove, so a removal is never accidental.
  await assert.rejects(
    () => harness.command("set_plugin_data", { nodeId: NODE, key: "a", value: "" }),
    /cannot be stored/,
  );

  const afterRefusal = await harness.command("get_plugin_data", {
    nodeId: NODE,
    key: "a",
  });
  assert.equal(afterRefusal.entries[0].present, true, "the refused write kept the value");
  assert.equal(afterRefusal.entries[0].value, "x");

  const removed = await harness.command("set_plugin_data", {
    nodeId: NODE,
    key: "a",
    value: null,
  });
  assert.equal(removed.operation, "removed");
  assert.equal(removed.existed, true);
  assert.equal(removed.bytes, null);
  assert.equal(removed.keyCount, 0);

  const afterRemove = await harness.command("get_plugin_data", { nodeId: NODE });
  assert.equal(afterRemove.keyCount, 0);
});

test("removing an absent key is declared rather than reported as a removal", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_plugin_data", {
    nodeId: NODE,
    key: "never-set",
    value: null,
  });
  assert.equal(result.operation, "noop_absent");
  assert.equal(result.existed, false);
});

test("an absent key reads back as not present, not as an empty value", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("get_plugin_data", {
    nodeId: NODE,
    key: "missing",
  });
  // Figma returns "" for both an absent key and a stored empty string; only
  // membership distinguishes them.
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].present, false);
  assert.equal(result.entries[0].value, "");
  assert.equal(result.keyCount, 0);
});

test("keys are paged and the count stays a whole-node total", async () => {
  const harness = await loadPluginHarness();
  for (let index = 0; index < 5; index++) {
    await harness.command("set_plugin_data", {
      nodeId: NODE,
      key: `k${index}`,
      value: `v${index}`,
    });
  }

  const firstPage = await harness.command("get_plugin_data", {
    nodeId: NODE,
    limit: 2,
    offset: 0,
  });
  assert.equal(firstPage.keyCount, 5, "count describes the node, not the window");
  assert.equal(firstPage.pagination.returned, 2);
  assert.equal(firstPage.pagination.hasMore, true);
  assert.equal(firstPage.complete, false);
  assert.match(firstPage.limitations.join(" "), /Returned 2 of 5 keys/);

  const lastPage = await harness.command("get_plugin_data", {
    nodeId: NODE,
    limit: 2,
    offset: 4,
  });
  assert.equal(lastPage.pagination.returned, 1);
  assert.equal(lastPage.pagination.hasMore, false);
  assert.equal(lastPage.complete, true);

  // Paging must reassemble the full set without gaps or repeats.
  const collected = [];
  for (let offset = 0; offset < 5; offset += 2) {
    const page = await harness.command("get_plugin_data", {
      nodeId: NODE,
      limit: 2,
      offset,
    });
    collected.push(...page.entries.map((entry) => entry.key));
  }
  assert.deepEqual(collected, ["k0", "k1", "k2", "k3", "k4"]);
});

test("an oversize value is truncated in the reply but reported at full length", async () => {
  const harness = await loadPluginHarness();
  await harness.command("set_plugin_data", {
    nodeId: NODE,
    key: "big",
    value: "z".repeat(500),
  });

  const result = await harness.command("get_plugin_data", {
    nodeId: NODE,
    key: "big",
    maxValueBytes: 100,
  });
  assert.equal(result.entries[0].value.length, 100);
  assert.equal(result.entries[0].bytes, 500, "the true size is still reported");
  assert.equal(result.entries[0].truncated, true);
  assert.equal(result.complete, false);
  assert.match(result.limitations.join(" "), /exceeded maxValueBytes/);
});

test("value size is measured in UTF-8 bytes, not UTF-16 code units", async () => {
  const harness = await loadPluginHarness();
  const written = await harness.command("set_plugin_data", {
    nodeId: NODE,
    key: "unicode",
    // "é" is 2 bytes, "→" is 3, "😀" is 4 — 9 total, but only 5 JS string units.
    value: "é→😀",
  });
  assert.equal(written.bytes, 9);
});

test("a write above the per-entry ceiling is refused before it reaches Figma", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () =>
      harness.command("set_plugin_data", {
        nodeId: NODE,
        key: "huge",
        value: "z".repeat(100001),
      }),
    /above the 100000 byte per-entry ceiling/,
  );

  const after = await harness.command("get_plugin_data", { nodeId: NODE });
  assert.equal(after.keyCount, 0, "a refused write must store nothing");
});

test("plugin data tools reject invalid targets and arguments", async () => {
  const harness = await loadPluginHarness();

  await assert.rejects(
    () => harness.command("get_plugin_data", {}),
    /Missing nodeId/,
  );
  await assert.rejects(
    () => harness.command("get_plugin_data", { nodeId: "0:404" }),
    /Node not found/,
  );
  await assert.rejects(
    () => harness.command("get_plugin_data", { nodeId: NODE, namespace: "  " }),
    /namespace must be a non-empty string/,
  );
  await assert.rejects(
    () => harness.command("get_plugin_data", { nodeId: NODE, limit: 0 }),
    /limit must be a positive integer/,
  );
  await assert.rejects(
    () => harness.command("get_plugin_data", { nodeId: NODE, offset: -1 }),
    /offset must be a non-negative integer/,
  );
  await assert.rejects(
    () => harness.command("set_plugin_data", { nodeId: NODE, value: "x" }),
    /Missing or empty key/,
  );
  await assert.rejects(
    () => harness.command("set_plugin_data", { nodeId: NODE, key: "k", value: 42 }),
    /value must be a string, or null/,
    "numbers are not silently stringified; Figma stores strings only",
  );
});

test("plugin data is readable on a page created in the same session", async () => {
  // Pages are nodes too. This is the R2.2 + R2.3 seam a consumer will actually
  // use: create a page, then tag it with the consumer's own metadata.
  const harness = await loadPluginHarness();
  const page = await harness.command("create_page", { name: "Tagged" });

  const written = await harness.command("set_plugin_data", {
    nodeId: page.id,
    key: "source",
    value: "capture-manifest",
    namespace: "consumer",
  });
  assert.equal(written.nodeType, "PAGE");
  assert.equal(written.store, "shared");

  const read = await harness.command("get_plugin_data", {
    nodeId: page.id,
    namespace: "consumer",
  });
  assert.equal(read.nodeType, "PAGE");
  assert.equal(read.entries[0].value, "capture-manifest");
});
