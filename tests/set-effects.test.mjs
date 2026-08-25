/**
 * R2.7 item 1.2 — `set_effects`.
 *
 * The important contract is not merely that an effect can be assigned. Every effect is
 * validated before one array assignment, so a member that cannot be expressed refuses the
 * entire call; and the result reads the document back, rather than echoing the request.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildContract } from "../scripts/contract-lib.mjs";
import {
  EXCLUDED_BATCH_OPERATIONS,
  V1_BATCH_OPERATIONS,
} from "../src/talk_to_figma_mcp/batch-receipt.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECTANGLE = "10:3";
const STYLED_FRAME = "10:1";
const ROOT = "0:0";
const EFFECT_STYLE_ID = "style-effect-1";

const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1, a: 0.4 };
const DROP = {
  type: "DROP_SHADOW",
  color: RED,
  offset: { x: 3, y: 4 },
  radius: 8,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function seed(harness, nodeId = RECTANGLE) {
  await harness.command("set_effects", {
    nodeId,
    effects: [clone(DROP)],
  });
}

async function refusesAndPreserves(harness, args, pattern, nodeId = RECTANGLE) {
  const before = clone(harness.getNode(nodeId).effects);
  await assert.rejects(() => harness.command("set_effects", args), pattern);
  assert.deepEqual(
    harness.getNode(nodeId).effects,
    before,
    "a refusal must leave the entire effects array untouched",
  );
}

test("writes all four supported effect types and reads the stored array back", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("set_effects", {
    nodeId: RECTANGLE,
    effects: [
      clone(DROP),
      {
        type: "INNER_SHADOW",
        color: BLUE,
        offset: { x: -2, y: 1 },
        radius: 6,
        spread: -3,
        visible: false,
        blendMode: "SCREEN",
      },
      { type: "LAYER_BLUR", radius: 12, visible: true },
      { type: "BACKGROUND_BLUR", radius: 20, visible: false },
    ],
  });

  assert.equal(result.effectCount, 4);
  assert.equal(result.requestedCount, 4);
  assert.equal(result.cleared, false);
  assert.deepEqual(result.previous, []);
  assert.equal(result.previousReadable, true);
  assert.deepEqual(result.effects, [
    // DROP is the one member here that omits visible/blendMode, so it is the one that
    // carries the platform-required defaults. The other three supply their own and must
    // come back exactly as sent.
    { ...DROP, color: { ...RED, a: 1 }, visible: true, blendMode: "NORMAL" },
    {
      type: "INNER_SHADOW",
      color: BLUE,
      offset: { x: -2, y: 1 },
      radius: 6,
      spread: -3,
      visible: false,
      blendMode: "SCREEN",
    },
    { type: "LAYER_BLUR", radius: 12, visible: true },
    { type: "BACKGROUND_BLUR", radius: 20, visible: false },
  ]);
  assert.deepEqual(
    harness.getNode(RECTANGLE).effects,
    result.effects,
    "the receipt must report the value Figma holds, not a private echo",
  );
});

test("null clears every effect while preserving a readable previous array", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  const result = await harness.command("set_effects", {
    nodeId: RECTANGLE,
    effects: null,
  });

  assert.deepEqual(result.previous, [
    { ...DROP, color: { ...RED, a: 1 }, visible: true, blendMode: "NORMAL" },
  ]);
  assert.equal(result.previousReadable, true);
  assert.deepEqual(result.effects, []);
  assert.equal(result.effectCount, 0);
  assert.equal(result.requestedCount, 0);
  assert.equal(result.cleared, true);
  assert.deepEqual(harness.getNode(RECTANGLE).effects, []);
});

test("empty, absent, and over-limit arrays are refused without changing the node", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  await refusesAndPreserves(
    harness,
    { nodeId: RECTANGLE },
    /requires effects: an array of 1-16 effects, or null/,
  );
  await refusesAndPreserves(
    harness,
    { nodeId: RECTANGLE, effects: [] },
    /empty effects array.*Pass null/i,
  );
  await refusesAndPreserves(
    harness,
    {
      nodeId: RECTANGLE,
      effects: Array.from({ length: 17 }, () => clone(DROP)),
    },
    /above this fork's ceiling of 16/,
  );
});

test("per-type ownership refuses cross-type, missing, and unknown fields by name", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  await refusesAndPreserves(
    harness,
    {
      nodeId: RECTANGLE,
      effects: [{ type: "LAYER_BLUR", radius: 6, color: RED }],
    },
    /color is not valid for LAYER_BLUR/,
  );
  await refusesAndPreserves(
    harness,
    {
      nodeId: RECTANGLE,
      effects: [
        {
          type: "INNER_SHADOW",
          color: RED,
          offset: { x: 0, y: 1 },
          radius: 3,
          showShadowBehindNode: true,
        },
      ],
    },
    /showShadowBehindNode is not valid for INNER_SHADOW/,
  );
  await refusesAndPreserves(
    harness,
    { nodeId: RECTANGLE, effects: [{ type: "DROP_SHADOW", color: RED, radius: 3 }] },
    /DROP_SHADOW requires offset/,
  );
  await refusesAndPreserves(
    harness,
    { nodeId: RECTANGLE, effects: [{ type: "LAYER_BLUR", radius: 3, surprise: true }] },
    /surprise is not valid for LAYER_BLUR/,
  );
});

test("a bad final effect proves validation completes before the one write", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  await refusesAndPreserves(
    harness,
    {
      nodeId: RECTANGLE,
      effects: [
        { type: "LAYER_BLUR", radius: 8 },
        { type: "BACKGROUND_BLUR", radius: -1 },
      ],
    },
    /effects\[1\]: radius must be a finite number greater than or equal to 0/,
  );
});

test("numeric and mode validation never coerces or invents bounds", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  await refusesAndPreserves(
    harness,
    {
      nodeId: RECTANGLE,
      effects: [{ ...clone(DROP), color: { r: 2, g: 0, b: 0 } }],
    },
    /color\.r must be between 0 and 1/,
  );
  await refusesAndPreserves(
    harness,
    {
      nodeId: RECTANGLE,
      effects: [{ ...clone(DROP), offset: { x: Infinity, y: 0 } }],
    },
    /offset\.x and offset\.y must be finite numbers/,
  );
  await refusesAndPreserves(
    harness,
    {
      nodeId: RECTANGLE,
      effects: [{ ...clone(DROP), spread: Infinity }],
    },
    /spread must be a finite number/,
  );
  await refusesAndPreserves(
    harness,
    {
      nodeId: RECTANGLE,
      effects: [{ ...clone(DROP), blendMode: "PASS_THROUGH" }],
    },
    /blendMode must be one of/,
  );
});

test("unsupported effect variants are deliberately absent, not silently accepted", async () => {
  const harness = await loadPluginHarness();
  await seed(harness);

  for (const type of ["NOISE", "TEXTURE"]) {
    await refusesAndPreserves(
      harness,
      { nodeId: RECTANGLE, effects: [{ type, radius: 3 }] },
      /type must be one of DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR/,
    );
  }
});

test("a node with no BlendMixin effects surface is refused before any write", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("set_effects", { nodeId: ROOT, effects: [clone(DROP)] }),
    /DOCUMENT and does not support effects/,
  );
  assert.equal("effects" in harness.getNode(ROOT), false);
});

test("the receipt catches a node that accepts and discards an effects write", async () => {
  // This is an instrument, not a claim that Figma does this. It is the only way to make a
  // read-back distinguishable from an echo while the platform stores inputs verbatim.
  const harness = await loadPluginHarness({ ignoreEffectWrites: [RECTANGLE] });
  const result = await harness.command("set_effects", {
    nodeId: RECTANGLE,
    effects: [{ type: "LAYER_BLUR", radius: 9 }],
  });

  assert.deepEqual(result.effects, []);
  assert.equal(result.effectCount, 0);
  assert.equal(result.requestedCount, 1);
});

test("effect-style detachment is reported as a reading in both possible worlds", async () => {
  const preserved = await loadPluginHarness();
  const unchanged = await preserved.command("set_effects", {
    nodeId: STYLED_FRAME,
    effects: [{ type: "LAYER_BLUR", radius: 9 }],
  });
  assert.equal(unchanged.styleIdBefore, EFFECT_STYLE_ID);
  assert.equal(unchanged.styleIdAfter, EFFECT_STYLE_ID);
  assert.equal(unchanged.styleReadable, true);
  assert.equal(unchanged.styleDetached, false);

  const detaching = await loadPluginHarness({
    detachStyleOnEffectWrite: [STYLED_FRAME],
  });
  const detached = await detaching.command("set_effects", {
    nodeId: STYLED_FRAME,
    effects: [{ type: "LAYER_BLUR", radius: 9 }],
  });
  assert.equal(detached.styleIdBefore, EFFECT_STYLE_ID);
  assert.equal(detached.styleIdAfter, null);
  assert.equal(detached.styleDetached, true);
  assert.equal(detaching.getNode(STYLED_FRAME).effectStyleId, "");
});

test("the repaired read filter exposes effects, style, clipping, and render-bounds readings", async () => {
  const harness = await loadPluginHarness({
    clipRenderBounds: [STYLED_FRAME],
    includeAbsoluteRenderBoundsInExport: [STYLED_FRAME],
  });
  await harness.command("set_effects", {
    nodeId: STYLED_FRAME,
    effects: [{ type: "LAYER_BLUR", radius: 11 }],
  });
  const read = await harness.command("get_node_info", { nodeId: STYLED_FRAME });

  // A blur carries the platform-required `visible` and no blendMode.
  assert.deepEqual(read.effects, [{ type: "LAYER_BLUR", radius: 11, visible: true }]);
  assert.equal(read.effectStyleId, EFFECT_STYLE_ID);
  assert.equal(read.clipsContent, true);
  assert.deepEqual(read.absoluteRenderBounds, {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
});

// 🔴 These two exist because the live gate on channel `jnpnc1hg` failed on a field this
// suite reported green. The export models REST, and REST has no `effectStyleId`; the
// reading has to come from the plugin node. Pin BOTH halves — that the fake export does
// not invent the field, and that the read still returns it — or the next harness change
// can quietly restore the fiction and the only instrument left is a live channel.
test("the JSON_REST_V1 export does not carry effectStyleId, so the read must source it from the plugin node", async () => {
  const harness = await loadPluginHarness();
  const exported = await harness
    .getNode(STYLED_FRAME)
    .exportAsync({ format: "JSON_REST_V1" });

  assert.equal(
    Object.hasOwn(exported.document, "effectStyleId"),
    false,
    "the fake export must not invent a field the real JSON_REST_V1 never returns",
  );
  assert.deepEqual(
    exported.document.styles,
    { effect: `REST-KEY:${EFFECT_STYLE_ID}` },
    "REST carries a bound effect style under `styles`, in its own id space",
  );

  const read = await harness.command("get_node_info", { nodeId: STYLED_FRAME });
  assert.equal(read.effectStyleId, EFFECT_STYLE_ID);
  assert.notEqual(
    read.effectStyleId,
    exported.document.styles.effect,
    "the published reading is the plugin id, the one set_effects' receipt reports",
  );
});

test("an unbound carrier reports effectStyleId as \"\" rather than omitting the observation", async () => {
  const harness = await loadPluginHarness();
  const read = await harness.command("get_node_info", { nodeId: RECTANGLE });

  assert.equal(Object.hasOwn(read, "effectStyleId"), true);
  assert.equal(read.effectStyleId, "");
  assert.equal(
    Object.hasOwn(read, "styles"),
    false,
    "REST omits `styles` when nothing is bound, and nothing invents it",
  );
});

test("both filter copies explicitly preserve the four R2.7 read fields", async () => {
  const [server, plugin] = await Promise.all([
    readFile(path.join(root, "src/talk_to_figma_mcp/server.ts"), "utf8"),
    readFile(path.join(root, "src/cursor_mcp_plugin/code.js"), "utf8"),
  ]);
  for (const [label, source] of [
    ["server", server],
    ["plugin", plugin],
  ]) {
    const start = source.indexOf("function filterFigmaNode");
    const end = source.indexOf("// Nodes Info Tool", start) > 0
      ? source.indexOf("// Nodes Info Tool", start)
      : source.indexOf("async function getNodeInfo", start);
    const filter = source.slice(start, end);
    for (const field of [
      "effects",
      "effectStyleId",
      "clipsContent",
      "absoluteRenderBounds",
    ]) {
      assert.match(filter, new RegExp(`filtered\\.${field}`), `${label} filter lost ${field}`);
    }
  }
});

test("the public contract pins the supported types, stable status, scope, and batch absence", async () => {
  const built = await buildContract();
  const tool = built.contract.tools.find((entry) => entry.name === "set_effects");
  assert.ok(tool, "set_effects must be registered");
  assert.equal(tool.resultStability, "stable");
  assert.equal(tool.direction, "write");
  assert.equal(tool.scope, "node");
  assert.equal(tool.progress.pluginUpdates, "none");

  const effectsSchema = tool.inputSchema.properties.effects;
  const arraySchema = effectsSchema.anyOf.find((entry) => entry.type === "array");
  assert.ok(arraySchema, "effects must remain an array-or-null input");
  assert.equal(arraySchema.minItems, 1);
  assert.equal(arraySchema.maxItems, 16);
  assert.deepEqual(arraySchema.items.properties.type.enum, [
    "DROP_SHADOW",
    "INNER_SHADOW",
    "LAYER_BLUR",
    "BACKGROUND_BLUR",
  ]);
  assert.equal(
    arraySchema.items.additionalProperties,
    true,
    "unknown fields must reach the handler, which owns their named refusal",
  );
  assert.ok(!arraySchema.items.properties.type.enum.includes("NOISE"));
  assert.ok(!arraySchema.items.properties.type.enum.includes("TEXTURE"));

  assert.ok(!V1_BATCH_OPERATIONS.includes("set_effects"));
  assert.ok(EXCLUDED_BATCH_OPERATIONS.set_effects);
  assert.equal(V1_BATCH_OPERATIONS.length, 15, "CC8 keeps the allowlist at 15 through R2.7");
});

// ⭐ The three fields, not the number, are what this asserts. A release that grows the
// contract must bump `serverSchemaVersion` — it is inside `capabilityFingerprint`, and it
// is the ONLY mechanism by which a contract change becomes visible to a consumer pinning
// the fingerprint. Bumping `publicContractVersion` alone would leave the fingerprint
// byte-identical across a five-tool release. 1.14.0 → 1.15.0 at R3-A Phase 2's remaining
// table (collections, mode rename, metadata, both bindings).
//
// ⭐ 1.15.0 → 1.16.0 at the R3-A Phase 2 PROMOTION (2026-08-25), and that bump is the whole
// point of this test. Promoting those five from `additive-preview` to `stable` adds no
// tool, no command and no field — `capabilityFingerprint` covers the command set plus
// `serverSchemaVersion` and deliberately NOT stability levels, so without this bump the
// promotion would have shipped behind a byte-identical fingerprint. A strengthened
// stability level is an additive contract change; additive changes bump the schema, and
// that is the only mechanism that makes this one visible to a pinning consumer.
// ⭐ 1.16.0 → 1.17.0 on 2026-08-25, by the SAME rule this comment states: promoting
// `get_variable_capabilities` `additive-preview` → `stable` (the last R3-A tool at the
// weaker level) added no tool, command or field, so the fingerprint would have held
// byte-identical without the bump. The three-fields-together invariant is what this test
// guards; the version is only its pin. ⭐ 1.17.0 → 1.18.0 adds the generic,
// additive-preview `delete_variable_collection` capability, then 1.18.0 → 1.19.0 adds
// R3.1's three additive measurement enablers. A new command already moves the fingerprint,
// but the three public version fields still move together so a consumer can pin the release
// coherently.
test("the R3.1 measurement enablers keep all three 1.19.0 version fields together", async () => {
  const release = JSON.parse(
    await readFile(path.join(root, "runtime/release.json"), "utf8"),
  );
  assert.equal(release.publicContractVersion, "1.19.0");
  assert.equal(release.serverSchemaVersion, "1.19.0");
  assert.equal(release.pluginApiVersion, "1.19.0");
});

/**
 * ⛔ Figma's effect union is STRICTER than this fork's schema, and the gap shipped `stable`.
 *
 * Measured live on 2026-08-23 (channel `w113vf7y`) while running the R2 acceptance fixture:
 * a DROP_SHADOW that omitted `visible` and `blendMode` — both `.optional()` in this tool's
 * own schema — was refused by the platform with "Required value missing" on each. The
 * live-effects gate never saw it, because its one successful shadow supplies both fields and
 * its field-omission probe is refused earlier by this handler and never reaches Figma.
 *
 * ⭐ So a green gate was evidence about its inputs, not about the tool: the only shapes the
 * gate ever sent were the shapes that happened to work.
 */
