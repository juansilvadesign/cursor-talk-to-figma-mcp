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

## ▶ Next session — R2.4 Phases 1 and 2 are BUILT; the live gate is the front

**R2.4 Phase 2 built 2026-08-12 — `apply_batch` is registered and executing, offline.**
1.2 and the `serverSchemaVersion` bump landed with it, exactly as sequenced. 75 → **98
offline tests**, `bun run verify` green, **five baselines replaying at zero errors**.

⛔ **The pinned pair CHANGED — a running Figma session is now incompatible.**

| | Before | Now |
| --- | --- | --- |
| Contract / schema | `1.4.0` | **`1.5.0`** |
| Tools / plugin commands | 52 / 51 | **53 / 52** |
| Server | `r2-server-f152fb666599` | **`r2-server-9239fd0bc71b`** |
| Plugin | `r2-plugin-8dc3783f024f` | **`r2-plugin-d0342abb6c4a`** |
| Fingerprint | `sha256:c3cd6e71…dcc6bd` | **`sha256:a87b5d98…835704`** |

Re-run the Figma **DEV plugin** *and* respawn the MCP server before any live work, and
verify by **tool surface + exact pair** — a rebuild reaches neither running side.

🔴 **The plan's per-operation atomicity assumption was tested and is FALSE.** Trap #4 paid
for itself a second time. `set_item_spacing`, `set_axis_align` and `set_layout_sizing` all
write their first field, then validate the second and throw — reproduced offline before
anything shipped. Six more do several writes with no rollback. The contract now
**declares** non-atomicity: a `failed` receipt carries `partialApplicationPossible` and
its recorded reason, so a caller re-reads instead of assuming a no-op. ⛔ Making those nine
handlers transactional is a change to nine **shipped** tools — the honest follow-up, not a
batch-envelope task.

⭐ **Two design consequences worth carrying forward:**
- **A fifth outcome, `prevalidated`.** A dry run applies nothing by design, so every op is
  `skipped` and `succeeded === 0` — which the Phase 1 rule would classify `all_failed`, a
  fresh instance of the very defect the enum exists to kill.
- **Envelope refusals throw; everything below the envelope returns a receipt.** A
  duplicate `id` makes receipt correlation undefined and an unknown `op` has no entry
  shape, so neither can be reported inside the structure it breaks.
  `BATCH_ERROR_CODE_DELIVERY` records which half each code belongs to.

**Next: R2.4 5.5, the live gate** on the SYD throwaway copy — a mixed batch with one bad
target under both `stop` and `continue`, a `prevalidateOnly` dry run, and a destructive op
whose reported scope is checked against the document before and after. ⛔ Clean up in a
`finally`. ⛔ The gate triggers **three** refusals on purpose; two of them arrive **thrown**,
so a result-only harness mis-scores correct behaviour. Then 3.1/3.2 (chunked progress and
the measured sleep default — 3.2 is deliberately blocked offline), Phase 4, and 5.6.

⚠️ **Landing 3.1 must update the contract's `pluginUpdates` declaration in the same
change.** It currently reads `"none"`, which is *true*; adding progress without moving it
recreates Finding 4. And progress updates reset the inactivity timer, so `timeBudgetMs`
has to stay the binding constraint or Finding 5 re-opens.

---

## Historical — R2.4 planning and Phase 1

**R2.2 `create_page` accepted 2026-08-10** ([`docs/R2.2-CREATE-PAGE.md`](docs/R2.2-CREATE-PAGE.md)).
**R2.3 plugin data accepted 2026-08-10** ([`docs/R2.3-PLUGIN-DATA.md`](docs/R2.3-PLUGIN-DATA.md)).
**R2.4 batch contract planned 2026-08-10** ([`docs/BATCH-CONTRACT-PLAN.md`](docs/BATCH-CONTRACT-PLAN.md))
— **planned, not started.** No `src/` change, no schema bump yet.

**The current pinned pair is `r2-server-f152fb666599` ↔ `r2-plugin-8dc3783f024f`, schema
`1.4.0`, fingerprint `sha256:c3cd6e71…dcc6bd`, 52 tools / 51 plugin commands.** Every pair
named below (`1.2.1`, `1.3.0`) is historical and is now rejected by the preflight.

