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
  49 registered MCP tools, and have a live-validated read layer plus useful authoring
  primitives.
- **Independently maintainable tool — R0 ACCEPTED 2026-08-08.** The clean offline
  install/build/test/parity/identity gate passes and the connected read/write smoke
  passed twice with a matching server↔plugin fingerprint. Recorded in
  [`docs/R0-BUILD.md`](docs/R0-BUILD.md).
- **Consumer-stable read release — R1 ACCEPTED 2026-08-08.** The read contract is
  documented, versioned (`1.1.0`), verified backwards compatible with the frozen R0
  baseline, and now **live-verified**: smoke exit 0 on the pinned pair, the export
  receipt matched disk byte for byte, and 652 remote-library style references resolved
  values that `get_styles` cannot see. See [`docs/R1-RELEASE.md`](docs/R1-RELEASE.md).
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

### ✅ R0 verification foundations

- [x] Committed offline contract and real-plugin VM regression suite.
- [x] `node --check src/cursor_mcp_plugin/code.js` runs independently of `tsup`.
- [x] Server command/schema ↔ plugin dispatcher ↔ MCP tool parity is enforced.
- [x] `get_runtime_info` reports content-derived server/plugin builds and capability
      identity, with strict preflight before document operations.
- [x] Root setup pins the local built fork and cannot select npm `latest`.
- [x] One release gate checks source, `dist/`, README inventory, and DEV plugin
      metadata together.
- [x] Root `bun.lock` is the measured authority; the stale npm lock is preserved and
      explicitly documented as legacy traceability.

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

[`figma-to-code`](../figma-to-code/) currently pins `5e0c869` as its local read
runtime (advanced `956a6af` → `3546719` → `5e0c869`; both deltas docs-only, every
executable hash and the capability fingerprint unchanged). That pin is a
**consumer choice**, not a fork dependency.

That consumer completed its full capture sequence on 2026-08-02 and **found no
defect in this fork.** All seven payload-shape corrections it made were in its own
validators, which had been written from this repo's prose docs rather than from
observed replies. Two additive read enhancements came out of the work; both are
logged under R1 below, and **neither is required for the consumer's MVP — both
were since shown to be non-blocking.**

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

## ▶ Next session — R1 is accepted; R2 is the open front

**R0 accepted 2026-08-08** ([`docs/R0-BUILD.md`](docs/R0-BUILD.md)).
**R1 accepted 2026-08-08** ([`docs/R1-RELEASE.md`](docs/R1-RELEASE.md)) — offline gate
green (34 tests, cross-release compatibility at zero errors) **and live gate passed**:
smoke exit 0 on the pinned pair, export receipt verified against disk byte for byte, and
652 remote-library style references resolving values `get_styles` cannot see. R1 owes
nothing further; the payload is in that release note.

**Start here — two R1-derived defects found by the live gate, both real, neither
blocking R1:**

1. **`export_node_as_image` has no heavy timeout class.** Every other cost-scaling read
   (`get_document_info`, `get_pages`, `get_styles`, `get_local_components`) declares
   `HEAVY_READ_TIMEOUT_MS`; export still runs on the 30 s default, which is exactly the
   budget the multi-megabyte exports `filePath` was built for will exceed.
2. **`get_node_variables` is unbounded.** A page-wide scan (11,733 nodes → 3.66 MB) left
   the plugin unable to answer *any* subsequent command until reloaded. Every other
   large read is paged or chunked; this one is not. Give it the same limit/offset
   treatment, or chunk it with progress.

⛔ **Do not log those timeouts as an export bug.** The diagnosis is in the release note:
`get_runtime_info` reported `plugin: null` / `incompatible` / *"Plugin runtime probe
failed"* right after, so the plugin was saturated and answering nothing. Verify a
suspected tool failure against `get_runtime_info` before attributing it to the tool.

Then: R2 (safe authoring release) is next in sequence, **except** the variable half of R3
already has a detailed plan and a real consumer waiting — see the R3 section. The one
piece of R1 evidence still worth taking opportunistically is a genuinely multi-megabyte
`filePath` export, once (1) gives it a budget that can finish.

⛔ **Restarting `bun run socket` does NOT restart the MCP connection.** The relay and the
MCP stdio server are separate processes; the server holds `dist/server.js` from load
time, so a rebuild is invisible to an already-connected client. Verify by **tool surface**
(`get_runtime_info` present ⇒ 49 tools) — ⛔ not by relay liveness or process count. Also
kill any `bunx cursor-talk-to-figma-mcp@latest` processes: that build is not
R0-compatible and competes for the same relay.

