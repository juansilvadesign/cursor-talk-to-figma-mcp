import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

// The fixture document is two pages: "Page One" (current) and "Page Two".

test("create_page appends a named page and reports its observed position", async () => {
  const harness = await loadPluginHarness();
  const before = await harness.command("get_pages");

  const created = await harness.command("create_page", { name: "R2.2 Scratch" });

  assert.equal(created.name, "R2.2 Scratch");
  assert.equal(created.index, before.pageCount, "a page with no index appends last");
  assert.equal(created.requestedIndex, null);
  assert.equal(created.pageCount, before.pageCount + 1);
  assert.equal(created.onDuplicate, "error", "the policy is echoed even when defaulted");
  assert.equal(created.duplicateNameExisted, false);
  assert.deepEqual(created.existingPageIds, []);

  const after = await harness.command("get_pages");
  assert.equal(after.pageCount, before.pageCount + 1);
  assert.equal(after.pages.at(-1).id, created.id);
});

test("create_page does not switch the active page", async () => {
  // Documented in the tool description: creating is not navigating. If this ever
  // changes, a consumer's subsequent current-page write silently lands elsewhere.
  const harness = await loadPluginHarness();
  const before = await harness.command("get_pages");
  const created = await harness.command("create_page", { name: "Not Current" });

  const after = await harness.command("get_pages");
  assert.equal(after.currentPageId, before.currentPageId);
  assert.notEqual(after.currentPageId, created.id);
});

test("create_page refuses a duplicate name by default and names the existing page", async () => {
  const harness = await loadPluginHarness();
  const before = await harness.command("get_pages");

  await assert.rejects(
    () => harness.command("create_page", { name: "Page Two" }),
    (error) => {
      assert.match(error.message, /already exists/);
      // The refusal has to be actionable: a consumer needs the colliding ID to
      // decide between reusing it and passing onDuplicate: "allow".
      assert.match(error.message, /2:1/);
      assert.match(error.message, /onDuplicate/);
      return true;
    },
  );

  const after = await harness.command("get_pages");
  assert.equal(after.pageCount, before.pageCount, "a refused create must not mutate");
});

test("create_page allows a duplicate name only when asked, and declares it", async () => {
  const harness = await loadPluginHarness();
  const created = await harness.command("create_page", {
    name: "Page Two",
    onDuplicate: "allow",
  });

  assert.equal(created.name, "Page Two");
  assert.equal(created.onDuplicate, "allow");
  assert.equal(created.duplicateNameExisted, true);
  assert.deepEqual(created.existingPageIds, ["2:1"]);
  assert.notEqual(created.id, "2:1", "allow creates a second page, it does not reuse");

  const after = await harness.command("get_pages");
  assert.equal(after.pages.filter((page) => page.name === "Page Two").length, 2);
});

test("create_page honors an explicit index", async () => {
  const harness = await loadPluginHarness();
  const created = await harness.command("create_page", {
    name: "First Page",
    index: 0,
  });

  assert.equal(created.requestedIndex, 0);
  assert.equal(created.index, 0);

  const after = await harness.command("get_pages");
  assert.equal(after.pages[0].id, created.id);
  assert.equal(after.pages[1].name, "Page One", "existing pages keep their order");
});

test("create_page accepts the append-position index at the end of the range", async () => {
  const harness = await loadPluginHarness();
  const before = await harness.command("get_pages");
  const created = await harness.command("create_page", {
    name: "Last Page",
    index: before.pageCount,
  });

  assert.equal(created.index, before.pageCount);
  const after = await harness.command("get_pages");
  assert.equal(after.pages.at(-1).id, created.id);
});

test("create_page rejects invalid input before mutating the document", async () => {
  const harness = await loadPluginHarness();
  const before = await harness.command("get_pages");

  await assert.rejects(
    () => harness.command("create_page", {}),
    /Missing or empty name/,
  );
  await assert.rejects(
    () => harness.command("create_page", { name: "   " }),
    /Missing or empty name/,
    "a whitespace-only name is not a name",
  );
  await assert.rejects(
    () => harness.command("create_page", { name: "Bad Policy", onDuplicate: "reuse" }),
    /expected "error" or "allow"/,
    "reuse is deliberately not supported until idempotency semantics are proven",
  );
  await assert.rejects(
    () => harness.command("create_page", { name: "Bad Index", index: 1.5 }),
    /index must be an integer/,
  );
  await assert.rejects(
    () => harness.command("create_page", { name: "Bad Index", index: -1 }),
    /out of range/,
  );
  await assert.rejects(
    () => harness.command("create_page", { name: "Bad Index", index: before.pageCount + 1 }),
    /out of range/,
  );

  const after = await harness.command("get_pages");
  assert.equal(after.pageCount, before.pageCount, "no rejected call may leave a page behind");
});
