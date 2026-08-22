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
- [x] ✅ **3.5 `create_text` gains the same parameters** (D4), defaulting to Inter **only
      when nothing is supplied**, so every existing caller is unaffected. Replaces the
      hardcode at `code.js:1781-1785`. ⛔ **MOVED TO R2.6** — the input widening is
      additive, but the reply fields it needs are not, and `create_text` is `stable`.
      ✅ **DONE 2026-08-21 as R2.6 item 2.0.** ⚠️ "Every existing caller is unaffected" did
      **not** survive contact: refusing an unloadable font, and refusing `fontSize: 0`
      instead of rewriting it to 14, are behaviour changes for callers who never touch the
      new parameters. They ride on the `1.8.0` bump as migrations rather than additions.

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
> holds at `1.7.0` and R2.6 spends `1.8.0` on Phase 2.
> ✅ **GATED the same day — `live-batch-gate.mjs` PASSED on channel `kw7qggwv`, 2026-08-20,
> first try.** 🔴 This line used to read "⏳ NOT gated — the R2.4 live gate is re-pinned and
> inverted but has not been re-run", which was true for a few hours and then rotted.
> **Corrected 2026-08-22**, after it misled a reader into calling Phase 1 ungated. ⚠️ The
> batch gate is stale *now* — 2.0 moved every pin and it is deliberately **not** re-pinned,
> because re-pinning without re-running is the `e02d1b2` defect. Stale-for-the-next-run is
> not the same fact as never-gated.
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

> **✅ 2.0 DONE 2026-08-21 (offline), and it SPENT the bump: contract `1.7.0` → `1.8.0`.**
> 187 tests green (was 169), `dist/` byte-identical across three builds,
> `verify-release.mjs` passed, six baselines replaying.
> ✅ **GATED 2026-08-22 — the typography live gate PASSED on the first run**, channel
> `7l9ymck4`, exit 0, no retries. Record below.
>
> ⛔ **Every pin moved this time** — server, plugin, fingerprint and schema — which is the
> opposite of the step before it. Adopting needs a **DEV plugin re-run AND a server
> respawn**; the gate spawns its own server, so only an interactive session needs the
> second.
>
> 🔴 **The bump was NOT mechanically enforced.** Regenerating the contract at `1.7.0`
> produced **zero** `compatibilityErrors` — the snapshot records input schemas and
> stability levels, never result shapes, so new fields on a `stable` result are invisible
> to every check in `bun run verify`. The policy says this in one line
> (`COMPATIBILITY-POLICY.md:47`) and it was true here: nothing but review would have
> caught it.
>
> ⚠️ **Two behaviour changes ride on the bump, and both are migrations, not additions:**
> an unloadable font is now **refused** where the old handler swallowed the error and
> created the node in whatever face Figma supplied; and `fontSize: 0` is refused where it
> used to be silently rewritten to 14.
>
> ⛔ **The four new tools' batch decision is DECIDED, not open** — see 2.6 below, so it is
> not re-litigated when they land. ✅ **Honoured by 2.1**: `set_layout_child` landed with
> an `EXCLUDED_BATCH_OPERATIONS` entry in **both** copies and a test that pins the absence,
> rather than a silent omission.
>
> ▶ **2.1 is BUILT 2026-08-22 and ⏳ NOT gated** — `scripts/live-layout-gate.mjs` is new,
> pins THIS build, and has not been run. Items 2.2–2.4 are not started: the owner scoped
> Phase 2 to land **one tool at a time**, as Phase 1 and item 2.0 each did.
>
> 🔴 **TWO gates are now declared stale**, both by name in `tests/live-gate-pins.test.mjs`:
> `live-batch-gate.mjs` (R2.6 Phase 1, passed on `kw7qggwv`) and now
> `live-text-style-gate.mjs` (item 2.0, passed on `7l9ymck4` 2026-08-22). ⛔ Neither is
> re-pinned here, because this change cannot re-run them — re-pinning and re-running have
> to travel together or the pin is a claim nobody tested. Owner's call, recorded
> 2026-08-22: re-pin and re-run them **once**, after the layout tools land.

