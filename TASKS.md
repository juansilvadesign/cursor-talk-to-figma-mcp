# Talk to Figma Fork — Code → Figma Build Task Tracker

> **Open this first for Code → Figma work.** Check a box only when its acceptance
> evidence exists. Strategy and deferred/v2+ scope live in
> [`ROADMAP.md`](ROADMAP.md); the completed read-layer work and upstream PR sequence
> remain in [`docs/READ-LAYER-PLAN.md`](docs/READ-LAYER-PLAN.md).
>
> **Baselined 2026-07-28 at `956a6af`.** The fork has a strong local read layer and
> useful write primitives. It does **not** yet have a normalized scene contract,
> idempotent batch writer, complete typography/layout/style authoring, durable test
> harness, or a Code → Figma acceptance fixture.

## Two levels of done — do not conflate them

- **Authoring primitives — available, not a pipeline.** The fork can create frames,
  rectangles, text, sections, images, and component instances; it can style, move,
  resize, parent, and auto-layout nodes. An agent still has to orchestrate many
  fragile calls and recover manually.
- **Code → Figma MVP — NOT shipped.** One authorized built page must become editable
  desktop/mobile Figma frames through a deterministic, resumable scene application,
  then pass read-back and visual acceptance.
- **Design-system-native MVP — NOT shipped.** Variables, styles, components, variants,
  and instances must be authored from evidence rather than flattened into raw values.

## Planning frame

- **Outcome:** authorized rendered code + a validated OpenDesign package → an editable,
  evidence-backed Figma page that can be reproduced without guessed values or manual
  repair.
- **Fixed capacity/budget:** one maintainer, the existing local Figma DEV plugin,
  local relay, local MCP server, and checked-in sibling artifacts. MVP must not require
  a hosted service or paid API.
- **Planning horizon:** one release at a time. No calendar deadline was supplied, so
  this tracker does not invent dates for later releases.
- **Scope is the variable:** preserve write safety, evidence, idempotency, and fresh
  acceptance. Cut node types, effects, automation, or fixture breadth when they
  threaten the next useful release.
- **MVP source boundary:** consume a rendered, normalized scene derived from the
  cloner/OpenDesign artifacts. Do not parse arbitrary framework source inside the
  Figma plugin.
- **MVP write boundary:** create or update only a dedicated generated page/root whose
  nodes carry this pipeline's ownership namespace.

## Pinned reuse baselines

| Dependency | Baseline inspected 2026-07-28 | Reuse here |
| --- | --- | --- |
| **This fork** | `956a6af` | Local relay/server/plugin, 48 registered MCP tools, read integrity, bounded document reads, progress/timeout behavior, and current write primitives |
| [`ai-website-cloner-template`](../ai-website-cloner-template/) | `b7b4dda` (`0.4.0` generic baseline) | Validated OpenDesign emitter/validator, `tokens.source.json`, `design-tokens.json`, component manifest, page topology/spec workflow, real assets/content, and 1440px/390px browser evidence |
| [`figma-to-code`](../figma-to-code/) | `1e3b3ff` | Immutable evidence bundles, normalized intermediate contract, deterministic offline replay, explicit completeness, and second-fixture generalization gate |
| [`open-design`](../../skills/open-design/) | `3447f60a3` | Live token schema, layers, aliases, renderers, and validation contracts; discover them at runtime rather than encoding the observed slot count |

**Reuse rule:** vendor or copy a generic artifact only from a named commit, record its
provenance, and test parity. Never import across sibling repositories at runtime or
copy a sibling's brand-specific working tree wholesale.

**Runtime rule:** until a newer package is independently verified, live work uses the
fork's built `dist/server.js`, the **Talk to Figma (fork)** DEV plugin, and the local
relay. `bunx cursor-talk-to-figma-mcp@latest` is not an acceptable silent fallback.

## Benefit-delivering release sequence

| Release | Value shipped | Riskiest assumption retired |
| --- | --- | --- |
| **R0 — Safe proof loop** | A small source-backed scene is authored on an isolated page, read back, and exported with a durable run record | The existing transport and primitives can support a repeatable write harness safely |
| **R1 — Static page MVP** | One authorized page becomes editable desktop/mobile frames with real text, assets, responsive layout, and comparison evidence | A normalized scene plus additive write tools can reproduce a real page without call-by-call fragility |
| **R2 — Design-system-native MVP** | The page uses local variables/styles and component instances created from the same source evidence | OpenDesign semantics map honestly onto Figma authoring capabilities and plan limits |
| **R3 — Generalized release** | A second unrelated source passes deterministic replay, idempotency, QA, docs, and release checks | The implementation generalizes beyond its first fixture |

