---
name: talk-to-figma fork — project memory
description: Live state for the R2 batch-contract fork — what passed, the server/plugin pairing hazard, and the gates still open
type: project
---
# talk-to-figma fork — Project Memory

> **Migrated out of the global memory router 2026-08-16.** The router keeps a one-line stub pointing here; ⛔ new detail lands in this file, not in the router.
>
> ⚠️ **This repository is PUBLIC.** No credentials or tokens in this file.
> ⛔ **Never `git add -A` here** — peer sessions write this repo concurrently. Stage explicit paths.

## ▶ Resume (checkpoint 2026-08-22)

- **Project:** `knowledge/projects/talk-to-figma-fork` — R2.6 layout, **Phase 2 open**
- **▶ START HERE:** 2.0 · 2.1 · 2.2 · 2.3 GATED, and **2.4 `set_clips_content` is BUILT +
  COMMITTED but ⏳ NOT GATED** — the gate REFUSED at `join_channel` on a stale DEV plugin.
  Next = **owner re-runs the DEV plugin in Figma, rejoins a channel, then re-run
  `scripts/live-clips-content-gate.mjs`.** After it passes, the owner's standing call comes
  due: re-pin and re-run the stale gates ONCE — the backlog is **FIVE**, not the four the
  plan predicted, because 2.3's own gate joined on the way out.
- **Doing:** ✅✅ **R2.6 Phase 2 item 2.0 is BUILT, COMMITTED and GATED.** Built 2026-08-21
  (offline), and it SPENT the bump: contract `1.7.0` → `1.8.0`. `create_text` carries the
  twelve `set_text_style` parameters, `setCharacters` is **awaited**, and an unloadable
  font is **REFUSED** rather than substituted. **187 tests green**, five source mutations
  killed + the control survived, `dist/` byte-identical across three builds, six baselines
  replaying, `verify-release` passed. ✅ **COMMITTED `e3e794d`** (tree clean).
  ✅ **LIVE GATE PASSED 2026-08-22, channel `7l9ymck4`** — first run, exit 0, no retries;
  scratch page `6043:2` deleted in the `finally`, baseline restored id-for-id. Full record
  in `docs/R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md` § "The live gate PASSED — 2026-08-22".
  ⭐ **The DEV plugin re-run was VERIFIED, not performed** — `assertRuntime` read the live
  `pluginBuildId` and it already matched HEAD.
- **Also done 2026-08-22:** ✅ **item 2.1 `set_layout_child` is BUILT (offline)** — the
  child side of auto-layout. **204 tests** (was 187), six mutations killed + control
  survived, `dist/` byte-identical ×3, `verify-release` passed. ⛔ **No bump** — a new tool
  is additive, schema **HELD at `1.8.0`**, zero `compatibilityErrors`.
  ⚠️ **Pins moved differently from 2.0:** both builds moved, fingerprint moved, tool count
  **56 → 57**, **schema held**. New pair **`r2-server-92dc135f665b` ↔
  `r2-plugin-3f7c7cd69133`**, `sha256:1865d817…6b7ebb09`.
- **Also done 2026-08-22:** ✅✅ **item 2.1 is GATED.** `live-layout-gate.mjs` PASSED on
  channel `mzg3tlfl`, **run twice, both green**, pair `r2-server-92dc135f665b` ↔
  `r2-plugin-3f7c7cd69133` confirmed live, scratch page deleted and baseline restored each
  run. ⭐ DEV plugin re-run **VERIFIED, not performed** — `assertRuntime` read the live
  `pluginBuildId` and it already matched HEAD. ⛔ **`set_layout_child` needed NO changes —
  all three defects were in the GATE**, which had never been run. Full record in
  `docs/R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md` § "The layout live gate PASSED — 2026-08-22".
  🔴 **One was a FALSE GREEN on the gate's headline claim:** §4's F4 validate-all-then-write
  check scored a partial write by asserting the height *held* — but writing `layoutGrow: 0`
  changes **no height at all**, so a clean refusal and a partial write read identically and
  the check could never fail. 🔴 **The platform claim underneath it was false:** `0` does
  **not** shrink the child back — Figma keeps the stretched height as the node's **own**
  size (measured: grow-1 tracked `600→900→500`, grow-0 **held at 900** while the parent went
  to 500). Both checks now move the **PARENT** and read who follows; ⚠️ the polarity is
  **inverted** between them — in §3 holding is the pass, in §4 following is. 🟡 **1 file
  uncommitted:** `scripts/live-layout-gate.mjs` (+107/−14), no source/plugin/contract change.
