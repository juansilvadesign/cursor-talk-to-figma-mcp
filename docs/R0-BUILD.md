# R0 build and acceptance note — built 2026-08-07, accepted 2026-08-08

**R0 is closed.** Every gate below passes, including the connected live smoke, which
ran twice on 2026-08-08 against the exact server/plugin pair identified here.

## Identity

- Package version: `0.3.5`
- Release: `R0`
- Server schema: `1.0.0`
- Relay protocol: `1`
- Server build: `r0-server-937e815db78f`
- Plugin build: `r0-plugin-1eec70ac13d1`
- Capability fingerprint:
  `sha256:3dfa8bd8b57b35e2997c01314bb83bf6b0120ddac81015fa4dab9b1281483de4`
- Inventory: 49 MCP tools, 6 prompts, 48 plugin commands plus relay-only `join`
- Source baseline before the R0 working tree: `b8a5084`
- `dist/server.js` SHA-256:
  `44f495759b24a7f779b58b1d0861f4746aa075194984e147917ff828d29d0c4e`
- `dist/server.cjs` SHA-256:
  `3f94b569be1494aa9f80f63c26016aac68f141c200c49858c58b3b06b43c8010`

The server/plugin build IDs are content-derived. The server ID covers `server.ts` plus
the canonical public contract; the plugin ID covers `code.js` (excluding its generated
identity block), `ui.html`, and `manifest.json`.

## Clean-install decision

Environment: Node `v22.22.3`, Bun `1.3.14`, npm `10.9.8`, Linux.

```text
$ bun install --frozen-lockfile
167 packages installed [1.66s]
elapsed=1.66 maxrss_kb=19072
```

The root `bun.lock` is authoritative. A separate clean npm measurement was stopped
after 71.79 seconds with `Exit handler never called`; `npm ls` did not show a valid
tree. The checked-in npm lock also identifies package `0.3.1`, not current `0.3.5`.
`package-lock.json` is preserved as legacy traceability, not an R0 install path.

## Offline/source-runtime gate

Executed from the clean Bun copy with no pre-existing `node_modules` or `dist`:

```text
$ bun run verify
Contract OK: 49 tools, 6 prompts, 48 plugin commands.
node --check src/cursor_mcp_plugin/code.js: PASS
node --test: 3 files PASS
bun run build: ESM/CJS/DTS PASS
R0 offline gate passed: 49 tools, 6 prompts, source/runtime parity verified.
```

The test files contain the individual assertions for:

- the generated tool/prompt schema snapshot and README inventory;
- `FigmaCommand` ↔ `CommandParams` ↔ plugin dispatcher ↔ MCP tool parity;
- observed guard failures when a dispatcher case or public parameter is removed;
- optional additive input compatibility;
- bounded multi-page reads and exact arithmetic for children, components, families,
  authoring sessions, variables, styles, bindings, and style references;
- missing nodes/pages, unsupported APIs, partial variable/style reads, time budgets,
  and invalid write targets;
- an offline isolated frame/text create → read → image/auto-layout mutate → delete
  smoke against the real `code.js` VM runtime.

Setup was also exercised in the clean copy:

```text
$ bun run setup
Local fork MCP configuration written for <clean-copy>/dist/server.js
No npm "latest" package is selected.
```

The generated `.mcp.json` and `.cursor/mcp.json` were byte-identical and used the
absolute built server path.

## Live disposable smoke — PASSED 2026-08-08

Status: **pass, twice, exit 0 both times.** Run against a connected, reloaded R0 DEV
plugin ("Talk to Figma (fork)") with the fork's own relay on port 3055.

```bash
# run 1 — 2026-08-08T03:01:47.924Z
node scripts/live-smoke.mjs \
  --channel=tl7fnolj \
  --output=/tmp/talk-to-figma-r0-live-smoke.json

# run 2 — 2026-08-08T03:15:00.414Z, independent channel, independent plugin session
node scripts/live-smoke.mjs \
  --channel=jtijkiez \
  --output=/tmp/talk-to-figma-r0-live-smoke-jtijkiez.json
```

The script requires `compatibility.status: "compatible"`, runs
`get_document_info(summary:true,limit:5,offset:0,familyLimit:5)`, creates one uniquely
named 320×180 auto-layout frame and one child text node, reads both back by exact ID,
and deletes the recorded IDs in reverse order inside `finally`. It does not scan, edit,
or delete any pre-existing node and does not touch a consumer repository. It spawns its
own server from `dist/server.js`, so a pass proves the **built artifact** — never an
already-connected client's session.

### Connected runtime payload (identical in both runs)

