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

## ▶ Resume (checkpoint 2026-08-19)

- **Project:** `knowledge/projects/talk-to-figma-fork` — R2.5 typography
- **Doing:** R2.5 Phase 3 (`set_text_style`) is BUILT and its **live gate PASSED**; the
  release is complete but **not accepted**.
- **Next step:** **R2.5 ACCEPTANCE** — promote `set_text_style`, `get_available_fonts` and
  `check_fonts` from `additive-preview` to `stable` by removing them from
  `ADDITIVE_PREVIEW_RESULTS` in `scripts/contract-lib.mjs`, then ⛔ **re-pin and RE-RUN
  `scripts/live-text-style-gate.mjs` on the promoted build** — promotion moves the
  contract and therefore the `serverBuildId`.
- **Key paths / IDs:** `docs/R2.5-TYPOGRAPHY.md` (the record) · `scripts/live-text-style-gate.mjs`
  (takes `--channel=`, optional `--mixed-node=<id>`) · `tests/text-style.test.mjs` ·
  pair `r2-server-a30e91f4f88e` ↔ `r2-plugin-0bc82334ff83`, `1.7.0`, 56 tools/55 commands,
  fingerprint `sha256:05ac28c5…`. Gate passed on channel `o247ecxs`.
- **Open / blockers:** 🟡 **Everything is UNCOMMITTED** — 16 modified + 3 new files.
  ⛔ Stage explicit paths, never `git add -A` (peer sessions write this repo).
- **Don't forget:** ⛔ `getResultStability` falls through to `stable`, so a **leftover**
  `ADDITIVE_PREVIEW_RESULTS` entry silently holds a tool back — remove, don't comment out.
  ⛔ Two debts must NOT be recorded as discharged at acceptance: **F3 reachability** and
  **mixed-font unification** (the fork ships no range-font setter), plus Phase 2's
  `available` ≠ `loadable`, which did not reproduce live. ⚠️ `TASKS.md:261` has a
  pre-existing orphaned table row from the R2.4 era — left alone deliberately.

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
r2-server-a30e91f4f88e  ↔  r2-plugin-0bc82334ff83   (sha256:05ac28c5…)         ← HEAD, 1.7.0, 56 tools
```

⛔ **The tree is now R2.5 Phase 3, not Phase 2.** Schema stayed `1.7.0` (R2.5 spent its bump in
Phase 1) but **BOTH halves moved a third consecutive time**, and tools went 55 → **56**.

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

**Next = R2.5 Phase 3** — `set_text_style` (3.1–3.5). ⛔ **3.2 is non-negotiable:
validate-all-then-write from birth.** It is a twelve-field write, the exact shape F4 proves
broken in three shipped ops; any other construction mints a fourth in the release that pays
off the first three. ⛔ CC1 again. ⚠️ 3.5 touches `create_text`, which still has the deferred
un-awaited `setCharacters` at `code.js:1790`.

🔴 **The cut's highest-leverage finding:** `getResultStability`
(`scripts/contract-lib.mjs:267`) returns **`stable`** for any tool not named in
`ADDITIVE_PREVIEW_RESULTS`, and `compatibilityErrors()` refuses to weaken a level. This plan
adds ~10 tools — unlisted, they would be permanently frozen on day one, never having faced
a live gate. ⛔ Every new tool ships `additive-preview`; promotion is an acceptance act.

### ⛔ R3 variable-write is still OPEN

`apply_batch` will **never** close it — it is mutate-only over *node* IDs, and variables aren't nodes. Its Phase 0 is discharged, so the entry point is **Phase 1.1**.

⛔ **Figma defines writing `""` as delete.** Not a bug to route around — a semantic you must respect.

## 📚 Detailed history

⚠️ **This repository is PUBLIC, so the full internal history is deliberately NOT kept here.** This file carries the sanitized technical state only.

The complete record lives in the private `ai-synthesizer` workspace at `knowledge/projects/_memory/project_talk_to_figma_fork_upgrade.md` — session-by-session, including the parts that must not be published (hosting account details, client agreements, internal IDs). Folded there 2026-08-17.