After every release: save the evidence, record the retrospective, re-rank
[`ROADMAP.md`](ROADMAP.md), and detail only the next release.

---

## ✅ Existing foundation

### Read integrity and verification support

- [x] Honest document/page navigation: `get_pages`, bounded
      `get_document_info`, and `set_current_page`.
- [x] Variables, style references, and node bindings: `get_variables`,
      `get_styles`, and `get_node_variables`.
- [x] Bounded component inventory with scope, pagination, family rollups, and
      authoring-session clusters.
- [x] Typed coverage/completeness and declared limitations on the read paths used by
      the sibling Figma importer.
- [x] Read-layer acceptance against real large files, recorded in
      [`docs/READ-LAYER-PLAN.md`](docs/READ-LAYER-PLAN.md).

### Existing authoring primitives

- [x] Create `FRAME`, `RECTANGLE`, `TEXT`, and `SECTION` nodes.
- [x] Move, resize, clone, rename, reparent, focus, select, and delete nodes.
- [x] Set solid fill, stroke, radius, and image fill.
- [x] Configure frame auto layout, wrap, padding, axis alignment, sizing, and gap.
- [x] Create existing component instances and copy/apply instance overrides.
- [x] Set single/batch text content and single/batch annotations.
- [x] Export PNG/JPG/SVG/PDF data and read the authored subtree back.

### Known constraints carried into this build

- [ ] There is no durable test suite or linter; `code.js` is a direct plugin runtime
      artifact and is not validated by `tsup`.
- [ ] `create_text` hardcodes Inter and does not expose the typography contract needed
      by a real page.
- [ ] Mixed-font text can fail `set_multiple_text_contents` with
      `loadFontAsync: Cannot unwrap symbol`.
- [ ] `set_image_fill` does not preserve the expected `CROP` behavior on the observed
      fixture; `FILL` and `FIT` are the reliable paths.
- [ ] Variables/styles can be read but not authored or bound.
- [ ] Components can be instantiated but not created, combined into variants, or
      given component properties.
- [ ] Narrow per-node tools have no shared idempotency, ownership, dry-run, resume, or
      write-receipt contract.
- [ ] `export_node_as_image` can flood the response with base64 rather than returning
      a compact file/hash artifact for QA.

### Existing upstream work

- [x] Fork-side page navigation/read-layer work exists and is locally validated.
- [ ] Keep PRs 2–5 from the read-layer upstream split tracked in
      [`docs/READ-LAYER-PLAN.md`](docs/READ-LAYER-PLAN.md); they do not block this
      Code → Figma build.
- [ ] Rebuild and verify `dist/` after any server change. Never infer that source and
      the installed runtime agree.

---

## ▶ Next session — start here (R0 only)

1. Freeze the scene/run artifact contract before adding another write command.
2. Promote the existing ad-hoc VM technique into a committed offline plugin harness.
3. Add server-schema ↔ plugin-dispatch parity checks so a half-registered tool cannot
   ship (the existing `pr-130` `set_font` branch is an example of an incomplete
   plugin-only implementation, not a patch to cherry-pick).
4. Exercise only the current primitives on a tiny, authorized fixture and record every
   mismatch. Do not begin the real page importer yet.
5. Stop R0 only when a clean checkout can build, run offline checks, execute the live
   smoke on a dedicated page, read it back, and save an export/receipt.

**Do not start `apply_scene` before the R0 contract and safety tests exist.** A
high-volume writer with an ambiguous ownership model would make retries more dangerous,
not more reliable.

---

## Release R0 — safe proof loop

### 0.1 Freeze ownership and artifact contracts

Define one immutable fixture and one mutable run record:

```text
fixtures/code-to-figma/<slug>/
  source-manifest.json
  source/
    design-system/          # copied/sanitized OpenDesign package
    page-topology.md
    components/
    reference/
      desktop.png
      mobile.png
  assets/
  scene/
    code-to-figma.scene.json
  expected/
    readback.summary.json

runs/code-to-figma/<slug>/<run-id>/
  plan.json                 # validation/dry-run result
  receipt.json              # clientId → Figma nodeId + per-node status
  readback.summary.json
  export.png
  comparison.png
```

- [ ] Add `docs/CODE-TO-FIGMA-CONTRACT.md` and version the scene, manifest, plan,
      receipt, and read-back schemas.
- [ ] Require stable `clientId` values independent of Figma node IDs.
- [ ] Record source project/commit/build, viewport, OpenDesign package/hash, asset
      hashes, extraction method, authorization note, and capture time.
- [ ] Give every authored value an evidence reference: token, component spec, DOM/
      browser measurement, source text, asset, or explicit override.
- [ ] Separate immutable source/scene evidence from run-specific Figma IDs and times.
- [ ] Define the ownership key as `namespace + clientId`; generated nodes must be
      recognizable without relying on mutable display names.
- [ ] Define target safety: dedicated page/root by default; an existing node is
      writable only when its ownership marker matches the requested namespace.
- [ ] Define failure semantics before implementation: validation errors write nothing;
      partial application returns a typed receipt that is safe to resume.
- [ ] Define scene limits for the proof fixture: supported node kinds, max nodes,
      max depth, max asset bytes, and allowed image formats.

Suggested minimum scene shape:

```jsonc
{
  "schemaVersion": "code-to-figma-scene/v1",
  "source": {
    "project": "...",
    "commit": "...",
    "viewports": [
      { "name": "desktop", "width": 1440 },
      { "name": "mobile", "width": 390 }
    ]
  },
  "target": { "pageName": "Generated / <slug>", "namespace": "<slug>@<commit>" },
  "tokens": {},
  "assets": {},
  "nodes": [
    {
      "clientId": "page/home/hero",
      "type": "FRAME",
      "parentClientId": null,
      "properties": {},
      "evidence": ["source/components/hero.spec.md"]
    }
  ]
}
```

### 0.2 Create a durable offline regression harness

- [ ] Add one documented test command to `package.json`; keep `bun run build`.
- [ ] Promote the real-`code.js` VM/stub approach used during the read-layer work into
      a committed harness rather than a session-only script.
- [ ] Add a dispatcher parity test: every non-connection `server.tool` command has a
      plugin handler, and every public plugin command has an MCP schema.
- [ ] Add schema tests for missing parents, duplicate `clientId`, cycles, unknown node
      kinds, unsafe targets, invalid colors/dimensions, missing assets, and over-limit
      scenes.
- [ ] Add contract tests for typed success, validation failure, partial failure, and
      retry receipts.
- [ ] Add `node --check src/cursor_mcp_plugin/code.js` to the documented verification
      command because `tsup` does not parse that file.
- [ ] Pin install/runtime dependencies with one authoritative lockfile and document
      why both `bun.lock` and `package-lock.json` currently exist before deleting or
      regenerating either.
- [ ] Keep all test logs free of channel names, local paths that reveal private client
      data, base64 images, and secrets.

### 0.3 Prove the current primitives before extending them

Use a tiny hand-authored scene: one page/section, nested auto-layout frames, heading,
body, button, colored card, and one image.

- [ ] Start the fork relay, built server, and DEV plugin; record the exact commit and
      tool schema served.
- [ ] Create a dedicated proof page/root without touching pre-existing design nodes.
      Until `create_page` exists, a human-created empty page is acceptable **for R0
      only** and must be recorded as manual setup.
- [ ] Build the fixture with current tools and save the ordered command/run record.
- [ ] Read the root back with `get_node_info`/`get_node_variables`; record which
      authored properties are missing from the read shape.
- [ ] Export the proof root and save the image outside model context.
- [ ] Repeat the same sequence once to quantify duplicates and identify the exact
      idempotency work R1 must own.
- [ ] Record current call count, elapsed time, largest payload, manual interventions,
      and every unsupported/substituted property.

### 0.4 R0 acceptance

- [ ] Clean install, build, plugin syntax check, and all offline tests pass.
- [ ] The proof fixture exists as editable nodes under an isolated root.
- [ ] Source scene, plan, command/write receipt, read-back summary, and export are
      durable and internally linked.
