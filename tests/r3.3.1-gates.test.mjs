import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classifyR331RemoteTextStyleVerdict, classifyR331ReactionsVerdict,
  classifyR331SvgExportVerdict } from "../scripts/r3.3.1-live-gate-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fields = {
  fontName: { family: "Inter", style: "Regular" }, fontSize: 16,
  lineHeight: { unit: "PIXELS", value: 20 }, letterSpacing: { unit: "PIXELS", value: 1 },
  paragraphSpacing: 0, paragraphIndent: 0, textCase: "ORIGINAL", textDecoration: "NONE",
};
const cleanText = { property: "textStyleId", styleId: "remote-text-control", styleType: "TEXT",
  remote: true, resolutionStatus: "resolved", valueStatus: "resolved",
  value: fields, unreadableFields: [] };
const cleanPaint = (property) => ({ property, styleType: "PAINT", remote: true,
  resolutionStatus: "resolved", valueStatus: "resolved", value: { paints: [] },
  unreadableFields: [] });
const cleanEffect = { property: "effectStyleId", styleType: "EFFECT", remote: true,
  resolutionStatus: "resolved", valueStatus: "resolved", value: { effects: [] },
  unreadableFields: [] };

function g5(field = "fontSize") {
  const targetStyle = { ...cleanText, styleId: "remote-target", valueStatus: "partial",
    value: { ...fields, [field]: null },
    unreadableFields: [{ path: field, reason: "symbol", description: "synthetic" }] };
  return {
    attachment: { value: { success: true, attachment: {
      origin: "remote", styleId: "remote-target" } } },
    target: { value: { styles: [targetStyle], limitations: [
      "1 resolved style references carry an incomplete value; partial is named."] } },
    container: { value: { styles: [targetStyle, cleanPaint("strokeStyleId"), cleanEffect] } },
    textControl: { value: { styles: [cleanText] } },
    paintControl: { value: { styles: [cleanPaint("fillStyleId"),
      cleanPaint("strokeStyleId")] } },
    hasContainer: true,
  };
}

test("G5 accepts a named synthetic gap at every TEXT field without assuming a live field", () => {
  for (const field of Object.keys(fields)) {
    const verdict = classifyR331RemoteTextStyleVerdict(g5(field));
    assert.equal(verdict.success, true, `${field}: ${verdict.findings}`);
    assert.equal(verdict.premises.P23[0].path, field);
  }
});

test("G5 accepts a named nested gap and rejects each known-bad leg", () => {
  const nested = g5("fontName");
  nested.target.value.styles[0] = { ...nested.target.value.styles[0],
    value: { ...fields, fontName: { family: null, style: "Regular" } },
    unreadableFields: [{ path: "fontName.family", reason: "figma_mixed", description: null }] };
  nested.container.value.styles[0] = nested.target.value.styles[0];
  assert.equal(classifyR331RemoteTextStyleVerdict(nested).success, true);

  const unnamed = g5();
  unnamed.target.value.styles[0].value.paragraphSpacing = null;
  assert.equal(classifyR331RemoteTextStyleVerdict(unnamed).success, false);
  assert.match(classifyR331RemoteTextStyleVerdict(unnamed).findings.join(" "), /unnamed/);

  const absent = g5();
  absent.target.value.styles[0] = { ...cleanText, styleId: "remote-target" };
  absent.container.value.styles[0] = absent.target.value.styles[0];
  const absentVerdict = classifyR331RemoteTextStyleVerdict(absent);
  assert.equal(absentVerdict.unmeasured.length, 1);
  assert.deepEqual(absentVerdict.findings, []);

  const badControl = g5();
  badControl.textControl.value.styles[0] = { ...cleanText, valueStatus: "partial",
    unreadableFields: [{ path: "fontSize", reason: "symbol", description: null }] };
  assert.equal(classifyR331RemoteTextStyleVerdict(badControl).success, false);
  assert.match(classifyR331RemoteTextStyleVerdict(badControl).findings.join(" "), /control/);
});

