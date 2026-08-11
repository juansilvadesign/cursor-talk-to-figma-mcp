# Variable-Write Plan — the variable half of R3

> **Status: planned, not started.** Cut 2026-08-07 from a real consumer gap.
> Scope decided with the maintainer: **the full variable half of R3** — collections,
> modes, variables, aliases, *and* node bindings — preceded by the one R0 guard the
> fork's own [`TASKS.md`](../TASKS.md) says must exist before any new tool lands.
>
> This plan owns **variables only**. R3's paint/text/effect/grid *styles* and its
> component/variant authoring stay coarse until they are cut separately.

## Why this is being cut ahead of R1/R2

The fork's [`ROADMAP.md`](../ROADMAP.md) places variable authoring at **C7 → R3**, and
`TASKS.md` says *"keep coarse until R2 is accepted."* This plan deliberately jumps that
queue, for a reason that is recorded rather than assumed:

A real consumer hit the gap. The `umjuansantos` design-system reconciliation
(`knowledge/projects/umjuansantos/TASKS.md` §1.4) produced a machine-verified,
~10-edit correction list against a live file — and **not one of those edits is
executable through the current tool set.** `get_variables` reads the whole variable
tree faithfully; nothing can write a single value back. The audit is therefore
reduced to a hand-transcription list.

That is the exact shape of a legitimate fork task under the dependency rule: *"When a
consumer finds a missing Figma fact/capability, implement the smallest generic tool or
additive field here, test it here, rebuild `dist/`, and assign a new pin."*

⛔ **What this plan does not do:** it does not import OpenDesign identifiers, slot
names, or any `umjuansantos` token vocabulary. The consumer's correction list is the
*motivation*; the tools stay Figma-native and consumer-neutral.

## Phase 0 — the guard that must land first

`TASKS.md` ▶ item 3 is explicit: *"Add server-schema ↔ plugin-dispatch parity checks
**before adding a new tool**."* This phase is the minimum slice of R0 that satisfies
that, and nothing more. Runtime fingerprinting, the full fixture harness, and the
release mechanics stay in R0 proper.

The repository already carries most of the contract surface — this phase makes it
enforceable rather than inventing it:

| Surface | Where it lives today |
| --- | --- |
| Command-name union `FigmaCommand` | `src/talk_to_figma_mcp/server.ts` ≈ L2888 |
| `CommandParams` name → params interface | `src/talk_to_figma_mcp/server.ts` ≈ L3001 |
| Plugin dispatcher `case "…":` labels | `src/cursor_mcp_plugin/code.js` ≈ L129+ |
| Registered MCP tools | `server.tool(...)` calls throughout `server.ts` |

- [ ] **0.1 Extract all four surfaces mechanically.** Parse the `FigmaCommand` union and
      `CommandParams` keys from `server.ts`, the `case "…"` labels from `code.js`, and the
      `server.tool()` names. Regex is acceptable for the plugin (it is a flat dispatcher);
      prefer the TypeScript AST for `server.ts` so a reformat cannot break the check.
- [ ] **0.2 Assert the bijection.** Every `FigmaCommand` has a plugin handler; every public
      plugin command has a server schema. **Connection-only commands (`join`, and the
      `update-settings`/`notify`/`close-plugin`/`execute-command` UI messages) are excluded
      by an explicit allowlist**, not by a name heuristic — `TASKS.md` 0.1 already requires
      connection plumbing to stay distinct from document commands.
- [ ] **0.3 Commit a contract snapshot.** Serialize tool name, direction
      (`read|write|connection`), input schema, and timeout class to a checked-in JSON.
      The test fails on any unreviewed removal or incompatible parameter change; additive
      fields pass.
- [ ] **0.4 Wire one documented test command** into `package.json` (`TASKS.md` 0.2 asks for
      exactly one). Phase 1+ tests attach to this same command.

✅ **Phase 0 acceptance:** the parity test passes on the current 48 tools, and fails if a
`case` label or a `CommandParams` entry is deleted. Prove the failure mode deliberately —
a guard never observed failing is not a guard.

## Phase 1 — read-side capability probe

Writes need an honest, *pre-flight* answer about what this file and this Figma plan will
actually permit. R3 requires *"explicit Figma-plan capability responses"*, and the read
layer already established the pattern to mirror: `hasVariablesApi()` in `code.js` L631.

- [ ] **1.1 Extend the guard to the write API.** `hasVariablesApi()` currently checks only
      the three read entry points. Add a sibling `hasVariableWriteApi()` asserting
      `createVariable`, `createVariableCollection`, `createVariableAlias`.
- [ ] **1.2 Add `get_variable_capabilities`** (read tool, cheap, no mutation). Returns:
      whether the write API exists · whether the document is editable · the current
      **mode ceiling** and how many modes each local collection already uses · per-collection
      `isRemote`. This is what lets a client fail *before* a partial write.
- [ ] **1.3 Probe the mode ceiling honestly.** ⚠️ **Multiple modes per collection are a paid
      Figma-plan feature and `addMode()` throws when the ceiling is hit.** Do **not** hardcode
      a plan→limit table — plan tiers change and the fork cannot see billing. Report the
      *observed* ceiling: report known-good (existing mode count) and surface the thrown
      error verbatim on the first refusal. ⛔ Never probe by speculatively creating and
      deleting a mode in a user's real file.

## Phase 2 — the variable write tools

All tools are **local-only**. ⛔ `remote: true` variables and collections belong to a
published library and must be rejected with a typed refusal, never silently skipped.

