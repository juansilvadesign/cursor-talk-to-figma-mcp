#!/usr/bin/env node

/**
 * R3.1 live gate — local paint-style attachment and fill-style detachment measurement.
 *
 * The file's local style inventory is the precondition. When it is empty this script reports
 * `unmeasured` and creates nothing; it never substitutes a remote/library style. Otherwise
 * it attaches one exact returned local ID to a scratch rectangle, then uses set_fill on that
 * rectangle and an unstyled control as an independent style-reference observation. It also
 * exercises the explicit null clear on a second controlled attachment.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  openR31Gate,
  parseGateOptions,
  requireDisposableTarget,
} from "./r3.1-live-gate-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseGateOptions();
requireDisposableTarget(
  options,
  "Usage: node scripts/live-r3.1-fill-style-gate.mjs --channel=<DEV-plugin-channel> --disposable-target=true [--output-dir=<dir>] [--server=<dist-server-path>]",
  "This gate attaches local styles and changes fills on scratch rectangles before deleting its scratch page in finally.",
);

const expectedRuntime = {
  serverBuildId: "r3.1-server-beff31768985",
  pluginBuildId: "r3.1-plugin-ed16fbb94fa9",
  schemaVersion: "1.19.0",
  fingerprint:
    "sha256:69007c224212caf1cc29b96b65dd8ca55eb93ce5e66101ed96fa2d53302d576d",
  release: "R3.1",
  toolCount: 80,
};

const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3.1-fill-style-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");
const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

const record = {
  gate: "R3.1 set_fill_style",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  disposableTargetAcknowledged: true,
  artifactDirectory,
  expectedRuntime,
  checks: {},
  cleanup: null,
  verdict: null,
  success: false,
};

const gate = await openR31Gate({
  root,
  options,
  expectedRuntime,
  name: "talk-to-figma-r3.1-fill-style-gate",
  requiredCommands: [
    "set_fill_style",
    "set_fill",
    "get_styles",
    "create_page",
    "set_current_page",
    "create_rectangle",
    "get_pages",
    "delete_node",
  ],
});

let scratchPageId = null;
let originalPageId = null;
let baselinePageIds = null;
let failure = null;

try {
  const { inventory, runtime } = await gate.connectAndAssert();
  const styleTool = inventory.tools.find((tool) => tool.name === "set_fill_style");
  assert.ok(styleTool, "set_fill_style is not in the published MCP inventory");
  assert.deepEqual(styleTool.inputSchema?.required ?? [], ["nodeId", "styleId"]);
  record.checks.publishedSurface = {
    required: styleTool.inputSchema?.required ?? [],
    resultStability: styleTool.resultStability ?? null,
    description: styleTool.description,
  };
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId ?? null,
    compatibility: runtime.compatibility.status,
  };

  const styles = (await gate.callJson("get_styles")).value;
  const localPaintStyles = Array.isArray(styles.colors) ? styles.colors : [];
  record.checks.localPaintStyleInventory = {
    count: localPaintStyles.length,
    ids: localPaintStyles.map((style) => style.id),
  };

  if (localPaintStyles.length === 0) {
    // This is intentionally not converted into a remote-style probe. The R3.1 boundary is
    // local attachment, and absence is a fact about this disposable file, not a pass.
    record.verdict = "unmeasured";
    record.stillOwed = [
      "UNMEASURED: the owner-confirmed disposable file has no local paint style. Add one locally and re-run; do not substitute a remote/library style.",
    ];
  } else {
    const localStyle = localPaintStyles[0];
    const pagesBefore = (await gate.callJson("get_pages")).value;
    originalPageId = pagesBefore.currentPageId;
    baselinePageIds = (pagesBefore.pages ?? []).map((page) => page.id);
    scratchPageId = await gate.callNodeId("create_page", {
      name: `__R3.1 fill style gate ${stamp}`,
    });
    await gate.call("set_current_page", { pageId: scratchPageId });

    const styledId = await gate.callNodeId("create_rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      name: "__R3.1 local-style target",
      parentId: scratchPageId,
    });
    const controlId = await gate.callNodeId("create_rectangle", {
      x: 180,
      y: 0,
      width: 100,
      height: 100,
      name: "__R3.1 unstyled control",
      parentId: scratchPageId,
    });

    // The unknown-ID refusal must leave the scratch target unattached. Its effect is
    // subsequently discriminated by set_fill's styleIdBefore on the real local attachment.
    const unknownRefusal = await gate.callExpectingRefusal("set_fill_style", {
      nodeId: styledId,
      styleId: `__missing_local_paint_style_${stamp}`,
    });

    const attached = (await gate.callJson("set_fill_style", {
      nodeId: styledId,
      styleId: localStyle.id,
    })).value;
    assert.equal(attached.action, "attached");
    assert.equal(attached.styleIdAfter, localStyle.id);
    assert.equal(attached.readbackMatchesRequested, true);
    assert.equal(attached.outcome, "confirmed");

    // set_fill is a distinct command with its own direct style read. The styled target and
    // untouched control receive the same paint, so their before references discriminate an
    // attachment that really reached Figma from a receipt that only echoed styleId.
    const paint = [{ type: "SOLID", color: { r: 0.15, g: 0.55, b: 0.95 } }];
    const styledFill = (await gate.callJson("set_fill", {
      nodeId: styledId,
      paints: paint,
    })).value;
    const controlFill = (await gate.callJson("set_fill", {
      nodeId: controlId,
      paints: paint,
    })).value;
    assert.equal(styledFill.styleIdBefore, localStyle.id);
    assert.equal(controlFill.styleIdBefore, null);

    // Clear is a second exact operation: attach the same local ID to the control, then use
    // null and demand the normalized null read-back rather than treating omitted as clear.
    const controlAttached = (await gate.callJson("set_fill_style", {
      nodeId: controlId,
      styleId: localStyle.id,
    })).value;
    const cleared = (await gate.callJson("set_fill_style", {
      nodeId: controlId,
      styleId: null,
    })).value;
    assert.equal(controlAttached.readbackMatchesRequested, true);
    assert.equal(cleared.action, "cleared");
    assert.equal(cleared.styleIdAfter, null);
    assert.equal(cleared.readbackMatchesRequested, true);

    record.checks.attachmentAndDetach = {
      localStyle: { id: localStyle.id, name: localStyle.name ?? null },
      unknownRefusal,
      attachmentReceipt: attached,
      independentFillObservation: {
        styled: {
          styleIdBefore: styledFill.styleIdBefore,
          styleIdAfter: styledFill.styleIdAfter,
          styleDetached: styledFill.styleDetached,
          styleReadable: styledFill.styleReadable,
        },
        control: {
          styleIdBefore: controlFill.styleIdBefore,
          styleIdAfter: controlFill.styleIdAfter,
          styleDetached: controlFill.styleDetached,
          styleReadable: controlFill.styleReadable,
        },
      },
      clearReceipt: cleared,
    };
    record.verdict = "measured";
    record.success = true;
  }
} catch (error) {
  failure = error;
  record.failure = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  if (scratchPageId) {
    try {
      if (originalPageId) await gate.call("set_current_page", { pageId: originalPageId });
      await gate.call("delete_node", { nodeId: scratchPageId });
      const pagesAfter = (await gate.callJson("get_pages")).value;
      record.cleanup = {
        deletedScratchPageId: scratchPageId,
        baselineRestored:
          JSON.stringify((pagesAfter.pages ?? []).map((page) => page.id)) ===
            JSON.stringify(baselinePageIds) &&
          pagesAfter.currentPageId === originalPageId,
      };
      assert.equal(record.cleanup.baselineRestored, true, "scratch-page cleanup did not restore the page baseline");
    } catch (cleanupError) {
      record.cleanup = {
        deletedScratchPageId: scratchPageId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      };
      if (!failure) failure = cleanupError;
    }
  }
  await gate.close();
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  process.stderr.write(`report: ${reportPath}\n`);
}

if (failure) throw failure;
if (!record.success) {
  process.stdout.write("R3.1 set_fill_style live gate UNMEASURED (no local paint style)\n");
} else {
  process.stdout.write("R3.1 set_fill_style live gate PASSED\n");
}
