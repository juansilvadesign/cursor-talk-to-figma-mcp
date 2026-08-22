import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.6 item 2.3 — `set_size_limits`, a node's minimum and maximum width and height.
 *
 * ⛔ **THIS IS THE FIRST LAYOUT TOOL SINCE PHASE 1 WHERE PARTIAL APPLICATION IS GENUINELY
 * POSSIBLE**, and the file is arranged around that. 2.1 wrote one field, 2.2 wrote one
 * OBJECT — a half-written state could not be represented there, so validate-all-then-write
 * was a formality. Here four independent number properties are written in sequence, which
 * is the shape `set_corner_radius` and `set_padding` are in `NON_ATOMIC_BATCH_OPERATIONS`
 * for. Every refusal below therefore asserts the side-effect channel is EMPTY and places
 * the invalid parameter LAST, because a test that only asserts the call threw cannot tell
 * validate-all-first from validate-as-you-go.
 *
 * ⚠️ **The pair trap has TWO halves and they fail differently.**
 * ① Validation is on the EFFECTIVE post-write pair — supplied merged over stored — so a
 *    lone `minWidth` is checked against the `maxWidth` the node already holds. A tool that
 *    only compared the arguments to each other would pass every test but that one.
 * ② The WRITE ORDER matters after validation passes, because two assignments pass through
 *    an intermediate state. The harness models Figma's refusal of a min above a max, so a
 *    careless order genuinely throws here rather than only against the real platform —
 *    `raises both bounds` and `lowers both bounds` fail in OPPOSITE orders, and no single
 *    fixed order passes both.
 *
 * 🔴 **The vacuity trap, and how this file avoids it.** Every limit defaults to `null`, so
 * a refusal test that snapshots all-null and finds all-null afterwards passes against a
 * tool that writes nothing ever — and against a tool that does not exist. Every refusal
 * below SEEDS a distinguishable state first and asserts it survived, and `writes what it
 * says it writes` runs first to prove the channel moves at all.
 *
 * ⭐ **`appliedFields` is present here and was deliberately ABSENT from 2.2's receipt.**
 * There both axes were written on every call, so the list would have been a constant that
 * could never fail in either direction — item 2.1's false green. Here each of the four is
 * independent and optional, so a field the platform did not take is genuinely missing
 * from it.
 */

// Page Two. ⛔ The CONTEXT is load-bearing here, and the node types deliberately are NOT.
// The live gate's §6 matrix measured Figma's real rule — min/max are writable on auto-layout
// nodes and their children, and on nothing else, REGARDLESS of type. This file's first
// draft modelled a type rule instead and every one of its eligibility tests was green
// against a fiction: a RECTANGLE in an auto-layout frame was refused offline and accepted
// live, a TEXT in a plain frame the other way round.
//
// ⚠️ `50:*` was added for this item precisely because every pre-existing frame on the page
// is the case Figma REFUSES.
const FRAME = "50:2"; // Sizing Card — FRAME 400×300, child of the auto-layout 50:1.
const TEXT = "50:3"; // Sizing Caption — TEXT, child of the auto-layout 50:1.
const RECT_IN_AL = "50:4"; // Sizing Badge — RECTANGLE, child of the auto-layout 50:1.
const AL_FRAME = "50:1"; // Sizing Stack — FRAME 400×300, layoutMode VERTICAL.
// ⛔ The ineligible side, all four of them refused for the SAME reason — no auto-layout in
// sight — and not one of them for being the wrong type.
const PLAIN_FRAME = "30:1"; // Static Card — FRAME, layoutMode NONE, child of PAGE.
const RECT_IN_PLAIN = "30:2"; // Pinned Badge — RECTANGLE inside that plain frame.
const TEXT_IN_PLAIN = "30:3"; // Caption — TEXT inside that plain frame.
const GROUP = "40:1"; // Loose Group — GROUP on the page.
const PAGE = "1:1";

const FIELDS = ["minWidth", "maxWidth", "minHeight", "maxHeight"];

/**
 * ⛔ Deliberately NOT the all-null default, and deliberately clear of the node's own
 * 400×300 so seeding cannot resize it — the clamp is a separate claim with its own test,
 * and a seed that moved the geometry would contaminate every refusal snapshot below.
 */
const SEED = { minWidth: 100, maxWidth: 800, minHeight: 50, maxHeight: 600 };

