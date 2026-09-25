import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { openR31Gate } from "./r3.1-live-gate-lib.mjs";

const TEXT_FIELD_TYPES = Object.freeze({
  fontName: "object", fontSize: "number", lineHeight: "object",
  letterSpacing: "object", paragraphSpacing: "number",
  paragraphIndent: "number", textCase: "string", textDecoration: "string",
});

function recordFor(reply, property) {
  return reply?.styles?.find((record) => record.property === property);
}

function isCleanStyle(record, type) {
  return record?.styleType === type && record.remote === true &&
    record.resolutionStatus === "resolved" && record.valueStatus === "resolved" &&
    Array.isArray(record.unreadableFields) && record.unreadableFields.length === 0;
}

function valueAtPath(value, path) {
  if (path === "") return value;
  const segments = path.match(/[^.[\]]+|\[\d+\]/g) || [];
  let current = value;
  for (const segment of segments) {
    const key = segment.startsWith("[") ? Number(segment.slice(1, -1)) : segment;
    if (current === null || current === undefined || !(key in Object(current))) return undefined;
    current = current[key];
  }
  return current;
}

function nullPaths(value, path = "", seen = new WeakSet()) {
  if (value === null) return [path];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Object.entries(value).flatMap(([key, nested]) => nullPaths(nested,
    Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key, seen));
}