`figma-to-code` may continue its own R0 against the pinned `956a6af` runtime in
parallel. Neither project's R0 requires source changes in the other.

---

## ✅ Release R0 — independently verifiable tool — ACCEPTED 2026-08-08

Full build/acceptance record: [`docs/R0-BUILD.md`](docs/R0-BUILD.md). Riskiest assumption
retired: **the fork can be changed safely without relying on session memory or a sibling
project.** Shipped runtime — server `r0-server-937e815db78f` ↔ plugin
`r0-plugin-1eec70ac13d1`, fingerprint `sha256:3dfa8bd8…483de4`, 49 tools / 6 prompts /
48 plugin commands, package `0.3.5`, source `fbbc6a7`.

### 0.1 Freeze the public tool contract

- [x] Generate a machine-readable inventory of every registered MCP tool and prompt:
      name, direction (`read|write|connection`), scope, input schema, timeout class,
      progress behavior, and plugin command.
- [x] Classify current results as stable, additive-preview, or legacy.
- [x] Add a contract snapshot test that fails on an unreviewed tool/schema removal or
      incompatible parameter change.
- [x] Add a dispatcher parity test: every server command has a plugin handler and
      every public plugin command has a server schema.
- [x] Verify README tool names against the generated inventory.
- [x] Keep `join_channel`/connection plumbing distinct from Figma document commands.

### 0.2 Create a durable offline harness

- [x] Add one documented test command to `package.json`.
- [x] Promote the real-`code.js` VM/stub approach used during the read-layer work into
      committed fixtures and helpers.
- [x] Add fixtures for a small multi-page document, variables/styles, component
      summary, text, image, and auto-layout nodes.
- [x] Preserve the existing read-layer arithmetic/coverage assertions in durable
      tests rather than re-deriving them from prose.
- [x] Add error fixtures for missing nodes/pages, unsupported APIs, partial reads,
      time budgets, and invalid write targets.
- [x] Add `node --check src/cursor_mcp_plugin/code.js`; `bun run build` alone is not a
      plugin syntax check.
- [x] Keep unit/contract tests offline. Live Figma is a smoke/acceptance layer, not a
      requirement for every local test run.

### 0.3 Add runtime identity and compatibility preflight

- [x] Add `get_runtime_info` or an equivalent connection handshake that reports:
      package version, fork commit/build ID, server schema version, plugin build/API,
      supported command/capability IDs, and relay protocol version.
- [x] Make a server/plugin mismatch explicit before a document operation rather than
      failing later as an unknown command or stale schema.
- [x] Include runtime identity in error diagnostics without exposing local secrets.
- [x] Document the supported server↔plugin matrix and the exact local setup.
- [x] Update setup so it cannot silently select npm `latest` when the requested
      capability exists only in the local fork.
- [x] Decide which package manager and lockfile is authoritative from measured clean
      installs; preserve the other until that decision is documented.

### 0.4 Verify source/runtime parity

- [x] `bun install` from a clean checkout.
- [x] `bun run build`; confirm `dist/` contains the expected tool inventory.
- [x] Parse/check the direct plugin runtime.
- [x] Run all offline tests.
- [x] Start the built server, local relay, and DEV plugin; record runtime info.
- [x] Run a bounded read smoke on a disposable fixture.
- [x] Run a reversible write smoke: create a small isolated frame/text node, read it
      back, then remove only the nodes created by the smoke.
- [x] Record exact commands/results in an R0 build note.

**Live smoke PASSED 2026-08-08 — two runs, `scripts/live-smoke.mjs`, exit 0 both times**
(channels `tl7fnolj` 03:01Z and `jtijkiez` 03:15Z; artifacts
`/tmp/talk-to-figma-r0-live-smoke.json` and `/tmp/talk-to-figma-r0-live-smoke-jtijkiez.json`).
`compatibility.status: "compatible"`, `issues: []`. Server `r0-server-937e815db78f`
↔ plugin `r0-plugin-1eec70ac13d1` returned the **same** `capabilityFingerprint`
`sha256:3dfa8bd8…483de4`. Bounded read held (`childCount: 6`, `returned: 5`,
`hasMore: true`); reversible write created + read back + deleted in reverse
(`7:2`/`7:3`, then `7:4`/`7:5`), no `cleanupError`. Run 2 reading the same
`childCount: 6` is the independent proof that run 1's cleanup left nothing behind.

⚠️ **The fixture's disposability was not verified** — the bound document already had 6
children on page `0:1`. The smoke is reversible by construction and both runs cleaned up,
but "disposable file" as written in the gate was not independently confirmed. Re-run on a
throwaway file if R0 acceptance is meant to depend on that literally.

