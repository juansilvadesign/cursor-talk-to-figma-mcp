# R3-A retrospective and R3 re-cut

> **Planning decision — 2026-08-25.** R3-A is accepted. R3 remains one larger
> design-system-authoring plan, delivered through independently accepted internal phases.
> Its first phase closes the fork's own unmeasured live-gate premises before broadening the
> style or component surface. This is a planning record: it authorizes no tool build by
> itself.

This record is deliberately at the repository root. `docs/*` is ignored behind an allowlist;
a new retrospective placed there could look written locally while having no durable Git path.

## Baseline re-derived before the retrospective

The handoff header described the pre-addendum `1.17.0` state. The accepted current release is
**R3-A `1.18.0` / 77 public tools**:

- `r3-a-server-b5649366daef` ↔ `r3-a-plugin-7f0d5389634e`
- `sha256:de4144fe6776b8283bc8c8af06f6517d69acc3d97271fee2f1c9a8ce338999e9`
- 66 `stable`, 10 `additive-preview`, and 1 `legacy` result contracts
- 450/450 offline checks passed before live acceptance.

R3-A's **11 core variable capabilities** are all live-accepted and stable:

1. `get_variable_capabilities`
2. `create_variable_collection`
3. `add_variable_mode`
4. `rename_variable_mode`
5. `remove_variable_mode`
6. `create_variable`
7. `set_variable_value`
8. `set_variable_metadata`
9. `delete_variable`
10. `bind_variable_to_node`
11. `bind_variable_to_paint`

`delete_variable_collection` is a twelfth, **fork-gate-coverage addendum**. It remains
`additive-preview`: the empty/non-empty safety boundary and one real observation signal are
live-proven, but its observation block is intentionally allowed to grow with future Figma
behaviour. It did not decide the separate consumer ramp-cleanup choice.

The live ledger is stronger than the original release claim:

| Evidence | What was measured |
| --- | --- |
| `1.15.0` then `1.16.0` | 18 gates passed on each build; the first pass froze the contract and the second validated the Phase 2 promotion. |
| `1.17.0` | All 19 current gates were re-pinned and re-run after the capability-probe promotion. |
| `1.18.0` | The new collection-deletion gate plus all 19 prior gates passed: **20/20** on disposable channel `2v56aacl`. A separate client session restored and checked the canonical baseline: 9 collections, 25 pages, current page `0:1`. |

The source records are [R3-A evidence](docs/R3-A-VARIABLE-WRITE.md), the [variable plan](docs/VARIABLE-WRITE-PLAN.md), and the live-pin [ledger](tests/live-gate-pins.test.mjs).

## What R3-A taught the fork

### Tool defects and instrument defects are different work

R3-A did find real tool/contract defects, but the records are lopsided toward **instruments
that were not asking a discriminating question**. They must be tracked with the same severity
as a handler defect because either kind can fabricate a green release.

| Classification | Measured example | Retrospective conclusion |
| --- | --- | --- |
| Tool observation defect | `delete_variable` initially checked only `getVariableByIdAsync()` after `remove()`. Figma returned a stale object in-frame, so its success branch was unreachable even after a real deletion. | A destructive write must probe independent observations and return an honest deferral when none distinguishes a mutation from a no-op. |
| Tool/contract honesty defect | `get_variable_capabilities` originally implied a remote-collection inventory even though the local API can never enumerate remote collections. | An unavailable observation must be named unavailable; a default value is not evidence. |
| Adjacent tool defect paid during R3-A | `set_fill` silently discarded `color` on gradient inputs. | An accepted argument must be applied or refused; result-schema compatibility alone cannot prove handler honesty. |
| Gate dead path | The collections/bindings gate walked `snapshot.nodes`, although `get_node_variables` returns a top-level `bindings` array. Both binding assertions could only fail. | A gate needs a known-good and known-bad live discrimination, not merely a receipt it expects to see. |
| Fixture invented a platform rule | Offline checks assumed ordered `scopes` and an error for duplicate mode names. Live Figma reordered the former and accepted the latter. | Fixtures model known facts, not preferred product rules. A platform premise that has not been measured remains a premise. |
| Gate asserted a superseded contract | The variable-write gate still demanded `create_variable` say “not an upsert” after Phase 3 deliberately made it create-or-match. | Gate assertions are versioned contract consumers and must change in the same release as the contract they assert. |
| Assertion could never prove the claimed fact | A mode-removal gate compared full membership `blastRadius.variableCount` with a type-filtered `get_variables` count; the numbers describe different populations. | Every equality has to identify the population and vary under the intended mutation. |
| Pin/runner defects | Stale `release: "R2"` assertions, a parser that did not read that pin, and an aggregator that treated export's missing `success` field as failure all surfaced in re-runs. | Runtime pins and verdict protocols are executable contract surface, not comments. |

