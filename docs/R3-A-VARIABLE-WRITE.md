# R3-A Phases 2–4 — the variable-write slice

The record doc for the variable **write** tools: `set_variable_value`, `create_variable`,
`delete_variable`, and `remove_variable_mode`. Phase 1's read/probe work is recorded in
[`VARIABLE-WRITE-PLAN.md`](VARIABLE-WRITE-PLAN.md) §§ *1.1–1.3*; this file owns Phase 2 (the
three write tools), Phase 3 (layered resource identity for `create_variable`) and Phase 4
(mode removal, plan item *2.5*).

> ⚠️ The gate in this document **creates, aliases, rewrites and deletes real variables**.
> Every invocation requires `--disposable-target=true`, and a channel is transport, not
> evidence that the file behind it is disposable.


## ✅✅ R3-A PHASE 4 — `remove_variable_mode`, LIVE-ACCEPTED 2026-08-24, channel `yizlybxy`

Plan item **2.5**'s destructive half, and the tool that made the Phase 1.3 debris above
clearable from this fork instead of by hand. `scripts/live-variable-mode-removal-gate.mjs`
**PASSED TWICE** on `Starter File - PsiAtiva - Disposable` (owner-confirmed), and the six
residues are **GONE**: *"8. Dimensions"* went **10 modes → 4**, leaving exactly the real
`Mobile / Tablet / Laptop / Desktop`.