function limitsOf(harness, nodeId) {
  const node = harness.getNode(nodeId);
  const result = {};
  for (const field of FIELDS) result[field] = node[field];
  return result;
}

/**
 * The full side-effect channel, geometry included. ⭐ The stored value alone is the wrong
 * currency for this tool: a limit that clamps the node has changed the document in a way
 * no reading of `minWidth` can show, so a refusal that "changed nothing" has to be checked
 * against size too.
 */
function snapshot(harness, nodeId) {
  const node = harness.getNode(nodeId);
  return JSON.stringify({
    limits: limitsOf(harness, nodeId),
    width: node.width,
    height: node.height,
  });
}

async function seed(harness, nodeId = FRAME, values = SEED) {
  await harness.command("set_size_limits", { nodeId, ...values });
  assert.deepEqual(
    limitsOf(harness, nodeId),
    { ...{ minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }, ...values },
    "seed did not take — every refusal assertion below would be vacuous",
  );
}

async function refuses(harness, params, matcher, nodeId = FRAME) {
  const before = snapshot(harness, nodeId);
  await assert.rejects(
    () => harness.command("set_size_limits", { nodeId, ...params }),
    matcher,
  );
  assert.equal(
    snapshot(harness, nodeId),
    before,
    "the node must be byte-identical after a refusal — a refusal that mutates is F4",
  );
}

test("writes what it says it writes, and reports all four fields", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 100,
    maxWidth: 800,
    minHeight: 50,
    maxHeight: 600,
  });

  assert.equal(result.id, FRAME);
  assert.equal(result.type, "FRAME");
  assert.deepEqual(result.limits, SEED);
  assert.deepEqual(result.previous, {
    minWidth: null,
    maxWidth: null,
    minHeight: null,
    maxHeight: null,
  });
  assert.deepEqual(result.requestedFields, FIELDS);
  assert.deepEqual(result.appliedFields, FIELDS);
  assert.deepEqual(result.clearedFields, []);
  assert.deepEqual(result.preservedFields, []);
  assert.deepEqual(result.changedFields, FIELDS);
  assert.equal(result.unchanged, false);
  assert.equal(result.parentId, AL_FRAME);
  assert.equal(result.parentType, "FRAME");
  assert.equal(result.parentLayoutMode, "VERTICAL");

  // ⛔ Read the NODE, not the reply. A reply is what the tool chose to say.
  assert.deepEqual(limitsOf(harness, FRAME), SEED);
});

test("a single field is written and the other three are PRESERVED, not reset", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 250,
  });

  // ⭐ The whole preserve claim in one assertion. A handler that rebuilt the set from its
  // arguments would null the other three; one that wrote an object would drop them.
  assert.deepEqual(result.limits, { ...SEED, minWidth: 250 });
  assert.deepEqual(result.requestedFields, ["minWidth"]);
  assert.deepEqual(result.appliedFields, ["minWidth"]);
  assert.deepEqual(result.preservedFields, ["maxWidth", "minHeight", "maxHeight"]);
  assert.deepEqual(result.changedFields, ["minWidth"]);
  assert.deepEqual(limitsOf(harness, FRAME), { ...SEED, minWidth: 250 });
});

test("null CLEARS a limit, and an omitted field is not the same thing", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    maxWidth: null,
  });

  // ⭐ The two halves of R2.3's semantics, discriminated in one call: `maxWidth` was named
  // and is gone, `minWidth`/`minHeight`/`maxHeight` were omitted and survive. A tool that
  // treated null as "not supplied" would leave maxWidth at 800 and report it preserved.
  assert.equal(result.limits.maxWidth, null);
  assert.equal(result.limits.minWidth, 100);
  assert.deepEqual(result.requestedFields, ["maxWidth"]);
  assert.deepEqual(result.clearedFields, ["maxWidth"]);
  assert.deepEqual(result.appliedFields, ["maxWidth"]);
  assert.deepEqual(result.preservedFields, ["minWidth", "minHeight", "maxHeight"]);
  assert.deepEqual(result.changedFields, ["maxWidth"]);
  assert.equal(harness.getNode(FRAME).maxWidth, null);
  assert.equal(harness.getNode(FRAME).minWidth, 100);
});

