# Batch Contract Plan — the generic batch operation contract (R2.4)

> **Status 2026-08-13: Phases 1–4 BUILT and green offline (114 tests); `apply_batch`
> chunks, reports progress, and honours a clamped pause.** Remaining: the **live pass**
> (5.5 re-run on the new pair, extended to cover 3.1/3.2/Phase 4) and **5.6** (the pin).
> Cut 2026-08-10, immediately after R2.3 was accepted. This plan owns the generic batch
> envelope only. R2's typography/layout/visual half stays coarse until it is cut
> separately.
>
> ⛔ **The pinned pair changed AGAIN.** `1.5.0` → **`1.6.0`**,
> `r2-server-d248ed7bc295` ↔ `r2-plugin-53a1fa676d6a`, fingerprint
> `sha256:d39aefef…ca6289`. Any running Figma session is on the old pair and will fail the
> preflight until the DEV plugin is re-run *and* the MCP server respawned.
> ⭐ **The tool count did NOT move (53 both sides)** — 3.1 added a parameter, Phase 4 added
> reply fields — so a `toolCount` check would accept a stale plugin. Assert the fingerprint
> **and** the count; each is blind to what the other catches.
>
> ⏳ **The live pass has NOT run yet.** Two attempts on 2026-08-13 (channel `l6pf0qsq`)
> both died in `join_channel`'s compatibility preflight because the plugin stopped
> answering — **before the scratch page existed, so nothing was mutated.** Re-run with
> Figma in the **foreground**: the preflight allows only 5 s and a backgrounded tab
> throttles plugin JS.
>
> 🔴 **The contract's per-operation atomicity assumption was tested and is FALSE** — see
> Traps. Three handlers are proven to write before they throw; the contract now declares
> non-atomicity rather than promising it.
>
> **The open question is closed here.** `TASKS.md` *"R2 — generic batch boundary: should
> create operations be supported in the first batch version, or only mutations of
> existing IDs?"* → **mutations of existing IDs only.** Rationale below; decided with the
> maintainer before any design was written.

## The decision, and why

**v1 accepts only operations that target a node ID that already exists.** Creates are
deferred to a later version, and the envelope is shaped so they arrive as an *additive*
extension rather than a redesign.

Four reasons, in the order that decided it:

1. **Prevalidation and create are in direct tension, and prevalidation is already
   promised.** `TASKS.md` requires that destructive batch operations *"report their
   resolved scope before mutation."* When every target is an existing ID, the resolve
   pass is **total**: every node can be looked up, reported, and refused before the first
   write. Admit creates and half the IDs do not exist at prevalidation time — the
   guarantee silently degrades to partial, and the line above becomes unsatisfiable as
   written.
2. **Creates are only useful with forward references, which are a much larger contract.**
   A `create_frame` whose ID nothing in the same batch can consume saves no round-trip.
   Making it useful means `{"$ref": "op-1.nodeId"}`, which drags in a reference resolver,
   cycle detection, and a rollback story for the orphans a mid-batch failure leaves
   behind. None of that is proven, and none of it is needed to ship batching's actual
   value: applying many known edits atomically.
3. **Idempotency is already explicitly sequenced after independent proof.** `TASKS.md`:
   *"Add generic idempotency only after its semantics are proven independently of a
   consumer scene format."* A create batch without idempotency duplicates on every rerun
   — which is precisely the semantics that line defers. Shipping creates first would
   force the deferred decision through the back door.
4. **The boundary is a version boundary, not a permanent one.** `op` is an allowlisted
   string and the receipt is already per-operation and typed, so adding creates later is
   a new `op` kind plus an optional resolver — no envelope change.

⛔ **The absence of creates must be pinned by a test**, exactly as R2.2 pinned `"reuse"`
absent from `onDuplicate`. A deliberate omission that is not asserted reads as an
oversight the next time someone extends the allowlist.

## What exists today — the audit this plan starts from

