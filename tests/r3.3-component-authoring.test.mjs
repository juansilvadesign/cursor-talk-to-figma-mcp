import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const MUTATORS = new Set([
  "createComponent", "createComponentFromNode", "combineAsVariants", "createInstance",
  "appendChild", "insertChild", "remove", "addComponentProperty",
  "editComponentProperty", "deleteComponentProperty", "componentPropertyReferences",
  "setProperties", "swapComponent", "removeOverrides", "detachInstance",
  "createSlot", "resetSlot", "setPluginData", "importComponentByKeyAsync",
  "importComponentSetByKeyAsync",
]);
const R33_IDENTITY_KEY = "talk-to-figma.component-authoring.identity.v1";

function noNativeWrites(harness, start) {
  assert.deepEqual(harness.componentNativeCalls.slice(start).filter((entry) =>
    MUTATORS.has(entry.method)), []);
}

test("3A canonical component read distinguishes local, remote, orphan, and consumer uncertainty", async () => {
  const harness = await loadPluginHarness();
  const local = await harness.command("get_component", { nodeId: "100:1", includeInstances: true });
  assert.equal(local.success, true);
  assert.equal(local.component.type, "COMPONENT");
  assert.equal(local.component.page.id, "1:1");
  assert.equal(local.component.identityKeyStatus, "absent");
  assert.equal(local.component.instances.status, "observed");
  assert.equal(local.component.instances.count, 0);

  const start = harness.componentNativeCalls.length;
  harness.getNode("100:1").remote = true;
  const remote = await harness.command("get_component", { nodeId: "100:1" });
  assert.equal(remote.refusal.code, "remote_component_refused");
  noNativeWrites(harness, start);

  harness.getNode("100:1").remote = false;
  const wrong = await harness.command("get_component", { nodeId: "10:3" });
  assert.equal(wrong.refusal.code, "not_exact_local_component");
  noNativeWrites(harness, start);

  const component = harness.getNode("100:1");
  component.parent = null;
  const orphan = await harness.command("get_component", { nodeId: "100:1" });
  assert.equal(orphan.refusal.code, "not_exact_local_component");
  noNativeWrites(harness, start);

  component.parent = harness.getNode("1:1");
  Object.defineProperty(component, "componentPropertyDefinitions", {
    configurable: true, value: undefined,
  });
  const absent = await harness.command("get_component", { nodeId: "100:1" });
  assert.equal(absent.component.componentPropertyDefinitionsStatus, "absent");
  Object.defineProperty(component, "componentPropertyDefinitions", {
    configurable: true, get() { throw new Error("unreadable definitions"); },
  });
  const unreadable = await harness.command("get_component", { nodeId: "100:1" });
  assert.equal(unreadable.component.componentPropertyDefinitionsStatus, "unreadable");
});

test("3A consumer read reports unavailable and remote main without traversing it", async () => {
  const unavailable = await loadPluginHarness({ P13: "unavailable" });
  const read = await unavailable.command("get_component", {
    nodeId: "100:1", includeInstances: true,
  });
  assert.equal(read.component.instances.status, "unreadable");
  assert.equal(read.component.instances.count, null);

  const harness = await loadPluginHarness();
  const component = harness.getNode("100:1");
  component.remote = true;
  const instance = component.createInstance();
  const result = await harness.command("get_component", { nodeId: instance.id });
  assert.equal(result.success, true);
  assert.equal(result.component.mainComponent.remote, true);
  assert.equal(result.component.mainComponent.id, component.id);
});

test("3B component identity creates once, matches once, and refuses collisions before native writes", async () => {
  const harness = await loadPluginHarness();
  const input = { parentId: "1:1", name: "Owned", identityKey: "owned-component" };
  const created = await harness.command("create_or_match_component", input);
  assert.equal(created.outcome, "confirmed");
  assert.equal(created.action, "created");
  assert.equal(created.identityScan.complete, true);
  assert.equal(JSON.stringify(created).includes(input.identityKey), false);

  const before = harness.componentNativeCalls.length;
  const matched = await harness.command("create_or_match_component", input);
  assert.equal(matched.action, "matched");
  noNativeWrites(harness, before);

  const collision = await harness.command("create_or_match_component", {
    ...input, identityKey: "other-owner",
  });
  assert.equal(collision.refusal.code, "name_collision");
  noNativeWrites(harness, before);

  const conflict = await harness.command("create_or_match_component", {
    ...input, name: "Different",
  });
  assert.equal(conflict.refusal.code, "identity_key_conflict");
  noNativeWrites(harness, before);
});