test("clearing a limit is a supplied field, not an empty call", async () => {
  const harness = await loadPluginHarness();
  // ⛔ The regression this pins: treating `null` as absent would make the one call that
  // removes a limit fail the zero-field refusal instead of clearing anything.
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: null,
  });
  assert.deepEqual(result.requestedFields, ["minWidth"]);
  assert.deepEqual(result.clearedFields, ["minWidth"]);
});

test("rewriting the same values reports unchanged instead of claiming a change", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  const result = await harness.command("set_size_limits", { nodeId: FRAME, ...SEED });

  assert.deepEqual(result.changedFields, []);
  assert.equal(result.unchanged, true);
  // ⭐ Idempotence is legitimate and is NOT refused — but `appliedFields` still lists all
  // four, because "the node holds what you asked for" and "something moved" are two
  // different facts and this receipt reports them separately.
  assert.deepEqual(result.appliedFields, FIELDS);
});

test("a TEXT node in an auto-layout frame takes limits — type is not the rule", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_size_limits", {
    nodeId: TEXT,
    maxWidth: 300,
  });
  assert.equal(result.type, "TEXT");
  assert.equal(result.limits.maxWidth, 300);
  assert.equal(harness.getNode(TEXT).maxWidth, 300);
});

test("a RECTANGLE in an auto-layout frame takes limits too", async () => {
  const harness = await loadPluginHarness();
  // ⛔ The single case that proves the rule is contextual rather than type-based, and the
  // one this file's first draft got backwards: it asserted a RECTANGLE was REFUSED for
  // having no size-limit surface. The live matrix measured Figma accepting exactly this.
  const result = await harness.command("set_size_limits", {
    nodeId: RECT_IN_AL,
    maxWidth: 300,
  });
  assert.equal(result.type, "RECTANGLE");
  assert.equal(result.limits.maxWidth, 300);
});

test("an auto-layout frame takes limits by being one, not by having an auto-layout parent", async () => {
  const harness = await loadPluginHarness();
  // ⭐ Its parent is the PAGE, so this passes only on the FIRST half of the rule. A guard
  // that checked the parent alone would refuse it — and the live matrix measured Figma
  // accepting it.
  const result = await harness.command("set_size_limits", {
    nodeId: AL_FRAME,
    minWidth: 200,
  });
  assert.equal(result.parentType, "PAGE");
  assert.equal(result.limits.minWidth, 200);
});

// ---------------------------------------------------------------------------
// The pair trap, half one: validation against what the node already holds
// ---------------------------------------------------------------------------

test("a lone minWidth is refused against the STORED maxWidth", async () => {
  const harness = await loadPluginHarness();
  await seed(harness, FRAME, { maxWidth: 300 });

  // ⭐ THE headline case. The call contains no maximum at all, so a tool that compared its
  // arguments to each other sees nothing wrong and hands Figma a conflict the caller could
  // not have spotted in their own parameters.
  await refuses(
    harness,
    { minWidth: 500 },
    /minWidth 500 \(requested\) is greater than maxWidth 300 \(already stored\)/,
  );
});

test("a lone maxHeight is refused against the STORED minHeight — both directions", async () => {
  const harness = await loadPluginHarness();
  await seed(harness, FRAME, { minHeight: 400 });

  await refuses(
    harness,
    { maxHeight: 200 },
    /minHeight 400 \(already stored\) is greater than maxHeight 200 \(requested\)/,
  );
});

test("a min above a max inside ONE call is refused before anything is written", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  await refuses(
    harness,
    { minWidth: 900, maxWidth: 400 },
    /minWidth 900 \(requested\) is greater than maxWidth 400 \(requested\)/,
  );
});

test("a supplied value merged over a stored one can RESOLVE a conflict, not only cause it", async () => {
  const harness = await loadPluginHarness();
  await seed(harness, FRAME, { maxWidth: 300 });

  // ⛔ The other side of the merge, and it is what stops the pair rule from being a blanket
  // "refuse if the stored max is low". Raising the max in the same call makes the pair
  // valid, so this must SUCCEED — a tool that validated against stored values alone,
  // ignoring what the call supplies, would refuse it.
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 500,
    maxWidth: 600,
  });
  assert.equal(result.limits.minWidth, 500);
  assert.equal(result.limits.maxWidth, 600);
});

