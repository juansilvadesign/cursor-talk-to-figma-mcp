# R1 read contract

The stable read surface a consumer may depend on without reading fork source.

**How this document was produced.** Every field list below was captured from an actual
reply — the real `code.js` runtime driven through `tests/helpers/plugin-harness.mjs` —
not written from prose. This matters: `figma-to-code`'s first integration produced seven
payload-shape corrections, and **all seven were in validators written from this repo's
prose docs rather than from observed replies.** If you change a read, re-capture the
shape rather than editing the table by hand.

The machine-readable companion is [`contracts/public-contract.json`](../contracts/public-contract.json):
name, direction, scope, input schema, timeout class, progress behavior, plugin command,
and result stability for all 49 tools. That file is generated; this one explains it.

---

## Reading the columns

**Scope** — what the tool is allowed to look at. Never inferred; always echoed in the
reply's own `scope` field.

**Timeout class**

| Class | Budget | Applies to |
| --- | --- | --- |
| `standard` | 30 s | Everything whose cost is bounded by its arguments |
| `heavy_read` | 120 s | Reads whose cost scales with **file size**, not arguments |
| `preflight` | 30 s | `get_runtime_info`, before any document operation |

A plugin progress update resets the inactivity timer to `max(60 s, the request's own
budget)`. The `max` is load-bearing: a heavy read's `started` update lands within
milliseconds and would otherwise downgrade a 120 s budget to 60 s instantly.

**Result stability** — see [`COMPATIBILITY-POLICY.md`](COMPATIBILITY-POLICY.md).
`stable` results are frozen, `additive-preview` results may grow new fields,
`legacy` results predate the contract and may be restructured.

---

## The read surface

| Tool | Scope | Timeout | Stability | Progress |
| --- | --- | --- | --- | --- |
| `get_runtime_info` | connection | preflight | stable | none |
| `join_channel` | connection | standard | stable | none |
| `get_pages` | document | heavy_read | additive-preview | conditional per page |
| `set_current_page` | session_navigation | standard | additive-preview | none |
| `get_document_info` | current_page_with_document_page_index | heavy_read | additive-preview | none |
| `get_styles` | document | heavy_read | additive-preview | per resource + heartbeat |
| `get_variables` | document | standard | additive-preview | per type + heartbeat |
| `get_local_components` | document_or_selected_pages | heavy_read | additive-preview | per page + heartbeat |
| `get_node_info` | node_subtree | standard | stable | none |
| `get_nodes_info` | requested_node_subtrees | standard | stable | none |
| `get_node_variables` | node_subtree | heavy_read | additive-preview | per 100 nodes + heartbeat |
| `get_reactions` | requested_node_subtrees | standard | additive-preview | per requested root |
| `get_annotations` | document_or_node_subtree | standard | stable | operation specific |
| `get_selection` | current_page_selection | standard | stable | none |
| `read_my_design` | current_page_selection | standard | **legacy** | none |
| `scan_text_nodes` | node_subtree | standard | stable | chunked |
| `scan_nodes_by_types` | node_subtree | standard | stable | chunked |
| `get_instance_overrides` | node_or_current_page_selection | standard | stable | none |
| `export_node_as_image` | node | heavy_read | additive-preview | preflight + encoding |
| `export_image_fill` | image_fill | heavy_read | additive-preview | fetch + delivery |

---

## Completeness fields — how to tell a partial read from a total

**The rule: partial coverage is always stated, never implied by absence.** A consumer
must never conclude "the file has none" from an empty array. Check these first.

