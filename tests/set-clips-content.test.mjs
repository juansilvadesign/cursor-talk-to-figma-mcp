import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.6 item 2.4 — `set_clips_content`, whether a frame clips content past its bounds.
 *
 * ⛔ **THE WHOLE FILE IS ARRANGED AROUND ONE PROBLEM: A BOOLEAN RECEIPT CANNOT FALSIFY
 * ITSELF.** Every previous layout tool had a reading that could come out wrong — 2.3's four
 * independent fields, 2.2's un-named axis surviving a merge. Here there is one field with
 * two values, so `applied = source.clipsContent` (an echo) and `applied = node.clipsContent`
 * (a read-back) produce identical output on every input a well-behaved platform accepts.
 * No assertion over the reported boolean can separate them, and the suite would be green
 * against a receipt that never touched the document. Item 2.3 hit exactly this and closed
 * it with an opt-in harness coercion; item 2.1 shipped a check with the same defect and its
 * live gate caught it — [[feedback_a_zero_valued_write_reads_as_no_write]].
 *
 * The file answers it twice, in two different currencies:
 * ① `ignoreClipsContentWrites` — a node that ACCEPTS the write and keeps its old value.
 *    Echo reports the argument, read-back reports the truth, and they disagree in one
 *    reading. This is the test that kills the echo mutation.
 * ② `absoluteRenderBounds` — the platform's own statement about what the node PAINTS,
 *    which is a different question from what it STORES. An unclipped frame renders past
 *    its own box exactly when its content spills out.
 *
 * ⚠️ **`renderBoundsChanged` DEFAULTS TO NULL AND THAT IS THE POINT.** Whether Figma
 * recomputes render bounds synchronously with the assignment is unmeasured — the live gate
 * measures it. So the harness answers `null` unless a fixture opts in, and the tool must
 * propagate that as `null` rather than collapsing it to `false`. A `false` would say
 * "nothing happened" on the strength of a measurement that never took place.
 *
 * ⭐ **NO `appliedFields`, deliberately** — 2.2's reasoning, not an omission. One field is
 * written on every call, so the list would be the constant `["clipsContent"]` and could
 * never fail in either direction. 2.3 has one because its four fields are independent.
 *
 * ⭐ **Partial application is structurally impossible** — one assignment. Validate-all-then-
 * write (plan 2.5) is satisfied by construction, so the interesting half of the rule is
 * that the ELIGIBILITY refusal happens in the handler rather than being left to Figma. That
 * is 2.3's correction applied at design time instead of after a live gate.
 */

// Carriers. ⛔ The rule here is TYPE-based, which is the OPPOSITE of 2.3's correction, so
// it is asserted rather than assumed: Figma puts `clipsContent` on FrameNode and the three
// frame-likes that extend it, and a GROUP does not have it set to false — it does not have
// it. The live gate measures the same matrix against real Figma.
const FRAME = "60:1"; // Clip Stack — FRAME 200×200 at (0,800), clipsContent true.
const OVERFLOWING_CHILD = "60:2"; // Overflow Badge — RECTANGLE at (150,150) 100×100.
const INSTANCE = "60:3"; // Button/Primary Instance — INSTANCE.
const COMPONENT_SET = "60:4"; // Button/Set — COMPONENT_SET.
const COMPONENT = "100:1"; // Button/Primary — COMPONENT on page one.
const PLAIN_FRAME = "30:1"; // Static Card — FRAME whose children all fit inside it.

// Non-carriers, one per reason.
const GROUP = "40:1"; // Loose Group — sized by its children; cannot clip them.
const RECTANGLE = "10:4"; // Loose Rectangle — a leaf.
const TEXT = "10:5"; // Footer — a leaf that is not a shape.
const PAGE = "1:1"; // Page One.

/**
 * The full side-effect channel for this tool. ⛔ The stored boolean is NOT enough on its
 * own: a refusal test that snapshots `{clipsContent: true}` and finds `{clipsContent: true}`
 * afterwards passes against a tool that writes nothing ever. Geometry is included so the
 * snapshot has something in it that a careless write would move.
 */