**Decision:** before an R3 gate can be accepted, it must state (a) the platform fact it is
testing, (b) the live mutation or control that makes the result vary, (c) the independent
read that can falsify the receipt, and (d) what an unmeasured result means. A gate may not
turn `unmeasured` into a pass, and a known-bad pin or input must be shown to stop before its
first mutation when that boundary is part of the gate's trust model.

### `additive-preview` did its intended job

The level was not a way to ship untested behaviour. It created room for receipts to become
honest on their first contact with Figma:

- Five R3-A collection/binding tools were held at `additive-preview` for one release. Their
  observation blocks grew during the 18-gate pass, then they were frozen and promoted.
- Two of those changes rejected offline fiction rather than “improving” a tool: `scopes` is a
  set, and duplicate mode names are a live Figma reading rather than a typed refusal.
- `delete_variable` grew from one stale lookup into a multi-signal observation block; the
  success receipt names `collection_membership`, and an unobservable branch returns
  `removal_unconfirmed` rather than success.
- `get_variable_capabilities` replaced an implicit remote inventory with an explicit
  limitation. Its original “stable ceiling” promotion condition was retired as unpayable:
  the tool always reports a null numeric ceiling because Figma exposes no such read API.

**Decision:** a preview tool's promotion criteria must name receipts and observations the
fork can actually measure. A criterion that depends on a sibling tool, a static default, or
a future Figma API is not an acceptance criterion. Once a tool is stable, result-shape
growth remains a public-contract event. `delete_variable_collection` stays preview under
that rule; this retrospective does not invent a promotion threshold for it.

### The live gate suite is a release-cost budget

A public contract/build move currently costs more than editing pins:

1. regenerate and inspect the runtime identity;
2. load the correct server/plugin pair, including the measured reload/respawn shape;
3. prove the gate's bad-pin refusal before trusting a green run where applicable;
4. re-pin **every current gate** and run each against the new pair;
5. prove cleanup and record the final document baseline from a separate client session.

The measured current cost is **20 live gates per build move**. The records do not contain a
single aggregate elapsed-time metric, so this plan does not manufacture a minutes-per-build
estimate. The cost is nevertheless concrete: the 16-gate re-run exposed four gate defects,
and the 19- and 20-gate re-runs caught pin/protocol/precondition work that a pin-only edit
would have hidden.

**Decision:** R3 does not adopt one live gate per tool. R3-A already used gates as
acceptance scenarios: several tools are exercised by one risk-focused gate, while novel
destructive boundaries and platform-limit premises receive dedicated gates. R3 continues
that model:

- one gate per **independent platform risk or acceptance scenario**, not one schema name;
- every public tool is covered offline; every new live gate names exactly which tools and
  claims it exercises;
- no historical gate is removed to reduce the cost; public moves still re-run the whole
  current suite;
- phase work that would move the build is batched deliberately within its phase, never
  hidden behind an untested re-pin.

## `stillOwed` is a roadmap input, not a passing footnote

The outstanding premises split into missing generic capability, intentionally unavailable
evidence, and material that needs a different kind of instrument. This prevents R3 from
claiming that every `stillOwed` entry should become a write tool.