Three batch-shaped tools already ship, and **all three are already frozen as
`resultStability: "stable"`**. They are not a blank slate; they are the compatibility
constraint. Reading them produced five findings, every one of which shapes the contract.

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | **The aggregate lies.** All three return `success: successCount > 0` — a batch of 100 where 99 fail reports `success: true`. | `code.js:4720`, `:5129`, `:5333` |
| 2 | **Three vocabularies for one concept.** `replacementsApplied` / `annotationsApplied` / `nodesDeleted`, each with its own `*Failed` and `total*` spelling. | `code.js:4720-4727`, `:5128-5133`, `:5333-5340` |
| 3 | **Three execution models, one declared class.** Text and delete chunk by 5 with a 1 s inter-chunk sleep and report per chunk; annotations is a plain sequential loop with no chunking, no delay, and **no progress updates at all**. | `code.js:4537`+`:4693`, `:5181`+`:5306`, `:5075` |
| 4 | **The public contract asserts progress that never happens.** `SPECIAL_PROGRESS` is a hand-maintained map and declares `set_multiple_annotations` as `pluginUpdates: "chunked"`. It emits nothing. | `contract-lib.mjs:257`; `contracts/public-contract.json` |
| 5 | **There is no total-duration ceiling — only an inactivity one.** The request timeout is reset on *every* progress update to `max(60_000, timeoutMs)`. A chunked batch that keeps reporting never times out. | `server.ts:3608-3627` |

⭐ **Findings 3, 4 and 5 compose into a live defect worth stating plainly.** Because the
inactivity timer is only reset by a progress update, `set_multiple_annotations` — the one
tool that emits none — is the only one of the three that can actually hit the 30 s wall,
while the two that *are* declared identically to it are effectively unbounded. A 10,000
node `delete_multiple_nodes` spends ≈ 33 minutes in inter-chunk sleep alone and no
ceiling fires. This is the same defect class R2.0 already fixed once, in
`get_node_variables`, with an explicit `timeBudgetMs`.

⚠️ **Finding 4 is the R1 lesson repeating.** The R1 open-question answer records that
*"a hand-written result schema drifts from observed replies."* `SPECIAL_PROGRESS` is a
hand-written behavioral claim with nothing asserting it against the runtime. Fix the
claim in Phase 4 **and** make the class derivable or tested, or it will drift again.

## The contract

```jsonc
apply_batch({
  operations: [
    { "id": "op-1", "op": "set_fill_color",   "nodeId": "1:2", "params": { ... } },
    { "id": "op-2", "op": "resize_node",      "nodeId": "1:3", "params": { ... } }
  ],
  "onError": "stop",          // "stop" (default) | "continue"
  "prevalidateOnly": false,   // true = dry run, resolve and report, write nothing
  "timeBudgetMs": 60000,      // total wall clock, not per operation
  "maxResultBytes": 2000      // per-operation result truncation
})
```

`nodeId` is lifted **out** of `params` and onto the envelope deliberately: it is the field
prevalidation resolves, and burying it inside a per-op payload would make the resolve pass
depend on knowing every tool's parameter shape.

The receipt:

```jsonc
{
  "outcome": "partial",        // all_succeeded | partial | all_failed | refused_prevalidation
  "total": 4, "succeeded": 3, "failed": 1, "skipped": 0,
  "prevalidation": {
    "resolved":   [ { "id": "op-1", "nodeId": "1:2", "name": "Card", "type": "FRAME", "childCount": 3 } ],
    "unresolved": [ { "id": "op-4", "nodeId": "9:9", "reason": "node_not_found" } ]
  },
  "operations": [
    { "id": "op-1", "op": "set_fill_color", "nodeId": "1:2", "status": "succeeded", "result": { ... } },
    { "id": "op-4", "op": "delete_node",    "nodeId": "9:9", "status": "skipped",
      "error": { "code": "node_not_found", "message": "..." } }
  ],
  "timing": { "startedAt": 0, "elapsedMs": 812, "budgetExhausted": false },
  "complete": true
}
```

### The eight decisions the shape encodes

- **D1 — Prevalidation is a separate, total pass.** Resolve every `nodeId` before any
  write. Under `onError: "stop"` a single unresolved target refuses the whole batch,
  writes nothing, and returns `outcome: "refused_prevalidation"`. Under `"continue"` the
  unresolved ops are `skipped` and the rest proceed. **The `prevalidation` block is
  returned either way** — that is what satisfies *"report their resolved scope before
  mutation."*
- **D2 — `outcome` is a typed enum, never a boolean.** This is the direct fix for
  Finding 1, and it mirrors the precedent `TASKS.md` already names: R2.3's `operation`
  field (`set` / `removed` / `noop_absent`), which reports what actually happened rather
  than collapsing it to success.
