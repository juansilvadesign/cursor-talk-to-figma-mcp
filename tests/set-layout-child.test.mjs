import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.6 item 2.1 — `set_layout_child`, the child side of auto-layout.
 *
 * ⛔ **Validate-all-then-write from birth** (plan 2.5, now the house rule). Phase 1 paid
 * that debt off in three shipped ops; minting a fourth instance in the release that fixed
 * them would be indefensible. So every refusal case below asserts the **side-effect
 * channel is empty**, and puts the invalid parameter LAST — a validate-as-you-go
 * implementation would have written the valid ones before reaching it.
 *
 * 🔴 **The vacuity trap, and why these tests seed state first.** All three properties are
 * ABSENT from the fixture, so they read `undefined` on an untouched node. A refusal test
 * that snapshots `undefined` and compares it with `undefined` afterwards **passes
 * vacuously** — it would pass against a tool that writes nothing ever, and it would pass
 * against a tool that does not exist. That is the same symmetric failure the typography
 * gate found in its own read-back (all-null before vs all-null after reads exactly like
 * agreement). Every refusal here therefore writes a KNOWN state first and asserts that
 * state survived, and `writes what it says it writes` runs first to prove the channel
 * moves at all.
 *
 * ⛔ Two rules live in the PLUGIN and not in Zod, deliberately, so they are reachable
 * through the real transport and provable by the live gate: STRETCH is refused, and
 * `layoutGrow` is pinned to 0|1. Item 2.0 set that precedent with its fontWeight ×
 * fontFamily collision, which the typography gate asserts arrives at `layer: "handler"`.
 */

const AL_CHILD = "10:2"; // Title — TEXT inside 10:1 "Dashboard" (layoutMode VERTICAL)
const AL_SIBLING = "10:3"; // Hero Image — RECTANGLE, same auto-layout parent
const AL_PARENT = "10:1"; // Dashboard — the auto-layout frame itself
const PAGE_CHILD = "10:4"; // Loose Rectangle — child of PAGE 1:1, so layoutMode is UNSET

const WRITABLE = ["layoutGrow", "layoutAlign", "layoutPositioning"];

function snapshot(node) {
  const out = {};
  for (const key of WRITABLE) out[key] = JSON.stringify(node[key]);
  return out;
}

/** The known state every refusal case is measured against. ⛔ Not the fixture default. */
async function seed(harness, nodeId = AL_CHILD) {
  await harness.command("set_layout_child", {
    nodeId,
    layoutGrow: 1,
    layoutAlign: "MIN",
  });
  const node = harness.getNode(nodeId);
  // ⛔ If this ever reads undefined the seeding silently did nothing and every refusal
  // assertion below goes vacuous again.
  assert.equal(node.layoutGrow, 1, "seed did not take — refusal assertions would be vacuous");
  assert.equal(node.layoutAlign, "MIN", "seed did not take — refusal assertions would be vacuous");
  return node;
}

async function refuses(harness, params, matcher, nodeId = AL_CHILD) {
  const node = harness.getNode(nodeId);
  const before = snapshot(node);
  await assert.rejects(
    () => harness.command("set_layout_child", { nodeId, ...params }),
    matcher,
  );
  assert.deepEqual(
    snapshot(node),
    before,
    "the node must be byte-identical after a refusal — a refusal that mutates is F4",
  );
}

test("writes what it says it writes, and the reply names the fields", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_layout_child", {
    nodeId: AL_CHILD,
    layoutGrow: 1,
    layoutAlign: "CENTER",
  });

  assert.equal(result.id, AL_CHILD);
  assert.equal(result.appliedFieldCount, 2);
  assert.deepEqual(result.appliedFields.sort(), ["layoutAlign", "layoutGrow"]);
  assert.equal(result.parentId, AL_PARENT);
  assert.equal(result.parentLayoutMode, "VERTICAL");

  // ⛔ Read the NODE, not the reply. A reply is what the tool chose to say.
  const node = harness.getNode(AL_CHILD);
  assert.equal(node.layoutGrow, 1);
  assert.equal(node.layoutAlign, "CENTER");
  // Untouched fields stay untouched — this is not a whole-object overwrite.
  assert.equal(node.layoutPositioning, undefined);
});

