#!/usr/bin/env node

// G1 is a pending live instrument. Codex may check syntax and refusal arguments
// offline; only the verifier runs it on an owner-confirmed disposable Figma file.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseGateOptions, requireDisposableTarget } from "./r3.1-live-gate-lib.mjs";
import { runR33Gate } from "./r3.3-live-gate-lib.mjs";
import { classifyR331SvgExportVerdict } from "./r3.3.1-live-gate-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseGateOptions();
requireDisposableTarget(options,
  "Usage: node scripts/live-r3.3-component-authoring-gate.mjs --channel=<DEV-plugin-channel> --disposable-target=true --remote-instance-id=<instance-of-variant-from-published-component-set> [--output-dir=<dir>] [--server=<dist-server-path>]",
  "G1 creates and deletes components, variants, instances, and a scratch page.");
if (options["allow-permanent"] !== undefined) {
  process.stderr.write("Refusing to run: R3.3 has no permanent-residue mode.\n");
  process.exit(2);
}
if (!options["remote-instance-id"]) {
  process.stderr.write("Refusing to run: G1 requires --remote-instance-id for an instance of a variant from a published component set.\n");
  process.exit(2);
}

const expectedRuntime = {
  serverBuildId: "r3.3.1-server-9c8cb843a656",
  pluginBuildId: "r3.3.1-plugin-41fd0e925b27",
  schemaVersion: "1.23.0",
  fingerprint: "sha256:541d14db086baaf326b751b2d2ebbbdd3dcacd81a68e5674584fcc19d204b2a1",
  release: "R3.3.1",
  toolCount: 103,
};

function findNamed(node, name) {
  if (!node || typeof node !== "object") return null;
  if (node.name === name) return node;
  for (const child of node.children || []) {
    const found = findNamed(child, name);
    if (found) return found;
  }
  return null;
}

function findType(node, type) {
  if (!node || typeof node !== "object") return null;
  if (node.type === type) return node;
  for (const child of node.children || []) {
    const found = findType(child, type);
    if (found) return found;
  }
  return null;
}

async function scopedComponents(call, pageId) {
  const inventory = await call("get_local_components", {
    summary: false, pages: [pageId], limit: 500,
  });
  assert.equal(inventory.complete, true, "scratch-page component inventory is incomplete");
  assert.equal(inventory.pagination?.hasMore, false,
    "scratch-page component inventory is truncated");
  return inventory.components;
}

async function pngRenderBounds(call, nodeId, stamp, witness) {
  const { preflight } = await call("export_node_as_image", {
    nodeId, format: "PNG",
    filePath: path.join(os.tmpdir(), `r33-g1-${stamp}-${witness}.png`),
  });
  assert.equal(preflight?.boundsSource, "absoluteRenderBounds");
  assert.ok(Number.isFinite(preflight.boundsWidth),
    `PNG ${witness} render width is unreadable`);
  return preflight.boundsWidth;
}

const requiredCommands = [
  "get_component", "get_local_components", "get_node_info",
  "create_or_match_component", "create_component_from_node",
  "create_or_match_instance", "delete_component", "combine_as_variants",
  "add_component_property", "edit_component_property", "delete_component_property",
  "bind_component_property", "set_instance_properties", "swap_instance_component",
  "reset_instance_overrides", "detach_instance",
];

let remoteInstance;
let remoteMainId;
let remoteVariantKey;