✅ **The open question is CLOSED: `apply_batch` v1 is `mutate-only`** — operations may only
target a node ID that already exists. Decided through the interview gate before any design
was written; the four reasons are recorded under *Open questions to close at the relevant
checkpoint* and in full in the plan. Two shipped tools informed the shape: `create_page`'s
`onDuplicate` is the named-policy-with-a-safe-default pattern that became `onError`, and
`set_plugin_data`'s `operation` field (`set` / `removed` / `noop_absent`) is the working
precedent for a typed per-operation receipt that reports what happened instead of
collapsing it to a boolean.

✅ **R2.4 Phase 1 is BUILT (2026-08-12) — 1.1, 1.3 and 1.4; 1.2 deferred to Phase 2.**
`src/talk_to_figma_mcp/batch-receipt.mjs` is the single receipt vocabulary; 10 new offline
tests (65 → **75**) pin it. `bun run verify` green, **five** baselines replaying, and the
contract, fingerprint and pinned pair are **unchanged** — this session added no tool.

- ⭐ **Finding 1 is now unrepresentable, not merely avoided:** `succeeded === 0`
  classifies as `all_failed` for every mix of `failed`/`skipped` (pinned by an exhaustive
  test), and the counts are derived *from* the per-operation receipts, so the aggregate
  cannot disagree with what it summarizes.
- ⛔ **Creates are pinned absent by a dedicated test**, the R2.2 `"reuse"` precedent, so
  mutate-only reads as a decision rather than an oversight.
- ⚠️ **1.2 (registering `apply_batch`) was deferred on purpose.** Registration is not
  local: the parity guard needs a matching `code.js` dispatcher entry, so registering now
  forces either a failing parity test or a stub that publishes a tool refusing every call.
  It lands with the Phase 2 handler, together with the `serverSchemaVersion`
  `1.4.0` → **`1.5.0`** bump — ⛔ **not before**, or the preflight rejects the working pair
  `r2-server-f152fb666599` ↔ `r2-plugin-8dc3783f024f` over bookkeeping.
- ⚠️ **Constraint found, load-bearing for the eventual schema:** `evaluateToolSchema`
  (`scripts/contract-lib.mjs:220`) re-evaluates each schema's **source text** through
  `Function("z", …)`, so a registered schema literal **cannot reference an imported
  constant** — the allowlist must be spelled inline as a `z.enum([...])`, with a test
  asserting it equals `V1_BATCH_OPERATIONS`.
- ⚠️ **Phase 4 cannot "import the module in both places":** `code.js` is a single bundled
  file in the Figma sandbox with no `import`. The module is dependency-free so the plugin
  can carry a **mirrored copy** held by a parity test.

⭐ **Next in sequence: R2.4 Phase 2 — prevalidation** (2.1–2.4), landing 1.2 and the
schema bump with it. All five phases, the acceptance criteria, and the four traps are
already written in [`docs/BATCH-CONTRACT-PLAN.md`](docs/BATCH-CONTRACT-PLAN.md), so the
session starts at **2.1**, not at a design decision.

✅ **The baseline freeze is DONE** — `contracts/baselines/r2.3-public-contract.json`,
copied before any regeneration and verified to carry contract `1.4.0` and fingerprint
`sha256:c3cd6e71…dcc6bd`.

⛔ **Four standing lessons, all earned the hard way — the R2.4 gate will meet every one:**

1. **A gate that mutates must clean up in a `finally`, not on the success path.** R2.2's
   first connected run aborted mid-gate and left three pages in a real document. R2.3's
   gate cleans up on both paths and re-asserts the baseline. The R2.4 gate mutates more
   than any before it.
2. **In a live gate a refusal is an expected outcome, not an exception** — and a
   schema-level refusal arrives as a *thrown* protocol error, never as an error result, so
   a harness that only inspects results mistakes the stronger behavior for a crash. This
   bit R2.1 (an honest over-ceiling refusal) and R2.2 (a Zod enum rejection); both times
   the product was correct and the harness mis-scored it. R2.4's gate deliberately
   triggers **three** refusals — allowlist, duplicate `id`, prevalidation — so a
   result-only harness would mis-score correct behavior three separate ways.
3. **A rebuild reaches neither running side.** After `bun run build` the Figma DEV plugin
   must be re-run (it holds `code.js` from launch) *and* the MCP server respawned. Verify
   by **tool surface and exact pair**, never by relay pid or port.
