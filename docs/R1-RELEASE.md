# R1 — consumer-stable read release

**Cut 2026-08-08.** Offline gate green; live verification pending (see the bottom of
this note). Supersedes [`R0-BUILD.md`](R0-BUILD.md), which remains the R0 record.

## Identity — what to pin

| Field | Value |
| --- | --- |
| Release | `R1` |
| Public contract version | `1.1.0` (was `1.0.0`) |
| Server schema version | `1.1.0` (was `1.0.0`) |
| Plugin API version | `1.1.0` (was `1.0.0`) |
| Relay protocol version | `1` (unchanged) |
| Server build | `r1-server-25902c2adcd3` |
| Plugin build | `r1-plugin-2b9a727f3499` |
| Capability fingerprint | `sha256:40a64c28af0a95c6a40082c18826b570df58a5ab7ec6f2c078c74e53bb43ce1b` |
| Package version | `0.3.5` — **unchanged, and not a release identifier** |
| Inventory | 49 MCP tools, 6 prompts, 48 plugin commands plus relay-only `join` |
| `dist/server.js` SHA-256 | `53dced30c779d934908f852c98e62ec4d96d50ed66d528b7c3ee8f5e571e77d9` |
| `dist/server.cjs` SHA-256 | `abc2eaf9cad0cebaed805e2d640652384f6392e1f184618eff364ce526773ec1` |

**Pin the commit SHA.** `packageVersion` stays at upstream's `0.3.5` and the fork is not
published to npm — `bunx cursor-talk-to-figma-mcp@latest` resolves to a build that
predates every tool in this contract. Verify what you actually reached with
`get_runtime_info`.

## What changed

Both changes are **additive**. No tool, parameter, or result field was removed, renamed,
or retyped. An R0 consumer that ignores unknown fields needs no code change to run
against R1.

### 1. `export_node_as_image` — typed receipt + optional `filePath`

New optional `filePath` parameter. The reply now always carries a JSON receipt:
`nodeId`, `format`, `scale`, `mimeType`, `bytes`, `sha256`, `width`, `height`,
`dimensionSource`, `delivery` (plus `path` when written to disk).

- **Without `filePath`** — the image content block, unchanged, *plus* the receipt.
- **With `filePath`** (absolute) — bytes written to disk, receipt only, **no base64 in
  the transcript**.

Result stability promoted `legacy` → `additive-preview`.

Fixes two logged consumer problems: the reply carried no node id, so an export could
only be attributed by remembering your own request; and two frames returned 4.29 MB and
1.73 MB of base64 in a single reply each.

`width`/`height` are parsed from the exported bytes (PNG `IHDR`, JPEG `SOF`, SVG
attributes or `viewBox`), not computed from the node box. **PDF reports `null`** with
`dimensionSource: null` — read `dimensionSource` before trusting a size.

### 2. `get_node_variables` — style references carry their value

Each `styles[]` entry gains `value` and `valueStatus` beside the existing `styleName`,
`styleType`, `remote`, `resolutionStatus`. Shapes per style type are in
[`R1-READ-CONTRACT.md`](R1-READ-CONTRACT.md).

This closes the remote-library gap: `get_styles` lists local styles only, so on a file
referencing an external library the value was recoverable only by joining against
`get_node_info` — a join that reached 31 %/40 % of the scanned nodes and left the
reporting fixture's second-most-used paint style (`atencao`, 248 references)
permanently unresolvable.

### 3. Contract machinery (no runtime effect)

- `contracts/baselines/r0-public-contract.json` freezes R0. Every release is now replayed
  against every frozen baseline in `bun run verify`, so cross-release compatibility is
  verified rather than asserted.
- Result stability became an ordered ladder: strengthening is allowed, weakening is a
  named error.
- The release gate reports the release it actually gated instead of a hardcoded `R0`.

## ⚠️ Why the fingerprint moved, and why that was not automatic

`capabilityFingerprint` covers `serverSchemaVersion` plus per-command capability IDs. It
does **not** cover input schemas or result shapes.

Applying the entire R1 read change and regenerating produced a **byte-identical
fingerprint** — R1 added no new commands, so nothing in the fingerprint's inputs moved. A
consumer pinning only the fingerprint would have seen no signal that the contract grew.

R1 therefore bumps `serverSchemaVersion` to `1.1.0`, which *is* a fingerprint input. That
is the mechanism, and it is deliberate: **a release that grows the contract must bump
`serverSchemaVersion`, or the change ships silently.** Recorded in
[`COMPATIBILITY-POLICY.md`](COMPATIBILITY-POLICY.md).

## Consumer upgrade note

**Migration required: none.** Both changes are additive; unknown fields were always safe
to ignore.

To adopt R1:

1. Update your pin to this commit and rebuild `dist/` (`bun run build`).
2. **Reload the DEV plugin in Figma.** The plugin build ID changed
   (`r0-plugin-1eec70ac13d1` → `r1-plugin-2b9a727f3499`). A stale plugin is rejected by
   the preflight, but only if you call `get_runtime_info` before document operations.
3. Re-record the four identifiers in your acceptance evidence: commit,
   `publicContractVersion`, `capabilityFingerprint`, and both build IDs.
4. Optional adoptions:
   - Pass `filePath` to `export_node_as_image` for anything large. Attribute exports by
     the receipt's `nodeId` rather than by request order.
   - Read `styles[].value` directly instead of joining `get_node_variables` to
     `get_node_info`. Check `valueStatus` before treating a null `value` as "no value".

⛔ **Restarting the relay does not restart the MCP connection.** The stdio server holds
`dist/server.js` from load time. After upgrading, verify by **tool surface** and by
`get_runtime_info` reporting `r1-*` build IDs — not by relay liveness or process count.

## Verification state

| Gate | State |
| --- | --- |
| Contract snapshot currency, dispatcher parity, README inventory | Pass |
| Cross-release compatibility vs the frozen R0 baseline | Pass — zero errors |
| Offline real-plugin harness (34 tests) | Pass |
| Read-layer acceptance invariants | Pass — `tests/read-acceptance.test.mjs` |
| Export receipt + dimension parsing | Pass — `tests/export-receipt.test.mjs` |
| Clean build, plugin parse, `dist/` parity | Pass |
| **Live connected read/write smoke on the R1 pair** | **Pending** |
| **Live confirmation of `styles[].value` on a real remote-library file** | **Pending** |

### Pending live verification

R1's offline evidence is complete; the connected pair has not been exercised since the
version bump. Both R0 live-smoke commands apply unchanged, against the R1 plugin:

```bash
bun run socket                      # relay on 3055
# Figma → reload the fork DEV plugin → copy the channel
node scripts/live-smoke.mjs --channel=<channel> --output=/tmp/talk-to-figma-r1-live-smoke.json
```

Require `compatibility.status: "compatible"` and confirm both halves report
`r1-server-25902c2adcd3` / `r1-plugin-2b9a727f3499` and the fingerprint above.

Two R1-specific checks the smoke does not cover:

- `export_node_as_image` with `filePath` against a real node — confirm the file lands,
  `sha256` matches the file on disk, and `width`/`height` match Figma's own export.
- `get_node_variables` on a subtree that consumes a **remote** library style — confirm
  `value` is populated where `get_styles` cannot see the style. The offline fixture
  proves the code path; a live file proves the Figma behavior it assumes.
