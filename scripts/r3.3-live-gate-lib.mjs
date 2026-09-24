import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { openR31Gate } from "./r3.1-live-gate-lib.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function classifyR33InstanceChildVerdict({ succeeded, error, childMoved, mainMoved }) {
  if (!succeeded && childMoved) return "refused_but_mutated";
  if (mainMoved) return "leaked_to_main";
  if (succeeded && childMoved) return "applied_as_override";
  if (succeeded) return "false_success";
  return /does not carry|requires|must be|not supported/i.test(error || "")
    ? "refused_by_handler" : "refused_by_platform";
}

// Measured 2026-09-24 on r3.3-server-a472b2a4cb3e /
// r3.3-plugin-8063801303d6 and re-measured on
// r3.3-plugin-06a6fcd0c5ec in live run 2. This is a stable handler finding,
// not a new allowance for other false-success rows.
export const KNOWN_STABLE_TOOL_FINDINGS = Object.freeze({
  resize_node: "false_success",
});

export function isR33KnownStableFinding(tool, verdict) {
  return Object.hasOwn(KNOWN_STABLE_TOOL_FINDINGS, tool) &&
    KNOWN_STABLE_TOOL_FINDINGS[tool] === verdict;
}

export function classifyR33SlotSetParentVerdict({
  originalId, canonicalId, replyText, originalIdLookup,
}) {
  if (canonicalId === originalId) return "id_preserved";
  if (replyText.includes(canonicalId)) return "new_id_reported";
  if (originalIdLookup.resolves === true && originalIdLookup.id === canonicalId) {
    return "new_id_unreported_original_is_alias";
  }
  return "new_id_unreported_original_dangling";
}

export function classifyR33SlotCreateFrameVerdict({ replyId, canonicalId, replyIdLookup }) {
  if (replyId === canonicalId) return "reply_id_is_canonical";
  if (replyIdLookup.resolves === true && replyIdLookup.id === canonicalId) {
    return "reply_id_is_alias";
  }
  return "reply_id_not_created_node";
}

// G2, measured 2026-09-24 on r3.3-server-a472b2a4cb3e /
// r3.3-plugin-06a6fcd0c5ec in live3-g2 and diag10. Both reported IDs are
// aliases of the canonical instance-scoped IDs; these findings belong to R3.4.
export const KNOWN_G2_STABLE_TOOL_FINDINGS = Object.freeze({
  set_parent: "new_id_unreported_original_is_alias",
  create_frame: "reply_id_is_alias",
});

export function assertR33SlotStableFindings(actual) {
  assert.deepEqual(actual, KNOWN_G2_STABLE_TOOL_FINDINGS,
    "G2 stable-tool findings changed from the measured pair");
}

export async function r33Baseline(gate) {
  const pages = (await gate.callJson("get_pages")).value;
  const components = (await gate.callJson("get_local_components", {
    summary: true, familyLimit: 500, sessionLimit: 100,
  })).value;
  const styles = (await gate.callJson("get_styles")).value;
  const variables = (await gate.callJson("get_variables")).value;
  assert.equal(components.complete, true, "component baseline is incomplete");
  assert.equal(components.familiesTruncated, false, "component families are truncated");
  assert.equal(variables.supported, true, "local variable collection count is unreadable");
  return canonical({
    pages: {
      currentPageId: pages.currentPageId,
      entries: (pages.pages || []).map(({ id, name, childCount }) =>
        ({ id, name, childCount })),
    },
    components: {
      count: components.count,
      pages: components.pages,
      familyCount: components.familyCount,
      nameFamilies: components.nameFamilies,
    },
    localStyleCounts: Object.fromEntries(
      ["colors", "texts", "effects", "grids"].map((kind) =>
        [kind, Array.isArray(styles[kind]) ? styles[kind].length : null])),
    variableCollectionCount: variables.collectionCount,
  });
}

