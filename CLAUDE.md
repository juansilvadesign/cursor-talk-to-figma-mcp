# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that bridges Cursor AI IDE with Figma. Three components communicate in a pipeline:

```
Cursor AI ←(stdio)→ MCP Server ←(WebSocket)→ WebSocket Relay ←(WebSocket)→ Figma Plugin
```

## Build & Development Commands

```bash
bun install              # Install dependencies
bun run build            # Build MCP server (tsup → dist/)
bun run dev              # Build in watch mode
bun socket               # Start WebSocket relay server (port 3055)
bun run start            # Run built MCP server
bun setup                # Full setup (install + write .cursor/mcp.json + .mcp.json)
```

```bash
node --test              # the offline suite (343 tests as of R2.7 item 1.3, live-gated on shtlklfy)
bun run verify           # the offline release gate: contract + tests + build + identity
bun run contract:generate  # regenerate the contract, runtime metadata and both pins
```

⚠️ This section used to say "there is no test suite or linter configured", which stopped
being true at R0 and stayed on the page for six releases. No linter is configured; the
suite is `node --test` and `bun run verify` is what a release has to pass.

## Architecture

### MCP Server (`src/talk_to_figma_mcp/server.ts`)
The main server implementing the MCP protocol via `@modelcontextprotocol/sdk`. Exposes 50+ tools (create shapes, modify text, manage layouts, export images, etc.) and several AI prompts (design strategies). Communicates with Cursor over stdio and with the WebSocket relay via `ws`. Each request gets a UUID, is tracked in a `pendingRequests` Map with timeout/promise callbacks, and resolves when the plugin responds.

### WebSocket Relay (`src/socket.ts`)
Lightweight Bun WebSocket server on port 3055 (configurable via `PORT` env). Routes messages between MCP server and Figma plugin using channel-based isolation. Clients call `join` to enter a channel; messages broadcast only within the same channel.

### Figma Plugin (`src/cursor_mcp_plugin/`)
Runs inside Figma. `code.js` is the plugin main thread handling 30+ commands via a dispatcher. `ui.html` is the plugin UI for WebSocket connection management. `manifest.json` declares permissions (dynamic-page access, localhost network). The plugin is **not built/bundled** — `code.js` is written directly as the runtime artifact.

## Key Patterns