- **D3 — Batch-level policy first, per-operation overrides later.** `onError` is the
  R2.2 `onDuplicate` pattern one level up: a named policy with a safe default, not a
  boolean flag. Per-operation policy overrides are a deliberate v2 slot.
- **D4 — A declared *total* budget, not just an inactivity one.** `timeBudgetMs` bounds
  the whole call. On exhaustion the executor stops, marks the remainder `skipped`, and
  returns `complete: false` — the same honest-incompleteness shape `get_node_variables`
  uses. This is Finding 5's fix.
- **D5 — A new `heavy_batch` timeout class.** `heavy_read` is documented as *"cost scales
  with the file rather than the arguments"*; a batch scales with its arguments, so reusing
  that label would make the contract lie. Add `heavy_batch` at rank 4 in `TIMEOUT_RANK`.
  ⚠️ Adding a rank is safe for baseline replay **only because no existing tool changes
  class** — the ladder check errors on an unknown value in a *previous* baseline, and a
  brand-new tool has no previous entry to compare.
- **D6 — Bounded three ways, like R2.3.** A `maxOperations` ceiling refused at schema
  level, `timeBudgetMs` for wall clock, and `maxResultBytes` truncating each operation's
  result while still reporting its true size. 500 receipts must not flood a context.
- **D7 — Destructive ops require exact IDs.** `delete_node` inside a batch takes an exact
  node ID; no name or selector resolution, ever. Its prevalidation entry reports `name`,
  `type` and `childCount` so the caller sees the true blast radius — deleting a frame
  takes its subtree with it — before anything is mutated.
- **D8 — `id` is caller-supplied and required.** Receipts correlate by `id`, never by
  array position. A caller that reorders or filters its own operations must not have to
  re-derive which receipt belongs to which request.

### The v1 operation allowlist

Node-scoped mutations that take an explicit `nodeId`: `set_fill_color`,
`set_stroke_color`, `set_corner_radius`, `move_node`, `resize_node`, `rename_node`,
`set_parent`, `set_text_content`, `set_layout_mode`, `set_padding`, `set_axis_align`,
`set_layout_sizing`, `set_item_spacing`, `set_plugin_data`, `delete_node`.

⛔ **Excluded by design, each pinned by a test:** every `create_*` (the decision above);
`export_node_as_image` (binary payloads have their own bounded contract and belong
nowhere near a 200-item receipt); `join_channel` and `get_runtime_info` (connection
plumbing stays distinct from document commands); and the three legacy `*_multiple_*`
tools (a batch of batches has no defined receipt).

## Phase 1 — the envelope and the shared receipt vocabulary

**Status 2026-08-12: 1.1 · 1.3 · 1.4 BUILT as the vocabulary module and its tests; 1.2
deliberately deferred to Phase 2.** 10 new offline tests (65 → **75**), `bun run verify`
green, five baselines replaying, and the contract, fingerprint and pinned pair
**unchanged** — see *Why 1.2 was deferred* below.

- [x] **1.1 Define the receipt vocabulary once, in one module**, and have both the new
      tool and the three legacy tools import it. Finding 2 exists because three
      implementations each invented their own nouns; a second generic implementation that
      does not share code will become the fourth.
      → **`src/talk_to_figma_mcp/batch-receipt.mjs`**: `BATCH_OUTCOMES`,
      `OPERATION_STATUSES`, `BATCH_ERROR_CODES`, `V1_BATCH_OPERATIONS`,
      `EXCLUDED_BATCH_OPERATIONS`, `classifyOutcome`, `summarizeOperations`,
      `duplicateOperationIds`, `disallowedOperations`, `utf8ByteLength`,
      `truncateResult`.
      ⭐ **The anti-Finding-1 property is stated as one rule and pinned by an exhaustive
      test:** `succeeded === 0` classifies as `all_failed` for *every* mix of `failed` and
      `skipped`, so no combination of counts can report success when nothing was applied.
      `summarizeOperations` derives the counts *from* the per-operation receipts, so the
      aggregate cannot disagree with the operations it summarizes — which is exactly how
      `successCount` currently can.
      ⚠️ **The module is deliberately dependency-free** — no Node built-ins, no `zod`
      (hence a hand-written `utf8ByteLength`, asserted against `Buffer.byteLength`).
      `code.js` runs in the Figma plugin sandbox as one bundled file and **cannot
      `import`**, so Phase 4's plugin half must carry a *mirrored copy*, held to this one
      by a parity test rather than by convention. "Import it in both places" is not
      available; plan 4.1 accordingly.