test("clearing the opposing bound in the same call makes an impossible pair legal", async () => {
  const harness = await loadPluginHarness();
  await seed(harness, FRAME, { maxWidth: 300 });

  // A null on the other half removes the bound entirely, so there is no pair left to
  // violate. A tool that checked the stored 300 would refuse this wrongly.
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 500,
    maxWidth: null,
  });
  assert.equal(result.limits.minWidth, 500);
  assert.equal(result.limits.maxWidth, null);
});

test("the two axes are independent — a width conflict is not a height conflict", async () => {
  const harness = await loadPluginHarness();
  await seed(harness, FRAME, { maxHeight: 100 });

  // minWidth has no relationship to maxHeight. A tool that pooled all four into one
  // comparison would refuse this.
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 500,
  });
  assert.equal(result.limits.minWidth, 500);
  assert.equal(result.limits.maxHeight, 100);
});

// ---------------------------------------------------------------------------
// The pair trap, half two: write order
// ---------------------------------------------------------------------------

test("RAISING both bounds past the stored max writes the max FIRST", async () => {
  const harness = await loadPluginHarness();
  await seed(harness, FRAME, { minWidth: 100, maxWidth: 200 });

  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 500,
    maxWidth: 600,
  });

  // ⛔ The end state is valid, so validation cannot catch this — only the ORDER can. Written
  // min-first, the node would momentarily hold minWidth 500 against the stored maxWidth
  // 200, which the platform rejects. The harness models that rejection, so a fixed
  // min-then-max order throws here rather than passing offline and failing in Figma.
  assert.deepEqual(result.writeOrder, ["maxWidth", "minWidth"]);
  assert.equal(result.limits.minWidth, 500);
  assert.equal(result.limits.maxWidth, 600);
});

test("LOWERING both bounds below the stored min writes the min FIRST", async () => {
  const harness = await loadPluginHarness();
  await seed(harness, FRAME, { minWidth: 400, maxWidth: 600 });

  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 100,
    maxWidth: 200,
  });

  // ⭐ The opposite order, and this is why a fixed order cannot be right: max-first would
  // momentarily hold maxWidth 200 under the stored minWidth 400. Between this test and the
  // one above, NO constant ordering passes both — the choice has to be computed.
  assert.deepEqual(result.writeOrder, ["minWidth", "maxWidth"]);
  assert.equal(result.limits.minWidth, 100);
  assert.equal(result.limits.maxWidth, 200);
});

test("the height axis computes its own order, independently of width", async () => {
  const harness = await loadPluginHarness();
  await seed(harness, FRAME, {
    minWidth: 400,
    maxWidth: 600,
    minHeight: 50,
    maxHeight: 100,
  });

  // Width is lowering (min first), height is raising (max first) — in ONE call. A handler
  // that picked one order for the whole call cannot satisfy both.
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 100,
    maxWidth: 200,
    minHeight: 300,
    maxHeight: 400,
  });

  assert.deepEqual(result.writeOrder, [
    "minWidth",
    "maxWidth",
    "maxHeight",
    "minHeight",
  ]);
  assert.deepEqual(result.limits, {
    minWidth: 100,
    maxWidth: 200,
    minHeight: 300,
    maxHeight: 400,
  });
});

// ---------------------------------------------------------------------------
// Value validation
// ---------------------------------------------------------------------------

test("zero is refused rather than read as 'no limit'", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  // ⛔ `null` already says "no limit" unambiguously, and a maxWidth of 0 describes a node
  // that cannot exist. `create_text` set this precedent by refusing `fontSize: 0` instead
  // of silently substituting 14.
  await refuses(harness, { minWidth: 0 }, /minWidth must be greater than 0/);
  await refuses(harness, { maxHeight: 0 }, /maxHeight must be greater than 0/);
});

test("a negative limit is refused", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await refuses(harness, { maxWidth: -5 }, /maxWidth must be greater than 0/);
});

test("a non-finite or non-numeric limit is refused, not coerced", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  await refuses(harness, { minWidth: Number.NaN }, /minWidth must be a positive number/);
  await refuses(
    harness,
    { maxWidth: Number.POSITIVE_INFINITY },
    /maxWidth must be a positive number/,
  );
  // ⚠️ Reachable through the transport even though Zod types the field, because the plugin
  // is addressable by anything speaking the relay protocol — the same reason 2.2 kept its
  // context rules in the handler.
  await refuses(harness, { minHeight: "200" }, /minHeight must be a positive number/);
});