- **Also done 2026-08-22:** ✅✅ **item 2.2 `set_constraints` is BUILT AND GATED** — how a
  node resizes with its parent frame. **224 tests** (was 204), **seven** mutations killed +
  control survived, `dist/` byte-identical ×3, `verify-release` passed, then
  `scripts/live-constraints-gate.mjs` PASSED on channel **`2bcdtr5b`**. ⛔ **No bump** —
  additive, schema **HELD at `1.8.0`**, zero `compatibilityErrors`. ⚠️ Pin shape **same as
  2.1, not 2.0**: both builds moved, fingerprint moved, tools **57 → 58**, schema held. New
  pair **`r2-server-06f75969aa1d` ↔ `r2-plugin-e82230c1bbb1`**,
  **`sha256:8ceaf9d2…93b236f`**.
  ⛔ **The DEV plugin re-run was REQUIRED, not merely verified** — the FIRST time
  `assertRuntime` has actually fired. Attempt 1 refused at `join_channel` with the plugin
  still on `r2-plugin-3f7c7cd69133`; **nothing in the document was touched**.
  **Four decisions taken with the owner before building:** ① an in-flow auto-layout child
  refuses the **whole call** — the exact **INVERSE** of 2.1 ①, since auto-layout and
  constraints are mutually exclusive answers to one question; ② **both axes optional, ≥1
  required**, overriding the plan's required pair — the merge is a **platform requirement**
  (`constraints` is ONE object property; Figma refuses a half-object); ③ **PAGE** refused,
  **GROUP** allowed-and-measured rather than refused on an unverified claim; ④ the enum
  lives in **Zod**, deliberately opposite to 2.1, because all five values are legal.
  ⭐ **Partial application is structurally impossible** — one object assignment. ⭐ The
  receipt has **no `appliedFields`** on purpose: both axes write every time, so that list
  could never fail.
  ✅ **Both platform premises MEASURED, both HOLD** — the auto-layout claim (same stored MAX
  honoured while ABSOLUTE `0 → 200`, ignored back in flow) and the GROUP claim (a group
  child's constraint **does** resolve, against the enclosing frame).
- 🔴 **A real shipped defect was found in a NEIGHBOUR and fixed:** `set_layout_sizing`'s FILL
  guard tested `parent.layoutMode === "NONE"` but **not `undefined`** — and a PAGE or GROUP
  has no `layoutMode` at all, so `FILL` on any top-level frame passed the guard and wrote a
  value Figma ignores. Masked for six releases by the test harness giving **every** node a
  blanket `layoutMode: "NONE"`; type-gating that default — which also **retires the
  dishonest-fixture debt 2.1's gate recorded** — surfaced it immediately.
- 🔴 **The gate scored a FALSE RED on its own first run**, and its own text gave it away
  (*"the cloned group did change (137 → 137)"*). §6 measured the child's offsets **within
  its group** and read `0 → 0` — arithmetic, not a result: a single-child group's bounding
  box **is** its child's box, so the check could not come out any other way. ⛔ I built an
  instrument check for the confound I anticipated (did the group move?) and it **passed**,
  while the reading underneath it was structurally fixed. Repaired by measuring against the
  **FRAME** and adding an untouched **CONTROL** clone → verdict flipped to `holds`.
- 🔴 **My first mutation run was worthless and the CONTROL caught it** — 7 "killed", but a
  comment-only control died too, because any `code.js` edit moves the plugin fingerprint and
  `contract.test.mjs` was killing everything regardless of behaviour. Re-run against the
  behavioural files only: **7 killed, control survived**.
- **Also done 2026-08-22:** ✅✅ **item 2.3 `set_size_limits` is BUILT AND GATED** — a node's
  min/max width and height. **260 tests** (was 224), **twelve** mutations killed + control
  survived, `dist/` byte-identical ×3, `verify-release` passed, then
  `scripts/live-size-limits-gate.mjs` PASSED on channel **`o2vws4ph`**, **run twice**,
  baseline restored both times. Commits `8c3ab70` · `6a65eb4` · `7d86dd3` · `1c83135` ·
  `c915688`. ⛔ **No bump** — additive, schema **HELD at `1.8.0`**, zero
  `compatibilityErrors`.
  ⚠️🔴 **THE PIN SHAPE CHANGED TWICE INSIDE THIS ONE ITEM, and the second is NEW.** Building
  it gave 2.1/2.2's shape (both builds + fingerprint + tools 58 → 59 moved, schema held).
  Then the context-rule fix moved **ONLY THE BUILD IDS** — fingerprint HELD, schema held,
  tool count held, while a new refusal and a rewritten description shipped underneath. The
  fingerprint hashes the capability SURFACE, so a rule added *inside* an existing tool is
  invisible to it; the stale-plugin preflight caught that run on the **build ID alone**.
  ⛔ A fingerprint check by itself would have waved a stale plugin through. Final pair
  **`r2-server-a9e8d5b3bf78` ↔ `r2-plugin-1fb9729971a3`**, **`sha256:89be6e6c…cea87f9d`**.
  See [[feedback_a_fingerprint_only_covers_what_it_hashes]].
  ⛔ **The gate refused at `join_channel` TWICE**, once per plugin build; **nothing in the
  document was touched either time**. Second and third times `assertRuntime` has fired.
- 🔴 **THE GATE FOUND TWO REAL DEFECTS ON ITS FIRST RUN, BOTH IN THE TOOL.** Decision ③
  named two possible answers — the limit RESOLVES or it is INERT (a silent discard). Figma
  gave a **THIRD: it THROWS.** The measured rule (an 8-cell matrix) is purely **CONTEXTUAL**
  — writable on auto-layout nodes and their children, **node TYPE irrelevant**: a RECTANGLE
  *inside* auto-layout is accepted, a TEXT *outside* it is refused.
  ① 🔴 **The eligibility probe measured the wrong thing** — it read whether the node
  *exposes* `minWidth`, but all four are **readable on EVERY node** and only the WRITE is
  gated. All four ineligible cases were refused by **FIGMA during the write phase**; the
  handler had never once refused for the right reason. ⭐ It stayed atomic only because the
  platform rejects the FIRST field — the platform's ordering, not the tool's guarantee.
  ② 🔴 **The harness modelled a TYPE rule Figma does not have**, so its eligibility tests
  were green against a fiction — same class as the blanket `layoutMode: "NONE"` 2.1 shipped.
  ✅ **Fixed** (owner's call): the handler owns the rule in the validation phase naming
  `set_layout_mode`; the harness gates the **setter** on context, so forgetting the rule now
  fails offline. Fixture gained `50:1`. The re-run **proved the refusal moved layers** — 4
  handler refusals, 0 platform.
  ⭐ **Decision ③ was superseded by its own measurement, not overturned by an opinion** —
  "allow and measure" is what produced the evidence that closed it.
- 🔴 **And TWO defects in the GATE itself.** ① **An instrument pinned to the implementation
  it measures** fails on exactly the change it exists to verify: §6b asked whether some
  context was refused *by the platform*, true before the fix and false after, so a correct
  fix made the gate report its own probe proved nothing. ② **§7 asserted a belief about the
  harness instead of reading it** and kept emitting a red "go fix `SIZE_LIMIT_CARRIERS`"
  finding after the harness was already correct — [[feedback_a_status_marker_that_was_true_when_written]].
  It now READS the harness file.
  ⏳ **Still unmeasurable:** whether Figma rejects a *transient* min > max. The fork has no
  other writer for these properties and the tool refuses every path that produces the
  transient, so both readings are identical. In `stillOwed`, never in `findings`.
  **Four decisions taken with the owner before building:** ① **`null` clears, omitted
  preserves** (R2.3's semantics; published as `type: ["number","null"]`); ② the pair rule
  validates the **EFFECTIVE post-write pair**, supplied merged over stored — a lone
  `minWidth: 500` is refused against a stored `maxWidth: 300`, a conflict invisible in the
  caller's own arguments; ③ **NO context refusal** — the inverse of BOTH neighbours, because
  "min/max are auto-layout only" is unmeasured and an unverified refusal looks
  authoritative; the gate returns a three-way verdict; ④ the **clamp is reported, never
  refused** — `size.before`/`size.after`/`resized`, a second currency.
  ⛔ **Partial application is genuinely possible for the first time since Phase 1**, so
  validate-all-then-write stops being a formality. ⚠️ **The pair trap has a SECOND half
  validation cannot catch** — two assignments pass through an intermediate state, so the
  write **ORDER** is computed per axis (raise → max first, lower → min first). ⭐ One order
  is always available: for both to be unsafe the node would already hold min > max.
  ⭐ **`appliedFields` is PRESENT here and was deliberately ABSENT from 2.2's** — there both
  axes wrote every call, so the list was a constant that could never fail.
- 🔴 **A mutation SURVIVED, and the fix was in the HARNESS, not the tool.** While the
  platform stores exactly what it is handed, a receipt that **echoes its own arguments** and
  one that **reads the node back** produce identical output — so `appliedFields` would have
  been decorative for the second time in three items, and no assertion over values could
  have told them apart. Closed with an opt-in `roundSizeLimits` coercion: a node that rounds
  reports 13 where the echo reports 12.5. ⭐ **Mutation testing caught what review did not**,
  and the surviving mutant was the one defending the receipt's honesty. Same family as
  [[feedback_a_zero_valued_write_reads_as_no_write]].
- **Also done 2026-08-22:** ✅ **item 2.4 `set_clips_content` is BUILT AND COMMITTED, ⏳ NOT
  GATED** — the last of the four layout tools. **287 tests** (was 260), **nine** source
  mutations killed + control survived, `dist/` byte-identical ×3, `verify-release` passed.
  Commits `eef4e15` · `4c4988c` · `d0d2de1`. ⛔ **No bump** — additive, schema **HELD at
  `1.8.0`**, zero `compatibilityErrors`. ⚠️ Pin shape = 2.1/2.2's, **not** 2.3's second move:
  both builds + fingerprint moved, tools **59 → 60**, schema held. New pair
  **`r2-server-fb30663ee0f1` ↔ `r2-plugin-1eee5a6f3bd9`**, **`sha256:f229f6ec…2453ebd`**.
  ⭐ **TWO independent changes moved `serverBuildId`** — the new tool AND the CC1 repair; a
  stability level lives in `contractPayload`.
  ⛔ **THE GATE REFUSED AT `join_channel`** on channel `nple8zt6` — plugin still serving
  `r2-plugin-1fb9729971a3`, `set_clips_content` named as missing. **Nothing in the document
  was touched**; only §1 (published schema) ran. **Fourth time `assertRuntime` has fired.**
  **Three decisions taken with the owner before building:** ① eligibility is a **PRESENCE
  probe** (`typeof node.clipsContent !== "boolean"`), defensible **only** because a boolean
  has no unset value for a `null` to hide in — the exact ambiguity that defeated 2.3's
  identical-looking probe; the gate measures a ten-context matrix anyway and asserts every
  refusal came from the **handler**, not Figma mid-write; ② the receipt carries
  `absoluteRenderBounds`/`absoluteBoundingBox` + per-edge overflow as a **second currency**;
  ③ **no `appliedFields`** — one field written every call is a constant that could never
  fail (2.2's reasoning, 2.1's false green).
  🔴 **THE DESIGN PROBLEM: A BOOLEAN CANNOT FALSIFY ITSELF.** Write `false`, read back
  `false` — a tool that applied the change and one that **echoed its own argument** print
  identically. Killed offline by an **opt-in `ignoreClipsContentWrites`** harness node that
  accepts the write and keeps its old value (2.3's `roundSizeLimits` pattern for a value
  that cannot be rounded). ⛔ That discrimination stays **FIXTURE-ONLY** — live, every
  accepted context stored what it was handed, so both implementations would print the same
  receipt. Same family as [[feedback_a_zero_valued_write_reads_as_no_write]].
  ⛔ **`absoluteRenderBounds` DEFAULTS TO NULL in the harness, opt-in only** — whether Figma
  recomputes it synchronously is **unmeasured**, and computing it unconditionally would turn
  every offline test green against a platform behaviour nobody checked. `renderBoundsChanged`
  is `null`, never `false`, when a reading is missing.
- 🔴 **A CC1 DEFECT HAD BEEN LIVE FOR THREE CONSECUTIVE ITEMS, and 2.4 repaired it.**
  `getResultStability` falls through to `stable` for anything unlisted, so
  `set_layout_child`, `set_constraints` and `set_size_limits` all shipped **FROZEN from
  birth** on reply shapes no live gate had judged — F6, the cut's self-declared
  highest-leverage finding. Only 2.2's deviation was ever written down, and even there as
  *owed* rather than chosen. ⭐ **Nothing in `bun run verify` could have caught it: a
  silently-wrong default and a deliberately-right decision produce BYTE-IDENTICAL
  contracts.** ✅ **The repair was free, and verified rather than assumed** — zero
  `compatibilityErrors` across all six baselines, because `compatibilityErrors()` iterates
  the BASELINE's tools (`contract-lib.mjs:673`) and none of the three appears in any frozen
  contract. ⛔ **CC3 freezes R2.6 as the 7th baseline and the walk-back becomes breaking** —
  this was the last release in which it cost nothing. `tests/contract.test.mjs` now
  mechanises the rule and is **observed FAILING** against a contract mutated into the shape
  it catches. See [[feedback_a_silent_default_is_byte_identical_to_a_decision]].
- 🔴 **The new CC1 guard's FIRST RUN found a second gap — in CC3.** R2.5's three tools are
  `stable` by a real acceptance act (2026-08-19, `ohipqdhg`) but **R2.5 was never frozen as
  a baseline** — `contracts/baselines/` still stops at R2.4, so nothing vouches for them.
  Parked in `ACCEPTED_SINCE_LAST_BASELINE` with the reason. ⛔ **Not fixed** — adding a
  baseline changes the replay set every release is checked against, which is its own
  decision with its own verification.
- 🔴 **THE READ LAYER CANNOT WITNESS THIS TOOL'S OWN PROPERTY.** `filterFigmaNode` keeps a
  `JSON_REST_V1` subset carrying `absoluteBoundingBox` and **neither `clipsContent` NOR
  `absoluteRenderBounds`** — so through `get_node_info` both read `undefined` before AND
  after, and undefined-before-vs-undefined-after **passes vacuously**. The trap that burned
  the typography gate. ⭐ The gate measures through **`export_node_as_image`'s preflight**
  instead, which reports `boundsWidth`/`boundsHeight` off `absoluteRenderBounds` and
  declares its **`boundsSource`** — a built-in instrument check, on a different tool, on a
  different code path, with no stake in the answer. ⏳ Fixing the read layer is a
  result-shape change to a `stable` tool → needs **R2.7's `1.9.0`**.
- ⚠️ **A PEER SESSION WAS ACTIVE IN THIS REPO DURING THE BUILD, and it was visible:** it
  committed my README line on its own as `b64ab2e`, and wrote `TASKS.md` + `ROADMAP.md`
  (the R3-A / Variables-API planning block). Both left untouched. ⛔ `dist/` is gitignored
  but TRACKED — it needs `git add -f`, which is not a red flag here.
- **Next step:** ▶ **Owner re-runs the DEV plugin in Figma** (it holds `code.js` from
  launch), rejoins a channel, then **re-run `node scripts/live-clips-content-gate.mjs
  --channel=<ch> --output-dir=docs/evidence/r2.6-2.4`**. After it passes: re-pin and re-run
  the **five** stale gates ONCE.
- **Key paths / IDs:** `src/cursor_mcp_plugin/code.js` → `setLayoutChild` +
  `LAYOUT_CHILD_ALIGN` / `LAYOUT_CHILD_POSITIONING` · `tests/set-layout-child.test.mjs`
  (17 cases) · **`scripts/live-layout-gate.mjs` (NEW, pins HEAD, never run)** ·
  `tests/live-gate-pins.test.mjs` (now declares **THREE** stale gates — `live-batch-gate`,
  `live-text-style-gate` and `live-layout-gate`; ⛔ none re-pinned, owner's call is to
  re-pin + re-run the set ONCE after 2.4) ·
  **2.2:** `setConstraints` + `CONSTRAINT_VALUES` in `code.js` · `tests/set-constraints.test.mjs`
  (20 cases) · **`scripts/live-constraints-gate.mjs` (NEW, pins HEAD, PASSED `2bcdtr5b`)** ·
  `docs/evidence/r2.6-2.2/report.json` · fixture gained `30:1` (plain FRAME + 2 children)
  and `40:1` (GROUP + 1) on page `2:1`; harness gained type-gated `CONSTRAINT_CARRIERS` and
  `AUTO_LAYOUT_CARRIERS` ·
  **2.4:** `setClipsContent` + `CLIPS_CONTENT_TYPES` / `readClipsContent` /
  `readRenderGeometry` / `sameRenderBounds` in `code.js` · `tests/set-clips-content.test.mjs`
  (25 cases) · **`scripts/live-clips-content-gate.mjs` (NEW, pins HEAD, REFUSED at
  `join_channel` — never completed a run)** · `docs/evidence/r2.6-2.4/report.json` (the
  refused run) · fixture gained `60:1` (FRAME 200×200 + a child at 150,150 that overflows
  two edges), `60:3` INSTANCE, `60:4` COMPONENT_SET on page `2:1`; harness gained
  `CLIPS_CONTENT_CARRIERS` (⛔ **SECTION deliberately OMITTED as unmeasured**, not guessed),
  opt-in `ignoreClipsContentWrites` + `clipRenderBounds`; `tests/contract.test.mjs` gained
  the **CC1 guard** + `ACCEPTED_SINCE_LAST_BASELINE` ·
  `src/talk_to_figma_mcp/batch-receipt.mjs` + its `code.js` mirror (the
  `EXCLUDED_BATCH_OPERATIONS` entry, ⛔ **both** copies) · **HEAD pair (2.4, 2026-08-22):
  `r2-server-fb30663ee0f1` ↔ `r2-plugin-1eee5a6f3bd9`**, `1.8.0`, **60 tools/59 commands**,
  fingerprint **`sha256:f229f6ec…2453ebd`**. ⛔ **The DEV plugin is NOT on this build** — it
  was still serving `r2-plugin-1fb9729971a3` when the gate refused. Prior (2.3, GATED):
  `r2-server-a9e8d5b3bf78` ↔ `r2-plugin-1fb9729971a3`, `sha256:89be6e6c…cea87f9d`.
  ⚠️ This paragraph described **2.1** as HEAD until 2026-08-22 — re-derive it from
  `runtime-metadata.ts` every release rather than reading it.
- **Open / blockers:** ⛔ **2.1 moved both builds, the fingerprint and the tool count
  (56 → 57) — but the SCHEMA HELD at `1.8.0`**, because a new tool is additive. That is a
  different shape from 2.0, which moved the schema too; the answer has now differed on
  **seven consecutive steps**. ⛔ Re-derive from `runtime-metadata.ts`, never carry it
  forward. Adopting HEAD needs a **DEV plugin re-run AND a server respawn**. ⚠️ The gates
  spawn their own server from `dist/server.js`, so only an **interactive** MCP session
  needs the respawn. 🔴 **FIVE gates are now declared stale** — `live-batch-gate.mjs`,
  `live-text-style-gate.mjs`, `live-layout-gate.mjs`, `live-constraints-gate.mjs` and now
  `live-size-limits-gate.mjs`, which passed hours earlier on `o2vws4ph`. All five
  deliberately **not re-pinned**, because re-pinning a gate without re-running it is the
  `e02d1b2` defect. Their staleness is declared by name in
  `tests/live-gate-pins.test.mjs`. ⭐ **Their results still stand for the builds they ran
  on** — what they can no longer do is *start*. Owner's call 2026-08-22: re-pin and re-run
  the set **once**, after the layout tools land. ⚠️ The plan predicted **four**; each item
  staled its predecessor's gate on the way in, and 2.4 staled 2.3's. ⛔ Stage explicit paths, never
  `git add -A` (peer sessions write this repo — one committed `d75c7df` mid-run).
- **Don't forget:** 🔴 **The `1.8.0` bump was NOT mechanically enforced** — regenerating at
  `1.7.0` produced **zero** `compatibilityErrors`, because the snapshot records input
  schemas and stability, **never result shapes**. ⚠️ **Two migrations ride on the bump**:
  an unloadable font now refuses (it used to create the node in whatever face Figma gave),
  and `fontSize: 0` now refuses (it used to become 14 silently). ⛔ Three debts stay open:
  **F3 reachability**, **`available` ≠ `loadable`**, and now `create_text`'s
  **rollback-on-refused-write**, which sits on the same unreachable branch as F3.
  ⚠️ `TASKS.md` has a pre-existing orphaned table row from the R2.4 era — left alone
  deliberately. 🔴 **Line numbers in the plans and TASKS.md are NOT trustworthy** — 2.0's
  own cited offset (`code.js:1790`) was wrong again; the call was at `:1802`. Re-locate by
  NAME before acting on any of them.

## ▶ Live resume state

### ✅ Shipped and green

- **Phases 1 + 2 BUILT**, and the **5.5 live gate PASSED 2026-08-12** — channel `8fbuzws2`, run twice, green on the first run (`953755a`, 🟡 2 unpushed). `apply_batch` executes against a real Figma file. 98 tests, 5 baselines green.
- ✅ **3.1 + 3.2 + Phase 4 COMMITTED (`664135b`), offline gate PASSED 2026-08-12** — contract regenerated to **1.6.0**, `dist/` rebuilt and deterministic, **114/114 tests**, all 5 baselines replayed individually.
  - ⚠️ The earlier note claiming "1 test fails by design" was **wrong — 5 failed**, all the same stale-contract class, all cleared.
- ✅ The 8 files that were held back pending the live gate are **committed** — tree clean at `db4d81b`, gate script tracked.

### ⛔ The pairing hazard — read before touching a running session

The server and plugin builds are a **matched PAIR**. Current pair:

```
r2-server-5ac4bcd1a2a5  ↔  r2-plugin-53a1fa676d6a   (sha256:d39aefef…ca6289)   ← R2.4 ACCEPTED
r2-server-194bc059487c  ↔  r2-plugin-75048983ede3   (sha256:09175c89…)         ← R2.5 Phase 1
r2-server-1a74a40ba8b2  ↔  r2-plugin-10787ea0bdd5   (sha256:56ea2c94…)         ← R2.5 Phase 2
r2-server-a30e91f4f88e  ↔  r2-plugin-0bc82334ff83   (sha256:05ac28c5…)         ← R2.5 Phase 3
r2-server-c45214d7420b  ↔  r2-plugin-0bc82334ff83   (sha256:05ac28c5…)         ← R2.5 ACCEPTED
r2-server-c45214d7420b  ↔  r2-plugin-65d716d57dbb   (sha256:05ac28c5…)         ← R2.6 Phase 1, GATED
r2-server-2fa65a5749e2  ↔  r2-plugin-045a95955905   (sha256:b5cbf7b1…)         ← R2.6 2.0, GATED 08-22
r2-server-92dc135f665b  ↔  r2-plugin-3f7c7cd69133   (sha256:1865d817…)         ← HEAD, R2.6 2.1, GATED 08-22
```

⛔ **HEAD is now item 2.1, and which pins moved is DIFFERENT from 2.0** — ⚠️ this paragraph
described 2.0 as HEAD until 2026-08-22; re-derive it every release rather than reading it.
2.1 moved **both build IDs**, the **fingerprint** and the **tool count (56 → 57)**, but the
**schema HELD at `1.8.0`** because a new tool is additive. (2.0, by contrast, moved the
schema and held the tool count — it was a widening that added none.) Adopting HEAD still
needs **a DEV plugin re-run AND a server respawn**. ⭐ The gates spawn their own server from
`dist/server.js`, so only an **interactive** MCP session needs the respawn — and the plugin
half is what `assertRuntime` pins, which is how 2.0's and 2.1's re-runs were *verified*
rather than assumed.

⚠️ **That answer has now flipped on SIX consecutive steps.** R2.5 Phase 1/2/3 moved both;
R2.5 acceptance moved the server only; R2.6 Phase 1 moved the plugin only (and `dist/`
changed with `serverBuildId` standing still); item 2.0 moves everything. ⛔ Re-derive it
from `runtime-metadata.ts` on every release — a carried-forward answer has been wrong more
often than right.

⭐ **Against the R2.5-accepted build only `serverBuildId` failed** — the third time that
release proved why CC4 pins it. ⛔ But Phase 1 then proved the converse:
`serverBuildId` covers `server.ts` + the contract payload and **nothing else in the
bundle**, so it is not a freshness oracle either.

⭐ **Adopting HEAD needs a DEV plugin re-run — and the server answer SPLITS.** The live gate
spawns its own server from `dist/server.js`, so **the gate never needs a respawn**; only an
interactive MCP session does. Derived 2026-08-19, not carried forward.

🔴 **The `compatible` trap was observed twice over in one session, 2026-08-19.** An
interactive connection on the Phase 2 pair reported `compatibility: "compatible"` while the
gate's *fresh* server refused that very plugin at `join_channel` — naming the plugin build,
the fingerprint AND the missing `set_text_style`. **`compatible` means the two RUNNING halves
match each other. It never means they match the tree.** ⭐ The only reliable read is to
compare the live `get_runtime_info` pins against `runtime-metadata.ts` yourself.

⭐ **Observed 2026-08-18, not assumed:** with the tree at `1.7.0`, a session still open on
channel `yba88v0x` answered `get_runtime_info` with the **old** pair and
`compatibility: "compatible"`. A rebuild reaches neither running side — and `compatible`
means *the two running halves match each other*, never *they match the source tree*. It
will answer `compatible` all day on a stale build.

⭐ **The server half moved TWICE after 1.6.0 and the plugin half moved neither time** — 4.1's wrapper fix (`dbcede2e0895`), then the `stable` promotion (`5ac4bcd1a2a5`). Both are server-side, so adopting the accepted build needs **a server respawn and NOT a DEV plugin re-run**, and compatibility stayed `compatible` live across both. ⛔ That is the *opposite* of the 1.5.0 → 1.6.0 step — re-check it each release rather than carrying the last answer forward.

🔴 **Schema, tool count AND fingerprint all held still across both moves.** The fingerprint hashes `{serverSchemaVersion, capabilityIds}`, and a wrapper fix plus a metadata promotion touch neither — so a stale `dist/server.js` sails past the check that caught the *last* stale pair. **`serverBuildId` is the only pin that fails on it.** The gate pins the build for exactly this reason, and it had to be re-pinned twice this session before it would run.

- ⛔ **A running Figma session is incompatible until the DEV plugin is re-run *and* the server respawned.** Restarting one side only looks like success.
- ⚠️ **The pair ID moves on every rebuild** — it moved twice already (`r2-server-9239fd0bc71b ↔ r2-plugin-d0342abb6c4a`, 53 tools, was the 5.5 pair).
- 🔴 **A fingerprint only covers what it hashes.** A whole contract change once regenerated to a **byte-identical** hash. Read the hash's inputs before trusting it — **pairing ≠ contract identity**.

### 🔴 Known-false claims in the shipped surface

- **Per-op atomicity is FALSE, and now observed.** The proven list grew **3 → 5**: `move_node` and `set_stroke_color` reproduce **partial writes**, rejected by the *Figma property setter* rather than by our envelope.
- **The tool description's "same shape as the standalone tool" is FALSE** for `set_fill_color` / `set_stroke_color` — the batch params are the **plugin-handler** shape, not the standalone shape. ⛔ Fix this **together with 3.1**, never on its own.
- ⭐ **Envelope refusals arrive in two different shapes through MCP:** a duplicate `id` returns an **error result**, while a bad `op` **throws**. A result-only harness reads the thrown one as a crash.
- ⭐ **The chunk pause must be clamped to the remaining budget**, or `timeBudgetMs` is a lie.
- 🔴 **4.4 found a second Finding-4 instance:** `get_annotations` declares progress and emits none. **Pinned, not fixed.**

### ✅ 5.6 — the live pass PASSED, 2026-08-18

Channel `hjyg56t5`, **one run, green on the first try**. `record.success: true`, no failure. The scratch page was deleted in the `finally` and the baseline restored (6 pages, current page back). **SYD content untouched** — the only ops naming real nodes ran inside the `prevalidateOnly` batch, which writes nothing by construction.

- ✅ **The pairing held live:** `r2-server-d248ed7bc295` ↔ `r2-plugin-53a1fa676d6a`, both schema 1.6.0, both fingerprint `sha256:d39aefef…ca6289`, compatibility `compatible`, zero issues. 53 tools, `apply_batch` present.
- ✅ **Refusals arrived in BOTH shapes, as designed:** duplicate `id` → handler *error result*; disallowed `op` → *thrown* schema `-32602`. The trap that scored correct behaviour as FAIL three times stayed closed.
- ✅ **3.1 chunked progress observed over the real transport:** 15 ops / chunk 5 → 4 frames (0→33→67→100), reached complete.
- ✅ **3.2 is now MEASURED, not assumed:** 2019 ms observed vs 2000 ms predicted over 2 gaps. Every op succeeded at `chunkPauseMs=0`, so the pause bought **nothing** on this document — the `0` default is earned, not guessed.
- ✅ **Clamp / Finding-5 regression closed:** `chunkPauseMs=5000` + `timeBudgetMs=1000` → unclamped would be 10 000 ms, actual **1003 ms**; `partial`, 5 done / 10 skipped, **and** 4 frames still emitted. Both halves true at once, which is the only way Finding 5 stays closed.
- ✅ **Partial application reproduced on all three** non-atomic ops — `move_node` (x 0→120), `set_stroke_color` (null→red), `set_item_spacing` (16→24) — each rejected by the *Figma property setter*, not by our envelope.
- ⛔ Stays `additive-preview` until acceptance.

### ✅ 4.1 — the wrapper gap is CLOSED, 2026-08-18 (offline; live gate not yet re-run)

The two prose tools now deliver the unified receipt to an MCP consumer. **125/125 offline, 5 baselines replayed, `dist/` rebuilt and byte-deterministic.**

- ✅ **The receipt is APPENDED, never substituted.** `content[0]` and `content[1]` — the only positions that existed before — are **byte-identical** for `set_multiple_text_contents`, proved by re-running HEAD's own template literal against the new formatter across success / partial / total-failure. The receipt is a third content item, so a prose reader sees no change.
- ✅ **The wrapper is now asserted end-to-end offline** — `tests/wrapper-end-to-end.test.mjs` drives a real MCP `callTool` over stdio, through a relay, into the **real** `code.js`. ⭐ The relay is faked; the **plugin is not**. Nothing in the test supplies an `outcome`.
- ✅ **Mutation-tested against the SOURCE:** deleting the appended-receipt line kills **4 of 5** tests, and `delete_multiple_nodes` correctly **survives** — it never used the new module. A suite that stayed green there would have been the same defect one layer up.
- ✅ **The live gate now ASSERTS it** instead of recording it, and asserts the annotations prose no longer claims batching.
- ⚠️ **New server CLI flag `--port=`** (default 3055). Without it the offline end-to-end test would have to bind the one port a live session already holds. `--server=` cannot substitute — anything but literal `localhost` switches the scheme to `wss://` and drops the port.

### 🔴 Two lies fixed, one finding that had outlived its defect

- ✅ **`set_multiple_annotations` was announcing "processed in batches of 5" and printing "Processed in 1 batches"** — from `completedInChunks || 1`. It processes **one annotation at a time** (`chunkSize: 1`) and reports no chunk field at all, so both statements described work that never happened. The `|| 1` was **fabricating** the number, and the description also claimed "parallelly".
- 🔴 **The gate was filing a finding about a defect fixed two commits earlier.** It hard-coded the claim that `apply_batch`'s description says *"Same shape as the standalone tool of the same name"* — a sentence removed in `664135b`. The gate never **read** the description; it asserted a narrative. It now reads the **published schema** from `listTools` and asserts the param-shape declaration is present. ⭐ A finding is not evidence — check when it was last verified against the thing it describes.
- ⚠️ **`resultStability: "stable"` on these two tools is a DEFAULT, not a decision** — `getResultStability` returns `stable` for everything except `read_my_design` and the additive-preview set. So the contract promises "frozen" over two replies whose shape was never designed. ⛔ It cannot simply be relabelled: weakening a level is a breaking change and `compatibilityErrors()` rejects it by name.

### 🔴 Still recorded rather than failed on

⭐ **A gate can be green and still be telling you something.** These remain data, not assertions:

- 🔴 **`operation_not_allowed` is unreachable through this transport** — the tool's inline `z.enum` rejects a disallowed op first, so the plugin's own allowlist check never answers a live consumer.
- ⚠️ `params` is `z.record(z.any())` — per-operation arguments get **no schema validation**; a wrong-shaped param fails plugin-side and arrives as a receipt entry rather than a schema throw.

### ✅ R2.4 ACCEPTED — 2026-08-18

Live gate **passed twice on channel `qvtz3fwr`**, green on the first try both times: once on the 4.1 build, then again on the accepted build after the promotion. Scratch page deleted in the `finally`, baseline restored (6 pages, current page back), SYD content untouched.

- ✅ **Both prose tools now report `unifiedFieldsVisibleToConsumer: true` live**, `all_succeeded 1/1/0/0`, with the annotations prose reading "Processed one at a time (this tool does not chunk)" instead of the fabricated "Processed in 1 batches".
- ✅ **`apply_batch` promoted `additive-preview` → `stable`**, per the R1 precedent that a promise is promoted once a live gate has earned it. ⛔ `stable` means frozen: a receipt-shape change now needs a new `publicContractVersion`, and the walk-back is breaking.
- ⭐ **The promotion moves the contract, therefore the server build — so the gate was re-pinned and RE-RUN on it.** Accepting a build the gate had never seen would have been the same defect this release spent three phases closing.
- ✅ Acceptance checklist discharged in `docs/R2.4-BATCH-CONTRACT.md`; 3.2 measured again live (1828 ms observed for a 1000 ms pause over 2 gaps).

⛔ **Accepting R2.4 does not accept R2.** ✅ **R2's typography/layout/visual half was CUT
2026-08-18** → [`docs/R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md`](docs/R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md).
Three sub-releases — **R2.5 typography → R2.6 layout → R2.7 visuals** — three contract bumps
(`1.6.0` → `1.9.0`), three live gates, R2 acceptance at the end of R2.7. ✅ Committed at
`750dbd5`; the tree was clean at cut time.

### ✅ R2.5 Phase 1 — the two text defects are CLOSED, 2026-08-18 (offline)

**136 tests green** (was 125), contract `1.6.0` → **`1.7.0`**, R2.4 frozen as the **6th**
baseline, all six replay at zero errors, `dist/` rebuilt, `verify-release.mjs` passed.

- ✅ **The mixed-font defect was one redundant line.** `setTextContent` pre-loaded
  `node.fontName`, which is `figma.mixed` — a symbol — on a multi-font node. `setCharacters`
  on the very next line already branches on `figma.mixed` and loads a concrete font in every
  branch, so the pre-load did no work and was the only thing that threw. **Deleted.**
- ✅ **One deletion fixed single AND batch.** `set_multiple_text_contents` has no font path;
  it calls `setTextContent` per replacement.
- ✅ **The fixture FAILED FIRST** with `Error setting text content: Cannot unwrap symbol` —
  the defect reproduced offline for the first time in four releases. ⭐ Mutation-tested
  **twice**: the pre-fix state, and a *lazy* fallback fix, which the suite also kills
  because it asserts the first character's **real** font was loaded rather than that the
  call merely returned.
- 🔴 **F3 CONFIRMED, not just hypothesised.** Given a refused character write, the old code
  returned a **success reply** and the batch reported `succeeded: 1` / `all_succeeded` over
  an **unchanged document** — R2.4's "the aggregate lies" reappearing one layer *below* the
  aggregate that was fixed to stop lying. `setTextContent` now honours `setCharacters`'s
  `false` return. ⛔ **Reachability in real Figma is still UNPROVEN** — the harness injects
  the refusal, so the trigger is exactly what the test does not establish. Live gate owes it.
- ✅ **The silent Inter substitution is now reported** — `fontSubstituted` / `requestedFont`
  / `appliedFont`, with `false` on the ordinary path so an absence is never mistaken for a
  fact.

⭐ **Why it survived four releases, and it was not "nobody wrote the test":** the harness
could not express the defect. `loadFontAsync` was `async () => undefined` — it accepted a
symbol — and `getRangeFontName` returned the node's own `fontName`, so no mixed-font node
could exist in a fixture. The suite was **structurally unable to reach** the case.

⚠️ **Phase 1 was NOT contract-neutral, contrary to how the plan first described it.** 1.4
adds fields to `set_text_content`, whose stability is `stable`, and free result fields are
granted only to `legacy` / `additive-preview` — so the `stable`-by-default trap fired
*inside* Phase 1, before any new tool existed.

⚠️ **Found and deferred:** `createText` calls `setCharacters` **without `await`**
(`code.js:1790`), so `create_text` can return before its text is set. Belongs to 3.5.

### ✅ R2.5 Phase 2 — the font inventory and preflight are BUILT, 2026-08-18 (offline)

**153 tests green** (was 136), **55 tools / 54 plugin commands** (was 53 / 52), contract
**stays `1.7.0`** — R2.5 spent its one bump in Phase 1 and these are additive inside the same
in-flight release, so only the build IDs and fingerprint moved. Six baselines replay at zero
errors, `dist/` byte-deterministic across two builds, `verify-release.mjs` passed.

- ✅ **CC1 held on the release's first new tools.** Both are in `ADDITIVE_PREVIEW_RESULTS` in
  the same commit that registers them, so neither shipped frozen. Six hand-maintained maps
  updated per F7, including a **new `font_inventory` scope** — `TOOL_SCOPES` falls through to
  `"node"`, which would have been wrong and silent for two tools that touch no node.
- ⭐ **`available` and `loadable` are two fields because they can disagree.** A face can be
  listed and still refuse to load, and `setCharacters` answers that refusal by substituting
  Inter silently — F2. One field would have answered `true` and let the substitution happen:
  a *consistency* check standing in for a *correctness* check. `familyAvailable` is a third
  fact, separating *"Inter has no Blond"* from *"this machine has no Ghost"* — opposite fixes.
- 🔴 **The plan was wrong about `timeBudgetMs`, and the reply says so.**
  `listAvailableFontsAsync()` takes no cancellation signal, so a budget bounds the **reply**
  and the call is *abandoned*, not stopped. `coverage.budgetCancelsFetch: false` is a
  permanent declaration next to `budgetExhausted`, because a bare `budgetExhausted` reads as
  "work was skipped". ⛔ On `check_fonts` the inventory fetch is **un**budgeted for the mirror
  reason: a truncated inventory turns every `available` into a false negative, which is worse
  than slow.
- ⭐ **Absent counts are `null`, never `0`** — a `0` reads as "this machine has no fonts", a
  real finding rather than the absence of one.
- ⭐ **Ordering is a deterministic family-then-style code-unit sort.** Figma does not document
  the API's order, so `offset` paging would be repeatable only by luck. ⛔ Plain `<`, never
  `localeCompare` — locale-dependent ordering is a paging defect that only appears abroad.
- ⭐ **Mutation-tested against the SOURCE, five ways, all killed:** removing the sort (4
  tests), collapsing `available` into `loadable` (3), moving validation into the probe loop
  (1), `null` → `0` (2), `fontCount` describing the window (5). ⛔ The validation one is the
  one that matters — a throw-only assertion would have **survived** it, so the test asserts
  that no font was loaded before the throw, not merely that it threw.
- ⛔ **`check_fonts` is `standard`, not `heavy_read`.** Its cost scales with the caller's
  capped 50-pair list; `TIMEOUT_RANK`'s own comment says reusing `heavy_read` for an
  argument-scaled tool makes the contract lie about why the budget is large. `standard` is
  the weakest claim that can be true, and raising a budget later is the safe direction.
- ⛔ **CC2 held both ways.** `check_fonts` declares `per_font` and emits it in the same
  change; **`get_available_fonts` declares `"none"` on purpose** — one un-cancellable await
  plus an in-memory sort has no point between them to report from, and declaring progress
  there would have minted Finding 4 a third time.

⚠️ **CC6 debt, owed to the live gate:** the fixture supplies the inventory (8 faces), so
offline these tests prove the window, filter, sort and the available-vs-loadable split —
**not** what a real machine returns or how large it is. The 3.66 MB defect this phase is
bounded against has never been reproduced here.

### ✅ R2.5 LIVE GATE PASSED — 2026-08-19, channel `o247ecxs`

First run on the fixed script. Pair confirmed live: `r2-server-a30e91f4f88e` ↔
`r2-plugin-0bc82334ff83`, schema `1.7.0`, fingerprint `sha256:05ac28c5…`, 56 tools,
`compatible`, zero issues. Scratch page deleted in the `finally`, **baseline restored
id-for-id** (6 pages, current page back). ⛔ SYD content never written to.

- ✅ **Validate-all-then-write held with Figma as the judge** — eleven valid parameters and
  a bad enum **last** → refused, node byte-identical on **two** channels: an independent
  REST read *and* the plugin's own snapshot covering the six fields REST cannot see.
- ✅ **Refuse-never-substitute held** — `fontStyle` reads **`Bold`** after the refusal.
  ⭐ That is the whole discriminator: `Inter/Regular` is exactly what would be sitting
  there had the tool grown `setCharacters`'s silent fallback.
- ⭐ **The two refusals arrived at DIFFERENT LAYERS** — `schema` (Zod `-32602`, before
  dispatch) for the bad enum, `handler` for the unloadable font. This is
  [[feedback_a_gate_refusal_is_an_expected_outcome]] again; the gate records the
  distinction rather than flattening it.

🔴 **The first run failed on the GATE, not the tool — and hid something worse.**
`create_text` answers **prose** while `create_page` embeds JSON. But the same run would
have read plugin-API names (`fontName`, `textCase`) off a `JSON_REST_V1` export, whose
`filterFigmaNode` keeps only a REST `style` subset — **every field would have read
`null`, and null-before vs null-after PASSES VACUOUSLY.** ⭐ Same shape as
[[feedback_a_failed_curl_reuses_the_previous_body]]: a symmetric failure reads exactly
like agreement. ⛔ The fix is not correct field names — it is `assertReadChannelWorks`,
which proves the channel reports real values **before** any equality is trusted, plus a
separate plugin-snapshot witness for the six fields REST cannot carry.

⭐ **CC5 held on the FAILED run too** — page deleted, baseline restored. The `finally` is
the reason an aborted gate costs nothing.

⚠️ **`letterSpacing: -2 PERCENT` reads back through REST as `-0.64` px.** REST resolves it
to pixels; the plugin's own snapshot preserves `{unit: "PERCENT", value: -2}`, so the unit
survives the write. The gate compares the *resolved* value on that channel.

⏳ **NOT accepted.** Acceptance promotes `set_text_style`, `get_available_fonts` and
`check_fonts` → `stable`. ⛔ **Promotion moves the contract and therefore the server build,
so the gate must be RE-PINNED and RE-RUN on the promoted build** — R2.4 acceptance did
exactly this, and accepting a build the gate never saw is the defect that release spent
three phases closing.

### ✅ R2.5 Phase 3 — `set_text_style` is BUILT, 2026-08-19 (offline)

**169 tests green** (was 153), **56 tools / 55 plugin commands**, contract **stays `1.7.0`**,
six baselines replay at zero errors, `dist/` byte-deterministic, `verify-release.mjs` passed.
Record → [`docs/R2.5-TYPOGRAPHY.md`](docs/R2.5-TYPOGRAPHY.md).

- ✅ **3.2 held: validate-all-then-write from birth.** Two phases with a hard line between
  them — every parameter checked, all errors collected (not the first), every font loaded —
  then a write loop that **cannot reject**. ⛔ The guarantee lives in that loop being unable
  to fail, not in a comment saying so.
- ⭐ **Five source mutations, all killed. The one that matters is moving the refusal AFTER
  the write loop** — the literal F4 shape — which kills **5** tests only because every
  refusal case asserts the node is **byte-identical** afterwards and puts the invalid
  parameter **LAST**. A throw-only assertion would have survived it, exactly as
  [[feedback_asserting_it_threw_does_not_assert_when_it_threw]] predicts.
- ⛔ **It REFUSES an unloadable font; it never substitutes** — the one deliberate divergence
  from `set_text_content`. `setCharacters` answers a refused load by retyping the node to
  Inter (F2); repeating that here would change the document's font as a side effect of a
  call that asked for a size. The probe runs **inside the validation phase**, which is legal
  because a font load mutates the plugin session's cache and nothing in the file — the same
  reasoning that classifies `check_fonts` as a read.
- ⭐ **`fontSubstituted: false` is a PERMANENT declaration, not a state** — same shape as
  `coverage.budgetCancelsFetch`. The test asserts the key is *present*, not merely falsy,
  because an absence must never read as an answer.
- 🔴 **`figma.mixed` is a symbol and `JSON.stringify` renders a symbol as `undefined`, which
  DROPS THE KEY.** A mixed `fontName`/`fontSize`/`textCase` would have *vanished* from the
  reply and read as "not reported" rather than "this node holds more than one value". Every
  read-back maps it to the string `"MIXED"`, asserted through the same JSON round trip an
  MCP consumer receives.
- ⭐ **Existing faces are read with `getRangeAllFontNames`, never `fontName`.** On a mixed
  node `fontName` names **no face at all**, so "load the node's font" loads nothing and Figma
  then refuses the write for a font we never saw. And Figma refuses to modify **any**
  property of a text node whose fonts are unloaded — so even a bare alignment change loads
  them first, which is why an absent *document* font refuses the call.
- ⛔ **`fontFamily`/`fontStyle` are one decision** — half a pair is refused. `lineHeight`
  `AUTO` **refuses** an accompanying `value` rather than discarding it: a discarded value
  reads as an applied one.
- ⏳ **3.5 was DEFERRED to R2.6, on a contract fact rather than a preference.** `create_text`
  is `stable` (it falls through `getResultStability`) and `COMPATIBILITY-POLICY.md` grants
  free result fields only to `legacy`/`additive-preview` — so its new reply fields need a new
  `publicContractVersion`, and **R2.5 spent its bump in Phase 1**. R2.6 owns `1.8.0` and can
  fix the hardcoded Inter *and* the un-awaited `setCharacters` at `code.js:1790` in one
  change. ⭐ Shipping it here meant a `create_text` accepting a font it cannot report
  substituting — F2 on a brand-new surface.

⚠️ **CC6 debt, owed to the live gate:** the harness supplies the inventory and decides which
faces refuse to load, so offline proves the **order of operations**, the refusal policy and
the mixed-font semantics — not what real Figma refuses or when.

🔴 **Mixed-font unification STAYS fixture-only after the live gate.** The fork ships **no
range-font setter**, so a mixed node **cannot be authored by these tools**. The gate takes
an explicit `--mixed-node=<id>` and clones it onto the scratch page, unifying the *clone*
— the original is never written to. ⛔ It is an opt-in, not a search: the first run's
automatic `scan_text_nodes` over a real page **timed out**. None was named, so `wasMixed:
true` and the `"MIXED"` sentinel are proven offline and **unproven live**.

### ✅ Phase 2's CC6 debt is HALF CLOSED, live, 2026-08-19

Read-only, on channel `7tk4v5g7`, against the real machine:

- ✅ **10 293 faces / 2 273 families** — the fixture supplies **8**. 🔴 And the inventory is
  **above `get_available_fonts`'s own 5000 `limit` ceiling**, so the whole inventory cannot be
  returned in one call on this host: paging is **mandatory**, and the deterministic
  code-unit sort is load-bearing rather than theoretical.
- ✅ **`familyAvailable` earns its keep off-fixture.** `Inter/Blond` → `familyAvailable: true,
  available: false`; `Ghostly Absent Family` → `false/false`. Opposite fixes, as designed.
- ⭐ **Case sensitivity is real and silent:** `inter/Regular` (lowercase) reads as an **absent
  family**, identical to a font that does not exist. The documented near-miss trap, observed.
- ⭐ **Font load cost spreads 140×** — Inter 2 ms vs 42dot Sans **284 ms**. A font-unifying
  style write can cost ~300 ms in `loadFontAsync` alone, and `check_fonts`'s 50-pair cap is
  ~14 s worst case, which is why it is `standard` and not something weaker.
- 🔴 **NOT closed, and the full live gate did not close it either: `available` ≠ `loadable`
  did not reproduce.** Every *listed* face
  loaded and every unlisted one refused. The split is **justified** (Inter/Blond vs Ghostly
  prove the two fields answer different questions) but "listed yet unloadable" remains
  **fixture-only**. ⛔ Do not record Phase 2's CC6 debt as discharged.

⛔ **BOTH halves moved again** → `r2-server-1a74a40ba8b2` ↔ `r2-plugin-10787ea0bdd5`,
fingerprint `sha256:56ea2c94…`. Adopting HEAD needs a **DEV plugin re-run AND a server
respawn**. ⭐ The fingerprint moved *this* time only because two capability IDs were added —
R2.4 moved the server twice with fingerprint, schema and tool count all holding still, so
**`serverBuildId` is still the only pin that fails on every stale build**.

**Phase 3 followed** — `set_text_style` (3.1–3.5), and this is the brief it was held to. ⛔ **3.2 is non-negotiable:
validate-all-then-write from birth.** It is a twelve-field write, the exact shape F4 proves
broken in three shipped ops; any other construction mints a fourth in the release that pays
off the first three. ⛔ CC1 again. ⚠️ 3.5 touches `create_text`, which still has the deferred
un-awaited `setCharacters` at `code.js:1790`.

🔴 **The cut's highest-leverage finding:** `getResultStability`
(`scripts/contract-lib.mjs:267`) returns **`stable`** for any tool not named in
`ADDITIVE_PREVIEW_RESULTS`, and `compatibilityErrors()` refuses to weaken a level. This plan
adds ~10 tools — unlisted, they would be permanently frozen on day one, never having faced
a live gate. ⛔ Every new tool ships `additive-preview`; promotion is an acceptance act.

### ✅ R2.5 ACCEPTED — 2026-08-19, channel `ohipqdhg`

`get_available_fonts`, `check_fonts` and `set_text_style` promoted `additive-preview` →
`stable`, the entries **removed** from `ADDITIVE_PREVIEW_RESULTS` rather than commented
out. Gate re-pinned to `r2-server-c45214d7420b` and **re-run green on the promoted build**.
169/169 offline, six baselines at zero errors, `dist/` byte-deterministic across two
builds, `verify-release.mjs` passed. Scratch page `6031:9116` deleted in the `finally`,
baseline restored id-for-id (6 pages, current `0:1`).

- ⭐ **The promotion moved `serverBuildId` and NOTHING ELSE** — and that is the whole
  argument for CC4, now observed a third time. `serverBuildId` hashes
  `serverSource + contractPayload`, so a stability change moves it; `pluginBuildId` hashes
  plugin source and `capabilityFingerprint` hashes `{serverSchemaVersion, capabilityIds}`,
  neither of which a stability change touches. Against the pre-promotion build the plugin
  pin, fingerprint, schema and tool count **all four match**. ⛔ Re-derived by regenerating
  and reading the diff, not carried forward from R2.4.
- ✅ **Both judge-only assertions held again** on the accepted build: validate-all-then-write
  (bad enum **last** → refused at the **schema** layer, node byte-identical on *both* read
  channels) and refuse-never-substitute (`Ghostly Absent Family` → refused at the
  **handler** layer, `fontName` still `Inter/Bold`, size still 32). The two refusal layers
  stayed distinct rather than flattened.
- ✅ **3.3 mixed-font unification is CLOSED LIVE**, first time in the release —
  `--mixed-node=6030:9112`, cloned to `6031:9118` on the scratch page and unified *there*;
  the source was never written to. `wasMixed: true`, `fontUnified: true`, and
  `before.fontName` reads the string `"MIXED"` over the real transport. ⭐ `figma.mixed` is
  a **symbol**, `JSON.stringify` renders a symbol as `undefined`, and undefined **drops the
  key** — without the mapping the field would have vanished and read as "not reported"
  rather than "this node holds more than one value". An absence would have looked like an
  answer.
- 🔴 **The first acceptance run FAILED on the GATE again, not the tool.** `clone_node`
  answers `Cloned node "…" with **new** ID:` (`server.ts:1288`) while `create_text`,
  `create_frame` and `create_section` answer `with ID:` — **three** reply shapes in this
  surface counting `create_page`'s embedded JSON, and `callNodeId` was written against one.
  ⭐ **CC5 held on the failed run too** (page `6031:9113` deleted, baseline restored) — an
  aborted gate costs nothing, which is exactly why cleanup is not on the success path.
  ⭐ The fix matches the qualifier **explicitly** (`/with (?:new )?ID:/`) rather than
  loosening to `/ID:/`, so an unknown fourth shape fails **loudly** carrying the full reply
  text instead of capturing a wrong token and failing three calls later. ⛔ Fixing the gate
  does not move `serverBuildId` — the gate script is not hashed into it — so no second
  re-pin was owed.
- 🔴 **Two debts NOT discharged.** **F3 reachability** (the harness *injects* the refused
  character write; nothing makes real Figma refuse one on demand) and Phase 2's
  **`available` ≠ `loadable`**, which did not reproduce again — every listed face loaded,
  every unlisted one refused. ⚠️ The gate's own `stillOwed` lists only F3; the second is
  owed regardless and must not be read as discharged from a green run.
- ⛔ **Accepting R2.5 does not accept R2.** R2 acceptance is the last act of R2.7.

### ▶ R2.6 Phase 1 groundwork — 2026-08-20 (read before editing `code.js`)

⛔ **Scoped by the owner: Phase 1 lands and is gated ON ITS OWN, before Phase 2 opens.**
Nothing has been edited yet — this is the verified map, replacing the plan's stale offsets.

🔴 **The plan's line numbers were STALE by ~700 lines.** R2.5 inserted `set_text_style`,
`get_available_fonts` and `check_fonts` into `code.js` (now **7 781** lines), so every
offset in `TASKS.md` and the R2 plan pointed at unrelated code. Re-located by name:

| handler | plan said | **actual** | first write | second field throws |
| --- | --- | --- | --- | --- |
| `setAxisAlign` | 5816/5835 | **6522–6585** | **6556** `primaryAxisAlignItems` | 6563 enum · 6573 BASELINE×`layoutMode` |
| `setLayoutSizing` | 5896/5922 | **6588–6672** | **6636** `layoutSizingHorizontal` | 6642 enum · 6651 HUG×`type` · 6659 FILL×`parent.layoutMode` |
| `setItemSpacing` | 5970/5984 | **6675–6735** | **6710** `itemSpacing` | 6716 type · 6721 `layoutWrap`≠WRAP |

Dispatcher cases at `:396` / `:398` / `:400`. The F4 shape is **confirmed present** in all
three: validate field 1 → **write field 1** → validate field 2 → throw.

⭐ **Why the reorder is genuinely "pure" — assert this, don't assume it.** Every
second-field validation reads *node* state (`layoutMode`, `type`, `parent.layoutMode`,
`layoutWrap`), never the first field; and no first write can change what those reads
return. So hoisting the validations yields identical verdicts. ⛔ That property is the
whole licence for calling 1.1 a reordering rather than a rewrite — a test should pin it.

🔴 **Two count defects found, both live in the source/plan today:**

1. **`NON_ATOMIC_BATCH_OPERATIONS` under-reports what is proven.** It holds **9** entries
   and only **3** carry the `proven:` prefix — the three layout ops. But R2.4's live gate
   proved partial writes on `move_node` and `set_stroke_color` too ("the proven list grew
   3 → 5"); their reason strings were never updated. The map's prose is a release stale.
2. **The plan's restatement does not survive arithmetic.** It says *"five of nine proven
   becomes three of seven"*. Fixing all **three** layout ops leaves **9 − 3 = 6** declared
   and **5 − 3 = 2** proven. "Three of seven" only holds if *two* ops are fixed. ⛔ The
   correct restatement is **two of six** — `move_node` + `set_stroke_color`, both proven,
   both staying declared per 1.4. ⭐ This is the plan's own "restate the count rather than
   leaving the old one to rot" rule failing on the plan itself.

⛔ **No contract bump for Phase 1.** Strengthening `partialApplicationPossible` to false is
additive under `COMPATIBILITY-POLICY.md`, so the contract holds at `1.7.0` and R2.6 spends
its `1.8.0` on Phase 2's five new tools.

⛔ **The R2.4 live gate must change in the SAME commit** (`scripts/live-batch-gate.mjs`) —
it *observes* `set_item_spacing`'s partial application **as evidence**, so fixing these
makes the predecessor's own gate fail correctly. ⭐ A release that breaks the gate which
accepted the release before it is not a regression; failing to notice would be.

### ✅ R2.6 Phase 1 — the atomicity debt is PAID, 2026-08-20 (offline)

**169 tests green**, contract **held at `1.7.0`** (no bump, by design), six baselines
replaying, `dist/` byte-deterministic across two builds, `verify-release.mjs` passed.
⏳ NOT gated *at the time this paragraph was written* — ✅ **SUPERSEDED the same day: the
Phase 1 live gate PASSED on channel `kw7qggwv`**, recorded below under "R2.6 PHASE 1 LIVE
GATE PASSED".
🔴 **Corrected 2026-08-22 rather than deleted.** The bare "⏳ NOT gated" sat 40 lines above
its own contradiction, and it **misled a reader on 2026-08-22** who grepped `NOT gated`,
found this line, and concluded Phase 1 was ungated. ⭐ A status marker that was true when
written is indistinguishable from one that is still true — date them, or supersede them in
place.

✅ **The 6-vs-5 count is RECONCILED, not guessed.** The owner confirmed: **③ carries two
corrections** (mark `move_node`/`set_stroke_color` `proven:`, *and* restate the count), so
6 corrections = the 5 agreed items, nothing added or dropped. ⭐ The plan's Phase 1 only
ever had **four** numbered items; the fifth change-set item is CC6's mutation test, which
has no plan item at all.

- ✅ **The reorder is a reordering, and that was ASSERTED rather than assumed.** Every
  second-field validation reads *node* state (`layoutMode`, `type`, `parent.layoutMode`,
  `layoutWrap`) and never the sibling parameter, and no first write can change what those
  reads return. Validation **order** was preserved exactly, so every error message and every
  verdict is unchanged — only the write is suppressed.
- ✅ **`NON_ATOMIC_BATCH_OPERATIONS` is now six entries, two `proven:`** — in **both** copies
  (`src/talk_to_figma_mcp/batch-receipt.mjs` and `src/cursor_mcp_plugin/code.js`), plus the
  count prose in all four sites. ⭐ `tests/apply-batch.test.mjs`'s mirror test already
  enforced parity, so a half-landed edit could not have shipped quietly.
- ⭐ **The two survivors are a DIFFERENT SHAPE, and the map now says so.** The three that were
  fixed validated field 2 themselves and threw; `move_node` and `set_stroke_color` write both
  fields and the **Figma property setter** refuses the second. There is no validation to
  hoist — closing them means adding type checks to two `stable` tools, which is why 1.4
  keeps them declared and out of scope.
- ✅ **Five source mutations, all killed** (⛔ the SOURCE, never `dist/`): hoisting the write
  back above the validation in each of the three handlers (1 test each), re-adding a fixed op
  to the map (2 tests), and a one-sided edit to the mirrored map (2 tests). ⭐ **The control
  matters as much:** swapping two writes *inside* the write phase **survived** — correctly,
  because it is a genuine no-op. A suite that killed that one would have been over-fitted.
- ⭐ **The invalid field goes LAST and the node is asserted UNCHANGED.** A throw-only
  assertion survives moving the write back above the validation — it still throws, just
  after dirtying the document — which is exactly
  [[feedback_asserting_it_threw_does_not_assert_when_it_threw]].
- ⚠️ **The offline harness gained `refusePropertyWrite`.** After Phase 1 **no remaining
  declared op can demonstrate a real partial write offline**: the three that could are now
  atomic, and the two that stay proven are platform refusals the fake would happily accept.
  Without modelling that refusal the receipt test would have degraded into asserting the map
  says what the map says — a consistency check standing in for a correctness one.

### ✅ R2.6 PHASE 1 LIVE GATE PASSED — 2026-08-20, channel `kw7qggwv`

**One run, green on the first try.** `success: true`, `failure: null`, on the SYD copy.
⛔ **Phase 2 is now UNBLOCKED** — Phase 1 landed and gated alone, as the owner scoped it.

- ✅ **The pairing held live, checked against the TREE and not against `compatible`:** the
  Figma session reported `r2-plugin-65d716d57dbb` itself — the DEV re-run took. Server
  `r2-server-c45214d7420b`, both `1.7.0`, both fingerprint `sha256:05ac28c5…34d42`, 56 tools.
- ⭐ **The stale-`dist/` finding was closed by MEASUREMENT, not by a pin.** `dist/` was
  rebuilt before the run and came back **byte-identical**, and the gate's own
  `artifactHashes.server` (`c4019a01…`) equals that verified file — so the artifact exercised
  is provably the artifact checked. This is the only way past the Phase 1 finding that
  `serverBuildId` covers neither `batch-receipt.mjs` nor anything else outside `server.ts`.
- ✅ **THE INVERTED ASSERTION IS LIVE-PROVEN — the three layout ops are ATOMIC.**
  `set_item_spacing` failed (`layoutWrap` must be `WRAP`) and left the document **unchanged**:
  `gapBefore: 16` → `gapAfter: 16`, `partiallyApplied: false`, `atomic: true`. The receipt
  carries `partialApplicationPossible: false` and **no `partialApplicationReason` field at
  all** — the absence the gate now asserts, instead of the `undefined === undefined` vacuous
  pass a bare equality would have scored green.
- ⭐ **Read back by GEOMETRY, not by self-report:** no read tool surfaces `itemSpacing`, so the
  gate measures the gap between the two auto-layout children from `absoluteBoundingBox`.
- ✅ **The two survivors stayed proven AND named** — no silent narrowing from three probes to
  two: `move_node` x `0 → 120` then the platform refused a non-numeric `y`;
  `set_stroke_color` `strokes null → red SOLID` then it refused a non-numeric `strokeWeight`.
  Both `partiallyApplied: true`. ⭐ **This is what makes the gate a correctness check** — it
  fails the fix and confirms the untouched pair in the same batch, so "two of six" is observed
  rather than restated.
- ✅ **Refusals arrived in BOTH shapes again:** duplicate `id` → `layer: "handler"` (error
  result); disallowed `op` → `layer: "schema"`, thrown `-32602`. The trap that scored correct
  behaviour as FAIL three times stayed closed.
- ✅ **`prevalidateOnly` wrote nothing to real SYD content** — the dry run resolved a
  `delete_node` against the real TEXT node `6030:9112` ("testeteste") on page `0:1` *1-Capa*
  and skipped it; `realNodesUnchangedAfterDryRun: true`. Destructive scope observed at zero
  risk, which is the whole reason that batch exists.
- ✅ `onError:"stop"` → `refused_prevalidation`, **wrote nothing**; `onError:"continue"`
  applied the other two. Chunked progress 0→33→67→100, reached complete.
- ✅ **Clamp regression still closed:** `chunkPauseMs=5000` + `timeBudgetMs=1000` → unclamped
  would be 10 000 ms, actual **1011 ms**, `partial`, 5 done / 10 skipped, **and** 4 progress
  frames. Both halves true at once.
- ✅ **3.2 re-measured on real content:** 2136 ms observed vs 2000 ms predicted over 2 gaps.
  Every op succeeded at `chunkPauseMs=0`, so the pause bought nothing here — the `0` default
  stays earned.
- ✅ **Cleanup discharged in the `finally`:** scratch page `6035:2` deleted, 6 pages → 6,
  current page `0:1` restored, `cleanupError: null`.
- ⚠️ **`pagesAfterCleanup` records only `pageCount` + `currentPageId`, no `pages` array** — a
  set-difference against it reports *every* page as lost. A symmetric absence reading as a
  result, [[feedback_a_failed_curl_reuses_the_previous_body]]. Read the shape before alarming.
- ⛔ **Two debts remain UNDISCHARGED by this pass:** F3 reachability (the harness still injects
  the refused write) and Phase 2's `available` ≠ `loadable`. ⚠️ `operation_not_allowed` is
  confirmed **unreachable through this transport** — the tool's inline `z.enum` rejects first,
  so the plugin's own allowlist never answers a live consumer.

### ✅ R2.6 Phase 2 item 2.0 — `create_text` joins the typography surface, 2026-08-21 (offline)

**187 tests green** (was 169), contract **`1.7.0` → `1.8.0`** — the bump R2.5 deferred this
item for. `dist/` byte-identical across three builds, six baselines replaying,
`verify-release` passed. ✅ **GATED 2026-08-22, channel `7l9ymck4`** — the typography live
gate PASSED on the first run, exit 0; §6–9 proved the create path against real Figma, every
refusal leaving the page's child count unchanged. ⛔ This does **not** RE-gate Phase 1's
atomicity work — that is `live-batch-gate.mjs`, which **PASSED on `kw7qggwv` 2026-08-20**
and is stale only *now*, deliberately not re-pinned after 2.0 moved every pin.

- 🔴 **The un-awaited `setCharacters` was worse than "returns before the text is set", and
  the fixture proved it.** The reply read `textNode.characters` while the write was still a
  pending microtask and reported **`""` for text it had in fact written** — and *only on
  the path without `parentId`*, because that path's own `await figma.getNodeByIdAsync`
  let the microtask land first. **The same tool told the truth or lied depending on an
  unrelated parameter.** ⭐ The parented case **passed before the fix** — a suite that had
  only tested the obvious path would have reported green over it.
- ⭐ **And the failure escaped the request entirely.** With an unloadable font, the
  un-awaited call surfaced as an **unhandledRejection after the command had already
  answered** — the test runner reported "asynchronous activity after the test ended". No
  caller can catch that; it is not a wrong field, it is an error with nowhere to go.
- ⛔ **Validate-all-then-CREATE, which is a different shape from validate-all-then-write.**
  On a mutation tool F4 leaves a half-written node; on a create tool it leaves **a node
  that exists at all**. So the parent is resolved and the font loaded **before**
  `figma.createText()`, and every refusal test counts the page's children — a `rejects`
  assertion alone passes happily over an orphaned empty text node.
- ⭐ **The twelve-parameter validator is now ONE implementation** (`textStyleRequestedFont`
  + `textStyleCollectWrites`), shared by `set_text_style` and `create_text`. A second copy
  is how two surfaces start disagreeing about what is valid — the `set_fill_color`
  divergence R2.4's gate caught. `set_text_style`'s 16 tests stayed green across the
  extraction, which is what makes it a refactor rather than a rewrite.
- ⛔ **`fontWeight` × `fontFamily`/`fontStyle` is a REFUSAL** — two ways to name one face,
  so honouring either discards the other, and a discarded value reads as an applied one.
  ⚠️ **This forced a server change**: `create_text` used to send `fontWeight: fontWeight || 400`,
  so a default applied server-side reached the handler **indistinguishable from a caller's
  own value** and "was it supplied?" had no answer. Behaviour is unchanged; the plugin
  applies the same 400.
- 🔴 **Two more defects found in the same handler, both silent-substitution shaped:**
  `parseFloat(fontColor.a) || 1` turned a legitimate **`alpha: 0`** into a fully opaque
  fill, and `fontSize: 0` became 14. Both are now refused or preserved.
- 🔴 **The offline fixture could not see the `fontSize` default at all.** The harness
  created text at **14** — the same number `create_text` writes when the caller omits
  `fontSize` — so deleting the default write scored **green**. Real Figma hands back
  **12**; the harness now does too, and the mutation dies.
- ✅ **Five source mutations, all killed, plus a control that survived** (⛔ the SOURCE,
  never `dist/`): create-before-validate, the un-awaited write, the collision check
  removed, substitute-instead-of-refuse, and the `fontSize` default deleted. ⭐ The
  control — swapping the `x` and `y` writes inside the write phase — **survived
  correctly**; a suite that killed it would be over-fitted to write order.
- ⚠️ **The reply keeps its prose first line byte-identical** (`Created text "…" with ID: …`)
  and appends the JSON receipt on the next line. Three gates parse that line, and
  `clone_node`'s `with new ID:` already cost this project a gate run.

### 🔴 Item 2.0's finding — the bump this change owed is NOT mechanically enforced

Regenerating the contract with the widened `create_text` **at `1.7.0`** produced **zero**
`compatibilityErrors`. The snapshot records input schemas, `direction`, `scope`,
`timeoutClass` and `resultStability` — **never result shapes** — so *new fields on a
`stable` result* are invisible to every check in `bun run verify`.

- ⛔ `COMPATIBILITY-POLICY.md:47` says this in one line ("Changing a field's meaning …
  passes every mechanical check, so it must be caught in review"). It was true here in the
  additive direction too: only review stood between this and a silent ship at `1.7.0`.
- ⭐ Same family as [[feedback_a_fingerprint_only_covers_what_it_hashes]] and
  [[feedback_consistency_gate_is_not_a_correctness_gate]] — a green gate is evidence about
  **its inputs**, and this gate's inputs never included a reply.

### ⛔ Editing a gate is not exercising it — now a test, 2026-08-21

`tests/live-gate-pins.test.mjs` asserts every `scripts/live-*.mjs` either pins **this**
build or is **declared** as belonging to an earlier release. It exists because the R2.4
gate was unrunnable from `e02d1b2` and nothing noticed for two commits.

- ⭐ **Both directions are enforced, and that was mutation-proven rather than asserted:**
  an undeclared gate whose pins drift fails, **and** a declared gate whose pins start
  matching again fails. The second mutation only died once **all four** pins were moved —
  a three-of-four re-pin correctly survived, because the gate genuinely still did not
  match the tree.
- 🔴 **`live-batch-gate.mjs` is declared stale on purpose.** It PASSED on `kw7qggwv` at
  `1.7.0`; item 2.0 moved every pin. ⛔ It is **not** re-pinned here — a gate re-pinned
  without being re-run is exactly the defect this test exists to catch.

### 🔴 R2.6 Phase 1's two findings — both bigger than the change set

🔴 **`serverBuildId` does NOT cover `batch-receipt.mjs`, and this was MEASURED.** It is
`sha256(server.ts + contractPayload)` — `SERVER_PATH` in `scripts/contract-lib.mjs:11` is
`server.ts` **alone**. A whole semantic change to `batch-receipt.mjs`, regenerated on its
own, produced **byte-identical** runtime metadata: server build ID, plugin build ID,
fingerprint, schema and tool count **all four held still**.

- ⛔ **This contradicts CC4 as written.** "`serverBuildId` is the only pin that fails on every
  stale build" is true only for changes that reach `server.ts` or the contract. A server
  change outside those two is invisible to *every* pin simultaneously.
- ⛔ Phase 1 is caught only **by accident**, because it also moved `code.js` and therefore
  `pluginBuildId`. A Phase that touched only server modules would ship a stale
  `dist/server.js` past a fully green preflight.
- ⭐ Same shape as [[feedback_a_fingerprint_only_covers_what_it_hashes]], one layer out: read
  the hash's **inputs** before trusting it, and never infer freshness from a green pin.

🔴 **The R2.4 gate was ALREADY unrunnable, and had been since `e02d1b2`.** It carried
fingerprint `sha256:a6ca7f4a…` against a tree at `sha256:05ac28c5…`, so it would have failed
at `assertRuntime` **before reaching a single check**. Nothing noticed because the gate was
*edited* in that commit and never *re-run* on it. ⭐ Editing a gate is not exercising it —
the same class as the finding that filed a defect fixed two commits earlier.

⛔ **The inverted assertion could not be a bare equality.** `partialApplicationReason` is only
written when the possibility is declared, so comparing it to the removed map entry leaves
`undefined === undefined` — a **vacuous pass**, with `assert.equal` reporting green over an
assertion that had stopped asking anything. The gate now asserts the **absence** of the field
and the absence of the map key. ⭐ Same shape as
[[feedback_a_failed_curl_reuses_the_previous_body]]: a symmetric absence reads exactly like
agreement. ⚠️ And the surviving partial-application OR now **names** `move_node` /
`set_stroke_color` rather than silently narrowing from three probes to two.

### ⛔ R3 variable-write is still OPEN

`apply_batch` will **never** close it — it is mutate-only over *node* IDs, and variables aren't nodes. Its Phase 0 is discharged, so the entry point is **Phase 1.1**.

⛔ **Figma defines writing `""` as delete.** Not a bug to route around — a semantic you must respect.

## 📚 Detailed history

⚠️ **This repository is PUBLIC, so the full internal history is deliberately NOT kept here.** This file carries the sanitized technical state only.

The complete record lives in the private `ai-synthesizer` workspace at `knowledge/projects/_memory/project_talk_to_figma_fork_upgrade.md` — session-by-session, including the parts that must not be published (hosting account details, client agreements, internal IDs). Folded there 2026-08-17.
