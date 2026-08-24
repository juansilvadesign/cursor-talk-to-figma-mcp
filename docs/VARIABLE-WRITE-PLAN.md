# Variable-Write Plan — the variable half of R3

> **Status: Phase 0 DISCHARGED; Phases 1.1–1.3 LIVE-VALIDATED; R3-A's Phase 2 three-tool
> slice is LIVE-ACCEPTED at `1.12.0`; Phase 3 resource identity is IMPLEMENTED and
> release-offline-gated at `1.13.0`, with its target-explicit live acceptance still pending an
> owner-confirmed disposable file. The remaining Phase 2 surface is not started.** Cut 2026-08-07 from a real
> consumer gap. Scope decided with the maintainer: **the full variable half of R3** —
> collections, modes, variables, aliases, *and* node bindings.
>
> ⭐ **Re-verified 2026-08-12: this plan no longer has a prerequisite.** Phase 0 was
> written on 2026-08-07, **one day before R0 was accepted**, and R0 shipped every one of
> its four items — see the phase below, where each is now ticked against the artifact that
> discharged it. **The entry point is Phase 1.1**, not Phase 0. Everything that remains is
> net-new work.
>
> ⛔ **The consumer gap is still open, re-verified 2026-08-22** against the generated contract
> at HEAD `6708666`, **after R2.6 item 2.4 landed**: **60 registered tools** committed
> (schema `1.8.0`, fingerprint `sha256:f229f6ec…53ebd`), of which
> the only variable-aware ones are `get_variables` and `get_node_variables` — **both
> read-only.** `setValueForMode` / `createVariable` / `createVariableCollection` /
> `setBoundVariable` return zero matches anywhere in `src/`, and none of the 39 write tools
> touches a variable, collection, or mode. Nothing since the cut has narrowed the gap:
> R2.1–R2.6 shipped export safety, `create_page`, plugin data, the batch receipt vocabulary,
> typography, and four layout tools. ⚠️ **`apply_batch` will not help even once it lands** —
> it is mutate-only over existing **node** IDs, and variables are not nodes. ⚠️ **Nor does
> R2.6's typography surface**, which is the more tempting misread: `create_text` and
> `set_text_style` take `fontFamily`, but a text tool writes a *node's* font, and the
> consumer's font corrections are **STRING variables**.
> *(Supersedes the 2026-08-12 note reading `c10c9ff` / `1.4.0` / 52 tools.)*
>
> ⭐ **THE ALTERNATIVE ROUTE IS NOW CLOSED, MEASURED 2026-08-22 — this is what schedules the
> work.** The Figma **REST** Variables API is Enterprise-gated on **reads as well as writes**:
> all three endpoints state *"available to full members of Enterprise orgs"*
> (`file_variables:read` Tier 2; `file_variables:write` Tier 3 plus file edit access). The
> consumer's account is Education/Professional. ⛔ **The missing `fileKey` was never the
> blocker** — it was captured 2026-08-07 to unblock precisely this route, which was already
> closed. Conversely the **plugin** API is ungated for ordinary variable writes; only
> `addMode` (*"Limited to N modes only"*) and `extend` (Enterprise) are tier-limited.
> **The first three tools have therefore been cut as R3-A and scheduled ahead of R2.7 →
> [`VARIABLE-SLICE-PRIORITIZATION.md`](VARIABLE-SLICE-PRIORITIZATION.md).** Phases 1–4 below
> remain the full plan; R3-A is its front third, deliberately excluding both tier-limited
> calls so the slice carries no plan dependency.
>
> This plan owns **variables only**. R3's paint/text/effect/grid *styles* and its
> component/variant authoring stay coarse until they are cut separately.

## Why this is being cut ahead of R1/R2

The fork's [`ROADMAP.md`](../ROADMAP.md) places variable authoring at **C7 → R3**, and
`TASKS.md` says *"keep coarse until R2 is accepted."* This plan deliberately jumps that
queue, for a reason that is recorded rather than assumed:

A real consumer hit the gap. The `umjuansantos` design-system reconciliation
(`knowledge/projects/umjuansantos/TASKS.md` §1.4) produced a machine-verified,
~10-edit correction list against a live file — and **not one of those edits is
executable through the current tool set.** `get_variables` reads the whole variable
tree faithfully; nothing can write a single value back. The audit is therefore
reduced to a hand-transcription list.

