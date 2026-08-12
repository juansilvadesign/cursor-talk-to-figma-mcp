/**
 * The shared batch receipt vocabulary.
 *
 * Finding 2 of the R2.4 audit (`docs/BATCH-CONTRACT-PLAN.md`) exists because the three
 * shipped batch tools each invented their own nouns for one concept —
 * `replacementsApplied` / `annotationsApplied` / `nodesDeleted`, each with its own
 * `*Failed` and `total*` spelling. A second generic implementation that does not share
 * this code becomes the fourth dialect, so `apply_batch` and (in Phase 4) the three
 * legacy tools both read their vocabulary from here.
 *
 * Everything in this module is a dependency-free pure function on plain data. That is
 * deliberate: `src/cursor_mcp_plugin/code.js` runs in the Figma plugin sandbox as a
 * single bundled file and cannot `import`, so the plugin half of Phase 4 has to carry a
 * mirrored copy. Keeping this module free of Node built-ins and of `zod` is what makes
 * that mirror mechanical, and a parity test — not a convention — is what will have to
 * hold the two copies together.
 */

/**
 * The aggregate outcomes, ordered from best to worst.
 *
 * This is D2: a typed enum, never a boolean. It is the direct fix for Finding 1 — all
 * three shipped tools return `success: successCount > 0`, so a batch of 100 where 99
 * fail reports `success: true`. The precedent is R2.3's `operation` field
 * (`set` / `removed` / `noop_absent`), which reports what actually happened instead of
 * collapsing it to success.
 */
export const BATCH_OUTCOMES = Object.freeze([
  "all_succeeded",
  "partial",
  "all_failed",
  "refused_prevalidation",
]);

/** The per-operation statuses. `skipped` means "never attempted", not "attempted and failed". */
export const OPERATION_STATUSES = Object.freeze([
  "succeeded",
  "failed",
  "skipped",
]);

/**
 * Named refusal codes. A refusal is an expected outcome with a stable code, not an
 * anonymous string a consumer has to pattern-match on.
 */
export const BATCH_ERROR_CODES = Object.freeze({
  DUPLICATE_OPERATION_ID: "duplicate_operation_id",
  OPERATION_NOT_ALLOWED: "operation_not_allowed",
  NODE_NOT_FOUND: "node_not_found",
  BUDGET_EXHAUSTED: "budget_exhausted",
  OPERATION_FAILED: "operation_failed",
});

/**
 * The v1 operation allowlist: node-scoped mutations that take an explicit `nodeId`.
 *
 * ⛔ Every `create_*` is absent by decision, not by oversight — v1 is mutate-only, so an
 * operation may only target a node ID that already exists. The reason is D1: with
 * existing IDs the prevalidation pass is *total*, and `TASKS.md:663` already requires
 * destructive batch operations to report their resolved scope before mutation. A create's
 * ID does not exist at prevalidation time, so admitting creates would silently degrade
 * that guarantee to partial. See EXCLUDED_BATCH_OPERATIONS, which pins the absence.
 */
export const V1_BATCH_OPERATIONS = Object.freeze([
  "delete_node",
  "move_node",
  "rename_node",
  "resize_node",
  "set_axis_align",
  "set_corner_radius",
  "set_fill_color",
  "set_item_spacing",
  "set_layout_mode",
  "set_layout_sizing",
  "set_padding",
  "set_parent",
  "set_plugin_data",
  "set_stroke_color",
  "set_text_content",
]);

/**
 * Operations that are excluded by design, each with the reason it is excluded. This is
 * the R2.2 pattern: `create_page`'s `onDuplicate` pins `"reuse"` absent with a test
 * rather than leaving its absence to be read as an oversight and quietly added later.
 */
export const EXCLUDED_BATCH_OPERATIONS = Object.freeze({
  create_rectangle: "v1 is mutate-only; creates arrive later as a new op kind",
  create_frame: "v1 is mutate-only; creates arrive later as a new op kind",
  create_text: "v1 is mutate-only; creates arrive later as a new op kind",
  create_section: "v1 is mutate-only; creates arrive later as a new op kind",
  create_page: "v1 is mutate-only; creates arrive later as a new op kind",
  create_component_instance:
    "v1 is mutate-only; creates arrive later as a new op kind",
  create_connections: "v1 is mutate-only; creates arrive later as a new op kind",
  export_node_as_image:
    "binary payloads have their own bounded contract and belong nowhere near a 200-item receipt",
  join_channel: "connection plumbing stays distinct from document commands",
  get_runtime_info: "connection plumbing stays distinct from document commands",
  set_multiple_text_contents: "a batch of batches has no defined receipt",
  set_multiple_annotations: "a batch of batches has no defined receipt",
  delete_multiple_nodes: "a batch of batches has no defined receipt",
});

