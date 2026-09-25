import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const TEXT_STYLE_ID = "S:e110db4477207b611c09f5f83abec201ea9858cb,16497:2209";
const TYPED_FIELDS = {
  fontSize: "number",
  lineHeight: "object",
  letterSpacing: "object",
  paragraphSpacing: "number",
  paragraphIndent: "number",
  textCase: "string",
  textDecoration: "string",
};

function postedResult(messages) {
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "command-result", messages[0].error);
  return messages[0].result;
}

function textStyleRecord(reply, nodeId) {
  const record = reply.styles.find((style) =>
    style.property === "textStyleId" && style.styleId === TEXT_STYLE_ID &&
    style.nodeId === nodeId);
  assert.ok(record, "P23 remote TEXT style record must be present");
  return record;
}

function assertPartialLimitation(reply) {
  const partialCount = reply.styles.filter((style) =>
    style.resolutionStatus === "resolved" && style.valueStatus !== "resolved").length;
  const limitation = reply.limitations.find((item) =>
    /^\d+ resolved style references/.test(item));
  assert.ok(limitation, "partial style count must appear in limitations");
  assert.equal(Number(/^\d+/.exec(limitation)[0]), partialCount);
  assert.match(limitation, /partial/);
}

test("P23 remote TEXT style posts a named partial record from a TEXT node and its INSTANCE", async () => {
  const harness = await loadPluginHarness();
  const instance = harness.getNode("60:3");
  const textNode = harness.getNode("10:2");
  instance.appendChild(textNode);
  textNode.textStyleId = TEXT_STYLE_ID;
  textNode.fillStyleId = "";

  // G5 observed this Symbol and these seven other field types on the remote style.
  const remoteStyle = {
    id: TEXT_STYLE_ID,
    name: "P23 remote TEXT",
    type: "TEXT",
    remote: true,
    fontName: harness.mixed,
    fontSize: 16,
    lineHeight: { unit: "PIXELS", value: 24 },
    letterSpacing: { unit: "PIXELS", value: 0 },
    paragraphSpacing: 0,
    paragraphIndent: 0,
    textCase: "ORIGINAL",
    textDecoration: "NONE",
  };
  const originalLookup = harness.figma.getStyleByIdAsync;
  harness.figma.getStyleByIdAsync = async (id) =>
    id === TEXT_STYLE_ID ? remoteStyle : originalLookup(id);

  assert.equal(textNode.type, "TEXT");
  assert.equal(textNode.parent, instance);
  assert.equal(instance.type, "INSTANCE");

  const textReply = postedResult(await harness.executeCommand("get_node_variables", {
    nodeId: textNode.id,
  }));
  const record = textStyleRecord(textReply, textNode.id);
  assert.equal(record.styleType, "TEXT");
  assert.equal(record.remote, true);
  assert.equal(record.valueStatus, "partial");
  assert.equal(record.resolutionStatus, "resolved");
  assert.equal(record.value.fontName, null);
  assert.deepEqual(record.unreadableFields, [{
    path: "fontName", reason: "figma_mixed", description: "figma.mixed",
  }]);
  for (const [field, type] of Object.entries(TYPED_FIELDS)) {
    assert.ok(Object.hasOwn(record.value, field), `${field} must be present`);
    assert.equal(typeof record.value[field], type, `${field} must be a ${type}`);
    assert.notEqual(record.value[field], null, `${field} must be readable`);
    if (type === "object") assert.equal(Array.isArray(record.value[field]), false);
  }
  assertPartialLimitation(textReply);

  const instanceReply = postedResult(await harness.executeCommand("get_node_variables", {
    nodeId: instance.id,
  }));
  assert.deepEqual(textStyleRecord(instanceReply, textNode.id), record);
  assertPartialLimitation(instanceReply);
});
