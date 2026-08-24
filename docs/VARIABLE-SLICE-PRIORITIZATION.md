# Variable Slice Prioritization — cutting R3-A ahead of R2.7

> **Status: IN PROGRESS 2026-08-24 — Phase 1.1 is implemented and offline-gated.** This
> document does two things: it records the
> evidence that closes the "should we wait for the official Figma MCP instead?" question,
> and it specifies the exact `TASKS.md` / `ROADMAP.md` edits that move the variable write
> surface from "someday, inside R3" to "the next release after R2.6 closes."
>
> It does **not** replace [`VARIABLE-WRITE-PLAN.md`](VARIABLE-WRITE-PLAN.md). That plan still
> owns the full variable half of R3 — collections, modes, aliases and node bindings. This one
> carves a **three-tool slice** out of its front and schedules it.

## Why now — the evidence, measured 2026-08-22

The consumer gap has been open since 2026-08-07 and re-verified three times. What changed
today is not the gap; it is that **the only alternative route was eliminated**, so the fork
is now the sole path rather than the convenient one.

### ⛔ The Figma REST API is closed — reads included, not just writes

All three Variables endpoints carry the same gate:

| Endpoint | Tier | Scope | Gate |
| --- | --- | --- | --- |
| `GET /v1/files/:key/variables/local` | 2 | `file_variables:read` | *"available to full members of Enterprise orgs"* |
| `GET /v1/files/:key/variables/published` | 2 | `file_variables:read` | same |
| `POST /v1/files/:key/variables` | 3 | `file_variables:write` | same, **plus** edit access to the file |

⭐ **The write endpoint is not the only gated half.** The earlier assumption was that reads
were open and only `POST` was Enterprise-gated, which would have left a read-compare workflow
available. It does not — a non-Enterprise token cannot even *enumerate* variables over REST.

⛔ **The missing `fileKey` was never the blocker.** The consumer captured
`g4msbU8736JXN4BpnRbaGs` on 2026-08-07 specifically to unblock this route. The route was
already closed; the fileKey bought nothing. **Do not re-open this question on the grounds
that a fileKey is now available.**

**The owner's plan is Figma Education/Professional, confirmed 2026-08-22 — not Enterprise.**
That is a fact about the account, not an inference from the file, and it closes the REST
route for this consumer permanently rather than pending an upgrade.

### ✅ The Plugin API is open, and the two tier-limited operations are off-path

`figma.variables` exposes `createVariable`, `createVariableCollection`, `setValueForMode`,
`setBoundVariable`, `addMode`, `renameMode`, `remove` and `removeMode` with **no plan gate on
the basic write surface**. Exactly two operations are tier-limited:

- **`addMode`** — capped by the file's pricing tier; throws `in addMode: Limited to N modes
  only`. Starter is 1 mode; Professional is 10 per collection since Schema 2025.
- **`extend`** (extended collections) — Enterprise only; throws `Cannot create extended
  collections outside of enterprise plan`.

⭐ **Neither is reachable from the slice below.** Every operation the slice performs writes
into modes that **already exist** in the target file, or creates a variable inside an
**existing** collection. The slice therefore has **no plan dependency at all** — it behaves
identically on Starter, Professional and Enterprise. This is a deliberate scope property, not
a coincidence: it is why `create_variable_collection` and `add_mode` are excluded below even
though the full R3 plan owns them.

### ✅ The read layer already supplies every identifier the slice needs

`get_variables` returns variable IDs, collection IDs, per-mode `id` (`code.js:3085`) and
`defaultModeId` (`code.js:3096`). **The slice requires zero read-layer changes** — no new
fields, no contract change on the read side, no re-audit of the consumer's file. The audit
performed on channel `zak6gn42` remains valid input.

## The slice — R3-A, three tools

Figma-native and consumer-neutral, per the dependency rule. The consumer's correction list is
the **motivation**; none of its vocabulary enters the fork.

| Tool | Signature | Figma call |
| --- | --- | --- |
| `set_variable_value` | `(variableId, modeId, value)` | `Variable.setValueForMode` |
| `create_variable` | `(collectionId, name, resolvedType)` | `figma.variables.createVariable` |
| `delete_variable` | `(variableId)` | `Variable.remove` |

**`value` is a union**, and the alias arm is load-bearing rather than a nicety:

- `COLOR` — the fork's existing hex/RGBA convention, same filter as `set_fill_color`.
- `STRING` / `FLOAT` / `BOOLEAN` — validated against the variable's own `resolvedType`.
- `{ type: "VARIABLE_ALIAS", id }` — ⭐ this is what lets one canonical ramp absorb its
  duplicates without deleting them, which is the reversible half of the one genuine decision
  in the consumer's list. Without the alias arm the slice can only delete.

### ⛔ Explicitly NOT in this slice

- `create_variable_collection` / `add_mode` / `rename_mode` — the two tier-limited calls and
  their neighbours. Excluded to keep the slice plan-independent.
- `bind_variable` (`setBoundVariable`) — node bindings. The consumer's list contains zero
  bindings; adding it would be speculative surface. Stays in `VARIABLE-WRITE-PLAN.md`.
- `delete_variable_collection` — see the scope edge below.
- Paint/text/effect/grid **styles**, components and variants — untouched, still coarse R3.

### ⚠️ One scope edge, recorded rather than discovered later

The slice deletes **variables**, not collections. If the canonical-ramp decision ends up
removing a duplicate ramp that occupies an entire collection, the slice empties it and leaves
the empty collection behind. That last step stays a hand-edit, or pulls
`delete_variable_collection` in as a fourth tool. **Decide when the decision is made, not
now** — the shape of the ramp cleanup is the consumer's open question, not the fork's.

## Coverage — the slice against the real consumer list

The ten corrections in `umjuansantos/TASKS.md` §1.4, mapped to the tool that executes each.
Recorded here as acceptance evidence for the slice's scope, not as fork requirements.

| # | Correction | Tool | Plan-gated? |
| --- | --- | --- | --- |
| 1 | `Family/Heading` → Adobe Caslon | `set_variable_value` | no |
| 2 | `Family/Body` → Source Serif 4 | `set_variable_value` | no |
| 3 | Three `0. Primitives` strings | `set_variable_value` ×3 | no |
| 4 | Delete the purple `Main/Secondary/*` ramp | `delete_variable` ×11 | no |
| 5 | Add `Text/brand`, Light + Dark | `create_variable` + `set_variable_value` ×2 | no |
| 6 | Add `Family/Accent` (the third family) | `create_variable` + `set_variable_value` | no |
| 7 | `Main/Primary/25` still violet | `set_variable_value` | no |
| 8 | `alpha/primary/8·16·24` still purple | `set_variable_value` ×3 | no |
| 9 | Three duplicate ramps → one canonical | `set_variable_value` (alias) **or** `delete_variable` | no |
| 10 | Two `2. Semantic` values disagree with CSS | `set_variable_value` ×2 | no |

**10 of 10 covered. 0 require a new mode, a new collection, or a node binding.**

## Scheduling — after R2.6 closes, before R2.7 visuals

⛔ **R3-A does not jump ahead of R2.6 item 2.4.**

⚠️ **Item 2.4's code landed while this document was being written** — `set_clips_content`
was committed in `eef4e15` → `d0d2de1` by a concurrent session, and the contract at `6708666`
now reads **60 tools**, fingerprint `sha256:f229f6ec…53ebd`. This paragraph originally said
the tool was uncommitted at `e41735e`; that was true when written and false twenty minutes
later. **Re-derive the pin from `runtime-metadata.ts` before acting on any number here.**

The order is therefore:

1. ✅ **Item 2.4 code** — `set_clips_content`, the last layout tool. Committed.
2. ⏳ **Item 2.4's live gate** — `scripts/live-clips-content-gate.mjs` exists; `TASKS.md`
   line ~1368 still lists `set_clips_content` as ⏳. ⛔ **Do not conclude it passed or
   failed from this document** — read the tracker's own record, and grep the positive form
   as well as the negative one.
3. **The re-pin + one re-run of all four stale gates.** The owner's standing call, already
   due. R2.6 closes here.
4. **R3-A** — the three tools above, one contract bump (`1.8.0` → `1.9.0`), one live gate.
5. **R2.7 — visuals**, as previously planned.

⭐ **R3-A is R3 capability (C7), executed out of order — not a new capability.** The spine
stays honest: C7 is still "variables, styles, and components authoring." What moves is the
*release* that delivers its first third.

## The edits this plan authorizes — ✅ ALL APPLIED 2026-08-22

⚠️ **Two things about how they landed, both worth knowing before the next edit here.**

**① A concurrent session committed them.** The four fork-side edits below were written into
the working tree by this plan's author and then committed by a *different* session, in
`6e22ae8`, `8cea5e8` and `8a32905`. Nobody in this session ran `git commit`. That is the
documented hazard of this repo — ⛔ **never `git add -A`; peer sessions write it** — working
here at the same time as another session means your uncommitted edits can be swept into
somebody else's commit message.

**② `.gitignore:5` is `docs/*`, an allowlist.** Every tracked file in `docs/` has an explicit
`!docs/<name>.md` line beneath it. A new document created here is **silently invisible** — it
does not appear in `git status`, not even as untracked, so "I wrote the plan" and "the plan is
in the repo" are two different claims. This file needed `!docs/VARIABLE-SLICE-PRIORITIZATION.md`
added at line 15 before it could be tracked at all. **Add the `!` line in the same breath as
creating the doc.**

### `TASKS.md`

1. **§`## ▶ Next session`** — after item 2.4 and the re-pin, name **R3-A as the next release**
   rather than R2.7 visuals, with a one-line pointer here.
2. **§`Release R3`** (line ~1389) — replace the stale *"re-verified 2026-08-12 against HEAD
   `c10c9ff`, schema `1.4.0`, 52 tools"* paragraph with the 2026-08-22 measurement
   (**60 tools committed at `6708666`**, schema `1.8.0`, fingerprint `sha256:f229f6ec…53ebd`),
   add the REST-closure evidence, and split the first R3 checkbox into **R3-A (scheduled)**
   and the remainder (still coarse).
3. **The release table** (line ~165) — add an R3-A row above R3.

### `ROADMAP.md`

1. **Capability spine, C7** (line 79) — active release becomes `R3-A → R3`.
2. **Benefit-delivering release path** (line ~89) — insert an R3-A row before R3, with its own
   riskiest-assumption cell: *the plugin-side variable write surface is sufficient for a real
   design-system reconciliation without REST access.*
3. **Line 91** — *"Only R0 is execution-ready. R1–R3 define capability boundaries"* is stale
   after R1/R2 shipped; correct it to name R3-A as execution-ready.
4. **RM1** (line 98) — its parenthetical *"plan limits"* now has a measured referent; cite the
   Enterprise gate so the next reader does not re-derive it.

### Stale-claim cleanup, same pass

| File | Line | Correction |
| --- | --- | --- |
| `TASKS.md` | ~1409 | The 08-12 `c10c9ff` / `1.4.0` / 52-tool numbers → 08-22 numbers |
| `docs/VARIABLE-WRITE-PLAN.md` | header | Same stale numbers; add the REST-closure finding |
| `umjuansantos/TASKS.md` | 107 | Same stale numbers; record that REST is closed for good |
| `umjuansantos/TASKS.md` | 215 | *"🟡 Uncommitted"* — **verified false 2026-08-22**: `git status` clean, `git diff HEAD` empty, `master` level with `origin/master` |

⚠️ **`umjuansantos` is a second repository.** Two of the four cleanup edits land in a
different submodule and must be committed separately. The fork never imports it; this is
documentation crossing the boundary, not code.

⛔ **Never `git add -A` in this repo** — peer sessions write it. Stage named paths only.