| Field | Meaning |
| --- | --- |
| `scope` | What the reply actually covers. Present on every read. |
| `complete` | `false` whenever anything was skipped, truncated, or budgeted out. |
| `supported` | `false` when the Figma API this read needs is unavailable in the running version. |
| `limitations[]` | Human-readable reasons the result is not total. Empty when complete. |
| `errors[]` | Per-item failures that did not abort the read. |
| `pagination.hasMore` | More children exist beyond the returned slice. |
| `childrenTruncated` | The child list was cut; the rollups still describe **all** children. |
| `familiesTruncated` / `sessionsTruncated` | The rollup listing was capped; the `*Count` field keeps the true total. |
| `pagesSkipped[]` / `pagesNotFound[]` | Named, not silently dropped. |
| `resolutionStatus` | Per-entry: `resolved`, `mixed`, `style_not_found`, `variable_not_found`, `resolution_failed`. |
| `valueStatus` | **New in R1.** Per style reference: `resolved`, `unsupported_style_type`, `read_failed`, `not_applicable`. |

### The invariant that matters most

**Rollups describe the whole population, not the returned slice.** With `limit: 2` on an
826-child page, `childTypes` still sums to 826. A consumer that sums `childTypes` to
size a page gets the right answer regardless of pagination. Locked by
`tests/read-acceptance.test.mjs`.

---

## Cost controls

Every heavy read is bounded by default. These are the knobs:

| Tool | Controls |
| --- | --- |
| `get_document_info` | `summary` (rollups on/off), `limit`, `offset`, `familyLimit` |
| `get_local_components` | `pages[]` (scope to specific pages), `summary`, `familyLimit`, `sessionLimit`, `timeBudgetMs` |
| `get_pages` | `includeChildCount` (opt-in; measured cheap on a 6-page/826-child file) |
| `get_node_variables` | `maxNodes` (**defaults to 5000**), `timeBudgetMs`, `limit`, `offset` — **added in R2**, see below |
| `export_node_as_image` | `scale`, `allowLargeExport` (explicit risk override), and **`filePath`** to keep bytes out of the transcript |
| `export_image_fill` | an explicit `paintIndex` (never an implicit first fill) and **`filePath`** to keep original image bytes out of the transcript |

### R2 amendment — `get_node_variables` is bounded by default

Until R2 this row read *"bounded by the subtree you name"*, which was not a bound at all:
naming a page meant traversing it. A page-wide scan of 11,733 nodes returned 3.66 MB and
left the plugin unable to answer **any** subsequent command until it was reloaded. R2
gives the scan the same treatment every other large read already had:

- `maxNodes` caps the traversal and **defaults to 5000** (ceiling 50000). This is a
  default rather than an opt-in because the failure it prevents is silent.
- `timeBudgetMs` (default `0`, meaning no budget) caps wall-clock time, and the clock
  starts **before** the page load, which on a dynamic-page file is often the most
  expensive step.
- `limit` (default 1000, ceiling 5000) and `offset` window the `bindings` and `styles`
  arrays independently. Traversal order is stable, so paging is repeatable.
- `bindingCount` / `styleCount` keep their old meaning — totals across everything
  scanned, never the array lengths — so truncation is always visible, never inferred.
- New `coverage` and `pagination` blocks report `maxNodes`, `nodeCapReached`,
  `timeBudgetMs`, `budgetExhausted`, `traversalTruncated`, and per-array
  `returned`/`total`/`truncated`/`hasMore`. `complete` is false whenever any of them
  truncated, so a capped reply can never read as a full census of the subtree.

Also in R2: **`export_node_as_image` moved from the 30 s default to
`HEAVY_READ_TIMEOUT_MS` (120 s).** Its cost scales with pixel area and with
base64-transferring the bytes back through the relay, neither visible in the arguments —
and the multi-megabyte exports `filePath` exists for are exactly the ones that exceeded
30 s. `get_node_variables` moved with it, since a 5000-node scan is not a 30 s job
either. Raising a timeout class is treated as a **compatible** change by the contract
gate (a consumer prepared to wait less cannot break); lowering one is rejected.

### R2.1 amendment — raster exports declare their cost before encoding

