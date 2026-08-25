# Handoff prompts — written 2026-08-25, after R3-A closed

Four independent next pathways. Each block below is **self-contained**: paste one into a
cold session. They do not depend on each other and can be taken in any order.

> ⛔ `docs/*` is gitignored behind an allowlist, which is why this file lives at the repo
> root. Anything written under `docs/` without an explicit `!` negation has no second copy.

---

## Shared state — true as of 2026-08-25 (verify before trusting)

| Fact | Value |
| --- | --- |
| Release | **R3-A / `1.17.0` / 76 tools** — 66 `stable`, 9 `additive-preview`, 1 `legacy` |
| `serverBuildId` | `r3-a-server-d0897984aeb6` |
| `pluginBuildId` | `r3-a-plugin-07a616c3b48d` |
| fingerprint | `sha256:b67c85d4b655cc5c7f10aa28dd55f450b63f2a292a06585b49d39559bd6e4fbd` |
| Offline suite | **443/443** (`bun run verify`) |
| Live gates | **19 pinned, all green** on channel `wi3cjzy3` |
| Stale-gate ledger | **empty** — every gate in `scripts/` pins this build |

**Disposable Figma file used for live gates:** *"Starter File - PsiAtiva - Disposable"*,
25 pages, 9 local variable collections. Mode ceiling **observed at 10** on this file.

- `VariableCollectionId:17050:782` — *"7. Grids"*, **4 modes** (the max; inflate this one when
  a gate needs a collection AT the ceiling, then remove exactly the ids you created)
- `VariableCollectionId:17050:370` — *"8. Dimensions"*, 3 modes
- Export-gate node: `95:1920` (2.75 MPx, on page `1:2` *"🎨 • Guia de Estilo"*) — over the
  ~1.78 MPx threshold but not already past the 16 MP ceiling at scale 1

**Four traps that cost real time here. Read these before touching a gate.**

1. ⛔ **`pluginBuildId` can HOLD while `code.js` changes** — it hashes the file with the
   generated metadata block *stripped*, so a version-only bump is invisible to it. Confirmed
   twice. The consequence flips with direction: plugin-only → *reload the DEV plugin*;
   server-only → *respawn the MCP session and do NOT reload*; both → do both. **Measure it**
   via live `get_runtime_info` → `plugin.buildId`/`apiVersion`, never off
   `compatibility: "compatible"`.
2. ⛔ **Any change to `contractPayload.tools` moves `serverBuildId` and re-stales all 19
   gates.** Budget the re-pin + re-run into the task, and sequence changes that both move the
   build into ONE pass — that is the whole reason promotions ride along with builds here.
3. ⛔ **Three verdict protocols.** 18 gates write `success` into `report.json`;
   `live-export-gate` writes **no** `success` field and its verdict is exit 0 + `failure:
   null`. A runner keyed only on `success` scores a passing export gate as FAIL forever.
4. ⛔ **Re-pinning is not re-running.** `tests/live-gate-pins.test.mjs` goes green the moment
   pins match — which is exactly the state a gate is in when it has never been executed
   against the build it now claims. Say so in the ledger comment, or run it.

---

## Handoff 1 — build `delete_variable_collection`