await runR33Gate({
  root, options, expectedRuntime, name: "R3.3 G1 component authoring",
  requiredCommands,
  preflight: async ({ call, record }) => {
    remoteInstance = await call("get_component", {
      nodeId: options["remote-instance-id"],
    });
    assert.equal(remoteInstance.success, true);
    assert.equal(remoteInstance.component.type, "INSTANCE");
    assert.ok(remoteInstance.component.mainComponent,
      "The remote control has no readable main component");
    assert.equal(remoteInstance.component.mainComponent.remote, true,
      "The remote control must be an instance of a published library component");
    assert.ok(remoteInstance.component.mainComponent.componentSetId,
      "The remote control must be an instance of a variant from a published component set");
    remoteMainId = remoteInstance.component.mainComponent.id;
    remoteVariantKey = Object.entries(remoteInstance.component.componentProperties || {})
      .find(([, definition]) => definition.type === "VARIANT")?.[0];
    assert.ok(remoteVariantKey,
      "The remote control must be an instance of a variant from a published component set");
    assert.equal(typeof remoteInstance.component.componentProperties[remoteVariantKey].value,
      "string", "The remote variant selection must be readable");
    record.premises.P17 = { status: "measured", remoteMainId, remoteVariantKey };
  },
  scenario: async ({ gate, call, create, expectRefusal, nodeId, record, stamp, pageId,
    ownFrame }) => {
    await expectRefusal("get_component", { nodeId: remoteMainId },
      "remote_component_refused");
    await expectRefusal("create_or_match_instance", {
      parentId: pageId, componentId: remoteMainId,
    }, "remote_component_refused");

    const firstArgs = {
      parentId: pageId, name: `__R3.3 Control A ${stamp}`,
      identityKey: `r3.3/g1/${stamp}/a`,
    };
    const first = await create("create_or_match_component", firstArgs, "components");
    assert.equal(first.outcome, "confirmed");
    const again = await call("create_or_match_component", firstArgs);
    assert.equal(again.action, "matched");
    assert.equal(again.id, first.id);
    assert.equal(again.identityScan.complete, true);
    record.premises.P1 = { status: "measured", identityKeyStatus: first.after.identityKeyStatus };
    record.premises.P19 = { status: "measured", identityScan: again.identityScan };
    record.checks.identity = { first: first.id, rerun: again.id };
    await expectRefusal("create_or_match_component", {
      ...firstArgs, identityKey: `r3.3/g1/${stamp}/collision`,
    }, "name_collision");
    await expectRefusal("delete_component", {
      nodeId: first.id, identityKey: "wrong-owner", confirm: true,
    }, "not_owned");

    const second = await create("create_or_match_component", {
      parentId: pageId, name: `__R3.3 Control B ${stamp}`,
      identityKey: `r3.3/g1/${stamp}/b`,
    }, "components");
    assert.equal(second.outcome, "confirmed");
    const third = await create("create_or_match_component", {
      parentId: pageId, name: `__R3.3 Control C ${stamp}`,
      identityKey: `r3.3/g1/${stamp}/c`,
    }, "components");
    assert.equal(third.outcome, "confirmed");
    await gate.call("resize_node", { nodeId: first.id, width: 120, height: 60 });
    await gate.call("resize_node", { nodeId: second.id, width: 180, height: 90 });
    await gate.call("resize_node", { nodeId: third.id, width: 55, height: 45 });
    await gate.call("set_fill_color", {
      nodeId: first.id, r: 0.1, g: 0.25, b: 0.7, a: 1,
    });
    await gate.call("set_fill_color", {
      nodeId: second.id, r: 0.8, g: 0.2, b: 0.1, a: 1,
    });
    await gate.call("set_fill_color", {
      nodeId: third.id, r: 0.15, g: 0.75, b: 0.4, a: 1,
    });
    const geometryA = await call("get_node_info", { nodeId: first.id });
    const geometryB = await call("get_node_info", { nodeId: second.id });
    const geometryC = await call("get_node_info", { nodeId: third.id });
    assert.equal(geometryA.type, "COMPONENT");
    assert.equal(geometryB.type, "COMPONENT");
    assert.equal(geometryC.type, "COMPONENT");
    assert.notDeepEqual(geometryA.fills, geometryB.fills);
    assert.notDeepEqual(geometryB.fills, geometryC.fills);
    assert.notEqual(geometryA.absoluteBoundingBox?.width, geometryB.absoluteBoundingBox?.width);
    record.checks.independentGeometry = {
      firstWidth: geometryA.absoluteBoundingBox?.width,
      secondWidth: geometryB.absoluteBoundingBox?.width,
      firstFills: geometryA.fills, secondFills: geometryB.fills,
    };

    const sourceId = await nodeId("create_frame", {
      parentId: pageId, x: 300, y: 0, width: 80, height: 40,
      name: `__R3.3 conversion ${stamp}`,
    });
    const conversionArgs = {
      nodeId: sourceId, identityKey: `r3.3/g1/${stamp}/converted`,
    };
    const converted = await create("create_component_from_node", conversionArgs, "components");
    assert.equal(converted.outcome, "confirmed");
    assert.equal((await call("get_node_info", { nodeId: converted.id })).type, "COMPONENT");
    const convertedAgain = await call("create_component_from_node", conversionArgs);
    assert.equal(convertedAgain.action, "matched");
    record.premises.P4 = {
      status: "measured", sourceIdPreserved: converted.sourceIdPreserved,
    };

    const variantFixtures = [
      { size: "Small", width: 80, fill: { r: 0, g: 0.7, b: 0.2 } },
      { size: "Large", width: 160, fill: { r: 0.9, g: 0.4, b: 0 } },
    ];
    const variantIds = [];
    for (const { size, width, fill } of variantFixtures) {
      const variant = await create("create_or_match_component", {
        parentId: pageId, name: `Size=${size}, State=Default`,
        identityKey: `r3.3/g1/${stamp}/${size}`,
      }, "components");
      assert.equal(variant.outcome, "confirmed");
      variantIds.push(variant.id);
      await gate.call("resize_node", { nodeId: variant.id, width, height: 60 });
      await gate.call("set_fill_color", { nodeId: variant.id, ...fill, a: 1 });
    }
    const setArgs = {
      componentIds: variantIds, parentId: pageId,
      identityKey: `r3.3/g1/${stamp}/set`,
    };
    const set = await create("combine_as_variants", setArgs, "sets");
    assert.equal(set.outcome, "confirmed");
    assert.equal((await call("get_node_info", { nodeId: set.id })).type, "COMPONENT_SET");
    const setAgain = await call("combine_as_variants", setArgs);
    assert.equal(setAgain.action, "matched");
    record.premises.P2 = { status: "measured", memberIdsPreserved: set.memberIdsPreserved };
    record.premises.P3 = {
      status: "measured", memberPositions: set.memberPositions,
      defaultVariantId: set.defaultVariantId,
    };
    record.checks.variants = { setId: set.id, variants: set.after.variants };
    const inventory = await scopedComponents(call, pageId);
    const inventoryIds = new Set(inventory.map(({ id }) => id));
    for (const id of [first.id, second.id, third.id, converted.id,
      ...set.after.variants.map(({ id }) => id)]) {
      assert.ok(inventoryIds.has(id), `created component ${id} is absent from inventory`);
    }
    assert.ok(inventory.some(({ family }) => family === set.after.name),
      "the new component set's family is absent from inventory");
    record.checks.independentInventory = {
      componentIds: [...inventoryIds], setFamily: set.after.name,
    };

    const textId = await nodeId("create_text", {
      parentId: first.id, x: 0, y: 0, text: "Before", name: "G1 label",
    });
    const overflowId = await nodeId("create_rectangle", {
      parentId: first.id, x: 260, y: 10, width: 35, height: 35,
      name: "G1 visibility control",
    });
    record.premises.P18 = { status: "measured", childIds: [textId, overflowId] };
    const label = await call("add_component_property", {
      nodeId: first.id, name: "Label", type: "TEXT", defaultValue: "Before",
    });
    const visible = await call("add_component_property", {
      nodeId: first.id, name: "ShowOverflow", type: "BOOLEAN", defaultValue: true,
    });
    const swapProperty = await call("add_component_property", {
      nodeId: first.id, name: "Alternative", type: "INSTANCE_SWAP",
      defaultValue: second.id, preferredValueIds: [second.id, third.id],
    });
    assert.equal(label.outcome, "confirmed");
    assert.equal(visible.outcome, "confirmed");
    assert.equal(swapProperty.outcome, "confirmed");
    const setProperty = await call("add_component_property", {
      nodeId: set.id, name: "SetLabel", type: "TEXT", defaultValue: "Set default",
    });
    assert.equal(setProperty.outcome, "confirmed");
    record.premises.P5 = { status: "measured", definitionKeys: [
      label.propertyKey, visible.propertyKey, swapProperty.propertyKey,
      setProperty.propertyKey,
    ] };
    assert.equal((await call("bind_component_property", {
      nodeId: textId, componentId: first.id,
      field: "characters", propertyKey: label.propertyKey,
    })).outcome, "confirmed");
    assert.equal((await call("bind_component_property", {
      nodeId: overflowId, componentId: first.id,
      field: "visible", propertyKey: visible.propertyKey,
    })).outcome, "confirmed");
    const nestedMain = await create("create_or_match_instance", {
      parentId: first.id, componentId: second.id,
      identityKey: `r3.3/g1/${stamp}/nested-b`,
    }, "instances");
    assert.equal(nestedMain.outcome, "confirmed");
    assert.equal((await call("bind_component_property", {
      nodeId: nestedMain.id, componentId: first.id,
      field: "mainComponent", propertyKey: swapProperty.propertyKey,
    })).outcome, "confirmed");
    const nestedMainBeforeDetach = await call("get_node_info", { nodeId: nestedMain.id });
    assert.equal(nestedMainBeforeDetach.type, "INSTANCE");
    await expectRefusal("detach_instance", {
      instanceId: nestedMain.id, confirm: true,
    }, "component_member_detach_refused");
    assert.deepEqual(await call("get_node_info", { nodeId: nestedMain.id }),
      nestedMainBeforeDetach, "component-member detach changed the nested main instance");
    record.checks.componentMemberDetachRefusal = { nodeId: nestedMain.id,
      unchanged: true };

    const instanceArgs = {
      parentId: pageId, componentId: first.id,
      identityKey: `r3.3/g1/${stamp}/instance`,
    };
    const instance = await create("create_or_match_instance", instanceArgs, "instances");
    assert.equal(instance.outcome, "confirmed");
    const instanceAgain = await call("create_or_match_instance", instanceArgs);
    assert.equal(instanceAgain.action, "matched");
    await expectRefusal("delete_component", {
      nodeId: first.id, identityKey: firstArgs.identityKey, confirm: true,
    }, "component_has_instances");
    record.premises.P13 = { status: "measured", refusedWhileUsed: true };
    const widthBeforeUnclip = await pngRenderBounds(call, instance.id, stamp, "before-unclip");
    await gate.call("set_clips_content", { nodeId: first.id, clipsContent: false });
    const renderBeforeWidth = await pngRenderBounds(call, instance.id, stamp, "before-hide");
    record.checks.unclip = { beforeWidth: widthBeforeUnclip,
      afterWidth: renderBeforeWidth,
      changedRenderWidth: widthBeforeUnclip !== renderBeforeWidth };
    const beforeHideTree = await call("get_node_info", { nodeId: instance.id });
    const rootLeft = beforeHideTree.absoluteBoundingBox?.x;
    const otherChildren = (beforeHideTree.children || [])
      .filter(({ name }) => name !== "G1 visibility control");
    assert.ok(Number.isFinite(rootLeft) && otherChildren.length > 0,
      "BOOLEAN fixture has no readable non-BOOLEAN bounds");
    const otherRightEdges = otherChildren.map(({ absoluteBoundingBox }) =>
      absoluteBoundingBox?.x + absoluteBoundingBox?.width - rootLeft);
    assert.ok(otherRightEdges.every(Number.isFinite),
      "BOOLEAN fixture's other child bounds are unreadable");
    const widthWithoutOverflow = Math.max(
      beforeHideTree.absoluteBoundingBox.width, ...otherRightEdges,
    );
    assert.ok(renderBeforeWidth > widthWithoutOverflow,
      "BOOLEAN fixture does not extend beyond A and nested B");
    const changed = await call("set_instance_properties", {
      instanceId: instance.id,
      properties: { [label.propertyKey]: "After", [visible.propertyKey]: false },
    });
    assert.equal(changed.outcome, "confirmed");
    const instanceNode = await call("get_node_info", { nodeId: instance.id });
    assert.equal(findNamed(instanceNode, "G1 label")?.characters, "After");
    const textScan = await gate.call("scan_text_nodes", { nodeId: instance.id });
    assert.match(textScan.text, /After/);
    record.checks.independentText = { characters: findNamed(instanceNode, "G1 label")?.characters };
    const renderAfterWidth = await pngRenderBounds(call, instance.id, stamp, "after-hide");
    assert.ok(renderBeforeWidth > renderAfterWidth,
      "BOOLEAN override did not change independent render bounds");
    assert.ok(renderAfterWidth <= widthWithoutOverflow,
      "BOOLEAN override left visible bounds beyond A and nested B");
    record.checks.independentBoolean = {
      format: "PNG", beforeWidth: renderBeforeWidth, afterWidth: renderAfterWidth,
      widthWithoutOverflow,
    };
    let svgReceipt;
    let svgError;
    let pngBytes = false;
    try {
      const exported = await gate.call("export_node_as_image", {
        nodeId: instance.id, format: "SVG",
      });
      svgReceipt = JSON.parse(exported.text);
      const image = exported.result.content.find((entry) => entry.type === "image");
      pngBytes = Boolean(image && Buffer.from(image.data, "base64")
        .subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")));
    } catch (error) {
      svgError = (error?.message || String(error))
        .replace(/^export_node_as_image failed: /, "");
    }
    const svgVerdict = classifyR331SvgExportVerdict({
      pngSucceeded: true, svgReceipt, svgError, pngBytes,
    });
    record.premises.P24 = { status: "measured", outcome: svgVerdict.outcome,
      text: svgVerdict.text || null, mimeType: svgReceipt?.mimeType || null };
    record.checks.svgExport = svgVerdict;
    if (!svgVerdict.success) {
      record.findings.push(`SVG export failed its verdict: ${svgVerdict.reason}`);
    }
    assert.equal(svgVerdict.success, true, svgVerdict.reason);
    const beforeSwap = await call("get_node_info", { nodeId: instance.id });
    const swapped = await call("swap_instance_component", {
      instanceId: instance.id, componentId: second.id,
    });
    assert.equal(swapped.outcome, "confirmed");
    const afterSwap = await call("get_node_info", { nodeId: instance.id });
    assert.notDeepEqual(afterSwap.fills, beforeSwap.fills,
      "swap_instance_component did not change the independent fill read");
    assert.deepEqual(afterSwap.fills, geometryB.fills);
    assert.notEqual(afterSwap.name, beforeSwap.name,
      "swap_instance_component did not change the instance name");
    record.premises.P9 = { status: "measured",
      overridesBefore: swapped.overridesBefore, overridesAfter: swapped.overridesAfter,
      widthBefore: beforeSwap.absoluteBoundingBox?.width,
      widthAfter: afterSwap.absoluteBoundingBox?.width,
      nameBefore: beforeSwap.name, nameAfter: afterSwap.name,
      fillsBefore: beforeSwap.fills, fillsAfter: afterSwap.fills };
    const resetInstance = await create("create_or_match_instance", {
      parentId: pageId, componentId: first.id,
      identityKey: `r3.3/g1/${stamp}/reset-instance`,
    }, "instances");
    assert.equal(resetInstance.outcome, "confirmed");
    const resetOriginal = await call("get_node_info", { nodeId: resetInstance.id });
    assert.deepEqual(resetOriginal.fills, geometryA.fills);
    await gate.call("set_fill_color", {
      nodeId: resetInstance.id, r: 0.75, g: 0.1, b: 0.55, a: 1,
    });
    const resetOverridden = await call("get_node_info", { nodeId: resetInstance.id });
    assert.notDeepEqual(resetOverridden.fills, geometryA.fills,
      "the reset fixture did not create a fill override");
    const reset = await call("reset_instance_overrides", { instanceId: resetInstance.id });
    assert.equal(reset.outcome, "confirmed");
    assert.ok(reset.overridesBefore?.length > 0,
      "reset must start with a direct override");
    assert.deepEqual(reset.overridesAfter, []);
    assert.equal(reset.changed, true);
    assert.equal(reset.wrote, true);
    const resetRestored = await call("get_node_info", { nodeId: resetInstance.id });
    assert.deepEqual(resetRestored.fills, geometryA.fills,
      "reset did not restore component A's fill");
    record.premises.P10 = { status: "measured",
      overridesBefore: reset.overridesBefore, overridesAfter: reset.overridesAfter,
      changed: reset.changed, restoredFills: resetRestored.fills };
    const detached = await call("detach_instance", {
      instanceId: instance.id, confirm: true,
    });
    if (detached.frameId) ownFrame(detached.frameId); // own first, assert second
    assert.equal(detached.outcome, "confirmed");
    record.owned.instances = record.owned.instances.filter(({ id }) => id !== instance.id);
    record.premises.P11 = {
      status: "measured", originalIdResolves: detached.originalIdResolves,
      originalIdType: detached.originalIdType,
      identityKeyCarried: detached.identityKeyCarried,
    };
    assert.equal((await call("get_node_info", { nodeId: detached.frameId })).type, "FRAME");
    if (detached.originalIdResolves) {
      const oldLookup = await call("get_node_info", { nodeId: instance.id });
      assert.notEqual(oldLookup.type, "INSTANCE",
        "detached original ID still resolves to an INSTANCE");
      assert.equal(detached.originalIdType, oldLookup.type);
    } else {
      const oldLookup = await gate.callExpectingRefusal("get_node_info", {
        nodeId: instance.id,
      });
      assert.ok(oldLookup.message, "detached original ID unexpectedly remained readable");
      assert.equal(detached.originalIdType, null);
    }

    const variantInstance = await create("create_or_match_instance", {
      parentId: pageId, componentSetId: set.id,
      variantProperties: { Size: "Small", State: "Default" },
    }, "instances");
    assert.equal(variantInstance.outcome, "confirmed");
    const variantBefore = await call("get_node_info", { nodeId: variantInstance.id });
    const variantChange = await call("set_instance_properties", {
      instanceId: variantInstance.id, properties: { Size: "Large" },
    });
    assert.equal(variantChange.outcome, "confirmed");
    assert.equal(variantChange.mainComponentAfter.id, variantIds[1]);
    const variantAfter = await call("get_node_info", { nodeId: variantInstance.id });
    assert.notDeepEqual(variantAfter.fills, variantBefore.fills,
      "VARIANT switch did not change the independent fill read");
    assert.equal(variantBefore.absoluteBoundingBox?.width, variantFixtures[0].width,
      "Small variant did not have its fixture width before the switch");
    assert.equal(variantAfter.absoluteBoundingBox?.width, variantFixtures[1].width,
      "Large variant did not have its fixture width after the switch");
    record.premises.P8 = { status: "measured",
      mainBefore: variantChange.mainComponentBefore.id,
      mainAfter: variantChange.mainComponentAfter.id,
      widthBefore: variantBefore.absoluteBoundingBox?.width,
      widthAfter: variantAfter.absoluteBoundingBox?.width,
      nameBefore: variantBefore.name, nameAfter: variantAfter.name,
      setName: set.after.name,
      fillsBefore: variantBefore.fills, fillsAfter: variantAfter.fills };
    await expectRefusal("swap_instance_component", {
      instanceId: variantInstance.id, componentId: remoteMainId,
    }, "remote_reference_refused");
    await expectRefusal("set_instance_properties", {
      instanceId: variantInstance.id,
      properties: { [swapProperty.propertyKey]: remoteMainId },
    }, "property_not_found");
    // The local INSTANCE_SWAP path is measured on an instance that defines the key.
    const localSwapInstance = await create("create_or_match_instance", {
      parentId: pageId, componentId: first.id,
    }, "instances");
    assert.equal(localSwapInstance.outcome, "confirmed");
    const localSwapBefore = await call("get_node_info", { nodeId: localSwapInstance.id });
    const nestedBefore = findType({ children: localSwapBefore.children }, "INSTANCE");
    assert.ok(nestedBefore, "component A instance has no nested B instance");
    assert.deepEqual(nestedBefore.fills, geometryB.fills);
    const localSwap = await call("set_instance_properties", {
      instanceId: localSwapInstance.id,
      properties: { [swapProperty.propertyKey]: third.id },
    });
    assert.equal(localSwap.outcome, "confirmed");
    const localSwapAfter = await call("get_node_info", { nodeId: localSwapInstance.id });
    const nestedAfter = findType({ children: localSwapAfter.children }, "INSTANCE");
    assert.ok(nestedAfter, "swapped nested instance is absent");
    assert.deepEqual(nestedAfter.fills, geometryC.fills,
      "INSTANCE_SWAP did not change nested B to C's fill");
    assert.notEqual(nestedAfter.name, nestedBefore.name,
      "INSTANCE_SWAP did not change the nested instance name");
    const nestedMainAfter = await call("get_node_info", { nodeId: nestedMain.id });
    assert.deepEqual(nestedMainAfter.fills, geometryB.fills,
      "INSTANCE_SWAP changed main A's nested B fill");
    assert.equal(nestedMainAfter.name, nestedMainBeforeDetach.name,
      "INSTANCE_SWAP changed main A's nested B name");
    record.checks.independentInstanceSwap = {
      instanceId: localSwapInstance.id,
      childIdBefore: nestedBefore.id, childIdAfter: nestedAfter.id,
      nameBefore: nestedBefore.name, nameAfter: nestedAfter.name,
      fillsBefore: nestedBefore.fills, fillsAfter: nestedAfter.fills,
    };
    record.premises.P21 = { status: "measured",
      childIdBefore: nestedBefore.id, childIdAfter: nestedAfter.id,
      widthBefore: nestedBefore.absoluteBoundingBox?.width,
      widthAfter: nestedAfter.absoluteBoundingBox?.width,
      heightBefore: nestedBefore.absoluteBoundingBox?.height,
      heightAfter: nestedAfter.absoluteBoundingBox?.height };
    const nestedBeforeDetach = await call("get_node_info", { nodeId: nestedAfter.id });
    await expectRefusal("detach_instance", {
      instanceId: nestedAfter.id, confirm: true,
    }, "nested_instance_detach_refused");
    assert.deepEqual(await call("get_node_info", { nodeId: nestedAfter.id }),
      nestedBeforeDetach, "nested detach changed the instance child");
    record.checks.nestedDetachRefusal = { nodeId: nestedAfter.id, unchanged: true };
    await expectRefusal("set_instance_properties", {
      instanceId: localSwapInstance.id,
      properties: { [swapProperty.propertyKey]: remoteMainId },
    }, "remote_reference_refused");

    await expectRefusal("set_instance_properties", {
      instanceId: options["remote-instance-id"],
      properties: {
        [remoteVariantKey]: remoteInstance.component.componentProperties[remoteVariantKey].value,
      },
    }, "remote_reference_refused");

    const renamed = await call("edit_component_property", {
      nodeId: first.id, propertyKey: label.propertyKey, name: "Caption",
    });
    assert.equal(renamed.outcome, "confirmed");
    record.premises.P6 = { status: "measured",
      oldKey: label.propertyKey, newKey: renamed.propertyKey,
      referencesAfter: renamed.referencesAfter };
    const deleted = await call("delete_component_property", {
      nodeId: first.id, propertyKey: renamed.propertyKey, confirm: true,
    });
    assert.equal(deleted.outcome, "confirmed");
    record.premises.P7 = { status: "measured",
      referencesBefore: deleted.referencesBefore,
      referencesAfter: deleted.referencesAfter };

    const isolatedArgs = {
      parentId: pageId, name: `__R3.3 deletable ${stamp}`,
      identityKey: `r3.3/g1/${stamp}/deletable`,
    };
    const isolated = await create("create_or_match_component", isolatedArgs, "components");
    assert.equal(isolated.outcome, "confirmed");
    const removal = await call("delete_component", {
      nodeId: isolated.id, identityKey: isolatedArgs.identityKey, confirm: true,
    });
    assert.equal(removal.outcome, "removed");
    record.owned.components = record.owned.components.filter(({ id }) => id !== isolated.id);
    record.premises.P14 = { status: "measured", removalSignal: removal.removalSignal };
    assert.ok(!(await scopedComponents(call, pageId)).some(({ id }) => id === isolated.id),
      "deleted component still appears in the independent inventory");
    record.checks.independentDeletion = { componentId: isolated.id,
      removalSignal: removal.removalSignal, absentFromInventory: true };

    await gate.call("delete_node", { nodeId: variantInstance.id });
    record.owned.instances = record.owned.instances.filter(({ id }) => id !== variantInstance.id);
    const setRemoval = await call("delete_component", {
      nodeId: set.id, identityKey: setArgs.identityKey, confirm: true,
    });
    assert.equal(setRemoval.outcome, "removed", "whole-set deletion was not confirmed");
    assert.ok(setRemoval.removalSignal, "whole-set deletion has no removal signal");
    record.owned.sets = record.owned.sets.filter(({ id }) => id !== set.id);
    assert.ok(!(await scopedComponents(call, pageId))
      .some(({ family }) => family === set.after.name),
    "deleted component-set family still appears in the independent inventory");
    record.checks.wholeSetDeletion = { setId: set.id,
      removalSignal: setRemoval.removalSignal, familyAbsent: true };
  },
});
