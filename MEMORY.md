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

## ▶ Live resume state

### ✅ Shipped and green

- **Phases 1 + 2 BUILT**, and the **5.5 live gate PASSED 2026-08-12** — channel `8fbuzws2`, run twice, green on the first run (`953755a`, 🟡 2 unpushed). `apply_batch` executes against a real Figma file. 98 tests, 5 baselines green.
- ✅ **3.1 + 3.2 + Phase 4 COMMITTED (`664135b`), offline gate PASSED 2026-08-12** — contract regenerated to **1.6.0**, `dist/` rebuilt and deterministic, **114/114 tests**, all 5 baselines replayed individually.
  - ⚠️ The earlier note claiming "1 test fails by design" was **wrong — 5 failed**, all the same stale-contract class, all cleared.
- 🟡 8 files uncommitted (7 generated + `scripts/live-batch-gate.mjs`), **held back deliberately** until the live gate actually passes.

### ⛔ The pairing hazard — read before touching a running session

The server and plugin builds are a **matched PAIR**. Current pair:

```
r2-server-d248ed7bc295  ↔  r2-plugin-53a1fa676d6a   (sha256:d39aefef…ca6289)
```

- ⛔ **A running Figma session is incompatible until the DEV plugin is re-run *and* the server respawned.** Restarting one side only looks like success.
- ⚠️ **The pair ID moves on every rebuild** — it moved twice already (`r2-server-9239fd0bc71b ↔ r2-plugin-d0342abb6c4a`, 53 tools, was the 5.5 pair).
- 🔴 **A fingerprint only covers what it hashes.** A whole contract change once regenerated to a **byte-identical** hash. Read the hash's inputs before trusting it — **pairing ≠ contract identity**.

### 🔴 Known-false claims in the shipped surface

- **Per-op atomicity is FALSE, and now observed.** The proven list grew **3 → 5**: `move_node` and `set_stroke_color` reproduce **partial writes**, rejected by the *Figma property setter* rather than by our envelope.
- **The tool description's "same shape as the standalone tool" is FALSE** for `set_fill_color` / `set_stroke_color` — the batch params are the **plugin-handler** shape, not the standalone shape. ⛔ Fix this **together with 3.1**, never on its own.
- ⭐ **Envelope refusals arrive in two different shapes through MCP:** a duplicate `id` returns an **error result**, while a bad `op` **throws**. A result-only harness reads the thrown one as a crash.
- ⭐ **The chunk pause must be clamped to the remaining budget**, or `timeBudgetMs` is a lie.
- 🔴 **4.4 found a second Finding-4 instance:** `get_annotations` declares progress and emits none. **Pinned, not fixed.**

### ⏳ Open — the live pass is BLOCKED

The gate was re-pinned and extended to cover 3.1 progress · 3.2 *measured* pause · the clamp/Finding-5 regression · Phase-4 additive fields. Then:

- ⛔ **The Figma plugin went silent mid-session and both runs died at the join preflight.** Nothing mutated; **SYD untouched.**
- **Next = a fresh channel + a DEV-plugin re-run**, then 5.6.
- ⛔ Stays `additive-preview` until acceptance.

### ⛔ R3 variable-write is still OPEN

`apply_batch` will **never** close it — it is mutate-only over *node* IDs, and variables aren't nodes. Its Phase 0 is discharged, so the entry point is **Phase 1.1**.

⛔ **Figma defines writing `""` as delete.** Not a bug to route around — a semantic you must respect.

## 📚 Detailed history

⚠️ **This repository is PUBLIC, so the full internal history is deliberately NOT kept here.** This file carries the sanitized technical state only.

The complete record lives in the private `ai-synthesizer` workspace at `knowledge/projects/_memory/project_talk_to_figma_fork_upgrade.md` — session-by-session, including the parts that must not be published (hosting account details, client agreements, internal IDs). Folded there 2026-08-17.
