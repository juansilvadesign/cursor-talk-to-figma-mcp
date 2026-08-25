#!/usr/bin/env node

/**
 * R3-A Phase 4 — live gate for `remove_variable_mode`, the modes slice.
 *
 * ⛔ This gate CREATES a disposable probe mode and REMOVES it, and — when pointed at a
 * residue collection — removes named gate debris left by the Phase 1.3 ceiling probe. Run
 * it ONLY on a disposable Figma file: a channel is transport, not evidence that its
 * document is safe, and removing a mode discards every variable's value for that mode.
 *
 *   node scripts/live-variable-mode-removal-gate.mjs \
 *     --channel=<DEV-plugin-channel-for-a-disposable-file> \
 *     --collection-id=<local-collection-with-at-least-2-modes-and-room-for-one-more> \
 *     --disposable-target=true \
 *     [--residue-collection-id=<collection-holding-the-authorized-residues>]
 *
 * ⭐ THE ORDER IS THE POINT. The probe mode is created, removed and fresh-read absent
 * BEFORE any residue is touched, so the tool is proved on a resource this gate owns rather
 * than first exercised on a real design-system copy. And because the probe manufactures its
 * own target, the gate stays rerunnable after the residues are gone.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

for (const option of ["channel", "collection-id"]) {
  if (!options[option]) {
    process.stderr.write(
      "Usage: node scripts/live-variable-mode-removal-gate.mjs --channel=<DEV-plugin-channel-for-a-disposable-file> --collection-id=<local-collection-id> --disposable-target=true [--residue-collection-id=<id>] [--output-dir=<artifact-directory>] [--server=<dist-server-path>]\n",
    );
    process.exit(2);
  }
}
if (options["disposable-target"] !== "true") {
  process.stderr.write(
    "Refusing to run: pass --disposable-target=true only after the channel is connected to a disposable Figma file. This gate adds and removes a mode, and removing a mode discards every variable's value for it.\n",
  );
  process.exit(2);
}

// Derived from runtime-metadata.ts after R3-A Phase 4 contract generation. Do not re-pin
// this script without a fresh run on a disposable target — a source edit is not live evidence.
const expectedRuntime = {
  serverBuildId: "r3-a-server-cfce6484d54a",
  pluginBuildId: "r3-a-plugin-07a616c3b48d",
  schemaVersion: "1.15.0",
  fingerprint:
    "sha256:5e6dcb91bd57c355bd6a2c3e9bb58cf393d6c01bca1d8cb847e69a4d9fee1af3",
  toolCount: 76,
};

// ⛔ THE ALLOWLIST IS THE SAFETY RAIL, and it is matched by EXACT NAME. The gate resolves
// these names against a fresh read of the residue collection rather than trusting the mode
// IDs recorded in the project memory: those IDs describe one file, and a disposable COPY of
// it re-issues them. A mode whose name is not on this list is never removed, whatever the
// caller passes.
const AUTHORIZED_RESIDUE_NAMES = Object.freeze([
  "R3A-GATE-DELETE-ME",
  "R3A-FILL-1",
  "R3A-FILL-2",
  "R3A-FILL-3",
  "R3A-FILL-4",
  "R3A-FILL-5",
]);

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const probeModeName = `__R3A Mode Removal Probe ${stamp}`;
const serverPath = options.server
  ? path.resolve(options.server)
  : path.join(root, "dist/server.js");
const pluginPath = path.join(root, "src/cursor_mcp_plugin/code.js");
const artifactDirectory = options["output-dir"]
  ? path.resolve(options["output-dir"])
  : await mkdtemp(path.join(os.tmpdir(), "talk-to-figma-r3a-mode-removal-"));
await mkdir(artifactDirectory, { recursive: true });
const reportPath = path.join(artifactDirectory, "report.json");

async function sha256OfFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const client = new Client({
  name: "talk-to-figma-r3a-mode-removal-gate",
  version: "1.0.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: root,
  stderr: "pipe",
});

function textContent(result) {
  return (result.content || [])
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n");
}

async function callRaw(name, args = {}, timeout = 120_000) {
  return client.callTool({ name, arguments: args }, undefined, {
    timeout,
    maxTotalTimeout: timeout,
  });
}

async function call(name, args = {}, timeout = 120_000) {
  const result = await callRaw(name, args, timeout);
  const text = textContent(result);
  if (result.isError || /^Error\b/.test(text)) {
    throw new Error(`${name} failed: ${text || "unknown MCP error"}`);
  }
  return { result, text };
}

async function callJson(name, args = {}, timeout = 120_000) {
  const called = await call(name, args, timeout);
  return { ...called, value: JSON.parse(called.text) };
}

async function joinWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      return await call("join_channel", { channel: options.channel });
    } catch (error) {
      lastError = error;
      const message = error && typeof error.message === "string" ? error.message : String(error);
      if (!/Not connected to Figma/.test(message) || attempt === 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

function assertRuntime(runtime) {
  assert.equal(runtime.server.buildId, expectedRuntime.serverBuildId);
  assert.equal(runtime.server.schemaVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.server.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(
    runtime.plugin?.buildId,
    expectedRuntime.pluginBuildId,
    "plugin build is stale — reload the DEV plugin before this gate",
  );
  assert.equal(runtime.plugin?.apiVersion, expectedRuntime.schemaVersion);
  assert.equal(runtime.plugin?.capabilityFingerprint, expectedRuntime.fingerprint);
  assert.equal(runtime.compatibility.status, "compatible");
  assert.deepEqual(runtime.compatibility.issues, []);
  assert.ok(
    runtime.plugin?.supportedCommands.includes("remove_variable_mode"),
    "plugin lacks remove_variable_mode — reload the DEV plugin",
  );
}

/**
 * A FRESH read, on a later call — the cross-frame instrument the receipt asks for.
 *
 * ⭐ Narrowed to ONE variable type on purpose. This gate reads a collection's **modes**, and
 * `get_variables` builds `collection.modes` from `collection.modes` unconditionally — the
 * type filter only shrinks the per-mode `variables` payload, which nothing here reads. On a
 * real design-system file the unfiltered call resolves every alias for every variable in
 * every mode, and this gate makes about a dozen of these; the filter turns a dozen heavy
 * reads into a dozen light ones without weakening a single assertion.
 *
 * ⚠️ The consequence, named rather than hidden: `collection.variableCount` in this snapshot
 * now counts BOOLEAN variables only. It is recorded as `getVariablesBooleanOnlyCount` and is
 * NOT compared against `blastRadius.variableCount`, which counts the collection's full
 * `variableIds` membership.
 */
