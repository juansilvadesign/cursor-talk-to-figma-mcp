import assert from "node:assert/strict";
import test from "node:test";

import { buildContract } from "../scripts/contract-lib.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

function payloadFor(kind) {
  if (kind === "paint") {
    return {
      paints: [
        { type: "SOLID", color: { r: 0.12, g: 0.34, b: 0.56, a: 0.8 } },
      ],
    };
  }
  if (kind === "text") {
    return {
      text: {
        fontFamily: "Inter",
        fontStyle: "Regular",
        fontSize: 18,
        lineHeight: { value: 24, unit: "PIXELS" },
      },
    };
  }
  if (kind === "effect") {
    return {
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          offset: { x: 0, y: 2 },
          radius: 4,
        },
      ],
    };
  }
  return {
    layoutGrids: [
      {
        pattern: "COLUMNS",
        alignment: "STRETCH",
        gutterSize: 24,
        count: 12,
        sectionSize: 72,
        visible: true,
      },
    ],
  };
}

function updatePayloadFor(kind) {
  if (kind === "paint") {
    return {
      paints: [
        { type: "SOLID", color: { r: 0.82, g: 0.21, b: 0.13, a: 0.7 } },
      ],
    };
  }
  if (kind === "text") return { text: { fontSize: 20 } };
  if (kind === "effect") {
    return {
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.3 },
          offset: { x: 1, y: 4 },
          radius: 8,
        },
      ],
    };
  }
  return {
    layoutGrids: [
      {
        pattern: "COLUMNS",
        alignment: "STRETCH",
        gutterSize: 20,
        count: 12,
        sectionSize: 72,
        visible: true,
      },
    ],
  };
}

async function create(harness, kind, suffix = kind) {
  const identityKey = `r3.2-test-${suffix}`;
  const result = await harness.command("create_or_match_local_style", {
    kind,
    name: `R3.2/${suffix}`,
    identityKey,
    ...payloadFor(kind),
  });
  assert.equal(result.success, true);
  assert.equal(result.action, "created");
  assert.equal(result.outcome, "confirmed");
  assert.equal(result.style.kind, kind);
  assert.equal(result.style.identityStatus, "present");
  // The private marker authorizes future mutation/deletion, but it is not an output field.
  assert.equal(JSON.stringify(result).includes(identityKey), false);
  return { result, identityKey };
}

test("the public contract declares the complete R3.2 surface as additive local-only preview", async () => {
  const { contract } = await buildContract();
  const tools = Object.fromEntries(contract.tools.map((tool) => [tool.name, tool]));
  const expected = {
    get_local_style: ["read", "local_style"],
    create_or_match_local_style: ["write", "document"],
    update_local_style: ["write", "local_style"],
    get_node_style_attachment: ["read", "node"],
    set_local_style_attachment: ["write", "node"],
    delete_local_style: ["write", "local_style"],
  };
  for (const [name, [direction, scope]] of Object.entries(expected)) {
    assert.ok(tools[name], `${name} must be public`);
    assert.equal(tools[name].direction, direction);
    assert.equal(tools[name].scope, scope);
    assert.equal(tools[name].resultStability, "additive-preview");
  }
  assert.deepEqual(tools.delete_local_style.inputSchema.required, [
    "kind",
    "styleId",
    "identityKey",
    "confirm",
  ]);
  assert.equal(tools.delete_local_style.inputSchema.properties.confirm.const, true);
  assert.equal(contract.publicContractVersion, "1.20.0");
  assert.equal(contract.serverSchemaVersion, "1.20.0");
});

test("creates and canonical-reads all four local style classes without exposing identity values", async () => {
  for (const kind of ["paint", "text", "effect", "grid"]) {
    const harness = await loadPluginHarness();
    const { result, identityKey } = await create(harness, kind, `all-${kind}`);

    const read = await harness.command("get_local_style", {
      kind,
      styleId: result.style.styleId,
      includeConsumers: true,
    });
    assert.equal(read.success, true);
    assert.equal(read.style.styleId, result.style.styleId);
    assert.equal(read.style.kind, kind);
    assert.equal(read.style.local, true);
    assert.equal(read.style.remote, false);
    assert.equal(read.style.valueReadable, true);
    assert.equal(read.style.identityStatus, "present");
    assert.deepEqual(read.style.consumers, { status: "observed", count: 0 });
    assert.equal(JSON.stringify(read).includes(identityKey), false);
  }
});