- [x] **1.2 Register `apply_batch`** in `server.ts` with a Zod schema: `operations`
      (non-empty, `maxOperations` ceiling), `onError`, `prevalidateOnly`, `timeBudgetMs`,
      `maxResultBytes`.
      ✅ **Done 2026-08-12 with Phase 2**, exactly as sequenced: the tool, the
      `FigmaCommand`/`CommandParams` entries and the `code.js` dispatcher case landed in
      one change, so the parity guard was satisfied at the same commit that published the
      tool. ⭐ **The constraint below was real and cost nothing because it was known** —
      the first draft used `.max(BATCH_MAX_OPERATIONS)` and would have failed contract
      generation; the literals are inline, with a test asserting they equal the constants
      the runtime enforces.
      ⛔ *Deferred from Phase 1 on purpose.* Registration is not a local act: the parity
      guard requires a matching `code.js` dispatcher entry, so registering in Phase 1
      forces either a *failing* parity test or a dispatcher stub — and a stub would
      publish a tool into the generated contract that refuses every call. Both are worse
      than waiting. Registering alongside the Phase 2 prevalidation handler costs
      nothing and keeps the contract truthful at every commit.
      ⚠️ **A constraint found while deferring it, load-bearing for 1.4:**
      `evaluateToolSchema` (`scripts/contract-lib.mjs:220`) extracts each schema by
      re-evaluating its **source text** through `Function("z", …)` — `z` is the *only*
      binding in scope. So the registered schema literal **cannot reference an imported
      constant**; the allowlist must be spelled out inline as a `z.enum([...])`, with a
      test asserting the inline literal equals `V1_BATCH_OPERATIONS`. Discovering this at
      registration time would have looked like a broken build.
- [x] **1.3 Assert unique `id`s** and return a named refusal on collision.
      → `duplicateOperationIds` + `BATCH_ERROR_CODES.DUPLICATE_OPERATION_ID`. The
      schema-level half lands with 1.2.
- [x] **1.4 Assert the allowlist** so an unknown or excluded `op` is refused before it
      reaches the plugin. ⚠️ A Zod enum rejection surfaces as a **thrown** protocol error,
      not an error result — the harness must expect that (see Traps).
      → `disallowedOperations` refuses with each op's *recorded reason*, and
      **creates are pinned absent by a dedicated test**, the R2.2 `"reuse"` precedent. A
      second test asserts nothing is both allowlisted and excluded. The schema-level half
      lands with 1.2.

## Phase 2 — prevalidation

**Status 2026-08-12: BUILT, offline.** `apply_batch` is registered and executing;
98 offline tests (75 → 98), `bun run verify` green, five baselines replaying at zero
errors. Contract `1.4.0` → **`1.5.0`**, 52 → **53 tools**, 51 → **52 plugin commands**,
new pair `r2-server-9239fd0bc71b` ↔ `r2-plugin-d0342abb6c4a`, fingerprint
`sha256:a87b5d98…835704`. ⛔ **The previously pinned pair is now rejected by the
preflight** — re-run the Figma DEV plugin *and* respawn the MCP server.

- [x] **2.1 Resolve every target first**, in one pass, writing nothing.
- [x] **2.2 Report the resolved scope** — `name`, `type`, `childCount` per target.
      `childCount` is `null`, not `0`, for a node that cannot have children: "cannot" is
      not "has none". It counts **direct** children, and the description says so, because
      a delete takes the whole subtree.
- [x] **2.3 Implement `prevalidateOnly`** as a first-class dry run.
      ⭐ **This forced a fifth outcome.** A dry run applies nothing *by design*, so every
      operation is `skipped` and `succeeded === 0` — which the Phase 1 rule classifies as
      `all_failed`. That would have been a fresh instance of Finding 1, the exact defect
      the enum exists to kill, so `prevalidated` was added. A dry run that *would* have
      been refused still reports `refused_prevalidation`: "what would happen" is the only
      question a dry run is asked.
- [x] **2.4 Refuse atomically under `onError: "stop"`.** Proven by fixture, including the
      ordering case where the good operation comes **last** — a lazily-validating executor
      would have applied it before ever reaching the bad target.

## Phase 3 — the executor

**3.3 · 3.4 · 3.5 shipped with Phase 2**, because registering the tool makes it callable
and a registered tool that refuses every real call is precisely what deferring 1.2 was
avoiding. What remains is chunking, which is a performance and progress concern, not a
correctness one.

