import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

test("runtime identity is available without touching the document", async () => {
  // Derived from runtime/release.json rather than hardcoded, so cutting a release does
  // not require editing assertions — which is how a stale expectation gets "fixed" to
  // match whatever the code now does.
  const release = JSON.parse(
    await readFile(new URL("../runtime/release.json", import.meta.url), "utf8"),
  );
  const harness = await loadPluginHarness();
  const runtime = await harness.command("get_runtime_info");
  assert.equal(runtime.release, release.release);
  assert.match(
    runtime.buildId,
    new RegExp(`^${release.release.toLowerCase()}-plugin-[a-f0-9]{12}$`),
  );
  assert.equal(runtime.serverSchemaVersion, release.serverSchemaVersion);
  assert.equal(runtime.relayProtocolVersion, release.relayProtocolVersion);
  assert.ok(runtime.supportedCommands.includes("get_runtime_info"));
  assert.equal(runtime.capabilityIds.length, runtime.supportedCommands.length + 1);
});

test("bounded document reads preserve full-page arithmetic", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("get_document_info", {
    limit: 2,
    offset: 0,
    familyLimit: 2,
  });
  assert.equal(result.currentPage.childCount, 6);
  assert.equal(result.children.length, 2);
  assert.equal(result.childrenTruncated, true);
  assert.equal(result.pagination.returned, 2);
  assert.equal(result.pagination.hasMore, true);
  assert.equal(
    result.childTypes.reduce((sum, entry) => sum + entry.count, 0),
    result.currentPage.childCount,
  );
  assert.equal(result.pageCount, 2);
});

test("page, style, variable, component, and binding fixtures retain honest coverage", async () => {
  const harness = await loadPluginHarness();
  const pages = await harness.command("get_pages", { includeChildCount: true });
  assert.equal(pages.pageCount, 2);
  assert.deepEqual(pages.pages.map((page) => page.childCount), [6, 2]);

  const styles = await harness.command("get_styles");
  assert.deepEqual(styles.counts, { colors: 1, texts: 1, effects: 1, grids: 1 });

  const variables = await harness.command("get_variables");
  assert.equal(variables.complete, true);
  assert.equal(variables.collectionCount, 1);
  assert.equal(variables.variableCount, 3);
  assert.equal(variables.resolutionIssueCount, 0);
  const alias = variables.collections[0].modes[0].variables.find(
    (variable) => variable.id === "var-alias",
  );
  assert.equal(alias.resolutionStatus, "resolved");
  assert.equal(alias.resolvedValue, "#1a334d");

  const components = await harness.command("get_local_components", {
    summary: true,
    familyLimit: 10,
    sessionLimit: 10,
  });
  assert.equal(components.complete, true);
  assert.equal(components.count, 4);
  assert.equal(
    components.pages.reduce((sum, page) => sum + page.componentCount, 0),
    components.count,
  );
  assert.equal(
    components.nameFamilies.reduce((sum, family) => sum + family.count, 0),
    components.count,
  );
  assert.equal(
    components.authoringSessions.reduce((sum, session) => sum + session.count, 0),
    components.count,
  );

  const tokens = await harness.command("get_node_variables", { nodeId: "10:1" });
  assert.equal(tokens.complete, true);
  assert.equal(tokens.nodesScanned, 3);
  assert.equal(tokens.bindingCount, tokens.bindings.length);
  assert.equal(tokens.styleCount, tokens.styles.length);
  assert.equal(tokens.unresolvedBindings, 0);
  assert.equal(tokens.unresolvedStyles, 0);
  assert.ok(tokens.bindings.some((binding) => binding.variableName === "Color/Primary"));
  assert.ok(tokens.styles.some((style) => style.styleName === "Shadow/Small"));
});

