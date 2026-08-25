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
| **R3-A — Variable write slice** *(scheduled next after R2.7; the 2026-08-22 "pulled ahead of R2.7" ordering was reversed 2026-08-23 — the slice stands, its position moved)* | `set_variable_value`, `create_variable`, `delete_variable` — values, aliases and removal against existing collections and modes | A real design-system reconciliation can be executed through the plugin surface alone, with no REST access and no plan dependency |
| **R3 — Design-system authoring release** | Generic variable/style/component creation and binding | Higher-level clients can create reusable Figma systems without making the fork OpenDesign-specific |

After each release: record the fork acceptance, classify additive/breaking changes,
let consumers update their pins independently, and re-cut the next release.

---

## ▶ Current session — **R3-A PHASE 3 RESOURCE IDENTITY BUILT; LIVE GATE PENDING.**

✅ **R3-A Phase 3 resource identity — 2026-08-24.** `create_variable` now resolves an
existing local resource in fixed order — explicit `id`, then exact collection/name, then an
opaque private `identityKey` — before creating. Every normal receipt says `{created,
matchedBy}`; incomplete inventory, duplicate identities, key conflicts, and unverified key
storage refuse or report uncertainty rather than creating a green duplicate. The identity key
is exact opaque plugin data, never parsed, normalized, or echoed. The release is **R3-A /
`1.13.0` / 70 tools**: `r3-a-server-c3d335284ec5` ↔ `r3-a-plugin-02cca8304cfb`, fingerprint
`sha256:000d808e4f63fce7ce6b965089b3f76e51a73d29a46557ea510993dcefe7d4ff`. Its dedicated
`live-variable-identity-gate.mjs` is pinned but **unrun**: reload the DEV plugin and use it
only against an owner-confirmed disposable file. The pending `deleteVariable` comment fix
travelled in this same source change and now names in-frame collection membership as the
working removal signal. **`bun run verify` passed 395/395** and rebuilt `dist/server.js`
`sha256:7493a32a…6822d309`; the explicit commit remains the owner's act.

✅ **R3-A Phase 2 first slice — 2026-08-24.** The release now has **70 tools** at
**`1.12.0`**: `set_variable_value`, `create_variable`, and `delete_variable` work only on
exact local variables, collections, and modes. The setter supports typed raw values or a
same-type local alias, rejects cycles before Figma sees a write, and returns an observed
readback. Create is direct (not an upsert); delete requires literal `confirm: true` and only
claims deletion after a follow-up lookup confirms absence. The focused offline suites cover
raw type validation, alias/cycle guards, remote refusals, destructive confirmation, and an
unverified removal. **`bun run verify` passed 391/391** and rebuilt `dist/` for
`r3-a-server-214dd61cca06` ↔ `r3-a-plugin-4aa3214c4754` (`1.12.0`; `dist/server.js`
`sha256:8e4cf3e5…19e0`). ⚠️ The `delete_variable` sentence above describes the FIRST
implementation, which the live gate disproved — see the acceptance block below.

✅✅ **Live Phase 2 acceptance is PAID — 2026-08-24, channel `hxpwe1ej`**, collection
`VariableCollectionId:17050:370` *"8. Dimensions"* (10 modes). `live-variable-write-gate.mjs`
**PASSED TWICE**: all three deletes observed via `collection_membership`, no write leaked into
any of the **9** non-target modes, zero cleanup retries, and a fresh-frame read found **0**
leftovers. Full record → [`docs/R3-A-VARIABLE-WRITE.md`](docs/R3-A-VARIABLE-WRITE.md).

🔴 **The live gate found a real defect: `delete_variable` could never report success.** Its
post-`remove()` check asked only `figma.variables.getVariableByIdAsync`, which Figma answers
with a **stale** object inside the deleting frame — so `removalObserved: true` was unreachable
live while the offline harness (*"remove() makes the next lookup miss"*) kept it green. The
first live run on `hvq0orwg` failed with three `delete_not_observed` receipts for variables
that were in fact **already gone**. Fixed by probing independent signals and naming the one
that fired; live-measured: the lookup is stale, `Variable` has **no** `removed` flag, and
**collection membership updates in-frame**. When nothing can observe it the receipt is
`removal_unconfirmed` + `verificationDeferred`, never a success — a real delete and a no-op
`remove()` are identical from inside that frame. ⚠️ That deferral path is offline-covered but
**live-unexercised**.

⛔ **Re-running is still target-explicit.** `scripts/live-variable-write-gate.mjs` requires all
of `--channel=<DEV-plugin-channel-for-a-disposable-file>`,
`--collection-id=<existing-local-collection-id>`, and `--disposable-target=true`. It creates
and deletes variables, so cleanup is deliberately only best-effort — and it now drops a
variable from its retry list only once absence is **proven** by the cross-frame re-read. Prefer
a **multi-mode** collection: on a single-mode target "wrote the mode I named" and "wrote every
mode" are the same bytes, so the isolation assertions prove nothing. The Phase 1.3 mode gate
requires the same acknowledgement and still has no cleanup by design. Do not infer that a
channel is disposable: the owner must explicitly confirm the target file each time.

✅ **R3-A Phase 1.3 `add_variable_mode` — 2026-08-24.** The new public
additive-preview write moves the release to **R3-A / `1.11.0` / 67 tools**:
`r3-a-server-af8987322467` ↔ `r3-a-plugin-b5ee1c0b619a`, fingerprint
`sha256:6a68b351…deb6428`. It makes exactly one caller-requested
`collection.addMode(name)` call on an exact local collection. If Figma refuses at its ceiling,
the receipt keeps the raw message verbatim, reports the pre-call known-good mode count, and
only derives a numeric limit from Figma's own `in addMode: Limited to N modes only` message.
It has no plan table, temporary mode/collection, or `removeMode` cleanup path. Offline
**378/378**, `bun run verify` green, `dist/server.js` rebuilt
(`sha256:a0e41990…15002`).

⛔ **Live refusal still owed.** `scripts/live-variable-mode-gate.mjs` requires a supplied
channel plus a disposable local collection already at its real ceiling. It performs no setup
or cleanup; if the one requested add succeeds, it intentionally leaves that real mode in
place and fails instead of manufacturing a delete. The public command moved both runtime
artifacts, so the ten R2 gates are explicitly declared stale in
`tests/live-gate-pins.test.mjs`; no pin was edited to fabricate a run. Reload the DEV plugin
and respawn the MCP server before the live gate, then measure both build IDs.

✅ **R3-A Phase 1.2 `get_variable_capabilities` — 2026-08-24.** The new zero-argument,
document-scoped read tool registers on both server and plugin, moving the release to
**R3-A / `1.10.0` / 66 tools**:
`r3-a-server-12c88b765a45` ↔ `r3-a-plugin-122b65ca30e9`, fingerprint
`sha256:b367651f…751279`. It reports API presence, `isRemote`/`modeCount` per collection,
and the facts Figma cannot expose without mutating: `document.editable:null` when file ACL
is unobservable and `modeCeiling.value:null` until an actual `addMode()` refusal. The payload
also names the observable editor context and the current `knownGoodAtLeast` mode count, so
unknown never masquerades as permission or a plan limit. Offline **373/373**, `bun run
verify` green, and `dist/server.js` rebuilt (`sha256:ea7581c8…7356d3`).

✅ **Subsequently live-validated and re-pinned.** The Phase 1.2 record below documents its
later live validation and ten-gate re-run. Phase 1.3's new public command now stales those
same gates again; its first real ceiling refusal and the next re-pin/run remain pending a
supplied Figma channel.

✅✅ **R3-A PHASE 1.1 RE-PIN + RE-RUN — 2026-08-24, channel `chvza8ab`.** Phase 1.1
(`hasVariableWriteApi()` in `code.js`) regenerated `pluginBuildId`
`0ace9ed58f34` → **`a34d76fc6bc6`**, staling the same **TEN** gates R2 acceptance had just
cleared. They were re-pinned in one pass and **re-run once each — ALL TEN PASSED**, no new
defects: fresh scratch page each, six-page baseline restored each, confirmed by a separate
read afterwards. Offline **371/371**, `bun run verify` green, `dist/` rebuilt
**byte-identical** (`sha256:94ba5c47…e027a`). Ledger back to the three R2.1/R2.2/R2.4 gates;
the two R3-A constants and the `currentGates === 0` branch are **deleted**. Record →
[`docs/VARIABLE-WRITE-PLAN.md`](docs/VARIABLE-WRITE-PLAN.md) § *1.1*.
🟡 **UNCOMMITTED — 14 files** (10 gates + the pins test + the plan + `MEMORY.md` + this file).
⛔ Committing is the owner's act.