test("3B incomplete scans and discarded identity reads do not grant a confirmed create", async () => {
  const missing = await loadPluginHarness({ P19: "misses" });
  const a = await missing.command("create_or_match_component", {
    parentId: "1:1", name: "P19", identityKey: "p19",
  });
  assert.equal(a.outcome, "confirmed");
  const start = missing.componentNativeCalls.length;
  const b = await missing.command("create_or_match_component", {
    parentId: "1:1", name: "P19", identityKey: "p19",
  });
  assert.equal(b.refusal.code, "identity_scan_incomplete");
  noNativeWrites(missing, start);

  const failed = await loadPluginHarness({ P19: "throws" });
  const rejected = await failed.command("create_or_match_component", {
    parentId: "1:1", name: "No write", identityKey: "p19-fail",
  });
  assert.equal(rejected.refusal.code, "identity_scan_incomplete");
  noNativeWrites(failed, 0);

  const discarded = await loadPluginHarness({ P1: "discard" });
  const unconfirmed = await discarded.command("create_or_match_component", {
    parentId: "1:1", name: "No key readback", identityKey: "p1",
  });
  assert.equal(unconfirmed.outcome, "unconfirmed");
  assert.equal(unconfirmed.readbackMatchesRequested, false);
});

test("3B conversion reports both observed source-ID fates and rejects nested sources", async () => {
  for (const fate of ["preserve_id", "replace_id", "carry_data"]) {
    const harness = await loadPluginHarness({ P4: fate });
    const sourceId = "10:1";
    harness.getNode(sourceId).setPluginData("r33-p4-probe", "carried");
    const result = await harness.command("create_component_from_node", {
      nodeId: sourceId, identityKey: `converted-${fate}`,
    });
    assert.equal(result.outcome, "confirmed");
    assert.equal(result.sourceNodeId, sourceId);
    assert.equal(result.sourceIdPreserved, fate === "preserve_id");
    assert.equal(harness.getNode(result.id).getPluginData("r33-p4-probe"),
      fate === "carry_data" ? "carried" : "");
    const before = harness.componentNativeCalls.length;
    const rerun = await harness.command("create_component_from_node", {
      nodeId: sourceId, identityKey: `converted-${fate}`,
    });
    assert.equal(rerun.action, "matched");
    noNativeWrites(harness, before);
  }
  const harness = await loadPluginHarness();
  const start = harness.componentNativeCalls.length;
  const nested = await harness.command("create_component_from_node", {
    nodeId: "100:2", identityKey: "nested",
  });
  assert.equal(nested.refusal.code, "ineligible_for_component");
  noNativeWrites(harness, start);
});

test("3B instance identity is parent scoped; remote and wrong-target requests are read-only refusals", async () => {
  const harness = await loadPluginHarness();
  const component = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Instance main", identityKey: "instance-main",
  });
  const args = { parentId: "1:1", componentId: component.id, identityKey: "instance-key" };
  const created = await harness.command("create_or_match_instance", args);
  assert.equal(created.outcome, "confirmed");
  assert.equal(created.after.mainComponent.id, component.id);
  const before = harness.componentNativeCalls.length;
  const matched = await harness.command("create_or_match_instance", args);
  assert.equal(matched.action, "matched");
  noNativeWrites(harness, before);
  const conflict = await harness.command("create_or_match_instance", {
    ...args, componentId: "100:1",
  });
  assert.equal(conflict.refusal.code, "identity_key_conflict");
  noNativeWrites(harness, before);
  harness.getNode("100:1").remote = true;
  const remote = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: "100:1",
  });
  assert.equal(remote.refusal.code, "remote_component_refused");
  noNativeWrites(harness, before);
  const unkeyed = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: component.id,
  });
  assert.equal(unkeyed.identityKeyStatus, "none");
  assert.equal(unkeyed.rerunWillCreateAnother, true);
});