test("layoutGrow: 0 is a real write, not a falsy no-op", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  const result = await harness.command("set_layout_child", {
    nodeId: AL_CHILD,
    layoutGrow: 0,
  });

  // ⭐ The whole point: `if (layoutGrow)` instead of `!== undefined` would skip this
  // write and the tool would report success having changed nothing.
  assert.deepEqual(result.appliedFields, ["layoutGrow"]);
  assert.equal(harness.getNode(AL_CHILD).layoutGrow, 0);
});

test("layoutPositioning rides alone and takes the child out of flow", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_layout_child", {
    nodeId: AL_CHILD,
    layoutPositioning: "ABSOLUTE",
  });

  assert.deepEqual(result.appliedFields, ["layoutPositioning"]);
  assert.equal(harness.getNode(AL_CHILD).layoutPositioning, "ABSOLUTE");
});

test("returning a child to AUTO in the same call re-enters the flow before grow lands", async () => {
  const harness = await loadPluginHarness();
  await harness.command("set_layout_child", {
    nodeId: AL_CHILD,
    layoutPositioning: "ABSOLUTE",
  });

  const result = await harness.command("set_layout_child", {
    nodeId: AL_CHILD,
    layoutPositioning: "AUTO",
    layoutGrow: 1,
  });

  // ⭐ Write ORDER is the assertion: positioning first, then grow. The reply's field
  // order is the observable proxy for it.
  assert.deepEqual(result.appliedFields, ["layoutPositioning", "layoutGrow"]);
  const node = harness.getNode(AL_CHILD);
  assert.equal(node.layoutPositioning, "AUTO");
  assert.equal(node.layoutGrow, 1);
});

test("a zero-property call is refused, not answered done", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await refuses(harness, {}, /at least one of layoutGrow, layoutAlign or layoutPositioning/);
});

test("an unknown nodeId is refused", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_layout_child", { nodeId: "0:404", layoutGrow: 1 }),
    /Node with ID 0:404 not found/,
  );
});

test('a parent with layoutMode "NONE" is refused, and reported as NONE', async () => {
  const harness = await loadPluginHarness();
  await seed(harness); // grow 1, align MIN — so the assertion below is not vacuous
  // ⭐ Turn the real auto-layout parent off, rather than reaching for a node that never
  // had one: this way the node carries a KNOWN state into the refusal.
  await harness.command("set_layout_mode", { nodeId: AL_PARENT, layoutMode: "NONE" });

  await refuses(
    harness,
    { layoutGrow: 0 },
    /requires an auto-layout parent and wrote nothing[\s\S]*layoutMode NONE/,
  );
});

test('a parent with NO layoutMode property at all is refused, and reported as "unset"', async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  const parent = harness.getNode(AL_PARENT);

  // 🔴 The fixture gives EVERY node a `layoutMode: "NONE"` default — pages included.
  // Real Figma's PageNode has no such property, so `10:4` (which sits directly on the
  // page) reports "NONE" here and would report `undefined` in production. Deleting the
  // property models production instead of the fixture, and is the only way this branch
  // is reachable offline. ⛔ Without it the `unset` arm would be dead code that reads as
  // covered, and the live gate would be the first thing ever to execute it.
  assert.equal(parent.layoutMode, "VERTICAL", "fixture shape changed — re-derive this test");
  delete parent.layoutMode;

  await refuses(
    harness,
    { layoutGrow: 0 },
    /requires an auto-layout parent and wrote nothing[\s\S]*layoutMode unset/,
  );
});

test("STRETCH is refused and the message names its replacement", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await refuses(
    harness,
    { layoutAlign: "STRETCH" },
    /STRETCH" is refused[\s\S]*set_layout_sizing[\s\S]*FILL/,
  );
});

test("an unknown layoutAlign is refused and the message still excludes STRETCH", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await refuses(harness, { layoutAlign: "SIDEWAYS" }, (error) => {
    assert.match(error.message, /layoutAlign must be one of: MIN, CENTER, MAX, INHERIT/);
    // ⛔ The valid-values list must not advertise the value the tool refuses.
    assert.doesNotMatch(
      error.message,
      /one of: MIN, CENTER, MAX, INHERIT, STRETCH|STRETCH, INHERIT/,
    );
    return true;
  });
});

