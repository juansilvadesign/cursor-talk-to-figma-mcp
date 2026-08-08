# Talk to Figma MCP

This project implements a Model Context Protocol (MCP) integration between AI agent (Cursor, Claude Code) and Figma, allowing AI agent to communicate with Figma for reading designs and modifying them programmatically.

https://github.com/user-attachments/assets/129a14d2-ed73-470f-9a4c-2240b2a4885c

## Project Structure

- `src/talk_to_figma_mcp/` - TypeScript MCP server for Figma integration
- `src/cursor_mcp_plugin/` - Figma plugin for communicating with Cursor
- `src/socket.ts` - WebSocket server that facilitates communication between the MCP server and Figma plugin

## Local fork quick start

1. Install Bun if you haven't already:

```bash
curl -fsSL https://bun.sh/install | bash
```

2. Install from the checked-in Bun lockfile, build the server, and write Cursor/Claude
   MCP configuration that points to this checkout's absolute `dist/server.js` path:

```bash
bun run setup
```

3. Start the Websocket server

```bash
bun socket
```

4. In Figma, link the DEV plugin at `src/cursor_mcp_plugin/manifest.json` and
   connect it to the relay. The community plugin and npm `latest` package are not an
   R1-compatible pair because they do not carry this fork's complete command set or
   runtime fingerprint.

5. Call `join_channel` with the channel shown by the DEV plugin. Joining runs a strict
   server/plugin compatibility preflight. Call `get_runtime_info` to record the exact
   server build, plugin build, schema, relay protocol, and capabilities before document
   work.

See [runtime compatibility](docs/RUNTIME-COMPATIBILITY.md) for the supported matrix and
failure behavior.

## Quick Video Tutorial