test("style references carry their resolved value, including for remote library styles", async () => {
  const harness = await loadPluginHarness();
  const tokens = await harness.command("get_node_variables", { nodeId: "10:1" });

  const paint = tokens.styles.find((style) => style.styleName === "Brand/Primary");
  assert.equal(paint.styleType, "PAINT");
  assert.equal(paint.valueStatus, "resolved");
  assert.deepEqual(paint.value.paints, [
    { type: "SOLID", color: { r: 0.1, g: 0.2, b: 0.3 } },
  ]);

  const effect = tokens.styles.find((style) => style.styleName === "Shadow/Small");
  assert.equal(effect.valueStatus, "resolved");
  assert.equal(effect.value.effects.length, 1);
  assert.equal(effect.value.effects[0].type, "DROP_SHADOW");

  // The load-bearing case. `atencao` lives in an external library, so every
  // getLocal*StylesAsync loader omits it: get_styles cannot supply its value, and the
  // get_node_info join that used to be the only fallback reaches a fraction of the
  // nodes this scan visits. The value has to arrive on the reference itself.
  const styles = await harness.command("get_styles");
  const localPaintNames = styles.colors.map((style) => style.name);
  assert.ok(
    !localPaintNames.includes("atencao"),
    "the remote style must not be reachable through get_styles",
  );

  const remote = tokens.styles.find((style) => style.styleName === "atencao");
  assert.ok(remote, "the remote style reference must still resolve by ID");
  assert.equal(remote.remote, true);
  assert.equal(remote.resolutionStatus, "resolved");
  assert.equal(remote.valueStatus, "resolved");
  assert.deepEqual(remote.value.paints, [
    { type: "SOLID", color: { r: 0.94, g: 0.62, b: 0.13 } },
  ]);
});

test("a style whose value cannot be read says so instead of reporting no value", async () => {
  const harness = await loadPluginHarness();
  const tokens = await harness.command("get_node_variables", { nodeId: "10:1" });

  // Every resolved reference must state a value status, so an absent `value` is never
  // ambiguous between "this style has none" and "this build could not read it".
  for (const style of tokens.styles) {
    if (style.resolutionStatus === "resolved") {
      assert.ok(
        ["resolved", "unsupported_style_type", "read_failed"].includes(style.valueStatus),
        `${style.styleName} reported valueStatus ${style.valueStatus}`,
      );
    } else {
      assert.equal(style.valueStatus, "not_applicable");
      assert.equal(style.value, null);
    }
  }
});

test("raster export preflight reports scaled pixel cost and encoding progress", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("export_node_as_image", {
    nodeId: "10:4",
    format: "PNG",
    scale: 2,
    commandId: "export-small",
  });

  assert.equal(result.preflight.nodeWidth, 100);
  assert.equal(result.preflight.nodeHeight, 100);
  assert.equal(result.preflight.projectedWidth, 200);
  assert.equal(result.preflight.projectedHeight, 200);
  assert.equal(result.preflight.projectedMegapixels, 0.04);
  assert.equal(result.preflight.megapixelLimit, 16);
  assert.equal(result.preflight.limitApplied, true);
  assert.equal(result.preflight.overLimit, false);
  assert.equal(result.preflight.overrideUsed, false);

  const progress = harness.messages.filter(
    (message) =>
      message.type === "command_progress" &&
      message.commandId === "export-small",
  );
  assert.deepEqual(
    progress.map((message) => message.status),
    ["started", "in_progress", "completed"],
  );
  assert.equal(progress[0].payload.preflight.projectedMegapixels, 0.04);
  assert.equal(harness.exportCalls.length, 1);
  assert.deepEqual(harness.exportCalls[0], {
    nodeId: "10:4",
    settings: {
      format: "PNG",
      constraint: { type: "SCALE", value: 2 },
    },
  });
});

test("raster export preflight refuses an implicit over-limit request before exportAsync", async () => {
  const harness = await loadPluginHarness();
  harness.getNode("10:4").resize(5000, 5000);

  await assert.rejects(
    () => harness.command("export_node_as_image", {
      nodeId: "10:4",
      format: "PNG",
      scale: 1,
    }),
    /projects to 5000x5000 \(25 MP\), above the 16 MP safety ceiling/,
  );
  assert.equal(
    harness.exportCalls.length,
    0,
    "the guard must run before Figma begins an export that cannot be cancelled",
  );
});

test("an explicit large-export override is auditable and vector exports are not pixel-capped", async () => {
  const raster = await loadPluginHarness();
  raster.getNode("10:4").resize(5000, 5000);
  const overridden = await raster.command("export_node_as_image", {
    nodeId: "10:4",
    format: "JPG",
    scale: 1,
    allowLargeExport: true,
  });
  assert.equal(overridden.preflight.overLimit, true);
  assert.equal(overridden.preflight.overrideUsed, true);
  assert.equal(raster.exportCalls.length, 1);

  const vector = await loadPluginHarness();
  vector.getNode("10:4").resize(5000, 5000);
  const svg = await vector.command("export_node_as_image", {
    nodeId: "10:4",
    format: "SVG",
    scale: 1,
  });
  assert.equal(svg.preflight.projectedMegapixels, 25);
  assert.equal(svg.preflight.limitApplied, false);
  assert.equal(svg.preflight.overLimit, false);
  assert.equal(svg.preflight.overrideUsed, false);
  assert.equal(vector.exportCalls.length, 1);
});