test("3B P20 distinguishes inherited, own, absent, and unreadable instance identity", async () => {
  const harness = await loadPluginHarness({ P11: "carry_key" });
  const main = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "P20 main", identityKey: "p20-main",
  });
  const child = harness.getNode("10:4");
  child.setPluginData(R33_IDENTITY_KEY, "p20-child");
  harness.getNode(main.id).appendChild(child);
  const inherited = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: main.id,
  });
  assert.equal(harness.getNode(inherited.id).getPluginData(R33_IDENTITY_KEY), "p20-main");
  assert.equal(inherited.after.identityKeySource, "inherited");
  assert.equal(inherited.after.identityKeyStatus, "absent");
  const inheritedChild = harness.getNode(inherited.id).children[0];
  assert.equal(inheritedChild.getPluginData(R33_IDENTITY_KEY), "p20-child");
  const beforeConflict = harness.componentNativeCalls.length;
  const sameAsMain = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: main.id, identityKey: "p20-main",
  });
  assert.equal(sameAsMain.refusal.code, "identity_key_conflict");
  assert.match(sameAsMain.refusal.message, /inherited/);
  noNativeWrites(harness, beforeConflict);

  const other = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "P20 other", identityKey: "p20-other",
  });
  const own = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: other.id, identityKey: "p20-main",
  });
  assert.equal(own.action, "created", "an inherited sibling key must not match");
  assert.equal(own.after.identityKeySource, "own");
  assert.equal(own.after.identityKeyStatus, "present");
  const rerun = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: other.id, identityKey: "p20-main",
  });
  assert.equal(rerun.action, "matched");

  const carried = await harness.command("detach_instance", {
    instanceId: own.id, confirm: true,
  });
  assert.equal(carried.identityKeySourceBefore, "own");
  assert.equal(carried.identityKeyCarried, true);
  const inheritedDetach = await harness.command("detach_instance", {
    instanceId: inherited.id, confirm: true,
  });
  assert.equal(inheritedDetach.identityKeySourceBefore, "inherited");
  assert.equal(inheritedDetach.identityKeyCarried, false);

  const bare = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: "100:1",
  });
  assert.equal(bare.after.identityKeySource, "absent");
  assert.equal(bare.after.identityKeyStatus, "absent");
  harness.getNode(bare.id).getPluginData = () => { throw new Error("unreadable"); };
  const unreadable = await harness.command("get_component", { nodeId: bare.id });
  assert.equal(unreadable.component.identityKeySource, "unreadable");
  assert.equal(unreadable.component.identityKeyStatus, "unreadable");
});

test("3C binding an INSTANCE confirms its own references while retaining descendant summary", async () => {
  const harness = await loadPluginHarness();
  const main = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Reference owner", identityKey: "reference-owner",
  });
  const nestedMain = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Reference nested", identityKey: "reference-nested",
  });
  const nestedText = harness.getNode("10:5");
  harness.getNode(nestedMain.id).appendChild(nestedText);
  const textProperty = await harness.command("add_component_property", {
    nodeId: nestedMain.id, name: "Nested label", type: "TEXT", defaultValue: "Before",
  });
  const textBind = await harness.command("bind_component_property", {
    nodeId: nestedText.id, componentId: nestedMain.id,
    field: "characters", propertyKey: textProperty.propertyKey,
  });
  assert.equal(textBind.outcome, "confirmed");
  const swapProperty = await harness.command("add_component_property", {
    nodeId: main.id, name: "Alternative", type: "INSTANCE_SWAP",
    defaultValue: nestedMain.id,
  });
  const nested = await harness.command("create_or_match_instance", {
    parentId: main.id, componentId: nestedMain.id,
  });
  const bound = await harness.command("bind_component_property", {
    nodeId: nested.id, componentId: main.id,
    field: "mainComponent", propertyKey: swapProperty.propertyKey,
  });
  assert.equal(bound.outcome, "confirmed");
  assert.equal(bound.after.componentPropertyReferences.mainComponent, swapProperty.propertyKey);
  assert.equal(bound.after.componentPropertyReferencesStatus, "observed");
  assert.equal(bound.after.descendantPropertyReferences.items[0].references.characters,
    textProperty.propertyKey);
  assert.equal(bound.after.descendantPropertyReferences.items[0].references.mainComponent,
    undefined);
});