```text
Build `delete_variable_collection` in the talk-to-figma fork
(knowledge/projects/talk-to-figma-fork). It is the one named capability gap left in the
fork, and it is the only item where the fork's OWN gate coverage is currently blocked.

WHY NOW. `create_variable_collection` ships `stable` but has NEVER been exercised live.
Its gate leg (`live-variable-collections-bindings-gate.mjs`, behind
`--allow-permanent-collection=true`) is opt-in precisely because a created collection
cannot be removed by any tool in this fork, so running it leaves permanent debris in the
document — reported in `stillOwed` and removable only by hand in Figma's UI.
`docs/VARIABLE-SLICE-PRIORITIZATION.md` §"One scope edge" defers this tool with "decide
when the decision is made, not now". The deciding reason has now arrived, and it is a
FORK-side one (gate coverage), not the consumer-side ramp-cleanup case that section
anticipated. Say so in the record rather than implying the deferred question was answered.

SHAPE. Mirror `delete_variable` (`code.js`), which already solved the hard parts:
  · literal `confirm: true` — not merely truthy — or refuse having written nothing
  · exact LOCAL collection only; typed refusal for remote, never a pass-through host error
  · ⛔ observe-then-claim: `delete_variable`'s FIRST implementation asked ONE question after
    remove() and Figma answered with a stale object inside the deleting frame, so its
    success branch was UNREACHABLE live while the offline harness stayed green. Probe
    SEVERAL independent signals, name which one fired, and return
    `removal_unconfirmed` (NOT success) when none can distinguish a real removal from a
    no-op. The caller's cross-frame re-read is the instrument that settles it.
  · decide and DOCUMENT the non-empty case: refuse a collection that still holds variables,
    or delete and report the blast radius from the PRE-call membership. Either is
    defensible; silently destroying variables is not.

DELIVERABLES.
  1. Plugin handler + server tool + contract regeneration (77 tools).
  2. Offline suite covering: confirm gate, remote refusal, non-empty case, unverified
     removal, and the success path.
  3. Ship it `additive-preview` — it is a new receipt whose observation block will grow.
  4. `scripts/live-variable-collection-delete-gate.mjs`, pinned to the new build. Prove its
     refusal leg fires (throwaway copy with a bad plugin pin → exit 1 at assertRuntime,
     created nothing) before believing any green.
  5. Then run the collections/bindings gate WITH `--allow-permanent-collection=true` and
     delete the collection it creates — that leg has never run live, and this tool is what
     makes it rerunnable.

COST, STATED UP FRONT. A new tool moves `serverBuildId` → all 19 gates re-stale → re-pin
and re-run each once. That is unavoidable; fold any other build-moving change into the
same pass.

Read `CLAUDE.md`, then `TASKS.md`, then `docs/VARIABLE-WRITE-PLAN.md`. Interview me before
building — this repo's convention is a short round of clarifying questions first.
```

---

## Handoff 2 — R3-A retrospective and re-cut R3

```text
Run the R3-A retrospective and re-cut R3 in the talk-to-figma fork
(knowledge/projects/talk-to-figma-fork). ROADMAP.md requires this before any R3 build work:
"the rest of R3 defines capability boundaries and must be re-cut after the preceding
retrospective." This is a PLANNING task — do not build tools.

WHAT R3-A ACTUALLY SHIPPED. Capability C7's first third: variables. Eleven tools across
mode add/remove/rename, variable create/set/delete, collection create, metadata, and the
two binding tools — plus `get_variable_capabilities`, now `stable`. All live-accepted.

WHAT REMAINS IN C7. Paint/text/effect/grid STYLES, and components/variants/instances.
Both are still coarse and unscoped.

THE RETROSPECTIVE SHOULD ANSWER, from measured evidence in the repo rather than memory:
  · Which R3-A defects were TOOL defects and which were INSTRUMENT defects? The recorded
    tally is lopsided (a dead read path in a gate, a fixture that invented a platform rule,
    a gate asserting a superseded contract, an assertion that could not pass for any input).
    If gates keep breaking more often than tools, the gate-authoring convention is the thing
    to change before writing 20 more of them.
  · What did `additive-preview` actually buy? Five tools grew their observation block on
    first live contact and two of those growths were REFUSALS OF FICTION the offline suite
    had asserted. That is the level working as designed — say so, with the examples.
  · What does the 19-gate re-run cost per build move, and is one-gate-per-tool still the
    right granularity for a release with 3× the tools?
  · Which live premises remain UNMEASURED across the gates' `stillOwed`? Several need fork
    tools that do not exist (`set_fill_style`, a range-font setter, a group-creation tool).
    Decide whether R3 should ship those to close its own measurement gaps.

THEN re-cut R3 into slices with the same discipline R3-A used: each slice plan-independent
where possible, each with its own live gate and an explicit disposable-target
acknowledgement, and each stating its acceptance BEFORE it is built.

Read ROADMAP.md, TASKS.md, docs/R3-A-VARIABLE-WRITE.md, docs/VARIABLE-WRITE-PLAN.md and
docs/VARIABLE-SLICE-PRIORITIZATION.md. Interview me before writing the plan.
```

