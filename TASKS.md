# Talk to Figma Fork — Independent Tool Task Tracker

> **Open this first for fork work.** `talk-to-figma-fork` is an independent MCP
> integration for Figma. It supplies reusable read/write tools; it does not implement
> [`figma-to-code`](../figma-to-code/), a website cloner, or a Code → Figma compiler.
>
> Active work is tracked here. Product direction and deferred capabilities live in
> [`ROADMAP.md`](ROADMAP.md); the completed read-layer overhaul and upstream split
> remain in [`docs/READ-LAYER-PLAN.md`](docs/READ-LAYER-PLAN.md).
>
> **Implementation baselined 2026-07-28 at `956a6af`.** Commit `6c6adb7` added the
> first planning files only; it did not change the runtime/tool surface.

## Project boundary — load-bearing

| This repository owns | Consumer repositories own |
| --- | --- |
| MCP tool names, schemas, descriptions, timeouts, and result contracts | Capture manifests and normalized evidence bundles |
| MCP server, WebSocket relay, Figma plugin handlers, and runtime compatibility | Token/component mapping and OpenDesign emission |
| Generic Figma reads and writes | Astro/React/Next.js generation |
| Generic batching, progress, error, and binary-transfer behavior | Consumer-specific orchestration, retries, source identity, and acceptance |
| Fork tests, fixtures, documentation, packaging, and releases | Their own adapters, fixtures, privacy policy, and release gates |

The dependency direction is one-way:

```text
figma-to-code / agents / future authoring clients
                       │ MCP tool calls
                       ▼
             talk-to-figma-fork
                       │
                       ▼
                     Figma
```

Hard rules:

- The fork never imports `figma-to-code`, the website cloner, OpenDesign, or an
  application repository.
- No `tokens.source.json`, OpenDesign slot resolver, capture-manifest schema,
  framework parser, or Code → Figma scene compiler belongs here.
- When a consumer finds a missing Figma fact/capability, implement the smallest
  generic tool or additive field here, test it here, rebuild `dist/`, and assign a
  new pin. The consumer adapts only after that.
- Consumer acceptance is useful integration evidence, not a replacement for the
  fork's own regression fixtures.

## Two levels of done — do not conflate them

- **Functional local fork — available.** The relay/server/plugin run locally, expose
  48 registered MCP tools, and have a live-validated read layer plus useful authoring
  primitives.
- **Independently maintainable tool — NOT shipped.** A clean checkout still lacks a
  durable regression suite, schema↔dispatcher parity guard, runtime fingerprint, and
  a verified release containing the complete fork capability set.
- **Consumer integration — owned elsewhere.** `figma-to-code` succeeding through a
  pinned fork build proves the API is useful, but it does not make the two projects
  one codebase or one release.

## Planning frame

- **Outcome:** a reliable, installable, consumer-neutral MCP bridge that lets any
  compatible client read and modify Figma through explicit, bounded contracts.
- **Fixed capacity/budget:** one maintainer, local Figma DEV plugin, local relay, and
  checked-in tooling. No hosted service or paid API is required for the active path.
- **Planning horizon:** one release at a time. No calendar deadline was supplied, so
  later release dates are not invented.
- **Scope is the variable:** preserve contract integrity, backwards compatibility,
  safety, and acceptance; defer new tools when they threaten the next stable release.
- **Upstream posture:** fork-first and upstream-compatible. Generic changes may be
  offered upstream, but upstream timing never blocks the local tool or its consumers.

## Current baseline

### ✅ Read layer

- [x] Honest page discovery and navigation: `get_pages`, bounded
      `get_document_info`, and `set_current_page`.
- [x] Variables, styles, and bindings: `get_variables`, `get_styles`,
      `get_node_variables`, and preserved `boundVariables`.
- [x] Bounded/scoped component inventory with pagination, family rollups, and
      authoring-session clusters.
- [x] Typed scope, completeness, limitations, and resolution status on the reads
      added by the overhaul.
- [x] Interactive-component `CHANGE_TO` reactions retained and read-result write
      injection removed.
- [x] Heavy read timeout budget preserved after progress updates.
- [x] Live validation against real large files documented in
      [`docs/READ-LAYER-PLAN.md`](docs/READ-LAYER-PLAN.md).

### ✅ Existing generic write surface