**R0 acceptance — MET 2026-08-08.** A clean checkout proves contract parity and offline
behavior, a connected client can verify the exact runtime it reached, and the live smoke
passes without any consumer repository. The single qualification is the fixture caveat
above: the result stands, the *fixture* was not proven throwaway.

**R0 retrospective — inputs to R1:**

- **Runtime identity (open question, now closed):** content-derived build IDs plus a
  capability fingerprint, not an injected commit hash. It survived a rebuild and caught
  a stale client; keep it.
- **Compatibility granularity (open question, now closed):** per-command capability IDs
  (`figma.command.<name>@1`) *and* one server schema version. The per-command IDs are
  what make an additive R1 field expressible without a global version bump.
- **Package authority (open question, now closed):** `bun.lock`. `package-lock.json`
  stays as legacy traceability and is not an install path.
- **The failure mode R1 must design around:** a green build proves the *artifact*, never
  the *connection*. R1's release note must tell a consumer how to verify the runtime it
  actually reached, not the version it thinks it pinned.
- **The consumer-evidence lesson:** all seven payload-shape corrections `figma-to-code`
  made were in validators written from this repo's **prose**. R1's read documentation has
  to be generated from or checked against observed replies, or it will reproduce that.

---

## ✅ Release R1 — consumer-stable read release — ACCEPTED 2026-08-08

Release record: [`docs/R1-RELEASE.md`](docs/R1-RELEASE.md) · read contract:
[`docs/R1-READ-CONTRACT.md`](docs/R1-READ-CONTRACT.md) · policy:
[`docs/COMPATIBILITY-POLICY.md`](docs/COMPATIBILITY-POLICY.md).

Shipped runtime — server `r1-server-25902c2adcd3` ↔ plugin `r1-plugin-2b9a727f3499`,
fingerprint `sha256:40a64c28…43ce1b`, contract `1.1.0`, schema `1.1.0`, package `0.3.5`
unchanged. Offline gate green (34 tests); **live gate passed 2026-08-08** — payload in
[`docs/R1-RELEASE.md`](docs/R1-RELEASE.md) § Live gate payload. **Both R1 changes are
additive; no consumer migration is required.**

- [x] Turn the read-layer acceptance cases from
      [`docs/READ-LAYER-PLAN.md`](docs/READ-LAYER-PLAN.md) into maintained fixtures
      and contract tests. → `tests/read-acceptance.test.mjs`. The live cases named real
      files whose absolute numbers cannot run offline; what each one *proved* is a
      structural invariant, and that is what is now asserted (rollups describe the whole
      population not the slice, offsets are disjoint, caps admit truncation, a scoped
      read withholds document totals, `get_node_info` keeps `boundVariables` beside the
      hex). Each test names its origin case.
- [x] Document each read tool's scope, cost controls, completeness fields, and
      additive-evolution policy. → `docs/R1-READ-CONTRACT.md`, with every field list
      **captured from an observed reply**, not written from prose — that is what caused
      the consumer's seven validator corrections.
- [x] Preserve bounded defaults for document/component reads and compact summaries.
      Locked by the acceptance suite rather than by convention.
- [x] Add a compact export path: write to an explicit local path or return a resource
      reference plus MIME, dimensions, bytes, and hash instead of routine base64 text.
      → optional `filePath` plus an always-on receipt (`nodeId`, `format`, `scale`,
      `mimeType`, `bytes`, `sha256`, `width`, `height`, `dimensionSource`, `delivery`).
      Dimensions are parsed from the exported bytes; **PDF reports `null` rather than a
      fabricated size**. Promoted `legacy` → `additive-preview`.
      **Consumer evidence (2026-07-31, resolved 2026-08-02):** `figma-to-code`'s
      first live capture could not record an `export_node_as_image` artifact at
      all, because its MCP client materializes images — the decoded bytes arrive,
      the raw base64 reply never does. It has since worked around this with its own
      stdio MCP client that writes replies verbatim, so **this is no longer
      blocking any consumer.** It remains worth doing for transcript size: the two
      SYD frames returned 4.29 MB and 1.73 MB of base64 in a single reply each.
      Note for the implementer: the reply is an MCP image content block
      (`{type:"image",data,mimeType}`) carrying no node id, so a consumer can only
      attribute an export by remembering its own request.