That is the exact shape of a legitimate fork task under the dependency rule: *"When a
consumer finds a missing Figma fact/capability, implement the smallest generic tool or
additive field here, test it here, rebuild `dist/`, and assign a new pin."*

⛔ **What this plan does not do:** it does not import OpenDesign identifiers, slot
names, or any `umjuansantos` token vocabulary. The consumer's correction list is the
*motivation*; the tools stay Figma-native and consumer-neutral.

## ✅ Phase 0 — the guard that must land first — DISCHARGED BY R0, 2026-08-08

`TASKS.md` ▶ item 3 is explicit: *"Add server-schema ↔ plugin-dispatch parity checks
**before adding a new tool**."* This phase was the minimum slice of R0 that satisfies
that, and nothing more.

⭐ **It was overtaken by events the day after it was written.** R0 was accepted
2026-08-08 ([`R0-BUILD.md`](R0-BUILD.md)) and delivered all four items below **plus** the
three things this phase deliberately deferred to "R0 proper" — the runtime fingerprint
(`get_runtime_info` + `capabilityFingerprint`), the full fixture harness (ten files under
`tests/`), and the release mechanics (`scripts/verify-release.mjs`, five frozen baselines
under `contracts/baselines/`). **Nothing in this phase is owed.** Each box below is ticked
against the artifact that discharges it, verified 2026-08-12.

The repository already carried most of the contract surface — this phase made it
enforceable rather than inventing it:

| Surface | Where it lives today |
| --- | --- |
| Command-name union `FigmaCommand` | `src/talk_to_figma_mcp/server.ts` ≈ L2888 |
| `CommandParams` name → params interface | `src/talk_to_figma_mcp/server.ts` ≈ L3001 |
| Plugin dispatcher `case "…":` labels | `src/cursor_mcp_plugin/code.js` ≈ L129+ |
| Registered MCP tools | `server.tool(...)` calls throughout `server.ts` |

- [x] **0.1 Extract all four surfaces mechanically.** → `scripts/contract-lib.mjs` +
      `scripts/generate-contract.mjs`, emitting `contracts/public-contract.json`.
- [x] **0.2 Assert the bijection.** Every `FigmaCommand` has a plugin handler; every public
      plugin command has a server schema. → enforced in `contract-lib.mjs`, and the
      connection-only exclusion is the **explicit allowlist** this item demanded rather than
      a name heuristic — an unlisted UI message fails with *"Plugin UI message … is not
      explicitly allowlisted"* (`contract-lib.mjs:399`).
- [x] **0.3 Commit a contract snapshot.** → `contracts/public-contract.json`, with the
      additive-vs-breaking rule pinned by
      *"snapshot guard rejects removals and incompatible parameters but accepts additive
      optional fields"* (`tests/contract.test.mjs:153`).
- [x] **0.4 Wire one documented test command** into `package.json` → `"test": "node --test"`,
      with `bun run verify` as the full release gate. Phase 1+ tests attach to the same
      command.

✅ **Phase 0 acceptance — MET.** The parity test passes on the current **52** tools (the
figure in this line was 48 when written), and the failure mode is not merely assumed: the
suite carries a dedicated case named *"parity guard is observed failing when a dispatcher
command disappears"* (`tests/contract.test.mjs:30`), which is exactly the
*"a guard never observed failing is not a guard"* clause this acceptance demanded.
**Re-run 2026-08-12: 75/75 pass, 0 fail.**

## Phase 1 — read-side capability probe

Writes need an honest, *pre-flight* answer about what this file and this Figma plan will
actually permit. R3 requires *"explicit Figma-plan capability responses"*, and the read
layer already established the pattern to mirror: `hasVariablesApi()` in `code.js` L631.

