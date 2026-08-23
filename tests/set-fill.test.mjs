import assert from "node:assert/strict";
import test from "node:test";

import { buildContract } from "../scripts/contract-lib.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

/**
 * R2.7 item 1.1 — `set_fill`, the first visual tool.
 *
 * ⛔ **THE TOOL EXISTS TO END A DIVERGENCE, so the suite's first job is to pin the
 * divergence itself.** R2.4's live gate caught `apply_batch`'s `set_fill_color` taking
 * `{color:{r,g,b,a}}` while the standalone `set_fill_color` takes flat `r,g,b,a` — two
 * shapes behind one name, described in the contract as the same shape. `set_fill_color` is
 * `stable` and cannot be repaired, so the divergence is pinned by a test rather than fixed,
 * and `set_fill` ships one shape on both surfaces.
 *
 * ⚠️ **WHAT THIS FILE CANNOT DECIDE, AND DOES NOT PRETEND TO.** Two readings in the receipt
 * are about the PLATFORM, not about this tool, and no offline assertion can settle either:
 *
 *   ① `styleDetached` — whether assigning `fills` to a node with a paint style bound
 *      detaches that style. The harness models BOTH worlds on request
 *      (`detachStyleOnFillWrite`) and NEITHER by default, and the tool is asserted to
 *      report the reading correctly in each. Encoding one as the default would be 2.3's
 *      fiction: green offline against a rule Figma does not have.
 *   ② The angle → `gradientTransform` convention. Reading the matrix back only echoes what
 *      `gradientTransformFromAngle` computed, so agreement here is arithmetic agreeing
 *      with itself. `live-fill-gate.mjs` settles it by RENDERING.
 *
 * ⭐ **THE READ-BACK IS HELD HONEST BY `ignoreFillWrites`, not by a platform claim.** It is
 * tempting to argue Figma normalizes paints on assignment (supplying `visible`/`opacity`/
 * `blendMode` defaults), so that an echo and a read-back would differ by eye. That is a
 * platform claim. 2.4's instrument needs none: a node that ACCEPTS the write and keeps its
 * old fills reports the old array through a read-back and the new one through an echo, in
 * one reading. See [[feedback_a_zero_valued_write_reads_as_no_write]].
 *
 * ⭐ **Partial application is structurally impossible** — `node.fills = [...]` is one
 * assignment. So validate-all-then-write is satisfied by construction for the WRITE, and
 * the half that has to be tested is that a bad paint in slot 4 of 5 refuses the whole call
 * without the document moving. That is 2.3's lesson applied at design time.
 */

// ⭐ The fixture's own states are used rather than hand-set ones wherever possible — a
// property a test assigns itself is a property that test is no longer measuring.
const EMPTY = "10:1";      // FRAME, no fills and no bound style — the clean write target
const STYLED = "10:3";     // RECTANGLE carrying an IMAGE fill AND fillStyleId "style-paint-remote"
const TEXT = "10:2";       // TEXT — a fill carrier, and the one that can go mixed
const GROUP = "40:1";      // GROUP — NOT a fill carrier
const INSTANCE = "60:3";   // INSTANCE — a carrier, and the context most likely to gate a write

const STYLE_ID = "style-paint-remote";

const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

const LINEAR = {
  type: "GRADIENT_LINEAR",
  gradientStops: [
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
  ],
};

// ---------------------------------------------------------------------------
// The write, and that it is a read-back rather than an echo
// ---------------------------------------------------------------------------

test("writes one solid paint and reports it read back from the node", async () => {
  const harness = await loadPluginHarness();
  assert.deepEqual(
    harness.getNode(EMPTY).fills,
    [],
    "fixture precondition: the rectangle starts with no fills, so writing one is a real change",
  );

  const result = await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ type: "SOLID", color: RED }],
  });

  assert.equal(result.id, EMPTY);
  assert.equal(result.type, "FRAME");
  assert.equal(result.fillCount, 1);
  assert.equal(result.fills[0].type, "SOLID");
  assert.deepEqual(result.fills[0].color, RED);
  assert.deepEqual(result.previous, []);
  assert.equal(result.previousReadable, true);
  assert.equal(result.previousMixed, false);
  assert.equal(result.requestedCount, 1);
  assert.equal(result.cleared, false);

  // ⛔ The document, not the reply. A receipt is not evidence that anything was written.
  assert.equal(harness.getNode(EMPTY).fills.length, 1);
  assert.deepEqual(harness.getNode(EMPTY).fills[0].color, RED);
});