test("a fractional limit is accepted — this is not an integers-only tool", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 12.5,
  });
  assert.equal(result.limits.minWidth, 12.5);
  assert.deepEqual(result.appliedFields, ["minWidth"]);
});

test("the receipt reports what the NODE holds, not what the call asked for", async () => {
  // ⛔ The one mutation the rest of this file could not kill. While the platform stores
  // exactly what it is handed, a receipt that echoed its arguments and one that read the
  // node back produce identical output — so neither the values nor `appliedFields` could
  // separate them, and `appliedFields` would be decorative for the second time in three
  // items. A node that ROUNDS its limits separates them in one reading.
  const harness = await loadPluginHarness({ roundSizeLimits: [FRAME] });

  const result = await harness.command("set_size_limits", {
    nodeId: FRAME,
    minWidth: 12.5,
  });

  // An echo reports 12.5 here; a read-back reports 13.
  assert.equal(result.limits.minWidth, 13);
  assert.equal(harness.getNode(FRAME).minWidth, 13);
  // ⭐ And this is what makes `appliedFields` a real reading rather than a constant: the
  // field was requested, the node did NOT take the value as given, so it is absent. A
  // caller learns from the reply alone that their number was changed under them.
  assert.deepEqual(result.requestedFields, ["minWidth"]);
  assert.deepEqual(result.appliedFields, []);
  assert.deepEqual(result.changedFields, ["minWidth"]);
});

test("a call naming no limit at all is refused, not answered 'done'", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await refuses(
    harness,
    {},
    /set_size_limits requires at least one of minWidth, maxWidth, minHeight, maxHeight/,
  );
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

test("a node outside any auto-layout is refused BEFORE the platform sees it", async () => {
  const harness = await loadPluginHarness();
  // ⭐ The rule the live matrix measured, and the reason it has to be enforced here rather
  // than left to Figma: the four properties are READABLE on this node, so nothing about
  // reading them distinguishes it from an eligible one. Only the write is gated, and a
  // write phase that can throw is a partial application waiting for the right ordering.
  // ⛔ The refusal must be the handler's own, naming the way in — the harness models the
  // platform's message, so a handler that skipped the check would fail with
  // "Can only set minWidth on auto layout nodes" instead and this assertion would catch it.
  await refuses(
    harness,
    { minWidth: 100 },
    /Figma only accepts min\/max sizing on auto-layout nodes and their children[\s\S]*set_layout_mode/,
    PLAIN_FRAME,
  );
});

test("type is NOT the rule — the same two types are refused outside auto-layout", async () => {
  const harness = await loadPluginHarness();
  // ⛔ The mirror of the two acceptance tests above. A RECTANGLE and a TEXT are accepted
  // inside an auto-layout frame and refused inside a plain one, so no type-based guard can
  // produce all four of these readings.
  await refuses(harness, { maxWidth: 100 }, /auto-layout nodes and their children/, RECT_IN_PLAIN);
  await refuses(harness, { maxWidth: 100 }, /auto-layout nodes and their children/, TEXT_IN_PLAIN);
});

test("a GROUP and a PAGE are refused for the same reason as everything else", async () => {
  const harness = await loadPluginHarness();
  // ⭐ Subsumed by the context rule rather than needing their own clause: neither has a
  // layoutMode, and neither sits inside anything that does.
  await refuses(harness, { maxWidth: 100 }, /auto-layout nodes and their children/, GROUP);
  await refuses(harness, { maxWidth: 100 }, /auto-layout nodes and their children/, PAGE);
});

test("the context rule is evaluated at WRITE time, not at creation", async () => {
  const harness = await loadPluginHarness();
  // A plain frame is refused; giving it an auto-layout makes the same call succeed. ⛔ A
  // guard that cached eligibility when the node was built would keep refusing.
  await assert.rejects(
    () => harness.command("set_size_limits", { nodeId: PLAIN_FRAME, minWidth: 100 }),
    /auto-layout nodes and their children/,
  );
  await harness.command("set_layout_mode", { nodeId: PLAIN_FRAME, layoutMode: "HORIZONTAL" });
  const result = await harness.command("set_size_limits", {
    nodeId: PLAIN_FRAME,
    minWidth: 100,
  });
  assert.equal(result.limits.minWidth, 100);
});

test("a missing node is refused before any surface probe", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_size_limits", { nodeId: "9999:9999", minWidth: 100 }),
    /Node with ID 9999:9999 not found/,
  );
});