test("G5 refuses missing observation, crashes, mismatches, invalid entries and limitation drift", () => {
  const nonremote = g5();
  nonremote.attachment.value.attachment.origin = "local";
  assert.equal(classifyR331RemoteTextStyleVerdict(nonremote).unmeasured.length, 1);
  for (const error of ["in postMessage: Cannot unwrap symbol",
    "unserializable_result: get_node_variables returned a Symbol at styles[0].value"]) {
    const crash = g5();
    crash.target = { error };
    assert.equal(classifyR331RemoteTextStyleVerdict(crash).success, false);
    assert.match(classifyR331RemoteTextStyleVerdict(crash).findings[0], /Target read failed/);
  }
  const mismatch = g5();
  mismatch.target.value.styles[0].styleId = "other";
  assert.equal(classifyR331RemoteTextStyleVerdict(mismatch).success, false);
  const invalid = g5();
  invalid.target.value.styles[0].unreadableFields[0].reason = "unknown";
  assert.equal(classifyR331RemoteTextStyleVerdict(invalid).success, false);
  const badLimit = g5();
  badLimit.target.value.limitations = [];
  assert.equal(classifyR331RemoteTextStyleVerdict(badLimit).success, false);
  const badContainer = g5();
  badContainer.container.value.styles = [];
  assert.equal(classifyR331RemoteTextStyleVerdict(badContainer).success, false);
  const changedContainerValue = g5();
  changedContainerValue.container.value.styles[0] = {
    ...changedContainerValue.container.value.styles[0], value: { ...fields, fontSize: 99 },
  };
  assert.equal(classifyR331RemoteTextStyleVerdict(changedContainerValue).success, false);
  const badPaint = g5();
  badPaint.paintControl.value.styles[0].valueStatus = "partial";
  assert.equal(classifyR331RemoteTextStyleVerdict(badPaint).success, false);
});

const urlRow = { nodeId: "link", trigger: { type: "ON_CLICK" },
  actions: [{ type: "URL", url: "https://example.test/", destinationId: null }] };
const navRow = { nodeId: "nav", trigger: { type: "ON_CLICK" },
  actions: [{ type: "NAVIGATE", destinationId: "destination", navigation: "NAVIGATE" }] };
function g6(rows = [urlRow, navRow]) {
  const response = (row) => ({ value: { scope: "requested_node_subtrees", complete: true,
    nodesWithReactions: 1, nodes: [{ id: row.nodeId, name: row.nodeId, type: "FRAME",
      reactions: [{ trigger: structuredClone(row.trigger), actions: structuredClone(row.actions) }] }] } });
  return { fixtureRows: rows, observations: Object.fromEntries(rows.map((row) =>
    [row.nodeId, response(row)])), control: { value: { complete: true, nodesWithReactions: 0, nodes: [] } },
    destinations: { destination: { value: { id: "destination", name: "Target", type: "FRAME" } } } };
}

test("G6 matches URL and node destinations and records the final observed shape", () => {
  const verdict = classifyR331ReactionsVerdict(g6());
  assert.equal(verdict.success, true);
  assert.deepEqual(verdict.premises.destinations, [{ id: "destination", name: "Target", type: "FRAME" }]);
  assert.ok(verdict.premises.observedShape.topLevelKeys.includes("nodes"));
  assert.ok(verdict.premises.observedShape.nodeKeys.includes("reactions"));
});

test("G6 treats absent or empty owner fixture as unmeasured", () => {
  for (const fixtureRows of [null, []]) {
    const verdict = classifyR331ReactionsVerdict({ ...g6(), fixtureRows });
    assert.equal(verdict.success, false);
    assert.equal(verdict.unmeasured.length, 1);
  }
  const malformed = classifyR331ReactionsVerdict({ ...g6(), fixtureRows: [{ nodeId: "link" }] });
  assert.equal(malformed.unmeasured.length, 1);
});