```json
{
  "server": {
    "name": "TalkToFigmaMCP",
    "packageVersion": "0.3.5",
    "release": "R0",
    "buildId": "r0-server-937e815db78f",
    "schemaVersion": "1.0.0",
    "capabilityFingerprint": "sha256:3dfa8bd8b57b35e2997c01314bb83bf6b0120ddac81015fa4dab9b1281483de4"
  },
  "plugin": {
    "name": "Talk to Figma (fork) plugin",
    "release": "R0",
    "buildId": "r0-plugin-1eec70ac13d1",
    "apiVersion": "1.0.0",
    "serverSchemaVersion": "1.0.0",
    "relayProtocolVersion": "1",
    "capabilityFingerprint": "sha256:3dfa8bd8b57b35e2997c01314bb83bf6b0120ddac81015fa4dab9b1281483de4"
  },
  "relay": { "protocolVersion": "1", "transport": "websocket-channel" },
  "compatibility": { "status": "compatible", "issues": [] }
}
```

The load-bearing result is the **fingerprint match**: server `r0-server-937e815db78f`
and plugin `r0-plugin-1eec70ac13d1` derived
`sha256:3dfa8bd8…483de4` independently — 49 server tools ↔ 48 plugin commands plus
`relay.channel@1` (50 capability IDs). The counts agree with the offline inventory
above, so source, `dist/`, and the running plugin are the same contract.

### Bounded read

Identical in both runs:

| Field | Value |
| --- | --- |
| `scope` | `current_page_with_document_page_index` |
| `pageId` | `0:1` |
| `childCount` | 6 |
| `returned` | 5 |
| `hasMore` | `true` |

The bound held: 6 children present, 5 returned at `limit: 5`, `hasMore: true`. The read
never silently widened to the whole document.

### Reversible write

| | Run 1 (`tl7fnolj`) | Run 2 (`jtijkiez`) |
| --- | --- | --- |
| Created FRAME | `7:2` — `R0 Smoke 1786158108219` | `7:4` — `R0 Smoke 1786158900677` |
| Created TEXT | `7:3` — `R0 Smoke Text` | `7:5` — `R0 Smoke Text` |
| Read back | frame `7:2`, `childCount: 1`, text `7:3` | frame `7:4`, `childCount: 1`, text `7:5` |
| Cleaned (reverse order) | `7:3`, then `7:2` | `7:5`, then `7:4` |
| `cleanupError` | none | none |

**Cleanup is independently proven, not self-reported.** Run 2 read the same
`childCount: 6` on page `0:1` that run 1 did, from a fresh channel and a fresh plugin
session. Self-cleanup inside a `finally` block only claims it removed its own nodes;
a later independent run observing the pre-smoke child count is what establishes that
nothing was left behind. Run 2's node IDs advancing to `7:4`/`7:5` also confirm it
created new nodes rather than re-reading run 1's.

### ⚠️ Recorded caveat — fixture disposability was not verified

The gate wording asks for a *disposable* fixture. The bound document already had 6
pre-existing children on page `0:1`, so it was demonstrably **not empty**, and its
disposability was never independently confirmed. What the runs do prove is that the
smoke is reversible by construction and left the file in its prior state. If R0
acceptance is meant to depend on the fixture being literally throwaway, re-run both
commands against a scratch file; nothing else in this note changes.

Artifacts: `/tmp/talk-to-figma-r0-live-smoke.json` and
`/tmp/talk-to-figma-r0-live-smoke-jtijkiez.json` (10,590 bytes each). These are
**ephemeral** — `/tmp` does not survive a reboot. The load-bearing payload is
transcribed above; treat this note as the record, not the JSON.

## Acceptance state

| Gate | State |
| --- | --- |
| Frozen contract, parity, README inventory | Pass |
| Durable offline real-plugin harness | Pass |
| Runtime identity and mismatch preflight | Pass — implemented, offline-verified, and confirmed live |
| Clean Bun install, build, plugin parse, tests, `dist/` parity | Pass |
| Setup cannot select npm `latest` | Pass |
| Connected runtime info + bounded live read | Pass (2026-08-08, two runs) |
| Reversible live write/read/delete | Pass (2026-08-08, two runs, no `cleanupError`) |

**R0 accepted 2026-08-08.** A clean checkout proves contract parity and offline
behavior, a connected client can verify the exact runtime it reached, and the live
read/write smoke passes with no consumer repository involved. The one open item is the
recorded caveat above, which qualifies the fixture — not the result.

## Operating note carried out of R0

Restarting `bun run socket` does **not** restart the MCP connection. The relay and the
MCP stdio server are separate processes, and the server holds `dist/server.js` from
load time, so a rebuild is invisible to an already-connected client. Verify by **tool
surface** — `get_runtime_info` present ⇒ the 49-tool R0 server — not by relay liveness,
port, or process count. Also kill any stray `bunx cursor-talk-to-figma-mcp@latest`
processes: that published build predates R0, lacks these tools, and competes for the
same relay channel.