- [x] **3.1 Chunk with progress updates** — ✅ **built 2026-08-12**; `SPECIAL_PROGRESS`
      gained `apply_batch: "chunked"` in the same change, so Finding 4 cannot recur.
      ⚠️ **Live-observable only via the server's stderr** — frames reset the inactivity
      timer and are logged, never forwarded to the MCP client; a client-only harness
      observes nothing and passes vacuously. The gate now pipes stderr.
      Original text: chunk with progress updates, reusing the existing `sendProgressUpdate`
      shape so the relay heartbeat and inactivity reset keep working.
      ⚠️ **Sequencing note:** the contract currently declares `pluginUpdates: "none"` for
      `apply_batch`, which is *true* today. Landing 3.1 must update that declaration in
      the same change, or it becomes Finding 4 all over again — a hand-written behavioural
      claim with nothing asserting it against the runtime.
      ⭐ Deferring it also means the batch presently has a **real** ceiling: with no
      progress updates there is nothing to reset the inactivity timer, so the armed
      transport budget actually fires. Adding chunking re-opens Finding 5 unless
      `timeBudgetMs` stays the binding constraint.
- [x] **3.2 Drop the fixed 1 s inter-chunk sleep** — ✅ **built 2026-08-12**: the pause is
      public (`chunkPauseMs`, 0–5000, **default 0**) and ⭐ **clamped to the remaining
      budget**, so `timeBudgetMs` stays a true ceiling. ⏳ **The measurement itself is
      still owed** — it is check 8 of the extended live gate (0 / 250 / 1000 ms against
      `timing.elapsedMs`, requiring `all_succeeded` at 0), which has not run yet.
      Original text: drop the fixed 1 s inter-chunk sleep. It is an unmeasured constant that
      costs 19 s on a 100-item batch and ≈ 3.3 min on a 1,000-item one. Make the pause a
      documented, tunable yield — and measure it before choosing a default.
      ⛔ Blocked offline on purpose: choosing the default requires measuring against a
      real file, which is the live gate's job.
- [x] **3.3 Enforce `timeBudgetMs`** across the whole run; on exhaustion stop, mark the
      remainder `skipped`, set `complete: false`, and set `timing.budgetExhausted`.
      The budget is checked **before** starting an operation, never mid-operation:
      interrupting a write is the partial application this contract already has to
      declare, not something to add to.
- [x] **3.4 Never abort a `continue` run on a single failure**; never continue a `stop`
      run past one. Skipped-after-halt entries carry `stopped_after_failure`, distinct
      from a budget skip and from an unresolved target.
- [x] **3.5 Truncate per-operation results** to `maxResultBytes`, reporting true size —
      the R2.3 `maxValueBytes` pattern.

## Phase 4 — additive alignment of the three shipped tools

Decided with the maintainer: **additive, zero breaking change.** Legacy fields keep their
exact current spelling and semantics; the unified vocabulary appears alongside them.

- [ ] **4.1 Add `outcome` / `succeeded` / `failed` / `total`** to
      `set_multiple_text_contents`, `delete_multiple_nodes`, `set_multiple_annotations`,
      from the Phase 1 shared module. ⛔ **Do not touch `success`, `nodesDeleted`,
      `replacementsApplied`, or any existing field** — all four baselines must keep
      replaying at zero errors.
- [ ] **4.2 Document the legacy `success` as legacy** in the release note, naming the
      `successCount > 0` behavior explicitly so a consumer can migrate deliberately.
- [ ] **4.3 Make Finding 4 true rather than correcting it downward.** Give
      `set_multiple_annotations` real per-item progress updates so the contract's existing
      `pluginUpdates: "chunked"` declaration becomes accurate. ⚠️ Correcting the contract
      to `"none"` instead would *weaken* a declared behavior and drop that tool onto the
      30 s wall it currently sits on — the wrong direction.
- [ ] **4.4 Add a test that asserts `SPECIAL_PROGRESS` against the runtime**, so a
      hand-written behavioral claim cannot drift from `code.js` again.

## Phase 5 — tests, contract, dist, gates, pin

- [x] **5.1 Freeze R2.3 as the fifth baseline** with a plain `cp` **before** regenerating
      the contract. The test discovers baselines by filename.
      → **Done 2026-08-12, first action of the session**, before a line of `src/` was
      touched: `contracts/baselines/r2.3-public-contract.json`, verified to carry
      contract `1.4.0` and fingerprint `sha256:c3cd6e71…dcc6bd` — the accepted R2.3 pair,
      not some later state. All five baselines replay at zero errors.