test("the two platform-required effect fields are filled when the caller omits them", async () => {
  const harness = await loadPluginHarness();

  await harness.command("set_effects", {
    nodeId: RECTANGLE,
    effects: [clone(DROP)],
  });
  const [shadow] = harness.getNode(RECTANGLE).effects;
  assert.equal(shadow.visible, true, "an omitted visible must be filled, not left undefined");
  assert.equal(shadow.blendMode, "NORMAL", "an omitted blendMode must be filled for a shadow");

  // A blur has no blendMode in Figma's union at all — filling one would be refused as an
  // unrecognized key, so the default must NOT be shared across effect types.
  await harness.command("set_effects", {
    nodeId: RECTANGLE,
    effects: [{ type: "LAYER_BLUR", radius: 6 }],
  });
  const [blur] = harness.getNode(RECTANGLE).effects;
  assert.equal(blur.visible, true, "a blur still requires visible");
  assert.ok(
    !Object.hasOwn(blur, "blendMode"),
    "a blur must never be given a blendMode — the platform refuses the key",
  );
});

test("a supplied effect field always beats its default", async () => {
  const harness = await loadPluginHarness();

  // `visible: false` is the value a default would silently eat, and eating it would turn a
  // requested hidden shadow into a drawn one — a discarded write reading as an applied one.
  await harness.command("set_effects", {
    nodeId: RECTANGLE,
    effects: [{ ...clone(DROP), visible: false, blendMode: "MULTIPLY" }],
  });
  const [shadow] = harness.getNode(RECTANGLE).effects;
  assert.equal(shadow.visible, false);
  assert.equal(shadow.blendMode, "MULTIPLY");
});

