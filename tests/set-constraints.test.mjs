import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.6 item 2.2 — `set_constraints`, how a node resizes with its parent frame.
 *
 * ⚠️ **This tool's parent rule is the INVERSE of `set_layout_child`'s**, and the tests are
 * arranged to make that legible rather than to hide it. Auto-layout and constraints are
 * two mutually exclusive answers to "where does this child go": 2.1 refuses when the
 * parent is NOT auto-layout, and this refuses when it IS. A reviewer who reads only one of
 * the two files should still be able to tell that this was a decision.
 *
 * ⛔ **Validate-all-then-write from birth** (plan 2.5, the house rule). Every refusal case
 * asserts the side-effect channel is EMPTY and puts the invalid parameter LAST, because
 * asserting only that the call threw cannot tell validate-all-first from
 * validate-as-you-go — a distinction that stayed green through eight real side effects
 * once already.
 *
 * 🔴 **The vacuity trap, and how this file avoids it.** `constraints` now has a fixture
 * default of MIN/MIN, so a refusal test that snapshots MIN/MIN and finds MIN/MIN
 * afterwards passes against a tool that writes nothing ever — and against a tool that does
 * not exist. Every refusal below therefore SEEDS a distinguishable state first
 * (`MAX`/`CENTER`, which no default produces) and asserts that state survived. `writes
 * what it says it writes` runs first, to prove the channel moves at all.
 *
 * ⭐ **The merge is a platform requirement, not a convenience.** `constraints` is a single
 * object property and Figma refuses a half-object, so the axis a caller omits must be
 * carried over from the node's current value. That is why the receipt reports `previous`
 * and `preservedFields` — and why there is deliberately no `appliedFields`: both axes are
 * written on every call, so a list of what was WRITTEN would be the constant
 * `["horizontal","vertical"]` and could never fail in either direction.
 */

// Page Two, added for this item. Every frame in the fixture was auto-layout before —
// which is the case this tool REFUSES — so the primary happy path had no home.
const PLAIN_PARENT = "30:1"; // Static Card — FRAME, layoutMode NONE
const PLAIN_CHILD = "30:2"; // Pinned Badge — RECTANGLE inside it
const PLAIN_TEXT = "30:3"; // Caption — TEXT inside it
const GROUP_PARENT = "40:1"; // Loose Group — GROUP on the page
const GROUP_CHILD = "40:2"; // Grouped Rect — RECTANGLE inside it
const AL_PARENT = "20:1"; // Horizontal Stack — FRAME, layoutMode HORIZONTAL
const AL_CHILD = "20:2"; // Mixed Heading — TEXT in its flow
const PAGE_CHILD = "10:4"; // Loose Rectangle — child of PAGE 1:1
const PAGE = "1:1";

/** ⛔ Not the fixture default. MIN/MIN is what an untouched node reads. */
const SEED = { horizontal: "MAX", vertical: "CENTER" };

// A node read through `getNode` lives inside the plugin's `vm` realm, so the object the
// handler assigned carries THAT realm's Object.prototype and `deepStrictEqual` rejects it
// on identity alone — same reason `apply-batch.test.mjs` has its own `plain()`. Serializing
// asks the question actually being asked: does the document hold these values?
// ⭐ The realm boundary is worth keeping rather than working around at the source: it is a
// standing guarantee that these assertions read the plugin's state and not the test's.
function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function constraintsOf(harness, nodeId) {
  return plain(harness.getNode(nodeId).constraints);
}

function snapshot(node) {
  return JSON.stringify(node.constraints === undefined ? null : node.constraints);
}

async function seed(harness, nodeId = PLAIN_CHILD) {
  await harness.command("set_constraints", { nodeId, ...SEED });
  // ⛔ If this ever reads MIN/MIN the seeding silently did nothing and every refusal
  // assertion below goes vacuous.
  assert.deepEqual(
    constraintsOf(harness, nodeId),
    SEED,
    "seed did not take — refusal assertions would be vacuous",
  );
  return harness.getNode(nodeId);
}

