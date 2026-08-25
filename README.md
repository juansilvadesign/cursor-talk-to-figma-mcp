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
- `create_page` - Create a page with an explicit name, duplicate-name policy (`error` by default, or `allow`), and optional position; does not switch the active page
- `get_plugin_data` - Read a node's plugin metadata from this plugin's private store, or from a shared namespace any plugin can read; bounded by key paging and a value-size cap
- `set_plugin_data` - Write one plugin metadata entry on a node, or remove it with `value: null`
- `apply_batch` - Apply many node mutations in one call against existing node IDs; resolves every target before writing anything, supports a `prevalidateOnly` dry run, and returns a typed per-operation receipt correlated by your own `id`
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
- `create_node_from_svg` - Create a node tree from SVG source using Figma's own parser, returning one frame containing the parsed subtree. **Not idempotent** — every call appends a fresh copy, and the reply carries `duplicatesOnRerun` to say so at the call site. Bounded by SVG source length (512KB) rather than node count, because Figma offers no way to preflight how many nodes a document expands into; `createdNodeCount` is a reading taken afterwards. Deliberately absent from `apply_batch`'s allowlist
- `create_text` - Create a new text node with customizable font properties

### Modifying text content

- `scan_text_nodes` - Scan text nodes with intelligent chunking for large designs
- `set_text_content` - Set the text content of a single text node
- `set_multiple_text_contents` - Batch update multiple text nodes efficiently

### Typography

- `set_text_style` - Set typography on one TEXT node: font, size, line height, letter spacing, case, decoration, alignment, paragraph spacing/indent and auto-resize. Every parameter is optional, at least one is required, and the whole call is **validate-all-then-write** — every parameter is checked and every font loaded before the first property is assigned, so a refusal leaves the node untouched rather than half-written. ⛔ An unloadable font is **refused, never substituted**: unlike a text-content write it will not silently retype the node to Inter, so preflight with `check_fonts`. `lineHeight`/`letterSpacing` are `{value, unit}` objects, never bare numbers; properties are node-level and character ranges are not addressable. Supplying `fontFamily`/`fontStyle` on a mixed-font node unifies it, discarding its per-character runs, and says so in `limitations`

### Fonts

- `get_available_fonts` - List the fonts installed on the machine running Figma, as a bounded window with a whole-inventory `fontCount`/`familyCount` that survive the window. Filter with `family` instead of paging thousands of faces; ordering is a deterministic family-then-style code-unit sort, so `offset` paging is repeatable
- `check_fonts` - Preflight `{family, style}` pairs before a text write commits. Reports `available` (in the inventory), `familyAvailable` (the family exists under another style) and `loadable` (`loadFontAsync` actually succeeded) as separate facts, because a listed face can still refuse to load and `setCharacters` answers that refusal by substituting Inter silently

### Auto Layout & Spacing

- `set_layout_mode` - Set the layout mode and wrap behavior of a frame (NONE, HORIZONTAL, VERTICAL)
- `set_padding` - Set padding values for an auto-layout frame (top, right, bottom, left)
- `set_axis_align` - Set primary and counter axis alignment for auto-layout frames
- `set_layout_sizing` - Set horizontal and vertical sizing modes for auto-layout frames (FIXED, HUG, FILL)
- `set_item_spacing` - Set distance between children in an auto-layout frame
- `set_layout_child` - Set how a node participates in its parent's auto-layout (layoutGrow, layoutAlign, layoutPositioning). Requires an auto-layout parent and refuses otherwise; `layoutAlign: "STRETCH"` is refused in favour of `set_layout_sizing` FILL
- `set_constraints` - Set how a node resizes with its parent frame (horizontal/vertical: MIN, CENTER, MAX, STRETCH, SCALE). Either axis may be omitted and is carried over. The mirror of `set_layout_child`: it refuses a child in the flow of an auto-layout parent, and a top-level node on a PAGE
- `set_size_limits` - Set a node's `minWidth`/`maxWidth`/`minHeight`/`maxHeight`. Each limit is independent: omit to keep it, pass a positive number to set it, or pass `null` to remove it. The two fields of an axis are validated as a PAIR against the values the node already holds, so a call naming only `minWidth` is still checked against the stored `maxWidth`; a limit that conflicts with the node's current size makes Figma resize it, and the reply reports the size before and after
- `set_clips_content` - Set whether a frame clips content that extends past its bounds. Requires a node that carries `clipsContent` (FRAME, COMPONENT, COMPONENT_SET, INSTANCE); a GROUP is sized by its children and is refused. Writing the value the node already holds succeeds and reports `changed: false`. Because a stored boolean cannot show that anything happened, the reply also reports `absoluteRenderBounds` and `absoluteBoundingBox` before and after with the per-edge overflow between them — a null render measurement means the platform did not answer and is never reported as zero overflow