#### ✅ The live gate PASSED — 2026-08-22, channel `7l9ymck4`

`scripts/live-text-style-gate.mjs`, first run, exit 0. **Pair confirmed live:**
`r2-server-2fa65a5749e2` ↔ `r2-plugin-045a95955905`, schema `1.8.0`, fingerprint
`sha256:b5cbf7b1…6241f2f0`, 56 tools, compatibility `compatible`, zero issues. Scratch page
`6043:2` deleted in the `finally`, **baseline restored id-for-id** (6 pages, current page
back to `0:1`). ⛔ Existing content was never written to.

⭐ **The DEV plugin re-run was VERIFIED, not performed.** `assertRuntime` read
`pluginBuildId` off the running plugin and it already matched HEAD — so the precondition
held before the run. That is the only reliable read: `compatibility: "compatible"` says the
two running halves agree with **each other**, never that they agree with this tree.

##### The four new sections (6–9) — `create_text`

- ✅ **§6 the styled create.** Node `6043:4`, `fontSource: "explicit"`,
  `fontSubstituted: false`, `appliedFieldCount: 12`, and the plugin snapshot carries all
  twelve while the independent REST read-back agrees on the six it can see. ⭐ The
  historical prose line survived the widening — `Created text "gate-created" with ID:
  6043:4` — which several gates parse.
- ✅ **§7 validate-all-then-CREATE held live, at the handler.** `lineHeight.value` with
  `unit: "AUTO"` → refused, and the scratch page's child count is **2 → 2** with
  `orphanCreated: false`. ⛔ That count is the whole point: a `rejects` assertion alone
  passes happily over an orphaned empty text node, which is what F4 looks like on a create
  tool.
- ⭐ **§7b records what it does NOT prove.** The bad-enum refusal arrives at the **schema**
  layer (Zod, MCP `-32602`), and the report says so in its own words:
  `provesAboutHandler: "nothing — the call never reached the plugin"`. A gate that flattened
  the two layers into "it refused" would have banked a handler guarantee it never tested.
- ✅ **§8 refuse-never-substitute held on the create path.** `Ghostly Absent Family` →
  handler refusal, child count **2 → 2**. Had the old swallow-and-substitute path survived,
  a node in whatever face Figma supplied is exactly what would be sitting there.
- ✅ **§9 the collision rule lives in the plugin, not the schema** — `fontWeight` together
  with `fontFamily`/`fontStyle` refused at the **handler** layer. And the default path
  (⛔ no `parentId`, the path the un-awaited write hid on) reports `fontSource: "default"`,
  `fontSize: **14**` — this tool's own R1-era default, where a fresh Figma text node is 12,
  so the default write was not quietly dropped — and the reply's `characters` **match the
  document's**. 🔴 That equality is the un-awaited-write regression test: it is the exact
  pair that disagreed before 2.0.

##### The R2.5 sections still hold against the new build

- ✅ Twelve fields applied, `fontSubstituted: false`, `letterSpacing` reading back `-0.64`
  resolved px for `{-2, PERCENT}` (the REST channel resolves the unit; the plugin snapshot
  preserves it).
- ✅ Validate-all-then-write unchanged on **both** channels after a refusal; the unloadable
  font still leaves `Inter/Bold` at size 32; half a font pair and a zero-property call both
  refused at the handler.
- ✅ **10 293 faces / 2 273 families** — paging repeatable, advancing, totals surviving the
  window; lowercase `inter` still reads as an absent **family**.

##### Findings and what stays owed

- 🔴 **1 finding:** the host reports **10 293** faces, above `get_available_fonts`'s own
  5000 `limit` ceiling — the whole inventory cannot be returned in one call here, so paging
  is **mandatory** and the deterministic code-unit sort is load-bearing.