- [x] **1.1 Extend the guard to the write API.** `hasVariablesApi()` currently checks only
      the three read entry points. Added sibling `hasVariableWriteApi()` asserting
      `createVariable`, `createVariableCollection`, and `createVariableAlias`.
      ✅ Offline-gated 2026-08-24 in `tests/variable-write-capability.test.mjs`: read support
      alone returns false, while removal of any one write entry point refuses the capability.

      ✅✅ **AND ITS PLUGIN-ARTIFACT MOVE IS PAID — 2026-08-24, channel `chvza8ab`.** 1.1
      rewrites `code.js`, so the regenerated `pluginBuildId`
      (`0ace9ed58f34` → `a34d76fc6bc6`) staled all **ten** gates that R2 acceptance had just
      re-pinned. They were re-pinned in one pass and **re-run once each — ALL TEN PASSED**,
      each on a fresh scratch page of the same six-page file, each restoring that baseline;
      a separate read after the pass confirmed the file's own six pages. Offline **371/371**,
      `bun run verify` green, and the rebuild came out **byte-identical** (`dist/server.js`
      `sha256:94ba5c47…e027a`) — a pin edit still does not move the build.

      ⭐ **A pin shape this project had not recorded: only `pluginBuildId` moved.** 1.1 adds
      no MCP tool and no `capabilityId`, and `server.ts`/`contractPayload` are untouched, so
      `serverBuildId`, the schema (`1.9.0`), the fingerprint (`sha256:f636ecab…6142fc0`) and
      the 65-tool count all HELD — the exact inverse of R2.6 acceptance, where only
      `serverBuildId` moved. ⛔ It is also the shape a fingerprint check waves straight
      through, and in the opposite direction from R2.6's: here the capability surface really
      **is** identical, and the artifact running inside Figma is not.

      ⭐ **Nothing in that pass was assumed.** The DEV-plugin reload was MEASURED first — live
      `get_runtime_info` reported `plugin.buildId: "r2-plugin-a34d76fc6bc6"`, never
      `compatibility: "compatible"`, which only says the two RUNNING halves agree with each
      other — and all ten reports carry that same id. The pins were then proved **checked**
      rather than merely present, in both directions: a throwaway copy of
      `live-clips-content-gate.mjs` pinned to `r2-plugin-000000000000` refused at
      `assertRuntime` (exit 1, naming both ids, no baseline read, no scratch page created,
      the file untouched), and the offline pins test went red on a single drifted undeclared
      pin — naming the file — and green again on restore.

      ⚠️ **Reports are LOCAL-ONLY.** `docs/evidence/r3a-1.1-repin/` sits under the `docs/*`
      ignore rule, so the ten `report.json` files have no second copy anywhere; the ledger
      entry in `tests/live-gate-pins.test.mjs` is the committed record of this pass.