⭐ **A PIN SHAPE THIS PROJECT HAD NOT RECORDED: only `pluginBuildId` moved.** 1.1 registers no
MCP tool and no `capabilityId`, and touches neither `server.ts` nor the contract, so
`serverBuildId`, the schema `1.9.0`, the fingerprint and the 65-tool count **all four HELD**.
It is the exact inverse of R2.6 acceptance (server-only), and ⛔ **the operator consequence
flips with the direction** — plugin-only means *reload the DEV plugin*, server-only means
*respawn the MCP session and do NOT reload*. ⛔ Neither side is visible to a fingerprint
check by construction: in a single-sided move the capability surface really **is** identical
and one running artifact is not. The reload was **MEASURED** first, via live
`get_runtime_info` → `plugin.buildId`, never off `compatibility: "compatible"`.
🔴 **The pins were proved CHECKED, not merely present, in both directions:** a throwaway copy
of `live-clips-content-gate.mjs` pinned to `r2-plugin-000000000000` refused at
`assertRuntime` — exit 1, naming both ids, no baseline read, no scratch page created — and
the offline pins test went red on one drifted undeclared pin, naming the file, then green on
restore. Ten greens whose refusal leg never fires measure the inputs, not the pins.
⚠️ **The ten reports are GITIGNORED** (`docs/evidence/r3a-1.1-repin/` falls under `docs/*`),
so they have no second copy — the committed record is the ledger comment in
`tests/live-gate-pins.test.mjs`.
✅ **The Phase 1.3 live ceiling refusal is PAID — 2026-08-24, channel `hdejcpog`**, collection
`VariableCollectionId:17050:370` *"8. Dimensions"*. The gate **PASSED TWICE**, byte-identical:
`modeCount 10 → 10`, `mode:null`, `modeCeiling {value:10, status:"observed"}`, Figma's message
verbatim `in addMode: Limited to 10 modes only`. 🔴 **10 appears in no cited Figma plan tier
(1/4/40)** — the "never hardcode a plan→limit table" rule paid for itself. ⚠️ The first attempt
fired at 4 modes on the inference that `knownGoodAtLeast: 4` was the cap; it means *at least*,
the add succeeded, and the gate correctly failed rather than scoring a non-refusal as a pass.
Reports are gitignored; the committed record is `docs/VARIABLE-WRITE-PLAN.md` § *1.3*.

✅✅ **THE TEN-GATE RE-PIN IS PAID — 2026-08-24, channel `hdejcpog`.** Re-pinned to
`r3-a-server-af8987322467` ↔ `r3-a-plugin-b5ee1c0b619a` (`1.11.0`, 67 tools) and re-run once
each — **ALL TEN PASSED**, verdicts read from each `report.json` `success`, zero scratch pages
left, pins proved checked in both the stale-declaration and `assertRuntime` directions. The
ledger is back to the three R2.1/R2.2/R2.4 entries. Offline **378/378**.

⏳ **Open:** R3-A still has no record doc of its own (R2.7 had `R2.7-VISUALS.md`); Phases 1.2
and 1.3 are recorded inside the plan. **The broader Phase 2 surface is not started; its
implemented three-tool R3-A slice still needs a live run on an explicitly disposable target.**
The three R2.1/R2.2/R2.4 gates remain declined.

### Previous — R2 acceptance

✅✅ **R2 ACCEPTANCE CLOSED — 2026-08-23/24, channels `w113vf7y` then `6cbroncs`.**
The representative fixture PASSED **twice** on `w113vf7y` (fresh scratch page each run,
`6056:129` / `6056:138`), every measured value agreeing including a **byte-identical export
`sha256`**; both runs restored the page baseline. All five R2.7 tools are `stable`. Then the
**TEN** stale gates were re-pinned to `r2-server-a0afdc880ab0` ↔ `r2-plugin-0ace9ed58f34`,
65 tools, and **re-run once each on `6cbroncs` — ALL TEN PASSED**, no new defects. Offline
**370/370**, `bun run verify` green, rebuild reproduced both build IDs. The ten declarations,
the `R2_ACCEPTANCE_REPIN_PENDING` list and the `currentGates === 0` branch are **deleted** —
the ledger is back to the three R2.1/R2.2/R2.4 gates. Record →
[`docs/R2.7-VISUALS.md`](docs/R2.7-VISUALS.md) § *R2 ACCEPTANCE*.
✅ **COMMITTED by the owner** as `d8c488e` + `726f8a4` + `5e452ed`.

🔴 **THE FIXTURE FOUND A DEFECT IN A TOOL ALREADY PROMOTED TO `stable`.** `set_effects`
advertises `visible` and `blendMode` as `.optional()`; **Figma requires** both on shadows and
`visible` on blurs, so the minimal effect a generic client writes from the schema was refused
outright — the exact claim R2 acceptance makes. ⛔ The published schema was **wider than the
platform accepts**; the refusal was clean and the document untouched.
⭐ **Every gate was green straight through it.** `live-effects-gate`'s one successful shadow
supplies both fields, and its omission probes are refused by the fork's OWN handler before
reaching Figma — so the platform's union validation was never exercised. **A green gate is
evidence about its inputs.** The offline harness cannot model that union at all, and one
pre-existing test asserted a stored blur shape real Figma would have refused.
✅ Fixed in the per-type `EFFECT_FIELD_RULES` table (blurs default `visible` only — a blur has
no `blendMode`, and sending one returns as an unrecognized key), applied LAST so an explicit
`visible: false` still wins. 3/3 mutants killed, control survived. `live-effects-gate.mjs`
gained the minimal-effect section that would have caught it, and it passed live on all four
types. ⛔ Sequenced BEFORE the re-pin, so the ten-gate price was paid **once**, not twice.

⛔ **FIVE R2.6 LAYOUT TOOLS ANSWER IN PROSE, NOT A RECEIPT** — `set_layout_mode`,
`set_padding`, `set_axis_align`, `set_item_spacing`, `set_layout_sizing`. The fixture declares
the reply shape **per tool**; a try-JSON-then-prose fallback would let a receipt-returning tool
quietly degrade to prose and still pass. An offline test re-reads `server.ts` each run so the
declaration cannot rot. ⭐ The prose does echo the node's name, which the fixture pins.

✅✅ **PHASE 2 WAS DONE — 2026-08-23, channel `sdg5mr5m`, `live-svg-crop-gate.mjs` run twice**,
fresh scratch page each time, renders byte-identical across runs. `create_node_from_svg` +
the `set_image_fill` CROP repair. Pair `r2-server-2ca49b0a4fd1` ↔ `r2-plugin-2741d7f5f374`,
schema **HELD at `1.9.0`**, **65 tools**, offline **363/363**, `verify` green, 10/10 + 8/8
mutants killed with controls surviving. Record →
[`docs/R2.7-VISUALS.md`](docs/R2.7-VISUALS.md) § *Phase 2*.
🔴 **The CROP defect was NOT what the checklist said** — Figma accepts `CROP` and stores it;
the missing piece was `imageTransform`, whose absence renders a **stretch** reported as a crop.
⭐ A read-back could not have caught it: the plugin says `"CROP"`, only REST says `"STRETCH"`.
🔴 **Figma stores the image transform as FLOAT32** — `0.34` → `Math.fround(0.34)`, item 1.3's
finding on a second field, and the identity matrix could not have revealed it.
🔴 **The gate ledger is back to NINE** (the eight, plus `live-opacity-blend` for the first
time). ⛔ Re-pinned and re-run ONCE at R2 acceptance, after promotion moves `serverBuildId`.
✅ **COMMITTED 2026-08-23** — `7f43017` (tools) + `5ad4239` (tests + live gate) + `64f85b0`
(records). Tree clean, HEAD `64f85b0`.

✅ **The eight-gate re-pin was paid earlier the same day** on channel `3az2oicz` — see the debt
block below. ⚠️ It closed **Phase 1**, not the release; Phase 2 re-staled the set within hours.

✅✅ **ITEM 1.3 `set_opacity` / `set_blend_mode` IS BUILT AND LIVE-GATED — 2026-08-23.**
`live-opacity-blend-gate.mjs` PASSED on channel **`shtlklfy`**, **run twice**, both runs on a
fresh scratch page and agreeing on every measured value. Pair `r2-server-d95951a3ce93` ↔
`r2-plugin-364f8001f2d1`, `1.9.0`, **64 tools**, offline **343/343**, `bun run verify` green.
⚠️ **ADDITIVE ONLY held, and it is now MEASURED**: `get_node_info` grew neither `opacity` nor
`blendMode`, before or after the writes — `1.9.0` was spent by 1.2 and `1.10.0` is R3-A's, so
R2.7 has no bump left. Opacity moved the scene's rendered bytes while an untouched control
held byte-identical; NORMAL/MULTIPLY/SCREEN rendered as three distinct byte streams; all four
refusals arrived from their declared layer with the document unchanged. Full record →
[`docs/R2.7-VISUALS.md`](docs/R2.7-VISUALS.md) § *1.3 live gate*.
✅ **COMMITTED as `9037f94`** (gate repair + records), on top of `7037c24`. ⚠️ This line read
*"🟡 UNCOMMITTED — the gate repair below is in the working tree"*, which was true when written
and stayed on the page after the commit landed — the same stale-status-marker shape this
tracker keeps catching. Corrected 2026-08-23.

🔴 **THE GATE'S FIRST RUN FAILED AND THE TOOL WAS RIGHT.** `set_opacity` returned
`0.3499999940395355` where the gate asserted `0.35` — exactly `Math.fround(0.35)`, because
**Figma stores layer opacity as a float32** and the handler writes then re-reads the node.
⭐ The failure is *positive evidence the read-back is real*: only an echo could have returned
exactly `0.35`. The assertion now pins `Math.fround(0.35)`, which is **stricter** — a
known-bad rerun showed the **original** assertion PASSED an echoing receipt while the new one
rejects it, along with a discarded write and a wrong rounding. ⛔ No tolerance was introduced.
🔴 No offline test could have caught it: the fake node stores a plain double, so the harness
cannot model float32 in either direction. ⏳ Quantizing the harness on write is open and cheap.
⭐ The repair moved **no pin** — `scripts/` and `tests/` feed neither build ID — so nothing
was staled and the gate stays out of `GATES_PINNED_TO_AN_EARLIER_RELEASE`.