| Tool | Figma Plugin API | Notes |
| --- | --- | --- |
| `create_variable_collection` | `figma.variables.createVariableCollection(name)` | Returns collection id + its single default mode id |
| `add_variable_mode` | `collection.addMode(name)` | ⚠️ Throws at the plan ceiling — surface, don't swallow |
| `rename_variable_mode` | `collection.renameMode(modeId, name)` | |
| `remove_variable_mode` | `collection.removeMode(modeId)` | Destructive — see the destructive-boundary rule below |
| `create_variable` | `figma.variables.createVariable(name, collection, resolvedType)` | `resolvedType` ∈ `COLOR｜FLOAT｜STRING｜BOOLEAN` |
| `set_variable_value` | `variable.setValueForMode(modeId, value)` | Accepts a raw value **or** an alias — see 2.2 |
| `set_variable_metadata` | `variable.name` / `.description` / `.scopes` | Rename + scope correction in one tool |
| `delete_variable` | `variable.remove()` | Destructive |
| `bind_variable_to_node` | `node.setBoundVariable(field, variable)` | Plain fields (width, characters, fontFamily…) |
| `bind_variable_to_paint` | `figma.variables.setBoundVariableForPaint(paint, 'color', v)` | ⚠️ **Returns a NEW paint** — must be written back into `node.fills`/`strokes` |

- [ ] **2.1 Mirror the existing colour convention.** `CLAUDE.md` records it: Figma uses RGBA
      0–1 and the tools accept 0–1 floats. ⛔ Variable-write tools must not quietly introduce
      a hex-string input where every sibling tool takes floats. Accept 0–1; document it.
- [ ] **2.2 Aliases are a value, not a separate tool.** `setValueForMode` takes either a raw
      value or `figma.variables.createVariableAlias(target)`. Model this as a discriminated
      input on `set_variable_value` (`{value}` XOR `{aliasOf}`) rather than a parallel
      `set_variable_alias` tool — the read layer already serializes aliases as
      `{type:"VARIABLE_ALIAS", id}`, so write input and read output stay symmetric.
- [ ] **2.3 Guard the alias graph.** Reject a self-alias and any cycle before writing.
      Figma will refuse some of these, but a typed pre-check gives a better error than a
      plugin exception and cannot leave a half-applied batch.
- [ ] **2.4 Typed partial results on every multi-target call.** Per the cross-cutting rule
      *"Writes are exact and auditable"*: return per-item `{ok, id, matchedBy, error}`.
      ⛔ A batch that half-applies must never report success.
- [ ] **2.5 Destructive boundary.** `delete_variable` and `remove_variable_mode` require an
      explicit `confirm: true`. `TASKS.md` C5 already names *"explicit destructive
      boundaries"* as a fork responsibility.

## Phase 3 — resource identity

This closes the standing open question *"R3 — resource identity: plugin data, Figma
keys/IDs, explicit caller key, or a layered strategy?"* — the plan's proposed answer is
**layered**, resolved in a fixed order and always reported back:

1. Explicit `id` when the caller supplies one → `matchedBy: "id"`.
2. Else `collectionId` + exact variable `name` (the natural Figma key; names are unique
   within a collection) → `matchedBy: "name"`.
3. Else an optional caller-supplied `identityKey` stored via `setPluginData` →
   `matchedBy: "identityKey"`.

- [ ] **3.1 Always return `matchedBy`.** A client must be able to tell an update from a
      create without a second read.
- [ ] **3.2 Prove additive reruns do not duplicate.** R3 requires this explicitly. Run the
      same create twice with an `identityKey`; assert one resource and `created:false` on
      the second pass.
- [ ] **3.3 ⛔ Keep `identityKey` opaque.** It is a caller-chosen string. The fork must never
      interpret its content or assume a consumer's naming scheme.

## Phase 4 — tests, dist, and the pin

- [ ] **4.1 Offline fixtures** for: alias resolution, a mode-ceiling refusal, a remote-variable
      refusal, a cycle refusal, and an additive rerun. Reuse the real-`code.js` VM/stub
      approach `TASKS.md` 0.2 describes.
- [ ] **4.2 Live acceptance on a disposable file** — ⛔ **never** on a real design-system file.
      Record server + plugin identity in the acceptance note, per *"Local runtime honesty."*
- [ ] **4.3 Rebuild and commit `dist/`.** ⚠️ Load-bearing: `.mcp.json` points at the fork's
      `dist/server.js`, and upstream's published npm package does **not** contain the fork's
      tools. A source-only change ships nothing to the running agent.
- [ ] **4.4 Re-run the Phase 0 parity test** — ten new commands are exactly the case it exists
      to catch.
- [ ] **4.5 Assign a new pin** and let consumers adopt it on their own schedule.

## Acceptance

A generic MCP client can create a variable collection, add a mode where the plan allows,
create typed variables, set raw and aliased values per mode, rename/rescope/delete them,
and bind them to node fields and paints — receiving typed per-item outcomes, an honest
capability report instead of a silent failure, and no duplicates on rerun.

**Consumer proof (not a substitute for fork fixtures):** the `umjuansantos` §1.4 list
becomes executable end-to-end — the `Inter` → Caslon/Source Serif 4 corrections, the new
`Text/brand` semantic token aliased per mode, `Family/Accent`, the purple `Main/Secondary`
ramp removal, and the `Main/Primary/25` fix.

## Upstream posture

Every tool here is generic Figma capability with no fork-specific coupling, so this is
**PR-eligible** under RM12. Offer it source-only (Grab's convention — feature PRs touch
zero `dist/`), and ⛔ never let upstream timing gate the local build. PR #184 has been
open and unreviewed since 2026-07-16; that is the expected latency, not a blocker.