test("the reported fills are READ BACK, not echoed — a discarding node proves it", async () => {
  // ⭐ THE TEST THAT KILLS THE ECHO MUTATION, and the only one in this file that can. The
  // node accepts the assignment and keeps its old fills; an echo would report the argument
  // and claim success, a read-back reports what the document actually holds.
  const harness = await loadPluginHarness({ ignoreFillWrites: [EMPTY] });

  const result = await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ type: "SOLID", color: RED }],
  });

  assert.deepEqual(
    result.fills,
    [],
    "the node discarded the write, so the reply must report the empty array it still holds — an echo would report the red paint",
  );
  assert.equal(result.fillCount, 0);
  assert.equal(harness.getNode(EMPTY).fills.length, 0);
});

test("stacks multiple paints in the order given, bottom first", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ type: "SOLID", color: RED }, LINEAR],
  });

  assert.equal(result.fillCount, 2);
  assert.equal(result.fills[0].type, "SOLID");
  assert.equal(result.fills[1].type, "GRADIENT_LINEAR");
  assert.equal(harness.getNode(EMPTY).fills.length, 2);
});

// ---------------------------------------------------------------------------
// null clears, [] is refused — R2.3's semantics, reused rather than reinvented
// ---------------------------------------------------------------------------

test("paints: null removes every fill and reports cleared", async () => {
  const harness = await loadPluginHarness();
  await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ type: "SOLID", color: RED }],
  });

  const result = await harness.command("set_fill", { nodeId: EMPTY, paints: null });

  assert.equal(result.cleared, true);
  assert.equal(result.requestedCount, 0);
  assert.deepEqual(result.fills, []);
  assert.equal(result.previous.length, 1, "the previous reading still shows what was there");
  assert.equal(harness.getNode(EMPTY).fills.length, 0);
});

test("an EMPTY array is refused, because null already says that", async () => {
  // ⛔ Two ways to say one thing is how one of them gets discarded silently — the
  // `fontWeight` × `fontFamily` refusal `create_text` shipped, on a different pair.
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_fill", { nodeId: EMPTY, paints: [] }),
    /empty paints array.*Pass null/s,
  );
  assert.equal(harness.getNode(EMPTY).fills.length, 0);
});

test("omitting paints entirely is refused, and is a different message from clearing", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_fill", { nodeId: EMPTY }),
    /requires paints/,
  );
});

// ---------------------------------------------------------------------------
// Validate-all-then-write
// ---------------------------------------------------------------------------

test("a bad paint in the LAST slot refuses the whole call and writes nothing", async () => {
  // ⛔ The half of validate-all-then-write that is not free. The write is one assignment so
  // it cannot partially apply, but a handler that validated as it built would still have
  // constructed four good paints before throwing — and on a tool that wrote per-paint, that
  // is a partial application waiting for the right ordering.
  // ⚠️ The invalid entry is LAST on purpose: asserting that it threw does NOT assert WHEN
  // it threw, and a validate-as-you-go handler is indistinguishable from a validate-all one
  // unless the bad entry sits after some good ones. See
  // [[feedback_asserting_it_threw_does_not_assert_when_it_threw]].
  const harness = await loadPluginHarness();
  await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ type: "SOLID", color: BLUE }],
  });

  await assert.rejects(
    () =>
      harness.command("set_fill", {
        nodeId: EMPTY,
        paints: [
          { type: "SOLID", color: RED },
          { type: "SOLID", color: RED },
          { type: "SOLID", color: RED },
          { type: "SOLID", color: { r: 1, g: 0, b: 5 } },
        ],
      }),
    /paints\[3\].*between 0 and 1/s,
  );

  // ⛔ The side-effect channel must be EMPTY — the node still holds exactly what it held
  // before, not four of the five paints.
  const fills = harness.getNode(EMPTY).fills;
  assert.equal(fills.length, 1);
  assert.deepEqual(fills[0].color, BLUE);
});

test("out-of-range channels are REFUSED, never clamped or coerced", async () => {
  // ⛔ Legacy `set_fill_color` runs `parseFloat(r) || 0`, which turns a typo into black and
  // reports success. A clamp would be a discarded value reading as an applied one.
  const harness = await loadPluginHarness();
  await assert.rejects(
    () =>
      harness.command("set_fill", {
        nodeId: EMPTY,
        paints: [{ type: "SOLID", color: { r: 255, g: 0, b: 0 } }],
      }),
    /between 0 and 1.*0-255 bytes/s,
  );
  await assert.rejects(
    () =>
      harness.command("set_fill", {
        nodeId: EMPTY,
        paints: [{ type: "SOLID", color: { r: "red", g: 0, b: 0 } }],
      }),
    /must be a number between 0 and 1/,
  );
  assert.equal(harness.getNode(EMPTY).fills.length, 0);
});