4. **Verify a platform assumption before designing around it.** R2.3 set out to make `""`
   storable so `null` could be the only delete; **Figma defines writing `""` as removal**,
   so half the design was impossible, and an offline test written to the intended behavior
   is what caught it. ⚠️ The assumption to test early in R2.4 is **whether a mid-batch
   failure can leave a partially applied operation** (a multi-step mutation such as
   `set_layout_mode` that throws halfway). Per-operation atomicity is *assumed* by the
   contract and has not been verified.

⛔ **`docs/*` is gitignored with per-file `!docs/…` exceptions.** Every new release note or
plan needs its own allowlist line or `git status` reads **clean while the file is
untracked** — `docs/VARIABLE-WRITE-PLAN.md` sat untracked for three days that way. Verify
with `git ls-files docs/`, not with `git status`.

---

## Historical — R2.1 acceptance notes

**R0 accepted 2026-08-08** ([`docs/R0-BUILD.md`](docs/R0-BUILD.md)).
**R1 accepted 2026-08-08** ([`docs/R1-RELEASE.md`](docs/R1-RELEASE.md)) — offline gate
green (34 tests, cross-release compatibility at zero errors) **and live gate passed**:
smoke exit 0 on the pinned pair, export receipt verified against disk byte for byte, and
652 remote-library style references resolving values `get_styles` cannot see. R1 owes
nothing further; the payload is in that release note.

**R2.0 shipped both R1-derived defects (commits `752504a` + `6357f8d`), and R2.1's
export safety amendment is accepted: the offline gate is green at 47 tests and both
halves of the connected gate have passed. Read the two halves separately:**

- ✅ **`get_node_variables` bounding — PASSED live 2026-08-08** on the pinned R2 pair,
  channel `jky2ox2v`, same SYD file. Page `14:2` ("2-App"), the ~12k-node page that
  wedged the plugin under R1: **`nodesScanned: 5000`, `coverage.nodeCapReached: true`,
  `traversalTruncated: true`, `complete: false`**, all three limitations fired, and the
  reply was **518 KB instead of 3.66 MB**. Decisively: **`get_pages` answered immediately
  afterwards** — the wedge is retired. Live paging also verified (`offset: 1815,
  limit: 2` → the last 2 of 1817 styles, `hasMore: false`), and a **local** style
  (`secundaria`) resolved with `remote: false` and a populated value — a second live
  observation of the branch R1 already confirmed, not a new retirement.
- ✅ **Bounded export preflight — PASSED live 2026-08-10** on channel `4g146t0n` and
  the exact R2.1 pair. The 3× request projected **800.3556 MP** and refused in 11 ms
  without a file; 0.5× also honestly refused at 22.2321 MP. A derived 0.4× export
  completed in 22.550 s at a projected 14.2296 MP. Its receipt matched the saved
  1,265,757-byte, 2672×5422 PNG byte-for-byte, and `get_runtime_info` / `get_pages`
  answered in 11 ms / 16 ms immediately afterwards. Full payload:
  [`docs/R2.1-EXPORT-SAFETY.md`](docs/R2.1-EXPORT-SAFETY.md).

**The accepted R2.1 pair** moved `serverSchemaVersion` 1.2.0 → **1.2.1** and is
`r2-server-41d4d9bcf84a` ↔
`r2-plugin-7e738b3a6c10`, fingerprint `sha256:eb7ac4f…e2e2dab`. The R2.0 pair
(`r2-server-9c6fe62b7cb2` ↔ `r2-plugin-0e6528efaf17`, `sha256:fb3318c6…`) is now
historical and is rejected by the new preflight. The R2.0 read live result below remains
valid evidence for the runtime it names.

⛔ **Do not log those timeouts as an export bug.** The diagnosis is in the release note:
`get_runtime_info` reported `plugin: null` / `incompatible` / *"Plugin runtime probe
failed"* right after, so the plugin was saturated and answering nothing. Verify a
suspected tool failure against `get_runtime_info` before attributing it to the tool.
**This reproduced exactly on 2026-08-08 under R2** — see R2.1.