function snapshot(harness, nodeId) {
  const node = harness.getNode(nodeId);
  return JSON.stringify({
    clipsContent: node.clipsContent,
    width: node.width,
    height: node.height,
    x: node.x,
    y: node.y,
    children: (node.children || []).map((child) => ({
      id: child.id,
      x: child.x,
      y: child.y,
      width: child.width,
      height: child.height,
    })),
  });
}

async function refuses(harness, nodeId, params, matcher) {
  const before = snapshot(harness, nodeId);
  await assert.rejects(
    () => harness.command("set_clips_content", { nodeId, ...params }),
    matcher,
  );
  assert.equal(
    snapshot(harness, nodeId),
    before,
    "the node must be byte-identical after a refusal — a refusal that mutates is F4",
  );
}

// ---------------------------------------------------------------------------
// The channel moves at all
// ---------------------------------------------------------------------------

test("writes the boolean and reports it read back from the node", async () => {
  const harness = await loadPluginHarness();
  assert.equal(
    harness.getNode(FRAME).clipsContent,
    true,
    "fixture precondition: the frame starts clipping, so writing false is a real change",
  );

  const result = await harness.command("set_clips_content", {
    nodeId: FRAME,
    clipsContent: false,
  });

  assert.equal(result.id, FRAME);
  assert.equal(result.type, "FRAME");
  assert.equal(result.clipsContent, false);
  assert.equal(result.previous, true);
  assert.equal(result.requested, false);
  assert.equal(result.changed, true);
  assert.equal(result.childCount, 1);
  assert.equal(result.parentId, "2:1");
  assert.equal(result.parentType, "PAGE");

  // ⛔ The document, not the reply. A receipt is not evidence that anything was written.
  assert.equal(harness.getNode(FRAME).clipsContent, false);
});

test("writes true back over false, and the round trip is real in both directions", async () => {
  const harness = await loadPluginHarness();
  await harness.command("set_clips_content", { nodeId: FRAME, clipsContent: false });
  const result = await harness.command("set_clips_content", {
    nodeId: FRAME,
    clipsContent: true,
  });

  assert.equal(result.previous, false);
  assert.equal(result.clipsContent, true);
  assert.equal(result.changed, true);
  assert.equal(harness.getNode(FRAME).clipsContent, true);
});

test("a no-op write succeeds and reports changed: false", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_clips_content", {
    nodeId: FRAME,
    clipsContent: true,
  });

  // ⚠️ Writing the value the node already holds is not an error. It is also not a change,
  // and reporting it as one would make `changed` a restatement of the argument.
  assert.equal(result.previous, true);
  assert.equal(result.clipsContent, true);
  assert.equal(result.changed, false);
});

// ---------------------------------------------------------------------------
// ① The echo trap — the reason this file exists
// ---------------------------------------------------------------------------

test("a receipt that echoed its argument is caught: a node that discards the write reports the OLD value", async () => {
  // ⭐ THE KEY TEST. The harness node accepts the assignment and keeps its old value —
  // 2.3's `roundSizeLimits` pattern applied to a value that cannot be rounded. A tool
  // reporting `applied = source.clipsContent` says `false` here; one reading the node back
  // says `true`. Nothing else in this file can tell those two implementations apart.
  // ⚠️ It is NOT claimed that Figma discards. This models a platform that might, so the
  // honesty of the read-back stops depending on the platform being well-behaved — and
  // `set_layout_child`'s decision ① exists because Figma really does accept-and-ignore all
  // three of ITS assignments outside auto-layout.
  const harness = await loadPluginHarness({ ignoreClipsContentWrites: [FRAME] });
  const result = await harness.command("set_clips_content", {
    nodeId: FRAME,
    clipsContent: false,
  });

  assert.equal(result.requested, false, "the request is echoed on purpose, in its own field");
  assert.equal(
    result.clipsContent,
    true,
    "clipsContent must be READ BACK from the node, never echoed from the argument",
  );
  assert.equal(result.previous, true);
  assert.equal(
    result.changed,
    false,
    "changed compares the read-back against previous, so a discarded write is not a change",
  );
  assert.equal(harness.getNode(FRAME).clipsContent, true);
});