- [x] **Return the resolved value beside the resolved name for style references in
      `get_node_variables`.** → each `styles[]` entry now carries `value` (per style
      type) and `valueStatus` (`resolved` / `unsupported_style_type` / `read_failed` /
      `not_applicable`), so an absent value is never ambiguous between "no value" and
      "could not read it". Additive, read-only, no new tool.
      **Consumer evidence (2026-07-31):** on a file whose styles are all
      `remote: true`, values can only be recovered by joining `get_node_variables`
      to `get_node_info`. That join is lossy because `get_node_info` returns just
      31 % / 40 % of the nodes `get_node_variables` scans (503 of 1638; 452 of
      1142), so only 20–26 % of style references land on a readable node. On the
      SYD fixture this leaves `atencao` — the file's second-most-used paint style,
      248 refs — permanently unresolvable, along with `Gray/400` and the
      `Shadows/shadow-xs` effect. Verified independently on both the desktop and
      mobile frames.
      **Update 2026-08-02 — narrower than first reported.** That file turned out to
      be a *copy* whose styles were all remote. On the source file, `get_styles`
      returns the paint value inline and 93 % of style references are local, so
      `atencao` resolves at full confidence and the join is not needed. The request
      still stands, but its real scope is **files that reference an external
      library** — copies, and any file using a third-party UI kit (the same SYD
      source file still has 61 remote refs to `Gray/*`, `Brand/600`,
      `Shadows/shadow-xs`, `Text sm/*`). Lower priority than first logged.
- [x] Define a compatibility policy for additive result fields so consumers can
      ignore unknown fields safely. → [`docs/COMPATIBILITY-POLICY.md`](docs/COMPATIBILITY-POLICY.md),
      enforced rather than asserted: `contracts/baselines/` freezes each release and
      `bun run verify` replays every baseline against the current contract. Result
      stability became an ordered ladder — strengthening allowed, weakening a named
      error, both branches tested.
- [x] Close the remaining fork-side read verification noted in
      `READ-LAYER-PLAN.md` when a suitable local-style fixture is available.
      → the R1 fixture consumes one **local** style (`Brand/Primary`, `remote: false`)
      and one **remote** library style (`atencao`, `remote: true`) in the same scan, so
      both branches of the `style.remote` passthrough are now observed.
      ✅ **Closed live 2026-08-08 — both branches now observed on real files.** The
      opportunistic local-style confirmation the plan asked for arrived: a live scratch
      file resolved paint style `gradient` (`remote: false`) with its full gradient
      value at `valueStatus: "resolved"`. The remote branch was then proven at scale on
      the SYD source file — 652 remote references across 48 distinct styles, **0 of
      which appear in that document's local `get_styles` inventory by id or by name**,
      all carrying resolved values across PAINT/TEXT/EFFECT. No longer an offline-only
      claim.
- [x] Finish/rebase the narrow upstream read PRs independently of the local release;
      rebuild local `dist/` after upstream changes.
      → **Verified 2026-08-08: nothing to rebase, nothing to rebuild.** `upstream/main`
      has not advanced since `ddd90f3` (the squash of our merged #185) — divergence is
      **0 behind / 44 ahead**, so no upstream change can have invalidated local `dist/`.
      Both narrow PRs are still `OPEN` and `MERGEABLE` with zero reviews, untouched since
      2026-07-27:
      **#184** (`fix:` scan/reactions leaving nodes permanently recolored + honor export
      format) and **#186** (`feat:` `get_pages` / `set_current_page` + `get_document_info`
      single-page index fix). Both already carry a maintainer ping from 2026-07-27.
      Upstream timing never gates this release; R1 ships independently.
- [x] Version and document a fork build that includes the complete read contract.
      → `R1` / contract `1.1.0` / schema `1.1.0`, recorded in
      [`docs/R1-RELEASE.md`](docs/R1-RELEASE.md). `packageVersion` deliberately stays at
      upstream's `0.3.5`; the pin is the commit SHA.
- [x] Publish a consumer upgrade note containing the new commit/version,
      runtime fingerprint, changed fields, and migration guidance.
      → `docs/R1-RELEASE.md` § Consumer upgrade note. Migration required: none.

⚠️ **The finding this release turned up.** Applying the entire R1 read change and
regenerating produced a **byte-identical `capabilityFingerprint`** — it covers
`serverSchemaVersion` plus per-command capability IDs, and R1 added no commands. A
consumer pinning only the fingerprint would have had no signal that the contract grew.
R1 therefore bumps `serverSchemaVersion`, which *is* a fingerprint input. **A release
that grows the contract must bump `serverSchemaVersion`, or it ships silently.**

**R1 acceptance:** a generic MCP client can pin one documented server/plugin pair,
perform the complete bounded read sequence, persist compact exports, and interpret
scope/completeness without inspecting fork source.

**Offline: met.** 34 tests, cross-release compatibility with the frozen R0 baseline at
zero errors, contract/parity/README/`dist/` all green.

