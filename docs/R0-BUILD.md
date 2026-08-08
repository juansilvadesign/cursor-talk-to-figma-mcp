# R0 build and acceptance note — 2026-08-07

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

## Live disposable smoke

Status: **pending a connected, reloaded R0 DEV plugin channel.** The currently exposed
TalkToFigma client in this session has no joined plugin channel, so it cannot prove the
new server/plugin pair. An in-sandbox `bun run socket` attempt returned `EADDRINUSE`;
the required outside-sandbox bind could not run because this session's execution-
approval quota was exhausted. This is an acceptance-environment blocker, not a fork
test failure. R0 is not marked accepted until this block records a pass.

Exact command once the relay is running and the local DEV plugin has been reloaded:

```bash
node scripts/live-smoke.mjs \
  --channel=<channel-shown-by-the-R0-DEV-plugin> \
  --output=/tmp/talk-to-figma-r0-live-smoke.json
```

The script requires `compatibility.status: "compatible"`, runs
`get_document_info(summary:true,limit:5,offset:0,familyLimit:5)`, creates one uniquely
named 320×180 auto-layout frame and one child text node, reads both back by exact ID,
and deletes the recorded IDs in reverse order inside `finally`. It does not scan, edit,
or delete any pre-existing node and does not touch a consumer repository.

## Acceptance state

| Gate | State |
| --- | --- |
| Frozen contract, parity, README inventory | Pass |
| Durable offline real-plugin harness | Pass |
| Runtime identity and mismatch preflight | Implemented and offline-verified |
| Clean Bun install, build, plugin parse, tests, `dist/` parity | Pass |
| Setup cannot select npm `latest` | Pass |
| Connected runtime info + bounded live read | Pending DEV plugin channel |
| Reversible live write/read/delete | Pending DEV plugin channel |

R0 acceptance remains open only on the two live rows above.