[Video Link](https://www.linkedin.com/posts/sonnylazuardi_just-wanted-to-share-my-latest-experiment-activity-7307821553654657024-yrh8)

## Design Automation Example

**Bulk text content replacement**

Thanks to [@dusskapark](https://github.com/dusskapark) for contributing the bulk text replacement feature. Here is the [demo video](https://www.youtube.com/watch?v=j05gGT3xfCs).

**Instance Override Propagation**
Another contribution from [@dusskapark](https://github.com/dusskapark)
Propagate component instance overrides from a source instance to multiple target instances with a single command. This feature dramatically reduces repetitive design work when working with component instances that need similar customizations. Check out our [demo video](https://youtu.be/uvuT8LByroI).

## Manual Setup and Installation

### MCP Server: Integration with Cursor

`bun run setup` is preferred because it generates the absolute path safely. The
equivalent manual configuration is:

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

### WebSocket Server

Start the WebSocket server:

```bash
bun socket
```

### Figma Plugin

1. In Figma, go to Plugins > Development > New Plugin
2. Choose "Link existing plugin"
3. Select the `src/cursor_mcp_plugin/manifest.json` file
4. The plugin should now be available in your Figma development plugins

## Windows Setup Guide

### Option 1: Using PowerShell (Recommended)

1. Install Bun via PowerShell:
```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

2. Run the PowerShell setup script:
```powershell
bun run setup:ps
```

3. Start the WebSocket server:
```bash
bun socket
```

### Option 2: Using Command Prompt

1. Install Bun via PowerShell (run once):
```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

2. Run the batch setup script:
```cmd
bun run setup:win
```

3. Start the WebSocket server:
```bash
bun socket
```

### Option 3: Manual Setup

1. Install Bun via PowerShell:
```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

2. Install dependencies:
```bash
bun install
```

3. Run the cross-platform local setup:

```bash
bun run setup
```

If creating `.cursor/mcp.json` manually, point it to the built local server:

```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "node",
      "args": ["C:/absolute/path/to/talk-to-figma-fork/dist/server.js"]
    }
  }
}
```

4. Start the WebSocket server:
```bash
bun socket
```

**Note**: The WebSocket server is now configured to work properly on Windows by default (hostname: "0.0.0.0" is enabled).

## Usage

1. Start the WebSocket server
2. Run `bun run setup` so the MCP client uses this fork's built server
3. Open Figma and run the Cursor MCP Plugin
4. Connect the plugin, then join its channel using `join_channel`
5. Confirm `get_runtime_info` reports `compatibility.status: "compatible"`
6. Use the document tools

## Local Development Setup

To develop, point MCP at the built local artifact. Source changes do not reach a live
client until `bun run build` completes and the MCP server restarts.

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

## MCP Tools

The MCP server provides the following tools for interacting with Figma:

### Document & Selection

- `get_document_info` - Get current-page details plus a document-wide page index; the current page's children are always bounded by `limit`/`offset`, with `childTypes`/`childFamilies` rollups describing every child
- `get_pages` - Enumerate every page; top-level child counts are opt-in
- `set_current_page` - Switch the active page for subsequent page-scoped operations
- `get_selection` - Get information about the current-page selection
- `read_my_design` - Get detailed node information about the current selection without parameters
- `get_node_info` - Get detailed information about a specific node
- `get_nodes_info` - Get detailed information about multiple nodes by providing an array of node IDs

### Annotations

- `get_annotations` - Get all annotations in the current document or specific node
- `set_annotation` - Create or update an annotation with markdown support
- `set_multiple_annotations` - Batch create/update multiple annotations efficiently
- `scan_nodes_by_types` - Scan for nodes with specific types (useful for finding annotation targets)

### Prototyping & Connections

- `get_reactions` - Read prototype reactions in node subtrees, including interactive-component `CHANGE_TO` transitions
- `set_default_connector` - Set a copied FigJam connector as the default connector style for creating connections (must be set before creating connections)
- `create_connections` - Create FigJam connector lines between nodes, based on prototype flows or custom mapping

### Creating Elements

- `create_rectangle` - Create a new rectangle with position, size, and optional name
- `create_frame` - Create a new frame with position, size, and optional name
- `create_section` - Create a section to group related content on the canvas
- `create_text` - Create a new text node with customizable font properties

### Modifying text content

- `scan_text_nodes` - Scan text nodes with intelligent chunking for large designs
- `set_text_content` - Set the text content of a single text node
- `set_multiple_text_contents` - Batch update multiple text nodes efficiently

### Auto Layout & Spacing

- `set_layout_mode` - Set the layout mode and wrap behavior of a frame (NONE, HORIZONTAL, VERTICAL)
- `set_padding` - Set padding values for an auto-layout frame (top, right, bottom, left)
- `set_axis_align` - Set primary and counter axis alignment for auto-layout frames
- `set_layout_sizing` - Set horizontal and vertical sizing modes for auto-layout frames (FIXED, HUG, FILL)
- `set_item_spacing` - Set distance between children in an auto-layout frame

### Styling

- `set_fill_color` - Set the fill color of a node (RGBA)
- `set_stroke_color` - Set the stroke color and weight of a node
- `set_corner_radius` - Set the corner radius of a node with optional per-corner control
- `set_image_fill` - Fill a node with an image from a local file path, URL, or base64 data (FILL, FIT, CROP, or TILE)

### Layout & Organization

- `move_node` - Move a node to a new position
- `resize_node` - Resize a node with new dimensions
- `delete_node` - Delete a node
- `delete_multiple_nodes` - Delete multiple nodes at once efficiently
- `clone_node` - Create a copy of an existing node with optional position offset
- `rename_node` - Rename a node
- `set_parent` - Move a node into a new parent (section, frame or group), preserving its absolute position by default
- `set_focus` - Select one node and bring it into view
- `set_selections` - Select multiple nodes and bring them into view

### Components & Styles

- `get_styles` - Get document-wide local styles with progress heartbeats
- `get_local_components` - Get document-wide component counts/name families by default, or a paginated component list; scope with `pages` and bound with `timeBudgetMs` on large documents. Summary mode also clusters components into `authoringSessions` by node-id prefix, so a bulk-pasted vendor kit is distinguishable from hand-authored work
- `get_variables` - Get document-wide variable collections, modes, and resolved values
- `get_node_variables` - Resolve every design token in a node subtree — both variable bindings and style references
- `create_component_instance` - Create an instance of a component
- `get_instance_overrides` - Extract override properties from a selected component instance
- `set_instance_overrides` - Apply extracted overrides to target instances

### Export & Advanced

- `export_node_as_image` - Export a node as an image (PNG, JPG, SVG, or PDF) - limited support on image currently returning base64 as text

### Connection Management

- `join_channel` - Join a specific channel to communicate with Figma
- `get_runtime_info` - Report the exact fork server/plugin build, schema, relay protocol, capabilities, and compatibility status

### MCP Prompts

The MCP server includes several helper prompts to guide you through complex design tasks:

- `design_strategy` - Best practices for working with Figma designs
- `read_design_strategy` - Best practices for reading Figma designs
- `text_replacement_strategy` - Systematic approach for replacing text in Figma designs
- `annotation_conversion_strategy` - Strategy for converting manual annotations to Figma's native annotations
- `swap_overrides_instances` - Strategy for transferring overrides between component instances in Figma
- `reaction_to_connector_strategy` - Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions', and guiding the use 'create_connections' in sequence

## Development

The root `bun.lock` is authoritative. A measured clean
`bun install --frozen-lockfile` succeeds. `package-lock.json` is retained as legacy
traceability, but its root metadata is still `0.3.1` while the package is `0.3.5`; a
clean npm attempt did not produce a valid install, so npm is not a supported install
path. The nested package/lock under `src/talk_to_figma_mcp/` is legacy source metadata,
not the release root.

One command runs every offline test, including the real-plugin VM fixtures, public
contract compatibility/parity checks, README inventory check, and independent plugin
syntax parse:

```bash
bun run test
```

Run the complete offline release gate (tests, build, and `dist/` identity/inventory
parity) with:

```bash
bun run verify
```

The generated machine-readable inventory is
[`contracts/public-contract.json`](contracts/public-contract.json). After reviewing an
intentional public contract change, refresh the snapshot and both runtime fingerprints
with `bun run contract:generate`.

Live smoke is deliberately separate from offline tests. With the relay and exact DEV
plugin running on a disposable file:

```bash
node scripts/live-smoke.mjs --channel=<channel-shown-in-plugin>
```

It performs one bounded read, creates an isolated frame/text pair, reads them back, and
deletes only those recorded IDs in `finally` cleanup.

### Building the Figma Plugin

1. Navigate to the Figma plugin directory:

   ```
   cd src/cursor_mcp_plugin
   ```

2. Edit code.js and ui.html

## Best Practices

When working with the Figma MCP:

1. Always join a channel before sending commands
2. Get the document page index using `get_pages`, then use `get_document_info` for the current page
3. Check current selection with `get_selection` before modifications
4. Use appropriate creation tools based on needs:
   - `create_frame` for containers
   - `create_rectangle` for basic shapes
   - `create_text` for text elements
5. Verify changes using `get_node_info`
6. Use component instances when possible for consistency
7. Handle errors appropriately as all commands can throw exceptions
8. For large designs:
   - Use chunking parameters in `scan_text_nodes`
   - Keep `get_local_components` in its default summary mode unless individual component IDs are needed
   - Monitor progress through WebSocket updates
   - Implement appropriate error handling
9. For text operations:
   - Use batch operations when possible
   - Consider structural relationships
   - Verify changes with targeted exports
10. For converting legacy annotations:
    - Scan text nodes to identify numbered markers and descriptions
    - Use `scan_nodes_by_types` to find UI elements that annotations refer to
    - Match markers with their target elements using path, name, or proximity
    - Categorize annotations appropriately with `get_annotations`
    - Create native annotations with `set_multiple_annotations` in batches
    - Verify all annotations are properly linked to their targets
    - Delete legacy annotation nodes after successful conversion
11. Visualize prototype noodles as FigJam connectors:

- Use `get_reactions` to extract prototype flows,
- set a default connector with `set_default_connector`,
- and generate connector lines with `create_connections` for clear visual flow mapping.

## License

MIT