- [x] Create frames, rectangles, text, sections, and existing component instances.
- [x] Move, resize, clone, rename, reparent, focus, select, and delete nodes.
- [x] Set solid fill, stroke, corner radius, and image fill.
- [x] Configure auto-layout mode/wrap, padding, alignment, sizing, and gap.
- [x] Set single/batch text content and annotations.
- [x] Copy and apply instance overrides.
- [x] Export PNG/JPG/SVG/PDF data.

### ⚠️ Independent-product gaps

- [ ] No committed test suite or linter exists.
- [ ] `src/cursor_mcp_plugin/code.js` is a direct runtime artifact; `tsup` does not
      parse it.
- [ ] No automated check proves that each server tool has a matching plugin command
      and vice versa.
- [ ] A client cannot reliably ask which fork commit, server bundle, plugin build, or
      capability set is actually connected.
- [ ] Root setup still points users toward an npm `latest` that does not contain the
      complete fork read layer.
- [ ] Source, `dist/`, README tool inventory, and DEV plugin can drift without a
      single release gate catching all four.
- [ ] Both `bun.lock` and `package-lock.json` exist without a documented authority.

### ⚠️ Known generic write defects

- [ ] `create_text` hardcodes Inter and exposes only a small typography surface.
- [ ] Mixed-font text can fail `set_multiple_text_contents` with
      `loadFontAsync: Cannot unwrap symbol`.
- [ ] The observed `set_image_fill` `CROP` request normalizes differently in Figma;
      `FILL`/`FIT` are the proven paths.
- [ ] Variables/styles are read-only.
- [ ] Components can be instantiated but not created, combined into variants, or
      assigned component properties.
- [ ] Most writes are one command at a time and return no shared batch receipt.
- [ ] Export replies are base64-oriented and can flood logs/model context.

## Consumer compatibility snapshot

[`figma-to-code`](../figma-to-code/) currently pins `956a6af` as its local read
runtime. That pin is a **consumer choice**, not a fork dependency.

Its MVP read sequence exercises:

`join_channel` → `get_pages` → `set_current_page` →
bounded `get_document_info` → `get_variables` → `get_styles` →
scoped `get_local_components` → targeted `get_node_info` /
`get_node_variables` / `get_reactions` → `export_node_as_image`.

The fork must keep these operations generic and independently tested. The consumer
must preserve its own capture schema, privacy rules, normalization, OpenDesign
mapping, and generated-code acceptance.

## Benefit-delivering release sequence

| Release | Value shipped | Riskiest assumption retired |
| --- | --- | --- |
| **R0 — Independently verifiable tool** | Clean install/build/tests, command parity, runtime identity, and a small live read/write smoke | The fork can be changed safely without relying on session memory or a sibling project |
| **R1 — Consumer-stable read release** | A pinned, documented local release exposes the existing read layer and compact exports through a stable contract | `figma-to-code` and other clients can depend on the fork without coupling to its source tree |
| **R2 — Safe authoring release** | Generic page/metadata/batch plus complete typography/layout/visual operations | Real authoring clients can compose the tool without a domain-specific compiler inside this repo |
| **R3 — Design-system authoring release** | Generic variable/style/component creation and binding | Higher-level clients can create reusable Figma systems without making the fork OpenDesign-specific |

After each release: record the fork acceptance, classify additive/breaking changes,
let consumers update their pins independently, and re-cut the next release.

---

## ▶ Next session — start here (R0 only)

1. Inventory the live MCP surface and freeze a machine-readable contract snapshot.
2. Promote the existing ad-hoc VM technique into a committed plugin test harness.
3. Add server-schema ↔ plugin-dispatch parity checks before adding a new tool.
4. Add a runtime/capability fingerprint so clients can detect the wrong server/plugin.
5. Prove one generic read smoke and one generic write smoke on a disposable fixture.
6. Stop when the fork is independently verifiable; do not add importer/compiler work.

`figma-to-code` may continue its own R0 against the pinned `956a6af` runtime in
parallel. Neither project's R0 requires source changes in the other.

---

## Release R0 — independently verifiable tool

### 0.1 Freeze the public tool contract

- [ ] Generate a machine-readable inventory of every registered MCP tool and prompt:
      name, direction (`read|write|connection`), scope, input schema, timeout class,
      progress behavior, and plugin command.
- [ ] Classify current results as stable, additive-preview, or legacy.
- [ ] Add a contract snapshot test that fails on an unreviewed tool/schema removal or
      incompatible parameter change.
