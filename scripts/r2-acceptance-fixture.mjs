#!/usr/bin/env node

/**
 * R2 acceptance — a disposable, fork-only representative page fixture.
 *
 * The acceptance criterion is deliberately not a consumer screenshot or a hand-built
 * document: a generic client must be able to create and edit a representative UI
 * component/page using only this MCP surface. This runner creates a scratch page and a
 * frame-based product-card component, exercises the R2 layout and visual tools, makes one
 * typed `apply_batch` edit, reads the component back, exports it, then deletes the page.
 *
 * It calls the component a *UI component*, not a Figma `COMPONENT` node. Creating a
 * ComponentNode is R3 design-system work; relying on a pre-existing component would make
 * this fixture depend on the connected file and falsify the acceptance criterion.
 *
 * It is intentionally not named `live-*.mjs`: this is the acceptance fixture to run on a
 * supplied Figma channel, not a historical gate whose pin is maintained by
 * `tests/live-gate-pins.test.mjs`.
 *
 * Usage (only when a DEV plugin is connected to a live channel):
 *
 *   bun run build
 *   node scripts/r2-acceptance-fixture.mjs --channel=<DEV-plugin-channel>
 *
 * Optional: `--output-dir=<directory>` and `--server=<dist-server-path>`.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The five R2.7 receipts that acceptance freezes. Kept data-only for offline coverage. */
export const R2_ACCEPTANCE_PROMOTED_TO_STABLE = Object.freeze([
  "set_fill",
  "set_effects",
  "set_opacity",
  "set_blend_mode",
  "create_node_from_svg",
]);

/**
 * The runner is intentionally explicit about every fork tool it relies on. This guards
 * against a later convenience dependency on a consumer repository or an unrecorded manual
 * Figma action.
 */
export const R2_ACCEPTANCE_REQUIRED_TOOLS = Object.freeze([
  "join_channel",
  "get_runtime_info",
  "get_pages",
  "create_page",
  "set_current_page",
  "create_frame",
  "create_rectangle",
  "create_text",
  "create_node_from_svg",
  "set_layout_mode",
  "set_padding",
  "set_axis_align",
  "set_item_spacing",
  "set_layout_sizing",
  "set_layout_child",
  "set_constraints",
  "set_size_limits",
  "set_clips_content",
  "set_fill",
  "set_effects",
  "set_opacity",
  "set_blend_mode",
  "set_text_style",
  "apply_batch",
  "get_document_info",
  "get_node_info",
  "export_node_as_image",
  "delete_node",
]);

/**
 * The mutating tools do NOT share one reply shape, and this was measured against a live
 * channel rather than assumed: five R2.6 layout tools predate the receipt convention and
 * answer in prose alone, while everything R2.7 added answers with `JSON.stringify(result)`.
 *
 * ⛔ This is declared per tool instead of parsed with a try-JSON-then-prose fallback. A
 * fallback would let a tool that today returns a receipt quietly degrade to prose and still
 * pass the fixture — a green run that had stopped asking the question. Both directions are
 * enforced: `callJson` refuses prose, `callProse` refuses a structured receipt, and
 * `tests/r2-acceptance-fixture.test.mjs` re-reads `server.ts` so the declaration cannot rot.
 */
export const R2_ACCEPTANCE_REPLY_SHAPES = Object.freeze({
  set_layout_mode: "prose",
  set_padding: "prose",
  set_axis_align: "prose",
  set_item_spacing: "prose",
  set_layout_sizing: "prose",
  set_clips_content: "receipt",
  set_fill: "receipt",
  set_effects: "receipt",
  set_opacity: "receipt",
  set_blend_mode: "receipt",
  set_layout_child: "receipt",
  set_constraints: "receipt",
  set_size_limits: "receipt",
  set_text_style: "receipt",
  apply_batch: "receipt",
  get_runtime_info: "receipt",
  get_pages: "receipt",
  create_page: "receipt",
  get_node_info: "receipt",
  get_document_info: "receipt",
  export_node_as_image: "receipt",
});