✅✅ **ITEM 1.2 `set_effects` IS BUILT, GATED AND COMMITTED — 2026-08-23**
(`e394e38` build + `b531d68` read-source repair). `live-effects-gate.mjs` PASSED on channel
`5982svqp`, **run twice**, pair `r2-server-fa007eb01947` ↔ `r2-plugin-e577688241c0`, schema
`1.9.0`, 62 tools. Offline **334/334**, `bun run verify` green, 2 mutants killed. All six
gate sections ran; the five semantic refusals all arrived from the **handler** layer with
`documentUntouched: true`. Full record → [`docs/R2.7-VISUALS.md`](docs/R2.7-VISUALS.md)
§ *1.2 live gate*.

🔴 **THE GATE'S FIRST RUN FAILED ON A REAL DEFECT — decision ①'s premise was wrong.**
① scoped the repair as four fields added to `filterFigmaNode` in both copies. Three were
genuinely filtered out; **`effectStyleId` was never in the channel at all**, so its allowlist
entry was dead code — `getNodeInfo` exports `JSON_REST_V1` and hands *that document* to the
filter. Measured live: a bound node carries `styles: { effect: "6052:226" }` (present on
children too), an unbound node carries **no `styles` key**, and neither carries
`effectStyleId`. ⛔ **The REST key is a different ID SPACE** from the plugin's
`"S:0a45cd18…,"`. Fixed by attaching the reading from the **plugin node** before filtering,
in all three top-level readers. ⭐ `server.ts` needed no change, so `serverBuildId` HELD and
only `pluginBuildId` moved.

🔴 **The offline suite was green on that dead path throughout** — the harness's fake export
was `Object.entries(node)` and the effects model had made `effectStyleId` enumerable, so the
double injected a field the real channel never returns. Repaired + 2 behavioural guards,
both proven killable. ⛔ The older *"both filter copies preserve the four fields"* test is a
**source grep** and never once failed.

⏳ **Two open decisions carried out of 1.2, both the owner's:**
① **`""` vs `null` for "unbound"** — the read channel publishes Figma's raw `""`, the receipt
maps `"" → null` (`code.js:8426`). Bound nodes join exactly; the empty case does not.
② **REST's `styles` map is unpublished**, so nested nodes carry `effects` but no effect-style
reading. Measured to exist at depth; publishing it is a second id space and new surface.

🔴 **A NEW DEBT AGAINST 1.1:** `set_fill` **silently drops `color` on a gradient** and the
schema advertises the drop — the same "a discarded value reads as an applied one" rule the
tool enforces on its other two pairs.

✅ **SCHEDULED 2026-08-24 — the reason for declining expired.** It was declined because it
"costs a re-run of a gate that passed twice on `yoq962bg`". R3-A Phase 3 moved both build ids,
so that gate is **already stale and already owes a re-run** — the price is now zero and the
repair rides along with the post-modes-phase re-pin. ⭐ A cost that justified a "no" is not
permanent; re-read it when the build moves.

⚠️ **The old pointer `code.js:8047` is STALE** — Phase 3 added 457 lines and 8047 now lands
inside `deleteNode`. `setFill` begins at `code.js:9976`; re-locate the drop there before
repairing, and do not trust any line number in this file written before `3bbbfab`.

✅✅ **ITEM 1.1 `set_fill` IS BUILT, GATED AND COMMITTED 2026-08-23** — solid + all four
gradients, `paints: Paint[]` or `null`, one nested colour shape, ending the `set_fill_color`
divergence R2.4's gate caught. `live-fill-gate.mjs` PASSED on `yoq962bg`, **run twice**;
318/318 offline, **12/12 mutants killed**, `verify` green at **61 tools**. Landed as
`1e5bc0a` + `c3b167d`. ⛔ **Committing is the owner's act** — *"leave commit to me"*, said
2026-08-23; a session builds and verifies, it does not commit.
⛔ **1.1 spent NO bump — the schema HELD at `1.8.0`.** ⭐ **1.2 spends it**, per decision ①,
and `1.10.0` belongs to R3-A — so there is no second bump behind this one.
✅ **R2.6 CLOSED 2026-08-22** — four layout tools gated, backlog cleared on `sa6ggz00`, all
promoted to `stable` at acceptance.
✅ **CC3's seven-tool debt is PAID, 2026-08-23** — R2.5 and R2.6 frozen as the 7th and 8th
baselines (`0c0f68a`), `ACCEPTED_SINCE_LAST_BASELINE` emptied to `[]` (`6e558ba`).
✅✅ **THE END-OF-R2.7 RE-PIN IS DONE — 2026-08-23, channel `3az2oicz`.** The debt closed at
**EIGHT** gates, not seven: item 1.3 staled `live-effects` after this line was written. All
eight — `live-batch`, `live-text-style`, `live-layout`, `live-constraints`,
`live-size-limits`, `live-clips-content`, `live-fill`, `live-effects` — re-pinned to the R2.7
final build `r2-server-d95951a3ce93` ↔ `r2-plugin-364f8001f2d1`, `1.9.0`, fingerprint
`sha256:9b7abf64…dacb4`, **64 tools**, then **run once each on one channel. All eight PASSED,
no new defects.** Offline **343/343** and `bun run verify` green on both sides of the change.
Their entries are **deleted** from `GATES_PINNED_TO_AN_EARLIER_RELEASE`, so the ledger is
down to the three R2.1/R2.2/R2.4 gates. Full record →
[`docs/R2.7-VISUALS.md`](docs/R2.7-VISUALS.md) § *End-of-R2.7 re-pin*.
⭐ **A pin edit still does not move the build** — eight scripts and one test changed and every
pin held, `verify`'s rebuild reproducing both IDs byte-for-byte, so the eight remain pinned to
the build they ran on. The re-pin does not stale itself.
🔴 **The pins test was proved live in both directions before its green was believed** — a
corrupted `toolCount` failed, a re-added declaration on a current gate failed, the restored
control passed. Necessary because `readPins` compares only the keys it can parse, so a broken
regex would narrow coverage silently; the parse was asserted separately at 5/5 on all eight.
⛔ **The three older gates were NOT folded in** — put to the owner 2026-08-23 and declined.
⛔ **The `set_fill` gradient `color` drop was NOT repaired** — also put to the owner in the
same round and declined; paying it later costs a second eight-gate re-run, which is now the
known price rather than an unexamined one.

✅ **BOTH REVERSED 2026-08-24.** The owner scheduled the gradient repair AND the three older
R2.1/R2.2/R2.4 gates to ride along with the re-pin that follows the modes phase. Both "no"s
rested on the cost of a re-run that is now owed regardless, so folding them in is free.

✅✅ **AND THE GRADIENT HALF IS NOW BUILT — R3-A Phase 4, 2026-08-24.** `set_fill` refuses
`color` on all four gradient types, the published description no longer advertises the drop,
and the refusal is mutation-tested against the SOURCE. ⏳ The three older R2.1/R2.2/R2.4
gates still ride along with the re-pin — that is a RUN, and it has not happened.

⚠️ **THIS SECTION SAID "THE RELEASE AFTER R2.6 IS NOW R3-A, NOT R2.7 VISUALS" — corrected
2026-08-23.** The ordering was reversed back to **R2.7 first, then R3-A**, on the owner's
call. ⛔ **Nothing below about R3-A is withdrawn** — the Enterprise-gating finding, the
`fileKey` correction and the slice's scope all stand exactly as written, and R3-A remains
the release *after* R2.7. Only its POSITION IN THE QUEUE changed. ⚠️ Both cannot spend the
`1.9.0` bump; R2.7 spends it, so R3-A re-plans onto `1.10.0` when it comes up.

⭐ **R3-A — the slice that follows R2.7 — was prioritized 2026-08-22.**
Three tools (`set_variable_value`, `create_variable`, `delete_variable`), one bump
(⚠️ **`1.9.0` → `1.10.0`**, not `1.8.0` → `1.9.0` as first written — R2.7 spends `1.9.0`),
one live gate. Plan →
[`docs/VARIABLE-SLICE-PRIORITIZATION.md`](docs/VARIABLE-SLICE-PRIORITIZATION.md).
**What changed is not the gap — it is that the only alternative route was eliminated.** The
Figma REST Variables API is Enterprise-gated on **reads as well as writes**, and the
consumer's account is Education/Professional, so the fork is now the sole path rather than
the convenient one. ⛔ **The missing `fileKey` was never the blocker** — it was captured
2026-08-07 to unblock exactly this route, and the route was already closed; do not re-open
the question on the grounds that a fileKey exists.

**✅✅ R2.6 ITEM 2.3 IS BUILT AND GATED 2026-08-22** — `set_size_limits`, a node's min/max
width and height. **260 tests green** (was 224), **twelve** source mutations killed with the
control surviving, `dist/` byte-identical across three builds, `verify-release` passed, then
`scripts/live-size-limits-gate.mjs` PASSED on channel **`o2vws4ph`**, **run twice**.
⛔ **NO contract bump** — additive, schema **HELD at `1.8.0`**, zero `compatibilityErrors`.

🔴 **THE GATE FOUND TWO REAL DEFECTS ON ITS FIRST RUN, AND BOTH WERE IN THE TOOL.** See the
section below — decision ③ was superseded by its own measurement, which is the process
working rather than failing.

