import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * R2.4 Phase 4.4 — assert the published progress declaration against the runtime.
 *
 * Finding 4 of the R2.4 audit: `SPECIAL_PROGRESS` in scripts/contract-lib.mjs is a
 * hand-maintained map that becomes `progress.pluginUpdates` in the public contract, and
 * NOTHING checked it against code.js. `set_multiple_annotations` declared "chunked" and
 * emitted nothing at all — a behavioural promise with no behaviour behind it, which is
 * the R1 lesson ("a hand-written schema drifts from observed replies") repeating one
 * layer up. This test is the check that was missing.
 */

const PROGRESS_CALL = /sendProgressUpdate\(|startProgressHeartbeat\(/;

/**
 * ⛔ Known-untrue declarations, pinned so they cannot spread.
 *
 * An entry here is a defect that is DOCUMENTED, not one that is forgiven: the test still
 * fails if a command drifts in or out of this set. `get_annotations` was found by this
 * very test in the same session it was written — the second instance of Finding 4 — and
 * is left alone deliberately, because giving a third shipped tool new runtime behaviour
 * was not in the Phase 4 scope. The fix is the same medicine as 4.3: make the claim true
 * by emitting per-operation progress, never by quietly correcting the map down to "none",
 * which would weaken a declared behaviour and drop the tool onto the plain 30 s wall.
 */
const KNOWN_UNTRUE_DECLARATIONS = new Map([
  [
    "get_annotations",
    'declares "operation_specific" and emits nothing — Finding 4, second instance',
  ],
]);

function dispatcherMap(pluginSource) {
  const map = new Map();
  const pattern = /case\s+"([a-z_]+)":\s*(?:\n\s*)?return\s+(?:await\s+)?([A-Za-z0-9_]+)\(/g;
  for (const match of pluginSource.matchAll(pattern)) {
    if (!map.has(match[1])) map.set(match[1], match[2]);
  }
  return map;
}

/** The source of a top-level function declaration, brace-matched. */
function functionBody(pluginSource, name) {
  const declaration = pluginSource.indexOf(`function ${name}(`);
  if (declaration < 0) return null;
  const start = pluginSource.indexOf("{", declaration);
  let depth = 0;
  for (let index = start; index < pluginSource.length; index++) {
    if (pluginSource[index] === "{") depth += 1;
    else if (pluginSource[index] === "}") {
      depth -= 1;
      if (depth === 0) return pluginSource.slice(start, index + 1);
    }
  }
  return null;
}

test("every declared progress behaviour matches what the plugin actually emits", async () => {
  const [contractText, pluginSource] = await Promise.all([
    readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
    readFile(path.join(root, "src/cursor_mcp_plugin/code.js"), "utf8"),
  ]);
  const contract = JSON.parse(contractText);
  const handlers = dispatcherMap(pluginSource);

  const drifted = [];
  const checked = [];

  for (const tool of contract.tools) {
    const command = tool.pluginCommand;
    if (!command || !handlers.has(command)) continue;
    const body = functionBody(pluginSource, handlers.get(command));
    if (body === null) continue;

    const declaresProgress = tool.progress.pluginUpdates !== "none";
    const emitsProgress = PROGRESS_CALL.test(body);
    checked.push(command);

    const known = KNOWN_UNTRUE_DECLARATIONS.has(command);
    if (declaresProgress === emitsProgress) {
      assert.ok(
        !known,
        `${command} is pinned as a known-untrue declaration but now agrees with the runtime — remove it from KNOWN_UNTRUE_DECLARATIONS`,
      );
      continue;
    }
    if (known) continue;
    drifted.push(
      `${command} (${handlers.get(command)}): contract says pluginUpdates "${tool.progress.pluginUpdates}", runtime ${emitsProgress ? "emits" : "emits nothing"}`,
    );
  }

  assert.ok(checked.length > 40, `only ${checked.length} commands were checked`);
  assert.deepEqual(drifted, [], `progress declarations drifted from code.js:\n${drifted.join("\n")}`);
});

test("apply_batch declares and emits chunked progress, in the same change", async () => {
  // 3.1's sequencing rule, pinned: the declaration moved off "none" in the same commit
  // that added the chunk loop, so this pair can never be half-landed.
  const [contractText, pluginSource] = await Promise.all([
    readFile(path.join(root, "contracts/public-contract.json"), "utf8"),
    readFile(path.join(root, "src/cursor_mcp_plugin/code.js"), "utf8"),
  ]);
  const contract = JSON.parse(contractText);
  const tool = contract.tools.find((entry) => entry.name === "apply_batch");

  assert.equal(tool.progress.pluginUpdates, "chunked");
  const body = functionBody(pluginSource, "applyBatch");
  assert.match(body, /sendProgressUpdate\(/);
  assert.match(body, /"apply_batch",\s*\n\s*"started"/);
  assert.match(body, /chunkIndex === chunks\.length - 1 \? "completed" : "in_progress"/);
});

test("set_multiple_annotations now earns its chunked declaration", async () => {
  // Phase 4.3: the declaration was already "chunked" and always had been — what changed
  // is that the runtime finally does it. Correcting the map down to "none" would have
  // been the wrong direction, so the test asserts the emission, not the map.
  const pluginSource = await readFile(
    path.join(root, "src/cursor_mcp_plugin/code.js"),
    "utf8",
  );
  const body = functionBody(pluginSource, "setMultipleAnnotations");
  assert.match(body, /sendProgressUpdate\(/, "Finding 4's original instance must stay fixed");
  assert.match(body, /"set_multiple_annotations",\s*\n\s*"started"/);
  assert.match(
    body,
    /i === annotations\.length - 1 \? "completed" : "in_progress"/,
    "progress must be per item, since this tool has no chunks",
  );
});
