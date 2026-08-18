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

### Phase 2 — bounded font inventory and preflight

- [ ] **2.1 `get_available_fonts`** over `figma.listAvailableFontsAsync()`. Bounded exactly
      as R2.0 bounded `get_node_variables` and R2.3 bounded plugin data: `limit` / `offset`,
      a whole-inventory `fontCount` that keeps its total meaning against a window,
      `complete: false` whenever anything truncated, and `timeBudgetMs`.
      ⛔ Unbounded is not an option — a real machine returns thousands of faces, which is the
      3.66 MB → 518 KB defect again.
- [ ] **2.2 Declare `heavy_read`.** Cost scales with the *machine's* font set, not with the
      arguments — the same criterion that put `get_document_info` on the heavy budget.
- [ ] **2.3 `check_fonts`** — given `{family, style}` pairs, report availability and
      loadability **before** a write commits. This is the R2.1 lesson applied to text: give
      the caller the cost signal instead of a longer budget.

### Phase 3 — the typography write surface

- [ ] **3.1 `set_text_style(nodeId, …)`** — `fontFamily`, `fontStyle`, `fontSize`,
      `lineHeight`, `letterSpacing`, `textCase`, `textDecoration`, `textAlignHorizontal`,
      `textAlignVertical`, `paragraphSpacing`, `paragraphIndent`, `textAutoResize`. All
      optional; node-level per **D2**.
- [ ] **3.2 Validate-all-then-write from birth.** ⛔ Non-negotiable. This tool is a
      twelve-field write — the exact shape of the three ops F4 proves broken. Building it
      any other way is knowingly minting a fourth, in the same release that pays off the
      first three.
- [ ] **3.3 Mixed-font semantics are declared, not implied.** Supplying `fontFamily` /
      `fontStyle` unifies the node's font and the reply reports `wasMixed: true`; omitting
      them applies the non-font properties without touching the font.
- [ ] **3.4 `lineHeight` and `letterSpacing` are `{ value, unit }` objects**, not numbers —
      `PIXELS` / `PERCENT`, plus `AUTO` for line height. ⚠️ A number-typed schema here would
      be a breaking correction later.
- [ ] **3.5 `create_text` gains the same parameters** (D4), defaulting to Inter **only when
      nothing is supplied**, so every existing caller is unaffected. Replaces the hardcode
      at `code.js:1781-1785`. Additive.

⚠️ **Cross-release interaction, carried to R2.6:** `textAutoResize` and `layoutSizing`
describe the same behaviour from two sides. A text node set `WIDTH_AND_HEIGHT` inside an
auto-layout parent does not behave as its `layoutSizing` claims. Land the R2.6 child-layout
tools before asserting combined behaviour.

---

## R2.6 — Layout

**Contract `1.7.0` → `1.8.0`.**

### Phase 1 — pay the atomicity debt (no new tools)

- [ ] **1.1 Reorder all three handlers** per F4 so every validation, including the
      cross-field ones, runs before the first assignment.
- [ ] **1.2 Move the contract declaration with the code.** `partialApplicationPossible`
      becomes false for these three. Strengthening a guarantee is additive under
      `COMPATIBILITY-POLICY.md`, but the receipt's recorded reason list must move in the
      same change or the contract describes a document that no longer exists.
- [ ] **1.3 ⛔ Update the R2.4 live gate in the same change.** All three are in
      `apply_batch`'s allowlist, and the R2.4 gate **observes their partial application as
      evidence** — it proved non-atomicity on `set_item_spacing`, `move_node` and
      `set_stroke_color`. Fixing two of those three makes the predecessor's own gate fail
      correctly. ⭐ A release that breaks the gate that accepted the release before it is
      not a regression; failing to notice would be.
- [ ] **1.4 `move_node` and `set_stroke_color` stay non-atomic and stay declared.** They are
      not layout ops and are out of scope here. Five of nine proven becomes **three of
      seven** — restate the count rather than leaving the old one to rot.

### Phase 2 — the child-side layout surface

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