test("each local style class updates one owned value and confirms it through a fresh read", async () => {
  const nativeFieldForKind = {
    paint: "paints",
    text: "fontSize",
    effect: "effects",
    grid: "layoutGrids",
  };

  for (const kind of ["paint", "text", "effect", "grid"]) {
    const harness = await loadPluginHarness();
    const { result, identityKey } = await create(harness, kind, `update-${kind}`);
    const update = await harness.command("update_local_style", {
      kind,
      styleId: result.style.styleId,
      identityKey,
      ...updatePayloadFor(kind),
    });

    assert.equal(update.success, true, `${kind} update must reach the native style`);
    assert.equal(update.outcome, "confirmed", `${kind} update must read back`);
    assert.equal(update.readbackMatchesRequested, true);
    assert.ok(
      harness.styleNativeCalls.setValue.some(
        (call) => call.styleId === result.style.styleId && call.field === nativeFieldForKind[kind],
      ),
      `${kind} must use its native value field`,
    );

    const read = await harness.command("get_local_style", {
      kind,
      styleId: result.style.styleId,
    });
    assert.equal(read.success, true);
    if (kind === "paint") assert.equal(read.style.value.paints[0].color.r, 0.82);
    if (kind === "text") assert.equal(read.style.value.text.fontSize, 20);
    if (kind === "effect") assert.equal(read.style.value.effects[0].radius, 8);
    if (kind === "grid") assert.equal(read.style.value.layoutGrids[0].gutterSize, 20);
  }
});

test("create-or-match resolves only an exact same-kind private identity and never adopts a name", async () => {
  const harness = await loadPluginHarness();
  const { result, identityKey } = await create(harness, "paint", "match");
  const createsBefore = harness.styleNativeCalls.create.length;

  const matched = await harness.command("create_or_match_local_style", {
    kind: "paint",
    name: "R3.2/match",
    identityKey,
    ...payloadFor("paint"),
  });
  assert.equal(matched.success, true);
  assert.equal(matched.action, "matched");
  assert.equal(matched.style.styleId, result.style.styleId);
  assert.equal(harness.styleNativeCalls.create.length, createsBefore);

  const collision = await harness.command("create_or_match_local_style", {
    kind: "paint",
    name: "Brand/Primary",
    identityKey: "different-r3.2-owner",
    ...payloadFor("paint"),
  });
  assert.equal(collision.success, false);
  assert.equal(collision.refusal.code, "local_style_name_collision");
  assert.equal(harness.styleNativeCalls.create.length, createsBefore);

  const mismatch = await harness.command("create_or_match_local_style", {
    kind: "paint",
    name: "R3.2/match",
    identityKey,
    paints: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
  });
  assert.equal(mismatch.success, false);
  assert.equal(mismatch.refusal.code, "identity_value_mismatch");
  assert.equal(harness.styleNativeCalls.create.length, createsBefore);
});

test("remote, unknown, and wrong-kind IDs refuse before any native style mutation", async () => {
  const harness = await loadPluginHarness();
  const node = harness.getNode("10:3");
  const before = node.fillStyleId;
  const beforeCalls = structuredClone(harness.styleNativeCalls);

  const remoteRead = await harness.command("get_local_style", {
    kind: "paint",
    styleId: "style-paint-remote",
  });
  assert.equal(remoteRead.success, false);
  assert.equal(remoteRead.refusal.code, "remote_style_refused");

  const remoteUpdate = await harness.command("update_local_style", {
    kind: "paint",
    styleId: "style-paint-remote",
    identityKey: "not-a-local-owner",
    ...updatePayloadFor("paint"),
  });
  assert.equal(remoteUpdate.success, false);
  assert.equal(remoteUpdate.refusal.code, "remote_style_refused");

  const remoteDelete = await harness.command("delete_local_style", {
    kind: "paint",
    styleId: "style-paint-remote",
    identityKey: "not-a-local-owner",
    confirm: true,
  });
  assert.equal(remoteDelete.success, false);
  assert.equal(remoteDelete.refusal.code, "remote_style_refused");

  const remote = await harness.command("set_local_style_attachment", {
    nodeId: "10:3",
    kind: "paint",
    styleId: "style-paint-remote",
  });
  assert.equal(remote.success, false);
  assert.equal(remote.refusal.code, "remote_style_refused");

  const wrongKind = await harness.command("set_local_style_attachment", {
    nodeId: "10:3",
    kind: "paint",
    styleId: "style-text-1",
  });
  assert.equal(wrongKind.success, false);
  assert.equal(wrongKind.refusal.code, "style_kind_mismatch");

  const unknown = await harness.command("set_local_style_attachment", {
    nodeId: "10:3",
    kind: "paint",
    styleId: "missing-local-style",
  });
  assert.equal(unknown.success, false);
  assert.equal(unknown.refusal.code, "not_exact_local_style");
  assert.equal(node.fillStyleId, before);
  assert.deepEqual(harness.styleNativeCalls, beforeCalls);
});

test("all four attachment kinds use their direct async surface and read back the stored ID", async () => {
  const harness = await loadPluginHarness();
  const paint = await create(harness, "paint", "attach-paint");
  const text = await create(harness, "text", "attach-text");
  const effect = await create(harness, "effect", "attach-effect");
  const grid = await create(harness, "grid", "attach-grid");
  const cases = [
    { nodeId: "10:3", kind: "paint", paintTarget: "stroke", styleId: paint.result.style.styleId },
    { nodeId: "10:2", kind: "text", styleId: text.result.style.styleId },
    { nodeId: "10:1", kind: "effect", styleId: effect.result.style.styleId },
    { nodeId: "10:1", kind: "grid", styleId: grid.result.style.styleId },
  ];

  for (const entry of cases) {
    const set = await harness.command("set_local_style_attachment", entry);
    assert.equal(set.success, true);
    assert.equal(set.outcome, "confirmed");
    assert.equal(set.after.styleId, entry.styleId);
    const read = await harness.command("get_node_style_attachment", entry);
    assert.equal(read.attachment.styleId, entry.styleId);
    assert.equal(read.attachment.origin, "local");
  }
  assert.equal(harness.styleNativeCalls.attach.length, 4);
});

