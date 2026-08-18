/**
 * R2.4 Phase 4.1 — the MCP reply formatter for the two prose batch tools.
 *
 * Phase 4.1 gave all three shipped batch tools the unified `outcome/succeeded/failed/
 * total/skipped` vocabulary, and the offline suite proved it by pinning the PLUGIN
 * handler — the layer that changed. The 5.6 live pass then recorded what that proof did
 * not cover: only `delete_multiple_nodes` reaches a live consumer with those fields,
 * because its wrapper answers `JSON.stringify(result)`. `set_multiple_text_contents` and
 * `set_multiple_annotations` formatted their reply as prose and returned no JSON, so the
 * unified fields were computed by the plugin, sent over the relay, and then DISCARDED by
 * the MCP wrapper. A green gate over a hole — Finding 4's shape, one layer up.
 *
 * ⛔ The fix is ADDITIVE, exactly as Phase 4 was. Every prose line those two tools
 * already emitted keeps its wording and its position, and the unified fields arrive as
 * an ADDITIONAL content item. A consumer reading the prose sees no change; a consumer
 * that wants the fields can now parse them. Replacing the prose with JSON would have
 * matched `delete_multiple_nodes` more tidily and broken every prose reader to get there.
 *
 * ⭐ This module is a pure function on plain data so the formatting can be pinned
 * without a relay, a plugin, or a Figma file. That is the cheap half of the proof; the
 * expensive half — that the wrapper is actually WIRED to it — is what
 * `tests/wrapper-end-to-end.test.mjs` exists to assert, because a formatter test alone
 * would reproduce the exact defect being fixed: pinning the layer that changed and
 * calling the path covered.
 */

/**
 * The unified fields, lifted off a plugin reply.
 *
 * Read defensively rather than destructured: this formatter must keep working against a
 * plugin build that predates Phase 4.1, and a missing `outcome` has to degrade to "the
 * JSON block carries whatever the plugin sent" rather than throw inside a tool handler.
 */
export function unifiedFields(result) {
  if (!result || typeof result !== "object") return null;
  const { outcome, total, succeeded, failed, skipped } = result;
  if (typeof outcome !== "string") return null;
  return { outcome, total, succeeded, failed, skipped };
}

/**
 * Render the chunk line.
 *
 * ⚠️ Both wrappers used to print `completedInChunks || 1`, which is a fabricated number
 * whenever the field is absent — and it IS absent for `set_multiple_annotations`, whose
 * handler processes one annotation at a time and has no chunks at all. The tool was
 * therefore reporting "Processed in 1 batches" for work that was never batched. When the
 * plugin does not report chunks, this says so instead of inventing a count.
 */
export function chunkLine(completedInChunks) {
  // ⛔ "batches" stays unpluralised even at 1, because that is the string
  // `set_multiple_text_contents` has always emitted and a chunk count of 1 is its most
  // common case. Correcting the grammar here would quietly rewrite the prose of a tool
  // this change was supposed to leave verbatim — the fix is scoped to the number being
  // FABRICATED, not to how it reads.
  return typeof completedInChunks === "number"
    ? `- Processed in ${completedInChunks} batches`
    : "- Processed one at a time (this tool does not chunk)";
}

function failureLines(results) {
  const failed = (Array.isArray(results) ? results : []).filter((item) => !item.success);
  if (failed.length === 0) return "";
  return `\n\nNodes that failed:\n${failed
    .map((item) => `- ${item.nodeId}: ${item.error || "Unknown error"}`)
    .join("\n")}`;
}

/**
 * Build the MCP `content` array for a legacy batch tool.
 *
 * `opening` is the tool's existing first content item and stays a separate entry, because
 * that is how it already shipped. The JSON block is appended LAST so that a consumer
 * reading `content[0]` or `content[1]` — the only two positions that existed before —
 * sees byte-identical text.
 */
export function legacyBatchReplyContent({ opening, summaryLines, results, raw }) {
  const content = [
    { type: "text", text: opening },
    { type: "text", text: `\n      ${summaryLines.join("\n      ")}\n      ` + failureLines(results) },
  ];
  content.push({ type: "text", text: JSON.stringify(raw) });
  return content;
}

/**
 * `set_multiple_text_contents` — the reply, unified fields included.
 */
export function textContentsReply(result, requestedCount) {
  const applied = result?.replacementsApplied || 0;
  return legacyBatchReplyContent({
    opening: `Starting text replacement for ${requestedCount} nodes. This will be processed in batches of 5...`,
    summaryLines: [
      "Text replacement completed:",
      `- ${applied} of ${requestedCount} successfully updated`,
      `- ${result?.replacementsFailed || 0} failed`,
      chunkLine(result?.completedInChunks),
    ],
    results: result?.results,
    raw: result,
  });
}

/**
 * `set_multiple_annotations` — the reply, unified fields included.
 *
 * ⚠️ The opening line no longer promises "batches of 5". The handler emits one progress
 * frame PER ANNOTATION (`chunkSize: 1`), so the batching this sentence announced never
 * existed. Phase 4.3 made the tool's `chunked` progress declaration true by giving it
 * real per-item frames; this makes its prose true by the same standard.
 */
export function annotationsReply(result, requestedCount) {
  const applied = result?.annotationsApplied || 0;
  return legacyBatchReplyContent({
    opening: `Starting annotation process for ${requestedCount} nodes, one at a time...`,
    summaryLines: [
      "Annotation process completed:",
      `- ${applied} of ${requestedCount} successfully applied`,
      `- ${result?.annotationsFailed || 0} failed`,
      chunkLine(result?.completedInChunks),
    ],
    results: result?.results,
    raw: result,
  });
}
