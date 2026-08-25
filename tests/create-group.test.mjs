import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const PARENT = "30:1";
const FIRST = "30:2";
const SECOND = "30:3";
const OTHER_PAGE_MEMBER = "10:4";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundsOf(harness, id) {
  return plain(harness.getNode(id).absoluteBoundingBox);
}

function childIds(harness, id) {
  return harness.getNode(id).children.map((child) => child.id);
}

test("creates a native group under the explicit parent and reads member bounds back", async () => {
  const harness = await loadPluginHarness();
  const firstBefore = boundsOf(harness, FIRST);
  const secondBefore = boundsOf(harness, SECOND);

  const result = await harness.command("create_group", {
    nodeIds: [FIRST, SECOND],
    parentId: PARENT,
    index: 0,
  });

  assert.equal(result.type, "GROUP");
  assert.equal(result.parentId, PARENT);
  assert.deepEqual(result.memberIds, [FIRST, SECOND]);
  assert.equal(result.memberCount, 2);
  assert.equal(result.groupIndex, 0);
  assert.equal(result.absoluteBoundsPreserved, true);
  assert.deepEqual(
    result.memberBounds.map((member) => member.absoluteBoundsBefore),
    [firstBefore, secondBefore],
  );
  assert.deepEqual(
    result.memberBounds.map((member) => member.absoluteBoundsAfter),
    [firstBefore, secondBefore],
  );

  // The document is the evidence. An echo can describe a group without moving either
  // member, so assert the actual hierarchy and the actual absolute geometry.
  assert.equal(harness.getNode(FIRST).parent.id, result.id);
  assert.equal(harness.getNode(SECOND).parent.id, result.id);
  assert.deepEqual(childIds(harness, result.id), [FIRST, SECOND]);
  assert.deepEqual(boundsOf(harness, FIRST), firstBefore);
  assert.deepEqual(boundsOf(harness, SECOND), secondBefore);
});

test("refuses duplicate IDs before native grouping and leaves the hierarchy untouched", async () => {
  const harness = await loadPluginHarness();
  const before = childIds(harness, PARENT);

  await assert.rejects(
    () =>
      harness.command("create_group", {
        nodeIds: [FIRST, FIRST],
        parentId: PARENT,
      }),
    /duplicate nodeIds.*created nothing/s,
  );

  assert.deepEqual(childIds(harness, PARENT), before);
  assert.equal(harness.getNode(FIRST).parent.id, PARENT);
});

test("refuses a cross-page member before it can reparent either local member", async () => {
  const harness = await loadPluginHarness();
  const before = childIds(harness, PARENT);

  await assert.rejects(
    () =>
      harness.command("create_group", {
        nodeIds: [FIRST, OTHER_PAGE_MEMBER],
        parentId: PARENT,
      }),
    /cross-page grouping is refused.*before any write/s,
  );

  assert.deepEqual(childIds(harness, PARENT), before);
  assert.equal(harness.getNode(FIRST).parent.id, PARENT);
  assert.equal(harness.getNode(OTHER_PAGE_MEMBER).parent.id, "1:1");
});

test("does not emulate a group when the native group API is unavailable", async () => {
  const harness = await loadPluginHarness({ groupApiMissing: true });
  const before = childIds(harness, PARENT);

  await assert.rejects(
    () => harness.command("create_group", { nodeIds: [FIRST], parentId: PARENT }),
    /figma\.group is not exposed/s,
  );

  assert.deepEqual(childIds(harness, PARENT), before);
  assert.equal(harness.getNode(FIRST).parent.id, PARENT);
});