// ---------------------------------------------------------------------------
// Validate-all-then-write (plan 2.5), where it finally has teeth
// ---------------------------------------------------------------------------

test("an invalid field LAST leaves the three valid ones unwritten", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  // ⛔ The distinction this exists to make. `minWidth`, `maxWidth` and `minHeight` are all
  // valid and are validated BEFORE `maxHeight`, so a validate-as-you-go handler writes
  // three fields and then throws — and the document is left in a state nobody asked for.
  // Asserting only that the call threw cannot tell the two apart.
  await refuses(
    harness,
    { minWidth: 111, maxWidth: 999, minHeight: 55, maxHeight: -1 },
    /maxHeight must be greater than 0/,
  );

  // Explicit rather than relying on the helper alone: the three valid values must be absent.
  assert.deepEqual(limitsOf(harness, FRAME), SEED);
});

test("a pair violation on the SECOND axis leaves the first axis unwritten", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  // The width pair is fine and the height pair is not. A handler that validated and wrote
  // one axis at a time would have already committed the width fields.
  await refuses(
    harness,
    { minWidth: 200, maxWidth: 700, minHeight: 500, maxHeight: 300 },
    /minHeight 500 \(requested\) is greater than maxHeight 300 \(requested\)/,
  );
  assert.deepEqual(limitsOf(harness, FRAME), SEED);
});

test("a refusal never resizes the node — the geometry channel is checked too", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  const before = harness.getNode(FRAME).width;

  // ⭐ Measured in the second currency. A limit that landed even briefly would have clamped
  // the node, and the stored value alone cannot report that.
  await refuses(harness, { maxWidth: 50, minWidth: 60 }, /is greater than maxWidth 50/);
  assert.equal(harness.getNode(FRAME).width, before);
});

// ---------------------------------------------------------------------------
// The clamp — the side effect the stored value cannot report
// ---------------------------------------------------------------------------

test("a maximum below the current size RESIZES the node, and the receipt says so", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME, // 400×300
    maxWidth: 250,
  });

  assert.deepEqual(result.size.before, { width: 400, height: 300 });
  assert.deepEqual(result.size.after, { width: 250, height: 300 });
  assert.equal(result.resized, true);
  assert.equal(harness.getNode(FRAME).width, 250);
});

test("a minimum above the current size grows the node", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME, // 400×300
    minHeight: 450,
  });

  assert.deepEqual(result.size.after, { width: 400, height: 450 });
  assert.equal(result.resized, true);
});

test("a limit the node already satisfies reports resized:false", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_size_limits", {
    nodeId: FRAME, // 400×300
    maxWidth: 800,
  });

  // ⛔ Both outcomes of `resized` are asserted somewhere in this file. A flag that only
  // ever reads one way is the shape item 2.1's false green had.
  assert.equal(result.resized, false);
  assert.deepEqual(result.size.before, result.size.after);
});

// ---------------------------------------------------------------------------
// The pinned absence (plan 2.6)
// ---------------------------------------------------------------------------

test("set_size_limits is excluded from apply_batch in BOTH copies, by name", async () => {
  const harness = await loadPluginHarness();
  const vocabulary = harness.globals("batchVocabulary")();

  // ⛔ R2.6 item 2.6 decided this before the tool existed. An absence on the record is a
  // decision; an absence in silence is an oversight someone quietly reverses later.
  assert.ok(
    !vocabulary.V1_BATCH_OPERATIONS.includes("set_size_limits"),
    "set_size_limits must not be on the allowlist",
  );
  assert.match(
    vocabulary.EXCLUDED_BATCH_OPERATIONS.set_size_limits,
    /R2\.6 2\.6/,
    "the exclusion must carry its reason, not just its name",
  );
});

test("apply_batch refuses set_size_limits at the schema layer", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);
  await assert.rejects(
    () =>
      harness.command("apply_batch", {
        operations: [
          {
            id: "op-1",
            op: "set_size_limits",
            nodeId: FRAME,
            params: { minWidth: 100 },
          },
        ],
      }),
    /set_size_limits/,
  );
  // ⛔ And the document did not move on the way to that refusal.
  assert.deepEqual(limitsOf(harness, FRAME), SEED);
});