- [x] **5.2 Bump `serverSchemaVersion` 1.4.0 → 1.5.0.** ✅ **Done 2026-08-12, with 1.2**,
      exactly as sequenced — `publicContractVersion`, `serverSchemaVersion` and
      `pluginApiVersion` all moved in the same change that added the command.
      ⛔ *Do this when the contract actually grows (with 1.2), not before.* Bumping it
      ahead of the new command would move the fingerprint with nothing behind it and make
      the preflight reject the then-working pair for no gain — a live session broken by
      bookkeeping. The R1 finding requires the bump to *accompany* growth, not precede it.
- [x] **5.3 Offline fixtures** — `tests/apply-batch.test.mjs`, 20 cases; the suite is 98
      tests (was 75). Every listed fixture except the legacy-tool one, which is Phase 4:
      an atomic prevalidation refusal that mutates nothing (**and** the ordering variant
      where the good op is last) · `continue` producing a genuine `partial` ·
      every-op-fails producing `all_failed` · a first-op failure under `stop` producing
      `all_failed`, not `partial` · budget exhaustion setting `complete: false` · a create
      rejected by the allowlist · a duplicate `id` refused · truncation reporting true
      size · `delete_node` really deleting and reporting its subtree · the envelope
      `nodeId` beating one hidden in `params` · the plugin mirror matching the module
      value-for-value and behaviour-for-behaviour · the inline `z.enum` equalling
      `V1_BATCH_OPERATIONS` · the three proven non-atomic handlers.
      - [ ] The three legacy tools' additive fields with their legacy fields unchanged —
            **Phase 4**, not shipped.
- [x] **5.4 Regenerate the contract, rebuild `dist/`, re-run parity.** ⚠️ Load-bearing:
      `.mcp.json` points at this checkout's `dist/server.js`, so a source-only change
      ships nothing to the running agent.
- [x] **5.5 Live gate on the SYD throwaway copy** — ✅ **PASSED 2026-08-12**, twice, on
      channel `8fbuzws2`. `scripts/live-batch-gate.mjs`; full payload in
      [`R2.4-BATCH-CONTRACT.md`](R2.4-BATCH-CONTRACT.md) § Connected gate.
      `prevalidated` / `refused_prevalidation` / `partial` / `all_succeeded` all observed
      on the pinned pair, both refusals recorded with the layer that answered, the
      destructive op's `childCount: 3` checked against the document before and after, and
      the plugin answering `compatible` in 4 ms afterwards. Both runs restored the 6-page
      baseline id-for-id — run 2 reading it is the proof run 1 left nothing behind.
      ⭐ The gate found three defects, all in [`R2.4-BATCH-CONTRACT.md`](R2.4-BATCH-CONTRACT.md)
      § What the gate found; the description defect is fixed **with 3.1**, which re-pins
      the pair anyway rather than moving the build this gate just pinned.
- [ ] **5.6 Record server + plugin identity** in the release note, per *"Local runtime
      honesty."* Assign the new pin and let consumers adopt on their own schedule.

## Traps — all four already paid for once

- ⛔ **A gate that mutates must clean up in a `finally`, not on the success path.** R2.2's
  first connected run aborted mid-gate and left three pages in a real document. This gate
  mutates more than any before it.
- ⛔ **In a live gate a refusal is an expected outcome, not an exception** — and a
  schema-level refusal arrives as a **thrown** protocol error, never as an error result.
  This plan's gate deliberately triggers *several* refusals (allowlist, duplicate `id`,
  prevalidation), so a result-only harness would mis-score the correct behavior three
  separate ways. It bit R2.1 and R2.2 already.
- ⛔ **A rebuild reaches neither running side.** After `bun run build` the Figma DEV
  plugin must be re-run (it holds `code.js` from launch) *and* the MCP server respawned.
  Verify by **tool surface and exact pair**, never by relay pid or port.