- ⏳ **Mixed-font unification (3.3) stays FIXTURE-ONLY.** No `--mixed-node` was named, and
  the fork ships no range-font setter, so a mixed node cannot be authored by these tools.
  `wasMixed: true` and the `MIXED` sentinel remain proven offline and unproven live.
- ⏳ **F3 reachability is untouched**, and ⛔ `create_text`'s **rollback-on-refused-write
  sits on the SAME branch** — the offline harness *injects* a refused character write and
  nothing here can make real Figma refuse one on demand.
- ⏳ **`available` ≠ `loadable` did not reproduce** on this machine: every listed face
  loaded and every unlisted one refused. A green run does not discharge it.

- [x] **2.0 ✅ Inherited from R2.5: `create_text` gains the `set_text_style` parameters**
      (R2.5 item 3.5), plus the deferred **un-awaited `setCharacters`**.
      🔴 **The line number in this item was stale** — the call was at `code.js:1802`, not
      `:1790`, and the surrounding handler had moved too. Re-locate by NAME.
      🔴 **The un-awaited write was worse than "returns early".** The reply read
      `textNode.characters` while the write was still a pending microtask and reported
      `""` for text it had in fact written — **and only on the path without `parentId`**,
      whose own `await` let the write land first. The same tool told the truth or lied
      depending on an unrelated parameter. ⭐ Offline, the *parented* case passed before
      the fix, so a suite that had only tested that path would have reported green.
      ⭐ A font failure inside the un-awaited call surfaced as an **unhandledRejection
      after the command had already answered**, where no caller can catch it — the test
      runner reported it as "asynchronous activity after the test ended".
      ⛔ **Validate-all-then-CREATE, not -then-write.** On a create tool the F4 shape is
      not a half-written node, it is a node that exists at all: a refusal raised after
      `figma.createText()` leaves an orphan on the page. So the parent is resolved and the
      font loaded **before** anything is created, and every refusal test counts the page's
      children rather than asserting only that the call threw.
      ⭐ **The twelve-parameter validator is now ONE implementation, shared** by
      `set_text_style` and `create_text` (`textStyleRequestedFont` +
      `textStyleCollectWrites`). A second copy is how two surfaces start disagreeing about
      what is valid — the `set_fill_color` divergence R2.4's gate caught.
      ⛔ **`fontWeight` × `fontFamily`/`fontStyle` is a refusal**, because honouring
      either means discarding the other, and a discarded value reads as an applied one.
      ⚠️ This required the SERVER to stop defaulting `fontWeight` to 400: a default
      applied server-side reaches the handler indistinguishable from a caller's own value,
      so "was it supplied?" could not be answered. Behaviour is unchanged — the plugin
      applies the same 400.
      ⚠️ **Two defects found in the same handler and fixed here:** `parseFloat(a) || 1`
      turned a legitimate `alpha: 0` into a fully opaque fill, and an omitted `fontSize`
      wrote the R1-era 14 that the offline fixture could not distinguish from the
      platform's own default — the harness now creates text at **12**, which is what real
      Figma does, so the default write is observable at all.