/**
 * Defects this fixture MEASURED and had to route around to finish. They are recorded rather
 * than repaired because each repair moves a build ID and re-stales the live gate ledger, and
 * that is the owner's call — but a routed-around defect that is not written down is
 * indistinguishable from one that does not exist.
 */
export const R2_ACCEPTANCE_KNOWN_DEFECTS = Object.freeze([
  Object.freeze({
    tool: "set_effects",
    measuredOn: "2026-08-23",
    summary:
      "visible and blendMode are .optional() in the tool schema but MANDATORY in Figma's effect union",
    detail:
      "A DROP_SHADOW omitting either field is refused by Figma with 'Required value missing', " +
      "so the published schema is wider than what the platform accepts. live-effects-gate.mjs " +
      "never exercised the gap: its one successful shadow supplies both fields, and its " +
      "field-omission probe is refused earlier by the fork's own handler and never reaches Figma. " +
      "The refusal is clean — the document was untouched and the fixture's own cleanup restored " +
      "the page baseline — so this is a contract-width defect, not a corruption one.",
    routedAroundBy: "R2_ACCEPTANCE_FIXTURE.shadow supplies both fields explicitly",
  }),
]);

/**
 * All authored content and visual values live here rather than in a consumer fixture. A
 * generic client can therefore execute the runner in an otherwise empty Figma file.
 */
export const R2_ACCEPTANCE_FIXTURE = Object.freeze({
  pageNamePrefix: "R2 acceptance fixture",
  componentName: "Card / Focus / Draft",
  editedComponentName: "Card / Focus / Accepted",
  title: "Make the next move clear.",
  editedTitle: "Make the next move obvious.",
  body: "A compact, editable card built entirely through the fork.",
  action: "Open workspace",
  gradient: Object.freeze([
    Object.freeze({ position: 0, color: Object.freeze({ r: 0.15, g: 0.11, b: 0.42, a: 1 }) }),
    Object.freeze({ position: 1, color: Object.freeze({ r: 0.05, g: 0.35, b: 0.55, a: 1 }) }),
  ]),
  // ⛔ `visible` and `blendMode` are NOT decoration here, and must not be tidied away.
  // Both are `.optional()` in set_effects' own schema and both are MANDATORY in Figma's
  // effect union — omitting either refuses the whole call at the platform layer. Measured
  // 2026-08-23 on channel w113vf7y; see R2_ACCEPTANCE_KNOWN_DEFECTS.
  shadow: Object.freeze({
    type: "DROP_SHADOW",
    color: Object.freeze({ r: 0, g: 0, b: 0, a: 0.28 }),
    offset: Object.freeze({ x: 0, y: 12 }),
    radius: 28,
    spread: 0,
    visible: true,
    blendMode: "NORMAL",
  }),
  iconSvg:
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12h14M13 6l6 6-6 6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
});

function parseOptions(argv) {
  return Object.fromEntries(
    argv.map((argument) => {
      const [key, ...rest] = argument.replace(/^--/, "").split("=");
      return [key, rest.join("=")];
    }),
  );
}

function textContent(result) {
  return (result.content || [])
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
}

function nodeFromInfo(value) {
  return value?.document ?? value;
}

function allDescendants(node) {
  if (!node) return [];
  return [node, ...(node.children || []).flatMap(allDescendants)];
}

async function readExpectedRuntime() {
  const [runtimeText, contractText] = await Promise.all([
    readFile(path.join(root, "src/talk_to_figma_mcp/runtime-metadata.ts"), "utf8"),
    readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
  ]);
  const runtime = JSON.parse(
    runtimeText.slice(runtimeText.indexOf("{"), runtimeText.lastIndexOf("}") + 1),
  );
  const contract = JSON.parse(contractText);
  return {
    contract,
    runtime: {
      serverBuildId: runtime.serverBuildId,
      pluginBuildId: runtime.pluginBuildId,
      schemaVersion: runtime.serverSchemaVersion,
      fingerprint: runtime.capabilityFingerprint,
      toolCount: contract.tools.length,
    },
  };
}