// ---------------------------------------------------------------------------
// ② The second currency — render bounds
// ---------------------------------------------------------------------------

test("an unmeasured render bound reports null, and NEVER false", async () => {
  // ⛔ The default path. `absoluteRenderBounds` is null unless a fixture opts in, because
  // whether Figma recomputes it synchronously is unmeasured. The tool must propagate that
  // as null: a `false` would read as "the write changed nothing", which is a claim no
  // measurement here supports. Same shape as `coverage.budgetCancelsFetch` and
  // `fontSubstituted: false` — an absence must never be mistaken for an answer.
  const harness = await loadPluginHarness();
  const result = await harness.command("set_clips_content", {
    nodeId: FRAME,
    clipsContent: false,
  });

  assert.equal(result.render.before.renderBounds, null);
  assert.equal(result.render.after.renderBounds, null);
  assert.equal(result.render.before.overflow, null);
  assert.equal(result.render.before.overflowing, null);
  assert.equal(
    result.renderBoundsChanged,
    null,
    "null propagates; two unavailable readings are not two equal readings",
  );

  // ⭐ The bounding box is arithmetic over the fixture's own data, so it is answered even
  // when the render measurement is not. Reporting one without the other is what lets a
  // caller tell "the platform declined to measure" from "the node has no geometry".
  assert.deepEqual(result.render.before.boundingBox, {
    x: 0,
    y: 800,
    width: 200,
    height: 200,
  });
});

test("on a measuring node the render bounds move, and the overflow is per-edge", async () => {
  const harness = await loadPluginHarness({ clipRenderBounds: [FRAME] });

  // The frame is 200×200 at (0,800); its child is 100×100 at (150,150) inside it, so it
  // spills 50px past the right and bottom edges and nothing past the left or top.
  const result = await harness.command("set_clips_content", {
    nodeId: FRAME,
    clipsContent: false,
  });

  assert.deepEqual(result.render.before.renderBounds, {
    x: 0,
    y: 800,
    width: 200,
    height: 200,
  });
  assert.deepEqual(result.render.before.overflow, {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  });
  assert.equal(result.render.before.overflowing, false);

  assert.deepEqual(result.render.after.renderBounds, {
    x: 0,
    y: 800,
    width: 250,
    height: 250,
  });
  assert.deepEqual(result.render.after.overflow, {
    left: 0,
    top: 0,
    right: 50,
    bottom: 50,
  });
  assert.equal(result.render.after.overflowing, true);
  assert.equal(result.renderBoundsChanged, true);
});

test("clipping a spilling frame moves the render bounds the other way", async () => {
  const harness = await loadPluginHarness({ clipRenderBounds: [FRAME] });
  await harness.command("set_clips_content", { nodeId: FRAME, clipsContent: false });

  const result = await harness.command("set_clips_content", {
    nodeId: FRAME,
    clipsContent: true,
  });

  assert.equal(result.render.before.overflowing, true);
  assert.equal(result.render.after.overflowing, false);
  assert.equal(result.renderBoundsChanged, true);
});