// ⛔ An in-flow auto-layout child cannot be seeded by `set_constraints` — the tool
// refuses it, which is the very thing under test. Seeding it through the ABSOLUTE escape
// hatch and then returning it to the flow is the only way to give the refusal a state
// distinguishable from the MIN/MIN default; without it the assertion "nothing changed"
// would pass against a tool that never writes anything at all.
async function seedInFlow(harness, nodeId) {
  await harness.command("set_layout_child", { nodeId, layoutPositioning: "ABSOLUTE" });
  await seed(harness, nodeId);
  await harness.command("set_layout_child", { nodeId, layoutPositioning: "AUTO" });
  assert.deepEqual(
    constraintsOf(harness, nodeId),
    SEED,
    "returning the child to the flow must not have reset its constraints",
  );
}

async function refuses(harness, params, matcher, nodeId = PLAIN_CHILD) {
  const node = harness.getNode(nodeId);
  const before = snapshot(node);
  await assert.rejects(
    () => harness.command("set_constraints", { nodeId, ...params }),
    matcher,
  );
  assert.equal(
    snapshot(harness.getNode(nodeId)),
    before,
    "the node must be byte-identical after a refusal — a refusal that mutates is F4",
  );
}

test("writes what it says it writes, and reports both axes", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_constraints", {
    nodeId: PLAIN_CHILD,
    horizontal: "MAX",
    vertical: "STRETCH",
  });

  assert.equal(result.id, PLAIN_CHILD);
  assert.equal(result.type, "RECTANGLE");
  assert.deepEqual(result.constraints, { horizontal: "MAX", vertical: "STRETCH" });
  assert.deepEqual(result.previous, { horizontal: "MIN", vertical: "MIN" });
  assert.deepEqual(result.requestedFields, ["horizontal", "vertical"]);
  assert.deepEqual(result.preservedFields, []);
  assert.deepEqual(result.changedFields, ["horizontal", "vertical"]);
  assert.equal(result.unchanged, false);
  assert.equal(result.parentId, PLAIN_PARENT);
  assert.equal(result.parentType, "FRAME");
  assert.equal(result.parentLayoutMode, "NONE");

  // ⛔ Read the NODE, not the reply. A reply is what the tool chose to say.
  assert.deepEqual(constraintsOf(harness, PLAIN_CHILD), {
    horizontal: "MAX",
    vertical: "STRETCH",
  });
});

test("all five constraint values round-trip — none is quietly dropped", async () => {
  const harness = await loadPluginHarness();
  for (const value of ["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]) {
    const result = await harness.command("set_constraints", {
      nodeId: PLAIN_CHILD,
      horizontal: value,
    });
    assert.equal(result.constraints.horizontal, value);
    assert.equal(harness.getNode(PLAIN_CHILD).constraints.horizontal, value);
  }
});

test("one axis is written and the other is CARRIED OVER, not defaulted", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  const result = await harness.command("set_constraints", {
    nodeId: PLAIN_CHILD,
    horizontal: "STRETCH",
  });

  // ⭐ The whole merge claim in one assertion. A handler that assigned
  // `{ horizontal }` alone would leave `vertical` undefined; one that rebuilt from
  // scratch would reset it to MIN. Neither reads as CENTER.
  assert.deepEqual(result.constraints, { horizontal: "STRETCH", vertical: "CENTER" });
  assert.deepEqual(result.previous, SEED);
  assert.deepEqual(result.requestedFields, ["horizontal"]);
  assert.deepEqual(result.preservedFields, ["vertical"]);
  assert.deepEqual(result.changedFields, ["horizontal"]);
  assert.deepEqual(constraintsOf(harness, PLAIN_CHILD), {
    horizontal: "STRETCH",
    vertical: "CENTER",
  });
});

test("the vertical-only path preserves horizontal — both directions, not just one", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  const result = await harness.command("set_constraints", {
    nodeId: PLAIN_CHILD,
    vertical: "SCALE",
  });

  assert.deepEqual(result.constraints, { horizontal: "MAX", vertical: "SCALE" });
  assert.deepEqual(result.requestedFields, ["vertical"]);
  assert.deepEqual(result.preservedFields, ["horizontal"]);
});

test("rewriting the same value reports unchanged instead of claiming a change", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  const result = await harness.command("set_constraints", { nodeId: PLAIN_CHILD, ...SEED });

  // Idempotence is legitimate and is NOT refused — but it is reported honestly, so a
  // caller cannot read "the write landed" as "something moved".
  assert.deepEqual(result.changedFields, []);
  assert.equal(result.unchanged, true);
  assert.deepEqual(result.constraints, SEED);
});