async function readCollection(collectionId) {
  const snapshot = (await callJson("get_variables", { types: ["BOOLEAN"] })).value;
  return (
    (snapshot.collections || []).find((collection) => collection.id === collectionId) || null
  );
}

function modeNames(collection) {
  return (collection?.modes || []).map((mode) => mode.name);
}

function findMode(collection, predicate) {
  return (collection?.modes || []).find(predicate) || null;
}

const record = {
  gate: "R3-A Phase 4 variable mode removal",
  startedAt: new Date().toISOString(),
  channel: options.channel,
  collectionId: options["collection-id"],
  residueCollectionId: options["residue-collection-id"] || null,
  disposableTargetAcknowledged: true,
  artifactDirectory,
  expectedRuntime,
  artifactHashes: {
    server: await sha256OfFile(serverPath),
    plugin: await sha256OfFile(pluginPath),
  },
  checks: {},
  cleanup: [],
  stillOwed: [
    "Run only on a disposable Figma file. Removing a mode discards every variable's value for that mode and there is no undo through this fork.",
  ],
  success: false,
};

let connected = false;
let probeModeId = null;
let failure = null;

/** Only ever removes the probe mode this run created, and only if the leg left it behind. */
async function cleanupProbeMode() {
  if (!connected || !probeModeId) return;
  const modeId = probeModeId;
  const cleanupRecord = { modeId, name: probeModeName };
  try {
    cleanupRecord.receipt = (await callJson("remove_variable_mode", {
      collectionId: options["collection-id"],
      modeId,
      confirm: true,
    })).value;
    const after = await readCollection(options["collection-id"]);
    cleanupRecord.absentAfterFreshRead = findMode(after, (mode) => mode.id === modeId) === null;
    assert.equal(
      cleanupRecord.absentAfterFreshRead,
      true,
      `cleanup probe mode ${modeId} still resolves after a fresh read`,
    );
    probeModeId = null;
  } catch (error) {
    cleanupRecord.error = error && typeof error.message === "string" ? error.message : String(error);
    throw error;
  } finally {
    record.cleanup.push(cleanupRecord);
  }
}