function assertRuntime(runtime, expected) {
  assert.equal(runtime.server.buildId, expected.serverBuildId);
  assert.equal(runtime.server.schemaVersion, expected.schemaVersion);
  assert.equal(runtime.server.capabilityFingerprint, expected.fingerprint);
  assert.equal(
    runtime.plugin?.buildId,
    expected.pluginBuildId,
    "plugin build is stale — reload the DEV plugin before running the fixture",
  );
  assert.equal(runtime.plugin?.apiVersion, expected.schemaVersion);
  assert.equal(runtime.plugin?.capabilityFingerprint, expected.fingerprint);
  assert.equal(runtime.compatibility.status, "compatible");
  assert.deepEqual(runtime.compatibility.issues, []);
  for (const command of R2_ACCEPTANCE_PROMOTED_TO_STABLE) {
    assert.ok(
      runtime.plugin?.supportedCommands.includes(command),
      `plugin lacks ${command} — reload the DEV plugin`,
    );
  }
}

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options.channel) {
    process.stderr.write(
      "Usage: node scripts/r2-acceptance-fixture.mjs --channel=<DEV-plugin-channel> [--output-dir=<dir>] [--server=<dist-server-path>]\n",
    );
    process.exitCode = 2;
    return;
  }

  const { contract, runtime: expectedRuntime } = await readExpectedRuntime();
  const serverPath = options.server
    ? path.resolve(options.server)
    : path.join(root, "dist/server.js");
  const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
  const artifactDirectory = options["output-dir"]
    ? path.resolve(options["output-dir"])
    : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r2-acceptance-"));
  await mkdir(artifactDirectory, { recursive: true });
  const reportPath = path.join(artifactDirectory, "report.json");
  const scratchPageName = `${R2_ACCEPTANCE_FIXTURE.pageNamePrefix} ${new Date().toISOString()}`;

  const client = new Client({
    name: "talk-to-figma-r2-acceptance-fixture",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: root,
    stderr: "pipe",
  });

  async function callRaw(name, args = {}, timeout = 120_000) {
    return client.callTool({ name, arguments: args }, undefined, {
      timeout,
      maxTotalTimeout: timeout,
    });
  }

  async function call(name, args = {}, timeout = 120_000) {
    const result = await callRaw(name, args, timeout);
    const text = textContent(result);
    if (result.isError || /^Error\b/.test(text)) {
      throw new Error(`${name} failed: ${text || "unknown MCP error"}`);
    }
    return { result, text };
  }

  // Declared-receipt path. A tool listed as `receipt` that answers in prose fails here
  // rather than being silently absorbed, because the receipt is the thing being accepted.
  async function callJson(name, args = {}, timeout = 120_000) {
    const called = await call(name, args, timeout);
    assert.equal(
      R2_ACCEPTANCE_REPLY_SHAPES[name],
      "receipt",
      `${name} is not declared as a receipt reply in R2_ACCEPTANCE_REPLY_SHAPES`,
    );
    let value;
    try {
      value = JSON.parse(called.text);
    } catch {
      assert.fail(`${name} is declared to answer with a receipt but answered in prose: ${called.text}`);
    }
    return { ...called, value };
  }

  // Declared-prose path. The five R2.6 layout tools carry no receipt, so the only read-back
  // they publish is the node name they echo — `mustInclude` pins that they named the node
  // actually written. The leading-brace check makes the declaration fail loudly if one of
  // them ever gains a receipt, instead of letting the fixture keep grading it as prose.
  async function callProse(name, args = {}, mustInclude = []) {
    const called = await call(name, args);
    assert.equal(
      R2_ACCEPTANCE_REPLY_SHAPES[name],
      "prose",
      `${name} is not declared as a prose reply in R2_ACCEPTANCE_REPLY_SHAPES`,
    );
    assert.ok(
      !/^\s*[[{]/.test(called.text),
      `${name} now answers with a structured receipt — R2_ACCEPTANCE_REPLY_SHAPES is stale: ${called.text}`,
    );
    for (const fragment of mustInclude) {
      assert.ok(
        called.text.includes(fragment),
        `${name} reply did not name ${JSON.stringify(fragment)}: ${called.text}`,
      );
    }
    return { ...called, prose: called.text };
  }

  // Creator replies predate a common receipt format. This parser supports the real shapes
  // without assuming a nicer one: pure JSON, prose with JSON embedded, and prose with ID.
  async function callNode(name, args = {}) {
    const called = await call(name, args);
    const start = called.text.indexOf("{");
    const end = called.text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const value = JSON.parse(called.text.slice(start, end + 1));
      if (value?.id) return { ...called, id: value.id, value };
    }
    const match = called.text.match(/with (?:new )?ID:\s*([^.\s]+)/);
    assert.ok(match, `${name} returned neither JSON nor a prose node ID: ${called.text}`);
    return { ...called, id: match[1], value: null };
  }

  async function joinWithRetry() {
    let lastError;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        return await call("join_channel", { channel: options.channel });
      } catch (error) {
        lastError = error;
        if (!/Not connected to Figma/.test(error.message) || attempt === 10) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw lastError;
  }

  const record = {
    fixture: "R2 representative component/page",
    startedAt: new Date().toISOString(),
    channel: options.channel,
    artifactDirectory,
    expectedRuntime,
    artifactHashes: {
      server: await sha256OfFile(serverPath),
      plugin: await sha256OfFile(pluginPath),
    },
    checks: {},
    findings: R2_ACCEPTANCE_KNOWN_DEFECTS.map((defect) => ({ ...defect })),
    success: false,
  };

  let scratchPageId = null;
  let originalPageId = null;
  let failure = null;

  try {
    // The local contract makes stability a mechanical precondition; the running server
    // proves the same named tools are actually published by the artifact we spawn.
    const promoted = R2_ACCEPTANCE_PROMOTED_TO_STABLE.map((name) =>
      contract.tools.find((tool) => tool.name === name),
    );
    assert.ok(promoted.every(Boolean), "one of the five promoted tools is absent from the contract");
    assert.ok(
      promoted.every((tool) => tool.resultStability === "stable"),
      "R2 acceptance must freeze all five R2.7 receipts at stable",
    );
    record.checks.contractPromotion = Object.fromEntries(
      promoted.map((tool) => [tool.name, tool.resultStability]),
    );

    await client.connect(transport);
    const inventory = await client.listTools();
    const publishedNames = new Set(inventory.tools.map((tool) => tool.name));
    const missingTools = R2_ACCEPTANCE_REQUIRED_TOOLS.filter((name) => !publishedNames.has(name));
    record.checks.publishedSurface = {
      toolCount: inventory.tools.length,
      missingTools,
      requiredToolCount: R2_ACCEPTANCE_REQUIRED_TOOLS.length,
    };
    assert.equal(inventory.tools.length, expectedRuntime.toolCount);
    assert.deepEqual(missingTools, [], "the fixture must run using only published fork tools");

    await joinWithRetry();
    const runtime = (await callJson("get_runtime_info")).value;
    assertRuntime(runtime, expectedRuntime);
    record.checks.runtime = {
      serverBuildId: runtime.server.buildId,
      pluginBuildId: runtime.plugin.buildId,
      schemaVersion: runtime.server.schemaVersion,
      fingerprint: runtime.server.capabilityFingerprint,
      compatibility: runtime.compatibility.status,
    };

    // ── 1. Create a disposable page and a frame-based UI component ──────────────────────
    const pagesBefore = (await callJson("get_pages")).value;
    originalPageId = pagesBefore.currentPageId;
    record.baseline = {
      pageCount: pagesBefore.pageCount ?? pagesBefore.pages?.length,
      pageIds: (pagesBefore.pages ?? []).map((page) => page.id),
      currentPageId: originalPageId,
    };

    scratchPageId = (await callJson("create_page", { name: scratchPageName })).value.id;
    await call("set_current_page", { pageId: scratchPageId });

    const card = await callNode("create_frame", {
      x: 80,
      y: 80,
      width: 360,
      height: 312,
      name: R2_ACCEPTANCE_FIXTURE.componentName,
      parentId: scratchPageId,
    });
    const cardId = card.id;

    const cardName = R2_ACCEPTANCE_FIXTURE.componentName;
    const layout = {
      mode: (await callProse(
        "set_layout_mode",
        { nodeId: cardId, layoutMode: "VERTICAL" },
        [cardName, "VERTICAL"],
      )).prose,
      padding: (await callProse(
        "set_padding",
        { nodeId: cardId, paddingTop: 28, paddingRight: 28, paddingBottom: 28, paddingLeft: 28 },
        [cardName, "28"],
      )).prose,
      axes: (await callProse(
        "set_axis_align",
        { nodeId: cardId, primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN" },
        [cardName, "MIN"],
      )).prose,
      spacing: (await callProse(
        "set_item_spacing",
        { nodeId: cardId, itemSpacing: 16 },
        [cardName, "itemSpacing=16"],
      )).prose,
      sizing: (await callProse(
        "set_layout_sizing",
        { nodeId: cardId, layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED" },
        [cardName, "FIXED"],
      )).prose,
      clipping: (await callJson("set_clips_content", { nodeId: cardId, clipsContent: true })).value,
    };

    // ── 2. Compose real typography, gradient, effect, SVG icon, and layer values ─────────
    const visuals = {
      fill: (await callJson("set_fill", {
        nodeId: cardId,
        paints: [{ type: "GRADIENT_LINEAR", gradientStops: R2_ACCEPTANCE_FIXTURE.gradient, angle: 135 }],
      })).value,
      effects: (await callJson("set_effects", {
        nodeId: cardId,
        effects: [R2_ACCEPTANCE_FIXTURE.shadow],
      })).value,
    };

    const accent = await callNode("create_rectangle", {
      x: 270,
      y: 18,
      width: 72,
      height: 72,
      name: "Card / Accent",
      parentId: cardId,
    });
    const accentLayout = {
      child: (await callJson("set_layout_child", {
        nodeId: accent.id,
        layoutPositioning: "ABSOLUTE",
      })).value,
      constraints: (await callJson("set_constraints", {
        nodeId: accent.id,
        horizontal: "MAX",
        vertical: "MIN",
      })).value,
      opacity: (await callJson("set_opacity", { nodeId: accent.id, opacity: 0.58 })).value,
      blendMode: (await callJson("set_blend_mode", { nodeId: accent.id, blendMode: "SCREEN" })).value,
    };

    const title = await callNode("create_text", {
      x: 0,
      y: 0,
      text: R2_ACCEPTANCE_FIXTURE.title,
      fontFamily: "Inter",
      fontStyle: "Bold",
      fontSize: 28,
      lineHeight: { value: 34, unit: "PIXELS" },
      letterSpacing: { value: -0.4, unit: "PIXELS" },
      textAutoResize: "HEIGHT",
      fontColor: { r: 1, g: 1, b: 1, a: 1 },
      name: "Card / Title",
      parentId: cardId,
    });
    const body = await callNode("create_text", {
      x: 0,
      y: 0,
      text: R2_ACCEPTANCE_FIXTURE.body,
      fontFamily: "Inter",
      fontStyle: "Regular",
      fontSize: 15,
      lineHeight: { value: 22, unit: "PIXELS" },
      textAutoResize: "HEIGHT",
      fontColor: { r: 0.88, g: 0.93, b: 1, a: 1 },
      name: "Card / Body",
      parentId: cardId,
    });
    const button = await callNode("create_frame", {
      x: 0,
      y: 0,
      width: 176,
      height: 48,
      name: "Card / Action",
      parentId: cardId,
    });
    const buttonLayout = {
      mode: (await callProse(
        "set_layout_mode",
        { nodeId: button.id, layoutMode: "HORIZONTAL" },
        ["Card / Action", "HORIZONTAL"],
      )).prose,
      padding: (await callProse(
        "set_padding",
        { nodeId: button.id, paddingTop: 12, paddingRight: 16, paddingBottom: 12, paddingLeft: 16 },
        ["Card / Action", "12"],
      )).prose,
      axes: (await callProse(
        "set_axis_align",
        { nodeId: button.id, primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "CENTER" },
        ["Card / Action", "CENTER"],
      )).prose,
    };
    const buttonLimits = (await callJson("set_size_limits", {
      nodeId: button.id,
      minWidth: 176,
      maxWidth: 240,
    })).value;
    const buttonLabel = await callNode("create_text", {
      x: 0,
      y: 0,
      text: R2_ACCEPTANCE_FIXTURE.action,
      fontFamily: "Inter",
      fontStyle: "Bold",
      fontSize: 15,
      textAutoResize: "HEIGHT",
      fontColor: { r: 1, g: 1, b: 1, a: 1 },
      name: "Card / Action label",
      parentId: button.id,
    });
    const icon = await callNode("create_node_from_svg", {
      svg: R2_ACCEPTANCE_FIXTURE.iconSvg,
      x: 0,
      y: 0,
      name: "Card / Action icon",
      parentId: button.id,
    });
    assert.ok(icon.value?.createdNodeCount > 1, "the SVG fixture must create a real subtree");

    // ── 3. Edit through the typed batch surface, then make a typography edit ─────────────
    // `set_fill` is intentionally absent from apply_batch's v1 mutate-only allowlist. The
    // batch uses its existing legacy sibling solely to prove the typed receipt; the component
    // already used the new set_fill surface above.
    const batch = (await callJson("apply_batch", {
      operations: [
        {
          id: "rename-card",
          op: "rename_node",
          nodeId: cardId,
          params: { name: R2_ACCEPTANCE_FIXTURE.editedComponentName },
        },
        {
          id: "round-action",
          op: "set_corner_radius",
          nodeId: button.id,
          params: { radius: 18, corners: [true, true, true, true] },
        },
        {
          id: "repaint-action",
          op: "set_fill_color",
          nodeId: button.id,
          params: { color: { r: 0.2, g: 0.72, b: 0.92, a: 1 } },
        },
        {
          id: "edit-title",
          op: "set_text_content",
          nodeId: title.id,
          params: { text: R2_ACCEPTANCE_FIXTURE.editedTitle },
        },
      ],
      onError: "stop",
      timeBudgetMs: 10_000,
    })).value;
    assert.equal(batch.outcome, "all_succeeded");
    assert.equal(batch.total, 4);
    assert.equal(batch.succeeded, 4);
    assert.equal(batch.failed, 0);
    assert.equal(batch.skipped, 0);
    assert.equal(batch.complete, true);
    assert.deepEqual(batch.operations.map((operation) => operation.status), [
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    const bodyTypography = (await callJson("set_text_style", {
      nodeId: body.id,
      fontFamily: "Inter",
      fontStyle: "Regular",
      fontSize: 16,
      lineHeight: { value: 24, unit: "PIXELS" },
      letterSpacing: { value: 0, unit: "PIXELS" },
    })).value;

    // ── 4. Read the finished page and component back through fork tools ───────────────────
    const componentRead = nodeFromInfo((await callJson("get_node_info", { nodeId: cardId })).value);
    const descendants = allDescendants(componentRead);
    const pageRead = (await callJson("get_document_info", { limit: 20, summary: false })).value;
    assert.equal(componentRead.id, cardId);
    assert.equal(componentRead.name, R2_ACCEPTANCE_FIXTURE.editedComponentName);
    assert.equal(componentRead.type, "FRAME");
    assert.equal(componentRead.clipsContent, true);
    assert.ok(Array.isArray(componentRead.fills) && componentRead.fills.length === 1);
    assert.ok(Array.isArray(componentRead.effects) && componentRead.effects.length === 1);
    assert.ok(descendants.some((node) => node.id === title.id && node.characters === R2_ACCEPTANCE_FIXTURE.editedTitle));
    assert.ok(descendants.some((node) => node.id === button.id && node.name === "Card / Action"));
    assert.equal(pageRead.id, scratchPageId);
    assert.ok(pageRead.children.some((child) => child.id === cardId));

    const exportPath = path.join(artifactDirectory, "r2-acceptance-card.png");
    const exported = (await callJson("export_node_as_image", {
      nodeId: cardId,
      format: "PNG",
      scale: 1,
      filePath: exportPath,
    })).value;
    const exportBytes = await readFile(exportPath);
    assert.ok(exportBytes.length > 0, "the accepted component export must contain bytes");

    record.checks.fixture = {
      pageId: scratchPageId,
      cardId,
      componentNodeType: componentRead.type,
      construction: {
        layout,
        visuals,
        accent: accentLayout,
        buttonLayout,
        buttonLimits,
        svg: {
          id: icon.id,
          createdNodeCount: icon.value.createdNodeCount,
          duplicatesOnRerun: icon.value.duplicatesOnRerun,
        },
      },
      batch: {
        outcome: batch.outcome,
        total: batch.total,
        succeeded: batch.succeeded,
        failed: batch.failed,
        skipped: batch.skipped,
        complete: batch.complete,
      },
      typography: bodyTypography,
      readBack: {
        name: componentRead.name,
        childCount: descendants.length - 1,
        titleWasEdited: descendants.some(
          (node) => node.id === title.id && node.characters === R2_ACCEPTANCE_FIXTURE.editedTitle,
        ),
        gradientVisibleInRead: componentRead.fills.length === 1,
        effectVisibleInRead: componentRead.effects.length === 1,
      },
      export: {
        filePath: exportPath,
        byteLength: exportBytes.length,
        sha256: createHash("sha256").update(exportBytes).digest("hex"),
        receipt: exported,
      },
    };
    record.success = true;
  } catch (error) {
    failure = error;
    record.error = { message: error?.message ?? String(error), stack: error?.stack };
  } finally {
    // The fixture owns all of its mutations, including cleanup after a failed assertion.
    if (scratchPageId) {
      try {
        if (originalPageId) await call("set_current_page", { pageId: originalPageId });
        const deleted = await call("delete_node", { nodeId: scratchPageId });
        const pagesAfter = (await callJson("get_pages")).value;
        record.cleanup = {
          pageId: scratchPageId,
          reply: deleted.text,
          baselineRestored:
            (pagesAfter.pageCount ?? pagesAfter.pages?.length) === record.baseline?.pageCount &&
            pagesAfter.currentPageId === originalPageId &&
            JSON.stringify((pagesAfter.pages ?? []).map((page) => page.id)) ===
              JSON.stringify(record.baseline?.pageIds),
        };
      } catch (cleanupError) {
        record.cleanup = {
          pageId: scratchPageId,
          error: String(cleanupError?.message ?? cleanupError),
        };
      }
    }
    await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
    await client.close().catch(() => {});
    process.stderr.write(`report: ${reportPath}\n`);
  }

  if (failure) {
    process.stderr.write(`R2 acceptance fixture FAILED: ${failure.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("R2 acceptance fixture PASSED\n");
}

// Importing the fixture constants in offline tests must never initiate a Figma connection.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
