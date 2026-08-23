/**
 * R2.7 Phase 2 — `create_node_from_svg`.
 *
 * ⚠️ **WHAT THESE TESTS DO NOT CLAIM.** The harness's `createNodeFromSvg` models STRUCTURE,
 * not Figma's parser: how many nodes a given SVG expands into is a platform fact this suite
 * cannot know, and guessing it would be the fiction R2.6 item 2.3 shipped. So every assertion
 * below is about the TOOL — that it counts whatever subtree it was handed, bounds its input,
 * validates before creating, and declares its own non-idempotency. ⛔ Do not add an assertion
 * that a particular SVG yields a particular node count; that belongs to the live gate.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  EXCLUDED_BATCH_OPERATIONS,
  V1_BATCH_OPERATIONS,
} from "../src/talk_to_figma_mcp/batch-receipt.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

const SVG = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/><circle r="3"/></svg>';
const TEXT_NODE = "10:2"; // TEXT — accepts no children
const PAGE = "1:1"; // the fixture's currentPageId — where an un-parented create lands

test("create_node_from_svg returns the created frame and counts its whole subtree", async () => {
  const harness = await loadPluginHarness();
  const result = await harness.command("create_node_from_svg", { svg: SVG, x: 12, y: 34 });

  assert.equal(result.type, "FRAME");
  assert.equal(result.x, 12);
  assert.equal(result.y, 34);
  assert.equal(result.svgSourceLength, SVG.length);

  // ⭐ The count is checked against the tree the harness actually built, not against a
  // number written into this test — so it measures the tool's traversal, and it keeps
  // working if the fake's shape ever changes.
  const created = harness.getNode(result.id);
  const expected = 1 + created.children.length;
  assert.equal(result.createdNodeCount, expected);
  assert.ok(expected > 1, "the fixture SVG must produce a real subtree, or this proves nothing");
});

test("the receipt DECLARES non-idempotency, and a second call really does duplicate", async () => {
  // ⛔ The plan's rule for this item was that the duplication is stated rather than silent.
  // `duplicatesOnRerun` is asserted alongside the behaviour it describes, so the flag cannot
  // drift into being a comment that no longer matches the tool.
  const harness = await loadPluginHarness();
  const first = await harness.command("create_node_from_svg", { svg: SVG });
  const second = await harness.command("create_node_from_svg", { svg: SVG });

  assert.equal(first.duplicatesOnRerun, true);
  assert.equal(second.duplicatesOnRerun, true);
  assert.notEqual(first.id, second.id, "a rerun must create a SECOND subtree, not reuse one");
});

test("an oversized SVG is refused, and the ceiling is on the SOURCE", async () => {
  const harness = await loadPluginHarness();
  const oversized = `<svg>${"x".repeat(512 * 1024)}</svg>`;
  await assert.rejects(
    () => harness.command("create_node_from_svg", { svg: oversized }),
    /this fork's ceiling is 524288/,
  );
  // ⭐ The message must say WHY the bound is on the source — a caller who hits it needs to
  // know node count cannot be preflighted, or the obvious next move is to ask for a node cap.
  await assert.rejects(
    () => harness.command("create_node_from_svg", { svg: oversized }),
    /no way to preflight how many nodes/,
  );
});

test("empty, non-string and unparseable sources are refused and create nothing", async () => {
  for (const svg of [undefined, null, "", 42, {}]) {
    const harness = await loadPluginHarness();
    const before = harness.getNode(PAGE).children.length;
    await assert.rejects(
      () => harness.command("create_node_from_svg", { svg }),
      /requires svg, a non-empty string/,
    );
    assert.equal(harness.getNode(PAGE).children.length, before);
  }

  // Figma's parser is the authority on validity; the tool must surface its refusal rather
  // than pre-judging the source itself.
  const harness = await loadPluginHarness();
  await assert.rejects(
    () => harness.command("create_node_from_svg", { svg: "not markup at all" }),
    /Figma rejected the SVG source and created nothing/,
  );
});

test("a non-finite position is refused BEFORE anything is created", async () => {
  for (const [key, value] of [["x", Infinity], ["y", NaN], ["x", "10"]]) {
    const harness = await loadPluginHarness();
    const before = harness.getNode(PAGE).children.length;
    await assert.rejects(
      () => harness.command("create_node_from_svg", { svg: SVG, [key]: value }),
      new RegExp(`requires ${key} to be a finite number`),
    );
    assert.equal(
      harness.getNode(PAGE).children.length,
      before,
      "validate-all-then-create: a bad position must not leave a parsed subtree behind",
    );
  }
});

test("an unusable parentId is refused BEFORE the node is created, leaving no orphan", async () => {
  // ⭐ This is the assertion that distinguishes validate-then-create from create-then-parent.
  // On a create tool the second ordering leaves a stray subtree on the current page every
  // time the parent turns out to be wrong — the exact failure `create_text` was built to avoid.
  const harness = await loadPluginHarness();
  const before = harness.getNode(PAGE).children.length;

  await assert.rejects(
    () => harness.command("create_node_from_svg", { svg: SVG, parentId: "nope:1" }),
    /Parent node not found with ID: nope:1 — created nothing/,
  );
  assert.equal(harness.getNode(PAGE).children.length, before);

  await assert.rejects(
    () => harness.command("create_node_from_svg", { svg: SVG, parentId: TEXT_NODE }),
    /accepts no children, and created nothing/,
  );
  assert.equal(harness.getNode(PAGE).children.length, before);
});

test("a refused name REMOVES the node Figma had already parsed", async () => {
  // ⚠️ `name` is the one field that cannot be validated before Figma parses the source, so
  // the refusal has to clean up after itself. Without the remove(), a rejected call would
  // still leave the subtree in the document — a refusal that mutates is the worst of both.
  const harness = await loadPluginHarness();
  const before = harness.getNode(PAGE).children.length;

  await assert.rejects(
    () => harness.command("create_node_from_svg", { svg: SVG, name: "" }),
    /removed the node it had created/,
  );
  assert.equal(
    harness.getNode(PAGE).children.length,
    before,
    "the parsed subtree must not survive a refused name",
  );
});

test("create_node_from_svg is absent from the v1 batch allowlist, with a reason on the record", async () => {
  assert.ok(
    !V1_BATCH_OPERATIONS.includes("create_node_from_svg"),
    "v1 is mutate-only; a create must not appear in the allowlist",
  );
  assert.match(
    EXCLUDED_BATCH_OPERATIONS.create_node_from_svg,
    /duplicates its whole subtree on rerun/,
    "the exclusion must record the idempotency reason, not only the mutate-only rule",
  );
});

test("the batch exclusion list is mirrored in code.js, not merely declared server-side", async () => {
  // The plugin sandbox cannot import, so the vocabulary lives twice. A parity check here
  // stops the two copies drifting — which is how a tool ends up excluded on one side only.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../src/cursor_mcp_plugin/code.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /create_node_from_svg:\s*\n?\s*"v1 is mutate-only/);
});