⚠️ **THE PIN SHAPE CHANGED TWICE INSIDE THIS ONE ITEM, and the second is new to this
project.** Building the tool gave 2.1/2.2's shape: both build IDs, the fingerprint and the
tool count (58 → 59) moved, the schema held. Then the context-rule fix moved **ONLY THE
BUILD IDS** — 🔴 the fingerprint HELD, the schema held, the tool count held, while a new
refusal and a rewritten published description shipped underneath. The fingerprint hashes the
capability SURFACE, so a rule added *inside* an existing tool is invisible to it: the
stale-plugin preflight caught that run on the **build ID alone**, and a fingerprint check by
itself would have waved a stale plugin straight through. Final pair
**`r2-server-a9e8d5b3bf78` ↔ `r2-plugin-1fb9729971a3`**, fingerprint
**`sha256:89be6e6c…cea87f9d`**. ⛔ Re-derive from `runtime-metadata.ts` — this is the ninth
step and the answer has now differed on nearly every one.

⛔ **The gate refused at `join_channel` TWICE before it could start**, once per plugin build
— first on `r2-plugin-e82230c1bbb1`, then on `r2-plugin-81dba60db9dd` after the fix.
**Nothing in the document was touched either time.** That is the second and third times
`assertRuntime` has fired for real.

### 🔴 What the first live run found

Decision ③ named two possible answers — the limit RESOLVES, or it is INERT (a silent
discard). Figma gave a **third**: it THROWS. §6 became an eight-cell matrix and the measured
rule is purely **CONTEXTUAL** — writable on auto-layout nodes and their children, **node
TYPE irrelevant**. A RECTANGLE inside an auto-layout frame is accepted; a TEXT inside a
plain frame is refused.

- 🔴 **The eligibility probe measured the wrong thing.** It asked whether the node *exposes*
  `minWidth`. All four properties are **readable on every node**, returning null; only the
  WRITE is gated. So all four ineligible cases were refused by **FIGMA, during the write
  phase**, and the handler had never once refused for the right reason against a real
  document. On a tool writing four independent fields that is a partial application waiting
  for the right ordering, and it made "validate-all-then-write" a claim the tool could not
  back. ⭐ The gate measured that Figma happens to reject the **first** field, so nothing
  landed — the platform's ordering, not this tool's guarantee.
- 🔴 **The offline harness modelled a TYPE rule Figma does not have** — a RECTANGLE in an
  auto-layout frame refused offline and accepted live, a TEXT in a plain frame the other way
  round. Its eligibility tests were green against a fiction. Same class as the blanket
  `layoutMode: "NONE"` 2.1 shipped and 2.2 paid off.
- ✅ **Fixed** (owner's call): the handler owns the rule in the validation phase, naming
  `set_layout_mode` as the way in; the harness makes the properties readable everywhere and
  gates the **setter**, so a handler that forgot the rule fails offline instead of only in
  Figma. Fixture gained `50:1`, an auto-layout branch — every pre-existing frame on page two
  is the case Figma refuses. The re-run then **proved the refusal moved layers**: four
  handler refusals, zero platform ones.

### 🔴 And two defects in the GATE itself, both self-inflicted

- 🔴 **An instrument pinned to the implementation it measures** fails on exactly the change
  it exists to verify. §6b's instrument asked whether some context was refused *by the
  platform* — true before the fix, false after, so a correct fix made the gate report its
  own probe proved nothing.
- 🔴 **§7 asserted a belief about the harness instead of reading it**, and went on emitting
  a red "go fix SIZE_LIMIT_CARRIERS" finding after the harness was already correct. It now
  READS `plugin-harness.mjs` and discriminates with two readings no type rule can produce
  together.

**Four decisions taken with the owner BEFORE building:** ① **`null` clears, omitted
preserves** — R2.3's plugin-data semantics, published in the contract as
`type: ["number","null"]`; ② the pair rule validates the **EFFECTIVE post-write pair**
(supplied merged over stored), so a lone `minWidth: 500` is refused against a stored
`maxWidth: 300` — a conflict invisible in the caller's own arguments; ③ **NO context
refusal** — ⚠️ **SUPERSEDED by the gate's measurement**, see above: the rule turned out to
be real and enforced by a throw, so the handler now owns it. ③ was still right at the time,
and it is what produced the measurement; ④ the **clamp is reported, never refused** — the
receipt carries `size.before`/`size.after` and `resized`, a second currency the stored value
cannot report.

⛔ **Partial application is genuinely possible here for the first time since Phase 1.** 2.1
wrote one field, 2.2 wrote one OBJECT — validate-all-then-write was a formality in both.
⚠️ **And the pair trap has a SECOND half validation cannot catch:** two assignments pass
through an intermediate state, so the write **ORDER** is computed per axis. Raising past
the stored max needs max-first, lowering below it needs min-first. ⭐ One of the two is
always available — for both to be unsafe the node would already hold min > max.

⭐ **`appliedFields` is PRESENT here and was deliberately ABSENT from 2.2's receipt** —
there both axes wrote every call, so the list was a constant that could never fail.

🔴 **A mutation SURVIVED the first run, and the fix was in the HARNESS, not the tool.**
While the platform stores exactly what it is handed, a receipt that echoes its arguments
and one that reads the node back produce **identical output** — `appliedFields` would have
been decorative for the second time in three items. Closed with an opt-in
`roundSizeLimits` coercion; a node that rounds separates the echo from the read in one
reading. ⛔ Same family as [[feedback_a_zero_valued_write_reads_as_no_write]], caught by
mutation rather than by review.

🔴 **FOUR gates are now declared stale** by name in `tests/live-gate-pins.test.mjs`:
`live-batch-gate.mjs`, `live-text-style-gate.mjs`, `live-layout-gate.mjs` and now
`live-constraints-gate.mjs`, which passed on `2bcdtr5b` earlier the same day. ⛔ None
re-pinned — this change cannot re-run them. **Owner's standing call: re-pin and re-run the
set ONCE, after 2.4 lands** — it is the last of the four layout tools.

---

## ▶ Previous — item 2.2 (BUILT + GATED)

**✅✅ R2.6 ITEM 2.2 IS BUILT AND GATED 2026-08-22** — `set_constraints`, how a node resizes
with its parent frame. **224 tests green** (was 204), seven source mutations killed with the
control surviving, `dist/` byte-identical across three builds, `verify-release` passed, then
`scripts/live-constraints-gate.mjs` PASSED on channel **`2bcdtr5b`**.
⛔ **NO contract bump**: a new tool is additive, schema **HELD at `1.8.0`**, zero
`compatibilityErrors`.

⚠️ **Pin shape is the SAME as 2.1 and NOT 2.0** — both build IDs moved, the fingerprint
moved, the tool count moved **57 → 58**, the schema **held**. New pair
**`r2-server-06f75969aa1d` ↔ `r2-plugin-e82230c1bbb1`**, fingerprint
**`sha256:8ceaf9d2…93b236f`**. ⛔ Re-derive from `runtime-metadata.ts` — eight steps, and
this answer keeps changing shape.

⛔ **The DEV plugin re-run was REQUIRED this time, not just verified.** The first gate
attempt refused at `join_channel` with the plugin still on `r2-plugin-3f7c7cd69133`, and the
preflight named the missing command. **Nothing in the document was touched.** That is the
first time `assertRuntime` has actually fired for real — 2.0 and 2.1 both found the plugin
already current.

**Four decisions taken with the owner BEFORE building:** ① an in-flow auto-layout child
refuses the **whole call** — the exact INVERSE of 2.1 ①, because auto-layout and constraints
are mutually exclusive answers to the same question; ② **both axes optional, ≥1 required**,
overriding the plan's required pair — the merge is a **platform requirement** (`constraints`
is one object property; Figma refuses a half-object); ③ **PAGE** parent refused, **GROUP**
allowed and measured rather than refused on an unverified claim; ④ the enum lives in **Zod**,
deliberately opposite to 2.1, because all five values are legal.

✅ **Both platform premises MEASURED, both HOLD.** The auto-layout claim: the *same stored*
MAX was honoured while ABSOLUTE (left `0 → 200`) and ignored back in flow (left held `0`).
The GROUP claim: a group child's constraint **does** resolve, against the enclosing frame.

