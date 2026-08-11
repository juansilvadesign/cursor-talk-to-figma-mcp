# Batch Contract Plan — the generic batch operation contract (R2.4)

> **Status: planned, not started.** Cut 2026-08-10, immediately after R2.3 was accepted.
> This plan owns the generic batch envelope only. R2's typography/layout/visual half
> stays coarse until it is cut separately.
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

- [ ] **1.1 Define the receipt vocabulary once, in one module**, and have both the new
      tool and the three legacy tools import it. Finding 2 exists because three
      implementations each invented their own nouns; a second generic implementation that
      does not share code will become the fourth.
- [ ] **1.2 Register `apply_batch`** in `server.ts` with a Zod schema: `operations`
      (non-empty, `maxOperations` ceiling), `onError`, `prevalidateOnly`, `timeBudgetMs`,
      `maxResultBytes`.
- [ ] **1.3 Assert unique `id`s** at schema level and return a named refusal on collision.
- [ ] **1.4 Assert the allowlist** at schema level so an unknown or excluded `op` is
      refused before it reaches the plugin. ⚠️ A Zod enum rejection surfaces as a **thrown**
      protocol error, not an error result — the harness must expect that (see Traps).

## Phase 2 — prevalidation

- [ ] **2.1 Resolve every target first**, in one pass, writing nothing.
- [ ] **2.2 Report the resolved scope** — `name`, `type`, `childCount` per target.
- [ ] **2.3 Implement `prevalidateOnly`** as a first-class dry run. This is the cheapest
      possible way for a caller to check a plan against a live file, and it makes the
      destructive-scope report usable *before* committing to the mutation.
- [ ] **2.4 Refuse atomically under `onError: "stop"`.** Prove by fixture that a batch
      with one bad target leaves **zero** observable mutations.

## Phase 3 — the executor

- [ ] **3.1 Chunk with progress updates**, reusing the existing `sendProgressUpdate`
      shape so the relay heartbeat and inactivity reset keep working.
- [ ] **3.2 Drop the fixed 1 s inter-chunk sleep.** It is an unmeasured constant that
      costs 19 s on a 100-item batch and ≈ 3.3 min on a 1,000-item one. Make the pause a
      documented, tunable yield — and measure it before choosing a default.
- [ ] **3.3 Enforce `timeBudgetMs`** across the whole run; on exhaustion stop, mark the
      remainder `skipped`, set `complete: false`, and set `timing.budgetExhausted`.
- [ ] **3.4 Never abort a `continue` run on a single failure**; never continue a `stop`
      run past one.
- [ ] **3.5 Truncate per-operation results** to `maxResultBytes`, reporting true size —
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

- [ ] **5.1 Freeze R2.3 as the fifth baseline** with a plain `cp` **before** regenerating
      the contract. The test discovers baselines by filename.
- [ ] **5.2 Bump `serverSchemaVersion` 1.4.0 → 1.5.0.** A new command moves the
      fingerprint anyway, but ⛔ **a contract that grows must bump the version** regardless
      — that is the standing R1 finding.
- [ ] **5.3 Offline fixtures**, at minimum: an atomic prevalidation refusal that mutates
      nothing · `continue` producing a genuine `partial` · every-op-fails producing
      `all_failed`, **not** `success: true` · budget exhaustion setting `complete: false`
      · a create rejected by the allowlist · a duplicate `id` refused · result truncation
      reporting true size · the three legacy tools' additive fields **with their legacy
      fields unchanged**.
- [ ] **5.4 Regenerate the contract, rebuild `dist/`, re-run parity.** ⚠️ Load-bearing:
      `.mcp.json` points at this checkout's `dist/server.js`, so a source-only change
      ships nothing to the running agent.
- [ ] **5.5 Live gate on the SYD throwaway copy** — a mixed batch with one bad target
      under both `stop` and `continue`, a `prevalidateOnly` dry run, and a destructive op
      whose reported scope is checked against the document before and after.
      ⛔ Clean up in a `finally`, and re-assert the baseline.
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