| Current premise | Why it remains unmeasured | R3 disposition |
| --- | --- | --- |
| GROUP constraint behaviour | The constraints gate cannot author a controlled GROUP because the fork has no group-creation operation. | **Phase 1:** add a generic group-creation/ownership primitive and a controlled GROUP premise gate. |
| Mixed-font/range behaviour | The text gate cannot create a mixed-font target: no range-font setter exists, and no supplied mixed node is a reproducible fixture. | **Phase 1:** add a generic range-font setter with a mixed-text control and independent range readback. |
| Paint-style detachment | The fill gate cannot bind a local paint style (`set_fill_style` does not exist), and its disposable fixture cannot manufacture that state. | **Phase 1:** add the smallest generic local paint-style attachment operation; its gate uses a named local style on an approved disposable fixture and reports a missing precondition as unmeasured. |
| Effect-style detachment | The effects gate likewise cannot bind an effect style. | **Phase 2:** local style authoring includes the appropriate effect-style lifecycle/attachment surface and closes this specific gate premise. |
| Write inside an instance | The clips gate cannot create a component and instance to make the context. | **Phase 3:** component/instance authoring owns this premise; do not claim it earlier. |
| Destructive `removal_unconfirmed` branch | It is deliberately rare: real Figma supplied an in-frame observation for all three destructive handlers. Manufacturing a failure would fake platform behaviour. | Keep as an explicitly offline-covered fallback, not an R3 tool requirement. |
| Sole remaining variable mode | Figma makes the sole mode the default, so the earlier default guard always fires. | Keep as defence-in-depth and offline-only; do not add an unsafe bypass merely to create a live branch. |
| Visual direction and render-timing notes | Some claims require retained-image inspection or a future read/instrument surface, not another write command. | Keep explicit; evaluate separately if a generic read capability is justified. |

The first three rows are the owner-approved measurement-first scope. They are generic Figma
capabilities, do not import a consumer model, and make pre-existing fork claims testable.

## Re-cut R3 — one release plan, independently accepted internal phases

R3 remains the design-system authoring release. It is **not** a single bulk contract change:
the phases below are independently scoped and each earns its own gate before the next begins.
That is a larger plan with internal phases, not a promise that all public changes wait for one
final mega-build. A public move in any phase still gets the mandatory suite re-pin/re-run.

### Phase 0 — gate-authoring protocol (planning accepted now)

No public tool is added in this phase. Before the first implementation plan is approved:

- name every prospective gate's platform fact, control, independent observation, cleanup
  path, and `stillOwed` fallback;
- define the target as an owner-confirmed disposable file and require
  `--disposable-target=true` at the runner boundary;
- decide whether the gate must prove its bad-runtime/bad-confirmation refusal before its
  first mutation;
- write offline known-bad fixtures that show the assertion would fail under the old or
  dishonest implementation.

**Acceptance before build:** every Phase 1 proposal contains this small gate design, a
documented baseline/cleanup path, and no hand-edited production resource as a hidden fixture.

### Phase 1 — generic measurement enablers

Purpose: turn three current fork-only unknowns into measurable behaviour before adding broad
design-system CRUD.

Planned capability boundaries (exact public names and schemas are a later implementation
design, not pre-decided here):

1. **Group creation/ownership.** Create a group from explicitly resolved local scene nodes,
   with a documented parent/position consequence. This enables a controlled GROUP child for
   the constraints gate.
2. **Range-font mutation.** Set a loaded font over an explicit character range, refusing
   invalid ranges, unloaded fonts, and unsupported targets before a partial write. This
   enables a reproducible mixed-font fixture and a direct range readback.
3. **Local paint-style attachment.** Attach or clear an explicitly resolved local paint style
   on a supported node. It is initially an attachment capability, not an implicit style
   importer or a remote-library operation. It enables the fill gate to measure style
   detachment rather than infer it from an unstyled node.