The 120 s timeout does not cancel `node.exportAsync()`: Figma may continue rasterizing
after the MCP request has failed and leave the plugin unable to answer any command. R2.1
therefore bounds the work before entering the encoder:

- PNG/JPG preflight uses `absoluteRenderBounds` when available, otherwise the node's
  `width`/`height`, applies `scale` to both dimensions, and reports projected dimensions
  plus megapixels in the receipt's `preflight` block.
- **16 MP is the fork safety ceiling**, not a claimed Figma platform limit. A larger or
  unmeasurable raster request is refused before `exportAsync` unless the caller passes
  `allowLargeExport: true`. The error reports the dimensions, scale, projected MP, and
  the ceiling so the caller can reduce scope deliberately.
- SVG/PDF receive the same projection for planning, but the raster ceiling is not
  applied (`limitApplied: false`) because pixel area is not their encoding cost model.
- A `started` progress update is flushed before encoding, followed by preparation and
  completion updates. These identify where a long request reached; they do not raise or
  remove the 120 s inactivity bound.
- If an explicitly overridden export still times out, the server immediately marks the
  runtime incompatible. Only `get_runtime_info` may clear that latch by proving the
  plugin is responsive again.

This is a deliberate default-behavior change for raster requests above 16 MP, so the
contract/schema/plugin API moved from `1.2.0` to `1.2.1`. Migration guidance and the
accepted live evidence are recorded in
[`R2.1-EXPORT-SAFETY.md`](R2.1-EXPORT-SAFETY.md).

Scoping changes the reply shape on purpose: a scoped `get_local_components` **omits
`pageCount`** and says so in `limitations` — `"Scoped to N requested page(s); N scanned
of M in the document. Counts are not a document total."` A scoped count is not a
document count and the contract refuses to let it look like one.

---

## Observed top-level reply fields

Captured from the real plugin runtime. Nested shapes are in the fixtures.

```text
get_pages              scope, document, currentPageId, pageCount, childCountIncluded, pages
get_document_info      scope, summary, document, name, id, type, currentPage,
                       childrenTruncated, pagination, pageCount, pages, childTypes,
                       childFamilyCount, childFamilies, childFamiliesTruncated,
                       familyLimit, children
set_current_page       success, currentPage
get_styles             scope, colors, texts, effects, grids, counts
get_variables          scope, supported, complete, requestedTypes, collectionCount,
                       variableCount, resolutionIssueCount, limitations, collections, errors
get_local_components   scope, complete, pagesTotal, pagesRequested, pagesScanned,
                       pagesSkipped, pagesNotFound, limitations, summary, count, pages,
                       familyCount, nameFamilies, familiesTruncated, familyLimit,
                       sessionCount, authoringSessions, sessionsTruncated, sessionLimit
get_node_info          id, name, type, cornerRadius, children  (+ node-type fields:
                       characters, fills, boundVariables, layoutMode, …)
get_nodes_info         ARRAY of per-node entries — not an object
get_node_variables     scope, supported, variablesSupported, stylesSupported, complete,
                       limitations, rootNode, nodesScanned, bindingCount,
                       unresolvedBindings, bindings, styleCount, unresolvedStyles, styles
get_reactions          scope, complete, coverage, nodesCount, nodesWithReactions, nodes, errors
get_annotations        scope, nodeId, name, type, annotationCount, annotations, categories
get_selection          scope, pageId, selectionCount, selection
```

`get_nodes_info` returning an array rather than an object is the kind of detail that
costs a consumer an afternoon. It is listed here because it was observed, not assumed.

---

## What R1 changed

### `get_node_variables` — style references now carry their value

Each entry in `styles[]` gains `value` and `valueStatus` beside the existing
`styleName`, `styleType`, `remote`, and `resolutionStatus`.