test("time budgets and missing page IDs cannot masquerade as complete component counts", async () => {
  const harness = await loadPluginHarness();
  const budgeted = await harness.command("get_local_components", {
    summary: true,
    timeBudgetMs: 1,
  });
  assert.equal(budgeted.complete, false);
  assert.equal(budgeted.pagesScanned, 1);
  assert.equal(budgeted.pagesSkipped.length, 1);
  assert.match(budgeted.limitations.join("\n"), /Time budget/);

  const missing = await harness.command("get_local_components", {
    pages: ["missing-page"],
  });
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.pagesNotFound, ["missing-page"]);
  assert.match(missing.limitations.join("\n"), /do not exist/);
});

test("unsupported and partial APIs return explicit limitations", async () => {
  const unsupported = await loadPluginHarness({
    variablesApi: false,
    stylesApi: false,
  });
  const variables = await unsupported.command("get_variables");
  assert.equal(variables.supported, false);
  assert.equal(variables.complete, false);
  assert.match(variables.limitation, /not available/);

  const tokens = await unsupported.command("get_node_variables", { nodeId: "10:1" });
  assert.equal(tokens.complete, false);
  assert.equal(tokens.variablesSupported, false);
  assert.equal(tokens.stylesSupported, false);
  assert.equal(tokens.limitations.length, 2);

  const partial = await loadPluginHarness({ variableTypeErrors: ["FLOAT"] });
  const partialVariables = await partial.command("get_variables");
  assert.equal(partialVariables.complete, false);
  assert.equal(partialVariables.errors.length, 1);
  assert.match(partialVariables.limitations.join("\n"), /could not be read/);

  const styleFailure = await loadPluginHarness({ styleLoaderErrors: ["effects"] });
  await assert.rejects(() => styleFailure.command("get_styles"), /effect styles unavailable/);
});

test("missing nodes/pages and invalid write targets fail explicitly", async () => {
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("get_node_info", { nodeId: "missing-node" }),
    /Node not found/,
  );
  await assert.rejects(
    () => harness.command("set_current_page", { pageId: "missing-page" }),
    /Page not found/,
  );
  await assert.rejects(
    () => harness.command("get_node_info", { nodeId: "0:0" }),
    /Document-root reads are not supported/,
  );
  await assert.rejects(
    () => harness.command("set_text_content", { nodeId: "10:4", text: "No" }),
    /not a text node/,
  );
});

test("offline read/write smoke creates, reads, mutates, and removes only isolated nodes", async () => {
  const harness = await loadPluginHarness();
  const frame = await harness.command("create_frame", {
    x: 1200,
    y: 1200,
    width: 320,
    height: 180,
    name: "R0 Offline Smoke",
    layoutMode: "VERTICAL",
    itemSpacing: 12,
  });
  const text = await harness.command("create_text", {
    x: 16,
    y: 16,
    text: "R0 smoke text",
    name: "R0 Smoke Text",
    parentId: frame.id,
  });

  const readBack = await harness.command("get_node_info", { nodeId: frame.id });
  assert.equal(readBack.name, "R0 Offline Smoke");
  assert.ok(readBack.children.some((child) => child.id === text.id));

  const padded = await harness.command("set_padding", {
    nodeId: frame.id,
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
    paddingLeft: 20,
  });
  assert.equal(padded.paddingTop, 20);

  const image = await harness.command("set_image_fill", {
    nodeId: "10:4",
    imageBase64: "iVBORw==",
    scaleMode: "FIT",
  });
  assert.equal(image.scaleMode, "FIT");
  assert.equal(harness.getNode("10:4").fills[0].type, "IMAGE");

  await harness.command("delete_node", { nodeId: text.id });
  await harness.command("delete_node", { nodeId: frame.id });
  assert.equal(harness.getNode(text.id), null);
  assert.equal(harness.getNode(frame.id), null);
  assert.ok(harness.getNode("10:4"), "pre-existing fixture nodes must remain");
});