test("3B owned deletion checks every consumer and defers stale removal", async () => {
  const harness = await loadPluginHarness();
  const component = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Delete main", identityKey: "delete-main",
  });
  const instance = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: component.id,
  });
  const before = harness.componentNativeCalls.length;
  const refused = await harness.command("delete_component", {
    nodeId: component.id, identityKey: "delete-main", confirm: true,
  });
  assert.equal(refused.refusal.code, "component_has_instances");
  noNativeWrites(harness, before);
  const wrong = await harness.command("delete_component", {
    nodeId: component.id, identityKey: "other", confirm: true,
  });
  assert.equal(wrong.refusal.code, "not_owned");
  noNativeWrites(harness, before);
  harness.getNode(instance.id).remove();
  const removed = await harness.command("delete_component", {
    nodeId: component.id, identityKey: "delete-main", confirm: true,
  });
  assert.equal(removed.outcome, "removed");
  assert.match(removed.removalSignal, /page_inventory/);

  const missed = await loadPluginHarness({ P13: "misses" });
  const owned = await missed.command("create_or_match_component", {
    parentId: "1:1", name: "Missed", identityKey: "missed",
  });
  await missed.command("create_or_match_instance", {
    parentId: "1:1", componentId: owned.id,
  });
  const missStart = missed.componentNativeCalls.length;
  const unresolved = await missed.command("delete_component", {
    nodeId: owned.id, identityKey: "missed", confirm: true,
  });
  assert.equal(unresolved.refusal.code, "consumer_observation_unavailable");
  noNativeWrites(missed, missStart);

  const stale = await loadPluginHarness({ P14: "stale" });
  const staleOwned = await stale.command("create_or_match_component", {
    parentId: "1:1", name: "Stale", identityKey: "stale",
  });
  const uncertain = await stale.command("delete_component", {
    nodeId: staleOwned.id, identityKey: "stale", confirm: true,
  });
  assert.equal(uncertain.outcome, "removal_unconfirmed");
  assert.equal(stale.getNode(staleOwned.id), null);
});

async function variantFixture(harness, prefix = "variants") {
  const first = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Size=Small, State=Off", identityKey: `${prefix}-small`,
  });
  const second = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Size=Large, State=Off", identityKey: `${prefix}-large`,
  });
  assert.equal(first.outcome, "confirmed");
  assert.equal(second.outcome, "confirmed");
  harness.getNode(first.id).x = 100;
  harness.getNode(second.id).x = 0;
  return [first.id, second.id];
}

test("3C variants validate the full matrix before combine and report both member-ID fates", async () => {
  for (const fate of ["preserve", "replaces_members"]) {
    const harness = await loadPluginHarness({ P2: fate });
    const componentIds = await variantFixture(harness, fate);
    const args = { componentIds, parentId: "1:1", identityKey: `set-${fate}` };
    const set = await harness.command("combine_as_variants", args);
    assert.equal(set.outcome, "confirmed");
    assert.equal(set.memberIdsPreserved, fate === "preserve");
    assert.equal(set.defaultVariantId, set.after.variants[1].id);
    const before = harness.componentNativeCalls.length;
    const matched = await harness.command("combine_as_variants", args);
    assert.equal(matched.action, "matched");
    noNativeWrites(harness, before);
    const memberDelete = await harness.command("delete_component", {
      nodeId: set.after.variants[0].id, identityKey: `${fate}-small`, confirm: true,
    });
    assert.equal(memberDelete.refusal.code, "variant_member_delete_refused");
    noNativeWrites(harness, before);
  }
  const wrong = await loadPluginHarness();
  const ids = await variantFixture(wrong, "bad");
  wrong.getNode(ids[1]).name = "State=Off, Color=Red";
  const before = wrong.componentNativeCalls.length;
  const refusal = await wrong.command("combine_as_variants", {
    componentIds: ids, parentId: "1:1", identityKey: "invalid",
  });
  assert.equal(refusal.refusal.code, "invalid_variant_matrix");
  noNativeWrites(wrong, before);

  const alternate = await loadPluginHarness({ P3: "first_member" });
  const alternateIds = await variantFixture(alternate, "p3");
  const observed = await alternate.command("combine_as_variants", {
    componentIds: alternateIds, parentId: "1:1", identityKey: "p3-set",
  });
  assert.equal(observed.outcome, "confirmed");
  assert.equal(observed.defaultVariantId, observed.after.variants[0].id);
  assert.deepEqual(observed.memberPositions.map(({ x }) => x), [100, 0]);
});

test("3C property support matrix, exact keys, bindings, rename, and delete all read back", async () => {
  const harness = await loadPluginHarness();
  const component = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Property main", identityKey: "property-main",
  });
  const text = harness.getNode("10:5");
  harness.getNode(component.id).appendChild(text);
  const added = await harness.command("add_component_property", {
    nodeId: component.id, name: "Label", type: "TEXT", defaultValue: "Hello",
  });
  assert.equal(added.outcome, "confirmed");
  assert.match(added.propertyKey, /^Label#/);
  const before = harness.componentNativeCalls.length;
  const duplicate = await harness.command("add_component_property", {
    nodeId: component.id, name: "Label", type: "TEXT", defaultValue: "Other",
  });
  assert.equal(duplicate.refusal.code, "property_name_collision");
  noNativeWrites(harness, before);
  const bound = await harness.command("bind_component_property", {
    nodeId: text.id, componentId: component.id,
    field: "characters", propertyKey: added.propertyKey,
  });
  assert.equal(bound.outcome, "confirmed");
  const edited = await harness.command("edit_component_property", {
    nodeId: component.id, propertyKey: added.propertyKey,
    name: "Caption", defaultValue: "Updated",
  });
  assert.equal(edited.outcome, "confirmed");
  assert.notEqual(edited.propertyKey, added.propertyKey);
  assert.equal(edited.referencesAfter.items[0].references.characters, edited.propertyKey);
  const removed = await harness.command("delete_component_property", {
    nodeId: component.id, propertyKey: edited.propertyKey, confirm: true,
  });
  assert.equal(removed.outcome, "confirmed");
  assert.deepEqual(removed.referencesAfter.items, []);
});