Then: the rest of R2 (safe authoring release) is next in sequence, **except** the variable
half of R3 already has a detailed plan and a real consumer waiting — see the R3 section.

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
so one scan cannot wedge the plugin. A large `filePath` export was still unconfirmed at
R1; R2.1 later closed that gate with a bounded live export and independent disk checks.

`figma-to-code` then updates its own pin and runs its own capture/emission acceptance.
That consumer pass is evidence for the interface, not part of this repository's
implementation.

---

## Release R2 — safe authoring release

### R2.0 — the two live-gate defects — ✅ LIVE GATE CLOSED BY R2.1 2026-08-10

Taken first because they are R1-derived cost/safety defects, not new capability. Contract
version `1.2.0`, release label `R2`.

- [x] **`export_node_as_image` declares `HEAVY_READ_TIMEOUT_MS` (120 s).** Its cost scales
      with pixel area and with base64-transferring bytes through the relay — neither
      visible in the arguments — and the plugin emits no progress for an export, so as
      with `get_document_info` the initial budget *is* the whole budget.
- [x] **`get_node_variables` is bounded.** `maxNodes` (**default 5000**, ceiling 50000),
      `timeBudgetMs`, `limit` (default 1000) and `offset`; iterative pre-order DFS so the
      window is stable and a deep subtree cannot blow the stack; new `coverage` +
      `pagination` blocks; `bindingCount`/`styleCount` keep their whole-scan meaning; and
      `complete` is false whenever anything truncated. It also moved to the heavy budget.
      Contract amendment: [`docs/R1-READ-CONTRACT.md`](docs/R1-READ-CONTRACT.md).
- [x] **The cap is a default, not an opt-in.** The failure it prevents — a wedged plugin
      that answers nothing until reloaded — is silent, and a truncated-but-declared reply
      is strictly better than that.
- [x] **`timeoutClass` is now compared as a ladder, not for equality.** Raising a budget
      cannot break a consumer already prepared to wait less; lowering one can, and is
      rejected with `timeoutClass was lowered`.
- [x] **The R1 contract is frozen as a baseline**
      (`contracts/baselines/r1-public-contract.json`), so these changes are checked
      against the accepted release and not only against R0. Both baselines pass at zero
      errors.
- [x] Regression tests: 41 pass (34 → 41). Six new cases cover the heavy-budget
      declaration, the timeout ladder in both directions, the node cap, the default cap,
      the time budget, count-vs-window separation, and offset paging reassembling the
      full record set in order.
- [x] **Live gate, `get_node_variables` half — PASSED 2026-08-08**, channel `jky2ox2v`,
      pair verified `r2-server-9c6fe62b7cb2` ↔ `r2-plugin-0e6528efaf17` /
      `sha256:fb3318c6…` **before** any measurement. Page `14:2` under the default cap:
      `nodesScanned: 5000`, `nodeCapReached: true`, `complete: false`, 518 KB (was
      3.66 MB), all three limitations present, `bindingCount: 1` / `styleCount: 1817` as
      whole-scan totals against a 1000-record window — **and `get_pages` answered
      immediately afterwards.** Paging verified live at `offset: 1815, limit: 2`.
      A first attempt on channel `qdzselca` was correctly rejected as the R1 pair.
- [x] **Live gate, export half — PASSED 2026-08-10**, channel `4g146t0n`, exact R2.1
      pair verified first. The 3× request refused in 11 ms at 800.3556 MP and wrote no
      file; 0.5× correctly remained over-limit, then 0.4× completed in 22.550 s. The
      file receipt matched independent byte/hash/dimension checks, and both runtime and
      page probes answered immediately afterwards.

### R2.1 — bounded export preflight — ✅ ACCEPTED 2026-08-10

Found by R2.0's own live gate, on the pinned R2 pair. Exporting section `1113:5031`
("LP" on page `3-LP`) as PNG at **`scale: 3`** with `filePath`:

- The request consumed the **full 120 s and rejected** — `"Error exporting node as image:
  Request to Figma timed out [runtime: server=r2-server-9c6fe62b7cb2, schema=1.2.0,
  plugin=r2-plugin-0e6528efaf17, compatibility=compatible]"`. The R2 budget behaved
  **correctly**: `server.ts` only resets a pending request's timer on a
  `progress_update`, export emits none, so its 120 s is a hard deadline, not a
  heartbeat-extended one. No partial file was written.