Each gate must own or explicitly name every fixture resource, use a control case that can
falsify the claimed effect, clean up from `finally`, and obtain a fresh independent baseline
read. If a required local style is not present in the agreed disposable fixture, the gate
reports `unmeasured` and does not promote the capability by substitution.

**Phase 1 acceptance:**

- the GROUP, mixed-font, and paint-style premises each have a distinct live gate result;
- each result changes under the planned mutation and remains distinguishable from its control;
- no new resource survives the run, confirmed from a separate client session;
- all then-current gates are re-pinned and re-run on every public build move.

### Phase 2 — local style authoring

Purpose: deliver the remaining generic local paint, text, effect, and grid style surface,
using Phase 1's attachment discipline rather than consumer-specific token names.

Scope is local-only style lifecycle work: discover/resolve exact local resources, create or
update only after validation, apply to supported node fields, and state remote/library
limitations explicitly. Style creation and deletion/cleanup semantics must be decided before
implementation so a live gate never leaves a permanent style behind by surprise.

This phase explicitly owns the effect-style attachment/detachment premise left by
`live-effects-gate`. It may add a dedicated effect-style operation if that is the smallest
generic way to make the premise measurable; it must not claim `set_fill_style` proves it.

**Phase 2 acceptance:** a disposable fixture can exercise a local paint, text, effect, and
grid style through the public contract, prove the relevant style id/value/readback facts, and
restore its document baseline. Unsupported or remote style paths produce typed refusals or
declared limitations, never a silent local-only success.

### Phase 3 — components, variants, and instances

Purpose: add generic component authoring after style contracts and gate discipline are proven.

The sequence is intentionally narrow: component creation/ownership and instantiation first;
then variant composition and component properties; then instance property changes. Each part
must settle exact identity, duplicate/rerun behaviour, and unsupported instance-child writes
before it adds the next part. Code Connect, library publishing/import, and OpenDesign mapping
remain out of scope.

This phase owns the currently unmeasured instance-child write premise in the clips gate: it
can create its own component/instance control rather than accept a manually prepared file.

**Phase 3 acceptance:** owned component/variant/instance fixtures are created, mutated,
read, and cleaned up through generic tools only; expected restrictions on instances are
observed or explicitly reported; all current live gates remain green on the moved build.

### Phase 4 — R3 release closure

R3 is accepted only when every completed internal phase has its durable evidence, all result
stability decisions are explicit, and the full gate suite is current for the final runtime
pair. Consumer proof may run after that as a separate integration acceptance; it can inform a
future generic gap but does not redefine this release.

**R3 acceptance:** generic MCP clients can measure and author local design-system resources
and component primitives through documented, Figma-native contracts; every claim of live
behaviour has a discriminating gate, and every remaining unknown is named rather than
silently treated as support.

## Operating rules for every R3 phase

- **Planning stays consumer-neutral.** No brand, OpenDesign, code-generation, or consumer
  token vocabulary belongs in the fork contract or its gates.
- **A disposable acknowledgement is mandatory.** A channel is transport, not proof that the
  file is disposable.
- **Observe before claiming.** A receipt may say `unconfirmed`/`unmeasured`; it may not use a
  static or self-authored value as proof of a Figma fact.
- **Re-pin is not re-run.** Any public build move updates and executes every current live
  gate; a stale-gate declaration is removed only after that run.
- **Batch intentional build moves.** Combine compatible contract changes inside a phase so
  the 20-plus gate replay is paid once per phase, never repeatedly for incidental edits.
- **Do not manufacture platform failure.** Live-unreachable defensive branches remain
  offline-covered unless a genuine Figma setup exposes them safely.

## What this re-cut does not decide

- It does not authorize a consumer-file write or the `umjuansantos` proof; that remains a
  separately authorized consumer acceptance.
- It does not commit to a calendar, an exact tool count, or a semantic-version sequence.
- It does not promote `delete_variable_collection` or rewrite a stable receipt merely to
  simplify future gates.
- It does not reopen remote/team-library import, Code Connect, or any dependency that points
  from this fork back into a consumer.