- [ ] Add a dispatcher parity test: every server command has a plugin handler and
      every public plugin command has a server schema.
- [ ] Verify README tool names against the generated inventory.
- [ ] Keep `join_channel`/connection plumbing distinct from Figma document commands.

### 0.2 Create a durable offline harness

- [ ] Add one documented test command to `package.json`.
- [ ] Promote the real-`code.js` VM/stub approach used during the read-layer work into
      committed fixtures and helpers.
- [ ] Add fixtures for a small multi-page document, variables/styles, component
      summary, text, image, and auto-layout nodes.
- [ ] Preserve the existing read-layer arithmetic/coverage assertions in durable
      tests rather than re-deriving them from prose.
- [ ] Add error fixtures for missing nodes/pages, unsupported APIs, partial reads,
      time budgets, and invalid write targets.
- [ ] Add `node --check src/cursor_mcp_plugin/code.js`; `bun run build` alone is not a
      plugin syntax check.
- [ ] Keep unit/contract tests offline. Live Figma is a smoke/acceptance layer, not a
      requirement for every local test run.

### 0.3 Add runtime identity and compatibility preflight

- [ ] Add `get_runtime_info` or an equivalent connection handshake that reports:
      package version, fork commit/build ID, server schema version, plugin build/API,
      supported command/capability IDs, and relay protocol version.
- [ ] Make a server/plugin mismatch explicit before a document operation rather than
      failing later as an unknown command or stale schema.
- [ ] Include runtime identity in error diagnostics without exposing local secrets.
- [ ] Document the supported server↔plugin matrix and the exact local setup.
- [ ] Update setup so it cannot silently select npm `latest` when the requested
      capability exists only in the local fork.
- [ ] Decide which package manager and lockfile is authoritative from measured clean
      installs; preserve the other until that decision is documented.

### 0.4 Verify source/runtime parity

- [ ] `bun install` from a clean checkout.
- [ ] `bun run build`; confirm `dist/` contains the expected tool inventory.
- [ ] Parse/check the direct plugin runtime.
- [ ] Run all offline tests.
- [ ] Start the built server, local relay, and DEV plugin; record runtime info.
- [ ] Run a bounded read smoke on a disposable fixture.
- [ ] Run a reversible write smoke: create a small isolated frame/text node, read it
      back, then remove only the nodes created by the smoke.
- [ ] Record exact commands/results in an R0 build note.

**R0 acceptance:** a clean checkout proves contract parity and offline behavior, a
connected client can verify the exact runtime it reached, and a disposable live smoke
passes without any consumer repository.

---

## Release R1 — consumer-stable read release

Detail after the R0 retrospective. Current boundary:

- [ ] Turn the read-layer acceptance cases from
      [`docs/READ-LAYER-PLAN.md`](docs/READ-LAYER-PLAN.md) into maintained fixtures
      and contract tests.
- [ ] Document each read tool's scope, cost controls, completeness fields, and
      additive-evolution policy.
- [ ] Preserve bounded defaults for document/component reads and compact summaries.
- [ ] Add a compact export path: write to an explicit local path or return a resource
      reference plus MIME, dimensions, bytes, and hash instead of routine base64 text.
- [ ] Define a compatibility policy for additive result fields so consumers can
      ignore unknown fields safely.
- [ ] Close the remaining fork-side read verification noted in
      `READ-LAYER-PLAN.md` when a suitable local-style fixture is available.
- [ ] Finish/rebase the narrow upstream read PRs independently of the local release;
      rebuild local `dist/` after upstream changes.
- [ ] Version and document a fork build that includes the complete read contract.
- [ ] Publish a consumer upgrade note containing the new commit/version,
      runtime fingerprint, changed fields, and migration guidance.

**R1 acceptance:** a generic MCP client can pin one documented server/plugin pair,
perform the complete bounded read sequence, persist compact exports, and interpret
scope/completeness without inspecting fork source.

`figma-to-code` then updates its own pin and runs its own capture/emission acceptance.
That consumer pass is evidence for the interface, not part of this repository's
implementation.

---

## Release R2 — safe authoring release

Keep coarse until R1 is accepted.

### Generic safety and orchestration primitives

- [ ] Add `create_page` with explicit naming and duplicate behavior.
- [ ] Add bounded `get_plugin_data` / `set_plugin_data` tools so consumers may own
      their metadata conventions without the fork defining those conventions.
