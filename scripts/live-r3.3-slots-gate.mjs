#!/usr/bin/env node

// G2 measures Figma's native SLOT surface. An unavailable slot API is an open
// claim and a failed gate, not an emulated success.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseGateOptions, requireDisposableTarget } from "./r3.1-live-gate-lib.mjs";
import {
  assertR33SlotStableFindings, classifyR33SlotCreateFrameVerdict,
  classifyR33SlotSetParentVerdict,
  KNOWN_G2_STABLE_TOOL_FINDINGS as KNOWN_STABLE_TOOL_FINDINGS,
  runR33Gate,
} from "./r3.3-live-gate-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseGateOptions();
requireDisposableTarget(options,
  "Usage: node scripts/live-r3.3-slots-gate.mjs --channel=<DEV-plugin-channel> --disposable-target=true [--output-dir=<dir>] [--server=<dist-server-path>]",
  "G2 creates and resets native slots on scratch components and instances.");
if (options["allow-permanent"] !== undefined) {
  process.stderr.write("Refusing to run: R3.3 has no permanent-residue mode.\n");
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

function firstSlot(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "SLOT") return node;
  for (const child of node.children || []) {
    const found = firstSlot(child);
    if (found) return found;
  }
  return null;
}

function namedSlotChild(slot, name) {
  const matches = (slot.children || []).filter((child) => child.name === name);
  assert.equal(matches.length, 1, `SLOT must have exactly one child named ${name}`);
  return matches[0];
}

function createdId(text) {
  const match = /with (?:new )?ID:\s*([^\s.]+)/.exec(text);
  assert.ok(match, `create_frame returned no parseable ID: ${text}`);
  return match[1];
}

async function lookupReplyId(call, id) {
  try {
    const node = await call("get_node_info", { nodeId: id });
    return { resolves: true, id: node.id, name: node.name, type: node.type };
  } catch (error) {
    if (!/Node not found with ID:/.test(error.message)) throw error;
    return { resolves: false, error: error.message };
  }
}