- [x] **1.2 Add `get_variable_capabilities`** (read tool, cheap, no mutation). Public,
      document-scoped `additive-preview` read tool at R3-A `1.10.0`: reports separate
      `readApiAvailable`, `writeApiAvailable`, and `collectionInventoryAvailable`; every
      returned collection has `{id, name, key, defaultModeId, isRemote, modeCount}`.
      `modeCeiling.value` is deliberately `null` with `status:"unknown"` and a
      `knownGoodAtLeast` maximum from local collections: Figma exposes the numeric limit only
      by refusing `addMode()`, and this read does not create/delete a mode to discover it.
      Similarly, `document.editable` is `false` only for a known no-write editor context and
      otherwise `null`; `editorContextAllowsWrites` reports the observed editor/mode while
      Figma's unexposed file-permission check stays honestly unknown. A missing or rejected
      inventory returns `complete:false` and `collectionCount:null`, never a false zero.

      ✅ Offline-gated in `tests/variable-write-capability.test.mjs`: all three write entries
      can exist without being called; the normal collection inventory produces the two-mode
      lower bound; unavailable/failed inventory and Dev Inspect context remain explicit.
      `bun run verify` passed **373/373** and rebuilt the 66-tool R3-A pair
      `r3-a-server-12c88b765a45` ↔ `r3-a-plugin-122b65ca30e9`
      (`sha256:b367651f…751279`; `dist/server.js`
      `sha256:ea7581c8…7356d3`). ⛔ **Offline only:** the ten R2 gates are declared stale,
      not re-pinned, until the DEV plugin is reloaded and a supplied Figma channel permits a
      coherent live re-run. This is what lets a client preflight known facts before a partial
      write without pretending the unobservable facts are known.
      ✅ **LIVE-VALIDATED — 2026-08-24, channel `mlag5jfc`**, file `SYD (SaveYourDay) -
      Spaceapps` (the same six-page file R2 acceptance and 1.1 used). Runtime was MEASURED,
      not assumed: `plugin.buildId: "r3-a-plugin-122b65ca30e9"` and
      `server.buildId: "r3-a-server-12c88b765a45"` — ⛔ never
      `compatibility: "compatible"`, which only says the two RUNNING halves agree with each
      other. Every claim was cross-checked against `get_variables`, a genuinely separate
      handler (`code.js:3315`, its own `getLocalVariableCollectionsAsync()` call at `:3395`,
      sharing no fork helper with `:3544`): both collection ids, keys, `defaultModeId`s and
      mode counts agreed, `knownGoodAtLeast: 3` = max(3,1), and the returned ids are
      **file-specific**, so the relay round-trip is proven and nothing is an echo of the
      request (`{}`). The honest-unknowns held under real conditions: `modeCeiling.value`
      stayed `null` rather than promoting the local max of 3, and `document.editable` stayed
      `null` in a file the operator can plainly edit. `writeApiAvailable: true` remains an
      observation that the entry points EXIST — its refusal legs are offline-only, by design.
      Record → `docs/evidence/r3a-1.2-live/report.md` (⚠️ gitignored, no second copy).

      🔴 **AND THE LIVE PASS FOUND WHAT THE OFFLINE GATE COULD NOT: `isRemote` can never be
      `true` on this path.** The inventory comes from `getLocalVariableCollectionsAsync()`,
      which Figma documents as *"Returns all local variable collections in the current
      file"* — library collections excluded, in every file, not just this one. So
      `isRemote` was structurally always `false`, `localCollectionCount` could never differ
      from `collectionCount`, and the filter at `code.js:3597` could never remove an element.
      ⛔ Observing `isRemote:false` therefore corroborated nothing — it was the field's only
      reachable value, offline too (the sole assertion was `isRemote: false`; the one
      `remote:true` fixture in the suite is a library *style*). Same family as
      [[feedback_a_probe_at_the_default_value_proves_nothing]]. It mattered because Phase 2
      refuses `remote: true` collections with a typed refusal: a client that preflighted,
      saw everything local and concluded "no library collections here" had been misled by an
      inventory that never contained them. ⭐ The fork had already recorded this exact shape
      one layer down for styles (`code.js:1084`, *"get_styles only lists LOCAL styles"*);
      1.2 reintroduced it without inheriting the honesty.

      ✅ **FIXED in the same session, before any gate re-pin** (⛔ a plugin/server fix is
      sequenced BEFORE a re-pin, never after, or the whole set re-stales and pays twice).
      `remoteCollectionInventoryAvailable: false` is now declared in **every** branch with a
      limitation naming the constraint, the tool description says the same on the surface a
      client reads, and `isRemote` + the filter are kept as the documented defensive branch.
      Both new assertions were mutation-tested against the SOURCE: dropping the field and
      neutering the filter each went RED, and `code.js` restored byte-identical.
      `bun run verify` **375/375**.

      ⭐ **A THIRD pin shape — both build IDs moved and the fingerprint HELD.**
      `r3-a-server-12c88b765a45` → **`r3-a-server-0d303490d152`** and
      `r3-a-plugin-122b65ca30e9` → **`r3-a-plugin-6ed0aab0ecdc`**, while
      `capabilityFingerprint` (`sha256:b367651f…751279`), schema `1.10.0` and the 66-tool
      count ALL held. `scripts/contract-lib.mjs:591` hashes only
      `{serverSchemaVersion, capabilityIds}` — **not descriptions, not result shapes** — so a
      public contract change is invisible to it by construction. R2.6 moved only the server
      id; 1.1 moved only the plugin id; this moved both and the fingerprint still said
      "identical". See [[feedback_a_fingerprint_only_covers_what_it_hashes]].

      ✅✅ **AND THE TEN-GATE RE-PIN IS PAID — 2026-08-24, channel `6a07fm2h`.** Both halves
      were MEASURED on the fixed build first (`r3-a-server-0d303490d152` ↔
      `r3-a-plugin-6ed0aab0ecdc`), `get_variable_capabilities` was re-run and returned the
      amended payload (`remoteCollectionInventoryAvailable: false` + its limitation) over the
      same two collections, and then the same **TEN** gates were re-pinned to that pair
      (schema `1.10.0`, fingerprint `sha256:b367651f…751279`, 66 tools) and **RE-RUN once
      each — ALL TEN PASSED**, each on a fresh scratch page of the six-page file, each
      restoring that baseline; a separate read after the pass confirmed the file's own six
      pages. Offline **375/375**, `bun run verify` green, `dist/` rebuilt **byte-identical**
      (`sha256:ba1bce45…`) — a pin edit still does not move the build. Record →
      `docs/evidence/r3a-1.2-repin/README.md`.

      ⭐ **The pins were proved CHECKED in BOTH directions**, and one of them fired for real
      rather than as a probe: with the ten re-pinned but still declared, the pins test went
      RED naming `live-batch-gate.mjs` — the *stale declaration* arm. A throwaway copy pinned
      to `r3-a-plugin-000000000000` refused at `assertRuntime` (exit 1, both ids named, **no
      scratch page created**), and a drifted undeclared pin went red naming
      `live-effects-gate.mjs`, green again on restore.

      ⚠️ **`live-batch-gate` prints no `PASSED` line** — it signals `success: true` inside its
      JSON report. ⛔ Its exit 0 was not read as a verdict; all ten verdicts were taken from
      each gate's own `report.json`. ⚠️ Three reports state *"13 gate(s) are declared as
      pinned to an earlier release"*: true WHEN THEY RAN, since the ten declarations were
      still in the file. It is **3** from here on. A count read out of a report is a reading
      of the tree at run time, not a standing fact.

      ⚠️ **A second standing exception was deleted, not reworded.** The
      `R3_A_PHASE_1_2_REPIN_PENDING` set and its `currentGates === 0` branch existed only to
      describe a tree in which no gate pinned the current build; the re-run ended that tree,
      and the normal non-vacuity assertion is restored. The ledger is back to the **three**
      R2.1/R2.2/R2.4 gates.