test("3C platform property branches and remote preferred values stay explicit", async () => {
  const setHarness = await loadPluginHarness({ P5: "set_rejects" });
  const ids = await variantFixture(setHarness, "p5");
  const set = await setHarness.command("combine_as_variants", {
    componentIds: ids, parentId: "1:1", identityKey: "p5-set",
  });
  const failure = await setHarness.command("add_component_property", {
    nodeId: set.id, name: "Copy", type: "TEXT", defaultValue: "Value",
  });
  assert.equal(failure.refusal.code, "native_call_failed");
  assert.match(failure.refusal.error, /set-level/);

  const harness = await loadPluginHarness({ P6: "references_stale", P7: "references_dangle" });
  const component = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "P6", identityKey: "p6-main",
  });
  const rectangle = harness.getNode("10:4");
  harness.getNode(component.id).appendChild(rectangle);
  const property = await harness.command("add_component_property", {
    nodeId: component.id, name: "Show", type: "BOOLEAN", defaultValue: true,
  });
  await harness.command("bind_component_property", {
    nodeId: rectangle.id, field: "visible", propertyKey: property.propertyKey,
  });
  const renamed = await harness.command("edit_component_property", {
    nodeId: component.id, propertyKey: property.propertyKey, name: "Visible",
  });
  assert.equal(renamed.referencesAfter.items[0].references.visible, property.propertyKey);
  const deleted = await harness.command("delete_component_property", {
    nodeId: component.id, propertyKey: renamed.propertyKey, confirm: true,
  });
  assert.equal(deleted.outcome, "confirmed");
  assert.equal(deleted.referencesAfter.items[0].references.visible, property.propertyKey);

  harness.getNode("100:1").remote = true;
  const nativeStart = harness.componentNativeCalls.length;
  const remote = await harness.command("add_component_property", {
    nodeId: component.id, name: "Swap", type: "INSTANCE_SWAP",
    defaultValue: component.id, preferredValueIds: ["100:1"],
  });
  assert.equal(remote.refusal.code, "remote_reference_refused");
  noNativeWrites(harness, nativeStart);
});

test("3D instance properties validate all keys before the one native call and detect discarded writes", async () => {
  for (const behavior of [undefined, "discards", "throws"]) {
    const harness = await loadPluginHarness({ P8: behavior });
    const component = await harness.command("create_or_match_component", {
      parentId: "1:1", name: "P8 main", identityKey: `p8-${behavior || "normal"}`,
    });
    const property = await harness.command("add_component_property", {
      nodeId: component.id, name: "Label", type: "TEXT", defaultValue: "Before",
    });
    const instance = await harness.command("create_or_match_instance", {
      parentId: "1:1", componentId: component.id,
    });
    const before = harness.componentNativeCalls.length;
    const invalid = await harness.command("set_instance_properties", {
      instanceId: instance.id,
      properties: { [property.propertyKey]: "After", unknown: true },
    });
    assert.equal(invalid.refusal.code, "property_not_found");
    noNativeWrites(harness, before);
    const result = await harness.command("set_instance_properties", {
      instanceId: instance.id, properties: { [property.propertyKey]: "After" },
    });
    assert.equal(result.outcome,
      behavior === "discards" ? "unconfirmed" :
      behavior === "throws" ? "refused" : "confirmed");
    if (behavior === "throws") {
      assert.equal(result.refusal.code, "native_call_failed");
      assert.match(result.refusal.error, /Figma refused/);
    }
    assert.equal(harness.componentNativeCalls.slice(before)
      .filter((call) => call.method === "setProperties").length, 1);
  }
});