test("every effect default is a field its own type actually allows", async () => {
  const source = await readFile(
    path.join(root, "src/cursor_mcp_plugin/code.js"),
    "utf8",
  );
  const table = source.slice(
    source.indexOf("const EFFECT_FIELD_RULES"),
    source.indexOf("function cloneEffects"),
  );
  assert.ok(table.length > 0, "the effect rules table was not found");

  // The table is the ownership rule, so the invariant is asserted against the table itself:
  // a default outside `allowed` would write a key the platform refuses for that type.
  for (const type of ["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"]) {
    const entry = table.slice(table.indexOf(`${type}: Object.freeze({`));
    const allowed = entry.slice(entry.indexOf("allowed:"), entry.indexOf("defaults:"));
    const defaults = entry.slice(entry.indexOf("defaults:"), entry.indexOf("}),", entry.indexOf("defaults:")));
    assert.match(defaults, /visible: true/, `${type} must default visible`);
    for (const field of [...defaults.matchAll(/(\w+):\s/g)].map((match) => match[1])) {
      if (field === "defaults") continue;
      assert.ok(
        allowed.includes(`"${field}"`),
        `${type} defaults ${field}, which is not in its allowed list`,
      );
    }
  }
  assert.ok(
    !table.slice(table.indexOf("LAYER_BLUR")).match(/defaults: Object\.freeze\(\{[^}]*blendMode/),
    "a blur must not default a blendMode",
  );
});