- [x] **1.3 Probe the mode ceiling honestly.** ⚠️ **Multiple modes per collection are a paid
      Figma-plan feature and `addMode()` throws when the ceiling is hit.** Do **not** hardcode
      a plan→limit table — plan tiers change and the fork cannot see billing. Report the
      *observed* ceiling: report known-good (existing mode count) and surface the thrown
      error verbatim on the first refusal. ⛔ Never probe by speculatively creating and
      deleting a mode in a user's real file.

      ✅ **Implementation + offline gate — 2026-08-24.** Public additive-preview write
      `add_variable_mode` (`R3-A 1.11.0`, 67 tools) resolves the exact local collection and
      makes exactly one caller-requested `collection.addMode(name)` call. A successful add
      reports the created mode and keeps `modeCeiling.value:null`: success proves only one
      more mode is good, not the numeric ceiling. A Figma refusal returns a structured
      `{success:false, outcome:"refused", refusal}` receipt, preserves the raw Figma message
      unchanged, and reports `modeCountBefore` as the known-good count. The numeric ceiling
      becomes `status:"observed"` only when that raw message itself is Figma's
      `in addMode: Limited to N modes only`; there is no plan table or fallback guess.
      The handler creates no temporary collection/mode and never calls `removeMode`.

      `tests/variable-write-capability.test.mjs` proves both the single requested add and
      Figma-shaped first refusal (including zero cleanup calls); `bun run verify` passed
      **378/378**. The ten prior R2 gates are declared stale rather than re-pinned without a
      new live run.

      ✅ **LIVE-VALIDATED — 2026-08-24, channel `hdejcpog`** (a disposable copy of a real
      design-system file), collection `VariableCollectionId:17050:370` *"8. Dimensions"*,
      against `r3-a-server-af8987322467` ↔ `r3-a-plugin-b5ee1c0b619a` (`1.11.0`, 67 tools,
      fingerprint `sha256:6a68b351…deb6428`, `dist/server.js`
      `sha256:a0e41990…15002`), `compatibility: compatible`, zero issues.
      `scripts/live-variable-mode-gate.mjs` **PASSED TWICE**, byte-identical both runs:
      `modeCount 10 → 10` (the refusal mutated nothing), `mode: null`,
      `modeCeiling {value: 10, status: "observed", knownGoodAtLeast: 10}`, and Figma's
      message preserved verbatim as `in addMode: Limited to 10 modes only`.

      🔴 **THE OBSERVED CEILING IS 10 — a number that appears in NO commonly-cited Figma plan
      tier** (the widely-repeated tiers are 1 / 4 / 40). This is the plan's "do not hardcode a
      plan→limit table" rule being **paid, not merely asserted**: any table this fork could
      have shipped would have been wrong for this file, and only deriving `N` from Figma's own
      refusal string produced the right answer.

      ⚠️ **The first live attempt FAILED, and correctly.** It was fired at the same collection
      while it still held 4 modes, on the inference that `knownGoodAtLeast: 4` plus "no local
      collection exceeds 4" meant the ceiling was 4. `knownGoodAtLeast` means *at least* — and
      `get_variable_capabilities` states in its own `limitation` string that the ceiling is
      knowable only from a refusal. The add **succeeded**, the gate refused to score a
      non-refusal as a pass, and it left the created mode in place exactly as designed. The
      tool's receipt was honest throughout: `outcome:"created"`, `knownGoodAtLeast` raised
      4 → 5, and `modeCeiling.value` still `null` with *"Figma accepted this caller-requested
      addMode() call, so it did not reveal the numeric mode limit."* Reaching a genuine
      ceiling required an explicit out-of-band setup instrument on a disposable file; that
      filler is **not** in this repo, because the tool itself must never self-probe a ceiling.

      ⚠️ **Reports are LOCAL-ONLY.** `docs/evidence/r3a-1.3-live/` and `…-run2/` sit under the
      `docs/*` ignore rule and have no second copy; this plan entry is the committed record.

