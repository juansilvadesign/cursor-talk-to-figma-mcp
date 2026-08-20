# R2 Typography / Layout / Visual Plan — the remaining half of R2 (R2.5 · R2.6 · R2.7)

> **Status 2026-08-18: CUT. R2.5 Phase 1 is COMPLETE and offline-green.** This plan owns everything Release R2 still owes
> after R2.4 was accepted. ⛔ **Accepting R2.4 did not accept R2** — stated in `TASKS.md`,
> `MEMORY.md`, [`BATCH-CONTRACT-PLAN.md`](BATCH-CONTRACT-PLAN.md) and
> [`R2.4-BATCH-CONTRACT.md`](R2.4-BATCH-CONTRACT.md). **This document is the work that
> sentence refers to.**
>
> ⛔ **Pair at cut time** — verified live on channel `yba88v0x`, read from
> `get_runtime_info` and not from a doc: schema `1.6.0`,
> **`r2-server-5ac4bcd1a2a5`** ↔ **`r2-plugin-53a1fa676d6a`**, fingerprint
> `sha256:d39aefef…ca6289`, **53 tools / 52 plugin commands**, compatibility
> `compatible`, zero issues. The running session was already on the accepted build, so
> **no server respawn was owed at cut time.** ⭐ All four pins asserted, not just the
> fingerprint — each is blind to exactly what the others catch.
>
> Cut through the interview gate before any design was written — the same sequence that
> closed the R2.4 batch boundary.

---

## The four decisions, and why

### D1 — Three sub-releases, defect-first

**R2.5 typography → R2.6 layout → R2.7 visuals & assets.** One narrow scope, one live
gate, one contract bump and one acceptance doc each, matching the R2.0 → R2.4 cadence.

Defect-first follows R2.0's own precedent — *"taken first because they are R1-derived
cost/safety defects, not new capability."* Typography leads because it holds **both**
outstanding text defects and because the bounded font preflight is the availability
signal every text write depends on. That is the R2.1 shape exactly: there, *"the real
defect was the missing cost signal, not the budget."*

### D2 — Ranges are internal, never public

The public typography surface stays **node-level**. No `start` / `end` offsets appear in
any schema. Internally the handlers already walk character ranges, and that machinery is
what makes mixed-font nodes writable — see F1 below, where the fix is a **deletion**.

⭐ This is the smallest surface that *closes* the defect rather than routing around it. The
rejected alternative — refusing mixed-font nodes with a typed limitation — would have been
honest but would have left a shipped crash in place as documentation.

### D3 — New tools ship standalone; `apply_batch`'s allowlist stays at 15

`apply_batch` is `stable`, i.e. frozen: a receipt-shape change now needs a new
`publicContractVersion` and the walk-back is breaking. Extending the allowlist is deferred
to a separate step **after R2 acceptance**, when the new tools have stopped moving and each
can be given its own atomicity classification and `partialApplicationPossible` reason.

⭐ This costs nothing in contract terms. The R2.4 boundary decision's reason (4) already
established that new ops arrive as an additive `op` kind with **no envelope change** — so
the option is preserved by construction, not by promise.

### D4 — Scope: everything is in, including the two escape hatches

All four optional items were taken: **generic SVG import**, **fixing image crop** rather
than documenting it as a limitation, **paying down the atomicity debt** on the three
proven write-then-throw layout ops, and **fixing `create_text`'s hardcoded Inter**.

⭐ **SVG import does not reopen the batch boundary.** It was flagged at interview as a
create colliding with R2.4's mutate-only rule; under D3 that collision dissolves.
`create_node_from_svg` is a **standalone tool**, sitting beside the six creates the fork
already ships (`create_frame`, `create_text`, `create_rectangle`, `create_section`,
`create_page`, `create_component_instance`). `apply_batch` remains mutate-only over
existing node IDs and is untouched.

⚠️ **What does still apply is idempotency.** Re-running an SVG import duplicates the node.
That is true of all six existing creates, the generic idempotency decision is deferred
in `TASKS.md`, and this plan does **not** close it. Recorded here so the deferral is
stated rather than silent.

---

## Findings from the source audit

Read out of `code.js` at cut time. ⚠️ **Confidence is marked per finding and the marks are
load-bearing** — a finding is not evidence, and one already outlived its defect once.

### 🔴 F1 — The mixed-font crash is one redundant line, and it breaks single *and* batch

**Confidence: source-read, mechanism certain, not yet reproduced.**

