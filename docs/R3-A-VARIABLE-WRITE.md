# R3-A Phases 2–3 — the variable-write slice

The record doc for the first three variable **write** tools: `set_variable_value`,
`create_variable`, and `delete_variable`. Phase 1's read/probe work is recorded in
[`VARIABLE-WRITE-PLAN.md`](VARIABLE-WRITE-PLAN.md) §§ *1.1–1.3*; this file owns Phase 2
(the three write tools) and Phase 3 (layered resource identity for `create_variable`).

> ⚠️ The gate in this document **creates, aliases, rewrites and deletes real variables**.
> Every invocation requires `--disposable-target=true`, and a channel is transport, not
> evidence that the file behind it is disposable.

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
- ⛔ **This fork exposes no mode-removal tool.** `add_variable_mode` is documented as never
  calling `removeMode`, and there is no `delete_variable_mode`. The debris can only be
  cleared **by hand in Figma**.
- ⚠️ Consequence: *"8. Dimensions"* is pinned at the 10-mode ceiling by junk, so
  `get_variable_capabilities` honestly reports `modeCount: 10` for it and any real
  `add_variable_mode` against that collection will be refused until the modes are deleted.
  ⭐ A refusal there would be a **true** ceiling report about a **false** ceiling cause.

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
- ⏳ The `removal_unconfirmed` deferral path is offline-covered but live-unexercised. Phase 3
  did not reach it: `collection_membership` answered on every delete, which is exactly the
  branch that makes the deferral rare.
- ⚠️ **6 leftover Phase 1.3 modes sit in *"8. Dimensions"* on the disposable starter file**
  and no tool in this fork can remove them — see the Phase 3 acceptance section. Hand
  deletion in Figma is the only route.
- ⏳ The remaining Phase 2 table in [`VARIABLE-WRITE-PLAN.md`](VARIABLE-WRITE-PLAN.md) (modes,
  collections, bindings) is untouched. Phase 3 resource identity is implemented and
  offline-gated at `1.13.0`; its disposable-file live gate remains unrun.