## Phase 2 — the variable write tools

All tools are **local-only**. ⛔ `remote: true` variables and collections belong to a
published library and must be rejected with a typed refusal, never silently skipped.

| Tool | Figma Plugin API | Notes |
| --- | --- | --- |
| `create_variable_collection` | `figma.variables.createVariableCollection(name)` | Returns collection id + its single default mode id |
| `add_variable_mode` | `collection.addMode(name)` | ⚠️ Throws at the plan ceiling — surface, don't swallow |
| `rename_variable_mode` | `collection.renameMode(modeId, name)` | |
| `remove_variable_mode` | `collection.removeMode(modeId)` | Destructive — see the destructive-boundary rule below |
| `create_variable` | `figma.variables.createVariable(name, collection, resolvedType)` | `resolvedType` ∈ `COLOR｜FLOAT｜STRING｜BOOLEAN` |
| `set_variable_value` | `variable.setValueForMode(modeId, value)` | Accepts a raw value **or** an alias — see 2.2 |
| `set_variable_metadata` | `variable.name` / `.description` / `.scopes` | Rename + scope correction in one tool |
| `delete_variable` | `variable.remove()` | Destructive |
| `bind_variable_to_node` | `node.setBoundVariable(field, variable)` | Plain fields (width, characters, fontFamily…) |
| `bind_variable_to_paint` | `figma.variables.setBoundVariableForPaint(paint, 'color', v)` | ⚠️ **Returns a NEW paint** — must be written back into `node.fills`/`strokes` |

- [ ] **2.1 Mirror the existing colour convention.** `CLAUDE.md` records it: Figma uses RGBA
      0–1 and the tools accept 0–1 floats. ⛔ Variable-write tools must not quietly introduce
      a hex-string input where every sibling tool takes floats. Accept 0–1; document it.
- [ ] **2.2 Aliases are a value, not a separate tool.** `setValueForMode` takes either a raw
      value or `figma.variables.createVariableAlias(target)`. Model this as a discriminated
      input on `set_variable_value` (`{value}` XOR `{aliasOf}`) rather than a parallel
      `set_variable_alias` tool — the read layer already serializes aliases as
      `{type:"VARIABLE_ALIAS", id}`, so write input and read output stay symmetric.
- [ ] **2.3 Guard the alias graph.** Reject a self-alias and any cycle before writing.
      Figma will refuse some of these, but a typed pre-check gives a better error than a
      plugin exception and cannot leave a half-applied batch.
- [ ] **2.4 Typed partial results on every multi-target call.** Per the cross-cutting rule
      *"Writes are exact and auditable"*: return per-item `{ok, id, matchedBy, error}`.
      ⛔ A batch that half-applies must never report success.
- [ ] **2.5 Destructive boundary.** `delete_variable` and `remove_variable_mode` require an
      explicit `confirm: true`. `TASKS.md` C5 already names *"explicit destructive
      boundaries"* as a fork responsibility.

### ✅✅ R3-A Phase 2 — first three tools, LIVE ACCEPTANCE PAID 2026-08-24

The scheduled, plan-independent slice is now implemented: `set_variable_value`,
`create_variable`, and `delete_variable`. It deliberately stays within existing local
collections and modes; it does not claim the rest of this broader Phase 2 table is done.

