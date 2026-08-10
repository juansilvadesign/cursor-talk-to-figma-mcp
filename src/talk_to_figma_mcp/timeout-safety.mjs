const EXPORT_TIMEOUT_ISSUE =
  "export_node_as_image exceeded its inactivity budget. The Figma plugin may still be encoding; call get_runtime_info to prove it is responsive before another document operation.";

/**
 * Latch runtime safety after a command timeout when the underlying Figma work cannot
 * be cancelled. Identity from the last successful probe is retained for diagnostics;
 * get_runtime_info is allowed through the latch and will either restore compatibility
 * or replace the stale identity with an explicit failed-probe result.
 *
 * @param {Record<string, unknown>} current
 * @param {string} command
 * @param {string} checkedAt
 * @returns {Record<string, unknown>}
 */
export function runtimeCompatibilityAfterTimeout(
  current,
  command,
  checkedAt = new Date().toISOString(),
) {
  if (command !== "export_node_as_image") return current;

  return {
    status: "incompatible",
    checkedAt,
    issues: [EXPORT_TIMEOUT_ISSUE],
    plugin: current.plugin ?? null,
  };
}
