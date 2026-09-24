#!/usr/bin/env node

// G3 records a verdict for every representative instance-child write. It never
// edits a stable handler to make a row green; false_success and leaked_to_main fail.
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseGateOptions, requireDisposableTarget } from "./r3.1-live-gate-lib.mjs";
import {
  classifyR33InstanceChildVerdict, isR33KnownStableFinding,
  KNOWN_STABLE_TOOL_FINDINGS, runR33Gate,
} from "./r3.3-live-gate-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseGateOptions();
requireDisposableTarget(options,
  "Usage: node scripts/live-r3.3-instance-child-gate.mjs --channel=<DEV-plugin-channel> --disposable-target=true [--output-dir=<dir>] [--server=<dist-server-path>]",
  "G3 writes representative instance children and matching scratch controls.");
if (options["allow-permanent"] !== undefined) {
  process.stderr.write("Refusing to run: R3.3 has no permanent-residue mode.\n");
  process.exit(2);
}

const expectedRuntime = {
  serverBuildId: "r3.3-server-a472b2a4cb3e",
  pluginBuildId: "r3.3-plugin-06a6fcd0c5ec",
  schemaVersion: "1.22.0",
  fingerprint: "sha256:daf288cb29bef1f5879e96107003a63c2715a1b5d4a3a5055ee62ca63e14a029",
  release: "R3.3",
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

function snap(value) {
  return JSON.stringify(value);
}

function createdId(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed?.id) return parsed.id;
  } catch (_) {}
  return /(?:new )?ID:\s*([^\s.]+)/.exec(text)?.[1] || null;
}

const rows = [
  { tool: "set_fill_color", kind: "rectangle",
    args: (nodeId, next) => ({ nodeId, r: next ? 0.9 : 0.1,
      g: next ? 0.1 : 0.2, b: next ? 0.1 : 0.8, a: 1 }) },
  { tool: "set_stroke_color", kind: "rectangle",
    args: (nodeId, next) => ({ nodeId, r: next ? 0.9 : 0.1,
      g: next ? 0.2 : 0.1, b: next ? 0.1 : 0.2, a: 1, weight: next ? 3 : 1 }) },
  { tool: "set_corner_radius", kind: "rectangle",
    args: (nodeId, next) => ({ nodeId, radius: next ? 12 : 0 }) },
  { tool: "set_opacity", kind: "rectangle", renderWitness: true,
    args: (nodeId, next) => ({ nodeId, opacity: next ? 0.4 : 1 }) },
  { tool: "set_effects", kind: "rectangle",
    args: (nodeId, next) => ({ nodeId,
      effects: next ? [{ type: "LAYER_BLUR", radius: 4, visible: true }] : null }) },
  { tool: "set_text_content", kind: "text",
    args: (nodeId, next) => ({ nodeId, text: next ? "G3 after" : "G3 before" }) },
  { tool: "set_clips_content", kind: "frame",
    args: (nodeId, next) => ({ nodeId, clipsContent: !next }) },
  { tool: "set_layout_sizing", kind: "auto",
    args: (nodeId, next) => ({ nodeId,
      layoutSizingHorizontal: next ? "HUG" : "FIXED" }) },
  { tool: "set_padding", kind: "auto",
    args: (nodeId, next) => ({ nodeId, paddingLeft: next ? 24 : 0 }) },
  { tool: "resize_node", kind: "rectangle",
    args: (nodeId, next) => ({ nodeId, width: next ? 75 : 40, height: 40 }) },
  { tool: "rename_node", kind: "rectangle",
    args: (nodeId, next, originalName) =>
      ({ nodeId, name: next ? `${originalName} changed` : originalName }) },
  { tool: "set_parent", kind: "rectangle", structural: true,
    args: (nodeId, _next, _name, parentId) => ({ nodeId, parentId }) },
  { tool: "delete_node", kind: "rectangle", structural: true,
    args: (nodeId) => ({ nodeId }) },
  { tool: "create_frame", kind: "root", structural: true,
    args: (_nodeId, _next, _name, parentId) => ({
      parentId, name: "G3 created in parent", x: 0, y: 0, width: 20, height: 20,
    }) },
  { tool: "create_group", kind: "rectangle", structural: true,
    args: (nodeId, _next, _name, parentId) =>
      ({ nodeIds: [nodeId], parentId }) },
];