function textFieldsTyped(record, entries = []) {
  if (!record?.value || typeof record.value !== "object") return false;
  return Object.entries(TEXT_FIELD_TYPES).every(([field, type]) => {
    const touched = entries.some(({ path }) =>
      path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`));
    return touched || (Object.hasOwn(record.value, field) &&
      typeof record.value[field] === type && record.value[field] !== null &&
      (type !== "object" || !Array.isArray(record.value[field])));
  });
}

export function classifyR331RemoteTextStyleVerdict({
  attachment, target, container, textControl, paintControl, hasContainer = false,
}) {
  const findings = [];
  const unmeasured = [];
  const checks = {};
  const premises = {};
  const attached = attachment?.value?.attachment;
  if (attachment?.error || attachment?.value?.success !== true ||
      attached?.origin !== "remote" || typeof attached.styleId !== "string" ||
      attached.styleId.length === 0) {
    unmeasured.push("Target remote TEXT attachment was not independently observed.");
    return { success: false, premises, checks, findings, unmeasured };
  }
  premises.attachment = { styleId: attached.styleId, origin: attached.origin };
  if (target?.error || !target?.value) {
    findings.push(`Target read failed: ${target?.error || "no JSON reply"}`);
  } else {
    const record = recordFor(target.value, "textStyleId");
    checks.targetRecord = Boolean(record && record.styleId === attached.styleId &&
      record.styleType === "TEXT" && record.remote === true &&
      record.resolutionStatus === "resolved");
    if (!checks.targetRecord) findings.push("Target TEXT record disagrees with the remote attachment.");
    if (record?.valueStatus === "resolved" &&
        Array.isArray(record.unreadableFields) && record.unreadableFields.length === 0) {
      unmeasured.push("Target returned resolved with no unreadable fields; reproduction is absent.");
    } else if (record) {
      const entries = record.unreadableFields;
      checks.partial = record.valueStatus === "partial" && Array.isArray(entries) && entries.length > 0;
      if (!checks.partial) findings.push("Target TEXT record is not partial with entries.");
      else {
        checks.entryShape = entries.every((entry) => typeof entry.path === "string" &&
          ["figma_mixed", "symbol"].includes(entry.reason) &&
          (typeof entry.description === "string" || entry.description === null));
        checks.namedNulls = entries.every((entry) => valueAtPath(record.value, entry.path) === null);
        const names = new Set(entries.map((entry) => entry.path));
        checks.noSilentNulls = nullPaths(record.value).every((item) => names.has(item));
        checks.otherTextFieldsTyped = textFieldsTyped(record, entries);
        if (!checks.entryShape) findings.push("Target unreadableFields shape is invalid.");
        if (!checks.namedNulls || !checks.noSilentNulls) findings.push("Target has an unnamed or unfilled null.");
        if (!checks.otherTextFieldsTyped) findings.push("Untouched TEXT fields are absent or mistyped.");
        premises.P23 = entries;
      }
    }
    if (record?.valueStatus === "partial") {
      const unresolvedValues = (target.value.styles || []).filter((style) =>
        style.resolutionStatus === "resolved" && style.valueStatus !== "resolved").length;
      const limitation = (target.value.limitations || []).find((item) =>
        /^\d+ resolved style references/.test(item));
      checks.limitations = Boolean(limitation &&
        Number(/^\d+/.exec(limitation)?.[0]) === unresolvedValues &&
        limitation.includes("partial"));
      if (!checks.limitations) findings.push("Target limitations do not count and explain partial styles.");
    }
  }

  if (hasContainer) {
    if (container?.error || !container?.value) findings.push(`Container read failed: ${container?.error || "no JSON reply"}`);
    else {
      const targetStyle = recordFor(target?.value, "textStyleId");
      const inner = container.value.styles?.find((style) =>
        style.property === "textStyleId" && style.styleId === targetStyle?.styleId &&
        style.nodeId === targetStyle?.nodeId);
      checks.containerText = Boolean(inner && targetStyle && inner.styleId === targetStyle.styleId &&
        inner.valueStatus === targetStyle.valueStatus &&
        JSON.stringify(inner.value) === JSON.stringify(targetStyle.value) &&
        JSON.stringify(inner.unreadableFields) === JSON.stringify(targetStyle.unreadableFields));
      checks.containerPaintEffect = ["PAINT", "EFFECT"].every((type) =>
        container.value.styles.some((style) => isCleanStyle(style, type)));
      if (!checks.containerText) findings.push("Container TEXT record disagrees with target.");
      if (!checks.containerPaintEffect) findings.push("Container PAINT/EFFECT controls are not clean.");
    }
  }

  const textRecord = recordFor(textControl?.value, "textStyleId");
  checks.textControl = !textControl?.error && isCleanStyle(textRecord, "TEXT") &&
    textFieldsTyped(textRecord);
  if (!checks.textControl) findings.push(`Remote TEXT control failed: ${textControl?.error || "record invalid"}`);
  const paintRecords = (paintControl?.value?.styles || []).filter((style) =>
    ["fillStyleId", "strokeStyleId"].includes(style.property));
  checks.paintControl = !paintControl?.error && paintRecords.length === 2 &&
    paintRecords.every((style) => isCleanStyle(style, "PAINT"));
  if (!checks.paintControl) findings.push(`Remote PAINT control failed: ${paintControl?.error || "records invalid"}`);
  return { success: findings.length === 0 && unmeasured.length === 0,
    premises, checks, findings, unmeasured };
}

export function classifyR331ReactionsVerdict({ fixtureRows, observations, control, destinations }) {
  const findings = [];
  const unmeasured = [];
  const checks = {};
  const premises = {};
  if (!Array.isArray(fixtureRows) || fixtureRows.length === 0) {
    unmeasured.push("Owner-recorded reaction fixture is missing or empty.");
    return { success: false, premises, checks, findings, unmeasured };
  }
  for (const row of fixtureRows) {
    if (typeof row?.nodeId !== "string" || typeof row.trigger?.type !== "string" ||
        !Array.isArray(row.actions) || row.actions.length === 0 ||
        !row.actions.every((action) => typeof action.type === "string")) {
      unmeasured.push("Owner-recorded reaction fixture contains an incomplete row.");
      return { success: false, premises, checks, findings, unmeasured };
    }
    const observed = observations?.[row.nodeId];
    const node = observed?.value?.nodes?.find((item) => item.id === row.nodeId);
    const matched = node?.reactions?.some((reaction) =>
      reaction.trigger?.type === row.trigger.type &&
      row.actions.every((expected, index) =>
        Object.entries(expected).every(([key, value]) => reaction.actions?.[index]?.[key] === value)));
    checks[row.nodeId] = Boolean(!observed?.error && observed?.value?.complete === true && node && matched);
    if (!checks[row.nodeId]) findings.push(`Reaction mismatch for ${row.nodeId}: ${observed?.error || "missing action"}`);
    if (!premises.observedShape && observed?.value) {
      premises.observedShape = {
        topLevelKeys: Object.keys(observed.value),
        nodeKeys: node ? Object.keys(node) : [],
      };
    }
    for (const action of row.actions) {
      if (action.destinationId !== undefined && action.destinationId !== null) {
        const destination = destinations?.[action.destinationId];
        if (destination?.error || destination?.value?.id !== action.destinationId ||
            typeof destination.value.name !== "string" || typeof destination.value.type !== "string") {
          findings.push(`Destination ${action.destinationId} did not resolve through get_node_info.`);
        } else {
          (premises.destinations ||= []).push({ id: action.destinationId,
            name: destination.value.name, type: destination.value.type });
        }
      }
    }
  }
  checks.noReactionControl = !control?.error && control?.value?.complete === true &&
    control?.value?.nodesWithReactions === 0 &&
    Array.isArray(control.value.nodes) && control.value.nodes.length === 0;
  if (!checks.noReactionControl) findings.push(`No-reaction control failed: ${control?.error || "nonempty result"}`);
  return { success: findings.length === 0 && unmeasured.length === 0,
    premises, checks, findings, unmeasured };
}

export function classifyR331SvgExportVerdict({ pngSucceeded, svgReceipt, svgError, pngBytes = false }) {
  if (!pngSucceeded) return { success: false, reason: "PNG control failed" };
  if (svgError !== undefined) {
    const prefixes = svgError.match(/Error exporting node as image:/g) || [];
    const nativeText = svgError.replace(/ \[runtime: [^\]]*\]$/, "");
    const typed = /^Error exporting node as image: \[([^\]]+)\] (.+)$/.exec(nativeText);
    const success = prefixes.length === 1 && Boolean(typed) &&
      typed[1] !== "undefined" && typed[2].trim() !== "undefined";
    return { success, outcome: "rejected", text: svgError,
      reason: success ? "Figma rejection preserved" : "missing, doubled, or undefined rejection" };
  }
  const success = svgReceipt?.mimeType === "image/svg+xml" &&
    svgReceipt?.format === "SVG" && !pngBytes;
  return { success, outcome: "exported", receipt: svgReceipt,
    reason: success ? "SVG MIME and bytes" : "SVG request returned an invalid format or PNG bytes" };
}

export async function runR331ReadGate({ root, options, expectedRuntime, name,
  requiredCommands, allowedTools, observe, classify }) {
  const outputDir = options["output-dir"] ? path.resolve(options["output-dir"])
    : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3.3.1-"));
  await mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "report.json");
  const report = { gate: name, startedAt: new Date().toISOString(), channel: options.channel,
    disposableTargetAcknowledged: true, expectedRuntime, success: false,
    premises: {}, checks: {}, findings: [], unmeasured: [] };
  let gate;
  try {
    gate = await openR31Gate({ root, options, expectedRuntime, name, requiredCommands });
    await gate.connectAndAssert();
    const read = async (tool, args) => {
      if (!allowedTools.includes(tool)) throw new Error(`${tool} is not a read tool for ${name}`);
      try { return { value: (await gate.callJson(tool, args)).value }; }
      catch (error) { return { error: error?.message || String(error) }; }
    };
    Object.assign(report, classify(await observe(read)));
    if (report.unmeasured.length > 0) report.success = false;
  } catch (error) {
    report.findings.push(error?.message || String(error));
    report.success = false;
  } finally {
    if (gate) await gate.close();
    report.finishedAt = new Date().toISOString();
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stderr.write(`R3.3.1 report: ${reportPath}\n`);
  if (!report.success) throw new Error(`${name} failed: ${report.findings.join("; ") || report.unmeasured.join("; ")}`);
  return report;
}