- ⛔ **The plugin then stayed saturated well past the server's deadline** —
  `get_runtime_info` returned `plugin: null` / `incompatible` / *"Plugin runtime probe
  failed"* on three successive probes over ~2 minutes, and a `get_selection` in between
  was refused by the latched preflight. The server gave up; **Figma kept rasterizing.**
  A DEV plugin reload is required to recover, exactly as in the R1 incident.

**The real defect was the missing cost signal, not the budget.** A caller could not tell
before committing that a request will cost 120 s and then cost the *whole session* its
plugin. Raising the budget further would only lengthen the wedge.

- [x] **Pre-flight the export in the plugin.** PNG/JPG now report node and render bounds,
      projected width/height/megapixels, the **16 MP fork safety ceiling**, whether the
      cost is known, and whether an override was used. Over-limit or unmeasurable raster
      requests refuse before `exportAsync`; `allowLargeExport: true` is the explicit
      escape hatch. SVG/PDF report the projection without applying a raster ceiling.
- [x] **Emit encoding progress.** `started` is flushed before `exportAsync`, followed by
      `in_progress` after Figma returns bytes and `completed` after response preparation.
      The existing 120 s inactivity budget is unchanged.
- [x] **Latch after an export timeout.** The server immediately marks compatibility
      `incompatible` and refuses document operations until `get_runtime_info` proves the
      plugin recovered. The last known plugin identity is retained for diagnostics.
- [x] **Version and verify the contract.** Public contract/server schema/plugin API
      `1.2.1`; source pair `r2-server-41d4d9bcf84a` ↔
      `r2-plugin-7e738b3a6c10`; fingerprint `sha256:eb7ac4f…e2e2dab`; 47 tests;
      R0/R1 compatibility baselines clean; `dist/` rebuilt. Consumer migration note:
      [`docs/R2.1-EXPORT-SAFETY.md`](docs/R2.1-EXPORT-SAFETY.md).
- [x] **Connected gate.** Section `1113:5031` passed the complete gate on channel
      `4g146t0n`: fast over-limit refusals at 3× and 0.5×, safe 0.4× file delivery under
      the budget, independent byte/hash/dimension agreement, and immediate compatible
      `get_runtime_info` + complete `get_pages` replies. Evidence:
      [`docs/R2.1-EXPORT-SAFETY.md`](docs/R2.1-EXPORT-SAFETY.md).

⛔ Do not "fix" this by raising `HEAVY_READ_TIMEOUT_MS`. The 120 s bound is not what broke.

### Generic safety and orchestration primitives

R2.0's live gate is closed; these are now the next R2 implementation front.

- [x] **Add `create_page` with explicit naming and duplicate behavior.**
      → **R2.2, ACCEPTED 2026-08-10** — [`docs/R2.2-CREATE-PAGE.md`](docs/R2.2-CREATE-PAGE.md).
      `create_page(name, onDuplicate?, index?)`; `onDuplicate` is `"error"` (default) or
      `"allow"`. `"reuse"` is **deliberately absent** and pinned absent by a test, because
      that is idempotency and the task below requires its semantics be proven first.
      Contract/schema/plugin API `1.2.1` → **`1.3.0`**; pair
      `r2-server-79eb6a3d10d2` ↔ `r2-plugin-3b393bab2224`; fingerprint
      `sha256:3f2407b8…310bb45`; 49 → **50 tools**, 48 → **49 plugin commands**; new
      capability `figma.command.create_page@1`. Offline 47 → **54 tests**, with the R2.1
      contract now frozen as a third baseline — R0/R1/R2.1 all replay at zero errors.
      **Live gate PASSED** on channel `0bcywzod`: append landed last (80 ms) without
      switching pages, the duplicate was refused in 5 ms naming the colliding id and wrote
      nothing, `"allow"` created a distinct page declaring `duplicateNameExisted`,
      `index: 0` shifted the previous first page, four invalid inputs were refused, and
      the three created pages were deleted leaving the document identical **id-for-id and
      in order** — re-verified afterwards from a separate client. `get_runtime_info`
      answered in 11 ms, still `compatible`.
      ⛔ **The pair guard is proven, not assumed:** run against the still-loaded 1.2.1
      plugin, the fresh 1.3.0 server refused at `join_channel` and named
      *"Plugin is missing commands: create_page"* before touching the document.
