import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const TEXT_FIELDS = ["fontName", "fontSize", "lineHeight", "letterSpacing",
  "paragraphSpacing", "paragraphIndent", "textCase", "textDecoration"];

async function styleReply({ styleId, field, value, nodeId, kind }) {
  const harness = await loadPluginHarness();
  const node = harness.getNode(nodeId);
  node[kind] = styleId;
  Object.defineProperty(harness.getStyle(styleId), field, { configurable: true,
    get: () => value });
  const messages = await harness.executeCommand("get_node_variables", { nodeId });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "command-result", messages[0].error);
  const record = messages[0].result.styles.find((item) => item.styleId === styleId);
  assert.ok(record);
  return { harness, record, result: messages[0].result };
}

for (const field of TEXT_FIELDS) {
  test(`TEXT field ${field} names a synthetic Symbol without mutating Figma's value`, async () => {
    const token = Symbol(`synthetic-${field}`);
    const { record, result } = await styleReply({ styleId: "style-text-1", field,
      value: token, nodeId: "10:2", kind: "textStyleId" });
    assert.equal(record.value[field], null);
    assert.deepEqual(record.unreadableFields, [{ path: field, reason: "symbol",
      description: `synthetic-${field}` }]);
    assert.equal(record.valueStatus, "partial");
    assert.equal(record.resolutionStatus, "resolved");
    assert.equal(result.complete, true, "partial value must not change coverage completeness");
    assert.match(result.limitations.join(" "), /1 resolved style references.*partial/);
  });
}

test("nested and array Symbols are named in copied PAINT, TEXT, EFFECT and GRID values", async () => {
  const cases = [
    { styleId: "style-text-1", field: "fontName", kind: "textStyleId", nodeId: "10:2",
      value: Object.freeze({ family: Symbol("nested"), style: "Regular" }), path: "fontName.family" },
    { styleId: "style-paint-1", field: "paints", kind: "fillStyleId", nodeId: "10:2",
      value: Object.freeze([Object.freeze({ color: Symbol("array") })]), path: "paints[0].color" },
    { styleId: "style-effect-1", field: "effects", kind: "effectStyleId", nodeId: "10:1",
      value: Object.freeze([Object.freeze({ metadata: Object.freeze({ leaf: Symbol("nested") }) })]),
      path: "effects[0].metadata.leaf" },
    { styleId: "style-grid-1", field: "layoutGrids", kind: "gridStyleId", nodeId: "10:1",
      value: Object.freeze([Object.freeze({ color: Symbol("array") })]), path: "layoutGrids[0].color" },
  ];
  for (const item of cases) {
    const { record } = await styleReply(item);
    assert.equal(record.valueStatus, "partial");
    assert.deepEqual(record.unreadableFields, [{ path: item.path, reason: "symbol",
      description: item.value[0]?.color?.description ||
        item.value[0]?.metadata?.leaf?.description || item.value.family?.description }]);
  }
});

test("array branch roots and root variable values retain the empty-path grammar", async () => {
  for (const [styleId, field, nodeId, kind] of [
    ["style-paint-1", "paints", "10:2", "fillStyleId"],
    ["style-effect-1", "effects", "10:1", "effectStyleId"],
    ["style-grid-1", "layoutGrids", "10:1", "gridStyleId"],
  ]) {
    const { record } = await styleReply({ styleId, field, nodeId, kind,
      value: Symbol("branch-root") });
    assert.deepEqual(record.unreadableFields, [{ path: field, reason: "symbol",
      description: "branch-root" }]);
    assert.equal(record.value[field], null);
  }
  const harness = await loadPluginHarness();
  const preview = harness.globals("serializePreviewVariableValue")(Symbol("root"));
  assert.deepEqual(JSON.parse(JSON.stringify(preview.unreadableFields)), [{ path: "", reason: "symbol",
    description: "root" }]);
  assert.equal(preview.value, null);
});

test("figma.mixed and a Symbol without description use the required reason and null description", async () => {
  const harness = await loadPluginHarness();
  const style = harness.getStyle("style-text-1");
  harness.getNode("10:2").textStyleId = style.id;
  Object.defineProperty(style, "fontName", { configurable: true,
    get: () => Object.freeze({ family: harness.mixed, style: Symbol() }) });
  const [message] = await harness.executeCommand("get_node_variables", { nodeId: "10:2" });
  const record = message.result.styles.find((item) => item.styleId === style.id);
  assert.deepEqual(record.unreadableFields, [
    { path: "fontName.family", reason: "figma_mixed", description: "figma.mixed" },
    { path: "fontName.style", reason: "symbol", description: null },
  ]);
  assert.deepEqual(record.value.fontName, { family: null, style: null });
});