- [x] **2.1 ✅ `set_layout_child(nodeId, layoutGrow?, layoutAlign?, layoutPositioning?)`**
      — auto-layout child sizing/alignment/grow and absolute positioning.
      **BUILT 2026-08-22 (offline).** 204 tests green (was 187), six source mutations
      killed with the control surviving, `dist/` byte-identical across three builds,
      `verify-release` passed. ⛔ **NO contract bump** — a new tool is additive, so the
      schema HELD at `1.8.0` and regeneration reported zero `compatibilityErrors`.
      ⚠️ **Which pins moved is DIFFERENT again:** both build IDs moved, the fingerprint
      moved, the tool count moved **56 → 57**, and the schema **held**. Item 2.0 moved the
      schema too; this one does not. ⛔ Re-derive, never carry forward.
      **Three decisions taken with the owner before building, not after:**
      ① a non-auto-layout parent refuses the **whole call**, not per-field — Figma accepts
      all three assignments outside auto-layout and silently applies none, which is the
      "a discarded value reads as an applied one" failure item 2.0 refused;
      ② `layoutAlign: "STRETCH"` is **published and then refused**, pointing at
      `set_layout_sizing` FILL, so one behaviour keeps one spelling;
      ③ **no x/y** — placement stays `move_node`'s job.
      ⭐ **The narrow rules live in the PLUGIN, not in Zod, deliberately.** `layoutAlign`
      publishes all five Figma values and `layoutGrow` publishes a bare `number`; the
      handler refuses STRETCH and pins 0|1. Item 2.0 set that precedent — a schema that
      rejected these first would answer a semantic decision with a generic enum error and
      make the handler rule unreachable through this transport.
      🔴 **The offline fixture cannot reach one branch honestly.** It gives every node a
      `layoutMode: "NONE"` default — pages included — so the arm for a parent with **no
      `layoutMode` property at all** had to be reached by `delete`ing it in the test. Real
      Figma's `PageNode` has no such property, and the live gate is the first thing to
      execute that arm for real.
      ✅ **LIVE GATE PASSED 2026-08-22, channel `mzg3tlfl`** — and the PageNode arm did
      execute for real (`reportsUnsetNotNone: true`). ⛔ **The tool needed no changes; the
      GATE did** — three defects, one of them a false green. See the section below.