- [x] **Add bounded `get_plugin_data` / `set_plugin_data` tools so consumers may own
      their metadata conventions without the fork defining those conventions.**
      → **R2.3, ACCEPTED 2026-08-10** — [`docs/R2.3-PLUGIN-DATA.md`](docs/R2.3-PLUGIN-DATA.md).
      One optional `namespace` selects the store: omit it for this plugin's private data,
      pass one for Figma's shared store that the REST API and other plugins can read.
      Namespace isolation verified live. Bounded three ways — `limit`/`offset` key paging
      with `keyCount` kept as a whole-node total, `maxValueBytes` truncating the reply
      while reporting true `bytes`, and a write refusal above Figma's 100000-byte
      per-entry ceiling. Sizes are **UTF-8 bytes**, not UTF-16 units.
      Contract/schema/plugin API `1.3.0` → **`1.4.0`**; pair
      `r2-server-f152fb666599` ↔ `r2-plugin-8dc3783f024f`; fingerprint
      `sha256:c3cd6e71…dcc6bd`; 50 → **52 tools**, 49 → **51 plugin commands**. Offline
      54 → **65 tests**, R2.2 frozen as a fourth baseline; all four replay at zero errors.
      ⛔ **`set_plugin_data` refuses `value: ""`** — the design intent was that `""` stays
      storable, but **Figma defines writing `""` as removal**, so it is not implementable.
      An offline test written to the intended behavior failed and caught it. Encoding a
      sentinel was rejected because it would corrupt the shared store for every other
      reader; refusing keeps `null` the single explicit delete. `noop_absent` is reported
      rather than claiming a removal that did not happen.
      An absent key reads back `present: false`, never as a stored empty string.
- [ ] Add a generic batch operation contract with operation IDs, references to prior
      results, prevalidation, progress, stop/continue-on-error policy, and typed
      per-operation receipts.
      → **R2.4, PLANNED 2026-08-10 — planned, not started** —
      [`docs/BATCH-CONTRACT-PLAN.md`](docs/BATCH-CONTRACT-PLAN.md). `apply_batch` takes a
      caller-supplied `id` per operation (receipts correlate by `id`, never by array
      position), lifts `nodeId` **out** of `params` onto the envelope so the resolve pass
      need not know every tool's parameter shape, and returns a typed `outcome` enum —
      `all_succeeded` / `partial` / `all_failed` / `refused_prevalidation`. Bounded three
      ways like R2.3: a `maxOperations` schema ceiling, a **total** `timeBudgetMs`, and
      `maxResultBytes` truncating each result while reporting its true size. New
      `heavy_batch` timeout class at rank 4 (`heavy_read` means cost scales with the
      *file*; a batch scales with its *arguments*).
      ⛔ **"references to prior results" is deliberately NOT in v1** — it is the forward
      `$ref` machinery the create decision defers along with creates. See the closed R2
      batch-boundary question under *Open questions*.
      ⭐ **Auditing the three already-shipped batch tools produced five findings, and the
      contract is shaped by every one of them:** **(1)** the aggregate lies — all three
      return `success: successCount > 0`, so a batch of 100 where **99 fail still reports
      `success: true`** (`code.js:4720`, `:5129`, `:5333`); **(2)** three vocabularies for
      one concept (`replacementsApplied` / `annotationsApplied` / `nodesDeleted`, each
      with its own `*Failed` and `total*` spelling); **(3)** three execution models under
      one declared class — text and delete chunk by 5 with a 1 s inter-chunk sleep, while
      `set_multiple_annotations` is a plain sequential loop with no chunking, no delay and
      **no progress updates at all** (`code.js:5075`); **(4)** the public contract asserts
      progress that never happens — `SPECIAL_PROGRESS` (`contract-lib.mjs:257`) is a
      hand-maintained map declaring annotations `pluginUpdates: "chunked"` and it emits
      nothing, the R1 *"a hand-written schema drifts from observed replies"* lesson
      repeating with nothing asserting it against the runtime; **(5)** ⛔ **there is no
      total-duration ceiling, only an inactivity one** — `server.ts:3608-3627` resets the
      request timeout to `max(60000, timeoutMs)` on *every* progress update, so a chunked
      batch that keeps reporting **never times out** (10k deletes ≈ 33 min of inter-chunk
      sleep alone). Same defect class R2.0 already fixed once in `get_node_variables` via
      `timeBudgetMs`. ⭐ **Composed, 3+4+5 are a live defect:** annotations is the *only*
      one of the three that can actually hit the 30 s wall, precisely because it is the
      only one that never resets the timer — while the two declared identically to it are
      effectively unbounded.
      Phase 4 aligns the three shipped tools **additively** — new
      `outcome`/`succeeded`/`failed`/`total` *alongside* untouched legacy fields, so all
      four frozen baselines keep replaying at zero errors. ⚠️ Finding 4 is fixed **upward**
      (give annotations real progress updates) rather than by correcting the declaration
      to `"none"`, which would weaken a declared behavior and drop that tool onto the 30 s
      wall it already sits on.
