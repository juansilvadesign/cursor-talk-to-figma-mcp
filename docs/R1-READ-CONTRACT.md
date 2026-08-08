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
| `get_node_variables` | node_subtree | standard | additive-preview | per 100 nodes + heartbeat |
| `get_reactions` | requested_node_subtrees | standard | additive-preview | per requested root |
| `get_annotations` | document_or_node_subtree | standard | stable | operation specific |
| `get_selection` | current_page_selection | standard | stable | none |
| `read_my_design` | current_page_selection | standard | **legacy** | none |
| `scan_text_nodes` | node_subtree | standard | stable | chunked |
| `scan_nodes_by_types` | node_subtree | standard | stable | chunked |
| `get_instance_overrides` | node_or_current_page_selection | standard | stable | none |
| `export_node_as_image` | node | standard | additive-preview | none |

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
| `get_node_variables` | bounded by the subtree you name — do not pass a page unless you mean it |
| `export_node_as_image` | `scale`, and **`filePath`** to keep bytes out of the transcript |

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
  "delivery": "inline"
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

---

## Verification

- `bun run verify` — contract parity, plugin parse, all offline tests, build, `dist/` parity.
- `tests/read-acceptance.test.mjs` — the READ-LAYER-PLAN acceptance cases as invariants.
- `tests/plugin-runtime.test.mjs` — real-`code.js` VM runs against committed fixtures.
- `tests/export-receipt.test.mjs` — receipt and dimension parsing, including the
  formats that must return `null`.
