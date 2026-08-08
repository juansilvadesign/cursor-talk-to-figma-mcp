// R1: the read-layer acceptance cases from docs/READ-LAYER-PLAN.md, promoted from a
// prose table into a maintained suite.
//
// Those cases were established against real files (`dyRJx7ExmpALroOpjAjHi6`,
// `iRVBeN1n4ORWJMgh5ERDLA`) whose absolute numbers — 826 children, 46 authoring
// sessions, 45 bindings — cannot be reproduced offline and are not the point. What each
// case actually proved is a structural invariant, and that is what is asserted here so a
// regression fails in CI rather than on a consumer's file.
//
// Every test names the READ-LAYER-PLAN case it derives from.

import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

test("M5.2 — the childTypes rollup describes every child, not the returned slice", async () => {
  // Live: limit:2 on an 826-child page still summed childTypes to exactly 826.
  const harness = await loadPluginHarness();
  const bounded = await harness.command("get_document_info", {
    summary: true,
    limit: 2,
    offset: 0,
  });

  assert.equal(bounded.children.length, 2);
  assert.equal(bounded.childrenTruncated, true);
  assert.equal(
    bounded.childTypes.reduce((sum, entry) => sum + entry.count, 0),
    bounded.currentPage.childCount,
    "a rollup that only described the slice would silently under-report the page",
  );
});

test("M5.2 — summary:false drops the rollups instead of returning stale ones", async () => {
  const harness = await loadPluginHarness();
  const plain = await harness.command("get_document_info", {
    summary: false,
    limit: 2,
    offset: 0,
  });

  assert.ok(!("childTypes" in plain));
  assert.ok(!("childFamilies" in plain));
  assert.ok(!("childFamilyCount" in plain));
});

test("M5.2 — offsets return disjoint contiguous slices and the tail closes hasMore", async () => {
  const harness = await loadPluginHarness();
  const [head, next] = await Promise.all([
    harness.command("get_document_info", { summary: true, limit: 2, offset: 0 }),
    harness.command("get_document_info", { summary: true, limit: 2, offset: 2 }),
  ]);

  const headIds = head.children.map((child) => child.id);
  const nextIds = next.children.map((child) => child.id);
  assert.equal(headIds.length, 2);
  assert.equal(nextIds.length, 2);
  assert.equal(
    headIds.filter((id) => nextIds.includes(id)).length,
    0,
    "consecutive pages must not overlap",
  );

  const childCount = head.currentPage.childCount;
  const tail = await harness.command("get_document_info", {
    summary: true,
    limit: 5,
    offset: childCount - 2,
  });
  assert.equal(tail.pagination.returned, 2);
  assert.equal(tail.pagination.hasMore, false);
});

test("M5.2 — familyLimit caps the listing while preserving the true family count", async () => {
  // Live: familyLimit:3 capped the list but kept childFamilyCount:74.
  const harness = await loadPluginHarness();
  const capped = await harness.command("get_document_info", {
    summary: true,
    limit: 2,
    offset: 0,
    familyLimit: 1,
  });

  assert.equal(capped.childFamilies.length, 1);
  assert.equal(capped.childFamiliesTruncated, true);
  assert.ok(
    capped.childFamilyCount > capped.childFamilies.length,
    "the total family count must survive the cap",
  );
});

test("M5.1 — sessionLimit and familyLimit cap by volume and admit truncation", async () => {
  // Live: sessionLimit:3 returned 3 of sessionCount:46, sorted 1,345 / 1,080 / 365.
  const harness = await loadPluginHarness();
  const capped = await harness.command("get_local_components", {
    summary: true,
    sessionLimit: 1,
    familyLimit: 1,
  });

  assert.equal(capped.authoringSessions.length, 1);
  assert.equal(capped.sessionsTruncated, true);
  assert.ok(capped.sessionCount > capped.authoringSessions.length);
  assert.equal(capped.familiesTruncated, true);
  assert.ok(capped.familyCount > capped.nameFamilies.length);

  const byVolume = await harness.command("get_local_components", {
    summary: true,
    sessionLimit: 10,
  });
  const counts = byVolume.authoringSessions.map((session) => session.count);
  assert.deepEqual(
    counts,
    [...counts].sort((left, right) => right - left),
    "sessions must be ordered by volume so a cap keeps the largest",
  );
});