export async function runR33Gate({
  root, options, expectedRuntime, name, requiredCommands, preflight, scenario,
}) {
  const reportDirectory = options["output-dir"]
    ? path.resolve(options["output-dir"])
    : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3.3-"));
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, "report.json");
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const record = {
    gate: name,
    startedAt: new Date().toISOString(),
    channel: options.channel,
    disposableTargetAcknowledged: true,
    expectedRuntime,
    premises: {},
    checks: {},
    findings: [],
    unmeasured: [],
    owned: { attempts: [], components: [], sets: [], instances: [], frames: [], pageId: null },
    cleanup: [],
    success: false,
  };
  const gate = await openR31Gate({
    root, options, expectedRuntime, name, requiredCommands,
  });
  let verifier = null;
  let baseline = null;
  let failure = null;
  let primaryClosed = false;
  const call = async (toolName, args = {}) =>
    (await gate.callJson(toolName, args)).value;
  const expectRefusal = async (toolName, args, code) => {
    const result = await call(toolName, args);
    assert.equal(result.success, false, `${toolName} unexpectedly succeeded`);
    assert.equal(result.outcome, "refused", `${toolName} did not give a typed refusal`);
    assert.equal(result.refusal?.code, code, `${toolName} refused for the wrong reason`);
    return result;
  };
  const create = async (toolName, args, kind) => {
    // Own the attempt before the call. A native failure can occur after Figma creates.
    record.owned.attempts.push({ toolName, identityKey: args.identityKey ?? null,
      name: args.name ?? null, sourceNodeId: args.nodeId ?? null });
    const result = await call(toolName, args);
    if (result.action === "created" && result.id && record.owned[kind]) {
      record.owned[kind].push({ id: result.id, identityKey: args.identityKey ?? null });
      if (toolName === "combine_as_variants") {
        for (const component of record.owned.components) {
          if (args.componentIds.includes(component.id)) component.absorbedBySet = result.id;
        }
      }
    }
    return result;
  };
  const nodeId = (toolName, args) => gate.callNodeId(toolName, args);

  try {
    // connectAndAssert checks every pin and required command before the baseline read
    // or any mutation. The verifier proves its bad-pin leg with a throwaway copy.
    await gate.connectAndAssert();
    if (preflight) await preflight({ gate, call, expectRefusal, record });
    baseline = await r33Baseline(gate);
    record.baseline = baseline;
    const pageId = await nodeId("create_page", { name: `__R3.3 ${name} ${stamp}` });
    record.owned.pageId = pageId; // own first, assert second
    assert.ok(pageId);
    await gate.call("set_current_page", { pageId });

    await scenario({
      gate, call, create, expectRefusal, nodeId, record, stamp, pageId,
      ownInstance(id) { record.owned.instances.push({ id }); },
      ownFrame(id) { record.owned.frames.push({ id }); },
    });
  } catch (error) {
    failure = error;
    record.error = { message: error?.message || String(error), stack: error?.stack };
  } finally {
    // Every cleanup action runs even when a preceding action fails. This is an
    // attempted cleanup; only the separate-client comparison below can prove it.
    const cleanup = async (label, action) => {
      try {
        record.cleanup.push({ label, result: await action() });
      } catch (error) {
        record.cleanup.push({ label, error: error?.message || String(error) });
      }
    };
    for (const { id } of [...record.owned.instances, ...record.owned.frames].reverse()) {
      await cleanup(`delete-node:${id}`, async () => (await gate.call("delete_node", { nodeId: id })).text);
    }
    const deferredComponents = [];
    const deleteOwnedComponent = async (entry, allowDeferred) => {
      const { id, identityKey } = entry;
      await cleanup(`delete-component:${id}${allowDeferred ? "" : ":retry"}`, async () => {
        const result = (await gate.callJson("delete_component", {
          nodeId: id, identityKey, confirm: true,
        })).value;
        if (allowDeferred && result.refusal?.code === "component_has_instances") {
          deferredComponents.push(entry);
          return { deferred: true, ...result };
        }
        assert.equal(result.outcome, "removed",
          `cleanup delete_component ${id} did not remove its target`);
        return result;
      });
    };
    for (const entry of [
      ...record.owned.sets, ...record.owned.components,
    ].reverse()) {
      if (!entry.identityKey || entry.absorbedBySet) continue;
      await deleteOwnedComponent(entry, true);
    }
    for (const entry of deferredComponents) {
      await deleteOwnedComponent(entry, false);
    }
    if (baseline?.pages.currentPageId) {
      await cleanup("restore-current-page", async () =>
        (await gate.call("set_current_page", { pageId: baseline.pages.currentPageId })).text);
    }
    if (record.owned.pageId) {
      await cleanup("delete-scratch-page", async () =>
        (await gate.call("delete_node", { nodeId: record.owned.pageId })).text);
    }
    await gate.close();
    primaryClosed = true;
    if (baseline) {
      try {
        verifier = await openR31Gate({
          root, options, expectedRuntime, name: `${name}-fresh-client`,
          requiredCommands,
        });
        await verifier.connectAndAssert();
        const after = await r33Baseline(verifier);
        record.finalBaseline = after;
        record.baselineRestored = JSON.stringify(after) === JSON.stringify(baseline);
        assert.deepEqual(after, baseline, "fresh client found cleanup residue");
      } catch (error) {
        failure ??= error;
        record.baselineRestored = false;
        record.cleanup.push({ label: "fresh-client-baseline", error: error?.message || String(error) });
      } finally {
        if (verifier) await verifier.close();
      }
    }
    if (record.unmeasured.length > 0 && !failure) {
      failure = new Error(`${name} has ${record.unmeasured.length} unmeasured required claim(s)`);
    }
    record.success = !failure && record.baselineRestored === true &&
      record.cleanup.every((entry) => !entry.error);
    record.finishedAt = new Date().toISOString();
    await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
    if (!primaryClosed) await gate.close();
  }
  process.stderr.write(`R3.3 report: ${reportPath}\n`);
  if (failure) throw failure;
  assert.equal(record.success, true, "R3.3 gate did not restore the fresh-client baseline");
  return record;
}