test("G6 rejects wrong action fields, missing node, unresolved destination and nonempty control", () => {
  const badUrl = g6();
  badUrl.observations.link.value.nodes[0].reactions[0].actions[0].url = "https://wrong.test/";
  assert.equal(classifyR331ReactionsVerdict(badUrl).success, false);
  const missing = g6();
  missing.observations.link.value.nodes = [];
  assert.equal(classifyR331ReactionsVerdict(missing).success, false);
  const unresolved = g6();
  unresolved.destinations.destination = { error: "not found" };
  assert.equal(classifyR331ReactionsVerdict(unresolved).success, false);
  const nonempty = g6();
  nonempty.control.value.nodesWithReactions = 1;
  assert.equal(classifyR331ReactionsVerdict(nonempty).success, false);
  const incomplete = g6();
  incomplete.observations.link.value.complete = false;
  assert.equal(classifyR331ReactionsVerdict(incomplete).success, false);
});

test("G1 SVG row accepts SVG bytes or one Figma rejection and kills known-bad texts", () => {
  assert.equal(classifyR331SvgExportVerdict({ pngSucceeded: true,
    svgReceipt: { mimeType: "image/svg+xml", format: "SVG" } }).success, true);
  assert.equal(classifyR331SvgExportVerdict({ pngSucceeded: true,
    svgError: "Error exporting node as image: [Error] Figma refused" }).success, true);
  assert.equal(classifyR331SvgExportVerdict({ pngSucceeded: true,
    svgError: "Error exporting node as image: [Error] Figma says undefined surface" }).success, true);
  for (const svgError of ["Error exporting node as image: undefined",
    "Error exporting node as image: [undefined] undefined [runtime: compatible]",
    "Error exporting node as image: Error exporting node as image: [Error] Figma refused",
    "Figma refused"]) {
    assert.equal(classifyR331SvgExportVerdict({ pngSucceeded: true, svgError }).success, false);
  }
  assert.equal(classifyR331SvgExportVerdict({ pngSucceeded: true,
    svgReceipt: { mimeType: "image/svg+xml", format: "SVG" }, pngBytes: true }).success, false);
  assert.equal(classifyR331SvgExportVerdict({ pngSucceeded: false,
    svgReceipt: { mimeType: "image/svg+xml", format: "SVG" } }).success, false);
});

test("G5 and G6 scripts contain only static read-tool calls and require offline-refusable arguments", async () => {
  const scripts = [
    ["live-r3.3.1-remote-text-style-gate.mjs", ["get_node_style_attachment", "get_node_variables"]],
    ["live-r3.3.1-reactions-gate.mjs", ["get_reactions", "get_node_info"]],
  ];
  for (const [file, allowed] of scripts) {
    const source = await readFile(path.join(root, "scripts", file), "utf8");
    const calls = [...source.matchAll(/\bread\("([^"]+)"/g)].map((match) => match[1]);
    assert.ok(calls.length > 0);
    assert.ok(calls.every((tool) => allowed.includes(tool)), `${file}: ${calls}`);
    assert.doesNotMatch(source, /runR33Gate|gate\.call\(/);
    assert.match(source, /requireDisposableTarget\(options/);
    const absent = spawnSync(process.execPath, [path.join(root, "scripts", file)],
      { cwd: root, encoding: "utf8" });
    assert.equal(absent.status, 2);
    const missing = spawnSync(process.execPath, [path.join(root, "scripts", file),
      "--channel=offline", "--disposable-target=true"], { cwd: root, encoding: "utf8" });
    assert.equal(missing.status, 2);
    const unacknowledged = spawnSync(process.execPath, [path.join(root, "scripts", file),
      "--channel=offline"], { cwd: root, encoding: "utf8" });
    assert.equal(unacknowledged.status, 2);
    assert.match(unacknowledged.stderr, /Usage:/);
  }
});