**✅ Live: met 2026-08-08.** All three checks passed against the pinned pair
(`r1-server-25902c2adcd3` ↔ `r1-plugin-2b9a727f3499`, fingerprint
`sha256:40a64c28…43ce1b`, `compatible` with zero issues on every join). Full payload in
[`docs/R1-RELEASE.md`](docs/R1-RELEASE.md) § Live gate payload:

1. `scripts/live-smoke.mjs` — **exit 0**, channel `56kw2mfw`; 49 tools / 6 prompts /
   48 plugin commands observed live; bounded read honest about truncation; write created,
   read back, and cleaned up. `dist/` hashes on disk matched the two pinned SHA-256s
   first, so the artifact exercised is the artifact documented.
2. `export_node_as_image` with `filePath` — receipt `sha256`/`bytes`/`width`/`height`
   matched the file on disk under independent verification, and 100×100 = the 50×50 node
   box × scale 2. The same export without `filePath` returned an identical receipt plus
   the image block (`delivery: "inline"`), so R0 consumers are unaffected. SVG resolved
   via `svg-attributes`; **PDF reproduced the documented `null` dimension trap exactly**.
3. `get_node_variables` on the SYD source file, page `3-LP`, 11,733 nodes — **652 remote
   references across 48 distinct styles, 0 of them visible to `get_styles` by id or name,
   all 652 resolved with values** (PAINT 316 / TEXT 318 / EFFECT 18). Incompleteness was
   declared honestly in the same reply: 13 of 4,943 unresolved, every one
   `mixed` → `not_applicable`, zero read failures.

⚠️ **One bonus check did not complete, and it is not an export defect.** Exporting a
large SYD frame timed out on the 30 s default — but a plain `get_node_info` on the same
node timed out right after, and `get_runtime_info` then returned `plugin: null` /
`compatibility: "incompatible"` / *"Plugin runtime probe failed"*. The preceding
page-wide 11,733-node scan had saturated the plugin. Two R2 follow-ups fall out of it:
give `export_node_as_image` a declared heavy budget, and bound/page `get_node_variables`
so one scan cannot wedge the plugin. A genuinely multi-megabyte `filePath` export
remains unconfirmed end to end.

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

Keep coarse until R2 is accepted — **with one deliberate exception, recorded 2026-08-07.**

⭐ **The variable half of R3 has been cut early and planned in detail:**
[`docs/VARIABLE-WRITE-PLAN.md`](docs/VARIABLE-WRITE-PLAN.md). It is pulled forward because a
real consumer hit the gap — the `umjuansantos` design-system reconciliation produced a
machine-verified ~10-edit correction list against a live file, and **no current tool can
write a single one of them back**; `get_variables` reads the whole tree and nothing
returns. That is the dependency rule's stated trigger for fork work.

⚠️ **The queue-jump is bounded, not waived.** The plan's Phase 0 ships the one R0 guard
`TASKS.md` requires before any new tool (server-schema ↔ plugin-dispatch parity + a
contract snapshot). The rest of R0 — runtime fingerprint, full fixture harness, release
mechanics — is **still owed** and is not discharged by that phase. Styles, components and
variants stay coarse below.

- [ ] Create/update local variable collections, modes, variables, aliases, and
      bindings with explicit Figma-plan capability responses.
      ⭐ **Planned in full → [`docs/VARIABLE-WRITE-PLAN.md`](docs/VARIABLE-WRITE-PLAN.md).**
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

- [x] **R0 — runtime identity:** *content-derived build manifest.* Server ID covers
      `server.ts` + the canonical public contract; plugin ID covers `code.js` (minus its
      generated identity block), `ui.html`, `manifest.json`. No injected commit hash.
- [x] **R0 — compatibility granularity:** *both.* One `schemaVersion` for the tool set
      plus per-command capability IDs (`figma.command.<name>@1`), rolled into one
      `capabilityFingerprint` that server and plugin derive independently.
- [x] **R0 — package authority:** *Bun.* `bun.lock` is the measured authority;
      `package-lock.json` is preserved as legacy traceability only.
- [x] **R1 — additive payload policy:** *neither, and both.* The generated
      `contracts/public-contract.json` carries JSON Schema for every **input**; result
      shapes are pinned by committed **fixtures** exercised against the real `code.js`
      runtime, because a hand-written result schema drifts from observed replies — which
      is exactly the failure that produced the consumer's seven validator corrections.
      Cross-release safety comes from replaying frozen baselines, not from a schema
      dialect. See [`docs/COMPATIBILITY-POLICY.md`](docs/COMPATIBILITY-POLICY.md).
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