### Styling

- `set_fill` - Replace a node's fills with one or more paints, solid or gradient (linear, radial, angular, diamond). **This is the current fill surface** and takes one nested colour shape everywhere. Pass `paints: null` to remove every fill; an empty array is refused, because `null` already says that. All paints are validated before anything is written and the array lands as a single assignment, so a bad paint anywhere refuses the whole call without touching the document. Gradients are aimed with either a raw `gradientTransform` or an `angle` in degrees — never both — and the reply reports which one produced the matrix. The reply reads the fills back off the node rather than echoing the argument, and also reports `fillStyleId` before and after, because writing fills to a node with a paint style bound may detach that style
- `set_effects` - Replace a node's effects with `DROP_SHADOW`, `INNER_SHADOW`, `LAYER_BLUR`, or `BACKGROUND_BLUR`. Pass `effects: null` to remove every effect; an empty array is refused. Fields are checked against each effect type before one array assignment, so cross-type, unknown, or incomplete effects refuse without changing the node. The reply reads effects back from the node and reports `effectStyleId` before and after because an effects write may detach a bound effect style. `NOISE`, `TEXTURE`, and newer effect types are intentionally outside this release
- `set_opacity` - Set one node's Layer panel opacity from `0` through `1`, with `0` retained as a real fully transparent value. The receipt reads the node back and reports both the current and previous opacity; `get_node_info` intentionally stays unchanged in R2.7, so use the receipt to observe this additive write
- `set_blend_mode` - Set one node's Layer panel blend mode. This is distinct from paint and effect blend modes and accepts the full layer enum, including `PASS_THROUGH`. The receipt reads the node back and reports both the current and previous mode; `get_node_info` intentionally stays unchanged in R2.7
- `set_fill_color` - **Legacy.** Set the fill color of a node with flat `r, g, b, a` arguments. Kept for compatibility and frozen at `stable`; it takes a *different* shape from its own `apply_batch` operation, which takes `{color:{r,g,b,a}}`. Prefer `set_fill`, which is one shape on both surfaces
- `set_stroke_color` - Set the stroke color and weight of a node
- `set_corner_radius` - Set the corner radius of a node with optional per-corner control
- `set_image_fill` - Fill a node with an image from a local file path, URL, or base64 data (FILL, FIT, CROP, or TILE). **`CROP` requires `imageTransform`**, a 2×3 matrix naming which region to crop to, and the parameter is refused for every other mode. Measured 2026-08-23: Figma accepts a bare `CROP` but stores the identity matrix, which renders a *stretch* rather than a crop — so a bare `CROP` is now refused instead of silently degrading. The reply reports `scaleMode`, `imageTransform` and `imageTransformSource` read back off the node, not echoed from the request

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
- `get_variable_capabilities` - Read-only variable-write preflight: reports whether the required write APIs exist, each collection's `isRemote` and `modeCount`, plus the observed editor context. Figma exposes neither a read-only file-permission check nor a numeric mode-limit API, so it reports those facts as unknown rather than creating and deleting a mode to guess
- `add_variable_mode` - Add one named mode to an existing local variable collection. This performs the caller's requested `addMode()` write exactly once; a Figma pricing-tier refusal is returned verbatim, and a numeric limit is reported only when Figma's own message states it — never guessed from a plan table or a temporary create/delete probe
- `set_variable_value` - Set one existing local variable's value in one existing mode. Supply exactly one typed raw `value` or same-type local `aliasOf`; COLOR is strict RGBA 0–1 (no hex), and self/cyclic alias graphs are refused before a write
- `create_variable` - Create or match one COLOR, FLOAT, STRING, or BOOLEAN variable in an existing local collection. Identity resolves in order from optional exact `id`, then exact collection/name, then opaque private `identityKey`; receipts say `created` and `matchedBy`, so additive reruns do not duplicate resources
- `delete_variable` - Permanently remove one existing local variable only with literal `confirm: true`. The handler probes independent in-frame signals and names the one that observed removal; if none can, it returns `removal_unconfirmed` with `verificationDeferred` and requires a later read rather than claiming success
- `remove_variable_mode` - Permanently remove one mode from one existing local variable collection, only with literal `confirm: true`. Refuses the collection's **default** mode (Figma does not document where `defaultModeId` lands when the default is removed, and every variable resolves through it) and the **sole remaining** mode. The receipt reports the pre-call variable count as `blastRadius` — those variables keep their other modes and lose only the value they held for this one — and follows `removeMode()` with the same independent-signal probe as `delete_variable`, returning `removal_unconfirmed` with `verificationDeferred` rather than claiming success when nothing in-frame can observe it
- `create_variable_collection` - Create or match one named local variable collection. Identity resolves in the same fixed order as `create_variable` — optional exact `id`, then exact name across local collections, then opaque private `identityKey` — so an additive rerun matches instead of leaving a second collection behind. Figma returns a collection that already carries one mode; the receipt publishes it as `defaultMode` so no second read is needed before writing a value
- `rename_variable_mode` - Rename one mode of an existing local variable collection. Values, the default mode and every other mode are untouched. A rename to the mode's **current** name is refused as `mode_name_unchanged` rather than reported as applied, because a no-op rename and a rename that silently failed are byte-identical; Figma's duplicate-name refusal is preserved verbatim
- `set_variable_metadata` - Change `name`, `description` and/or `scopes` on one existing local variable. Figma offers no transaction across the three, so every supplied value is validated before the first assignment and each field is read back after it is written. A refusal part-way returns `partially_applied` with the exact `appliedFields` and `partialApplicationPossible: true` — never a plain refusal that would read as nothing changed. An empty `description` is legal and is how one is cleared
- `bind_variable_to_node` - Bind one existing local variable to one plain bindable field of a node (`width`, `characters`, `fontSize`, `itemSpacing`, `paddingLeft`, `visible`, …). This fork keeps no local table of which field accepts which type — Figma owns that rule, so a mismatch returns its refusal verbatim. `node.boundVariables` is re-read afterwards and the binding is reported only when it can be seen; `bind_unconfirmed` is also what an unbindable field name looks like, because Figma does not always throw for one
- `bind_variable_to_paint` - Bind one existing local **COLOR** variable to the colour of one paint in a node's `fills` or `strokes`. ⚠️ `setBoundVariableForPaint` returns a **new paint** rather than mutating one, and `node.fills` is readonly, so the handler replaces the whole array and reports `writeBackPerformed` — a call that skipped that step would throw nothing and change nothing. A non-COLOR variable is refused before any Figma call, `figma.mixed` paint lists are refused because `paintIndex` then names no single paint, and an out-of-range index is refused with the real paint count
- `get_node_variables` - Resolve every design token in a node subtree — both variable bindings and style references
- `create_component_instance` - Create an instance of a component
- `get_instance_overrides` - Extract override properties from a selected component instance
- `set_instance_overrides` - Apply extracted overrides to target instances

### Export & Advanced

- `export_node_as_image` - Export PNG/JPG/SVG/PDF with a typed receipt and preflight cost estimate. Use `filePath` to keep bytes out of context; PNG/JPG above 16 MP require explicit `allowLargeExport: true`

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

The fixture-specific R2.1 export acceptance is also executable. Against the SYD file
containing section `1113:5031`, it verifies the pinned runtime, fast over-limit refusal,
safe file-backed export, independent PNG bytes/hash/dimensions, and post-export
responsiveness:

```bash
node scripts/live-export-gate.mjs --channel=<channel-shown-in-plugin>
```

The harness writes its report and PNG under a new `/tmp/talk-to-figma-r2.1-live-*`
directory and prints the exact path.

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