test("a frame whose content fits reports no overflow either way, and renderBoundsChanged is FALSE not null", async () => {
  // ⛔ The discriminator that keeps `renderBoundsChanged: null` meaningful. If the tool
  // returned null whenever the bounds happened to match, null would mean two different
  // things — "not measured" and "measured, unchanged" — and the field would be unreadable.
  // Here the platform DID answer and the answer is that nothing moved.
  const harness = await loadPluginHarness({ clipRenderBounds: [PLAIN_FRAME] });
  const result = await harness.command("set_clips_content", {
    nodeId: PLAIN_FRAME,
    clipsContent: false,
  });

  assert.equal(result.changed, true, "the stored boolean did change");
  assert.notEqual(result.render.after.renderBounds, null);
  assert.equal(result.render.after.overflowing, false);
  assert.equal(
    result.renderBoundsChanged,
    false,
    "a real measurement that found no movement is false, and is not the same as null",
  );
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

for (const [name, nodeId] of [
  ["FRAME", FRAME],
  ["COMPONENT", COMPONENT],
  ["COMPONENT_SET", COMPONENT_SET],
  ["INSTANCE", INSTANCE],
]) {
  test(`a ${name} carries clipsContent and is accepted`, async () => {
    const harness = await loadPluginHarness();
    const result = await harness.command("set_clips_content", {
      nodeId,
      clipsContent: false,
    });
    assert.equal(result.type, name);
    assert.equal(result.clipsContent, false);
    assert.equal(harness.getNode(nodeId).clipsContent, false);
  });
}

for (const [name, nodeId] of [
  ["GROUP", GROUP],
  ["RECTANGLE", RECTANGLE],
  ["TEXT", TEXT],
  ["PAGE", PAGE],
]) {
  test(`a ${name} does not carry clipsContent and the HANDLER refuses`, async () => {
    // ⛔ The refusal must come from THIS handler, in the validation phase — that is 2.3's
    // whole correction. There the eligibility probe measured the wrong thing and all four
    // ineligible cases were refused by Figma mid-write; the handler had never once refused
    // for the right reason. The message is asserted so a platform string cannot pass for a
    // handler decision. See [[feedback_a_readable_property_is_not_a_writable_one]].
    const harness = await loadPluginHarness();
    await refuses(
      harness,
      nodeId,
      { clipsContent: false },
      /does not carry clipsContent/,
    );
  });
}

test("the refusal names the node type and points at a way in", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_clips_content", { nodeId: GROUP, clipsContent: true }),
    (error) => {
      assert.match(error.message, /wrote nothing/);
      assert.match(error.message, /GROUP/);
      assert.match(error.message, /create_frame/);
      return true;
    },
  );
});

test("a missing node is refused before anything is read", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_clips_content", { nodeId: "9:999", clipsContent: true }),
    /Node with ID 9:999 not found/,
  );
});

// ---------------------------------------------------------------------------
// The type guard, which Zod owns at the transport boundary and the handler repeats
// ---------------------------------------------------------------------------

for (const value of [undefined, null, "true", 1, 0, {}]) {
  test(`clipsContent: ${JSON.stringify(value)} is refused and writes nothing`, async () => {
    // ⛔ Placed against a node that WOULD have accepted a valid write, so this cannot pass
    // by refusing for the wrong reason. The invalid value is the only thing wrong.
    const harness = await loadPluginHarness();
    await refuses(
      harness,
      FRAME,
      { clipsContent: value },
      /requires clipsContent to be true or false/,
    );
  });
}

// ---------------------------------------------------------------------------
// The batch decision, pinned rather than assumed
// ---------------------------------------------------------------------------

test("set_clips_content is excluded from apply_batch by decision, with a reason on the record", async () => {
  // R2.2's pin-the-absence pattern, and R2.6 item 2.6 decided this before the tool
  // existed. An absence on the record is a decision; an absence in silence is an oversight
  // somebody quietly reverses later.
  const harness = await loadPluginHarness();
  const vocabulary = harness.globals("batchVocabulary")();

  assert.ok(
    !vocabulary.V1_BATCH_OPERATIONS.includes("set_clips_content"),
    "set_clips_content must not be on the allowlist",
  );
  assert.match(
    vocabulary.EXCLUDED_BATCH_OPERATIONS.set_clips_content,
    /R2\.6 2\.6/,
    "the exclusion must carry its reason, not just its name",
  );

  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: [
          { id: "a", op: "set_clips_content", nodeId: FRAME, params: { clipsContent: false } },
        ],
      }),
    /set_clips_content/,
  );
  assert.equal(
    harness.getNode(FRAME).clipsContent,
    true,
    "a refused batch op must not have written",
  );
});
