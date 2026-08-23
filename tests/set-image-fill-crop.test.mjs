/**
 * R2.7 Phase 2 — `set_image_fill`'s CROP repair.
 *
 * ⛔ **THE DEFECT THESE TESTS PIN WAS MEASURED, NOT REASONED.** Live on 2026-08-23 (scratch
 * page `R2.7 P2 CROP probe`), writing `scaleMode: "CROP"` with no `imageTransform` was
 * ACCEPTED by Figma and stored with the identity matrix `[[1,0,0],[0,1,0]]`, which
 * `JSON_REST_V1` reports as `scaleMode: "STRETCH"`. An identity transform maps the whole
 * image onto the whole node box, so the render is a **stretch**: a 200×100 probe squashed
 * into a 100×100 node kept BOTH its edge markers, where a real `FILL` centre-crop dropped
 * both. The old receipt echoed the requested `"CROP"`, so the caller was told *crop* and
 * shown a *distortion*.
 *
 * ⚠️ **WHAT THESE OFFLINE TESTS DELIBERATELY DO NOT CLAIM.** The measurement above came
 * through the REST export. What the PLUGIN node reports for `scaleMode` after a CROP write
 * is **unmeasured** — `CROP` and `STRETCH` are two id spaces for one stored state, and
 * assuming which one the plugin answers is precisely the fiction that
 * [[feedback_a_fake_export_from_enumerable_props_invents_fields]] cost this fork a release
 * ago. So the harness models the VALIDATOR, which is entirely this fork's code, and the live
 * gate measures the PLATFORM. ⛔ Do not add an offline assertion about the coerced mode name.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const TARGET = "10:3"; // RECTANGLE, a FILL_CARRIER seeded with an IMAGE paint at FILL
const GROUP = "40:1"; // GROUP, carries no fills at all
const MIXED_TEXT = "20:2"; // TEXT, driven to per-character fills via the mixedFills option
const PNG = Buffer.from("iVBORw0KGgo=", "base64").toString("base64");
const VALID = [
  [0.5, 0, 0.25],
  [0, 0.5, 0.25],
];

test("CROP without imageTransform is REFUSED, and nothing is written", async () => {
  const harness = await loadPluginHarness();
  const before = JSON.stringify(harness.getNode(TARGET).fills);

  await assert.rejects(
    () =>
      harness.command("set_image_fill", {
        nodeId: TARGET,
        imageBase64: PNG,
        scaleMode: "CROP",
      }),
    /scaleMode CROP requires imageTransform/,
  );

  // ⭐ The refusal names the consequence, not just the missing field — a caller who reads
  // only the message still learns that a bare CROP renders a stretch.
  await assert.rejects(
    () =>
      harness.command("set_image_fill", {
        nodeId: TARGET,
        imageBase64: PNG,
        scaleMode: "CROP",
      }),
    /renders a STRETCH, not a crop/,
  );

  assert.equal(
    JSON.stringify(harness.getNode(TARGET).fills),
    before,
    "a refused CROP must leave the node's fills byte-identical",
  );
});

test("imageTransform with any non-CROP mode is REFUSED rather than silently discarded", async () => {
  // Figma reads `imageTransform` for CROP alone. Accepting the pair would discard one, and
  // a discarded value reads as an applied one — the same rule `create_text` enforces on
  // fontWeight × fontFamily and `set_fill` on color.a × opacity.
  for (const scaleMode of ["FILL", "FIT", "TILE"]) {
    const harness = await loadPluginHarness();
    const before = JSON.stringify(harness.getNode(TARGET).fills);

    await assert.rejects(
      () =>
        harness.command("set_image_fill", {
          nodeId: TARGET,
          imageBase64: PNG,
          scaleMode,
          imageTransform: VALID,
        }),
      /imageTransform only applies to scaleMode CROP/,
      `${scaleMode} must refuse a transform`,
    );
    assert.equal(JSON.stringify(harness.getNode(TARGET).fills), before);
  }
});

test("CROP with a valid transform writes it, and the receipt reports the transform off the node", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_image_fill", {
    nodeId: TARGET,
    imageBase64: PNG,
    scaleMode: "CROP",
    imageTransform: VALID,
  });

  assert.deepEqual(result.imageTransform, VALID);
  assert.equal(result.imageTransformSource, "caller");

  // ⭐ The reading is taken from the node, so the stored paint must agree with the receipt.
  // This is the assertion that would fail if the receipt went back to echoing the request.
  const stored = harness.getNode(TARGET).fills[0];
  assert.equal(stored.type, "IMAGE");
  assert.deepEqual(stored.imageTransform, VALID);
});

test("the transform in the receipt is a READ-BACK, not an echo", async () => {
  // ⛔ Without this instrument the two are indistinguishable offline: the harness stores what
  // it is handed, so an echoing receipt and an honest read-back print the same matrix. A
  // setter that accepts and DISCARDS the write makes the echo observably wrong without
  // assuming any platform normalization — set_opacity's instrument, on a different field.
  const harness = await loadPluginHarness({ ignoreFillWrites: [TARGET] });
  const result = await harness.command("set_image_fill", {
    nodeId: TARGET,
    imageBase64: PNG,
    scaleMode: "CROP",
    imageTransform: VALID,
  });

  assert.equal(
    result.imageTransform,
    null,
    "the receipt must report the transform still on the node, not the one requested",
  );
  // ⚠️ `imageTransformSource` stays "caller" here on purpose: it records what the CALLER
  // supplied, which is a fact about the request and remains true even when the platform
  // discarded it. Conflating it with the read-back would make one field answer two questions.
  assert.equal(result.imageTransformSource, "caller");

  // ⭐ THE MODE IS A READ-BACK TOO, and this is the assertion that proves it. The fixture
  // seeds 10:3 with an IMAGE paint at scaleMode FILL, so a discarded CROP write leaves FILL
  // on the node: a read-back says "FILL", an echo says "CROP". Without this line a receipt
  // that echoed the requested mode passed the whole suite — it was a surviving mutant.
  assert.equal(
    result.scaleMode,
    "FILL",
    "the receipt must report the mode still on the node, not the one requested",
  );
  assert.equal(result.scaleModeReadable, true);
});

test("an UNREADABLE fill reports scaleMode null, never the requested mode", async () => {
  // ⛔ The branch two surviving mutants pointed at. A TEXT node with per-character fills
  // answers `figma.mixed`, which is not an array, so there is no paint to read back. Combined
  // with a discarding setter that state survives the write — and the receipt must then say
  // "I could not read this" rather than reprinting the caller's argument as though it had.
  // ⭐ Both readings are wrong in the SAME direction if the fallback returns, which is why
  // `scaleModeReadable` is asserted alongside the value and not instead of it.
  const harness = await loadPluginHarness({
    mixedFills: [MIXED_TEXT],
    ignoreFillWrites: [MIXED_TEXT],
  });
  const result = await harness.command("set_image_fill", {
    nodeId: MIXED_TEXT,
    imageBase64: PNG,
    scaleMode: "CROP",
    imageTransform: VALID,
  });

  assert.equal(result.scaleModeReadable, false);
  assert.equal(
    result.scaleMode,
    null,
    "an unreadable node must not have the request echoed back into its receipt",
  );
  assert.equal(result.imageTransform, null);
  // The request is still reported for what it is — what the CALLER supplied — so the two
  // questions ("what did you ask for" / "what is on the node") keep separate fields.
  assert.equal(result.imageTransformSource, "caller");
});

test("a non-CROP mode carries NO transform, and says so rather than omitting the field", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_image_fill", {
    nodeId: TARGET,
    imageBase64: PNG,
    scaleMode: "FILL",
  });

  assert.equal(result.imageTransform, null, "null is a reading; undefined is a silence");
  assert.equal(result.imageTransformSource, "none");
  assert.ok(
    !Object.hasOwn(harness.getNode(TARGET).fills[0], "imageTransform"),
    "a FILL paint must not carry a transform Figma would ignore",
  );
});

test("a malformed transform is refused BEFORE the image is created", async () => {
  const malformed = [
    [[[1, 0, 0]], /must be an array of 2 rows/],
    [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], /must be an array of 2 rows/],
    [[[1, 0], [0, 1]], /imageTransform\[0\] must be an array of 3 numbers/],
    [[[1, 0, 0], [0, 1]], /imageTransform\[1\] must be an array of 3 numbers/],
    [[[1, 0, "0"], [0, 1, 0]], /imageTransform\[0\]\[2\] must be a finite number/],
    [[[1, 0, 0], [0, Infinity, 0]], /imageTransform\[1\]\[1\] must be a finite number/],
    [["nope", [0, 1, 0]], /imageTransform\[0\] must be an array of 3 numbers/],
  ];

  for (const [imageTransform, pattern] of malformed) {
    const harness = await loadPluginHarness();
    const before = JSON.stringify(harness.getNode(TARGET).fills);
    await assert.rejects(
      () =>
        harness.command("set_image_fill", {
          nodeId: TARGET,
          imageBase64: PNG,
          scaleMode: "CROP",
          imageTransform,
        }),
      pattern,
      `${JSON.stringify(imageTransform)} must be refused`,
    );
    assert.equal(
      JSON.stringify(harness.getNode(TARGET).fills),
      before,
      "validate-all-then-write: a bad matrix must not leave a half-applied fill",
    );
  }
});

test("the transform is validated before the node is even resolved", async () => {
  // ⭐ Ordering matters on a create-adjacent tool: `figma.createImage` interns bytes into the
  // file, so a late refusal would leave an orphaned image behind. A bad matrix against a
  // NONEXISTENT node must report the matrix, never "node not found" — that is the only
  // observable that distinguishes validate-first from resolve-first.
  const harness = await loadPluginHarness();
  await assert.rejects(
    () =>
      harness.command("set_image_fill", {
        nodeId: "does-not-exist",
        imageBase64: PNG,
        scaleMode: "CROP",
      }),
    /scaleMode CROP requires imageTransform/,
  );
});

test("a node without fills is still refused, and the transform rule does not mask it", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () =>
      harness.command("set_image_fill", {
        nodeId: GROUP,
        imageBase64: PNG,
        scaleMode: "CROP",
        imageTransform: VALID,
      }),
    /does not support fills/,
  );
});
