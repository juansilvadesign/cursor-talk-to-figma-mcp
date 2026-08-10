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

There is no test suite or linter configured.

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
- **Timeouts**: 30s default per command; the reads whose cost scales with the file rather than the arguments (`get_document_info`, `get_pages`, `get_styles`, `get_local_components`, and since R2 `export_node_as_image` + `get_node_variables`) declare `HEAVY_READ_TIMEOUT_MS` (120s). The contract gate treats **raising** a tool's timeout class as compatible and **lowering** it as breaking. Progress updates from the plugin reset the inactivity timer to `max(60s, the request's own budget)` — a declared budget survives the reset, since a heavy read's `started` update lands within milliseconds and would otherwise downgrade it to 60s instantly.
- **Export safety**: PNG/JPG preflight estimates rendered bounds × scale and refuses above the fork's 16 MP ceiling unless `allowLargeExport: true`. The estimate is returned in the receipt, and `filePath` keeps bytes out of context. The plugin flushes `started` before `exportAsync`; an export timeout latches compatibility until `get_runtime_info` proves recovery. Do not raise the 120s budget to address a raster wedge.
- **Chunking**: Large operations (scanning 100+ nodes) are chunked with progress updates to prevent Figma UI freezing.
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