---

## Handoff 3 — R3-A consumer proof (`umjuansantos` §1.4)

```text
Execute the R3-A consumer proof for the talk-to-figma fork: the ten design-system
corrections in `umjuansantos/TASKS.md` §1.4, end to end, using only shipped fork tools.
`docs/VARIABLE-WRITE-PLAN.md` §Acceptance names this as R3-A's consumer proof, and
`docs/VARIABLE-SLICE-PRIORITIZATION.md` already maps each correction to the tool that
executes it. Until now all ten remain hand-transcription.

THE CORRECTIONS include: the `Inter` → Caslon/Source Serif 4 font fixes, a new `Text/brand`
semantic token aliased per mode, `Family/Accent`, removal of the purple `Main/Secondary`
ramp, and the `Main/Primary/25` fix.

⛔ THIS IS EVIDENCE, NOT A REGRESSION HARNESS. Consumer acceptance can prove usefulness; it
cannot become the fork's only regression harness, and a consumer finding does not redefine
the fork. If a gap turns up, the fix is the smallest GENERIC Figma capability in the fork,
with its own tests and its own gate — never a consumer-shaped special case.

⛔ TWO THINGS TO CHECK BEFORE STARTING.
  1. This runs against a REAL design system, not the disposable starter file. Confirm with
     the owner which file, and confirm they accept writes to it. Every variable write tool
     in this fork requires an explicit `--disposable-target=true`-style acknowledgement for
     exactly this reason.
  2. The ramp-removal step may empty an entire collection and leave it behind — the fork has
     NO `delete_variable_collection` (see Handoff 1). Decide up front whether that last step
     is a hand-edit or a blocker, rather than discovering it at correction #9.

DELIVERABLE: a record doc naming, per correction, the tool call made, the receipt observed,
and whether it succeeded — plus any generic gap found, written up as a fork task rather than
patched locally.

Read CLAUDE.md, then docs/VARIABLE-SLICE-PRIORITIZATION.md §Coverage. Interview me first —
in particular about which file and what write authorization exists.
```

---

## Handoff 4 — upstream the R3-A work

```text
Offer the talk-to-figma fork's R3-A variable-authoring work upstream to Grab's
cursor-talk-to-figma-mcp. `docs/VARIABLE-WRITE-PLAN.md` §"Upstream posture" says every tool
in R3-A is generic Figma capability with no fork-specific coupling, so it is PR-eligible
under ROADMAP.md RM12.

CONVENTIONS THAT ARE NOT NEGOTIABLE.
  · SOURCE-ONLY. Grab's convention is that feature PRs touch zero `dist/`. A PR carrying
    build artifacts will not be taken.
  · ⛔ NEVER let upstream timing gate the local build. PR #184 has been open and unreviewed
    since 2026-07-16; that is the expected latency, not a blocker. PR #185 merged, so the
    channel does work.
  · Small and generic. One coherent capability per PR, not a 76-tool dump.

SUGGESTED CUT. The variable-write slice is the natural unit: mode add/remove/rename,
variable create/set/delete, collection create, metadata, and the two binding tools, plus
`get_variable_capabilities` as the preflight that makes them safe to call. Consider whether
the capability-probe tool should lead as its own PR — it is read-only, additive, and useful
on its own, which makes it the easiest thing for a maintainer to say yes to.

BEFORE OPENING ANYTHING: check the current state of PR #184 and #185 and whether upstream
has diverged, then confirm with the owner which slice to offer and under what account. Do
not open a PR without that confirmation.

Read ROADMAP.md RM12 and docs/VARIABLE-WRITE-PLAN.md §"Upstream posture". Interview me
first.
```