test("a local replacement may clear a remote binding, and a silent write stays unconfirmed", async () => {
  const harness = await loadPluginHarness({ ignoreFillStyleWrites: ["10:3"] });
  const paint = await create(harness, "paint", "discarded-attachment");

  const result = await harness.command("set_local_style_attachment", {
    nodeId: "10:3",
    kind: "paint",
    styleId: paint.result.style.styleId,
  });
  assert.equal(result.previousBinding.origin, "remote");
  assert.equal(result.readbackMatchesRequested, false);
  assert.equal(result.outcome, "unconfirmed");
  assert.equal(harness.getNode("10:3").fillStyleId, "style-paint-remote");
});

test("owned updates are one mutation at a time and read back instead of echoing", async () => {
  const harness = await loadPluginHarness({
    ignoreStyleWrites: ["style-paint-1::paints"],
    stylePluginData: {
      "style-paint-1": {
        "talk-to-figma.local-style-authoring.identity.v1": "r3.2-test-update",
      },
    },
  });
  const paint = {
    result: { style: { styleId: "style-paint-1" } },
    identityKey: "r3.2-test-update",
  };

  const renamed = await harness.command("update_local_style", {
    kind: "paint",
    styleId: paint.result.style.styleId,
    identityKey: paint.identityKey,
    name: "R3.2/update-renamed",
  });
  assert.equal(renamed.success, true);
  assert.equal(renamed.outcome, "confirmed");
  assert.equal(renamed.style.name, "R3.2/update-renamed");

  const discarded = await harness.command("update_local_style", {
    kind: "paint",
    styleId: paint.result.style.styleId,
    identityKey: paint.identityKey,
    paints: [{ type: "SOLID", color: { r: 0.9, g: 0.1, b: 0.2 } }],
  });
  assert.equal(discarded.success, true);
  assert.equal(discarded.readbackMatchesRequested, false);
  assert.equal(discarded.outcome, "unconfirmed");

  await assert.rejects(
    () =>
      harness.command("update_local_style", {
        kind: "paint",
        styleId: paint.result.style.styleId,
        identityKey: paint.identityKey,
        name: "R3.2/not-atomic",
        ...payloadFor("paint"),
      }),
    /requires exactly one of name or the kind-specific value payload/,
  );
});

test("deletion requires exact ownership, zero observed consumers, confirmation, and independent absence", async () => {
  const harness = await loadPluginHarness();
  const paint = await create(harness, "paint", "cleanup");
  const id = paint.result.style.styleId;

  const noConfirm = await harness.command("delete_local_style", {
    kind: "paint",
    styleId: id,
    identityKey: paint.identityKey,
  });
  assert.equal(noConfirm.success, false);
  assert.equal(noConfirm.refusal.code, "confirmation_required");
  assert.deepEqual(harness.styleNativeCalls.remove, []);

  const wrongOwner = await harness.command("delete_local_style", {
    kind: "paint",
    styleId: id,
    identityKey: "not-the-owner",
    confirm: true,
  });
  assert.equal(wrongOwner.success, false);
  assert.equal(wrongOwner.refusal.code, "identity_mismatch");
  assert.deepEqual(harness.styleNativeCalls.remove, []);

  await harness.command("set_local_style_attachment", {
    nodeId: "10:3",
    kind: "paint",
    styleId: id,
  });
  const withConsumer = await harness.command("delete_local_style", {
    kind: "paint",
    styleId: id,
    identityKey: paint.identityKey,
    confirm: true,
  });
  assert.equal(withConsumer.success, false);
  assert.equal(withConsumer.refusal.code, "style_has_consumers");
  assert.deepEqual(harness.styleNativeCalls.remove, []);

  await harness.command("set_local_style_attachment", {
    nodeId: "10:3",
    kind: "paint",
    styleId: null,
  });
  const deleted = await harness.command("delete_local_style", {
    kind: "paint",
    styleId: id,
    identityKey: paint.identityKey,
    confirm: true,
  });
  assert.equal(deleted.success, true);
  assert.equal(deleted.removal, "removed");
  assert.equal(harness.getStyle(id), null);
});

test("a remove call without a fresh-inventory absence is removal_unconfirmed", async () => {
  const harness = await loadPluginHarness({
    ignoreStyleRemovals: ["style-paint-900-1"],
  });
  const paint = await create(harness, "paint", "stale-remove");
  const result = await harness.command("delete_local_style", {
    kind: "paint",
    styleId: paint.result.style.styleId,
    identityKey: paint.identityKey,
    confirm: true,
  });
  assert.equal(result.success, false);
  assert.equal(result.removal, "removal_unconfirmed");
  assert.equal(harness.getStyle(paint.result.style.styleId) !== null, true);
});