- [ ] No pre-existing Figma node was modified.
- [ ] The R0 retrospective converts measured gaps into the detailed R1 scope.

**R0 acceptance:** a new maintainer can reproduce the small fixture from the committed
contract and verify it without reverse-engineering a previous chat session.

---

## Release R1 — static page MVP

Detail this release after the R0 retrospective. Current boundary:

### 1.1 Add safe page and scene lifecycle tools

- [ ] Add `create_page` with explicit naming, duplicate-name behavior, and a compact
      typed response.
- [ ] Add `apply_scene` as a versioned, server-validated, batched write tool:
      `dryRun`, `create|upsert`, namespace, target page/root, nodes, and assets.
- [ ] Add `get_scene_state` to resolve ownership markers and return a compact
      `clientId → nodeId/hash/status` map without scanning unrelated pages.
- [ ] Validate the complete dependency graph before forwarding the first write.
- [ ] Persist ownership/source identity on generated roots/nodes through plugin data;
      display names are descriptive, not identity.
- [ ] Process parent-before-child batches, emit progress, and return per-node outcomes
      plus created/updated/skipped/failed totals.
- [ ] Make retries idempotent after a lost MCP reply. The same
      `namespace + clientId + source hash` must not duplicate nodes.
- [ ] Refuse updates/deletes outside the owned root and report the exact conflicting
      IDs.
- [ ] Bound node count, depth, asset bytes, and wall-clock budget. A bounded failure
      must be resumable from its receipt.
- [ ] Keep the narrow tools for repair/debugging; do not implement `apply_scene` as
      hundreds of MCP calls from the agent.

### 1.2 Close the typography gap

- [ ] Add `list_available_fonts` or an equivalent bounded font preflight.
- [ ] Extend text creation/application to accept font family/style/weight, size,
      line height, letter spacing, alignment, text case/decoration, paragraph spacing,
      and width/height resize behavior.
- [ ] Load every required font before changing characters or ranges.
- [ ] Fix single and batch content changes on mixed-font nodes; add a real regression
      fixture for the observed symbol-unwrapping failure.
- [ ] Define a deterministic font substitution map and include every substitution in
      the plan/receipt. Never silently replace a brand font with Inter.
- [ ] Preserve verbatim source text and record intentional truncation or overflow.
- [ ] Use the old `pr-130` branch only as a small implementation reference: it lacks
      MCP registration, range handling, substitution, and tests.

### 1.3 Close layout and visual-property gaps

- [ ] Add scene support for child `layoutGrow`, `layoutAlign`, absolute positioning,
      constraints, clipping, min/max dimensions, and wrap behavior.
- [ ] Preserve desktop/mobile frame dimensions and document which relationships are
      inferred versus explicit in source evidence.
- [ ] Add SVG import (`create_node_from_svg` or equivalent) with sanitized input,
      bounded bytes, and returned node mapping.
- [ ] Add gradient fills, effects (shadow/blur), opacity, and blend mode.
- [ ] Make image `FILL`/`FIT`/`CROP` behavior measurable; either fix CROP or return an
      explicit substitution rather than claiming it was preserved.
- [ ] Add ellipse/line primitives only if the first fixture cannot express them
      cleanly through frames/radius or SVG; do not expand the API speculatively.
- [ ] Preserve real assets. Placeholder rectangles are acceptance failures unless the
      source manifest explicitly marks the asset unavailable.

### 1.4 Build the source-neutral scene compiler

- [ ] Add a pure offline reference compiler from a copied/sanitized cloner artifact
      bundle to `code-to-figma.scene.json`.
- [ ] Read OpenDesign's live schema and the package's generated
      `design-tokens.json`; do not hand-maintain a second token vocabulary.
- [ ] Consume page topology, component specs, real content, asset references, and
      desktop/mobile measurements from the source bundle.
- [ ] Resolve each style/property in explicit stages:
      exact token/component evidence → measured browser value → documented override
      → declared unsupported. Never guess silently.
- [ ] Keep framework syntax out of the scene executor. If Astro/React/Next-specific
      parsing becomes necessary, defer it to a source adapter tracked in
      [`ROADMAP.md`](ROADMAP.md).
- [ ] Make compilation deterministic: identical source bundle + overrides + schema
      commit produces an identical scene apart from isolated run metadata.