test("clean style reads include an empty list; no-value statuses keep their prior shape", async () => {
  const harness = await loadPluginHarness();
  harness.getNode("10:2").textStyleId = "style-text-1";
  let result = await harness.command("get_node_variables", { nodeId: "10:2" });
  assert.deepEqual(result.styles.find((item) => item.property === "textStyleId").unreadableFields, []);
  harness.getNode("10:2").textStyleId = harness.mixed;
  result = await harness.command("get_node_variables", { nodeId: "10:2" });
  const mixed = result.styles.find((item) => item.property === "textStyleId");
  assert.equal(mixed.valueStatus, "not_applicable");
  assert.equal(Object.hasOwn(mixed, "unreadableFields"), false);

  harness.getNode("10:2").textStyleId = "style-text-1";
  const style = harness.getStyle("style-text-1");
  style.type = "UNKNOWN";
  result = await harness.command("get_node_variables", { nodeId: "10:2" });
  const unsupported = result.styles.find((item) => item.property === "textStyleId");
  assert.equal(unsupported.valueStatus, "unsupported_style_type");
  assert.equal(Object.hasOwn(unsupported, "unreadableFields"), false);
  style.type = "TEXT";
  Object.defineProperty(style, "fontName", { configurable: true,
    get: () => { throw new Error("unreadable"); } });
  result = await harness.command("get_node_variables", { nodeId: "10:2" });
  const failed = result.styles.find((item) => item.property === "textStyleId");
  assert.equal(failed.valueStatus, "read_failed");
  assert.equal(Object.hasOwn(failed, "unreadableFields"), false);
});

test("preview binding and document variable values name Symbols with their own path roots", async () => {
  const harness = await loadPluginHarness();
  const variable = harness.getVariable("var-space");
  variable.resolveForConsumer = () => ({ value: Object.freeze({ nested: [harness.mixed] }),
    resolvedType: "FLOAT" });
  const bindingReply = await harness.executeCommand("get_node_variables", { nodeId: "10:2" });
  const binding = bindingReply[0].result.bindings.find((item) => item.variableId === variable.id);
  assert.equal(binding.valueStatus, "partial");
  assert.deepEqual(binding.unreadableFields, [{ path: "nested[0]",
    reason: "figma_mixed", description: "figma.mixed" }]);
  assert.equal(binding.value.nested[0], null);

  variable.valuesByMode["mode-light"] = Object.freeze({ nested: [Symbol("raw")] });
  const variableReply = await harness.executeCommand("get_variables", { types: ["FLOAT"] });
  assert.equal(variableReply.at(-1).type, "command-result");
  const collection = variableReply.at(-1).result.collections.find((item) =>
    item.id === variable.variableCollectionId);
  const mode = collection.modes.find((item) => item.id === "mode-light");
  const record = mode.variables.find((item) => item.id === variable.id);
  assert.equal(record.valueStatus, "partial");
  assert.deepEqual(record.unreadableFields, [
    { path: "value.nested[0]", reason: "symbol", description: "raw" },
    { path: "resolvedValue.nested[0]", reason: "symbol", description: "raw" },
  ]);
  assert.equal(record.value.nested[0], null);
  assert.equal(record.resolvedValue.nested[0], null);
});

test("a root Symbol uses value and resolvedValue without a trailing separator", async () => {
  const harness = await loadPluginHarness();
  const variable = harness.getVariable("var-space");
  variable.valuesByMode["mode-light"] = Symbol("root");
  const reply = await harness.command("get_variables", { types: ["FLOAT"] });
  const record = reply.collections.flatMap((collection) => collection.modes)
    .find((mode) => mode.id === "mode-light").variables.find((item) => item.id === variable.id);
  assert.equal(record.valueStatus, "partial");
  assert.deepEqual(record.unreadableFields.map((entry) => entry.path),
    ["value", "resolvedValue"]);
  assert.equal(record.value, null);
  assert.equal(record.resolvedValue, null);
});