🔴 **A real shipped defect was found in a NEIGHBOUR and fixed** — `set_layout_sizing`'s FILL
guard tested `parent.layoutMode === "NONE"` but not `undefined`, and a PAGE or GROUP has no
`layoutMode` at all, so FILL on any top-level frame passed and wrote a value Figma ignores.
Masked for six releases by the harness's blanket `layoutMode: "NONE"`; type-gating that
default (which also **retires the dishonest-fixture debt 2.1's gate recorded**) surfaced it.

🔴 **The gate scored a FALSE RED on its own first run, and its own numbers gave it away**
(*"the cloned group did change (137 → 137)"*). §6 measured the child's offsets **within its
group** and read `0 → 0` — arithmetic, not a result: a single-child group's bounding box IS
its child's box. ⛔ I built an instrument check for the confound I anticipated and it passed,
while the reading under it was structurally fixed. Repaired by measuring against the FRAME
and adding an untouched CONTROL clone. See [[feedback_a_zero_valued_write_reads_as_no_write]].

🔴 **THREE gates are now declared stale** by name in `tests/live-gate-pins.test.mjs`:
`live-batch-gate.mjs`, `live-text-style-gate.mjs` and now `live-layout-gate.mjs`, which
passed hours earlier on `mzg3tlfl`. ⛔ None re-pinned — this change cannot re-run them.
**Owner's standing call: re-pin and re-run the set ONCE, after 2.3 and 2.4 land.**

⚠️ `set_constraints` ships **`stable` from birth** (2.1's precedent, not R2.5's
hold-at-`additive-preview`). A reply-shape defect found later needs a
`publicContractVersion` bump, and `1.9.0` is reserved for R2.7.

⏳ **SCALE is the one published value whose live behaviour is unmeasured** — it round-trips
offline, but no geometry check distinguishes it from STRETCH on a single-axis resize.

---

## ▶ Previous — item 2.0 (BUILT + GATED)

**✅ R2.6 ITEM 2.0 IS DONE 2026-08-21 (offline)** — `create_text` now carries the twelve
`set_text_style` parameters, awaits `setCharacters`, and **refuses** an unloadable font
instead of creating a node in a face nobody asked for. Contract **`1.7.0` → `1.8.0`**
(spent here, by `create_text`'s new reply fields — it is `stable`), **187 tests green**,
five source mutations killed with the control surviving, `dist/` byte-identical across
three builds, six baselines replaying, `verify-release` passed.

✅ **GATED 2026-08-22, channel `7l9ymck4`** — `scripts/live-text-style-gate.mjs` PASSED on
the **first run**, exit 0, no retries. Pair confirmed live `r2-server-2fa65a5749e2` ↔
`r2-plugin-045a95955905`, schema `1.8.0`, fingerprint `sha256:b5cbf7b1…`, 56 tools, zero
compatibility issues; scratch page `6043:2` deleted in the `finally` and the baseline
restored id-for-id (6 pages, current page back to `0:1`). ⭐ **The DEV plugin re-run was
VERIFIED, not performed** — `assertRuntime` read the live `pluginBuildId` and it already
matched HEAD. Full record: `docs/R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md` § "The live gate
PASSED — 2026-08-22".

⏳ **NEXT = 2.1–2.4, the four layout tools** — `set_layout_child`, `set_constraints`,
`set_size_limits`, `set_clips_content`. ⛔ **No further contract bump**: a new tool is
additive and `1.8.0` is already spent on 2.0. ⛔ **Their batch decision is DECIDED** — none
joins `apply_batch`'s allowlist; each gets an `EXCLUDED_BATCH_OPERATIONS` entry declared by
name, per the R2.2 pin-the-absence pattern. Not open for re-litigation on landing.

⚠️ **An interactive MCP session still needs a server respawn to reach HEAD.** Every pin
moved at 2.0 — server `c45214d7420b` → `2fa65a5749e2`, plugin `65d716d57dbb` →
`045a95955905`, fingerprint `05ac28c5…` → `b5cbf7b1…`, schema `1.7.0` → `1.8.0`. The gate
spawns its own server from `dist/server.js` and so needed neither respawn nor a re-run;
Cursor/Claude Code sessions are a different story. ⛔ That answer has now flipped on six
consecutive steps — re-derive it from `runtime-metadata.ts`, never carry it forward.

⚠️ **Three debts stay open and NONE is discharged by the green run** — mixed-font
unification (3.3) is still fixture-only (no `--mixed-node` was named, and the fork ships no
range-font setter, so a mixed node cannot be authored by these tools); F3 reachability is
untouched; and ⛔ `create_text`'s **rollback-on-refused-write sits on the SAME unreachable
branch as F3**. `available` ≠ `loadable` also did not reproduce on this host.

🔴 **`live-batch-gate.mjs` is STILL STALE** and would fail at `assertRuntime`. It is
deliberately **not** re-pinned: re-pinning a gate without re-running it is the `e02d1b2`
defect. Its staleness is declared by name in `tests/live-gate-pins.test.mjs`, which fails
if an undeclared gate drifts **or** if a declared one silently starts matching again.
⛔ The typography gate passing does **not** touch it — different gate, different pin set.

---

**✅ R2.6 PHASE 1 IS DONE 2026-08-20 (offline) and COMMITTED** — the atomicity debt is paid.
`setAxisAlign` / `setLayoutSizing` / `setItemSpacing` reordered to validate-all-then-write,
all three **removed** from `NON_ATOMIC_BATCH_OPERATIONS` (now **six entries, two `proven:`**
— `move_node` + `set_stroke_color`), the R2.4 live gate inverted and re-pinned. **169 tests
green**, contract **held at `1.7.0`** (no bump owed), six baselines replaying, `dist/`
byte-deterministic, `verify-release` passed. Five source mutations killed; the control
survived correctly. Record: `MEMORY.md`, and the plan's Phase 1 items are checked off.

⏳ **NEXT = run the re-pinned R2.4 live gate** — `node scripts/live-batch-gate.mjs
--channel=<name>`, foreground Figma tab, owner permission on a disposable file.
⛔ **Phase 2 stays closed until it passes** — the owner scoped Phase 1 to land and gate alone.

🔴 **Adopting this build needs a DEV plugin re-run AND a server respawn, and the pins lie
about the second.** `pluginBuildId` moved (`0bc82334ff83` → `65d716d57dbb`); `serverBuildId`
did **not** — yet `dist/server.js` changed anyway, because `batch-receipt.mjs` is in the
bundle and is hashed by nothing. ⛔ CC4's "serverBuildId is the only pin that fails on a
stale build" is FALSE for any server change outside `server.ts`.

---

### (historical, below) R2.4 → R2.5 acceptance

**R2.4 ACCEPTED 2026-08-18.** 125 tests green, five baselines replaying, `dist/`
deterministic, the live gate PASSED on channel `qvtz3fwr` — twice, once on the 4.1 build
and again on the accepted build after `apply_batch` was promoted to `stable`. Acceptance
record: [`docs/R2.4-BATCH-CONTRACT.md`](docs/R2.4-BATCH-CONTRACT.md).
⛔ **Accepting R2.4 does not accept R2** — the typography/layout/visual half is still owed.
✅ **It was CUT into a plan 2026-08-18** →
[`docs/R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md`](docs/R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md):
**R2.5 typography → R2.6 layout → R2.7 visuals**, three contract bumps, three live gates,
R2 acceptance at the end of R2.7.

**✅ R2.5 Phase 1 is DONE (2026-08-18)** — both text defects closed, contract at `1.7.0`,
offline gate passed. Details in the plan.

**✅ R2.5 Phase 2 is DONE (2026-08-18, offline)** — `get_available_fonts` + `check_fonts`,
the release's first new tools. **153 tests green**, **55 tools / 54 plugin commands**,
contract stays `1.7.0` (R2.5 spent its one bump in Phase 1; these are additive inside the
same in-flight release), six baselines replaying, `dist/` deterministic, `verify-release`
passed. ⭐ **CC1 held** — both are in `ADDITIVE_PREVIEW_RESULTS` in the same commit that
registers them, so neither shipped frozen. Five source mutations, all killed.

⚠️ **The plan was wrong about one thing and the code says so:** `timeBudgetMs` cannot bound
`listAvailableFontsAsync()`, which takes no cancellation signal — the budget bounds the
**reply**, and the call is abandoned rather than stopped. `coverage.budgetCancelsFetch:
false` is a permanent declaration in the reply, not a state.

**✅ R2.5 Phase 3 is DONE (2026-08-19, offline), 3.1–3.4.** `set_text_style` — twelve
optional typography parameters, node-level per D2, `additive-preview` per CC1, no progress
declaration per CC2. **169 tests green**, **56 tools / 55 plugin commands**, contract stays
`1.7.0`, six baselines replaying, `dist/` byte-deterministic, `verify-release` passed.
Record: [`docs/R2.5-TYPOGRAPHY.md`](docs/R2.5-TYPOGRAPHY.md).

⭐ **3.2 held.** Two phases with a hard line between them; the write loop cannot reject
because every value is validated and every font loaded first. **Five source mutations, all
killed** — and the one that matters is moving the refusal *after* the write loop, which
kills 5 tests only because every refusal case asserts the node is **byte-identical** and
puts the invalid parameter **last**. A throw-only assertion would have survived it.

⛔ **`set_text_style` REFUSES an unloadable font; it never substitutes** — the one place it
deliberately diverges from `set_text_content`. `fontSubstituted: false` is a permanent
declaration, not a state. ⛔ And `figma.mixed` is a **symbol**: `JSON.stringify` drops the
key, so every read-back maps it to the string `"MIXED"` or a mixed field vanishes and reads
as "not reported".

⏳ **3.5 was DEFERRED to R2.6, and the collision is a contract fact.** `create_text` is
`stable`; `COMPATIBILITY-POLICY.md` grants free result fields only to
`legacy`/`additive-preview`, so new reply fields need a new `publicContractVersion` — and
**R2.5 spent its bump in Phase 1**. R2.6 owns `1.8.0` and can fix the hardcoded Inter *and*
the un-awaited `setCharacters` at `code.js:1790` in one change.

**✅ THE R2.5 LIVE GATE PASSED 2026-08-19** — channel `o247ecxs`, first run on the fixed
script. Pair confirmed live (`r2-server-a30e91f4f88e` ↔ `r2-plugin-0bc82334ff83`, 56 tools,
`compatible`, zero issues), scratch page deleted in the `finally`, **baseline restored
id-for-id**, SYD content never written to.

- ✅ **Validate-all-then-write held with Figma as the judge** — bad enum last, refused, node
  byte-identical on **two** channels: the independent REST read *and* the plugin's own
  snapshot covering the six fields REST cannot see.
- ✅ **Refuse-never-substitute held** — `fontStyle` reads **Bold** after the refusal, which
  is exactly what would read `Inter/Regular` had the tool grown `setCharacters`'s fallback.
- ⭐ **The two refusals arrived at DIFFERENT LAYERS** — `schema` (Zod, before dispatch) for
  the enum, `handler` for the font. The trap that scored correct behaviour as FAIL three
  times; recorded, not flattened.

🔴 **The first run failed on the GATE, not the tool, and hid something worse.** `create_text`
answers prose while `create_page` embeds JSON — but the same run would have read plugin-API
field names off a `JSON_REST_V1` export and got **all-null**, and null-vs-null **passes
vacuously**. ⛔ A vacuity guard now proves the read channel reports real values before any
equality is trusted. ⭐ CC5 held on that failed run too: page deleted, baseline restored.

⚠️ `letterSpacing: -2 PERCENT` reads back through REST as **`-0.64` px** — REST resolves it;
the plugin's own snapshot preserves the unit. The gate compares the resolved value there.

**✅ R2.5 IS ACCEPTED 2026-08-19** — channel `ohipqdhg`. `set_text_style`,
`get_available_fonts` and `check_fonts` are `stable`, **removed** from
`ADDITIVE_PREVIEW_RESULTS` rather than commented out (`getResultStability` falls through to
`stable`, so a leftover entry silently holds a tool back). The gate was re-pinned to
`r2-server-c45214d7420b` and **re-run green on the promoted build**. ⛔ `stable` now means
frozen: a reply-shape change needs a new `publicContractVersion` and the walk-back is
breaking, rejected by `compatibilityErrors()` by name.

✅ **3.3 mixed-font unification is CLOSED LIVE** — `--mixed-node=6030:9112`, cloned to
`6031:9118` on the scratch page and unified there; the source was never written to.
`wasMixed: true`, `fontUnified: true`, and `before.fontName` reads the string `"MIXED"`
over the real transport. ⭐ That last one is the assertion worth having: `figma.mixed` is a
**symbol**, `JSON.stringify` renders a symbol as `undefined`, and undefined **drops the
key** — the field would have vanished and read as "not reported" rather than "this node
holds more than one value".

⛔ **Two debts acceptance did NOT discharge:** **F3's reachability** (the harness *injects*
the refused write; nothing makes real Figma refuse one on demand — the gate says so in
`stillOwed`), and Phase 2's **`available` ≠ `loadable`**, which did **not** reproduce again
— every listed face loaded, every unlisted one refused. ⚠️ The gate's `stillOwed` does not
list the second one; it is owed regardless.

⛔ **The current pair — the acceptance step moved the SERVER ONLY.**

| | R2.4 ACCEPTED | R2.5 Phase 2 | R2.5 Phase 3 | **R2.5 ACCEPTED (HEAD)** |
| --- | --- | --- | --- | --- |
| Contract / schema | `1.6.0` | `1.7.0` | `1.7.0` | `1.7.0` |
| Tools / plugin commands | 53 / 52 | 55 / 54 | 56 / 55 | **56 / 55** |
| Server | `r2-server-5ac4bcd1a2a5` | `r2-server-1a74a40ba8b2` | `r2-server-a30e91f4f88e` | **`r2-server-c45214d7420b`** |
| Plugin | `r2-plugin-53a1fa676d6a` | `r2-plugin-10787ea0bdd5` | `r2-plugin-0bc82334ff83` | `r2-plugin-0bc82334ff83` *(unmoved)* |
| Fingerprint | `sha256:d39aefef…` | `sha256:56ea2c94…` | `sha256:05ac28c5…` | `sha256:05ac28c5…` *(unmoved)* |

⛔ **Adopting HEAD needs a server respawn and NOT a DEV plugin re-run** — the promotion is
server-side only. That is the **opposite** of the three Phase steps before it, so the
answer has now flipped on five consecutive steps: ⛔ re-derive it, never carry it forward.
⭐ **The live gate never owes the respawn** — it spawns its own server from
`dist/server.js`, which is why it can refuse a stale *plugin* while running a fresh
*server*. ⭐ **And against the pre-promotion build only `serverBuildId` would have failed**
— plugin, fingerprint, schema and tool count all match across the promotion. That is the
whole argument for CC4, observed for the third time.

⭐ **Observed 2026-08-19, in one session:** an interactive connection holding the Phase 2
pair answered `get_runtime_info` with `compatibility: "compatible"` while the gate's fresh
server refused the very same plugin at `join_channel`. **`compatible` means the two RUNNING
halves match each other — never that they match the tree.**

⚠️ On this step every pin would catch a stale build, because a new tool moves the command
list, the capability IDs and therefore the fingerprint. That is luck, not a property: R2.4
moved the server twice with fingerprint, schema and tool count all holding still, so
**`serverBuildId` is still the only pin that fails on every stale build** (CC4).
| Fingerprint | `sha256:d39aefef…ca6289` | **`sha256:d39aefef…ca6289` — UNCHANGED** |

⭐ **Only the server moved, so this step needs a server respawn and NOT a DEV plugin
re-run** — the opposite of the 1.5.0 → 1.6.0 step. ⛔ Check it each time rather than
carrying the last step's answer forward; it flipped between two consecutive releases.

🔴 **And read the last three rows carefully: schema, tool count AND fingerprint all held
still while the server changed twice** (4.1's wrapper fix, then the `stable` promotion).
A preflight pinning any of them would accept a stale `dist/server.js` without a murmur —
`serverBuildId` is the only pin that catches it. That is the mirror image of the 1.5.0 →
1.6.0 step, where the fingerprint was the *only* discriminator. ⛔ Assert **all of them**;
each is blind to exactly what the others catch.

**✅ 2026-08-18 — the live pass RAN and PASSED** (channel `qvtz3fwr`), after the 2026-08-13
attempts below. Both runs green on the first try, scratch page deleted in the `finally`,
baseline restored (6 pages, current page back). Historical context follows.

**⏳ 2026-08-13 — the live pass was RE-PINNED and EXTENDED but had NOT RUN.**
`scripts/live-batch-gate.mjs` was still pinned to the 1.5.0 pair and now carries checks
7–11 for the work 5.5 never covered: **3.1** progress frames on a 15-op / 3-chunk batch,
**3.2** the pause *measured* at 0 / 250 / 1000 ms against `timing.elapsedMs`, the **clamp**
(max pause 5000 vs min budget 1000) doubling as the Finding 5 regression, and **Phase 4**'s
additive fields. Two runs on channel `l6pf0qsq` both died in `join_channel`'s compatibility
preflight — the plugin stopped answering mid-session — **before the scratch page existed,
so nothing was mutated.** Re-run with Figma in the **foreground**: the preflight allows the
plugin only **5 s**, and a backgrounded tab throttles its JS.

- ⭐ **3.1 is observable ONLY through the server's stderr.** Progress frames are consumed
  server-side to reset the inactivity timer and logged via `logger.info`; **none is
  forwarded to the MCP client.** The gate spawned with `stderr: "ignore"`, which would have
  observed zero frames and passed vacuously — Finding 4's exact shape. It now pipes stderr,
  parses `[INFO] Progress update for <command>: <n>%`, and treats an unavailable stream as
  a hard failure. `record.serverLogTail` carries the last 60 lines.
- ✅ **CLOSED 2026-08-18 — Phase 4.1 now reaches a live consumer on all three.** It had
  reached `delete_multiple_nodes` only: that tool returns `JSON.stringify(result)`, while
  `set_multiple_text_contents` and `set_multiple_annotations` returned
  `progressText + detailedResponse` — prose, no JSON — so the `outcome`/`succeeded`/
  `failed`/`total` their handlers produced was **discarded by the MCP wrapper**. The
  offline suite passed because `tests/legacy-batch-alignment.test.mjs` pins the *plugin
  handler*, which is the layer Phase 4 changed.
  ⭐ **The lesson, and it is the general one:** a test that loads the layer it is verifying
  can only ever prove that layer. Both wrappers now append the receipt as an extra content
  item — prose byte-identical, nothing substituted — and it is asserted **end-to-end**
  (`tests/wrapper-end-to-end.test.mjs`: real `callTool` → stdio → relay → real `code.js`,
  relay faked, plugin NOT) and by the live gate, which now **asserts**
  `unifiedFieldsVisibleToConsumer` instead of recording it.
  ⛔ **Check 10 recorded this for a full green run and it changed nothing.** A gate can be
  green and still be telling you something; a finding does not move the verdict. If a
  recorded observation matters, make it an assertion or accept that it will be walked past.
- ✅ **An agent session holding the channel does NOT break a scripted gate** — `ui.html`
  handles a second joiner's notice as a plain string (no `.result`, not an `error`), so the
  socket is never closed. Ruled out at source level, not assumed.

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

✅ **5.5 — THE LIVE GATE PASSED 2026-08-12**, twice, channel `8fbuzws2`, on the pinned pair
above. `scripts/live-batch-gate.mjs`; payload transcribed into
[`docs/R2.4-BATCH-CONTRACT.md`](docs/R2.4-BATCH-CONTRACT.md). All four outcomes observed
live (`prevalidated` · `refused_prevalidation` · `partial` · `all_succeeded`), both
envelope refusals recorded with the layer that answered, a `delete_node` blast radius
reported on a **real** node without touching it, and the plugin answering `compatible` in
4 ms afterwards. Both runs restored the 6-page baseline id-for-id — run 2 reading it is
what proves run 1 left nothing behind.

⭐ **The non-atomicity declaration is now observed, not asserted**, and it grew: `move_node`
(`x` 0 → 120) and `set_stroke_color` (`strokes` none → SOLID) were two of the *six listed
but unproven* ops, and both reproduced a partial application under a `failed` receipt —
rejected by the **Figma property setter**, exactly the mechanism the plan hypothesised.
Five of nine now proven.

🔴 **The gate found a description defect: `apply_batch` claims its `params` are the "same
shape as the standalone tool of the same name" and that is FALSE** for `set_fill_color`
and `set_stroke_color`, which take `{color:{r,g,b,a}}` in a batch and flat `r,g,b,a` as
tools. ⛔ Fix it **with 3.1**, not on its own — 3.1 re-pins the pair anyway, and editing it
alone would move the build the gate just pinned.

**Next: 3.1 + 3.2** (chunked progress and the measured sleep default — 3.2 is deliberately
blocked offline), then Phase 4, then 5.6. ⛔ `apply_batch` stays `additive-preview` until
acceptance; promotion is an acceptance act, the R1 precedent.

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

⭐ **CUT 2026-08-18 into three sub-releases** →
[`docs/R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md`](docs/R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md).
Cut through the interview gate before any design was written, the same sequence that
closed the R2.4 batch boundary. The four decisions: **three sub-releases defect-first**;
**ranges internal, never public**; **new tools standalone, `apply_batch`'s allowlist frozen
at 15**; and **full scope** — SVG import, the crop fix, the atomicity debt, and
`create_text`'s hardcoded Inter are all in.

- [ ] **R2.5 — typography.** Contract `1.6.0` → **`1.7.0` — BUMPED**.
      **✅ Phase 1 COMPLETE 2026-08-18** — 136 tests green, R2.4 frozen as the 6th baseline,
      all six replay at zero errors, `dist/` rebuilt, offline gate passed.
      ⛔ **New pair, BOTH halves moved:** `r2-server-194bc059487c` ↔
      `r2-plugin-75048983ede3`, fingerprint `sha256:09175c89…`. Needs a **DEV plugin re-run
      AND a server respawn** — the opposite of the R2.4 promotion step.
      ⚠️ **Phase 1 was NOT "no schema change".** 1.4 adds fields to `set_text_content`,
      which is `stable`, and the policy grants free result fields only to `legacy` /
      `additive-preview` — so the `stable`-by-default trap fired *inside* Phase 1, before
      any new tool existed.
      - [x] Deleted the unguarded `figma.loadFontAsync(node.fontName)` at `code.js:3840`.
            🔴 `node.fontName` is `figma.mixed` on a multi-font node and `loadFontAsync`
            cannot unwrap a symbol — the reported `Cannot unwrap symbol` verbatim. ⭐ The
            line is **redundant**: `setCharacters` on the next line already branches on
            `figma.mixed` (`:3897`) and loads the font itself in every branch. ⭐ **One
            deletion fixes single *and* batch** — `set_multiple_text_contents` has no font
            path of its own, it calls `setTextContent` per replacement (`:~4636`).
      - [x] `tests/mixed-font-text.test.mjs` — 5 cases covering **both** tools. It failed
            first with `Cannot unwrap symbol`, the reported defect verbatim, reproduced
            offline for the first time. ⭐ Mutation-tested twice: the pre-fix state, and a
            *lazy* fallback "fix" that the suite also kills because it asserts the first
            character's **real** font was loaded, not merely that the call returned.
            ⭐ **Why it survived four releases:** the harness's `loadFontAsync` was
            `async () => undefined` and accepted a symbol, and `getRangeFontName` returned
            the node's own `fontName` — no mixed-font node could exist in a fixture. The
            suite was not silent on this case, it was **unable to reach it**. The harness
            now models `figma.mixed`, per-range fonts, a refusing `loadFontAsync`,
            unavailable fonts, and refused character writes.
      - [x] `fontSubstituted` / `requestedFont` / `appliedFont` on `set_text_content`.
            Reported as `false` on the ordinary path too — an absent field cannot be told
            apart from one the writer forgot.
      - [x] 🔴 **F3 CONFIRMED and fixed.** Given a refused write the old code returned a
            success reply and the batch reported `succeeded: 1` / `all_succeeded` over an
            **unchanged document** — R2.4 finding (1) reappearing one layer *below* the
            aggregate that was fixed to stop lying. `setTextContent` now honours
            `setCharacters`'s `false` return and throws, fixing both layers at once.
            ⛔ **Reachability in real Figma is still UNPROVEN** — the refusal is injected by
            the harness, so the trigger is exactly what this does not establish. Settle it
            at the live gate.
      - [ ] ⚠️ **Deferred to 3.5, found during Phase 1:** `createText` calls
            `setCharacters` **without `await`** (`code.js:1790`), so `create_text` can
            return before its text is set. Out of Phase 1's scope; 3.5 rewrites this
            handler anyway.
      - [x] ✅ **Phase 2 DONE 2026-08-18 (offline).** Bounded `get_available_fonts`
            (`limit`/`offset`, whole-inventory `fontCount`+`familyCount`, `complete`,
            `heavy_read`) with an exact `family` filter added beyond the plan, plus the
            `check_fonts` preflight — a **real `loadFontAsync` probe**, `standard` budget,
            50-pair cap, `available`/`familyAvailable`/`loadable` as three separate facts.
            ⚠️ `timeBudgetMs` bounds the REPLY, not the fetch: `listAvailableFontsAsync`
            takes no cancellation signal, and `coverage.budgetCancelsFetch: false` says so
            permanently. ⛔ Reachability of the real inventory's shape/size is owed to the
            live gate — the fixture supplies eight faces.
      - [x] ✅ **Phase 3 DONE 2026-08-19 (offline), 3.1–3.4.** `set_text_style` —
            node-level, twelve optional fields, **validate-all-then-write from birth**,
            `{value, unit}` for `lineHeight`/`letterSpacing` with `AUTO` refusing a value
            rather than discarding it. ⛔ An unloadable font is **refused, never
            substituted**; `fontSubstituted: false` is permanent. ⛔ `figma.mixed` maps to
            the string `"MIXED"` — `JSON.stringify` drops a symbol key. Existing faces are
            read with `getRangeAllFontNames`, because `fontName` on a mixed node names no
            face at all. Five source mutations, all killed.
      - [ ] ⏳ **MOVED TO R2.6** — `create_text` takes the same params; Inter only when
            nothing is supplied. It needs reply fields, `create_text` is `stable`, and
            R2.5's bump was spent in Phase 1.
      - [x] ✅ **The R2.5 live gate PASSED 2026-08-19** (`scripts/live-text-style-gate.mjs`,
            channel `o247ecxs`). Both refusal policies proved with Figma as the judge, on
            two independent read channels. ⛔ First run failed on the GATE and exposed a
            null-vs-null **vacuous** comparison; a vacuity guard now precedes every equality.
      - [x] ✅ **R2.5 ACCEPTED 2026-08-19** — the three tools promoted to `stable`
            (removed from `ADDITIVE_PREVIEW_RESULTS`, not commented out), gate re-pinned to
            `r2-server-c45214d7420b` and **re-run green on the promoted build** (channel
            `ohipqdhg`). ⭐ The promotion moved `serverBuildId` and **nothing else** —
            plugin, fingerprint, schema and tool count all held still, which is the whole
            argument for CC4. ✅ 3.3 mixed-font unification **closed live** via
            `--mixed-node=6030:9112`. ⛔ First run failed on the GATE again: `clone_node`
            answers `with **new** ID:` where the other three creators answer `with ID:`.
- [ ] **R2.6 — layout.** Contract `1.7.0` → `1.8.0`.
      - [x] ✅ **Atomicity debt PAID + GATED 2026-08-20.** All three had one identical shape —
            validate first field, **write it**, then validate the second and throw. 🔴 The
            line numbers above were **stale by ~700 lines** (R2.5 shifted `code.js`); the real
            handlers were `setAxisAlign` **6522–6585**, `setLayoutSizing` **6588–6672**,
            `setItemSpacing` **6675–6735**. ⭐ The fix was a pure reordering, and that was
            **asserted, not assumed**: every second-field validation reads *node* state
            (`layoutMode`, `type`, `parent.layoutMode`, `layoutWrap`), never the sibling
            parameter, so hoisting yields identical verdicts.
      - [x] ✅ **R2.4 live gate updated in the same change AND re-run green** — channel
            `kw7qggwv`, one run. It *observed* `set_item_spacing`'s partial application as
            evidence, so the fix correctly broke the predecessor's own gate; inverted, it now
            proves atomicity (`gapBefore: 16` → `gapAfter: 16`, `atomic: true`).
            🔴 **The plan's restatement failed arithmetic:** "five of nine becomes three of
            seven" only holds if *two* ops are fixed. Fixing three leaves **two of six** —
            `move_node` + `set_stroke_color`, both still proven live, both staying declared.
            ⛔ The inverted assertion could **not** be a bare equality: `partialApplicationReason`
            is absent when the possibility is undeclared, so `undefined === undefined` would
            have passed vacuously. It asserts the **absence** of the field and the map key.
      - [x] ✅ **Item 2.0 DONE + BUMP SPENT 2026-08-21 (offline), inherited from R2.5
            (3.5).** `create_text` carries the twelve `set_text_style` parameters, the
            un-awaited `setCharacters` is awaited, and an unloadable font is REFUSED.
            Contract `1.7.0` → **`1.8.0`**, 187 tests green, `dist/` byte-identical across
            three builds, six baselines replaying, `verify-release` passed.
            🔴 The cited line was **stale** (`:1802`, not `:1790`) — re-locate by name.
            🔴 The un-awaited write did not merely "return early": the reply reported
            `characters: ""` for text it HAD written, **only on the path without
            `parentId`**, and a font failure inside it became an **unhandledRejection
            after the command answered**. The parented path passed before the fix.
            ⛔ Validate-all-then-**CREATE**: the F4 shape here is an orphan node, so the
            parent is resolved and the font loaded before `figma.createText()`, and every
            refusal test counts the page's children instead of only asserting a throw.
            🔴 **The bump is not mechanically enforced** — regenerating at `1.7.0` gave
            **zero** compatibility errors, because the snapshot records input schemas and
            stability, never result shapes.
            ⛔ **Every pin moved** (server, plugin, fingerprint, schema) — a DEV plugin
            re-run AND a server respawn, the opposite of the step before it.
            ✅ **GATED 2026-08-22, channel `7l9ymck4`** — `live-text-style-gate.mjs`
            PASSED on the first run, exit 0. §6–9 proved the create path live: every
            refusal leaves the scratch page's child count unchanged
            (`orphanCreated: false`), the unloadable font is refused rather than
            substituted, the `fontWeight` × `fontFamily` collision refuses at the
            **handler**, and the default path's reply `characters` match the document's —
            the un-awaited write has not returned. ⭐ §7b records that the schema-layer
            refusal `proves nothing about the handler`, instead of banking it.
            ⏳ Mixed-font 3.3 stays fixture-only; F3 and `create_text`'s
            rollback-on-refused-write are untouched, on the same unreachable branch.
      - [x] `set_layout_child` ✅ (2.1, gated `mzg3tlfl`) and `set_constraints` ✅ (2.2,
        gated `2bcdtr5b`); ⏳ `set_size_limits`, `set_clips_content` remain.
            ⛔ **DECIDED before they exist: none of the four joins `apply_batch`'s
            allowlist** — each gets an `EXCLUDED_BATCH_OPERATIONS` entry with its reason,
            per the R2.2 pin-the-absence pattern. Not open for re-litigation on landing.
- [ ] **R2.7 — visuals, assets, and R2 acceptance.** Contract `1.8.0` → `1.9.0`.
      - [x] `set_fill` (solid + gradient), `set_effects`, `set_opacity`, `set_blend_mode`.
            ⭐ `set_fill` ships **one** param shape, ending the batch-vs-standalone
            divergence the R2.4 gate caught; `set_fill_color` is `stable` and stays legacy.
      - [x] `create_node_from_svg` — standalone, **not** in the batch allowlist, input size
            bounded, created node count reported. ⚠️ Duplicates on rerun; idempotency stays
            deferred and is stated rather than silent. ✅ **BUILT + GATED 2026-08-23** on
            `sdg5mr5m`, run twice. The bound is on SVG **source length** (512KB) because node
            count cannot be preflighted; `duplicatesOnRerun: true` is a permanent reply field,
            not a doc line. Figma's parser expanded a 3-element SVG into **4 nodes** — measured,
            never predicted by the harness.
      - [x] Fix `CROP` — ✅ **DONE 2026-08-23, and the measurement changed the fix.** This
            entry said *"the schema promises a mode the handler cannot deliver"*; that is
            **wrong**. Figma ACCEPTS `CROP` and stores it — what was missing is
            `imageTransform`, and without it the identity default renders a **stretch**
            reported as a crop. Shipped: an optional `imageTransform` (contract-free —
            `compareSchema` never walks new optional properties), a **handler** refusal for a
            bare `CROP` (⛔ not an enum narrowing, which would be breaking), a refusal for the
            transform on any non-CROP mode, and a receipt reporting the transform read off the
            node. ⭐ The escape hatch was never taken: it was measured first, exactly as this
            line required.
      - [x] Build the representative component/page fixture R2 acceptance names, drive it
            end to end, then promote every new tool `additive-preview` → `stable`.
            ✅✅ **DONE 2026-08-23/24.** Fixture PASSED **twice** on `w113vf7y`, fresh page each
            time, every value agreeing including a byte-identical export `sha256`. All five
            tools promoted. Then all **TEN** stale gates re-pinned and re-run once each on
            `6cbroncs` — **all ten PASSED**. Offline 370/370, `verify` green.
            🔴 **The fixture found a defect the gates could not**: `set_effects` advertised
            `visible`/`blendMode` as `.optional()` while Figma **requires** them, so the minimal
            effect a generic client writes was refused — the exact claim acceptance makes.
            Fixed in the per-type table (blurs get `visible` only; a blur has no `blendMode`),
            sequenced BEFORE the re-pin so the ten-gate price was paid once.
            ⭐ Every gate was green throughout, because each only ever sent shapes already known
            to work. Record → [`docs/R2.7-VISUALS.md`](docs/R2.7-VISUALS.md) § *R2 ACCEPTANCE*.
- [ ] Keep each narrow tool independently usable; no framework or scene vocabulary in
      its schema.

🔴 **The highest-leverage finding in the cut audit:** `getResultStability`
(`scripts/contract-lib.mjs:267`) falls through to **`stable`** for anything not named in
`ADDITIVE_PREVIEW_RESULTS` (`:74`), and `compatibilityErrors()` rejects weakening a level by
name. ⛔ This plan adds ~10 tools — shipping them unlisted would permanently freeze ten
result shapes that never faced a live gate. **Every new tool ships `additive-preview`**;
promotion is an acceptance act. ⚠️ Six hand-maintained maps in the same file must be updated
per tool, one of which (`SPECIAL_PROGRESS`, `:168`) is what produced Finding 4.

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

⛔ **The consumer gap is still open — re-verified 2026-08-22** against the generated
contract at HEAD `6708666`, **after item 2.4 landed**: **60 registered tools** committed
(schema `1.8.0`, fingerprint `sha256:f229f6ec…53ebd`), and the only
variable-aware ones are `get_variables` and `get_node_variables`, **both read-only**.
`setValueForMode` / `createVariable` / `createVariableCollection` / `setBoundVariable` match
nothing anywhere in `src/`, and none of the 39 write tools touches a variable, collection, or
mode. All ten `umjuansantos` §1.4 corrections remain hand-transcription.
*(Supersedes the 2026-08-12 note that read `c10c9ff` / `1.4.0` / 52 tools — its numbers went
stale across R2.5 and R2.6; its conclusion never did.)*

⚠️ **`apply_batch` does not close this** — it is mutate-only over existing **node** IDs, and
variables are not nodes, so R2.4 completing changes nothing here. ⚠️ **Neither does R2.6's
typography surface**, and this one reads like it should: `create_text` and `set_text_style`
both take `fontFamily`, which looks like it covers the consumer's `Family/Heading` and
`Family/Body` corrections. It does not — those are **STRING variables**, and a text tool
writes a *node's* font. **A node tool never reaches a variable.**

⭐ **THE FIRST THIRD IS SCHEDULED AS R3-A — 2026-08-22.** ⚠️ This read *"ahead of R2.7
visuals"* until **2026-08-23**, when the owner reversed the order back to **R2.7 first**.
⛔ The reversal touches the QUEUE POSITION only — every finding below stands, and none of
it was the reason for the re-order in either direction. The
trigger was not new consumer pressure but the **elimination of the alternative**: the Figma
REST Variables API is Enterprise-gated on **reads as well as writes** (`file_variables:read`
Tier 2 *and* `file_variables:write` Tier 3, all three endpoints *"available to full members of
Enterprise orgs"*), and the consumer's account is Education/Professional. ⛔ **The `fileKey`
was never the blocker** — it was captured 2026-08-07 to unblock this exact route.
Conversely the **plugin** surface is ungated: the only tier-limited calls are `addMode`
(*"Limited to N modes only"*) and `extend` (Enterprise), **neither of which R3-A invokes**,
which is what makes the slice behave identically on every plan.

- [ ] **R3-A — the scheduled slice, AFTER R2.7.** `set_variable_value` · `create_variable` ·
      `delete_variable`, against **existing** collections and modes. ⚠️ **One bump, but
      `1.9.0` → `1.10.0`** — the `1.8.0` → `1.9.0` written below was correct only while
      R3-A came first; R2.7 spends `1.9.0`. Superseded text kept for the trail: `1.8.0` →
      `1.9.0`, one live gate. Needs **no read-layer change** — `get_variables` already
      returns variable IDs, collection IDs, per-mode `id` (`code.js:3085`) and
      `defaultModeId` (`code.js:3096`).
      ⭐ **Scope + coverage proof → [`docs/VARIABLE-SLICE-PRIORITIZATION.md`](docs/VARIABLE-SLICE-PRIORITIZATION.md).**
- [ ] **The remainder — still coarse.** Collections, modes, `bind_variable`
      (`setBoundVariable`), and explicit Figma-plan capability responses for the two
      tier-limited calls.
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
- [x] **R3 — resource identity:** layered in `create_variable` at R3-A `1.13.0`:
      explicit local ID → exact local collection/name → opaque private-plugin-data
      `identityKey` → create. Receipts carry `{created, matchedBy}`; ambiguity or unreadable
      inventory refuses before a duplicate can be created. Offline-gated; the target-explicit
      disposable-file live gate remains unrun.

## Inputs needed only when their release starts

- **R0 live smoke:** a disposable Figma fixture, fork DEV plugin, local relay/server,
  and channel name.
- **R1 consumer evidence:** optional `figma-to-code` acceptance after it independently
  updates its runtime pin.
- **R2/R3 authoring:** permission to modify a disposable test file and confirmation of
  plan-specific authoring capabilities.
- **Any calendar commitment:** an explicit deadline/capacity decision. Until supplied,
  planning remains one release at a time and scope-open.
