/**
 * R2 acceptance fixture — offline guards for the live, disposable runner.
 *
 * These tests deliberately do not simulate Figma rendering. Their job is to keep the
 * artifact honest between live runs: the fixture remains fork-only, names every promoted
 * receipt, and cannot quietly lose a required create/edit/read leg.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildContract } from "../scripts/contract-lib.mjs";
import {
  R2_ACCEPTANCE_FIXTURE,
  R2_ACCEPTANCE_PROMOTED_TO_STABLE,
  R2_ACCEPTANCE_REPLY_SHAPES,
  R2_ACCEPTANCE_REQUIRED_TOOLS,
} from "../scripts/r2-acceptance-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Split `server.ts` into one block per registered tool. The reply shape is read back out of
 * the source on every run rather than pinned once, because a declaration that was verified
 * by a single live run is a reading, not a pin — the next tool that gains a receipt would
 * otherwise leave the fixture grading it under the old shape and still reporting green.
 */
function readReplyShapesFromServer(source) {
  const lines = source.split("\n");
  const starts = lines.flatMap((line, index) => (/server\.tool\(/.test(line) ? [index] : []));
  const shapes = new Map();
  for (const [order, start] of starts.entries()) {
    const end = starts[order + 1] ?? lines.length;
    const block = lines.slice(start, end).join("\n");
    const name = block.match(/server\.tool\(\s*\n?\s*"([a-z_]+)"/)?.[1];
    if (!name) continue;
    const hasReply = /\btext:\s*\S/.test(block);
    shapes.set(name, {
      hasReply,
      shape: /\btext:\s*JSON\.stringify\(/.test(block) ? "receipt" : "prose",
    });
  }
  return shapes;
}

test("R2 acceptance freezes exactly the five R2.7 additive receipts", async () => {
  assert.deepEqual(R2_ACCEPTANCE_PROMOTED_TO_STABLE, [
    "set_fill",
    "set_effects",
    "set_opacity",
    "set_blend_mode",
    "create_node_from_svg",
  ]);
  assert.equal(new Set(R2_ACCEPTANCE_PROMOTED_TO_STABLE).size, 5);

  const built = await buildContract();
  for (const name of R2_ACCEPTANCE_PROMOTED_TO_STABLE) {
    const tool = built.contract.tools.find((entry) => entry.name === name);
    assert.ok(tool, `${name} must remain published`);
    assert.equal(
      tool.resultStability,
      "stable",
      `${name} is frozen only after the R2 acceptance fixture exists`,
    );
  }
});

test("the fixture has no hidden consumer dependency and covers create, edit, batch, read, and cleanup", async () => {
  const source = await readFile(
    path.join(root, "scripts/r2-acceptance-fixture.mjs"),
    "utf8",
  );

  // The manifest is a contract with the runner, not a list of hoped-for tools: each must
  // be published by the local fork and the runner must mention it in an actual MCP call.
  const built = await buildContract();
  const published = new Set(built.contract.tools.map((tool) => tool.name));
  assert.equal(new Set(R2_ACCEPTANCE_REQUIRED_TOOLS).size, R2_ACCEPTANCE_REQUIRED_TOOLS.length);
  const calledTools = new Set(
    [...source.matchAll(/(?:callJson|callProse|callNode|call)\(\s*"([^"]+)"/g)].map((match) => match[1]),
  );
  assert.deepEqual(
    [...calledTools].sort(),
    [...R2_ACCEPTANCE_REQUIRED_TOOLS].sort(),
    "the manifest must name every fork tool the fixture actually calls",
  );
  for (const name of R2_ACCEPTANCE_REQUIRED_TOOLS) {
    assert.ok(published.has(name), `${name} is not a fork tool`);
    assert.match(
      source,
      new RegExp(`(?:callJson|callProse|callNode|call)\\(\\s*\\"${name}\\"`),
      `${name} is declared but no longer exercised by the fixture`,
    );
  }

  for (const name of [
    "create_page",
    "create_frame",
    "create_text",
    "set_fill",
    "set_effects",
    "set_opacity",
    "set_blend_mode",
    "create_node_from_svg",
    "apply_batch",
    "get_node_info",
    "get_document_info",
    "export_node_as_image",
    "delete_node",
  ]) {
    assert.match(source, new RegExp(`(?:callJson|callProse|callNode|call)\\(\\s*\\"${name}\\"`));
  }
  assert.match(source, /batch\.outcome, "all_succeeded"/);
  assert.match(source, /batch\.succeeded, 4/);
  assert.match(
    source,
    /get_document_info", \{ limit: 20, summary: false \}/,
    "the page read must include its bounded child list before asserting the card exists",
  );
  assert.match(source, /baselineRestored/);
});

test("every declared reply shape still matches what server.ts actually constructs", async () => {
  const serverSource = await readFile(
    path.join(root, "src/talk_to_figma_mcp/server.ts"),
    "utf8",
  );
  const observed = readReplyShapesFromServer(serverSource);

  // A registration the parser cannot find would silently drop that tool from the check, so
  // coverage is asserted before the shapes are compared rather than inferred from a pass.
  const declared = Object.keys(R2_ACCEPTANCE_REPLY_SHAPES);
  assert.ok(declared.length >= 21, "the declaration must cover every shaped call the fixture makes");
  for (const name of declared) {
    const entry = observed.get(name);
    assert.ok(entry, `server.ts registration for ${name} was not found — the parser has drifted`);
    assert.ok(entry.hasReply, `${name} was parsed without any reply text`);
    assert.equal(
      entry.shape,
      R2_ACCEPTANCE_REPLY_SHAPES[name],
      `${name} answers with a ${entry.shape} but the fixture grades it as a ${R2_ACCEPTANCE_REPLY_SHAPES[name]}`,
    );
  }

  // The split is the finding, not an implementation detail: the five R2.6 layout tools
  // predate the receipt convention and publish only the node name they echo.
  assert.deepEqual(
    declared.filter((name) => R2_ACCEPTANCE_REPLY_SHAPES[name] === "prose").sort(),
    ["set_axis_align", "set_item_spacing", "set_layout_mode", "set_layout_sizing", "set_padding"],
  );

  // Both parsers must be reachable, and neither may accept the other's shape.
  const fixtureSource = await readFile(
    path.join(root, "scripts/r2-acceptance-fixture.mjs"),
    "utf8",
  );
  assert.match(fixtureSource, /answered in prose/, "callJson must refuse a prose reply");
  assert.match(fixtureSource, /now answers with a structured receipt/, "callProse must refuse a receipt");
});

test("the fixture is a self-contained UI component rather than a borrowed ComponentNode", () => {
  assert.match(R2_ACCEPTANCE_FIXTURE.componentName, /^Card \/ /);
  assert.notEqual(R2_ACCEPTANCE_FIXTURE.componentName, R2_ACCEPTANCE_FIXTURE.editedComponentName);
  assert.notEqual(R2_ACCEPTANCE_FIXTURE.title, R2_ACCEPTANCE_FIXTURE.editedTitle);
  assert.equal(R2_ACCEPTANCE_FIXTURE.gradient.length, 2);
  assert.deepEqual(
    R2_ACCEPTANCE_FIXTURE.gradient.map((stop) => stop.position),
    [0, 1],
  );
  assert.equal(R2_ACCEPTANCE_FIXTURE.shadow.type, "DROP_SHADOW");
  assert.match(R2_ACCEPTANCE_FIXTURE.iconSvg, /<svg[\s>]/);
});