- `set_variable_value` accepts exactly one of raw `value` or `aliasOf`. Raw COLOR is strict
  RGBA 0–1 (no hex form); FLOAT, STRING, and BOOLEAN match the resolved type. Local alias
  targets must have the same type, and self/cyclic or unreadable alias chains are refused
  before a setter call.
- `create_variable` resolves the existing local collection object before calling Figma's
  current `createVariable(name, collection, resolvedType)` API. It is direct create, never
  an identity-based upsert.
- `delete_variable` requires literal `confirm: true` and follows `remove()` by probing
  several independent signals, reporting **which one** observed the absence. ⛔ Its first
  implementation asked only `getVariableByIdAsync`, which Figma answers with a **stale**
  object in the deleting frame — so the success branch was unreachable live while the
  offline harness kept it green. Live-measured on `hxpwe1ej`: the lookup resolves, there is
  no `removed` flag, and **collection membership** is what updates in-frame. When no signal
  can observe it, the receipt is `removal_unconfirmed` with `verificationDeferred` — never a
  success, because a real deletion and a no-op `remove()` are identical from inside that
  frame. Full record → [`R3-A-VARIABLE-WRITE.md`](R3-A-VARIABLE-WRITE.md).
- `tests/variable-write.test.mjs` covers typed raw values (including `0`, `false`, and alpha
  `0`), strict-color rejection, aliases/cycles, remote refusals, destructive confirmation,
  and post-delete observation. The existing variable-capability suite remains green.
- **Release gate passed — 2026-08-24:** `bun run verify` passed **391/391** and rebuilt the
  70-tool `dist/` pair. Generated identity is `r3-a-server-214dd61cca06` ↔
  `r3-a-plugin-4aa3214c4754`, schema `1.12.0`, fingerprint
  `sha256:9a314c170c7730bdb0b8aac7f3bf69758527c0ba21ff7f206b1b3157ce0ee87a`;
  `dist/server.js` is `sha256:8e4cf3e5…b80c6f2`. ⚠️ The fingerprint is **unchanged** across the
  delete-contract rewrite — it does not hash tool descriptions, so the moved **build ids**
  are what re-staled the gates.

✅ **Live acceptance is PAID — 2026-08-24, channel `hxpwe1ej`**, target
`VariableCollectionId:17050:370` *"8. Dimensions"* (10 modes). The gate **PASSED TWICE**
with the same verdict structure, all three deletes observed via `collection_membership`, no
write leaked into any of the 9 non-target modes, zero cleanup retries, and a fresh-frame
read afterwards found **0** leftovers. Evidence and the defect story →
[`R3-A-VARIABLE-WRITE.md`](R3-A-VARIABLE-WRITE.md).

⛔ **Re-running is still target-explicit.** Run `scripts/live-variable-write-gate.mjs` only
with an existing local collection in an owner-confirmed disposable Figma file — and prefer a
**multi-mode** collection, because on a single-mode target "wrote the mode I named" and
"wrote every mode" are the same bytes and the isolation assertions prove nothing:

```sh
node scripts/live-variable-write-gate.mjs \
  --channel=<DEV-plugin-channel-for-a-disposable-file> \
  --collection-id=<existing-local-collection-id> \
  --disposable-target=true
```

The gate creates, aliases, changes, and deletes variables; its cleanup is best-effort, so a
channel alone is not evidence that a real file is safe. The Phase 1.3
`live-variable-mode-gate.mjs` now requires the same explicit acknowledgement and still has
**no cleanup path by design**: it may leave a caller-requested mode behind when the collection
is not actually at its ceiling. Both gates require a disposable target on every invocation.

## ✅ Phase 3 — resource identity, IMPLEMENTED + OFFLINE-GATED 2026-08-24

This closes the standing open question *"R3 — resource identity: plugin data, Figma
keys/IDs, explicit caller key, or a layered strategy?"* with a **layered**
`create_variable` resolver. It preserves the original required create fields and adds optional
`id` and `identityKey`; resolution stops at the first conclusive layer:

1. A supplied explicit `id` → `matchedBy: "id"`. It must resolve to a local variable in the
   requested local `collectionId`; a bad ID never falls through to a name match or creates a
   different resource.
2. Otherwise, `collectionId` + exact `name` → `matchedBy: "name"`. A same-name variable of a
   different type is a typed `name_type_conflict`, not a silent reuse.