try {
  await client.connect(transport);
  connected = true;

  // ── 1. The published surface ────────────────────────────────────────────────
  const inventory = await client.listTools();
  const removeTool = inventory.tools.find((tool) => tool.name === "remove_variable_mode");
  assert.equal(inventory.tools.length, expectedRuntime.toolCount);
  assert.ok(removeTool, "remove_variable_mode is not in the published tool surface");
  assert.match(String(removeTool.description), /default mode/i);
  assert.match(String(removeTool.description), /sole remaining mode/i);
  assert.match(String(removeTool.description), /removal_unconfirmed/);
  record.checks.inventory = {
    toolCount: inventory.tools.length,
    description: String(removeTool.description),
  };

  await joinWithRetry();
  const runtime = (await callJson("get_runtime_info")).value;
  assertRuntime(runtime);
  record.checks.runtime = {
    serverBuildId: runtime.server.buildId,
    pluginBuildId: runtime.plugin?.buildId ?? null,
    compatibility: runtime.compatibility.status,
  };

  // ── 2. Baseline ─────────────────────────────────────────────────────────────
  const baseline = await readCollection(options["collection-id"]);
  assert.ok(baseline, `collection ${options["collection-id"]} was not found in a fresh read`);
  record.checks.baseline = {
    id: baseline.id,
    name: baseline.name,
    defaultModeId: baseline.defaultModeId,
    modeCount: baseline.modes.length,
    modeNames: modeNames(baseline),
    variableCount: baseline.variableCount,
  };

  // ── 3. THE PROBE LEG — prove the tool on a resource this gate owns ──────────
  const added = (await callJson("add_variable_mode", {
    collectionId: options["collection-id"],
    name: probeModeName,
  })).value;
  assert.equal(
    added.success,
    true,
    `could not create the probe mode — ${added.refusal || "no refusal text"}. A collection already at the mode ceiling cannot host this gate.`,
  );
  probeModeId = added.mode.id;
  record.checks.probeCreated = added;

  const afterAdd = await readCollection(options["collection-id"]);
  assert.ok(
    findMode(afterAdd, (mode) => mode.id === probeModeId),
    "the probe mode is absent from a fresh read immediately after being created",
  );

  const removal = (await callJson("remove_variable_mode", {
    collectionId: options["collection-id"],
    modeId: probeModeId,
    confirm: true,
  })).value;
  record.checks.probeRemoval = removal;
  assert.equal(removal.mode?.id, probeModeId);
  assert.equal(removal.confirm, true);
  assert.equal(removal.modeCountBefore, afterAdd.modes.length);
  // ⛔ NOT asserted equal to `baseline.variableCount`, and that is deliberate. They are two
  // DIFFERENT measurements: `blastRadius` counts the collection's `variableIds` membership,
  // while `get_variables` counts what `getLocalVariablesAsync(type)` returned for the
  // requested types. A remote member, or a type the read skipped, makes them diverge
  // legitimately — so an equality check here would fail the gate for the wrong reason and
  // burn a live channel. Both are RECORDED; only the shape is asserted.
  assert.equal(typeof removal.blastRadius?.variableCount, "number");
  assert.ok(removal.blastRadius.variableCount >= 0);

  // ⛔ A `removal_unconfirmed` receipt is NOT a gate failure — it is the tool being honest
  // that no in-frame signal could see the removal, which is exactly what `delete_variable`
  // got wrong before its live run. What the gate insists on is that the CROSS-FRAME read
  // agrees with whatever the receipt claimed.
  const afterRemove = await readCollection(options["collection-id"]);
  const probeAbsent = findMode(afterRemove, (mode) => mode.id === probeModeId) === null;
  assert.equal(probeAbsent, true, "the probe mode still resolves after a fresh read");
  probeModeId = null;

  if (removal.success) {
    assert.equal(removal.outcome, "removed");
    assert.equal(removal.removalObserved, true);
    assert.ok(
      ["resolved_collection_modes", "fresh_collection_modes"].includes(
        removal.observation?.observedBy,
      ),
      `a successful removal must name the signal that observed it; got ${JSON.stringify(removal.observation?.observedBy)}`,
    );
  } else {
    assert.equal(removal.outcome, "removal_unconfirmed");
    assert.equal(removal.verificationDeferred, true);
    assert.equal(removal.observation?.observedBy, null);
  }

  // ⭐ Removing a NON-default mode must not move the default. Measured, then asserted.
  assert.equal(
    afterRemove.defaultModeId,
    baseline.defaultModeId,
    "removing a non-default mode moved the collection's defaultModeId",
  );
  record.checks.probeCrossFrame = {
    absentAfterFreshRead: probeAbsent,
    inFrameObservation: removal.observation ?? null,
    receiptClaimedRemoval: Boolean(removal.success),
    modeCountAfter: afterRemove.modes.length,
    blastRadiusVariableCount: removal.blastRadius?.variableCount ?? null,
    getVariablesBooleanOnlyCount: baseline.variableCount,
    defaultModeIdAfter: afterRemove.defaultModeId,
  };

  // ── 4. THE REFUSAL LEGS — the guard rails, fired against real Figma ─────────
  // ⛔ In a gate a refusal is the EXPECTED outcome. Each of these asserts the refusal AND
  // that the document did not move, because "refused" and "refused after writing" are
  // different receipts with the same first word.
  const defaultRefusal = (await callJson("remove_variable_mode", {
    collectionId: options["collection-id"],
    modeId: baseline.defaultModeId,
    confirm: true,
  })).value;
  assert.equal(defaultRefusal.success, false);
  assert.equal(defaultRefusal.refusal?.code, "default_mode");

  const foreignRefusal = (await callJson("remove_variable_mode", {
    collectionId: options["collection-id"],
    modeId: "31001:999999",
    confirm: true,
  })).value;
  assert.equal(foreignRefusal.success, false);
  assert.equal(foreignRefusal.refusal?.code, "mode_not_in_collection");

  // ⛔ `confirm` is z.literal(true), so omitting it is refused by the SCHEMA — which
  // means it throws or returns isError rather than producing a typed receipt. Accepting
  // only one of those shapes would score correct behaviour as a failure.
  let confirmRefusalShape = null;
  try {
    const raw = await callRaw("remove_variable_mode", {
      collectionId: options["collection-id"],
      modeId: baseline.defaultModeId,
    });
    confirmRefusalShape = raw.isError ? "isError" : "accepted";
    assert.notEqual(
      confirmRefusalShape,
      "accepted",
      "a call without confirm reached the plugin and was not refused",
    );
  } catch (error) {
    confirmRefusalShape = "threw";
  }

  const afterRefusals = await readCollection(options["collection-id"]);
  assert.equal(
    afterRefusals.modes.length,
    afterRemove.modes.length,
    "a refusal leg changed the collection's mode count",
  );
  assert.equal(afterRefusals.defaultModeId, baseline.defaultModeId);
  record.checks.refusals = {
    defaultMode: defaultRefusal,
    foreignMode: foreignRefusal,
    missingConfirm: confirmRefusalShape,
    modeCountUnchanged: afterRefusals.modes.length,
  };

  // ── 5. THE AUTHORIZED RESIDUE CLEANUP ───────────────────────────────────────
  if (options["residue-collection-id"]) {
    const residueBefore = await readCollection(options["residue-collection-id"]);
    assert.ok(
      residueBefore,
      `residue collection ${options["residue-collection-id"]} was not found in a fresh read`,
    );
    const targets = (residueBefore.modes || []).filter((mode) =>
      AUTHORIZED_RESIDUE_NAMES.includes(mode.name),
    );
    const removals = [];

    // ⭐ Zero targets is a PASS, not a failure — it is what a second run of this gate sees
    // after the first one cleaned up, and the gate has to stay rerunnable.
    for (const target of targets) {
      assert.notEqual(
        target.id,
        residueBefore.defaultModeId,
        `residue ${target.name} is the collection default — the tool will refuse it, and it should`,
      );
      const receipt = (await callJson("remove_variable_mode", {
        collectionId: residueBefore.id,
        modeId: target.id,
        confirm: true,
      })).value;
      const after = await readCollection(residueBefore.id);
      const absent = findMode(after, (mode) => mode.id === target.id) === null;
      removals.push({
        name: target.name,
        modeId: target.id,
        receipt,
        absentAfterFreshRead: absent,
        modeCountAfter: after.modes.length,
      });
      assert.equal(absent, true, `residue ${target.name} still resolves after a fresh read`);
    }

    const residueAfter = await readCollection(options["residue-collection-id"]);
    const leftover = (residueAfter.modes || []).filter((mode) =>
      AUTHORIZED_RESIDUE_NAMES.includes(mode.name),
    );
    assert.deepEqual(
      leftover.map((mode) => mode.name),
      [],
      "authorized residues survived the cleanup",
    );
    assert.equal(
      residueAfter.defaultModeId,
      residueBefore.defaultModeId,
      "residue cleanup moved the collection's defaultModeId",
    );
    record.checks.residues = {
      collectionId: residueBefore.id,
      collectionName: residueBefore.name,
      alreadyClean: targets.length === 0,
      modeCountBefore: residueBefore.modes.length,
      modeCountAfter: residueAfter.modes.length,
      modeNamesAfter: modeNames(residueAfter),
      authorizedNames: AUTHORIZED_RESIDUE_NAMES,
      removals,
    };
  } else {
    record.checks.residues = { skipped: true };
    record.stillOwed.push(
      "The Phase 1.3 mode residues were NOT cleaned: --residue-collection-id was not supplied. That collection stays at the mode ceiling, so a real add_variable_mode there returns a true ceiling refusal from a false ceiling cause.",
    );
  }

  record.success = true;
} catch (error) {
  failure = error;
  record.failure = error && typeof error.message === "string" ? error.message : String(error);
} finally {
  try {
    await cleanupProbeMode();
    if (record.success && !options["residue-collection-id"]) {
      record.stillOwed = record.stillOwed.slice(1);
    } else if (record.success) {
      record.stillOwed = [];
    }
  } catch (cleanupError) {
    if (!failure) {
      failure = cleanupError;
      record.success = false;
      record.failure = cleanupError && typeof cleanupError.message === "string"
        ? cleanupError.message
        : String(cleanupError);
    }
  }
  record.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(record, null, 2)}\n`);
  await client.close().catch(() => undefined);
}

if (failure) {
  process.stderr.write(`R3-A Phase 4 mode-removal gate FAILED: ${record.failure}\n`);
  process.stderr.write(`Report: ${reportPath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`R3-A Phase 4 mode-removal gate PASSED: ${reportPath}\n`);
}