**Identity:** `r3-a-server-c4d037a645e3` ↔ `r3-a-plugin-fe0b1e03325c`, schema `1.14.0`,
**71 tools**, fingerprint
`sha256:edf5e2e98842d2fc201f44ab780eb2ed16757e481df433086ab7de56cab57a37`.
Offline **410/410**, `bun run verify` green, `dist/server.js`
`sha256:2c9cbae6…d925e7efc1` built from `code.js` `sha256:23cfc896…1dba9924` — and **both
live runs recorded that same plugin hash in `artifactHashes`**, so the mutants, the offline
suite, the build and both live runs provably exercised ONE source.
Evidence → `docs/evidence/r3a-phase4-modes-run{1,2}/report.json` (⚠️ **gitignored** —
`docs/*` is allowlisted; mirrored to this session's scratchpad only).

### 🔴 WHAT THE LIVE RUN MEASURED — Figma DOES update `collection.modes` in-frame

`observedBy: "resolved_collection_modes"` on **all eight** removals across both runs (two
probe modes, six residues). This is the first live reading of what `removeMode()` makes
visible inside its own frame, and it is the **opposite** of `getVariableByIdAsync`'s answer
after `Variable.remove()`, which stays stale.

- ⭐ **Both signals agreed rather than one covering for the other**:
  `resolvedCollectionStillLists: false` AND `freshCollectionStillLists: false` on every
  removal, plus `absentAfterFreshRead: true` on the later call. Three readings, one answer.
- ⏳ **The `removal_unconfirmed` deferral is STILL live-unexercised** — exactly as it remains
  for `delete_variable`. The in-frame signal answered every single time, which is precisely
  the branch that makes the deferral rare. It stays offline-covered only.
- ⭐ `defaultModeIdStable: true` everywhere; the residue collection's default (`17050:1`)
  never moved across six removals, and the counts fell monotonically 10→9→8→7→6→5→4.

### 🔴 THE ASSERTION I REMOVED BEFORE THE RUN WOULD HAVE FAILED IT — for the wrong reason

The gate first asserted `blastRadius.variableCount === baseline.variableCount`. Live, those
are **924 and 0**. They are two different measurements: `blastRadius` counts the collection's
`variableIds` membership, while the gate's `get_variables` read is narrowed to one variable
type so it can read *modes* cheaply. An equality check there would have gone red on the first
probe and burned the channel on a defect that does not exist.
⛔ Two numbers that describe "how many variables" are not the same number.

### ⚠️ `sole_remaining_mode` IS LIVE-UNREACHABLE, and the run is what showed it

The refusal legs exercised `default_mode` and `mode_not_in_collection` live, and a call with
no `confirm` **threw** — a `z.literal(true)` violation is refused by the *schema*, so the gate
accepts either a throw or `isError` rather than scoring correct behaviour as a failure.

But `sole_remaining_mode` never fired, and it **cannot**: a collection down to one mode has
that mode as its `defaultModeId`, so `default_mode` always refuses first. `_Primitives` is
exactly that shape — one mode, `17048:0`, which is its own default. The guard is
**defence-in-depth against a state Figma does not appear to produce**, not a reachable path,
and it is offline-covered only because the harness can point a default elsewhere.
⛔ Recorded as unproven-live rather than folded into "the guard rail passed".

### ⭐ The gate is rerunnable, and run 2 proved it rather than asserting it

Run 2 created a **different** probe mode (`31012:7` vs run 1's `31012:6`) and re-ran every
leg, then found `alreadyClean: true` with `4 → 4` modes and zero removals. A cleanup gate
that could only run once would be unfalsifiable after its first pass; this one re-measures
the guard rails on every run and treats an empty residue set as a pass by construction.

⛔ **Cleanup was confirmed by a read from a SEPARATE client session** — this session's own
MCP client, not the server the gate spawns. `get_variable_capabilities` reported *"8.
Dimensions"* at `modeCount: 4`, `_Primitives` back at `1` with no probe left behind, and all
nine collections intact. The gate asserting its own cleanup is the instrument checking its
own precondition.
⭐ **A second-order confirmation nobody asked for:** the document-wide
`modeCeiling.knownGoodAtLeast` fell **10 → 4**. The "true ceiling refusal from a false ceiling
cause" the Phase 3 record warned about is now gone from the preflight reading itself.
`sha256:2c9cbae6…d925e7efc1` built from `code.js` `sha256:23cfc896…1dba9924`.

### The guard rail, and why two removals are refused rather than reasoned about

Exact `collectionId` + exact `modeId` + literal `confirm: true`; local collections only;
one mode per call.

- ⛔ **THE DEFAULT MODE IS REFUSED.** Figma documents `removeMode(modeId)` and documents
  `defaultModeId`, and documents **nothing** about where the default lands when the default
  itself is removed. Every variable in a collection resolves through that default, so an
  undocumented repoint would change the resolved value of the whole collection from a call
  that named one mode. Refusing is the only branch whose consequence this fork can state.
  The caller who means it reassigns the default in the Figma UI first, where the intent is
  explicit.
- ⛔ **THE SOLE REMAINING MODE IS REFUSED.** A collection with no modes has no slot for any
  variable's value. Refuse rather than discover what Figma does with the collection itself.
- ⭐ The receipt reports `blastRadius.variableCount` read **before** the call, because after
  a successful removal the membership it would be read from is exactly what may have moved.
  Those variables survive; only the value they held **for this mode** does not.

### ⛔ The `delete_variable` lesson, paid BEFORE it could cost a live run

Phase 2's `delete_variable` asked ONE question after `remove()` — `getVariableByIdAsync` —
which Figma answers with a **stale** object inside the deleting frame. Its success branch
was therefore unreachable live while an obliging harness kept it green, and the live gate's
first run failed with three `delete_not_observed` receipts for variables that were already
gone. Nothing in Figma's documentation says which signal a `removeMode()` updates in-frame,
so this handler assumes **none** and probes two independent ones — the resolved collection
object's own `modes`, then a freshly looked-up collection's `modes` — naming the one that
fired in `observation.observedBy`. When neither can distinguish a real removal from a no-op
it returns `removal_unconfirmed` with `verificationDeferred` and `partialApplicationPossible`
rather than claiming the removal.

⭐ **And the offline harness models that question as an OPTION whose DEFAULT is "nothing is
observable".** `modeRemovalSignal` takes `"none"` (the default), `"collection_modes"` and
`"fresh_lookup"`. A harness that spliced the mode out of `collection.modes` immediately
would have made the in-frame branch reachable offline and possibly unreachable live — which
is precisely how `delete_not_observed` shipped green. The `"fresh_lookup"` arm exists
because the resolved object and a fresh lookup are the same object in this harness: without
it, the second probe could be dead code and every test would still pass.

⭐ **Every signal model commits to the same state at frame end**, so the cross-frame re-read
is a real instrument offline rather than a second look at the same in-frame fiction.

### The `set_fill` gradient `color` drop is REPAIRED — the third refused combination

The debt R2.7 item 1.1 recorded and 1.2 deliberately declined is paid here.
`buildFillPaint`'s gradient branch never read `input.color`, and the published schema
announced the drop — *"ignored by the gradients"* — so
`{type:"GRADIENT_LINEAR", color:{…}, gradientStops:[…]}` earned a **green receipt and a
discarded argument**. The tool enforced *"a discarded value reads as an applied one"* on
`color.a` × `opacity` and on `gradientTransform` × `angle`, and broke it on a third pair.
It now refuses, and the schema description no longer advertises a drop it does not perform.

⚠️ **What no check here can see, stated rather than assumed.** The repair lives in the
**handler**, not the schema — `color` stays `.optional()` on every paint, because Zod cannot
express *"required here, forbidden there"* without restructuring a `stable` tool's input
into a discriminated union. So `compareSchema()` cannot see the change and
`compatibilityErrors()` reports none. `publicContractVersion` was moved to `1.14.0` by
**decision**, not because a green check demanded it — the same shape as
`capabilityFingerprint` covering only what it hashes.

### Mutation-tested against the SOURCE, with a control

Nine mutations of `src/cursor_mcp_plugin/code.js` (never `dist/`, which a build regenerates):
default-mode refusal, sole-remaining refusal, the `confirm` gate, each of the two observation
signals, the deferral-to-success downgrade, the blast-radius count, and the gradient `color`
refusal. **All nine killed**; a comment-text control **survived**, so "every mutant died" is
distinguishable from "the suite fails on any edit". The source restored byte-identical
(`sha256:23cfc896…1dba9924`) — the same hash `bun run verify` then built `dist/` from.

⚠️ **One anchor was rejected by the uniqueness guard and it was RIGHT to be**:
`outcome: "removal_unconfirmed",` matches **both** this handler and `delete_variable`'s
deferral, so the one-line form would have mutated the wrong function and fabricated a hole.
The two-line form pins the mode handler. ⚠️ A second reading — *"3 hits"* on that two-line
anchor — was a defect in the **counter**, not the anchor: `grep -F` splits a multi-line
pattern into separate patterns and sums their line hits. Counted as a sequence, it is 1.

### The acceptance flow this gate implements

Approved 2026-08-24, in this order and for this reason:

1. **Probe leg.** `add_variable_mode` creates a disposable probe mode, `remove_variable_mode`
   removes it, and a **later call** fresh-reads it absent. The tool is proved on a resource
   the gate owns, not first exercised on a real design-system copy — and because the probe
   manufactures its own target, **the gate stays rerunnable after the residues are gone**.
2. **Refusal legs.** The default mode, a foreign `modeId`, and a call with no `confirm`. Each
   asserts the refusal **and** that the mode count and `defaultModeId` did not move — *refused*
   and *refused after writing* are different receipts with the same first word. The
   no-`confirm` leg accepts either a throw or `isError`, because a `z.literal(true)` violation
   is refused by the **schema**, and scoring only one shape would mark correct behaviour a
   failure.
3. **Authorized residue cleanup.** All **six** documented residues — `R3A-GATE-DELETE-ME` plus
   `R3A-FILL-1…5` — each with its own fresh-read verification, then a final read asserting
   none survived and the default did not move.

⛔ **The residues are matched by exact NAME against a fresh read, never by the recorded mode
IDs.** `31001:0`–`31001:5` describe one file; a disposable **copy** of it re-issues them. A
mode whose name is not on the allowlist is never removed, whatever the caller passes. Zero
targets is a **pass**, not a failure — that is what the second run sees.
## ✅✅ R3-A PHASE 3 ACCEPTANCE — PAID 2026-08-24, channel `lkm6ne6h`

`scripts/live-variable-identity-gate.mjs` **PASSED TWICE**, same verdict structure both
times, against `Starter File - PsiAtiva - Disposable` (owner-confirmed disposable).

| | run 1 | run 2 |
|---|---|---|
| started | `2026-08-24T21:47:29Z` | `2026-08-24T21:47:59Z` |
| verdict (read from `report.json` `success`) | PASSED | PASSED |
| created variable | `VariableID:31011:115` | `VariableID:31011:116` |
| `matchedBy` sequence | `null → name → identityKey → id` | `null → name → identityKey → id` |
| type-conflict refusal | `name_type_conflict` | `name_type_conflict` |
| `sameNameCount` after fresh read | 1 | 1 |
| delete `observedBy` | `removalObserved: true` | `removalObserved: true` |
| `stillOwed` | `[]` | `[]` |

- **Runtime:** `r3-a-server-c3d335284ec5` ↔ `r3-a-plugin-02cca8304cfb`, schema `1.13.0`,
  **70 tools**, fingerprint
  `sha256:000d808e4f63fce7ce6b965089b3f76e51a73d29a46557ea510993dcefe7d4ff`,
  `compatibility: compatible`, zero issues. `dist/server.js`
  `sha256:7493a32a…6822d309`, `code.js` `sha256:6d772a51…fcb7f10d`.
- **Target:** `VariableCollectionId:17048:9` *"_Primitives"*, `defaultModeId 17048:0`,
  **1 mode** — chosen for the smallest blast radius. ⛔ Unlike the Phase 2 write gate, this
  gate asserts nothing about mode isolation, so a single-mode target costs it no coverage.
- **Post-run state:** an independent read **from a different client session** (not the
  gate's own cleanup assertion) found **0** leftover `__R3A Identity Gate` variables;
  `_Primitives` holds exactly its 7 original `File/*` entries, document STRING count 18.

Each run resolves the same variable four ways and refuses a fifth: create (`matchedBy:
null`, `identityKeyStatus: "stored"`), exact name, opaque `identityKey` **under a different
requested name**, explicit `id`, then a `COLOR` request against the existing `STRING` name.

### What the run proves that the offline harness could not

- **The identity fallback does not rename.** The `identityKey` leg deliberately requests
  `"<name> renamed intent"` and the post-run fresh read still returns the **original** name.
  A resolver that matched and then applied the requested name would pass every
  `matchedBy` assertion and silently rewrite a real design-system token.
- **The opaque key survives a real Figma round-trip.** `identityKey` is
  `"  r3a://identity/<stamp> — opaque  "` — leading/trailing spaces, a URI-ish body, an
  em dash. Live Figma stored and returned it byte-exact, so the *only* legal operation on a
  caller-owned key stays exact string equality.
- **`identityKeyStatus` distinguishes `stored` from `already_stored`.** Run 1's create
  reports `stored`; every subsequent match reports `already_stored`. A resolver that
  re-wrote the key on each match would be byte-identical on the receipt Juan reads.
- 🔴 **`delete_variable` now reports `removalObserved: true` live.** This is the Phase 2
  defect's fix, exercised on real Figma for the first time: the post-`remove()` check reads
  **collection membership**, which updates in-frame, instead of `getVariableByIdAsync`,
  which Figma answers with a stale object inside the deleting frame. Both cleanups also
  proved absence on a later frame (`absentAfterFreshRead: true`), so the success path and
  the cross-frame path agree rather than one covering for the other.

### ⚠️ Pre-existing gate debris found in this file — NOT from this run

The independent read found **6 leftover modes** in `VariableCollectionId:17050:370`
*"8. Dimensions"*: `R3A-GATE-DELETE-ME` and `R3A-FILL-1` … `R3A-FILL-5` (`31001:0`–`31001:5`),
on top of the four real `Mobile/Tablet/Laptop/Desktop` modes.

- They are residue of the **Phase 1.3 mode-ceiling gate**, which had to push the collection
  to 10 modes to make Figma emit `in addMode: Limited to 10 modes only`. They are not
  variables and this gate never touches modes — the Phase 3 runs above created and deleted
  exactly one STRING variable each, in `_Primitives`.
- ⚠️ **This was TRUE WHEN WRITTEN and is now RESOLVED.** At the time of the Phase 3 run this
  fork exposed no mode-removal tool — `add_variable_mode` is documented as never calling
  `removeMode`, and there was no `delete_variable_mode` — so hand deletion in Figma was the
  only route. **Phase 4 built `remove_variable_mode` and its gate REMOVED all six live on
  2026-08-24** (channel `yizlybxy`), each fresh-read verified.
- ✅ **Consequence retired:** *"8. Dimensions"* is at **4 modes** — the real
  `Mobile / Tablet / Laptop / Desktop` — and no longer pinned at the ceiling by junk. The
  document-wide `modeCeiling.knownGoodAtLeast` fell **10 → 4**, so the *"true ceiling refusal
  from a false ceiling cause"* this section warned about is gone from the preflight reading
  itself. ⭐ The debris and the plan item that would clear it closed together.

## ✅ R3-A PHASE 2 ACCEPTANCE — PAID 2026-08-24, channel `hxpwe1ej`

`scripts/live-variable-write-gate.mjs` **PASSED TWICE**, same verdict structure both times,
against a disposable copy of a real design-system file.

| | run 1 | run 2 |
|---|---|---|
| started | `2026-08-24T20:15:28Z` | `2026-08-24T20:16:16Z` |
| verdict | PASSED | PASSED |
| `observedBy` (×3 deletes) | `collection_membership` | `collection_membership` |
| write isolation leaks | none | none |
| cleanup retries | 0 | 0 |
| `stillOwed` | `[]` | `[]` |

- **Runtime:** `r3-a-server-214dd61cca06` ↔ `r3-a-plugin-4aa3214c4754`, schema `1.12.0`,
  70 tools, fingerprint
  `sha256:9a314c170c7730bdb0b8aac7f3bf69758527c0ba21ff7f206b1b3157ce0ee87a`,
  `compatibility: compatible`, zero issues.
- **Target:** `VariableCollectionId:17050:370` *"8. Dimensions"*, `defaultModeId 17050:1`,
  **10 modes** — chosen because 9 non-target modes make write isolation *measurable*.
- **Post-run state:** an independent fresh-frame read found **0** leftover `__R3A Gate`
  variables and `modeCount` still `10`. Nothing was left behind.

Per run the gate creates three variables (STRING source, STRING alias, COLOR), writes a raw
string, a raw color (`{r:1,g:0,b:0,a:0}` → `#ff000000`), and an alias; forces an
`alias_cycle` refusal; then deletes all three and proves absence on a later frame.

## 🔴 What the live gate found: `delete_variable` could never report success

The first live run (channel `hvq0orwg`) **failed**, and the failure was real. All three
deletes returned `removalObserved: false` / `delete_not_observed` — yet a later read proved
all three variables were **genuinely gone**. The handler's own success branch was
unreachable on the real platform:

```js
const after = await figma.variables.getVariableByIdAsync(variable.id);
if (after) { /* → success:false, "the deletion did not happen" */ }
```

It stayed green offline because the harness modelled `remove()` optimistically — in its own
words, *"remove() makes the next lookup miss"* — so it spliced the variable out immediately
and the branch was reachable **only** in the fixture. Same family as the R3-A 1.2 finding
that `isRemote` could never be true.

### The four signals, measured rather than assumed

The fix probes independent signals and **names** the one that observed the removal, so the
live run answers the diagnostic question as a by-product instead of needing a throwaway
probe and a second plugin reload:

| signal | live result on `hxpwe1ej` | reading |
|---|---|---|
| `lookupResolved` | `true` | `getVariableByIdAsync` serves a **stale** object in-frame. This is the original defect's root cause, now measured. |
| `removedFlag` | `null` | Figma's `Variable` exposes **no** `removed` boolean. Pinning the fix to it would have shipped a second unreachable path. |
| `collectionStillLists` | `false` | **Collection membership updates immediately.** This is the signal that works. |
| `property_access_threw` | not reached | Fallback only. |

⛔ The obvious hypothesis — *"Figma commits at frame end, so nothing is observable in-frame"* —
is **half wrong**, and the wrong half is the load-bearing one. The lookup is stale; membership
is not. A fix pinned to the lookup alone would have been permanently deferred.

### The contract when nothing can be observed

When no signal fires, the handler reports `outcome: "removal_unconfirmed"` with
`verificationDeferred: true` and `partialApplicationPossible: true` — deliberately **not**
success:

> A real deletion and a no-op `remove()` are byte-identical from inside that frame, so the
> handler declines to guess and the **caller** confirms absence on a later read.

⚠️ **This path never executed live** (membership always fired). It is covered by offline
tests but is live-**unexercised** — an offline-covered fallback, not a live-validated one.

## The instrument fix: a mode-blind reader proves less than it looks

`get_variables` emits one entry per **(mode × variable)**. The gate's original reader did a
flat `.find()` by id, so it returned whichever mode was ordered first — not necessarily the
mode the write targeted:

```js
// before — reads an arbitrary mode
allVariables(snapshot).find((variable) => variable.id === id)
```

Two consequences, both fixed before acceptance was claimed:

1. On a multi-mode collection it could read the wrong mode → a false FAIL, or a pass by
   ordering luck.
2. On a **1-mode** collection the read is unambiguous, but *"wrote the mode I named"* and
   *"wrote every mode"* become the same bytes — the run cannot detect a write-all bug.
   Running the gate against a single-mode target would have looked clean and proven less.

The gate now selects the target mode by id, baselines **every** mode before any write, and
asserts that each write left every non-target mode byte-identical to its baseline. The
refused alias cycle is held to the same standard.

## Reproduction

```sh
bun socket                                    # relay on 3055, required
# reload the DEV plugin in Figma first — that is what moves pluginBuildId
# Phase 2 — the three write tools
node scripts/live-variable-write-gate.mjs \
  --channel=<DEV-plugin-channel-for-a-disposable-file> \
  --collection-id=<existing-local-MULTI-mode-collection-id> \
  --disposable-target=true

# Phase 3 — layered resource identity
node scripts/live-variable-identity-gate.mjs \
  --channel=<DEV-plugin-channel-for-a-disposable-file> \
  --collection-id=<existing-local-collection-id> \
  --disposable-target=true

# Phase 4 — mode removal, and the authorized residue cleanup
node scripts/live-variable-mode-removal-gate.mjs \
  --channel=<DEV-plugin-channel-for-a-disposable-file> \
  --collection-id=<local-collection-with-≥2-modes-and-room-for-one-more> \
  --disposable-target=true \
  --residue-collection-id=<collection-holding-the-authorized-residues>
```

For the **Phase 2** gate prefer a **multi-mode** collection: on a single-mode target the
isolation assertions are vacuous. Cleanup is best-effort and only drops a variable from its
retry list once absence is **proven** by the cross-frame re-read.

The **Phase 3** gate asserts nothing about modes, so prefer the *smallest* collection
available — a single-mode target is the smaller blast radius at no cost in coverage.

⛔ Read the verdict from the report's `success` field, not from the printed line, and
confirm cleanup with a read from a **separate** client session: the gate asserting its own
cleanup is the instrument checking its own precondition.

## Offline coverage

`bun run verify` — **395/395**, 70 tools, `dist/` pair rebuilt **byte-identical** to the
`sha256:7493a32a…6822d309` the Phase 3 gate recorded in its `artifactHashes`, so the live
run and the offline suite provably exercised the same build.
`tests/variable-write.test.mjs` now includes the leg that would have caught the defect:

- *a `remove()` that does nothing is indistinguishable IN-FRAME and is caught only by the
  cross-frame re-read* — asserts the no-op produces a **byte-identical** in-frame verdict to
  an honest delete, then fails on the later read. This is the known-bad leg.
- three tests covering each `observedBy` branch (`lookup_missed`, `removed_flag`,
  `collection_membership`).

`tests/helpers/plugin-harness.mjs` models Figma's frame-end commit: `remove()` queues, the
dispatcher commits **after** the reply is built, and `variableRemovalSignal` selects which
in-frame signal a modelled platform exposes. The default `"none"` is the conservative case.


**Phase 4** adds **fifteen** more (offline **410/410** total), in
`tests/variable-write-capability.test.mjs` and `tests/set-fill.test.mjs`:

- both guard-rail refusals, each asserting `removeMode` was **never called** — a refusal
  that fires after the platform call is a different receipt with the same first word;
- the `confirm` gate against `undefined`, `false`, `"true"`, `1` and `{}`, because a
  truthy value is not a confirmation;
- ⭐ **the deferral as the DEFAULT outcome.** `modeRemovalSignal` defaults to `"none"`, so a
  green `removed` receipt is something a signal has to earn here rather than the resting
  state — and the same test then proves the removal really landed at frame end, which is
  what makes the receipt's "re-read later" instruction honest rather than a hedge;
- one test per observation signal, including a `"fresh_lookup"` arm where the resolved
  object **still lists** the mode — without it the second probe could be dead code and
  every test would still be green;
- the four gradient types × `color`, with the SOLID path exercised in the same test as the
  control, plus a schema test asserting the published description stopped advertising a
  drop the handler no longer performs.

⛔ The sole-remaining-mode test points the collection's default at another mode first.
Without that the default guard would fire first and the sole-mode branch would sit unproven
behind it — a refusal reached for the wrong reason is an unfired assertion.
## Open debts

- ✅ The `deleteVariable` comment correction travelled with R3-A Phase 3's real `code.js`
  identity change. It now names the live fact that the lookup is stale **but collection
  membership updates in-frame** — the observation that makes the success path reachable.
  It was not shipped as a comment-only plugin rebuild.
- ✅ **Phase 3's live identity gate is PAID** — twice on `lkm6ne6h`, see the acceptance
  section above. `create_variable`'s four-layer resolution and its `name_type_conflict`
  refusal are live evidence, not harness behaviour.
- ✅ **`delete_variable`'s success path is live-proven.** `removalObserved: true` on both
  cleanups is the first live confirmation of the Phase 2 defect fix.
- ⏳ **The `removal_unconfirmed` deferral path is offline-covered but live-unexercised, for
  BOTH destructive tools.** Phase 3 did not reach it for `delete_variable`
  (`collection_membership` answered every time) and Phase 4 did not reach it for
  `remove_variable_mode` (`resolved_collection_modes` answered all eight times). That is
  exactly the branch an in-frame signal makes rare — it stays unproven live, deliberately,
  because manufacturing it would mean faking a platform that does not behave that way.
- ✅ **The 6 Phase 1.3 residues are GONE — removed live 2026-08-24 on `yizlybxy`**, each with
  its own fresh-read verification, and confirmed by a read from a separate client session.
  *"8. Dimensions"* is at 4 modes and the document-wide `modeCeiling.knownGoodAtLeast` fell
  10 → 4. ⭐ The debris and the plan item that would clear it closed together, as intended.
- ⏳ **`sole_remaining_mode` is live-UNREACHABLE and stays unproven.** A collection down to
  one mode has that mode as its default, so `default_mode` refuses first. Offline-covered
  only, by pointing the harness's default elsewhere. Defence-in-depth, not a measured path.
- ⏳ **`remove_variable_mode` is still `additive-preview`.** Promotion to `stable` rewrites
  `contractPayload.tools`, moves `serverBuildId` and re-stales every gate — it is an
  acceptance act to be spent deliberately, not a side effect of a passing gate.
- ⏳ The remaining Phase 2 table in [`VARIABLE-WRITE-PLAN.md`](VARIABLE-WRITE-PLAN.md)
  (collections, bindings) is untouched. ⭐ **The modes row is now complete**:
  `add_variable_mode` and `remove_variable_mode` are both live-accepted.