- **Colors**: Figma uses RGBA 0-1 range. The MCP tools accept 0-1 floats and the filter converts to hex for display.
- **Logging**: All logs go to stderr. Stdout is reserved for MCP protocol messages.
- **Timeouts**: 30s default per command; the reads whose cost scales with the file rather than the arguments (`get_document_info`, `get_pages`, `get_styles`, `get_local_components`, and since R2 `export_node_as_image`, `get_node_variables` + `get_available_fonts`) declare `HEAVY_READ_TIMEOUT_MS` (120s). The contract gate treats **raising** a tool's timeout class as compatible and **lowering** it as breaking. Progress updates from the plugin reset the inactivity timer to `max(60s, the request's own budget)` — a declared budget survives the reset, since a heavy read's `started` update lands within milliseconds and would otherwise downgrade it to 60s instantly.
- **Export safety**: PNG/JPG preflight estimates rendered bounds × scale and refuses above the fork's 16 MP ceiling unless `allowLargeExport: true`. The estimate is returned in the receipt, and `filePath` keeps bytes out of context. The plugin flushes `started` before `exportAsync`; an export timeout latches compatibility until `get_runtime_info` proves recovery. Do not raise the 120s budget to address a raster wedge.
- **Plugin data (R2.3)**: an optional `namespace` selects the store — omit it for this plugin's private data, pass one for Figma's shared store that other plugins and the REST API can read. `set_plugin_data` **refuses `value: ""`** and this is deliberate: Figma *defines* writing the empty string as key removal, so `""` is not storable and accepting it would delete silently. `null` is the single explicit delete; removing an absent key reports `noop_absent`. Reads test key **membership** so an absent key is `present: false` rather than an empty value, and are bounded by `limit`/`offset` plus `maxValueBytes` (true size still reported as `bytes`, in UTF-8).
- **Fonts (R2.5)**: `get_available_fonts` windows the **machine's** installed faces — `limit`/`offset` with a `fontCount`/`familyCount` that stay whole-inventory totals, an exact `family` filter so one family costs one call, and a deterministic family-then-style **code-unit** sort (never `localeCompare`, which pages differently per locale) so `offset` is repeatable. ⚠️ Its `timeBudgetMs` bounds the **reply**, not the work: `listAvailableFontsAsync` takes no cancellation signal, so an exhausted budget *abandons* the call, and the reply carries `coverage.budgetCancelsFetch: false` to say so. Counts are `null` when the inventory could not be read — a `0` would read as "this machine has no fonts". `check_fonts` preflights `{family, style}` pairs (50 max) with a **real `loadFontAsync` probe**, reporting `available`, `familyAvailable` and `loadable` as three separate facts, because a listed face can still refuse to load and `setCharacters` answers that refusal by substituting Inter silently. An exhausted budget there **skips** — unprobed pairs are absent from `results` and counted in `skippedCount`, never reported as unavailable.
- **Text creation (R2.6 item 2.0)**: `create_text` takes the same twelve typography
  parameters as `set_text_style`, through **one shared validator** — a second copy is how
  two surfaces start disagreeing about what is valid. Inter is used only when **nothing**
  is supplied, and `fontWeight` (which reaches Inter's styles alone) **cannot** be combined
  with `fontFamily`/`fontStyle`: one of the two would be silently discarded, and a
  discarded value reads as an applied one. ⛔ **Validate-all-then-CREATE** — the parent is
  resolved and the font loaded *before* `figma.createText()`, because on a create tool a
  late refusal leaves an orphan node rather than a half-written one. ⛔ An unloadable font
  is **refused**, where the old handler swallowed the error and created the node in
  whatever face Figma supplied; `fontSubstituted: false` is therefore a permanent
  declaration, and a substitution that somehow happened would **remove** the node. The
  reply keeps its historical `Created text "…" with ID: …` line and appends the receipt
  underneath — several gates parse that line.
- **Batching (R2.4)**: `apply_batch` applies many node mutations in one call, against node IDs that **already exist** — v1 is mutate-only and every `create_*` is pinned absent by a test. Every target is resolved in one total pass before any write, so `onError: "stop"` refuses the whole batch without mutating and `prevalidateOnly` is a real dry run. The receipt is per-operation, correlated by a caller-supplied `id`, with a typed `outcome` that **cannot** report success when nothing succeeded. Two refusals **throw** rather than return a receipt — a duplicate `id` and a disallowed `op` — because neither can be expressed inside the structure it breaks; everything else is reported in the receipt. ⛔ **Operations are NOT atomic.** Nine of the fifteen allowlisted mutations write more than one field, and three (`set_item_spacing`, `set_axis_align`, `set_layout_sizing`) are *proven* to write their first field and then throw, so a `failed` receipt can sit on top of a changed document — it carries `partialApplicationPossible` for exactly that reason. The vocabulary lives in `src/talk_to_figma_mcp/batch-receipt.mjs` and is **mirrored** in `code.js` (the sandbox cannot `import`), held together by a parity test, not by convention.
- **Chunking**: Large operations (scanning 100+ nodes) are chunked with progress updates to prevent Figma UI freezing. `apply_batch` deliberately emits **no** progress updates yet, and the contract says so — which is also what gives it a real total ceiling, since nothing resets the inactivity timer.
- **Reconnection**: WebSocket auto-reconnects after 2 seconds on disconnect.
- **Zod validation**: All tool parameters are validated with Zod schemas.

## Setup

1. Run `bun run setup` — installs from the root `bun.lock`, builds, and writes MCP config for both Cursor (`.cursor/mcp.json`) and Claude Code (`.mcp.json`)
2. `bun socket` in one terminal (WebSocket relay)
3. In Figma: Plugins → Development → Link existing plugin → select `src/cursor_mcp_plugin/manifest.json`
4. Run plugin in Figma, join a channel, then use tools from Cursor or Claude Code

The MCP config uses this checkout's built server; npm `latest` is not R1-compatible:

```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "node",
      "args": ["/absolute/path/to/talk-to-figma-fork/dist/server.js"]
    }
  }
}
```

After joining a channel, call `get_runtime_info` and require a compatible fingerprint
before document operations.