test("3D variant changes resolve a local member; remote-main variant writes refuse", async () => {
  const harness = await loadPluginHarness();
  const componentIds = await variantFixture(harness, "p8-variants");
  const set = await harness.command("combine_as_variants", {
    componentIds, parentId: "1:1", identityKey: "p8-set",
  });
  const instance = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentSetId: set.id,
    variantProperties: { Size: "Small", State: "Off" },
  });
  assert.equal(instance.outcome, "confirmed");
  const changed = await harness.command("set_instance_properties", {
    instanceId: instance.id, properties: { Size: "Large" },
  });
  assert.equal(changed.outcome, "confirmed");
  assert.equal(changed.mainComponentAfter.id, componentIds[1]);
  const start = harness.componentNativeCalls.length;
  const invalid = await harness.command("set_instance_properties", {
    instanceId: instance.id, properties: { Size: "Unknown" },
  });
  assert.equal(invalid.refusal.code, "invalid_variant_selection");
  noNativeWrites(harness, start);
  const localMain = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentSetId: set.id,
    variantProperties: { Size: "Small", State: "Off" },
  });
  harness.getNode(componentIds[1]).remote = true;
  const remoteStart = harness.componentNativeCalls.length;
  const remoteTarget = await harness.command("set_instance_properties", {
    instanceId: localMain.id, properties: { Size: "Large" },
  });
  assert.equal(remoteTarget.refusal.code, "remote_reference_refused");
  const remoteCreate = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentSetId: set.id,
    variantProperties: { Size: "Large", State: "Off" },
  });
  assert.equal(remoteCreate.refusal.code, "remote_component_refused");
  noNativeWrites(harness, remoteStart);
  const remote = await harness.command("set_instance_properties", {
    instanceId: instance.id, properties: { Size: "Small" },
  });
  assert.equal(remote.refusal.code, "remote_reference_refused");
  noNativeWrites(harness, remoteStart);
});

test("3D swap, reset, and detach report observed platform branches", async () => {
  for (const behavior of [undefined, "drops_overrides"]) {
    const harness = await loadPluginHarness({ P9: behavior });
    const component = await harness.command("create_or_match_component", {
      parentId: "1:1", name: "Swap", identityKey: `swap-${behavior || "keep"}`,
    });
    const instance = await harness.command("create_or_match_instance", {
      parentId: "1:1", componentId: "100:1", identityKey: "instance-swap",
    });
    harness.getNode(instance.id).overrides = [{ id: instance.id, overriddenFields: ["fills"] }];
    const swapped = await harness.command("swap_instance_component", {
      instanceId: instance.id, componentId: component.id,
    });
    assert.equal(swapped.outcome, "confirmed");
    assert.equal(swapped.mainComponentAfter.id, component.id);
    assert.equal(swapped.overridesAfter.length,
      behavior === "drops_overrides" ? 0 : 1);
    const reset = await harness.command("reset_instance_overrides", {
      instanceId: instance.id,
    });
    assert.equal(reset.outcome, "confirmed");
    assert.deepEqual(reset.overridesAfter, []);
    assert.equal(reset.changed, behavior !== "drops_overrides");
    assert.equal(reset.wrote, behavior !== "drops_overrides");
    const detached = await harness.command("detach_instance", {
      instanceId: instance.id, confirm: true,
    });
    assert.equal(detached.outcome, "confirmed");
    assert.equal(detached.after.type, "FRAME");
    assert.equal(detached.originalIdResolves, false);
    assert.equal(detached.originalIdType, null);
  }
  const retained = await loadPluginHarness({ P10: "retains", P11: "preserve_id" });
  const component = await retained.command("create_or_match_component", {
    parentId: "1:1", name: "Retain", identityKey: "retain-main",
  });
  const instance = await retained.command("create_or_match_instance", {
    parentId: "1:1", componentId: component.id,
  });
  retained.getNode(instance.id).overrides = [{ id: instance.id, overriddenFields: ["fills"] }];
  const reset = await retained.command("reset_instance_overrides", {
    instanceId: instance.id,
  });
  assert.equal(reset.outcome, "unconfirmed");
  assert.equal(reset.changed, false);
  assert.equal(reset.wrote, false);
  const detached = await retained.command("detach_instance", {
    instanceId: instance.id, confirm: true,
  });
  assert.equal(detached.outcome, "confirmed");
  assert.equal(detached.originalIdResolves, true);
  assert.equal(detached.originalIdType, "FRAME");

  for (const fate of ["carry_key", "drop_key"]) {
    const carrying = await loadPluginHarness({ P11: fate });
    const main = await carrying.command("create_or_match_component", {
      parentId: "1:1", name: `Detach ${fate}`, identityKey: `detach-${fate}`,
    });
    const keyed = await carrying.command("create_or_match_instance", {
      parentId: "1:1", componentId: main.id, identityKey: `instance-${fate}`,
    });
    const frame = await carrying.command("detach_instance", {
      instanceId: keyed.id, confirm: true,
    });
    assert.equal(frame.identityKeyCarried, fate === "carry_key");
  }
});