// ---------------------------------------------------------------------------
// The two refused combinations — one question, one answer
// ---------------------------------------------------------------------------

test("color.a and opacity together are refused on a SOLID", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () =>
      harness.command("set_fill", {
        nodeId: EMPTY,
        paints: [{ type: "SOLID", color: { ...RED, a: 0.5 }, opacity: 0.9 }],
      }),
    /color\.a OR opacity, not both/,
  );
  assert.equal(harness.getNode(EMPTY).fills.length, 0);
});

test("either alpha spelling alone is accepted and lands in the paint's opacity", async () => {
  const harness = await loadPluginHarness();

  const viaColor = await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ type: "SOLID", color: { ...RED, a: 0.25 } }],
  });
  assert.equal(viaColor.fills[0].opacity, 0.25);
  assert.equal(
    viaColor.fills[0].color.a,
    undefined,
    "alpha belongs in the paint's opacity, not inside the stored colour",
  );

  const viaOpacity = await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ type: "SOLID", color: RED, opacity: 0.25 }],
  });
  assert.equal(viaOpacity.fills[0].opacity, 0.25);
});

test("gradientTransform and angle together are refused", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () =>
      harness.command("set_fill", {
        nodeId: EMPTY,
        paints: [
          {
            ...LINEAR,
            angle: 90,
            gradientTransform: [
              [1, 0, 0],
              [0, 1, 0],
            ],
          },
        ],
      }),
    /gradientTransform OR angle, not both/,
  );
  assert.equal(harness.getNode(EMPTY).fills.length, 0);
});

test("scale without angle is refused rather than silently ignored", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_fill", { nodeId: EMPTY, paints: [{ ...LINEAR, scale: 2 }] }),
    /scale only applies to angle/,
  );
});

// ---------------------------------------------------------------------------
// Gradients, and the provenance of the matrix
// ---------------------------------------------------------------------------

test("gradientAim records WHICH input produced the matrix, per paint", async () => {
  // ⭐ A silent default and a decision are byte-identical in the stored value — the whole
  // point of [[feedback_a_silent_default_is_byte_identical_to_a_decision]]. `gradientAim`
  // is the provenance reading that separates them, and it is per-paint because one call
  // can mix all three cases.
  const harness = await loadPluginHarness();
  const result = await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [
      { type: "SOLID", color: RED },
      { ...LINEAR, angle: 90 },
      { ...LINEAR, gradientTransform: [[1, 0, 0], [0, 1, 0]] },
      { ...LINEAR },
    ],
  });

  assert.equal(result.gradientAim[0], null, "a solid has no gradient to aim");
  assert.deepEqual(result.gradientAim[1], { source: "angle", angle: 90, scale: 1 });
  assert.deepEqual(result.gradientAim[2], {
    source: "gradientTransform",
    angle: null,
    scale: null,
  });
  assert.deepEqual(result.gradientAim[3], {
    source: "figma-default",
    angle: null,
    scale: null,
  });
});

test("an un-aimed gradient carries NO gradientTransform, rather than one this fork invented", async () => {
  // ⛔ Leaving the property off lets Figma apply its own default. Writing an identity
  // matrix here would be this fork asserting what that default IS, on no measurement.
  const harness = await loadPluginHarness();
  await harness.command("set_fill", { nodeId: EMPTY, paints: [LINEAR] });
  assert.equal(harness.getNode(EMPTY).fills[0].gradientTransform, undefined);
});

test("angle 0 produces Figma's documented identity transform", async () => {
  // ⚠️ This is the ONE anchor point the derivation has that is not self-referential:
  // Figma's own default linear transform is [[1,0,0],[0,1,0]], left-to-right. It is also
  // the point at which a SIGN-FLIPPED convention would agree, so passing here does NOT
  // establish that 90 means top-to-bottom. `live-fill-gate.mjs` renders to settle that.
  const harness = await loadPluginHarness();
  await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ ...LINEAR, angle: 0 }],
  });
  const matrix = harness.getNode(EMPTY).fills[0].gradientTransform;
  assert.deepEqual(matrix, [
    [1, 0, 0],
    [0, 1, 0],
  ]);
});