- ⚠️ **Verify a platform assumption before designing around it.** R2.3 set out to make
  `""` storable and found Figma *defines* it as deletion — half the design was impossible,
  and an offline test written to the intended behavior is what caught it. The assumption
  to test early here is **whether a mid-batch failure can leave a partially applied
  operation** (a multi-step mutation like `set_layout_mode` that throws halfway).
  Per-operation atomicity is assumed by this contract and has not been verified.
  → 🔴 **TESTED 2026-08-12, and the assumption is FALSE.** This trap paid for itself a
  second time. Three of the fifteen allowlisted handlers write their first field, then
  validate the second and throw — all three reproduced offline against the fixture
  document *before* anything shipped:

  | Operation | What lands | Then throws on |
  | --- | --- | --- |
  | `set_item_spacing` | `itemSpacing` 16 → 20 | `counterAxisSpacing` on a non-`WRAP` frame |
  | `set_axis_align` | `primaryAxisAlignItems` MIN → CENTER | `BASELINE` outside a horizontal layout |
  | `set_layout_sizing` | `layoutSizingHorizontal` FIXED → HUG | `FILL` outside an auto-layout child |

  Six more (`set_layout_mode`, `set_padding`, `set_corner_radius`, `set_stroke_color`,
  `set_parent`, `move_node`) perform several writes in sequence with no interleaved throw
  and no rollback, so a platform-level rejection on a later field leaves the earlier ones
  applied. That path is unproven, and is listed rather than assumed away because a caller
  cannot tell the two classes apart from the outside.

  → ⭐ **TWO OF THOSE SIX ARE NOW PROVEN, live, by the 5.5 gate (2026-08-12).** The
  hypothesis in the paragraph above is no longer a hypothesis: the rejection arrives from
  the **Figma property setter**, not from fork code, and the earlier field stays applied.

  | Operation | What lands | Then throws on |
  | --- | --- | --- |
  | `move_node` | `x` 0 → 120 | `in set_y: Property "y" failed validation: Expected number, received string` |
  | `set_stroke_color` | `strokes` none → SOLID `#ff0000` | `in set_strokeWeight: … Expected number, received string` |

  Five of the nine are now proven; four remain listed. Reaching a later-field rejection
  takes a param that survives to the setter, which `params: z.record(z.any())` allows —
  the batch does no per-operation schema validation.

  ⭐ **The contract now declares non-atomicity instead of promising something the handlers
  do not deliver.** A `failed` receipt carries `partialApplicationPossible`, plus the
  recorded reason when true, so a caller knows to re-read the node rather than assume its
  own request was a no-op. `NON_ATOMIC_BATCH_OPERATIONS` holds the list, a test pins every
  entry to the allowlist, and the three proven cases are reproduced by test so the finding
  cannot rot — making a handler transactional will fail that test and force the
  declaration to be revisited deliberately. ⛔ **Fixing the nine handlers is a change to
  nine shipped tools and is out of scope for the batch envelope**; it is the honest
  follow-up, not a Phase 2 task.

## A fifth trap, found while building Phase 2

⛔ **An envelope refusal cannot be reported inside the receipt it breaks.** The plan's
receipt correlates by caller-supplied `id` (D8) and carries one entry per operation. A
duplicate `id` makes that correlation *undefined*; an unknown `op` has no handler and so
no entry shape. Neither can be expressed in the structure they invalidate, so those two
refusals **throw**, with the code in the message. Everything below the envelope — an
unresolvable target, an exhausted budget, a failed operation — is reported *in* a
well-formed receipt, which is what D1 promises. `BATCH_ERROR_CODE_DELIVERY` records which
half each code belongs to, and a test asserts it covers every code, because a consumer
writes different handling for a thrown refusal than for a receipt entry.

## Acceptance

A generic MCP client submits a batch of mutations against existing node IDs and receives:
a total prevalidation report before anything is written · atomic refusal under `stop` ·
honest `partial` under `continue` · a typed per-operation receipt correlated by
caller-supplied `id` · an aggregate `outcome` that **cannot** report success when
everything failed · and a bounded reply under a declared total time budget. The three
shipped batch tools report the same vocabulary additively, with every existing field and
all four frozen baselines unchanged.

This is the last piece of `TASKS.md`'s *"generic page/metadata/batch"* line. R2's
typography/layout/visual half remains before R2 itself can be accepted.

## Upstream posture

The envelope is generic Figma capability with no fork-specific coupling, so this is
**PR-eligible**. Offer it source-only — Grab's convention is that feature PRs touch zero
`dist/` — and ⛔ never let upstream timing gate the local build. PR #184 has been open and
unreviewed since 2026-07-16; that is the expected latency, not a blocker.