- [x] **2.2 ✅ `set_constraints(nodeId, horizontal?, vertical?)`** — how a node resizes with
      its parent frame. **BUILT + GATED 2026-08-22.** 224 tests green (was 204), seven
      source mutations killed with the control surviving, `dist/` byte-identical across
      three builds, `verify-release` passed, then `scripts/live-constraints-gate.mjs`
      PASSED on channel `2bcdtr5b`. ⛔ **NO contract bump** — a new tool is additive, so the
      schema HELD at `1.8.0` and regeneration reported zero `compatibilityErrors`.
      ⚠️ **Same pin shape as 2.1, not 2.0:** both build IDs moved, the fingerprint moved,
      the tool count moved **57 → 58**, and the schema **held**. New pair
      **`r2-server-06f75969aa1d` ↔ `r2-plugin-e82230c1bbb1`**, fingerprint
      **`sha256:8ceaf9d2…93b236f`**. ⛔ Re-derive from `runtime-metadata.ts`.
      **Four decisions taken with the owner before building, not after:**
      ① an in-flow auto-layout child refuses the **whole call**, naming
      `set_layout_child({ layoutPositioning: "ABSOLUTE" })` as the way in — the exact
      INVERSE of 2.1 ①, because auto-layout and constraints are two mutually exclusive
      answers to "where does this child go";
      ② **both axes optional, ≥1 required**, against the plan's original required pair.
      The merge turned out to be a **platform requirement**, not a preference: `constraints`
      is one object property and Figma refuses a half-object, so the axis a caller omits
      MUST be carried over. A required pair would have made every call a two-axis overwrite;
      ③ a **PAGE** parent is refused (nothing to resize against), a **GROUP** is not;
      ④ the enum lives in **Zod**, deliberately the opposite of 2.1 — all five values are
      legal, so there is no semantic decision hiding behind a type error. The three context
      refusals stay in the plugin. The gate asserts `layer: "schema"` for the enum and
      `layer: "handler"` for each context rule, which is the only place the split is visible.
      ⭐ **Partial application is structurally impossible here**, not merely avoided: the
      write is ONE object assignment.
      ⭐ **The receipt deliberately has no `appliedFields`.** Both axes are written on every
      call, so a list of what was WRITTEN would be the constant `["horizontal","vertical"]`
      and could never fail in either direction — 2.1's false-green lesson applied at design
      time. `previous` / `preservedFields` / `changedFields` / `unchanged` can all fail.
      🔴 **A real shipped defect was found and fixed in a NEIGHBOUR:** `set_layout_sizing`'s
      FILL guard tested `parent.layoutMode === "NONE"` but not `undefined`, and a PAGE or
      GROUP has no `layoutMode` at all — so FILL on any top-level frame passed the guard and
      wrote a value Figma ignores. It was masked by the harness's blanket
      `layoutMode: "NONE"` default; type-gating that default (which also retires the
      dishonest-fixture debt 2.1's gate recorded) surfaced it immediately.
- [ ] **2.3 `set_size_limits(nodeId, minWidth?, maxWidth?, minHeight?, maxHeight?)`.**
      ⚠️ Figma rejects a min above a max; validate the **pair**, not each field, before
      writing either.
- [ ] **2.4 `set_clips_content(nodeId, clipsContent)`.**
- [ ] **2.5 Every one validate-all-then-write**, per 3.2 above. The rule is now the house
      rule, not a per-tool decision.
- [ ] **2.6 ⛔ DECIDED 2026-08-21, before the tools exist: the four are NOT added to
      `apply_batch`'s allowlist.** Each gets an `EXCLUDED_BATCH_OPERATIONS` entry naming
      the reason, per the R2.2 pin-the-absence pattern — an absence on the record is a
      decision, an absence in silence is an oversight someone quietly reverses later.
      ⭐ Recorded here so it is not re-litigated when 2.1–2.4 land; revisiting it is a
      choice someone makes on purpose, not a gap they fall into.
      ⚠️ They are mutate-only ops on existing nodes, so they would *fit* the batch — the
      cost of adding them is allowlist parity across both copies, batch receipt tests, and
      a longer live gate, and none of that is owed until a consumer asks.

#### ✅ The constraints live gate PASSED — 2026-08-22, channel `2bcdtr5b`

`scripts/live-constraints-gate.mjs`, exit 0. **Pair confirmed live:**
`r2-server-06f75969aa1d` ↔ `r2-plugin-e82230c1bbb1`, schema `1.8.0`, fingerprint
`sha256:8ceaf9d2…93b236f`, **58 tools**, compatibility `compatible`. Scratch page deleted in
the `finally`, baseline restored, and both operator-node CLONES deleted on their own
independent cleanup path.

⛔ **The DEV plugin re-run was REQUIRED here, not merely verified** — unlike 2.0 and 2.1.
The first attempt refused at `join_channel`: the plugin was still serving
`r2-plugin-3f7c7cd69133` and the preflight named the missing command by name. **Nothing in
the document was touched.** ⭐ That is the failure mode `assertRuntime` exists for, finally
firing for real.

##### What the gate proved

- ✅ **Constraints RESOLVE.** One parent resize (400 → 600), three children, three different
  geometries: MIN held left at `20`, MAX held right at `300` and moved to left `220`,
  STRETCH grew `80 → 280`. ⭐ No two of those readings agree, so a tool that stored the
  strings and applied nothing fails in three places at once. Offline none of these numbers
  can move.
- ✅ **The un-named axis genuinely survives the merge** — and this is the one the receipt
  alone could not prove. After writing only `horizontal`, the child moved **150px** when the
  parent grew 300px, which is CENTER behaviour; a read-modify-write that reset the axis to
  MIN would have moved **0**, while its receipt said `CENTER` either way.
- ✅ **The layering split is real through the transport.** The bad enum arrived at
  `layer: "schema"`; the in-flow refusal, the PAGE-parent refusal and the zero-field refusal
  all arrived at `layer: "handler"`. Offline these are indistinguishable.
- ✅ **A real PageNode has no `constraints`** — refused for *having no constraints property*,
  not for the parent rule, which confirms the offline harness's type-gated model against
  Figma rather than against itself.
- ✅ **No refusal moved the document**, measured in the same currency as the writes.
- ✅ `apply_batch` still refuses `set_constraints` (2.6's pinned absence, live).

##### The two platform premises, MEASURED

- ✅ **The auto-layout premise HOLDS**, and it is measured rather than asserted: the *same
  stored* MAX constraint was honoured while the child was ABSOLUTE (left `0 → 200`, right
  held at `300`) and ignored once it returned to the flow (left held at `0`, right slid
  `300 → 500`). Refusing the in-flow case removes a write Figma genuinely discards. ⭐ The
  ABSOLUTE leg doubles as the instrument check — had it not been honoured either, the
  verdict would have been `unmeasured`, not confirmation.
- ✅ **The GROUP premise HOLDS.** A group child's constraint DOES resolve, against the
  **enclosing frame**. Allowing a GROUP parent rather than refusing on an unverified claim
  was the right call.

##### 🔴 The gate's own defect — a false RED, caught by its own numbers

§6 scored **`inert`** on its first run and pushed a finding telling a future reader to
revisit the allow decision. It was wrong, and the finding's own text gave it away: *"The
cloned group did change (137 → 137)"*.

- 🔴 **The measurement was VACUOUS.** It measured the child's offsets **within its group**
  and read `0 → 0`. That is not a result, it is arithmetic — a single-child group's bounding
  box **is** its child's box, so those offsets are pinned at zero and the check could not
  have come out any other way, in either direction, ever. Exactly the family of 2.1's false
  green, one level down: **I built an instrument check for the confound I anticipated (does
  the group move?) and it passed, while the reading underneath it was structurally fixed.**
- ⭐ **The repair is the shape §3 already used**: measure against the **FRAME** — the
  reference a constraint actually resolves against — and DISCRIMINATE between two objects
  under one resize. Two identical cloned groups, one written to MAX, one left untouched as
  a CONTROL. Result: tested moved left `20 → 220` holding right `243`; control held left
  `20` while its right slid `243 → 443`. `separated: true`.
- ⭐ **The instrument check was rebuilt to ask the question that can actually invalidate the
  comparison** — did the tested and control children end up in the same place? — rather than
  a question that a move for any unrelated reason could satisfy.
- ⭐ **The operator's own node was never written to, resized or reparented.** §6 works on
  CLONES placed inside the scratch page, tracked separately and deleted on their own path,
  because `clone_node` lands a clone beside its original — on a real document, not ours.

##### What stays owed

- ⏳ **THREE gates now pin builds this tree no longer produces** — `live-batch-gate.mjs`,
  `live-text-style-gate.mjs` and now `live-layout-gate.mjs`, which passed hours earlier.
  All declared by name in `tests/live-gate-pins.test.mjs`; none re-pinned, because this
  change cannot re-run them. Owner's standing call: re-pin and re-run once, after the
  layout tools land — 2.3 and 2.4 are still outstanding.
- ⚠️ **`set_constraints` ships `stable` from birth**, following 2.1 rather than R2.5's
  hold-at-`additive-preview`. A reply-shape defect found later needs a
  `publicContractVersion` bump, and `1.9.0` is reserved for R2.7.
- ⏳ **SCALE is the one published value whose live behaviour is unmeasured.** It round-trips
  offline, but no geometry check here distinguishes it from STRETCH on a single-axis resize.
- ⏳ `set_layout_sizing`'s type guard is still stricter than the Figma API (2.1's debt);
  the FILL `undefined` hole next to it is fixed, that one is not.

---

#### ✅ The layout live gate PASSED — 2026-08-22, channel `mzg3tlfl`

`scripts/live-layout-gate.mjs`, **run twice, both green**, exit 0. **Pair confirmed live:**
`r2-server-92dc135f665b` ↔ `r2-plugin-3f7c7cd69133`, schema `1.8.0`, fingerprint
`sha256:1865d817…6b7ebb09`, **57 tools**, compatibility `compatible`. Scratch page deleted in
the `finally`, baseline restored (6 pages, current page back to `0:1`) on every run. Across
the two passes every check was identical except the scratch-page timestamp and node IDs.

⭐ **The DEV plugin re-run was VERIFIED, not performed** — `assertRuntime` read the live
`pluginBuildId` and it already matched HEAD, same as item 2.0.

⛔ **`set_layout_child` itself needed NO changes. All three defects were in the GATE**, which
had never been run. This is what a first run buys, and one of the three was a false green.

- 🔴 **A FALSE GREEN, on the gate's headline claim.** §4's validate-all-then-write (F4) check
  refused `{layoutGrow: 0, layoutAlign: "STRETCH"}` and scored a partial write by asserting
  the height **held**. But writing `layoutGrow: 0` changes **no height at all**, so a clean
  refusal and a partial write read *identically* — the check could not fail, in either
  direction, ever. It now moves the **parent** instead: a child that wrote nothing still
  tracks it (measured `550 → 850`), a partially-written one holds still. ⚠️ Note the
  polarity is **inverted** from §3 — here *following* is the PASS.
- 🔴 **The platform claim underneath both was false.** `layoutGrow: 0` does **not** shrink the
  child back: Figma keeps the stretched height as the node's **own** size. Measured on a real
  file — grow-1 tracked the parent `600→900→500`; grow-0 **held at 900** while the parent
  shrank to 500. The report now records `shrankBack: false` as data so the premise cannot
  quietly return. ⛔ This is precisely what §7 exists to avoid for STRETCH — *measure the
  platform claim, don't assert it* — never applied to the grow-zero revert.
- 🔴 **A false RED that blocked the run.** `growIsPlainNumber` regexed the **serialized**
  schema for `/"layoutGrow":\{"type":"number"\}/`, which demands the object hold exactly one
  key — so any `.describe()` failed it. It red-flagged a correct implementation. Now reads
  the **parsed** schema: `type === "number"` with no constraint keys, letting documentation
  be documentation. ⭐ Repaired under a **known-bad rerun** — `enum [0,1]`, `minimum/maximum`,
  `const`, `multipleOf`, `integer`, a wrong type and an absent field all still fail it, so
  this was a fix and not a threshold quietly lowered.
- ⚠️ **§7 died on its helper's precondition.** `set_layout_sizing` refuses `RECTANGLE` — it
  accepts only FRAME/COMPONENT/COMPONENT_SET/INSTANCE **and** requires the target's *own*
  `layoutMode !== "NONE"`. §7 pointed it at the rectangle sibling. Worked around with a
  nested auto-layout frame; the restriction itself pre-dates 2.1 and was **left untouched**.

##### What the gate proved, and what it did NOT

- ✅ **The write does something.** `layoutGrow: 1` grew the child `50 → 550` inside a fixed
  600-tall VERTICAL parent, measured through `get_node_info` — a different channel from the
  one that wrote. Offline this number cannot move.
- ✅ **`layoutGrow: 0` lands**, proven three ways: `appliedFields: ["layoutGrow"]`, the
  node's own read-back `layoutGrow: 0`, and `heldWhileParentMoved: true`.
- ✅ **The PageNode arm ran for real** — `layoutMode` **unset**, not `"NONE"`, which the
  offline fixture can only reach by `delete`ing the property.
- ✅ **ABSOLUTE leaves the flow** — `x` went `0 → 250` and honoured its own coordinate.
- ✅ Every refusal answered at the **handler**, and `apply_batch` still refuses
  `set_layout_child` at the **schema** layer (2.6's pinned absence, live).
- 🔴 **The STRETCH premise is STILL UNMEASURED.** `get_node_info` does not carry
  `layoutAlign` on this build (`restReportsAlign: null`), so §7 reached its designed **third**
  outcome — `verdict: "unmeasured"`, routed to `stillOwed`, correctly **not** scored as a
  pass. ⛔ `set_layout_child`'s narrowed enum still rests on an untested platform claim.
- ⏳ **`set_layout_sizing`'s type guard is stricter than the Figma API** — the UI *can* set a
  rectangle child to Fill. Recorded in `stillOwed`; confirm before 2.2–2.4 lean on that tool.

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