test("angle 90 maps top-centre to ramp position 0, which is what top-to-bottom MEANS", async () => {
  // ⭐ Not a comparison against a hardcoded matrix — that would restate the implementation.
  // The matrix is APPLIED to two points and the result is checked against the claim the
  // schema publishes: at 90 degrees, the top of the node is the start of the ramp.
  const harness = await loadPluginHarness();
  await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ ...LINEAR, angle: 90 }],
  });
  const [[a, b, c]] = harness.getNode(EMPTY).fills[0].gradientTransform;
  const rampAt = (x, y) => a * x + b * y + c;

  assert.ok(
    Math.abs(rampAt(0.5, 0) - 0) < 1e-9,
    "top centre must sit at ramp position 0",
  );
  assert.ok(
    Math.abs(rampAt(0.5, 1) - 1) < 1e-9,
    "bottom centre must sit at ramp position 1",
  );
});

test("the angle transform is a proper ROTATION, not a reflection", async () => {
  // 🔴 ADDED BECAUSE A MUTATION SURVIVED. Flipping the sign of `d` in
  // `gradientTransformFromAngle` — turning the rotation into a reflection — passed every
  // other test in this file, including the 0-degree and 90-degree ones. The reason is that
  // those read the ramp position, which is row 0 only (`x' = a·x + b·y + c`), and the sign
  // lives in row 1. For a LINEAR gradient row 1 is genuinely unused, so the flip is
  // invisible there — but the same matrix aims RADIAL, ANGULAR and DIAMOND paints, where it
  // is not, and a reflected transform mirrors them.
  //
  // ⭐ The check is a PROPERTY of what "rotate by θ" means, not a copy of the formula: the
  // linear part of a rotation scaled by s has determinant 1/s², while a reflection's is
  // negative. Comparing against a hardcoded matrix would only restate the implementation
  // and would have been satisfied by the mutant too.
  const harness = await loadPluginHarness();

  for (const angle of [0, 30, 90, 135, 210, -45]) {
    await harness.command("set_fill", {
      nodeId: EMPTY,
      paints: [{ ...LINEAR, angle }],
    });
    const [[a, b], [d, e]] = harness.getNode(EMPTY).fills[0].gradientTransform;
    const determinant = a * e - b * d;
    assert.ok(
      Math.abs(determinant - 1) < 1e-9,
      `at ${angle} degrees the transform's determinant is ${determinant}; a rotation's is +1, a reflection's is negative`,
    );
  }

  // And with a scale, the determinant is 1/s² — still positive, so still a rotation.
  await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ ...LINEAR, angle: 45, scale: 2 }],
  });
  const [[a, b], [d, e]] = harness.getNode(EMPTY).fills[0].gradientTransform;
  assert.ok(
    Math.abs(a * e - b * d - 1 / 4) < 1e-9,
    "a rotation scaled by 2 has determinant 1/4",
  );
});

test("a gradient needs at least two stops", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () =>
      harness.command("set_fill", {
        nodeId: EMPTY,
        paints: [
          { type: "GRADIENT_RADIAL", gradientStops: [{ position: 0, color: RED }] },
        ],
      }),
    /at least 2 stops/,
  );
});

test("a gradient stop's alpha defaults to 1 and is not refused against anything", async () => {
  // ⚠️ The deliberate INVERSE of the solid's `color.a` × `opacity` refusal. Figma types
  // stop colours as RGBA and there is no per-stop opacity, so there is no second spelling
  // to collide with and the default can simply be supplied.
  const harness = await loadPluginHarness();
  const result = await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [
      {
        type: "GRADIENT_LINEAR",
        gradientStops: [
          { position: 0, color: RED },
          { position: 1, color: BLUE },
        ],
      },
    ],
  });
  assert.equal(result.fills[0].gradientStops[0].color.a, 1);
  assert.equal(result.fills[0].gradientStops[1].color.a, 1);
});

// ---------------------------------------------------------------------------
// Eligibility — narrow on purpose
// ---------------------------------------------------------------------------

test("a GROUP has no fills surface and is refused", async () => {
  // ⛔ THE ONLY REFUSAL ABOUT THE NODE, and it was unreachable offline until the harness
  // stopped giving every node a blanket `fills: []`. That blanket default is the same
  // dishonest-fixture shape as the blanket `layoutMode: "NONE"` which hid a real
  // `set_layout_sizing` defect for six releases.
  const harness = await loadPluginHarness();
  assert.equal("fills" in harness.getNode(GROUP), false, "fixture precondition");

  await assert.rejects(
    () =>
      harness.command("set_fill", {
        nodeId: GROUP,
        paints: [{ type: "SOLID", color: RED }],
      }),
    /does not support fills/,
  );
});