- [ ] Add generic idempotency only after its semantics are proven independently of a
      consumer scene format.
      ⭐ **Load-bearing in the R2.4 decision** — this deferral is reason (3) for keeping
      creates out of the first batch version.
- [ ] Make destructive batch operations require exact node IDs and report their
      resolved scope before mutation.
      ⭐ **Load-bearing in the R2.4 decision** — this promise is reason (1) for keeping
      creates out of the first batch version. Satisfied by the plan's **D1** (prevalidation
      is a separate, *total* pass, and the `prevalidation` block is returned under **both**
      `onError` policies) and **D7** (`delete_node` inside a batch takes an exact node ID —
      no name or selector resolution, ever — and its prevalidation entry reports `name`,
      `type` and `childCount` so the caller sees the true blast radius before anything is
      mutated).

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

✅ **The queue-jump's precondition is GONE — corrected 2026-08-12.** This paragraph
previously read *"the queue-jump is bounded, not waived … the rest of R0 is still owed"*.
That was written 2026-08-07, **one day before R0 was accepted**, and R0 discharged all of
it: the plan's Phase 0 (parity + contract snapshot + one test command) **and** the three
things it had deferred — runtime fingerprint, full fixture harness, release mechanics. The
plan therefore carries **no prerequisite**; its entry point is **Phase 1.1**
(`hasVariableWriteApi`), and what remains is net-new work only. Styles, components and
variants still stay coarse below.

⛔ **The consumer gap is still open — re-verified 2026-08-12** against HEAD `c10c9ff`
(schema `1.4.0`, fingerprint `sha256:c3cd6e71…dcc6bd`): of **52 registered tools**, the only
variable-aware ones are `get_variables` and `get_node_variables`, **both read-only**;
`set_variable*` / `create_variable*` / `bind_variable*` match nothing in `server.ts` or
`code.js`; and none of the 33 write tools touches a variable, collection, or mode. All ten
`umjuansantos` §1.4 corrections remain hand-transcription. ⚠️ **`apply_batch` does not close
this** — it is mutate-only over existing **node** IDs, and variables are not nodes, so R2.4
completing changes nothing here.

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
- [x] **R2 — generic batch boundary:** *mutations of existing IDs only.* Closed
      2026-08-10, through the interview gate and before any design was written →
      [`docs/BATCH-CONTRACT-PLAN.md`](docs/BATCH-CONTRACT-PLAN.md). Four reasons, in the
      order that decided it: **(1)** prevalidation and create are in direct tension and
      prevalidation is **already promised** by the destructive-batch line above — with
      existing IDs the resolve pass is *total*, but a created node has no ID at
      prevalidation time, so the guarantee silently degrades to partial and that line
      becomes unsatisfiable as written; **(2)** creates are only useful with forward
      `$ref`s, which drag in a reference resolver, cycle detection, and an
      orphan-rollback story for mid-batch failures — none of it proven, none of it
      needed to ship batching's actual value; **(3)** a create batch without idempotency
      duplicates on every rerun, which forces the idempotency decision *already deferred*
      above through the back door; **(4)** it is a **version** boundary, not a permanent
      one — `op` is an allowlisted string and the receipt is already per-operation and
      typed, so creates arrive later as a new `op` kind with no envelope change.
      ⛔ **The absence of creates must be pinned by a test**, exactly as R2.2 pinned
      `"reuse"` absent from `onDuplicate`; a deliberate omission that is not asserted
      reads as an oversight the next time someone extends the allowlist.
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