test("layoutGrow is pinned to 0 or 1 by the handler, not by the schema", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await refuses(harness, { layoutGrow: 0.5 }, /layoutGrow accepts 0 .* or 1 /);
  await refuses(harness, { layoutGrow: 2 }, /layoutGrow accepts 0 .* or 1 /);
  await refuses(harness, { layoutGrow: "1" }, /layoutGrow must be a number/);
  await refuses(harness, { layoutGrow: Number.NaN }, /layoutGrow must be a number/);
});

test("ABSOLUTE cannot be combined with layoutGrow or layoutAlign", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  await refuses(
    harness,
    { layoutPositioning: "ABSOLUTE", layoutGrow: 1 },
    /cannot be combined with layoutGrow[\s\S]*outside the parent's auto-layout flow/,
  );
  await refuses(
    harness,
    { layoutPositioning: "ABSOLUTE", layoutAlign: "MAX" },
    /cannot be combined with layoutAlign/,
  );
  // Both named, and pluralised — the message is built from what was actually sent.
  await refuses(harness, { layoutPositioning: "ABSOLUTE", layoutGrow: 1, layoutAlign: "MAX" }, (error) => {
    assert.match(error.message, /cannot be combined with layoutGrow or layoutAlign/);
    assert.match(error.message, /those values/);
    return true;
  });
});

test("VALIDATE-ALL-THEN-WRITE: a valid field sent before an invalid one is not written", async () => {
  const harness = await loadPluginHarness();
  const node = await seed(harness); // layoutGrow 1, layoutAlign MIN

  // layoutGrow: 0 is VALID and arrives first; layoutAlign: STRETCH is refused and arrives
  // last. A validate-as-you-go implementation writes grow, then throws — leaving 0 behind.
  await assert.rejects(
    () =>
      harness.command("set_layout_child", {
        nodeId: AL_CHILD,
        layoutGrow: 0,
        layoutAlign: "STRETCH",
      }),
    /STRETCH" is refused/,
  );

  // ⛔ The load-bearing assertion, and it is NOT vacuous: the seeded value is 1, so a
  // partial write would read 0 here rather than `undefined`.
  assert.equal(node.layoutGrow, 1, "layoutGrow was written before the refusal — F4");
  assert.equal(node.layoutAlign, "MIN");
});

test("VALIDATE-ALL-THEN-WRITE: positioning is not written when a later field refuses", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await harness.command("set_layout_child", { nodeId: AL_CHILD, layoutPositioning: "ABSOLUTE" });
  const node = harness.getNode(AL_CHILD);
  assert.equal(node.layoutPositioning, "ABSOLUTE");

  await assert.rejects(
    () =>
      harness.command("set_layout_child", {
        nodeId: AL_CHILD,
        layoutPositioning: "AUTO",
        layoutGrow: 42,
      }),
    /layoutGrow accepts 0 .* or 1 /,
  );

  assert.equal(
    node.layoutPositioning,
    "ABSOLUTE",
    "positioning was written before the refusal — F4, and it is the field written FIRST",
  );
});

test("siblings are untouched — the write is scoped to one node", async () => {
  const harness = await loadPluginHarness();
  await harness.command("set_layout_child", { nodeId: AL_CHILD, layoutGrow: 1 });

  const sibling = harness.getNode(AL_SIBLING);
  assert.equal(sibling.layoutGrow, undefined);
  assert.equal(sibling.layoutAlign, undefined);
});

test("the batch allowlist EXCLUDES it, by decision and in both copies", async () => {
  const harness = await loadPluginHarness();
  const vocabulary = harness.globals("batchVocabulary")();

  // ⛔ R2.2's pin-the-absence pattern: an absence in silence is an oversight someone
  // quietly reverses. Item 2.6 decided this before the tool existed.
  assert.ok(
    Object.keys(vocabulary.EXCLUDED_BATCH_OPERATIONS).includes("set_layout_child"),
    "set_layout_child must be excluded WITH a reason, not merely missing from the allowlist",
  );
  assert.ok(
    !vocabulary.V1_BATCH_OPERATIONS.includes("set_layout_child"),
    "set_layout_child must not be in the v1 allowlist",
  );
});

test("apply_batch refuses the op rather than silently ignoring it", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: [
          { id: "a", op: "set_layout_child", nodeId: AL_CHILD, layoutGrow: 1 },
        ],
      }),
    /set_layout_child/,
  );

  // And it changed nothing on the way to refusing.
  assert.equal(harness.getNode(AL_CHILD).layoutGrow, undefined);
});