await runR33Gate({
  root, options, expectedRuntime, name: "R3.3 G3 instance-child eligibility",
  requiredCommands: [
    "get_component", "create_or_match_component", "create_or_match_instance",
    "export_node_as_image",
    ...rows.map(({ tool }) => tool),
  ],
  scenario: async ({ gate, call, create, nodeId, record, stamp, pageId }) => {
    const component = await create("create_or_match_component", {
      parentId: pageId, name: `__R3.3 G3 main ${stamp}`,
      identityKey: `r3.3/g3/${stamp}/main`,
    }, "components");
    assert.equal(component.outcome, "confirmed");
    const plainId = await nodeId("create_frame", {
      parentId: pageId, name: "G3 plain control",
      x: 500, y: 0, width: 350, height: 600,
    });
    const fixtures = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row.kind === "root") {
        fixtures.push({ row, name: "root", mainId: component.id, plainId });
        continue;
      }
      const name = `G3 ${index} ${row.tool}`;
      const creator = row.kind === "text" ? "create_text" :
        ["frame", "auto"].includes(row.kind) ? "create_frame" : "create_rectangle";
      const base = { x: 0, y: 45 * index, name, parentId: component.id };
      const plain = { ...base, parentId: plainId };
      if (creator === "create_text") {
        base.text = "G3 before";
        plain.text = "G3 before";
      } else {
        base.width = plain.width = 40;
        base.height = plain.height = 40;
      }
      const mainId = await nodeId(creator, base);
      const controlId = await nodeId(creator, plain);
      if (row.kind === "auto") {
        await gate.call("set_layout_mode", {
          nodeId: mainId, layoutMode: "VERTICAL",
        });
        await gate.call("set_layout_mode", {
          nodeId: controlId, layoutMode: "VERTICAL",
        });
        await nodeId("create_rectangle", {
          parentId: mainId, x: 0, y: 0, width: 10, height: 10,
          name: `${name} nested`,
        });
        await nodeId("create_rectangle", {
          parentId: controlId, x: 0, y: 0, width: 10, height: 10,
          name: `${name} nested`,
        });
      }
      if (row.kind === "frame") {
        await nodeId("create_rectangle", {
          parentId: mainId, x: 55, y: 0, width: 10, height: 10,
          name: `${name} overflow`,
        });
        await nodeId("create_rectangle", {
          parentId: controlId, x: 55, y: 0, width: 10, height: 10,
          name: `${name} overflow`,
        });
      }
      if (["set_fill_color", "set_stroke_color"].includes(row.tool)) {
        await gate.call(row.tool, row.args(mainId, false, name));
        await gate.call(row.tool, row.args(controlId, false, name));
      }
      fixtures.push({ row, name, mainId, plainId: controlId });
    }
    record.premises.P18 = { status: "measured", fixtureCount: fixtures.length };
    const instance = await create("create_or_match_instance", {
      parentId: pageId, componentId: component.id,
      identityKey: `r3.3/g3/${stamp}/instance`,
    }, "instances");
    assert.equal(instance.outcome, "confirmed");
    const instanceTree = await call("get_node_info", { nodeId: instance.id });
    const matrix = [];
    let exportSequence = 0;
    const renderHash = async (id) => {
      const filePath = path.join(os.tmpdir(),
        `r33-g3-${stamp}-${exportSequence++}.png`);
      try {
        const receipt = await call("export_node_as_image", {
          nodeId: id, format: "PNG", filePath,
        });
        return typeof receipt.sha256 === "string" ? receipt.sha256 : null;
      } catch (_) {
        return null;
      } finally {
        await unlink(filePath).catch(() => undefined);
      }
    };

    for (const fixture of fixtures) {
      const { row, name, mainId, plainId: controlId } = fixture;
      const childId = row.kind === "root" ? instance.id :
        findNamed(instanceTree, name)?.id;
      if (!childId) {
        matrix.push({ tool: row.tool, verdict: "unmeasured",
          reason: "matching instance child could not be read" });
        continue;
      }
      const targetId = childId;
      const parentForInstance = row.tool === "set_parent" ? pageId : instance.id;
      const args = row.args(targetId, true, name, parentForInstance);
      const readTree = async (id) => {
        try { return await call("get_node_info", { nodeId: id }); }
        catch (_) { return null; }
      };
      const restoreGroupControl = async (groupId, controlNodeId, originalParentId) => {
        await gate.call("set_parent", { nodeId: controlNodeId, parentId: originalParentId });
        const restoredParent = await readTree(originalParentId);
        assert.ok(restoredParent?.children?.some(({ id }) => id === controlNodeId),
          `create_group control ${controlNodeId} was not restored to ${originalParentId}`);
        if (groupId) {
          try {
            await gate.call("delete_node", { nodeId: groupId });
          } catch (error) {
            if (!/not found|does not exist|could not find/i.test(error?.message || "")) {
              throw error;
            }
            assert.equal(await readTree(groupId), null,
              "create_group control reported not found while the group still resolved");
          }
        }
      };
      const mainBefore = await readTree(component.id);
      const childBefore = await readTree(instance.id);
      const plainBefore = await readTree(row.structural ? plainId : controlId);
      const plainRenderBefore = row.renderWitness ? await renderHash(controlId) : null;
      const mainRenderBefore = row.renderWitness ? await renderHash(mainId) : null;
      const childRenderBefore = row.renderWitness ? await renderHash(targetId) : null;
      let plainControl = "unmeasured";
      let mainControl = "unmeasured";
      let plainRenderAfter = null;
      let attempt = { succeeded: false, error: null, text: null };

      // Plain control first, with a differing value. Structural controls are
      // restored in the scratch context after the instance attempt.
      try {
        if (row.tool === "delete_node") {
          await nodeId("clone_node", { nodeId: controlId });
        }
        const plainArgs = row.args(controlId, true, name,
          row.tool === "set_parent" ? pageId : plainId);
        const result = await gate.call(row.tool, plainArgs);
        const plainAfter = await readTree(row.structural ? plainId : controlId);
        plainRenderAfter = row.renderWitness ? await renderHash(controlId) : null;
        plainControl = snap(plainBefore) !== snap(plainAfter) ||
          (plainRenderBefore && plainRenderAfter && plainRenderBefore !== plainRenderAfter)
          ? "applied" : "unmeasured";
        if (!row.structural) {
          await gate.call(row.tool, row.args(controlId, false, name));
        } else if (row.tool === "set_parent") {
          await gate.call("set_parent", { nodeId: controlId, parentId: plainId });
        } else if (row.tool === "create_frame") {
          const created = createdId(result.text);
          if (created) await gate.call("delete_node", { nodeId: created });
        } else if (row.tool === "create_group") {
          const groupId = createdId(result.text);
          await restoreGroupControl(groupId, controlId, plainId);
        }
      } catch (error) {
        plainControl = `failed: ${error.message}`;
      }

      try {
        const result = await gate.call(row.tool, args);
        attempt = { succeeded: true, error: null, text: result.text };
      } catch (error) {
        attempt = { succeeded: false, error: error.message, text: null };
      }
      const mainAfter = await readTree(component.id);
      const childAfter = await readTree(instance.id);
      const mainRenderAfter = row.renderWitness ? await renderHash(mainId) : null;
      const childRenderAfter = row.renderWitness ? await renderHash(targetId) : null;
      const mainMoved = snap(mainBefore) !== snap(mainAfter) ||
        Boolean(mainRenderBefore && mainRenderAfter && mainRenderBefore !== mainRenderAfter);
      const childMoved = snap(childBefore) !== snap(childAfter) ||
        Boolean(childRenderBefore && childRenderAfter && childRenderBefore !== childRenderAfter);
      const renderMeasured = !row.renderWitness || Boolean(plainRenderBefore &&
        plainRenderAfter && mainRenderBefore && childRenderBefore &&
        mainRenderAfter && childRenderAfter);
      const verdict = renderMeasured ? classifyR33InstanceChildVerdict({
        succeeded: attempt.succeeded, error: attempt.error, childMoved, mainMoved,
      }) : "unmeasured";

      // The main control is exercised after the instance measurement, so a
      // destructive control cannot erase the instance child's precondition.
      try {
        if (row.tool === "delete_node") {
          await nodeId("clone_node", { nodeId: mainId });
        }
        const before = await readTree(component.id);
        const beforeRender = row.renderWitness ? await renderHash(mainId) : null;
        const result = await gate.call(row.tool, row.args(mainId, true, name,
          row.tool === "set_parent" ? pageId : component.id));
        const after = await readTree(component.id);
        const afterRender = row.renderWitness ? await renderHash(mainId) : null;
        mainControl = snap(before) !== snap(after) ||
          (beforeRender && afterRender && beforeRender !== afterRender)
          ? "applied" : "unmeasured";
        if (!row.structural) {
          await gate.call(row.tool, row.args(mainId, false, name));
        } else if (row.tool === "set_parent") {
          await gate.call("set_parent", { nodeId: mainId, parentId: component.id });
        } else if (row.tool === "create_frame") {
          const created = createdId(result.text);
          if (created) await gate.call("delete_node", { nodeId: created });
        } else if (row.tool === "create_group") {
          const groupId = createdId(result.text);
          await restoreGroupControl(groupId, mainId, component.id);
        }
      } catch (error) {
        mainControl = `failed: ${error.message}`;
      }
      const entry = {
        tool: row.tool, targetId, mainId, controlId,
        verdict, plainControl, mainControl,
        childMoved, mainMoved, renderMeasured,
        replyText: attempt.text,
        nativeOrHandlerError: attempt.error,
      };
      matrix.push(entry);
      if (["false_success", "leaked_to_main", "refused_but_mutated"].includes(verdict)) {
        record.findings.push(`${row.tool}: ${verdict}`);
      }
    }
    record.checks.matrix = matrix;
    record.premises.P16 = { status: matrix.every((row) => row.verdict !== "unmeasured")
      ? "measured" : "unmeasured", rows: matrix.length };
    assert.equal(matrix.length, rows.length, "a matrix row was silently skipped");
    for (const row of matrix) {
      assert.ok(["applied_as_override", "refused_by_handler", "refused_by_platform",
        "false_success", "leaked_to_main", "refused_but_mutated", "unmeasured"].includes(row.verdict));
      if (row.verdict === "unmeasured" ||
          row.plainControl !== "applied" || row.mainControl !== "applied") {
        record.unmeasured.push(`${row.tool}: setup/control did not discriminate`);
      }
      if (Object.hasOwn(KNOWN_STABLE_TOOL_FINDINGS, row.tool)) {
        assert.ok(isR33KnownStableFinding(row.tool, row.verdict),
          `${row.tool} changed from its measured stable-tool finding: ${row.verdict}`);
      } else {
        assert.notEqual(row.verdict, "false_success", `${row.tool} claimed success without a child change`);
        assert.notEqual(row.verdict, "leaked_to_main", `${row.tool} changed the main component`);
        assert.notEqual(row.verdict, "refused_but_mutated",
          `${row.tool} refused but changed the instance child`);
      }
    }
  },
});