await runR33Gate({
  root, options, expectedRuntime, name: "R3.3 G2 native slots",
  requiredCommands: [
    "get_component", "get_node_info", "create_or_match_component",
    "create_or_match_instance", "create_frame", "create_rectangle", "set_parent",
    "create_slot", "reset_slot", "edit_component_property",
    "set_instance_properties",
  ],
  scenario: async ({ gate, call, create, expectRefusal, nodeId, record, stamp, pageId }) => {
    const component = await create("create_or_match_component", {
      parentId: pageId, name: `__R3.3 slot control ${stamp}`,
      identityKey: `r3.3/g2/${stamp}/component`,
    }, "components");
    assert.equal(component.outcome, "confirmed");
    const slot = await call("create_slot", { componentId: component.id });
    if (slot.refusal?.code === "slots_unavailable") {
      record.premises.P15 = { status: "unmeasured", reason: "runtime has no native slot API" };
      record.unmeasured.push("P15 native slot API is unavailable on this Figma runtime");
      return;
    }
    assert.equal(slot.outcome, "confirmed");
    assert.ok(slot.slotId && slot.propertyKey);
    const newSlotKeys = Object.entries(slot.definitionsAfter || {})
      .filter(([key, definition]) =>
        !Object.hasOwn(slot.definitionsBefore || {}, key) && definition?.type === "SLOT")
      .map(([key]) => key);
    assert.deepEqual(newSlotKeys, [slot.propertyKey],
      "create_slot propertyKey did not name its one new SLOT definition");
    const mainSlot = await call("get_component", { nodeId: slot.slotId });
    assert.equal(mainSlot.component.propertyKey, slot.propertyKey);
    assert.equal((await call("get_component", { nodeId: component.id }))
      .component.componentPropertyDefinitions[slot.propertyKey].type, "SLOT");
    const mainChildId = await nodeId("create_frame", {
      parentId: slot.slotId, name: "G2 original content",
      x: 0, y: 0, width: 40, height: 40,
    });
    record.checks.mainSlot = { slotId: slot.slotId, propertyKey: slot.propertyKey,
      mainChildId };

    const instance = await create("create_or_match_instance", {
      parentId: pageId, componentId: component.id,
      identityKey: `r3.3/g2/${stamp}/instance`,
    }, "instances");
    assert.equal(instance.outcome, "confirmed");
    const rendered = await call("get_node_info", { nodeId: instance.id });
    const instanceSlot = firstSlot(rendered);
    if (!instanceSlot) {
      record.premises.P15 = { status: "unmeasured", reason: "get_node_info did not expose SLOT" };
      record.unmeasured.push("P15 instance SLOT ID is unreadable through get_node_info");
      return;
    }
    const slotBefore = await call("get_component", { nodeId: instanceSlot.id });
    assert.equal(slotBefore.component.childCount, 1);
    await expectRefusal("set_instance_properties", {
      instanceId: instance.id,
      properties: { [slot.propertyKey]: slot.slotId },
    }, "slot_property_not_settable");

    const looseId = await nodeId("create_rectangle", {
      parentId: pageId, name: "G2 move control",
      x: 200, y: 0, width: 20, height: 20,
    });
    const setParentReply = await gate.call("set_parent", {
      nodeId: looseId, parentId: instanceSlot.id,
    });
    const moved = await call("get_node_info", { nodeId: instanceSlot.id });
    const movedChild = namedSlotChild(moved, "G2 move control");
    const movedOriginalIdLookup = await lookupReplyId(call, looseId);
    const createFrameReply = await gate.call("create_frame", {
      parentId: instanceSlot.id, name: "G2 inserted content",
      x: 0, y: 0, width: 15, height: 15,
    });
    const addedId = createdId(createFrameReply.text);
    const afterInsert = await call("get_component", { nodeId: instanceSlot.id });
    assert.equal(afterInsert.component.childCount, 3);
    const insertedTree = await call("get_node_info", { nodeId: instanceSlot.id });
    assert.equal(insertedTree.children?.length, 3,
      "get_node_info did not confirm the inserted slot child count");
    const insertedChild = namedSlotChild(insertedTree, "G2 inserted content");
    assert.equal(namedSlotChild(insertedTree, "G2 move control").id, movedChild.id,
      "moved SLOT child changed ID between independent reads");
    const createdReplyIdLookup = await lookupReplyId(call, addedId);
    const stableToolFindings = {
      set_parent: classifyR33SlotSetParentVerdict({
        originalId: looseId, canonicalId: movedChild.id,
        replyText: setParentReply.text, originalIdLookup: movedOriginalIdLookup,
      }),
      create_frame: classifyR33SlotCreateFrameVerdict({
        replyId: addedId, canonicalId: insertedChild.id,
        replyIdLookup: createdReplyIdLookup,
      }),
    };
    record.checks.stableToolFindings = {
      expected: KNOWN_STABLE_TOOL_FINDINGS,
      actual: stableToolFindings,
      replies: { set_parent: setParentReply.text, create_frame: createFrameReply.text },
      replyIdLookups: { movedOriginalId: movedOriginalIdLookup,
        createdReplyId: createdReplyIdLookup },
    };
    record.premises.P22 = { status: "measured", instanceSlotId: instanceSlot.id,
      moved: { originalId: looseId, slotId: movedChild.id },
      created: { replyId: addedId, slotId: insertedChild.id },
      movedOriginalIdLookup, createdReplyIdLookup };
    assertR33SlotStableFindings(stableToolFindings);
    for (const [tool, verdict] of Object.entries(stableToolFindings)) {
      record.findings.push(`${tool}: ${verdict}`);
    }

    const settings = await call("edit_component_property", {
      nodeId: component.id, propertyKey: slot.propertyKey,
      slotSettings: { minChildren: 1, maxChildren: 1 },
    });
    assert.equal(settings.outcome, "confirmed");
    const overLimit = await call("get_component", { nodeId: instanceSlot.id });
    assert.ok(overLimit.component.limitViolations.includes("ABOVE_MAX"),
      "slotSettings max did not change native limitViolations");
    const reset = await call("reset_slot", { slotId: instanceSlot.id });
    assert.equal(reset.outcome, "confirmed");
    const afterReset = await call("get_component", { nodeId: instanceSlot.id });
    assert.equal(afterReset.component.childCount, 1);
    assert.deepEqual(afterReset.component.limitViolations, []);
    const resetTree = await call("get_node_info", { nodeId: instanceSlot.id });
    assert.equal(resetTree.children?.length, 1,
      "get_node_info did not confirm the reset slot child count");
    assert.equal(resetTree.children[0].name, "G2 original content");
    assert.ok(!resetTree.children.some(({ name }) =>
      name === "G2 inserted content" || name === "G2 move control"));
    record.premises.P15 = {
      status: "measured",
      propertyKey: slot.propertyKey,
      instanceSlotId: instanceSlot.id,
      movedNodeId: movedChild.id,
      createdNodeId: insertedChild.id,
      violationsBeforeReset: overLimit.component.limitViolations,
      violationsAfterReset: afterReset.component.limitViolations,
      resetChildCount: reset.childCountAfter,
      insertedChildCountFromNodeInfo: insertedTree.children.length,
      resetChildCountFromNodeInfo: resetTree.children.length,
    };
  },
});