test("3D reset reports an untouched instance as a successful no-op", async () => {
  const harness = await loadPluginHarness();
  const main = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "No-op reset main", identityKey: "no-op-reset-main",
  });
  const instance = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: main.id,
  });
  const first = await harness.command("reset_instance_overrides", { instanceId: instance.id });
  assert.equal(first.success, true);
  assert.equal(first.outcome, "confirmed");
  assert.deepEqual(first.overridesBefore, []);
  assert.deepEqual(first.overridesAfter, []);
  assert.equal(first.changed, false);
  assert.equal(first.wrote, false);

  harness.getNode(instance.id).overrides = [{
    id: instance.id, overriddenFields: ["fills"],
  }];
  const changed = await harness.command("reset_instance_overrides", { instanceId: instance.id });
  assert.equal(changed.outcome, "confirmed");
  assert.equal(changed.changed, true);
  assert.equal(changed.wrote, true);
  assert.equal(changed.overridesBefore.length, 1);
  assert.deepEqual(changed.overridesAfter, []);
});

test("3D detach confirms both original-ID resolution branches", async () => {
  for (const [branch, resolves, type] of [
    [undefined, false, null], ["preserve_id", true, "FRAME"],
  ]) {
    const harness = await loadPluginHarness({ P11: branch });
    const main = await harness.command("create_or_match_component", {
      parentId: "1:1", name: `Detach ${branch || "new_id"}`,
      identityKey: `detach-${branch || "new_id"}`,
    });
    const instance = await harness.command("create_or_match_instance", {
      parentId: "1:1", componentId: main.id,
    });
    const detached = await harness.command("detach_instance", {
      instanceId: instance.id, confirm: true,
    });
    assert.equal(detached.outcome, "confirmed");
    assert.equal(detached.originalIdResolves, resolves);
    assert.equal(detached.originalIdType, type);
    assert.equal(detached.after.type, "FRAME");
  }
});

test("3D remote introductions and hidden detach cascades refuse before native calls", async () => {
  const harness = await loadPluginHarness();
  const component = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Remote main holder", identityKey: "remote-main-holder",
  });
  const instance = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: component.id,
  });
  harness.getNode("100:1").remote = true;
  const start = harness.componentNativeCalls.length;
  const swap = await harness.command("swap_instance_component", {
    instanceId: instance.id, componentId: "100:1",
  });
  assert.equal(swap.refusal.code, "remote_reference_refused");
  noNativeWrites(harness, start);

  harness.getNode(component.id).appendChild(harness.getNode(instance.id));
  const nestedStart = harness.componentNativeCalls.length;
  const detach = await harness.command("detach_instance", {
    instanceId: instance.id, confirm: true,
  });
  assert.equal(detach.refusal.code, "component_member_detach_refused");
  noNativeWrites(harness, nestedStart);

  const nestedHarness = await loadPluginHarness();
  const nestedMain = await nestedHarness.command("create_or_match_component", {
    parentId: "1:1", name: "Nested main", identityKey: "nested-main",
  });
  const outer = await nestedHarness.command("create_or_match_instance", {
    parentId: "1:1", componentId: nestedMain.id,
  });
  const inner = nestedHarness.getNode("100:1").createInstance();
  nestedHarness.getNode(outer.id).appendChild(inner);
  const beforeInnerDetach = nestedHarness.componentNativeCalls.length;
  const hiddenCascade = await nestedHarness.command("detach_instance", {
    instanceId: inner.id, confirm: true,
  });
  assert.equal(hiddenCascade.refusal.code, "nested_instance_detach_refused");
  noNativeWrites(nestedHarness, beforeInnerDetach);
});

