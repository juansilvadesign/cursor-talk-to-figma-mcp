# Compatibility policy

What a consumer may rely on across fork releases, and what this repository promises not
to do without a version change and a migration note.

## The consumer's obligation: ignore unknown fields

**Reply objects grow. Treat any field you do not recognize as absent.** Do not validate
replies with a closed schema, do not fail on extra keys, do not assume a field list is
exhaustive. Every `additive-preview` result is expected to gain fields in later releases,
and a consumer that rejects them will break on an upgrade that broke nothing.

Conversely: **do not treat an absent field as a fact about the file.** An empty
`styles[]` may mean "no styles" or "styles could not be read" — `complete`,
`supported`, `limitations[]`, and the per-entry `resolutionStatus`/`valueStatus` fields
are what distinguish the two. See [`R1-READ-CONTRACT.md`](R1-READ-CONTRACT.md).

## Result stability is a ladder

| Level | Promise |
| --- | --- |
| `legacy` | Predates the contract. May be restructured in any release. Do not build on its shape. |
| `additive-preview` | Existing fields keep their names, types, and meanings. New fields may appear. |
| `stable` | Frozen. Changes require a new contract version. |

A release may **strengthen** a tool's level (`legacy` → `additive-preview` → `stable`);
strengthening cannot break a consumer, because the new promise implies the old one.
**Weakening** a level is a breaking change. `compatibilityErrors()` enforces this
direction and `tests/contract.test.mjs` proves both branches — the promotion is accepted,
the demotion is rejected by name.

## What counts as additive

Additive — ships in any release:

- A new optional input parameter with a default that preserves current behavior.
- A new field on a result whose stability is `legacy` or `additive-preview`.
- A new tool, prompt, or plugin command.
- A strengthened result-stability level.
- A widened input type that still accepts everything it accepted before.

Breaking — requires a new `publicContractVersion`, a migration note, and a consumer
upgrade note:

- Removing or renaming a tool, prompt, parameter, or result field.
- Narrowing an input type, or making an optional parameter required.
- Changing a field's meaning or units while keeping its name. **This is the dangerous
  one** — it passes every mechanical check, so it must be caught in review.
- Changing `direction`, `scope`, `timeoutClass`, or `pluginCommand`.
- Weakening result stability.

## How it is enforced

Three checks, all in `bun run verify`:

1. **Snapshot currency.** `contracts/public-contract.json` must equal the contract
   generated from source. Any change to a tool schema requires a deliberate
   `bun run contract:generate`; drift fails the build.
2. **Cross-release compatibility.** Every frozen baseline in `contracts/baselines/` is
   replayed against the current contract. `r0-public-contract.json` is the first. A
   release that breaks any baseline fails before it ships — this, not the snapshot check,
   is what makes "R1 is backwards compatible with R0" a verified claim rather than an
   intention.
3. **Dispatcher parity.** Every server command has a plugin handler and every public
   plugin command has a server schema.

Freeze a baseline at each release:

```bash
cp contracts/public-contract.json contracts/baselines/r<N>-public-contract.json
```

The test discovers baselines by filename, so nothing else needs editing.

## Version identity — which field moves when

Four identifiers travel with a build, and they answer different questions. Using the
wrong one is how a consumer convinces itself it upgraded when it did not.

| Identifier | Question it answers | Moves when |
| --- | --- | --- |
| `capabilityFingerprint` | *Am I talking to a matched server/plugin pair?* | The command set or `serverSchemaVersion` changes |
| `serverBuildId` / `pluginBuildId` | *Exactly which build is running?* | Any content change in that half |
| `publicContractVersion` | *Which read/write contract am I coding against?* | Any additive or breaking contract change |
| `packageVersion` | Upstream lineage only | Upstream bumps it |

### ⚠️ The fingerprint is a pairing check, not a contract hash

`capabilityFingerprint` covers `serverSchemaVersion` plus the per-command capability IDs
(`figma.command.<name>@1`). It deliberately does **not** cover input schemas, result
shapes, or stability levels.

This was measured, not assumed: applying the whole R1 read change and regenerating
produced a **byte-identical fingerprint**, because R1 added no new commands. A consumer
pinning only the fingerprint would have seen no signal at all.

So R1 bumps `serverSchemaVersion` and `publicContractVersion` together. The schema
version is inside the fingerprint, which makes the fingerprint move too — and that is
the mechanism by which a contract change becomes visible to a pinning consumer. **A
release that grows the contract must bump `serverSchemaVersion`.** Leave it alone and
the change ships silently.

### `packageVersion` is not a release identifier

It stays at upstream's `0.3.5` and the fork is not published to npm. `bunx
cursor-talk-to-figma-mcp@latest` resolves to a build that predates every tool in this
contract. **Pin the commit SHA**, and verify what you reached with `get_runtime_info`.

## Pinning, for consumers

Record all four in your acceptance evidence:

```text
commit                  <fork commit SHA>          ← what you pin
publicContractVersion   <from get_runtime_info>    ← what you code against
capabilityFingerprint   <from get_runtime_info>    ← proves the pair matches
serverBuildId/pluginBuildId                        ← proves which build answered
```

Call `get_runtime_info` after joining a channel and require
`compatibility.status: "compatible"` before any document operation. A mismatched pair is
reported up front instead of failing later as an unknown command.

⛔ **Restarting the relay does not restart the MCP connection.** The relay and the MCP
stdio server are separate processes; the server holds `dist/server.js` from load time, so
a rebuild is invisible to an already-connected client. Verify by **tool surface**, not by
relay liveness, port, or process count.

## When a consumer needs something this fork lacks

Implement the smallest generic tool or additive field **here**, test it here, rebuild
`dist/`, freeze a baseline, and assign a new pin. The consumer adapts after that. The
fork never imports a consumer repository, and no consumer schema, framework, brand, or
workflow vocabulary enters an MCP parameter.