- [ ] Add a generic batch operation contract with operation IDs, references to prior
      results, prevalidation, progress, stop/continue-on-error policy, and typed
      per-operation receipts.
- [ ] Add generic idempotency only after its semantics are proven independently of a
      consumer scene format.
- [ ] Make destructive batch operations require exact node IDs and report their
      resolved scope before mutation.

### Typography, layout, visuals, and assets

- [ ] Add a bounded font inventory/preflight.
- [ ] Support font family/style, size, line height, letter spacing, paragraph
      properties, case/decoration, alignment, and text resize behavior.
- [ ] Fix mixed-font single/batch content mutation with a dedicated regression fixture.
- [ ] Add child auto-layout sizing/alignment/grow, absolute positioning, constraints,
      clipping, and min/max dimensions.
- [ ] Add generic SVG import, gradient fills, effects, opacity, and blend mode.
- [ ] Measure/fix image crop behavior or return an explicit limitation.
- [ ] Keep each narrow tool independently usable; no framework or scene vocabulary in
      its schema.

**R2 acceptance:** a generic client can build and edit a representative component/page
fixture with typed batch outcomes and no hidden dependency on a consumer repository.

---

## Release R3 — design-system authoring release

Keep coarse until R2 is accepted.

- [ ] Create/update local variable collections, modes, variables, aliases, and
      bindings with explicit Figma-plan capability responses.
- [ ] Create/update/apply local paint, text, effect, and grid styles.
- [ ] Create components, combine variants, define component properties, create
      instances, and set instance properties.
- [ ] Define stable lookup/update semantics without importing OpenDesign identifiers.
- [ ] Add independent fixtures for variables, styles, variants, and plan limitations.
- [ ] Prove additive reruns do not duplicate owned resources when a generic identity
      key is supplied.
- [ ] Version/document the new tools and their compatibility requirements.

**R3 acceptance:** generic MCP clients can author reusable Figma design-system
resources through documented Figma-native contracts. Mapping OpenDesign—or any other
design-system format—remains consumer work.

---

## Cross-cutting checklist

- [ ] **Consumer-neutral contracts.** No sibling schema, framework, brand, or product
      workflow leaks into MCP parameters.
- [ ] **No reverse dependency.** The fork never imports or shells into a consumer
      repository.
- [ ] **Scope is explicit.** Page/document/node scope and partial coverage are visible
      in every relevant result.
- [ ] **Backwards compatibility is reviewed.** Additive fields are preferred; breaking
      changes require a new contract/version and migration note.
- [ ] **Source, dist, plugin, docs agree.** Rebuild and run parity checks after every
      server/plugin change.
- [ ] **Bound payloads and time.** Large documents cannot silently exhaust a client
      context or wait forever.
- [ ] **Binary data stays compact.** Do not print routine base64 or asset bytes into
      logs/model context.
- [ ] **Writes are exact and auditable.** Resolve targets, return typed outcomes, and
      isolate destructive smoke fixtures.
- [ ] **Stdout stays protocol-only.** Diagnostics go to stderr.
- [ ] **Local runtime honesty.** Record server/plugin identity in every live acceptance.
- [ ] **Upstream is optional.** Contribute generic proven changes without gating the
      fork or its consumers.

## Open questions to close at the relevant checkpoint

- [ ] **R0 — runtime identity:** generated build manifest, injected commit hash, or
      both?
- [ ] **R0 — compatibility granularity:** one schema version for the whole tool set or
      explicit capability IDs per feature family?
- [ ] **R0 — package authority:** Bun lockfile, npm lockfile, or deliberately tested
      dual-package-manager support?
- [ ] **R1 — additive payload policy:** formal JSON schemas, TypeScript fixtures, or
      both?
- [ ] **R2 — generic batch boundary:** should create operations be supported in the
      first batch version, or only mutations of existing IDs?
- [ ] **R3 — resource identity:** plugin data, Figma keys/IDs, explicit caller key, or
      a layered strategy?

## Inputs needed only when their release starts

- **R0 live smoke:** a disposable Figma fixture, fork DEV plugin, local relay/server,
  and channel name.
- **R1 consumer evidence:** optional `figma-to-code` acceptance after it independently
  updates its runtime pin.
- **R2/R3 authoring:** permission to modify a disposable test file and confirmation of
  plan-specific authoring capabilities.
- **Any calendar commitment:** an explicit deadline/capacity decision. Until supplied,
  planning remains one release at a time and scope-open.