test("partial color values retain addressable structure while clean colors stay hex", async () => {
  const harness = await loadPluginHarness();
  const variable = harness.getVariable("var-primary");
  variable.valuesByMode["mode-light"] = Object.freeze({
    r: 0.1, g: 0.2, b: 0.3, a: Symbol("synthetic-color"),
  });
  variable.resolveForConsumer = () => ({ value: variable.valuesByMode["mode-light"],
    resolvedType: "COLOR" });
  const binding = (await harness.command("get_node_variables", { nodeId: "10:2" }))
    .bindings.find((item) => item.variableId === variable.id);
  assert.equal(binding.valueStatus, "partial");
  assert.equal(binding.value.a, null);
  assert.deepEqual(binding.unreadableFields.map((entry) => entry.path), ["a"]);

  const reply = await harness.command("get_variables", { types: ["COLOR"] });
  const modes = reply.collections.flatMap((collection) => collection.modes);
  const partial = modes.find((mode) => mode.id === "mode-light")
    .variables.find((item) => item.id === variable.id);
  const clean = modes.find((mode) => mode.id === "mode-dark")
    .variables.find((item) => item.id === variable.id);
  assert.deepEqual(partial.unreadableFields.map((entry) => entry.path),
    ["value.a", "resolvedValue.a"]);
  assert.equal(partial.value.a, null);
  assert.equal(partial.resolvedValue.a, null);
  assert.equal(clean.valueStatus, "resolved");
  assert.match(clean.value, /^#[0-9a-f]+$/);
});

test("clean preview values carry empty lists and placeholder-only values keep their shape", async () => {
  const harness = await loadPluginHarness();
  const cleanBinding = (await harness.command("get_node_variables", { nodeId: "10:2" }))
    .bindings.find((entry) => entry.variableId === "var-space");
  assert.equal(cleanBinding.valueStatus, "resolved");
  assert.deepEqual(cleanBinding.unreadableFields, []);
  const variable = harness.getVariable("var-space");
  delete variable.valuesByMode["mode-light"];
  const reply = await harness.command("get_variables", { types: ["FLOAT"] });
  const record = reply.collections.flatMap((collection) => collection.modes)
    .find((mode) => mode.id === "mode-light").variables.find((item) => item.id === variable.id);
  assert.equal(record.value, null);
  assert.equal(record.resolvedValue, null);
  assert.equal(record.resolutionStatus, "missing_mode_value");
  assert.equal(Object.hasOwn(record, "unreadableFields"), false);
  assert.equal(Object.hasOwn(record, "valueStatus"), false);
});

test("stable variable write readback retains the shared serializer's original shape", async () => {
  const harness = await loadPluginHarness();
  const original = harness.globals("readVariableValueForWrite")({
    valuesByMode: { synthetic: Symbol("stable") },
  }, "synthetic");
  assert.equal(Object.keys(original).join(","), "value,readable");
  assert.equal(typeof original.value, "symbol");
  assert.equal(original.readable, true);
});

test("execute-command boundary names Symbol paths, caps at ten, and keeps handler errors", async () => {
  const harness = await loadPluginHarness();
  harness.getNode("1:1").name = Symbol("page-name");
  const [reply] = await harness.executeCommand("get_pages");
  assert.equal(reply.type, "command-error");
  assert.match(reply.error, /^unserializable_result: get_pages returned a Symbol at pages\[0\]\.name/);
  assert.doesNotMatch(reply.error, /^in postMessage:/);

  harness.figma.root.children.push(...Array.from({ length: 10 }, (_, index) => ({
    id: `synthetic:${index}`, name: Symbol(`page-${index}`),
  })));
  const [bounded] = await harness.executeCommand("get_pages");
  assert.match(bounded.error, /scan stopped at ten/);
  assert.equal((bounded.error.match(/pages\[/g) || []).length, 10);
  harness.figma.root.children.splice(-10);

  const paths = harness.globals("findSymbolPaths");
  const cyclic = { items: Array.from({ length: 12 }, (_, index) => Symbol(String(index))) };
  cyclic.self = cyclic;
  assert.equal(paths(cyclic, 10).length, 10);
  const originalPost = harness.figma.ui.postMessage;
  harness.figma.ui.postMessage = (message) => {
    if (message.type === "command-result") throw new Error("platform said no");
    return originalPost(message);
  };
  harness.getNode("1:1").name = "Page One";
  const [fallback] = await harness.executeCommand("get_pages");
  assert.equal(fallback.error, "platform said no");
  harness.figma.ui.postMessage = originalPost;
  const [handler] = await harness.executeCommand("get_node_variables", { nodeId: "absent" });
  assert.equal(handler.type, "command-error");
  assert.doesNotMatch(handler.error, /^unserializable_result:/);
});

for (const [label, rejection, type, text] of [
  ["Error", new Error("native refused"), "Error", "native refused"],
  ["string", "native refused", "string", "native refused"],
  ["undefined", undefined, "undefined", "undefined"],
  ["object", Object.freeze({ code: 7 }), "object", "[object Object]"],
]) {
  test(`SVG rejection by ${label} retains one prefix, type, text, and format`, async () => {
    const harness = await loadPluginHarness();
    const formats = [];
    harness.getNode("10:4").exportAsync = async (settings) => {
      formats.push(settings.format);
      throw rejection;
    };
    const [reply] = await harness.executeCommand("export_node_as_image", {
      nodeId: "10:4", format: "SVG",
    });
    assert.equal(reply.type, "command-error");
    assert.equal((reply.error.match(/Error exporting node as image:/g) || []).length, 1);
    assert.match(reply.error, new RegExp(`\\[${type}\\]`));
    assert.ok(reply.error.includes(text));
    assert.deepEqual(formats, ["SVG"]);
  });
}