- [ ] Do not import sibling repositories at runtime; install a pinned fixture under
      this repo with provenance.

### 1.5 Add compact round-trip evidence

- [ ] Extend read-back so every R1-authored property can be verified or is explicitly
      listed as unreadable.
- [ ] Let image export save to an explicit local output path and return MIME, width,
      height, bytes, and hash rather than dumping base64 into the model context.
- [ ] Generate a structural summary: node counts/types, text hashes, asset hashes,
      layout mode/sizing, and unsupported/substituted properties.
- [ ] Capture the generated desktop/mobile frames and create side-by-side comparisons
      against the source browser references at 1440px and 390px.
- [ ] Re-run read-back/export after the last correction; stale screenshots are not
      evidence.

### 1.6 First real acceptance fixture

- [ ] Select one authorized, single-page fixture with real desktop/mobile references.
      Prefer an owned PsiAtiva page because its OpenDesign package is already proven;
      record authorization before copying code/assets.
- [ ] Freeze the source commit/build and fixture hashes before the first Figma write.
- [ ] Run compile → dry-run → apply → read-back → export → comparison.
- [ ] Re-run the identical scene in `upsert` mode and prove it creates zero duplicate
      nodes.
- [ ] Simulate one interrupted batch and prove resume completes without rebuilding
      successful nodes.
- [ ] Record call count, Figma-side duration, substitutions, unsupported properties,
      and manual interventions.

**R1 acceptance:** one authorized page exists as editable desktop/mobile Figma frames
with real content/assets, honest gaps, no unrelated mutations, fresh visual evidence,
and a second idempotent run that creates no duplicates.

---

## Release R2 — design-system-native MVP

Keep coarse until R1 is accepted.

### 2.1 Author variables and styles

- [ ] Add an idempotent `apply_design_system` contract or equivalent batch operations
      for local collections, modes, variables, aliases, bindings, and local styles.
- [ ] Map OpenDesign color/number/string semantics onto supported Figma variable types;
      fail with a complete missing/unsupported list rather than coercing values.
- [ ] Support a default theme first; add light/dark modes only when the fixture and
      current Figma plan support them.
- [ ] Detect existing owned collections/styles by stable source identity and update
      them without duplicating names.
- [ ] Bind generated nodes to variables/styles wherever the source evidence supports
      it; record deliberate raw-value fallbacks.
- [ ] Create/apply paint, text, and effect styles needed by the fixture.
- [ ] Return `supported`, `complete`, plan/capability limitations, and per-resource
      outcomes.

### 2.2 Author components, variants, and instances

- [ ] Add tools/contracts to create a component from an owned frame, combine related
      components as variants, define component properties, and create instances with
      explicit property values.
- [ ] Build component families from real component specs/manifests, not from every
      repeated DOM subtree.
- [ ] Preserve variant axes and states supported by the source; list hover/focus/
      active/responsive states that cannot be represented faithfully.
- [ ] Build the page from instances where a generated component exists; detached
      copies require a recorded reason.
- [ ] Prove reruns update the owned component/instances without breaking instance
      identity or duplicating component sets.

### 2.3 R2 acceptance

- [ ] Generated design-system page contains the expected local collections, styles,
      components, variants, and documentation/evidence.
- [ ] Page frames use bindings and instances rather than only raw values and detached
      shapes.
- [ ] Read-back proves the bindings/style references/component identities.
- [ ] The OpenDesign source package and Figma resources have an explicit mapping
      report with unsupported/fallback counts.
- [ ] Visual acceptance remains at least as good as R1 after the semantic refactor.

**R2 acceptance:** the first fixture is not merely visually similar; it is an editable,
reusable Figma system whose authored semantics trace to the same OpenDesign/source
evidence as the code.

---

## Release R3 — generalization and first release

Keep coarse until R2 is accepted.

- [ ] Run the complete pipeline on a second unrelated authorized codebase with a
      different design-system naming convention and component structure.
- [ ] Quantify overrides, fallbacks, unsupported properties, apply duration, payload
      size, and visual findings for both fixtures.
- [ ] Turn both sources into sanitized offline regression fixtures where authorization
      permits; otherwise commit hashes/schemas and keep private assets gitignored.
