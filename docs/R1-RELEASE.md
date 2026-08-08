# R1 — consumer-stable read release

**Cut 2026-08-08. Live gate PASSED 2026-08-08 — R1 is accepted.** Offline and live
evidence are both complete; the payload is at the bottom of this note. Supersedes
[`R0-BUILD.md`](R0-BUILD.md), which remains the R0 record.

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
| **Live connected read/write smoke on the R1 pair** | **Pass — 2026-08-08** |
| **Live confirmation of `styles[].value` on a real remote-library file** | **Pass — 2026-08-08** |

### Live gate payload — 2026-08-08

Run against relay `3055` with the fork DEV plugin. Both halves reported the pinned pair,
`compatibility.status: "compatible"`, zero issues, on every join.

Prerequisite verified first: `dist/server.js` and `dist/server.cjs` on disk hashed to the
two SHA-256 values pinned in **Identity** above, so the artifact exercised is the artifact
documented.

**1. `scripts/live-smoke.mjs` — exit 0.** Channel `56kw2mfw`, output
`/tmp/talk-to-figma-r1-live-smoke.json`. Server `r1-server-25902c2adcd3`, plugin
`r1-plugin-2b9a727f3499`, schema `1.1.0` both halves, fingerprint
`sha256:40a64c28…43ce1b`, relay protocol `1`. Inventory observed live: **49 tools, 6
prompts, 48 plugin commands + `relay.channel@1`**. Bounded read returned 5 of 6 children
with `hasMore: true`; write created a frame + text, read both back, and cleaned up — the
page was left at its original 6 children.

**2. `export_node_as_image` with `filePath` — receipt matches disk byte for byte.**
Node `1:2`, a 50×50 rectangle, PNG @2×:

| Field | Receipt | Independently verified on disk |
| --- | --- | --- |
| `bytes` | 375 | 375 (`stat`) |
| `sha256` | `dffa7bb1…3aeb` | identical (`sha256sum`) |
| `width`/`height` | 100 × 100 | 100 × 100 (own IHDR parse) — and 50 × 50 node box × scale 2 |
| `dimensionSource` | `png-ihdr` | — |
| `delivery` | `file` | file present at `path`, **no base64 in the transcript** |

Additivity confirmed: the same export **without** `filePath` returned the image content
block *plus* a receipt with an identical `sha256`, `bytes` and dimensions, differing only
in `delivery: "inline"`. An R0 consumer sees no change.

Format coverage, each cross-checked against disk: **SVG** → 149 bytes, 50 × 50,
`dimensionSource: "svg-attributes"` (the file itself carries `width="50" height="50"
viewBox="0 0 50 50"`). **PDF** → 5366 bytes, `width: null`, `height: null`,
`dimensionSource: null` — the documented trap reproduces exactly, so
`dimensionSource` really is the field to read before trusting a size.

**3. `get_node_variables` — `value` populated on styles `get_styles` cannot see.**
Fixture: `SYD (SaveYourDay) - Spaceapps`, the **source** file (channel `r4q70w51`), page
`3-LP` (`1068:5433`), 11,733 nodes scanned.

`get_styles` returned this document's entire local inventory: 11 paints
(`primaria`, `secundaria`, `texto`, `card`, `apoio`, `bg`, `placeholder`, `erro`,
`atencao`, `texto-lp`, `image/login`) + 1 effect (`perfil`). The scan found **4,943 style
references — 4,278 local and 652 remote across 48 distinct remote styles**
(`Gray/400` ×132, `.Text styles/Text/Regular/Normal` ×86, `Brand/600` ×14,
`Shadows/shadow-xs` ×14, `Text sm/*`, `Base/White`, …).

The load-bearing result: **of those 652 remote references, 0 match the local inventory by
style id and 0 by name — and all 652 carry a populated `value` at
`valueStatus: "resolved"`.** That is the remote-library gap closed on real Figma
behaviour, not on a fixture. All three style types resolved: PAINT 316 (paint array with
colour), TEXT 318 (`fontName`, `fontSize`, `lineHeight`, …), EFFECT 18 (drop-shadow
`radius`/`offset`/`spread`).

Honest-incompleteness also confirmed in the same reply: `complete: false` with 13
unresolved of 4,943 — every one `resolutionStatus: "mixed"` (a node carrying more than
one style on that property) and typed `valueStatus: "not_applicable"`, **zero read
failures**, with the reason stated in `limitations`. An absent value is never ambiguous
between "no value" and "could not read it", as specified. Variable bindings: 2,421
resolved, 0 unresolved.

⚠️ **Note on the earlier `atencao` finding.** This source file resolves `atencao`
locally — the 248-reference unresolvable case belonged to the *copy*, per
`TASKS.md`. The remote branch proven here is the UI-kit reference set
(`Gray/*`, `Brand/600`, `Text sm/*`, `Shadows/shadow-xs`), which is the same defect class
and the one that survives on the source file.

### Observed live, not blocking — for R2

- **`export_node_as_image` has no heavy timeout class.** On the SYD fixture, exporting a
  large `LP` SECTION and then progressively smaller frames all failed on the 30 s default.
  ⛔ **Do not read that as an export defect** — a plain `get_node_info` on the same node
  timed out immediately afterwards, and `get_runtime_info` then reported `plugin: null` /
  `compatibility: "incompatible"` / *"Plugin runtime probe failed"*. The plugin had been
  saturated by the preceding 11,733-node scan; it was not answering anything. The
  preflight **declaring** that state instead of proceeding blind is the runtime-honesty
  contract working, and every timeout error carried the full runtime identity inline.
  Two real follow-ups for R2: give `export_node_as_image` a declared heavy budget the way
  the document-wide reads have one, and consider a bounded/paged `get_node_variables` so a
  page-wide scan cannot wedge the plugin for subsequent calls.
- A **multi-megabyte** export through `filePath` (the 4.29 MB / 1.73 MB frames that
  motivated the parameter) is therefore still unconfirmed end to end. The mechanism is
  proven; only the large-payload path is untested.