```js
// code.js:3839-3842  (setTextContent)
try {
  await figma.loadFontAsync(node.fontName);   // ⛔ throws on a mixed node
  await setCharacters(node, text);            // ⭐ already handles figma.mixed, four ways
```

`node.fontName` is `figma.mixed` — a unique symbol — whenever a TEXT node carries more than
one font. `loadFontAsync` cannot unwrap a symbol, which is the reported
`loadFontAsync: Cannot unwrap symbol` verbatim.

⭐ **The pre-load at `:3840` does no work the next line does not already do.** `setCharacters`
(`:3891`) tests `node.fontName === figma.mixed` at `:3897` and branches four ways —
`prevail`, `strict`, `experimental`, and a default that reads `getRangeFontName(0, 1)` — and
loads the font itself in every branch, including the non-mixed one at `:3925`. **The fix is
to delete `:3840`.**

⭐ **One deletion fixes both tools.** `set_multiple_text_contents` does not have its own font
path: each replacement calls `setTextContent` (`code.js:~4636`, *"Use the existing
setTextContent function to handle font loading"*). Single and batch share the one defect
site, which is precisely what the `TASKS.md` item — *"fix mixed-font single/batch content
mutation"* — describes.

### 🔴 F2 — `setCharacters` substitutes Inter silently

**Confidence: source-read, certain.**

On any font-load failure `setCharacters` catches, emits a `console.warn`, then does
`await figma.loadFontAsync(fallbackFont)` and `node.fontName = fallbackFont`
(`:3930-3936`). **The document's font is changed and no reply field says so.** The console
is not a contract surface; a caller learns nothing.

### ⚠️ F3 — A skipped text write can report success

**Confidence: source-read HYPOTHESIS. ⛔ Must be proven by fixture before it is "fixed".**

`setCharacters` returns `false` when `node.characters = characters` throws (`:3944`).
`setTextContent` **discards that return** (`:3842`) and returns a success object.
`setMultipleTextContents` then marks the entry `success: true` because nothing threw — and
Phase 4's honest `succeeded` / `failed` / `total` aggregate is computed from those flags.

⭐ If real, this is R2.4 audit finding (1) — *"the aggregate lies"* — reappearing one layer
**below** the aggregate that was fixed to stop lying. The window looks narrow: after the
fallback path Inter is loaded and the assignment normally succeeds. ⛔ **If the window turns
out to be unreachable, record it as unreachable.** Do not report a fix for a defect that was
never reachable.

### ✅ F4 — All three non-atomic layout ops have one identical shape

**Confidence: source-read AND already observed live in the R2.4 gate. Certain.**

Every one validates its first field, **writes it**, then validates the second and throws:

| Handler | Writes first field | Then throws validating the second |
| --- | --- | --- |
| `setAxisAlign` (`:5781`) | `:5816` `primaryAxisAlignItems` | `:5835` — `BASELINE` requires `layoutMode === "HORIZONTAL"` |
| `setLayoutSizing` (`:5847`) | `:5896` `layoutSizingHorizontal` | `:5922` — `FILL` requires an auto-layout parent |
| `setItemSpacing` (`:5934`) | `:5970` `itemSpacing` | `:5984` — `counterAxisSpacing` requires `layoutWrap === "WRAP"` |

⭐ **The fix is a pure reordering** — hoist every validation above every assignment. No API
change, no new capability. The cross-field checks read node state the handler has already
fetched, so nothing new is needed to run them early.

### 🔴 F5 — `CROP` is accepted and then never implemented

**Confidence: source-read, certain.**

`setImageFill` allows `CROP` in `validScaleModes` (`:1950`) and writes
`node.fills = [{ type: "IMAGE", imageHash, scaleMode }]` (`:1977`). **`imageTransform`
appears zero times in the entire plugin.** Figma drives `CROP` from that matrix; with none
supplied it applies a default, which is exactly the observed *"normalizes differently"*.
The schema advertises a mode the handler cannot deliver.

### 🔴 F6 — Every new tool is born frozen unless it is listed

**Confidence: source-read, certain. This is the highest-leverage finding in the audit.**

`getResultStability` (`scripts/contract-lib.mjs:267`) falls through to **`stable`** for
anything not named in `ADDITIVE_PREVIEW_RESULTS` (`:74`). `MEMORY.md` already records this
biting once — *"`resultStability: "stable"` on these two tools is a DEFAULT, not a
decision"* — and `compatibilityErrors()` rejects weakening a level by name, so it cannot be
walked back.

⛔ **This plan adds roughly ten tools.** Shipping them unlisted would freeze ten result
shapes that have never faced a live gate, in one release, permanently. See CC1.

### ⚠️ F7 — Six hand-maintained maps scale with tool count

**Confidence: source-read, certain.**

Each new tool must be registered in `scripts/contract-lib.mjs`: `HEAVY_READ_TOOLS` (`:39`),
`HEAVY_BATCH_TOOLS` (`:72`), `ADDITIVE_PREVIEW_RESULTS` (`:74`), `READ_TOOLS` (`:109`),
`TOOL_SCOPES` (`:130`), `SPECIAL_PROGRESS` (`:168`).

⭐ `SPECIAL_PROGRESS` is the map that produced **Finding 4** — *"the public contract asserts
progress that never happens"*. It is hand-maintained, so the drift risk is per-tool and this
plan multiplies it by ten. `tests/progress-declaration.test.mjs` is the existing guard;
every new tool must be covered by it.

---

## R2.5 — Typography

**Contract `1.6.0` → `1.7.0`.**

### Phase 1 — the two text defects — ✅ COMPLETE 2026-08-18

⚠️ **This heading used to read "no new tools, no schema change" and the second half was
wrong.** 1.4 adds fields to `set_text_content`, whose `resultStability` is `stable`, and
`COMPATIBILITY-POLICY.md` grants free result fields only to `legacy` and
`additive-preview`. **F6 bit inside Phase 1**, before a single new tool existed. The
contract moved `1.6.0` → **`1.7.0`**.

- [x] **1.1 Deleted the unguarded pre-load.** Per F1. Replaced with a comment naming why
      it must not come back.
- [x] **1.2 `tests/mixed-font-text.test.mjs` — 5 cases, and it FAILED FIRST.** Before the
      change: `Error setting text content: Cannot unwrap symbol`, the reported defect
      verbatim, reproduced offline for the first time in four releases.
      ⭐ **Mutation-tested twice.** The pre-fix state is the first mutant. The second was a
      *lazy* fix — catch the error and retype the node in the fallback font — which the
      suite also kills, because the test asserts the **first character's real font** was
      loaded, not merely that the call returned.
- [x] **1.3 The batch path is covered by the same fixture**, and it is the case that
      actually regressed: `set_multiple_text_contents` calls `setTextContent` per
      replacement, so both tools failed and both now pass.
- [x] **1.4 `fontSubstituted` / `requestedFont` / `appliedFont`** on `set_text_content`.
      ⭐ Reported as `false` on the ordinary path too — an absent field cannot be told apart
      from one the writer forgot, the same reasoning that made `complete` and `present`
      explicit in the read contract.
- [x] **1.5 F3 is CONFIRMED as a reporting defect, and fixed.** Given a refused write, the
      old code returned a success reply and the batch reported `succeeded: 1` /
      `all_succeeded` over an unchanged document. `setTextContent` now honours
      `setCharacters`' `false` return and throws, which fixes **both** layers at once — the
      batch marks the entry failed because it marks on a throw.
      ⛔ **REACHABILITY IS STILL UNPROVEN.** The refusal is injected by the harness, so by
      the standing rule the trigger is exactly the part this does not establish. What is
      proven is the *reporting*: given a refusal, the tools lied. Settle reachability at
      the live gate. The fix stands on its own — discarding a callee's documented failure
      return is a defect regardless of how often it fires.

**Offline result:** 125 → **136 tests**, all green. Contract regenerated at `1.7.0`,
`dist/` rebuilt, R2.4 frozen as the **6th** baseline, all six replay at zero errors,
`verify-release.mjs` passed.

⭐ **Why this survived four releases, and it is not "nobody wrote the test":** the harness
could not express the defect. `loadFontAsync` was `async () => undefined` — it accepted a
symbol happily — and `getRangeFontName` returned the node's own `fontName`. No mixed-font
node could exist in a fixture, so the suite was not silent on this case, it was
**structurally unable to reach it**. The harness now models `figma.mixed`, per-range fonts,
a `loadFontAsync` that refuses a symbol the way Figma does, unavailable fonts, and refused
character writes.

⛔ **The pair moved on BOTH sides this time** — see Runtime identity below. That is the
opposite of the R2.4 promotion step, and it is why the answer is re-derived per release
rather than carried forward.

### Runtime identity after Phase 1

| | R2.4 ACCEPTED | R2.5 Phase 1 (this build) |
| --- | --- | --- |
| Contract / schema / plugin API | `1.6.0` | **`1.7.0`** |
| Server | `r2-server-5ac4bcd1a2a5` | **`r2-server-194bc059487c`** |
| Plugin | `r2-plugin-53a1fa676d6a` | **`r2-plugin-75048983ede3`** |
| Fingerprint | `sha256:d39aefef…ca6289` | **`sha256:09175c89…`** |
| Tools / plugin commands | 53 / 52 | 53 / 52 — unchanged |

⛔ **Adopting this build needs a DEV plugin re-run AND a server respawn.** Both halves
moved.

⭐ **Observed, not assumed:** with the tree at `1.7.0`, the session still open on channel
`yba88v0x` answered `get_runtime_info` with the **old** pair — `5ac4bcd1a2a5` /
`53a1fa676d6a`, schema `1.6.0` — and reported `compatibility: "compatible"`. Both running
halves still hold their pre-rebuild bundles, so a rebuild reaches neither. ⚠️ And note what
`compatible` meant there: **the two running halves match each other**, not that either
matches the source tree. It is a pairing check, exactly as `COMPATIBILITY-POLICY.md` says
— and it will answer `compatible` all day on a build that is two releases stale.

### Phase 2 — bounded font inventory and preflight — ✅ COMPLETE 2026-08-18 (offline)

**153 tests green** (was 136), **55 tools / 54 plugin commands** (was 53 / 52), contract stays
**`1.7.0`** — R2.5 already spent its one bump in Phase 1, and these two tools are additive
inside the same in-flight release, so only the build IDs and the fingerprint move. All six
baselines replay at zero errors, `dist/` rebuilt and byte-deterministic across two runs,
`verify-release.mjs` passed.

- [x] **2.1 `get_available_fonts`** over `figma.listAvailableFontsAsync()` — which appeared
      **zero times** in the source before this phase. Bounded as R2.0 bounded
      `get_node_variables`: `limit` (default 1000, ceiling 5000) / `offset`, whole-inventory
      `fontCount` **and** `familyCount` that survive both the window and the filter, a
      separate `matchCount` for the filter, `complete: false` on any truncation.
      - ⭐ **A `family` filter was added beyond the plan.** Without one, answering *"does this
        machine have Poppins?"* means paging the entire inventory — the cost signal this
        phase exists to remove. It is an exact, case-sensitive match, and a miss says so in
        `limitations`, because `fonts: []` alone cannot distinguish a misspelling from an
        absent family.
      - ⭐ **Ordering is a deterministic family-then-style code-unit sort.** Figma does not
        document `listAvailableFontsAsync()`'s order, so `offset` paging would otherwise be
        repeatable only by luck. ⛔ Compared with plain `<`, never `localeCompare` — that is
        locale-dependent and would page one machine's inventory differently from another's,
        a defect that only appears abroad.
      - ⭐ **Absent counts are `null`, never `0`.** A `0` here reads as *"this machine has no
        fonts installed"* — a real finding rather than the absence of one, which `code.js`
        already carries a comment about for another count.
- [x] **2.2 Declared `heavy_read`.** Cost scales with the machine's font set, which the
      caller cannot bound from outside — the criterion that put `get_document_info` on the
      heavy budget.
      - ⛔ **`check_fonts` is deliberately NOT `heavy_read`.** Its cost scales with the
        caller's own capped pair list, and `TIMEOUT_RANK`'s own comment says reusing
        `heavy_read` for an argument-scaled tool *"would make the contract lie about why the
        budget is large"*. It ships **`standard`**, the weakest claim that can be true;
        raising a budget after a live gate is the safe direction, lowering one is breaking.
- [x] **2.3 `check_fonts`** — `{family, style}` pairs, capped at **50** per call, each probed
      with a **real `figma.loadFontAsync`** rather than a list lookup.
      - ⭐ **`available` and `loadable` are two fields because they can disagree.** A face can
        be listed and still refuse to load, and `setCharacters` answers that refusal by
        substituting Inter silently — F2. A single field would have answered `true` and let
        the substitution happen anyway, which is a *consistency* check standing in for a
        *correctness* check.
      - ⭐ **`familyAvailable` separates a misspelled style from an absent family** — *"Inter
        has no Blond"* versus *"this machine has no Ghost"*. Opposite fixes; one field cannot
        carry both.
      - ⭐ **Validate-all-before-probe-any**, borrowed from 3.2's rule. Nothing is written, so
        there is no partial document state — but a list that fails on its ninth entry after
        loading eight fonts still charges the caller for work it then refuses to report.
      - ⭐ **An exhausted budget SKIPS.** Unprobed pairs are absent from `results` and counted
        in `skippedCount`; emitting them as `available: false` would report a fact the tool
        never established, and the caller would swap a font that was on the machine all along.

⚠️ **Where the plan was wrong: `timeBudgetMs` cannot bound the fetch.**
`listAvailableFontsAsync()` takes no cancellation signal and is a single await, so a budget
can only bound **the reply** — the call is *abandoned*, not stopped, and is still running when
the reply returns. Rather than ship a field that quietly means less than every other
`timeBudgetMs` in this contract, the reply carries `coverage.budgetCancelsFetch: false` as a
permanent declaration alongside `budgetExhausted`, plus a `limitations` entry naming it. ⛔ On
`check_fonts` the inventory fetch is deliberately **un**budgeted for the same reason in
reverse: a truncated inventory would turn every `available` into a false negative, which is a
far worse answer than a slow one. The budget there governs the load probes, checked *between*
them since an individual `loadFontAsync` cannot be cancelled either.

⭐ **CC1 held, and it was the whole point of doing this phase first.** Both tools are in
`ADDITIVE_PREVIEW_RESULTS` in the same change that registers them. Six hand-maintained maps
updated per F7, including a **new `font_inventory` scope** — `TOOL_SCOPES` falls through to
`"node"`, which would have been wrong and silent for two tools that never touch a node.

⭐ **CC2 held both ways.** `check_fonts` declares `per_font` and emits it, in the same change.
⛔ **`get_available_fonts` declares `"none"` on purpose** — one un-cancellable await plus an
in-memory sort has no point between them to report from, and declaring progress there would
have minted Finding 4 a third time. `tests/progress-declaration.test.mjs` covers both.

⭐ **Mutation-tested against the SOURCE, five ways, all killed:** removing the sort (4 tests),
collapsing `available` into `loadable` (3), moving validation into the probe loop (1),
returning `0` instead of `null` (2), and making `fontCount` describe the window (5). ⛔ The
validation mutation is the one that matters — a throw-only assertion would have **survived**
it, so the test asserts that no font was loaded before the throw, not merely that it threw.

⚠️ **CC6, owed to the live gate:** the fixture supplies the inventory, so offline these tests
prove the window, the filter, the sort and the available-vs-loadable split — **not** what a
real machine returns, nor how large it is. The 3.66 MB defect this phase is bounded against
has never been reproduced here. Same standing debt as F3's reachability.

### Runtime identity after Phase 2

| | R2.5 Phase 1 | R2.5 Phase 2 (this build) |
| --- | --- | --- |
| Contract / schema / plugin API | `1.7.0` | `1.7.0` — unchanged |
| Server | `r2-server-194bc059487c` | **`r2-server-1a74a40ba8b2`** |
| Plugin | `r2-plugin-75048983ede3` | **`r2-plugin-10787ea0bdd5`** |
| Fingerprint | `sha256:09175c89…` | **`sha256:56ea2c94…`** |
| Tools / plugin commands | 53 / 52 | **55 / 54** |

⛔ **Adopting this build needs a DEV plugin re-run AND a server respawn.** Both halves moved
again — the same answer as Phase 1, but re-derived rather than carried forward, because it
flipped on three consecutive steps before this one.

⭐ **Note which pins would have caught a stale build this time.** The fingerprint hashes
`{serverSchemaVersion, capabilityIds}` and two new capability IDs moved it, so on *this* step
the fingerprint works. That is luck, not a property: R2.4 moved the server twice with the
fingerprint, schema and tool count all holding still. **`serverBuildId` remains the only pin
that fails on every stale build**, and CC4 still requires pinning it.

### Phase 3 — the typography write surface

> **✅ DONE 2026-08-19 (offline), 3.1–3.4. ⏳ 3.5 DEFERRED to R2.6.** 169 tests green,
> **56 tools / 55 plugin commands**, contract stays `1.7.0`, five source mutations all
> killed, `dist/` byte-deterministic, `verify-release.mjs` passed. Record:
> [`R2.5-TYPOGRAPHY.md`](R2.5-TYPOGRAPHY.md).
>
> ⛔ **3.5 could not ship here, and the collision is a contract fact rather than a
> preference.** `create_text` is `stable` — it falls through `getResultStability` — and
> `COMPATIBILITY-POLICY.md` grants free result fields only to `legacy` /
> `additive-preview`. New reply fields therefore need a new `publicContractVersion`, and
> **R2.5 already spent its bump in Phase 1** (which was not contract-neutral, contrary to
> how this plan first described it). R2.6 owns `1.8.0`, so 3.5 moves there and can fix
> the hardcoded Inter *and* the deferred un-awaited `setCharacters` at `code.js:1790` in
> one change. ⭐ Shipping it here would have meant a `create_text` that accepts a font it
> cannot report substituting — F2 on a brand-new surface.

- [x] **3.1 `set_text_style(nodeId, …)`** — `fontFamily`, `fontStyle`, `fontSize`,
      `lineHeight`, `letterSpacing`, `textCase`, `textDecoration`, `textAlignHorizontal`,
      `textAlignVertical`, `paragraphSpacing`, `paragraphIndent`, `textAutoResize`. All
      optional; node-level per **D2**.
- [x] **3.2 Validate-all-then-write from birth.** ✅ Two phases with a hard line between
      them; the write loop cannot reject because every value is validated and every font
      loaded first. ⭐ Mutation-tested: moving the refusal after the write loop kills
      **5** tests. A throw-only assertion would have survived it, so every refusal case
      asserts the node is byte-identical and puts the invalid parameter **last**. ⛔ Non-negotiable. This tool is a
      twelve-field write — the exact shape of the three ops F4 proves broken. Building it
      any other way is knowingly minting a fourth, in the same release that pays off the
      first three.
- [x] **3.3 Mixed-font semantics are declared, not implied.** ✅ Plus two facts the plan
      did not name: unification **discards the per-character runs** (stated in
      `limitations`), and `fontFamily`/`fontStyle` are refused as **half a pair**.
      ⛔ `figma.mixed` is a symbol and `JSON.stringify` drops the key, so every read-back
      maps it to the string `"MIXED"` — otherwise a mixed field vanishes and reads as
      "not reported". ⚠️ Live reachability is **not** guaranteed: the fork ships no
      range-font setter, so a mixed node cannot be authored by these tools. Supplying `fontFamily` /
      `fontStyle` unifies the node's font and the reply reports `wasMixed: true`; omitting
      them applies the non-font properties without touching the font.
- [x] **3.4 `lineHeight` and `letterSpacing` are `{ value, unit }` objects**, not numbers —
      `PIXELS` / `PERCENT`, plus `AUTO` for line height. ⚠️ A number-typed schema here would
      be a breaking correction later.
- [ ] ⏳ **3.5 `create_text` gains the same parameters** (D4), defaulting to Inter **only
      when nothing is supplied**, so every existing caller is unaffected. Replaces the
      hardcode at `code.js:1781-1785`. ⛔ **MOVED TO R2.6** — the input widening is
      additive, but the reply fields it needs are not, and `create_text` is `stable`.

⚠️ **Cross-release interaction, carried to R2.6:** `textAutoResize` and `layoutSizing`
describe the same behaviour from two sides. A text node set `WIDTH_AND_HEIGHT` inside an
auto-layout parent does not behave as its `layoutSizing` claims. Land the R2.6 child-layout
tools before asserting combined behaviour.

---

## R2.6 — Layout

**Contract `1.7.0` → `1.8.0`.**

### Phase 1 — pay the atomicity debt (no new tools)

> **✅ DONE 2026-08-20 (offline), 1.1–1.4.** 169 tests green, `dist/` byte-deterministic
> across two builds, `verify-release.mjs` passed, six baselines replaying. ⛔ **No contract
> bump:** strengthening `partialApplicationPossible` to false is additive, so the contract
> holds at `1.7.0` and R2.6 spends `1.8.0` on Phase 2. ⏳ **NOT gated** — the R2.4 live gate
> is re-pinned and inverted but has not been re-run.
>
> 🔴 **Two arithmetic errors in this section were corrected before building** — see 1.3 and
> 1.4. ⭐ Both are this plan's own "restate the count rather than leaving the old one to
> rot" rule failing on the plan itself.

- [x] **1.1 Reorder all three handlers** per F4 so every validation, including the
      cross-field ones, runs before the first assignment.
- [x] **1.2 Move the contract declaration with the code.** `partialApplicationPossible`
      becomes false for these three. Strengthening a guarantee is additive under
      `COMPATIBILITY-POLICY.md`, but the receipt's recorded reason list must move in the
      same change or the contract describes a document that no longer exists.
- [x] **1.3 ⛔ Update the R2.4 live gate in the same change.** All three are in
      `apply_batch`'s allowlist, and the R2.4 gate **observes their partial application as
      evidence** — it proved non-atomicity on `set_item_spacing`, `move_node` and
      `set_stroke_color`. Fixing **one of those three** (`set_item_spacing` — the other two
      are not layout ops and stay non-atomic per 1.4) makes the predecessor's own gate fail
      correctly. ⭐ A release that breaks the gate that accepted the release before it is
      not a regression; failing to notice would be.
      🔴 **Corrected 2026-08-20: this item said "two of those three".** Only
      `set_item_spacing` is in Phase 1's scope, so the count was wrong in the same section
      as 1.4's.
      🔴 **And the gate was already broken.** It carried a fingerprint pin
      (`sha256:a6ca7f4a…`) stale since `e02d1b2` against a tree at `sha256:05ac28c5…`, so it
      would have failed at `assertRuntime` before reaching a check. Re-pinned here.
      ⛔ **The inverted assertion cannot be a bare equality.** `partialApplicationReason` is
      only written when the possibility is declared, so comparing it to the removed map
      entry leaves `undefined === undefined` — a vacuous pass. Assert the absence.
- [x] **1.4 `move_node` and `set_stroke_color` stay non-atomic and stay declared.** They are
      not layout ops and are out of scope here. Five of nine proven becomes **two of six** —
      restate the count rather than leaving the old one to rot.
      🔴 **Corrected 2026-08-20: this item said "three of seven", which does not survive
      arithmetic.** Fixing three of nine declared leaves **six** declared and **two** proven;
      "three of seven" would only hold if *two* ops were fixed.
      ⚠️ **Their `proven:` markers were also missing from the source.** R2.4's live gate
      proved both (`docs/R2.4-BATCH-CONTRACT.md:141-145` already said so) but the map's
      reason strings were never updated — a release stale, fixed here.
      ⭐ **They are a different SHAPE from the three that were fixed**, which is why the
      reordering does not reach them: the three validated field 2 themselves and threw;
      these two write both fields and the *Figma property setter* refuses the second. There
      is no validation to hoist — closing them means adding type checks to two `stable`
      tools.

### Phase 2 — the child-side layout surface

- [ ] **2.0 ⏳ Inherited from R2.5: `create_text` gains the `set_text_style` parameters**
      (R2.5 item 3.5). It lands here because it needs reply fields and `create_text` is
      `stable`, so it needs the `1.8.0` bump this release already owns. ⛔ Fix the
      deferred **un-awaited `setCharacters` at `code.js:1790`** in the same change — it
      lets `create_text` return before its text is set — and apply the same
      refuse-never-substitute rule, or the hardcoded-Inter fix reintroduces F2 on a
      brand-new surface.
- [ ] **2.1 `set_layout_child(nodeId, layoutGrow?, layoutAlign?, layoutPositioning?)`** —
      auto-layout child sizing/alignment/grow and absolute positioning.
- [ ] **2.2 `set_constraints(nodeId, horizontal, vertical)`.**
- [ ] **2.3 `set_size_limits(nodeId, minWidth?, maxWidth?, minHeight?, maxHeight?)`.**
      ⚠️ Figma rejects a min above a max; validate the **pair**, not each field, before
      writing either.
- [ ] **2.4 `set_clips_content(nodeId, clipsContent)`.**
- [ ] **2.5 Every one validate-all-then-write**, per 3.2 above. The rule is now the house
      rule, not a per-tool decision.

---

## R2.7 — Visuals, assets, and R2 acceptance

**Contract `1.8.0` → `1.9.0`.**

### Phase 1 — paint and effects

- [ ] **1.1 `set_fill`** — solid **and** gradient (`GRADIENT_LINEAR` / `RADIAL` / `ANGULAR` /
      `DIAMOND`), taking one nested colour shape.
      ⭐ **This is the chance to end the shape divergence.** `apply_batch`'s
      `set_fill_color` / `set_stroke_color` take `{color:{r,g,b,a}}` while the standalone
      tools take flat `r,g,b,a` — the false "same shape" claim the R2.4 gate caught.
      ⛔ `set_fill_color` is `stable` and cannot be changed; `set_fill` ships **one** shape
      and the old tool is documented as legacy.
- [ ] **1.2 `set_effects(nodeId, effects[])`** — drop/inner shadow, layer/background blur.
- [ ] **1.3 `set_opacity`** and **`set_blend_mode`.**

### Phase 2 — assets

- [ ] **2.1 `create_node_from_svg(svg, …)`** — standalone create per **D4**. ⛔ Not added to
      `apply_batch`'s allowlist; mutate-only stands. ⚠️ Duplicates on rerun; idempotency
      stays deferred and is stated in the acceptance doc rather than left silent.
- [ ] **2.2 Bound the SVG input.** A pasted SVG is unbounded caller-supplied text and can
      expand to thousands of nodes. Declare a size ceiling and report the node count
      created, the way `delete_node` reports blast radius before mutating.
- [ ] **2.3 Fix `CROP`** per F5 — accept and set `imageTransform`, defaulting to identity.
      ⛔ **Measure it live first.** F5 is a source-read root cause, and the checklist's
      escape hatch exists because the behaviour was *observed* to differ. If the matrix does
      not fully explain it, ship the explicit limitation instead — that remains an
      acceptable outcome, but only after measurement.

### Phase 3 — R2 acceptance

- [ ] **3.1 Build the representative component/page fixture.** R2's acceptance criterion —
      *"a generic client can build and edit a representative component/page fixture with
      typed batch outcomes and no hidden dependency on a consumer repository"* — names an
      artifact that does not exist yet. It is created here.
- [ ] **3.2 Drive it end to end**: create a page, build an auto-layout component with real
      typography, gradients and effects, edit it, and read it back — using only fork tools.
- [ ] **3.3 Promote every new tool `additive-preview` → `stable`** as the acceptance act,
      per the R1 and R2.4 precedent.
- [ ] **3.4 Accept R2**, and only then consider the allowlist extension deferred by D3.

---

## Cross-cutting rules for all three releases

- **CC1 ⛔ Every new tool ships `additive-preview`.** Add each to `ADDITIVE_PREVIEW_RESULTS`
  in the same commit that registers it. Per F6, an unlisted tool is frozen the moment it
  ships. Promotion is an acceptance act, never a default.
- **CC2** Update all six hand-maintained maps per tool (F7), and extend
  `tests/progress-declaration.test.mjs` to cover each. A tool that declares progress it does
  not emit is Finding 4, again.
- **CC3** Freeze the previous contract as a baseline each release. R2.4 becomes the **6th**
  (R0 / R1 / R2.1 / R2.2 / R2.3 are the current five); all must replay at zero errors.
- **CC4** Each release gets its own live gate script and acceptance doc. ⛔ Pin
  **`serverBuildId`** — schema, tool count and fingerprint all held still across two server
  moves in R2.4, and the build ID was the only pin that would have caught a stale
  `dist/server.js`.
- **CC5** Live gates create a scratch page and delete it in a `finally`. ⛔ SYD content is
  never touched. Restore and verify the page baseline id-for-id.
- **CC6 ⛔ Ask of every PASS: which component supplied the signal?** If the test supplied it,
  that component is untested. Mutate the **source**, never the build artifact.
- **CC7** Keep Figma in the **foreground** for any live run — the `join_channel` preflight
  allows the plugin 5 s and a backgrounded tab throttles its JS.
- **CC8** `apply_batch`'s allowlist stays at **15 ops** for all three releases (D3).

---

## Inputs still owed before the first live gate

- ⛔ **Permission to modify a disposable Figma file**, and confirmation of the
  plan-specific authoring capabilities — the input `TASKS.md` records as required at R2/R3
  start. Reads and the R2.5 offline phases need nothing; every write gate does.
- A channel name per gate run, and a foreground Figma tab.

## Open questions this plan does NOT close

- **Generic idempotency.** Deferred in `TASKS.md`; SVG import inherits the gap rather than
  forcing the decision (D4).
- **Batch allowlist extension.** Deferred by D3 to after R2 acceptance.
- **Character-range typography.** Deferred by D2, with the internal machinery left in place
  so a later range-aware surface is additive.
- **R3 variable writes.** Untouched. `apply_batch` never closed it and neither does this
  plan — variables are not nodes. Entry point remains Phase 1.1 of
  [`VARIABLE-WRITE-PLAN.md`](VARIABLE-WRITE-PLAN.md).