| `styleType` | `value` shape |
| --- | --- |
| `PAINT` | `{ paints: [...] }` |
| `TEXT` | `{ fontName, fontSize, lineHeight, letterSpacing, paragraphSpacing, paragraphIndent, textCase, textDecoration }` |
| `EFFECT` | `{ effects: [...] }` |
| `GRID` | `{ layoutGrids: [...] }` |

**Why it exists.** `get_styles` lists **local** styles only. On a file that references an
external library the value was recoverable only by joining `get_node_variables` against
`get_node_info` — and that join is lossy, because `get_node_info` reached 31 %/40 % of
the nodes the token scan visits, landing only 20–26 % of style references on a readable
node. On the reporting fixture that left `atencao` — the file's second-most-used paint
style, 248 references — permanently unresolvable. The value now arrives on the reference
itself, so no join is required.

`valueStatus` exists so an absent `value` is never ambiguous: `unsupported_style_type`
means this build cannot read that style type, `read_failed` means the style resolved but
its value did not, `not_applicable` means there was no single style to read (a `mixed`
reference, or one whose style was not found).

### `export_node_as_image` — a typed receipt, and an optional file path

The reply now always includes a JSON receipt:

```json
{
  "nodeId": "1:23",
  "format": "PNG",
  "scale": 2,
  "mimeType": "image/png",
  "bytes": 4501234,
  "sha256": "a1b2…",
  "width": 1440,
  "height": 900,
  "dimensionSource": "png-ihdr",
  "delivery": "inline",
  "preflight": {
    "boundsSource": "absoluteRenderBounds",
    "projectedWidth": 1440,
    "projectedHeight": 900,
    "projectedMegapixels": 1.296,
    "megapixelLimit": 16,
    "limitApplied": true,
    "costKnown": true,
    "overLimit": false,
    "overrideUsed": false
  }
}
```

**Without `filePath`** the reply is the image content block *plus* this receipt —
unchanged for existing callers, with attribution added. **With `filePath`** (absolute
path required) the bytes are written to disk, `delivery` is `"file"`, `path` is added,
and **no base64 appears in the transcript at all**. Two frames on the reporting fixture
returned 4.29 MB and 1.73 MB of base64 in a single reply each; that is what `filePath`
is for.

`width`/`height` are parsed from the exported bytes — PNG `IHDR`, JPEG `SOF`, SVG
attributes or `viewBox` — so they describe the artifact Figma actually produced rather
than the node box times the scale. **PDF exports report `null` dimensions** with
`dimensionSource: null`, because a PDF has no single intrinsic pixel size and inventing
one would be a fabrication. Always read `dimensionSource` before trusting a size.
`preflight.projectedWidth`/`projectedHeight` are deliberately separate: they are a
before-encoding cost estimate, while the top-level dimensions are parsed evidence from
the resulting artifact.

### `export_image_fill` — original bytes from one exact paint

`export_node_as_image` composites a node's backgrounds, children, and overlays. That is
not sufficient when an image fill belongs to a text-bearing section root. This read takes
both `nodeId` and an explicit zero-based `paintIndex`, refuses a non-`IMAGE` paint, then
uses Figma's image handle to retrieve the stored source bytes without changing the node.

Its receipt records the original image hash, byte hash, intrinsic dimensions, and the
complete matching image-paint metadata (`scaleMode`, crop transform, opacity and any
future additive fields). The stored bytes are not re-encoded: there is no requested
format or scale. With `filePath`, the server writes the bytes locally and returns only the
receipt; otherwise it returns an image content block when its byte signature identifies a
supported image MIME type. Unknown signatures are not mislabeled.

---

## Verification

- `bun run verify` — contract parity, plugin parse, all offline tests, build, `dist/` parity.
- `tests/read-acceptance.test.mjs` — the READ-LAYER-PLAN acceptance cases as invariants.
- `tests/plugin-runtime.test.mjs` — real-`code.js` VM runs against committed fixtures.
- `tests/export-receipt.test.mjs` — receipt and dimension parsing, including the
  formats that must return `null`.