3. Otherwise, a supplied `identityKey` in private `Variable` plugin data in that same
   collection → `matchedBy: "identityKey"`. Duplicate keys are an explicit ambiguity, never
   a first-item choice.
4. Only when all applicable layers find nothing does Figma receive `createVariable(...)`.

Every normal `create_variable` receipt now carries both `created` and `matchedBy`: a fresh
create is `{created:true, matchedBy:null}`, while a matched resource is
`{created:false, matchedBy:"id"|"name"|"identityKey"}`. When an `identityKey` accompanies a
fresh create or an exact id/name match with no existing tag, the fork writes it with
`setPluginData` and reads it back. A different stored key is refused rather than overwritten.
The key is a caller-owned opaque string: exact equality only — no parsing, trimming,
normalization, or echo in a receipt.

- [x] **3.1 Always return `matchedBy`.** `created` makes fresh/create versus match explicit;
      `matchedBy` names the layer that resolved an existing resource.
- [x] **3.2 Prove additive reruns do not duplicate offline.**
      `tests/variable-write.test.mjs` creates one STRING variable with an opaque key, then
      proves same-input name matching, renamed-intent key matching, and explicit-ID matching
      all return the original ID with `created:false`; the collection still contains one
      variable.
- [x] **3.3 Keep `identityKey` opaque.** The harness asserts leading/trailing whitespace and
      Unicode survive the private-data round trip. Inventory/key-read failures, key conflicts,
      key ambiguity, and failed post-create key storage all refuse or report
      `identity_unconfirmed` rather than minting a green duplicate.

**Release/offline identity:** `R3-A` `1.13.0`, 70 tools,
`r3-a-server-c3d335284ec5` ↔ `r3-a-plugin-02cca8304cfb`, fingerprint
`sha256:000d808e4f63fce7ce6b965089b3f76e51a73d29a46557ea510993dcefe7d4ff`.
`bun run verify` passed **394/394** and rebuilt `dist/server.js`
`sha256:7493a32a…6822d309`.
The Phase 2 gate remains evidence for its paid `1.12.0` build, not this new plugin source.
`scripts/live-variable-identity-gate.mjs` is the new **unrun**, disposable-target-only live
instrument: it proves all three match layers, the type-conflict refusal, exactly one resource,
and fresh-frame cleanup of the variable it created.

## Phase 4 — tests, dist, and the pin

- [x] **4.1 Offline fixtures** for: alias resolution, a mode-ceiling refusal, a remote-variable
      refusal, a cycle refusal, and an additive rerun. The real-`code.js` VM/stub now also
      models `Variable` private plugin data and exercises the identity negative paths.
- [ ] **4.2 Live acceptance on a disposable file** — ⛔ **never** on a real design-system file.
      Record server + plugin identity in the acceptance note, per *"Local runtime honesty."*
- [x] **4.3 Rebuild `dist/`.** ⚠️ Load-bearing: `.mcp.json` points at the fork's
      `dist/server.js`, and upstream's published npm package does **not** contain the fork's
      tools. `bun run verify` rebuilt the pair; its explicit commit remains the owner's act.
- [x] **4.4 Re-run the Phase 0 parity test.** Command count holds at 70 and the contract test
      proves dispatcher/server parity after the existing command's schema grew.
- [x] **4.5 Assign a new pin** and let consumers adopt it on their own schedule. The Phase 3
      identity gate pins the exact `1.13.0` pair above; it must be **run** before that pin can
      be quoted as live evidence.

## Acceptance

A generic MCP client can create a variable collection, add a mode where the plan allows,
create typed variables, set raw and aliased values per mode, rename/rescope/delete them,
and bind them to node fields and paints — receiving typed per-item outcomes, an honest
capability report instead of a silent failure, and no duplicates on rerun.

**Consumer proof (not a substitute for fork fixtures):** the `umjuansantos` §1.4 list
becomes executable end-to-end — the `Inter` → Caslon/Source Serif 4 corrections, the new
`Text/brand` semantic token aliased per mode, `Family/Accent`, the purple `Main/Secondary`
ramp removal, and the `Main/Primary/25` fix.

## Upstream posture

Every tool here is generic Figma capability with no fork-specific coupling, so this is
**PR-eligible** under RM12. Offer it source-only (Grab's convention — feature PRs touch
zero `dist/`), and ⛔ never let upstream timing gate the local build. PR #184 has been
open and unreviewed since 2026-07-16; that is the expected latency, not a blocker.