- [ ] Add failure-injection coverage for relay disconnect, timeout after partial
      application, missing font, bad SVG/image, stale ownership hash, and Figma plan
      limitations.
- [ ] Prove create, upsert-no-change, upsert-with-change, and safe-resume paths.
- [ ] Add CI for install, server build, plugin syntax, schema/dispatcher parity,
      offline fixtures, and deterministic scene/receipt snapshots.
- [ ] Update `README.md`, `AGENTS.md`, tool descriptions, local MCP setup, and the
      package's real test commands.
- [ ] Decide one authoritative package manager/lockfile and supported Bun/Node
      versions from measured builds.
- [ ] Version the fork release and document exactly which server and DEV/community
      plugin combinations are compatible.
- [ ] Reassess upstream. Offer small generic tools as isolated source-only PRs; keep
      the high-level scene pipeline fork-specific unless upstream wants the contract.

**R3 acceptance:** two unrelated sources pass fresh compile/apply/read-back/visual
evidence, retries are safe, offline CI is green, and a clean setup can reproduce the
documented release.

---

## Cross-cutting checklist

- [ ] **Write safety first.** Validation and dry-run precede mutation; generated work
      is isolated and ownership-scoped.
- [ ] **No invented evidence.** Missing facts fail, fall back through a declared
      contract, or appear as unsupported—never as plausible-looking values.
- [ ] **No false completeness.** Every partial/truncated/unsupported operation reports
      its scope and limitations in the payload.
- [ ] **Idempotent retries.** A timeout or lost reply must not create duplicate pages,
      nodes, variables, styles, or components.
- [ ] **Immutable source evidence.** Normalize into new artifacts; never rewrite the
      source bundle that justified a Figma result.
- [ ] **One token source.** OpenDesign artifacts remain the source of design values;
      scene/Figma mappings do not become a second hand-maintained design system.
- [ ] **Source-neutral executor.** Framework adapters compile to the scene contract;
      plugin/server code never imports application source.
- [ ] **Batch for scale, narrow tools for repair.** Do not spend one MCP round-trip per
      property when a typed batch can preserve the same auditability.
- [ ] **Compact binary handling.** Images travel by bounded bytes/path/hash; base64 is
      not printed into routine logs or model context.
- [ ] **Fresh acceptance.** Re-run build, read-back, and visual export after the last
      relevant change.
- [ ] **Authorization and privacy.** Use only owned/authorized sources; private client
      content/assets are local by default.
- [ ] **Local runtime honesty.** Record fork commit, server bundle, plugin build, and
      channel/session for every live acceptance run.
- [ ] **Stdout remains protocol-only.** Diagnostics go to stderr and never corrupt MCP
      transport.
- [ ] **Upstream does not gate local value.** Contribute proven generic improvements
      without coupling the release to maintainer timing.

## Open questions to close at the relevant checkpoint

- [ ] **R0 — scene ownership storage:** plugin data on every node, root-level source
      map, or both? Prefer both only if the measured payload/write cost is small.
- [ ] **R0 — rollback boundary:** is safe resume plus isolated-page deletion
      sufficient, or does the first fixture require an explicit rollback command?
- [ ] **R1 — first fixture:** confirm the owned PsiAtiva page or name another
      authorized source with frozen desktop/mobile references.
- [ ] **R1 — compiler home:** keep the source-neutral reference compiler here, or
      create a sibling `code-to-figma` project once the scene contract is proven.
- [ ] **R1 — responsive semantics:** separate desktop/mobile frame trees, shared
      components with overrides, or both?
- [ ] **R2 — Figma plan capabilities:** which variable modes and library operations
      are available in the acceptance account? Probe; do not infer.
- [ ] **R3 — visual release policy:** human sign-off only, or a measured threshold
      after render/font normalization?

## Inputs needed only when their release starts

- **R0 live proof:** an empty dedicated Figma page, the fork DEV plugin running, and
  the connected channel name.
- **R1 acceptance:** one authorized source commit/build plus desktop/mobile reference
  artifacts and assets.
- **R2 semantic pass:** permission to author local variables/styles/components in the
  acceptance file and confirmation of plan limitations.
- **R3 generalization:** a second unrelated authorized source.
- **Any calendar commitment:** an explicit deadline/capacity decision. Until supplied,
  the project remains one-release-at-a-time and scope-open.