test("M5.3 — a scoped component read reports scope and withholds document totals", async () => {
  // Live: no pageCount; limitation read "Scoped to 3 requested page(s); 3 scanned of 6".
  const harness = await loadPluginHarness();
  const scoped = await harness.command("get_local_components", {
    pages: ["1:1"],
    summary: true,
  });

  assert.ok(
    !("pageCount" in scoped),
    "a scoped read must not present a document-wide page count",
  );
  assert.equal(scoped.pagesRequested, 1);
  assert.equal(scoped.pagesScanned, 1);
  assert.ok(scoped.pagesTotal > scoped.pagesScanned);
  assert.match(scoped.limitations.join("\n"), /Scoped to 1 requested page\(s\)/);
  assert.match(scoped.limitations.join("\n"), /not a document total/);
});

test("M1.1 — get_node_info preserves boundVariables with the id resolved to a name", async () => {
  // This is the read whose silence produced the false "no design tokens" verdict.
  // It passes only because filterFigmaNode() no longer deletes the field, and it must
  // keep the hex and the binding together.
  const harness = await loadPluginHarness();
  const node = await harness.command("get_node_info", { nodeId: "10:2" });

  assert.deepEqual(node.boundVariables.fontSize, {
    id: "var-space",
    name: "Space/24",
  });

  const fill = node.fills[0];
  assert.equal(fill.color, "#1a334d", "the resolved hex must survive alongside the binding");
  assert.deepEqual(fill.boundVariables.color, {
    id: "var-primary",
    name: "Color/Primary",
  });
});

test("remote:false is now exercised — the local-style branch is no longer an inference", async () => {
  // READ-LAYER-PLAN flagged this as UNPROVEN: every subtree checked live returned either
  // all-remote styles or none, so the local branch had never been observed. The R1
  // fixture consumes one local style and one remote style in the same scan, which
  // exercises both sides of figma's style.remote passthrough.
  //
  // Scope of the claim: this proves the code path, offline. Opportunistic confirmation
  // on a live file with a local style in use is still worth taking when one appears.
  const harness = await loadPluginHarness();
  const tokens = await harness.command("get_node_variables", { nodeId: "10:1" });

  const local = tokens.styles.find((style) => style.styleName === "Brand/Primary");
  const remote = tokens.styles.find((style) => style.styleName === "atencao");

  assert.equal(local.remote, false, "a local style must report remote:false");
  assert.equal(remote.remote, true, "a library style must report remote:true");
  assert.equal(local.resolutionStatus, "resolved");
  assert.equal(remote.resolutionStatus, "resolved");
  assert.notEqual(
    local.remote,
    remote.remote,
    "both branches must be observed in one scan for the flag to mean anything",
  );
});

test("get_annotations on a page returns a typed empty result rather than an error", async () => {
  const harness = await loadPluginHarness();
  const annotations = await harness.command("get_annotations", { nodeId: "1:1" });

  assert.equal(annotations.type, "PAGE");
  assert.equal(annotations.annotationCount, 0);
  assert.deepEqual(annotations.annotations, []);
  assert.deepEqual(annotations.categories, []);
});

test("get_pages with opt-in child counts completes for every page", async () => {
  // Live: includeChildCount completed for all six KAT pages; the plan had flagged that
  // cost as unmeasured. The invariant is that the opt-in is answered for every page.
  const harness = await loadPluginHarness();
  const pages = await harness.command("get_pages", { includeChildCount: true });

  assert.equal(pages.pages.length, pages.pageCount);
  assert.ok(
    pages.pages.every((page) => typeof page.childCount === "number"),
    "every page must carry a child count when the opt-in is requested",
  );
});

test("reads declare their scope and completeness", async () => {
  // The cross-cutting rule the whole read layer exists to satisfy: partial coverage is
  // visible in the result, never inferred from its absence.
  const harness = await loadPluginHarness();

  const [document, components, tokens, reactions] = await Promise.all([
    harness.command("get_document_info", { summary: true, limit: 2 }),
    harness.command("get_local_components", { summary: true }),
    harness.command("get_node_variables", { nodeId: "10:1" }),
    harness.command("get_reactions", { nodeIds: ["10:1"] }),
  ]);

  for (const result of [document, components, tokens, reactions]) {
    assert.ok(typeof result.scope === "string" && result.scope.length > 0);
  }
  for (const result of [components, tokens, reactions]) {
    assert.equal(typeof result.complete, "boolean");
  }
  assert.equal(typeof document.pagination.hasMore, "boolean");
});