test("a TEXT node is constrained too — this is not a rectangle-only tool", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_constraints", {
    nodeId: PLAIN_TEXT,
    horizontal: "STRETCH",
    vertical: "MAX",
  });
  assert.equal(result.type, "TEXT");
  assert.deepEqual(constraintsOf(harness, PLAIN_TEXT), {
    horizontal: "STRETCH",
    vertical: "MAX",
  });
});

test("a GROUP parent is ALLOWED — the unverified refusal is the one not written", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_constraints", {
    nodeId: GROUP_CHILD,
    horizontal: "MAX",
  });

  // ✅ MEASURED 2026-08-22 on channel 2bcdtr5b, and the answer is that a group child's
  // constraint DOES resolve — against the enclosing FRAME, not the group. Two identical
  // cloned groups, one frame resize 400 → 600: the child written to MAX held its right
  // offset (243) and moved left 20 → 220, while the untouched control held left 20.
  // Allowing a GROUP parent rather than refusing on an unverified claim was the right
  // call, and it is now a measurement rather than a hope.
  //
  // 🔴 The first run of that check scored the OPPOSITE, and the way it failed is worth
  // keeping: it measured the child's offsets WITHIN its group and read 0 → 0. That is not
  // a result, it is arithmetic — a single-child group's bounding box IS its child's box,
  // so those offsets are pinned at zero and the check could not have come out any other
  // way. It reported a confident false 🔴. The repair was to measure against the frame and
  // add an untouched CONTROL clone. See `scripts/live-constraints-gate.mjs` §6.
  assert.equal(result.parentId, GROUP_PARENT);
  assert.equal(result.parentType, "GROUP");
  assert.equal(result.parentLayoutMode, null, "a GROUP has no layoutMode property at all");
  assert.deepEqual(constraintsOf(harness, GROUP_CHILD), {
    horizontal: "MAX",
    vertical: "MIN",
  });
});

test("a zero-field call is refused, not answered done", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await refuses(harness, {}, /at least one of horizontal or vertical/);
});

test("an in-flow auto-layout child is refused — the whole call, not per-axis", async () => {
  const harness = await loadPluginHarness();
  await seedInFlow(harness, AL_CHILD);

  // ⭐ This is 2.1's rule pointing the other way. Figma stores constraints on an in-flow
  // auto-layout child and the layout engine overrides them, so honouring the call would
  // be a discarded value reading as an applied one.
  await refuses(
    harness,
    { horizontal: "MAX", vertical: "MAX" },
    /auto-layout frame with layoutMode HORIZONTAL/,
    AL_CHILD,
  );
});

test("the refusal message names the way IN, not just the way out", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_constraints", { nodeId: AL_CHILD, horizontal: "MIN" }),
    (error) => {
      // A refusal that does not name its remedy makes the caller guess, and the remedy
      // here is a specific call on a specific sibling tool.
      assert.match(error.message, /set_layout_child\(\{ layoutPositioning: "ABSOLUTE" \}\)/);
      return true;
    },
  );
});

test("an ABSOLUTE child of an auto-layout parent is ALLOWED — the exception is real", async () => {
  const harness = await loadPluginHarness();
  await harness.command("set_layout_child", {
    nodeId: AL_CHILD,
    layoutPositioning: "ABSOLUTE",
  });

  const result = await harness.command("set_constraints", {
    nodeId: AL_CHILD,
    horizontal: "MAX",
    vertical: "MAX",
  });

  // ⭐ Without this arm the auto-layout refusal would be a blanket ban, and a blanket ban
  // hides its own escape hatch. ABSOLUTE takes the node out of the flow, and constraints
  // govern it again — so the guard tests the CHILD's positioning, not only the parent's
  // layoutMode.
  assert.equal(result.parentLayoutMode, "HORIZONTAL");
  assert.equal(result.layoutPositioning, "ABSOLUTE");
  assert.deepEqual(constraintsOf(harness, AL_CHILD), {
    horizontal: "MAX",
    vertical: "MAX",
  });
});

