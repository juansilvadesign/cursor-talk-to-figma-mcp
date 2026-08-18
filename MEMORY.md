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
- ✅ The 8 files that were held back pending the live gate are **committed** — tree clean at `db4d81b`, gate script tracked.

### ⛔ The pairing hazard — read before touching a running session

The server and plugin builds are a **matched PAIR**. Current pair:

```
r2-server-dbcede2e0895  ↔  r2-plugin-53a1fa676d6a   (sha256:d39aefef…ca6289)
```

⭐ **The 4.1 wrapper fix moved the SERVER half only.** `pluginBuildId`, `serverSchemaVersion` (1.6.0) and the fingerprint are all unchanged, because the fingerprint hashes `{serverSchemaVersion, capabilityIds}` and the plugin ID hashes only plugin sources — and `code.js` was not touched. So this one needs **a server respawn and NOT a DEV plugin re-run**, and compatibility stays `compatible` across it. ⚠️ That is the exception, not the rule: it holds only because the change was server-side.

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

**Next = re-run the 5.6 live gate on the new server build** (respawn only, no plugin re-run), then acceptance. ⚠️ The gate's new assertions are proven only offline so far: the published-schema check was confirmed against a real `listTools`, and its receipt-parsing logic was run against real wrapper replies — but the gate itself has not executed against a live Figma session since the change.

### ⛔ R3 variable-write is still OPEN

`apply_batch` will **never** close it — it is mutate-only over *node* IDs, and variables aren't nodes. Its Phase 0 is discharged, so the entry point is **Phase 1.1**.

⛔ **Figma defines writing `""` as delete.** Not a bug to route around — a semantic you must respect.

## 📚 Detailed history

⚠️ **This repository is PUBLIC, so the full internal history is deliberately NOT kept here.** This file carries the sanitized technical state only.

The complete record lives in the private `ai-synthesizer` workspace at `knowledge/projects/_memory/project_talk_to_figma_fork_upgrade.md` — session-by-session, including the parts that must not be published (hosting account details, client agreements, internal IDs). Folded there 2026-08-17.