test("an INSTANCE is allowed, not refused on an unverified claim", async () => {
  // ⚠️ Allow-and-measure. An instance child is the context most likely to make a readable
  // property unwritable, and `live-clips-content-gate` already recorded it as UNMEASURED.
  // Refusing here would be inventing a rule; the gate measures whether Figma refuses.
  const harness = await loadPluginHarness();
  const result = await harness.command("set_fill", {
    nodeId: INSTANCE,
    paints: [{ type: "SOLID", color: RED }],
  });
  assert.equal(result.fillCount, 1);
});

test("a node whose fills read as figma.mixed reports previousMixed, never an empty array", async () => {
  // ⛔ `[]` and `figma.mixed` are OPPOSITE claims — one says the node has no fills, the
  // other that the reading cannot be expressed as an array. A tool that collapses them
  // reports the first when it means the second.
  const harness = await loadPluginHarness({ mixedFills: [TEXT] });

  const result = await harness.command("set_fill", {
    nodeId: TEXT,
    paints: [{ type: "SOLID", color: RED }],
  });

  assert.equal(result.previousMixed, true);
  assert.equal(result.previousReadable, false);
  assert.equal(
    result.previous,
    null,
    "an unreadable previous state is null — reporting [] would claim the node had no fills",
  );
  assert.equal(result.fillCount, 1, "the write itself still lands");
});

// ---------------------------------------------------------------------------
// The second currency — fillStyleId, reported as a READING and not a claim
// ---------------------------------------------------------------------------

test("a bound paint style is reported before and after, with detach NOT assumed", async () => {
  // ⚠️ NEITHER world is the harness default. This leg models a platform that does NOT
  // detach; the next models one that does. The tool must report each correctly, which is
  // what makes `styleDetached` survive whatever the live gate finds.
  const harness = await loadPluginHarness();
  assert.equal(
    harness.getNode(STYLED).fillStyleId,
    STYLE_ID,
    "fixture precondition: this rectangle really does carry a bound paint style",
  );

  const result = await harness.command("set_fill", {
    nodeId: STYLED,
    paints: [{ type: "SOLID", color: RED }],
  });

  assert.equal(result.styleIdBefore, STYLE_ID);
  assert.equal(result.styleIdAfter, STYLE_ID);
  assert.equal(result.styleReadable, true);
  assert.equal(result.styleDetached, false);
});

test("when the platform DOES detach, the receipt says so", async () => {
  const harness = await loadPluginHarness({ detachStyleOnFillWrite: [STYLED] });

  const result = await harness.command("set_fill", {
    nodeId: STYLED,
    paints: [{ type: "SOLID", color: RED }],
  });

  assert.equal(result.styleIdBefore, STYLE_ID);
  assert.equal(result.styleIdAfter, null);
  assert.equal(result.styleDetached, true);

  // ⛔ The document, not the reply — the style really is gone off the node.
  assert.equal(harness.getNode(STYLED).fillStyleId, "");
});

test("a node with no style bound reports null on both sides and detached false", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_fill", {
    nodeId: EMPTY,
    paints: [{ type: "SOLID", color: RED }],
  });
  assert.equal(result.styleIdBefore, null);
  assert.equal(result.styleIdAfter, null);
  assert.equal(
    result.styleDetached,
    false,
    "nothing was bound, so nothing was detached — and that is a real reading, not an absent one",
  );
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

test("the paint count and stop count are bounded", async () => {
  const harness = await loadPluginHarness();
  const many = Array.from({ length: 17 }, () => ({ type: "SOLID", color: RED }));
  await assert.rejects(
    () => harness.command("set_fill", { nodeId: EMPTY, paints: many }),
    /above this fork's ceiling of 16/,
  );

  const stops = Array.from({ length: 65 }, (unused, index) => ({
    position: index / 64,
    color: RED,
  }));
  await assert.rejects(
    () =>
      harness.command("set_fill", {
        nodeId: EMPTY,
        paints: [{ type: "GRADIENT_LINEAR", gradientStops: stops }],
      }),
    /exceeds this fork's ceiling of 64/,
  );
});

// ---------------------------------------------------------------------------
// Contract-level pins
// ---------------------------------------------------------------------------