test("returning an ABSOLUTE child to the flow makes it refuse again", async () => {
  const harness = await loadPluginHarness();
  await seedInFlow(harness, AL_CHILD);

  // ⛔ The guard reads live state on every call rather than caching an answer — a node
  // that was eligible a moment ago is not eligible now.
  await refuses(harness, { horizontal: "MIN" }, /is in its flow/, AL_CHILD);
});

test("a top-level node on a PAGE is refused — nothing to resize against", async () => {
  const harness = await loadPluginHarness();
  // The fixture default is the only state a page child can be seeded to, since the tool
  // itself refuses to write here. So this one asserts against MIN/MIN and leans on the
  // OTHER refusal tests to prove the channel is not simply inert.
  assert.deepEqual(constraintsOf(harness, PAGE_CHILD), {
    horizontal: "MIN",
    vertical: "MIN",
  });
  await refuses(
    harness,
    { horizontal: "STRETCH", vertical: "STRETCH" },
    /parent is a PAGE/,
    PAGE_CHILD,
  );
});

test("a node with no constraints property at all is refused", async () => {
  const harness = await loadPluginHarness();

  // ⭐ Reached honestly, with NO fixture surgery. The harness models ConstraintMixin by
  // node type, so a PAGE genuinely has no `constraints` — unlike item 2.1, whose
  // equivalent arm could only be reached by `delete`ing a property inside the test.
  assert.equal(harness.getNode(PAGE).constraints, undefined);
  assert.equal(harness.getNode(GROUP_PARENT).constraints, undefined);

  await assert.rejects(
    () => harness.command("set_constraints", { nodeId: PAGE, horizontal: "MIN" }),
    /is a PAGE, which has no constraints property/,
  );
  await assert.rejects(
    () => harness.command("set_constraints", { nodeId: GROUP_PARENT, horizontal: "MIN" }),
    /is a GROUP, which has no constraints property/,
  );
});

test("an unknown node id is refused before anything is read", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_constraints", { nodeId: "99:99", horizontal: "MIN" }),
    /Node with ID 99:99 not found/,
  );
});

test("an invalid enum is refused at the handler, and it is checked LAST", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  // ⛔ The valid axis goes FIRST and the invalid one LAST. A validate-as-you-go
  // implementation would have written `horizontal` before reaching `vertical` — and
  // asserting only that the call threw could not tell the two apart.
  await refuses(
    harness,
    { horizontal: "STRETCH", vertical: "MIDDLE" },
    /vertical must be one of: MIN, CENTER, MAX, STRETCH, SCALE/,
  );
});

test("a lowercase value is refused — the enum is not case-normalised", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await refuses(harness, { horizontal: "min" }, /horizontal must be one of/);
});

test("the context refusals fire BEFORE the enum check, so a bad node cannot be masked", async () => {
  const harness = await loadPluginHarness();

  // An in-flow auto-layout child AND a bad enum. The context refusal must win: it is the
  // one that tells the caller their whole approach is wrong, where an enum error would
  // send them back to fix a value that was never going to be applied.
  await assert.rejects(
    () => harness.command("set_constraints", { nodeId: AL_CHILD, horizontal: "NOPE" }),
    /is in its flow/,
  );
});

test("set_constraints is excluded from apply_batch in BOTH copies, by name", async () => {
  const harness = await loadPluginHarness();
  const vocabulary = harness.globals("batchVocabulary")();

  // ⛔ R2.6 item 2.6 decided this before the tool existed. An absence on the record is a
  // decision; an absence in silence is an oversight someone quietly reverses later.
  assert.ok(
    !vocabulary.V1_BATCH_OPERATIONS.includes("set_constraints"),
    "set_constraints must not be on the allowlist",
  );
  assert.match(
    vocabulary.EXCLUDED_BATCH_OPERATIONS.set_constraints,
    /R2\.6 2\.6/,
    "the exclusion must carry its reason, not just its name",
  );
});

test("apply_batch refuses set_constraints at the schema layer", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: [
          {
            id: "op-1",
            op: "set_constraints",
            nodeId: PLAIN_CHILD,
            params: { horizontal: "MAX" },
          },
        ],
      }),
    /set_constraints/,
  );
  // ⛔ And the document did not move on the way to that refusal.
  assert.deepEqual(constraintsOf(harness, PLAIN_CHILD), {
    horizontal: "MIN",
    vertical: "MIN",
  });
});