/**
 * Classify a run into one of BATCH_OUTCOMES.
 *
 * The load-bearing rule is the middle one: **`succeeded === 0` is always `all_failed`**,
 * whatever the mix of `failed` and `skipped` beneath it. "No operation was applied" is
 * the honest reading, and it is the single property that makes Finding 1 unrepeatable —
 * there is no combination of counts that reports success when nothing succeeded.
 *
 * @param {{total: number, succeeded: number, failed: number, skipped: number, refusedPrevalidation?: boolean}} counts
 * @returns {"all_succeeded"|"partial"|"all_failed"|"refused_prevalidation"}
 */
export function classifyOutcome(counts) {
  const { total, succeeded, failed, skipped, refusedPrevalidation } = counts;

  if (refusedPrevalidation) return "refused_prevalidation";

  if (!Number.isInteger(total) || total < 1) {
    throw new Error("a batch outcome requires at least one operation");
  }
  if (succeeded + failed + skipped !== total) {
    throw new Error(
      `operation counts do not sum to total: ${succeeded}+${failed}+${skipped} !== ${total}`,
    );
  }

  if (succeeded === total) return "all_succeeded";
  if (succeeded === 0) return "all_failed";
  return "partial";
}

/**
 * Build the aggregate block from the per-operation receipts, so the counts can never
 * disagree with the operations they summarize — the way `successCount` currently can.
 *
 * @param {Array<{status: string}>} operations
 * @param {{refusedPrevalidation?: boolean}} [options]
 * @returns {{outcome: string, total: number, succeeded: number, failed: number, skipped: number}}
 */
export function summarizeOperations(operations, options = {}) {
  const counts = { total: operations.length, succeeded: 0, failed: 0, skipped: 0 };

  for (const operation of operations) {
    if (!OPERATION_STATUSES.includes(operation.status)) {
      throw new Error(`unknown operation status ${JSON.stringify(operation.status)}`);
    }
    counts[operation.status] += 1;
  }

  return {
    outcome: classifyOutcome({
      ...counts,
      refusedPrevalidation: options.refusedPrevalidation,
    }),
    ...counts,
  };
}

/**
 * Return the ids that appear more than once, in first-seen order.
 *
 * D8: `id` is caller-supplied and required, and receipts correlate by it rather than by
 * array position, so a caller that reorders or filters its own operations does not have
 * to re-derive which receipt belongs to which request. That correlation only holds if
 * ids are unique, which is why a collision is a refusal rather than a warning.
 *
 * @param {Array<{id: string}>} operations
 * @returns {string[]}
 */
export function duplicateOperationIds(operations) {
  const seen = new Set();
  const duplicates = new Set();
  for (const operation of operations) {
    if (seen.has(operation.id)) duplicates.add(operation.id);
    seen.add(operation.id);
  }
  return [...duplicates];
}

/**
 * Return the operations whose `op` is not on the v1 allowlist, each with the reason.
 * An excluded-by-design op reports its recorded reason; anything else is simply unknown.
 *
 * @param {Array<{id: string, op: string}>} operations
 * @returns {Array<{id: string, op: string, reason: string}>}
 */
export function disallowedOperations(operations) {
  return operations
    .filter((operation) => !V1_BATCH_OPERATIONS.includes(operation.op))
    .map((operation) => ({
      id: operation.id,
      op: operation.op,
      reason:
        EXCLUDED_BATCH_OPERATIONS[operation.op] ||
        "not a v1 batch operation; see V1_BATCH_OPERATIONS",
    }));
}

/**
 * UTF-8 byte length, not UTF-16 code units.
 *
 * R2.3 established this the hard way against a real Figma write: `"é→😀"` is 9 bytes and
 * 4 units, and a size a consumer cannot reconcile with the platform's own limits is
 * worse than no size at all.
 *
 * @param {string} value
 * @returns {number}
 */
export function utf8ByteLength(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else {
      bytes += 4;
      index += 1; // surrogate pair: skip the low half
    }
  }
  return bytes;
}

/**
 * Truncate one operation's result while still reporting its true size — D6, the R2.3
 * `maxValueBytes` pattern. 500 receipts must not flood a caller's context, and a reply
 * that hides how much it dropped cannot be reasoned about.
 *
 * @param {unknown} result
 * @param {number} maxResultBytes
 * @returns {{result: unknown, bytes: number, truncated: boolean}}
 */
export function truncateResult(result, maxResultBytes) {
  if (result === undefined) {
    return { result: null, bytes: 0, truncated: false };
  }

  const encoded = JSON.stringify(result);
  const bytes = utf8ByteLength(encoded);
  if (bytes <= maxResultBytes) {
    return { result, bytes, truncated: false };
  }

  // The truncated form is a string, never a mangled object: half a JSON object is not
  // parseable, and a consumer that receives one has no way to tell it apart from a
  // complete one. Reporting the true `bytes` alongside is what keeps it honest.
  return {
    result: encoded.slice(0, Math.max(0, maxResultBytes)),
    bytes,
    truncated: true,
  };
}