test("set_fill ships additive-preview, per CC1", async () => {
  // ⛔ Load-bearing in a way it was not for any R2.6 tool: the CC3 freeze landed first this
  // release, so `contracts/baselines/` carries R2.5 and R2.6 and the free walk-back is
  // GONE. A tool that falls through to `stable` here is frozen on a reply shape no live
  // gate has judged, permanently.
  const built = await buildContract();
  const tool = built.contract.tools.find((entry) => entry.name === "set_fill");
  assert.ok(tool, "set_fill must be registered");
  assert.equal(tool.resultStability, "additive-preview");
  assert.equal(tool.direction, "write");
  assert.equal(tool.scope, "node");
});

test("the two colour schemas are IDENTICAL, because the generator forces two copies", async () => {
  // ⛔ `evaluateToolSchema` evaluates the schema literal with `z` as the only binding, so a
  // shared `const fillColorSchema` cannot be referenced and the colour shape must appear
  // twice — once for a solid paint, once for a gradient stop. Two copies of one shape is
  // how two surfaces start disagreeing, so they are held together by THIS TEST rather than
  // by convention, exactly as `batch-receipt.mjs` and its `code.js` mirror are.
  const built = await buildContract();
  const tool = built.contract.tools.find((entry) => entry.name === "set_fill");
  const paint = tool.inputSchema.properties.paints.anyOf.find(
    (entry) => entry.type === "array",
  ).items;

  const solidColor = paint.properties.color;
  const stopColor = paint.properties.gradientStops.items.properties.color;

  for (const channel of ["r", "g", "b"]) {
    assert.deepEqual(
      solidColor.properties[channel],
      stopColor.properties[channel],
      `the ${channel} channel has drifted between the solid and gradient-stop colour schemas`,
    );
  }
  assert.deepEqual(
    solidColor.required,
    stopColor.required,
    "the two colour schemas disagree about which channels are required",
  );
});

test("PASS_THROUGH is absent from the published blend modes", async () => {
  // ⛔ It is a NODE-level mode for groups, not a paint mode. Advertising it would be F5's
  // `CROP` defect — a schema promising a mode the handler cannot deliver — reintroduced in
  // the same release that exists to repair it.
  const built = await buildContract();
  const tool = built.contract.tools.find((entry) => entry.name === "set_fill");
  const paint = tool.inputSchema.properties.paints.anyOf.find(
    (entry) => entry.type === "array",
  ).items;
  assert.ok(
    !paint.properties.blendMode.enum.includes("PASS_THROUGH"),
    "PASS_THROUGH is not a valid paint blend mode and must not be published as one",
  );
});

test("set_fill is pinned ABSENT from apply_batch's allowlist", async () => {
  // ⛔ The R2.2 pin-the-absence pattern. CC8 holds the allowlist at 15 ops through R2.7,
  // and admitting this tool would put a SECOND paint shape alongside `set_fill_color`'s in
  // one batch surface — the divergence it exists to end, with an extra participant.
  const { EXCLUDED_BATCH_OPERATIONS, V1_BATCH_OPERATIONS } = await import(
    "../src/talk_to_figma_mcp/batch-receipt.mjs"
  );
  assert.ok(
    !V1_BATCH_OPERATIONS.includes("set_fill"),
    "set_fill must not be in the v1 allowlist",
  );
  assert.ok(
    EXCLUDED_BATCH_OPERATIONS.set_fill,
    "the absence must carry a reason, not just be missing",
  );
  assert.equal(V1_BATCH_OPERATIONS.length, 15, "CC8: the allowlist stays at 15 through R2.7");
});

test("the set_fill_color shape divergence is PINNED, since it cannot be fixed", async () => {
  // ⚠️ This test does not assert something good. It pins a known defect that `set_fill_color`
  // being `stable` makes unfixable: its batch operation takes `{color:{r,g,b,a}}` while the
  // standalone tool takes flat `r,g,b,a`. R2.4's live gate caught the contract calling these
  // the same shape. `set_fill` is the repair — one shape everywhere — and this pin is what
  // stops anyone "tidying" the legacy tool into a breaking change.
  const built = await buildContract();
  const legacy = built.contract.tools.find((entry) => entry.name === "set_fill_color");
  assert.equal(legacy.resultStability, "stable", "frozen, therefore unfixable");
  assert.deepEqual(
    Object.keys(legacy.inputSchema.properties).sort(),
    ["a", "b", "g", "nodeId", "r"],
    "the legacy standalone shape is FLAT r,g,b,a — different from its own batch operation, which takes {color:{r,g,b,a}}",
  );
});