test("3E native slots read back and reset instance content to the main slot", async () => {
  const harness = await loadPluginHarness();
  const component = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Slot main", identityKey: "slot-main",
  });
  const slot = await harness.command("create_slot", { componentId: component.id });
  assert.equal(slot.outcome, "confirmed");
  assert.match(slot.propertyKey, /^Slot#/);
  assert.equal(slot.slotAfter.propertyKey, slot.propertyKey);
  assert.equal(slot.slotAfter.componentPropertyReferences.slotContentId, slot.propertyKey);
  assert.equal(slot.slotAfter.componentPropertyReferencesStatus, "observed");
  assert.deepEqual(Object.keys(slot.definitionsAfter).filter((key) =>
    !Object.hasOwn(slot.definitionsBefore, key) &&
    slot.definitionsAfter[key].type === "SLOT"), [slot.propertyKey]);
  harness.getNode(slot.slotId).appendChild(harness.getNode("10:4"));
  const instance = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: component.id,
  });
  const instanceSlot = harness.getNode(instance.id).children.find((child) => child.type === "SLOT");
  assert.ok(instanceSlot);
  assert.equal(instanceSlot.children.length, 1);
  instanceSlot.children[0].remove();
  const reset = await harness.command("reset_slot", { slotId: instanceSlot.id });
  assert.equal(reset.outcome, "confirmed");
  assert.equal(reset.propertyKey, slot.propertyKey);
  assert.equal(reset.childCountBefore, 0);
  assert.equal(reset.childCountAfter, 1);
  assert.deepEqual(reset.limitViolationsAfter, []);
});

test("3E slot API absence, variant-member creation, and main-slot reset refuse before native calls", async () => {
  const missing = await loadPluginHarness({ P15: "unavailable" });
  const component = await missing.command("create_or_match_component", {
    parentId: "1:1", name: "No slots", identityKey: "no-slots",
  });
  const start = missing.componentNativeCalls.length;
  const unavailable = await missing.command("create_slot", { componentId: component.id });
  assert.equal(unavailable.refusal.code, "slots_unavailable");
  noNativeWrites(missing, start);

  const harness = await loadPluginHarness();
  const ids = await variantFixture(harness, "slot-variants");
  const set = await harness.command("combine_as_variants", {
    componentIds: ids, parentId: "1:1", identityKey: "slot-set",
  });
  const variantStart = harness.componentNativeCalls.length;
  const member = await harness.command("create_slot", { componentId: set.after.variants[0].id });
  assert.equal(member.refusal.code, "variant_member_slot_refused");
  noNativeWrites(harness, variantStart);
  const standalone = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Other slot", identityKey: "other-slot",
  });
  const slot = await harness.command("create_slot", { componentId: standalone.id });
  const mainStart = harness.componentNativeCalls.length;
  const mainReset = await harness.command("reset_slot", { slotId: slot.slotId });
  assert.equal(mainReset.refusal.code, "not_instance_slot");
  noNativeWrites(harness, mainStart);
});

test("3E a native reset that discards the request is unconfirmed", async () => {
  const harness = await loadPluginHarness({ P15: "reset_noop" });
  const component = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Noop reset", identityKey: "noop-reset",
  });
  const slot = await harness.command("create_slot", { componentId: component.id });
  harness.getNode(slot.slotId).appendChild(harness.getNode("10:4"));
  const instance = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: component.id,
  });
  const instanceSlot = harness.getNode(instance.id).children.find((child) => child.type === "SLOT");
  instanceSlot.children[0].remove();
  const reset = await harness.command("reset_slot", { slotId: instanceSlot.id });
  assert.equal(reset.outcome, "unconfirmed");
  assert.equal(reset.expectedChildCount, 1);
  assert.equal(reset.childCountAfter, 0);
});

test("3C and 3D invalid slot limits and instance-swap values refuse before every native write", async () => {
  const harness = await loadPluginHarness();
  const component = await harness.command("create_or_match_component", {
    parentId: "1:1", name: "Validation main", identityKey: "validation-main",
  });
  const slot = await harness.command("create_slot", { componentId: component.id });
  const swap = await harness.command("add_component_property", {
    nodeId: component.id, name: "Nested", type: "INSTANCE_SWAP", defaultValue: "100:1",
  });
  assert.equal(swap.outcome, "confirmed");
  const instance = await harness.command("create_or_match_instance", {
    parentId: "1:1", componentId: component.id,
  });
  const start = harness.componentNativeCalls.length;
  const limits = await harness.command("edit_component_property", {
    nodeId: component.id, propertyKey: slot.propertyKey,
    slotSettings: { minChildren: 3, maxChildren: 1 },
  });
  assert.equal(limits.refusal.code, "unsupported_property_operation");
  const invalidSwap = await harness.command("set_instance_properties", {
    instanceId: instance.id, properties: { [swap.propertyKey]: 42 },
  });
  assert.equal(invalidSwap.refusal.code, "invalid_property_value");
  noNativeWrites(harness, start);
});
