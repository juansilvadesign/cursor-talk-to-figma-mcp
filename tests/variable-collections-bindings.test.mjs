import assert from "node:assert/strict";
import test from "node:test";

import { buildContract } from "../scripts/contract-lib.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

// ---------------------------------------------------------------------------
// R3-A Phase 2 — the rest of the plan table: collections, mode rename, metadata
// and the two bindings. Each tool's receipt has to survive the same question the
// earlier slice was taught to ask: can the platform, from inside this frame,
// actually SEE that the write landed — and if not, does the receipt say so?
// ---------------------------------------------------------------------------

async function collection(harness, id) {
  return await harness
    .globals("figma")
    .variables.getVariableCollectionByIdAsync(id);
}

// ===========================================================================
// create_variable_collection
// ===========================================================================

test("R3-A Phase 2 — create_variable_collection creates once and publishes the mode Figma made for it", async () => {
  const harness = await loadPluginHarness();

  const receipt = await harness.command("create_variable_collection", {
    name: "Brand",
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "created");
  assert.equal(receipt.created, true);
  assert.equal(receipt.matchedBy, null);
  assert.equal(receipt.identityKeyStatus, "not_requested");
  assert.equal(receipt.collection.name, "Brand");
  assert.equal(receipt.collection.remote, false);
  assert.equal(receipt.collection.modeCount, 1);

  // ⭐ The whole reason this field exists. Figma hands back a collection that ALREADY has
  // one mode, the caller never named it, and every subsequent set_variable_value needs its
  // ID. A receipt without it would force a second read on the very next call.
  assert.ok(receipt.defaultMode, "the collection's own default mode must be published");
  assert.equal(receipt.defaultMode.id, receipt.collection.defaultModeId);
  assert.equal(typeof receipt.defaultMode.name, "string");

  const created = await collection(harness, receipt.collection.id);
  assert.ok(created, "the returned ID must resolve to the collection Figma created");
  assert.equal(created.name, "Brand");
});

test("R3-A Phase 2 — collection identity resolves by name, opaque key and explicit ID without ever creating a second collection", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const opaqueIdentity = "  caller://collections/7 — do not normalize  ";

  const before = (await figma.variables.getLocalVariableCollectionsAsync()).length;

  const first = await harness.command("create_variable_collection", {
    name: "Tokens",
    identityKey: opaqueIdentity,
  });
  assert.equal(first.outcome, "created");
  assert.equal(first.identityKeyStatus, "stored");

  // Layer 2 — exact name.
  const byName = await harness.command("create_variable_collection", {
    name: "Tokens",
  });
  assert.equal(byName.success, true);
  assert.equal(byName.outcome, "matched");
  assert.equal(byName.created, false);
  assert.equal(byName.matchedBy, "name");
  assert.equal(byName.collection.id, first.collection.id);

  // Layer 3 — the opaque key, reached only when the name does NOT match.
  const byKey = await harness.command("create_variable_collection", {
    name: "Tokens Renamed Elsewhere",
    identityKey: opaqueIdentity,
  });
  assert.equal(byKey.outcome, "matched");
  assert.equal(byKey.matchedBy, "identityKey");
  assert.equal(byKey.collection.id, first.collection.id);
  assert.equal(byKey.identityKeyStatus, "already_stored");

  // Layer 1 — an explicit ID short-circuits both.
  const byId = await harness.command("create_variable_collection", {
    name: "Irrelevant",
    id: first.collection.id,
  });
  assert.equal(byId.outcome, "matched");
  assert.equal(byId.matchedBy, "id");
  assert.equal(byId.collection.id, first.collection.id);

  const after = await figma.variables.getLocalVariableCollectionsAsync();
  assert.equal(
    after.length,
    before + 1,
    "four idempotent calls must leave exactly one new collection",
  );
});

test("R3-A Phase 2 — the opaque identityKey is stored byte-for-byte and never normalized", async () => {
  const harness = await loadPluginHarness();
  const opaqueIdentity = "  caller://collections/7 — do not normalize  ";

  const created = await harness.command("create_variable_collection", {
    name: "Opaque",
    identityKey: opaqueIdentity,
  });
  const stored = await collection(harness, created.collection.id);
  assert.equal(
    stored.getPluginData("talk-to-figma.resource-identity.v1"),
    opaqueIdentity,
  );
  // ⛔ And it is never echoed back — the receipt carries the STATUS, not the caller's key.
  assert.ok(!JSON.stringify(created).includes("do not normalize"));
});

test("R3-A Phase 2 — a wrong explicit collection ID refuses instead of falling through to create", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const before = (await figma.variables.getLocalVariableCollectionsAsync()).length;

  const receipt = await harness.command("create_variable_collection", {
    name: "Should Not Exist",
    id: "VariableCollectionId:404:404",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "refused");
  assert.equal(receipt.created, false);
  assert.equal(receipt.matchedBy, null);
  assert.equal(receipt.refusal.code, "collection_not_found");

  const after = (await figma.variables.getLocalVariableCollectionsAsync()).length;
  assert.equal(after, before, "a refused create must leave the inventory untouched");
});

test("R3-A Phase 2 — a different existing identityKey is never overwritten", async () => {
  const harness = await loadPluginHarness();

  const first = await harness.command("create_variable_collection", {
    name: "Owned",
    identityKey: "owner-a",
  });
  const receipt = await harness.command("create_variable_collection", {
    name: "Owned",
    identityKey: "owner-b",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.refusal.code, "identity_key_conflict");
  assert.equal(receipt.created, false);
  assert.equal(receipt.matchedBy, "name");

  const stored = await collection(harness, first.collection.id);
  assert.equal(
    stored.getPluginData("talk-to-figma.resource-identity.v1"),
    "owner-a",
    "the first caller's opaque key must survive the second caller's attempt",
  );
});

test("R3-A Phase 2 — an identity failure AFTER the collection exists reports created:true, not a refusal", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");

  // The collection is created, then storing the key fails. Reporting "wrote nothing" here
  // would invite a retry that creates a SECOND collection.
  const original = figma.variables.createVariableCollection;
  figma.variables.createVariableCollection = (name) => {
    const created = original(name);
    created.setPluginData = () => {
      throw new Error("plugin data is unavailable");
    };
    return created;
  };

  const receipt = await harness.command("create_variable_collection", {
    name: "Half Written",
    identityKey: "k",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "identity_unconfirmed");
  assert.equal(receipt.created, true, "the collection EXISTS and the receipt must say so");
  assert.equal(receipt.partialApplicationPossible, true);
  assert.equal(receipt.refusal.code, "identity_key_write_failed");
  assert.ok(receipt.collection.id, "the caller needs the ID of what was created");
});

// ===========================================================================
// rename_variable_mode
// ===========================================================================

test("R3-A Phase 2 — rename_variable_mode reports the signal that observed the new name", async () => {
  const harness = await loadPluginHarness({ modeRenameSignal: "collection_modes" });

  const receipt = await harness.command("rename_variable_mode", {
    collectionId: "collection-1",
    modeId: "mode-dark",
    name: "Midnight",
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "renamed");
  assert.equal(receipt.mode.id, "mode-dark");
  assert.equal(receipt.mode.nameBefore, "Dark");
  assert.equal(receipt.mode.nameAfter, "Midnight");
  assert.equal(receipt.verificationDeferred, false);
  assert.equal(receipt.observation.observedBy, "resolved_collection_modes");

  const after = await collection(harness, "collection-1");
  assert.equal(
    after.modes.find((mode) => mode.modeId === "mode-dark").name,
    "Midnight",
  );
  // Nothing a variable resolves through may move.
  assert.equal(after.defaultModeId, "mode-light");
  assert.equal(after.modes.length, 2);
});

test("R3-A Phase 2 — the SECOND rename signal is load-bearing and is named separately", async () => {
  const harness = await loadPluginHarness({ modeRenameSignal: "fresh_lookup" });

  const receipt = await harness.command("rename_variable_mode", {
    collectionId: "collection-1",
    modeId: "mode-dark",
    name: "Midnight",
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.observation.observedBy, "fresh_collection_modes");
  // ⭐ The resolved object still reads the OLD name — which is the whole reason the handler
  // asks a second, independent question instead of trusting the first.
  assert.equal(receipt.observation.resolvedCollectionName, "Dark");
  assert.equal(receipt.observation.freshCollectionName, "Midnight");
});

test("R3-A Phase 2 — a rename no in-frame signal can see is rename_unconfirmed, never success", async () => {
  const harness = await loadPluginHarness();

  const receipt = await harness.command("rename_variable_mode", {
    collectionId: "collection-1",
    modeId: "mode-dark",
    name: "Midnight",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "rename_unconfirmed");
  assert.equal(receipt.verificationDeferred, true);
  assert.equal(receipt.observation.observedBy, null);
  assert.equal(receipt.mode.nameAfter, null, "an unobserved name must not be reported as applied");
  assert.equal(receipt.refusal.code, "mode_rename_not_observed_in_frame");

  // ⭐ The harness commits at the end of every command, so this read is already in a LATER
  // frame — and the rename really did land. That is what makes a cross-frame re-read a real
  // instrument rather than a second look at the same in-frame fiction.
  const after = await collection(harness, "collection-1");
  assert.equal(
    after.modes.find((mode) => mode.modeId === "mode-dark").name,
    "Midnight",
  );
});

test("R3-A Phase 2 — renaming a mode to the name it already has is REFUSED, not reported as applied", async () => {
  const harness = await loadPluginHarness({ modeRenameSignal: "collection_modes" });

  const receipt = await harness.command("rename_variable_mode", {
    collectionId: "collection-1",
    modeId: "mode-dark",
    name: "Dark",
  });

  // ⛔ THE POINT: a no-op rename and a rename that silently failed produce identical bytes,
  // so a receipt that called this `renamed` would be unfalsifiable.
  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "refused");
  assert.equal(receipt.refusal.code, "mode_name_unchanged");
  assert.equal(receipt.mode.nameBefore, "Dark");
  assert.equal(receipt.mode.nameAfter, "Dark");
});

// 🔴 THIS TEST USED TO ASSERT A REFUSAL THAT DOES NOT EXIST. It required
// `figma_refusal` + /Mode name Light is already used/ — a message the HARNESS invented,
// guarding a Figma rule nobody had measured. The live run on `9ir4iabr` renamed a probe
// mode to an existing mode's name and Figma ACCEPTED it (`duplicateNameOutcome: "renamed"`).
// A fixture asserted a platform floor into existence and a test then protected the fiction.
// The tool now publishes the collision as a reading instead of inventing a refusal.
test("R3-A Phase 2 — a duplicate mode name is ACCEPTED and reported as a collision reading", async () => {
  const harness = await loadPluginHarness({ modeRenameSignal: "collection_modes" });

  const receipt = await harness.command("rename_variable_mode", {
    collectionId: "collection-1",
    modeId: "mode-dark",
    name: "Light",
  });

  assert.equal(receipt.success, true, "Figma accepts this; the fork must not refuse it");
  assert.equal(receipt.outcome, "renamed");
  // ⭐ A reading, not a refusal: the caller is told which mode already carries the name and
  // decides for themselves, exactly as `defaultModeIdStable` reports without adjudicating.
  assert.deepEqual(receipt.nameCollidesWithModeIds, ["mode-light"]);

  const after = await collection(harness, "collection-1");
  assert.equal(after.modes.find((mode) => mode.modeId === "mode-dark").name, "Light");
});

test("R3-A Phase 2 — a rename with no collision reports an EMPTY collision list", async () => {
  // ⛔ The negative leg, or the assertion above passes for a field that is always populated.
  const harness = await loadPluginHarness({ modeRenameSignal: "collection_modes" });
  const receipt = await harness.command("rename_variable_mode", {
    collectionId: "collection-1",
    modeId: "mode-dark",
    name: "Midnight",
  });
  assert.equal(receipt.success, true);
  assert.deepEqual(receipt.nameCollidesWithModeIds, []);
});

test("R3-A Phase 2 — a mode that does not belong to the named collection is refused", async () => {
  const harness = await loadPluginHarness({ modeRenameSignal: "collection_modes" });

  const receipt = await harness.command("rename_variable_mode", {
    collectionId: "collection-1",
    modeId: "mode-does-not-exist",
    name: "Anything",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.refusal.code, "mode_not_in_collection");
});

// ===========================================================================
// set_variable_metadata
// ===========================================================================

test("R3-A Phase 2 — set_variable_metadata writes every supplied field and reads each one back", async () => {
  const harness = await loadPluginHarness();

  const receipt = await harness.command("set_variable_metadata", {
    variableId: "var-primary",
    name: "Color/Brand",
    description: "",
    scopes: ["FRAME_FILL", "TEXT_FILL"],
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "updated");
  assert.deepEqual(receipt.appliedFields, ["name", "description", "scopes"]);
  assert.equal(receipt.fields.name.before, "Color/Primary");
  assert.equal(receipt.fields.name.after, "Color/Brand");
  assert.equal(receipt.fields.name.observed, true);
  // ⚠️ An EMPTY description is a real value here, unlike set_plugin_data where Figma
  // DEFINES "" as removal. Clearing one must be expressible.
  assert.equal(receipt.fields.description.before, "Primary brand color");
  assert.equal(receipt.fields.description.after, "");
  assert.deepEqual(receipt.fields.scopes.before, ["ALL_FILLS"]);
  // ⭐ THE LIVE FINDING, MODELLED. Figma reorders `scopes` into its own canonical order, so
  // `after` is NOT the requested sequence — and the receipt publishes what Figma really
  // stored rather than echoing the request back.
  assert.deepEqual(receipt.fields.scopes.after, ["TEXT_FILL", "FRAME_FILL"]);
  assert.equal(
    receipt.fields.scopes.observed,
    true,
    "a reordered read-back holds the same MEMBERS and must count as observed",
  );
  assert.equal(receipt.verificationDeferred, false);
});

test("R3-A Phase 2 — the scopes read-back still FAILS when the membership really differs", async () => {
  // ⛔ THE KNOWN-BAD LEG. Making the comparison order-insensitive is only a fix if a
  // genuinely wrong read-back still goes red — otherwise it is indistinguishable from
  // loosening the check until it passes.
  const harness = await loadPluginHarness();
  const variable = await harness
    .globals("figma")
    .variables.getVariableByIdAsync("var-primary");
  Object.defineProperty(variable, "scopes", {
    configurable: true,
    get: () => ["OPACITY"],
    set: () => {},
  });

  const receipt = await harness.command("set_variable_metadata", {
    variableId: "var-primary",
    scopes: ["FRAME_FILL", "TEXT_FILL"],
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "metadata_unconfirmed");
  assert.deepEqual(receipt.unobservedFields, ["scopes"]);
});

test("R3-A Phase 2 — a same-length read-back with one member swapped is NOT observed", async () => {
  // The nastiest near-miss: identical length, so only membership separates them.
  const harness = await loadPluginHarness();
  const variable = await harness
    .globals("figma")
    .variables.getVariableByIdAsync("var-primary");
  Object.defineProperty(variable, "scopes", {
    configurable: true,
    get: () => ["TEXT_FILL", "OPACITY"],
    set: () => {},
  });

  const receipt = await harness.command("set_variable_metadata", {
    variableId: "var-primary",
    scopes: ["FRAME_FILL", "TEXT_FILL"],
  });

  assert.equal(receipt.fields.scopes.observed, false);
  assert.equal(receipt.outcome, "metadata_unconfirmed");
});

test("R3-A Phase 2 — one field may be changed without disturbing the other two", async () => {
  const harness = await loadPluginHarness();

  const receipt = await harness.command("set_variable_metadata", {
    variableId: "var-primary",
    scopes: ["OPACITY"],
  });

  assert.equal(receipt.success, true);
  assert.deepEqual(receipt.appliedFields, ["scopes"]);
  assert.ok(!("name" in receipt.fields), "an unsupplied field must not appear as written");
  assert.ok(!("description" in receipt.fields));

  const variable = await harness
    .globals("figma")
    .variables.getVariableByIdAsync("var-primary");
  assert.equal(variable.name, "Color/Primary");
  assert.equal(variable.description, "Primary brand color");
});

test("R3-A Phase 2 — a mid-write refusal reports partially_applied with the exact fields that landed", async () => {
  const harness = await loadPluginHarness();
  const variable = await harness
    .globals("figma")
    .variables.getVariableByIdAsync("var-primary");

  // ⛔ THE `apply_batch` LESSON AT TOOL SCALE. Figma gives no transaction across these three
  // fields, and three of apply_batch's own mutations are PROVEN to write their first field
  // and then throw. `scopes` refuses here AFTER `name` has already been committed.
  Object.defineProperty(variable, "scopes", {
    configurable: true,
    get: () => ["ALL_FILLS"],
    set: () => {
      throw new Error("scopes are not writable on this variable");
    },
  });

  const receipt = await harness.command("set_variable_metadata", {
    variableId: "var-primary",
    name: "Color/Brand",
    scopes: ["OPACITY"],
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "partially_applied");
  assert.equal(receipt.failedField, "scopes");
  assert.deepEqual(receipt.appliedFields, ["name"]);
  assert.equal(receipt.fields.name.applied, true);
  assert.equal(receipt.fields.scopes.applied, false);
  // ⛔ The half that makes this receipt honest: the caller cannot detect the committed
  // `name` from a plain refusal, and "wrote nothing" would be a lie.
  assert.equal(receipt.partialApplicationPossible, true);
  assert.equal(variable.name, "Color/Brand");
});

test("R3-A Phase 2 — a first-field refusal is a plain refusal with partialApplicationPossible false", async () => {
  const harness = await loadPluginHarness();
  const variable = await harness
    .globals("figma")
    .variables.getVariableByIdAsync("var-primary");
  Object.defineProperty(variable, "name", {
    configurable: true,
    get: () => "Color/Primary",
    set: () => {
      throw new Error("name is not writable on this variable");
    },
  });

  const receipt = await harness.command("set_variable_metadata", {
    variableId: "var-primary",
    name: "Color/Brand",
    description: "changed",
  });

  assert.equal(receipt.outcome, "refused");
  assert.deepEqual(receipt.appliedFields, []);
  assert.equal(receipt.partialApplicationPossible, false);
  assert.equal(
    variable.description,
    "Primary brand color",
    "validate-all-then-write means the later field is never reached",
  );
});

test("R3-A Phase 2 — a field the platform accepts but does not reflect is metadata_unconfirmed, not success", async () => {
  const harness = await loadPluginHarness();
  const variable = await harness
    .globals("figma")
    .variables.getVariableByIdAsync("var-primary");
  Object.defineProperty(variable, "name", {
    configurable: true,
    get: () => "Color/Primary",
    set: () => {},
  });

  const receipt = await harness.command("set_variable_metadata", {
    variableId: "var-primary",
    name: "Color/Brand",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "metadata_unconfirmed");
  assert.deepEqual(receipt.unobservedFields, ["name"]);
  assert.equal(receipt.fields.name.observed, false);
  assert.equal(receipt.verificationDeferred, true);
});

test("R3-A Phase 2 — every supplied value is validated BEFORE the first assignment", async () => {
  const harness = await loadPluginHarness();

  // A good `name` and a bad `scopes`, with the bad one LAST. If validation happened
  // field-by-field the name would already be committed when scopes refused.
  await assert.rejects(
    harness.command("set_variable_metadata", {
      variableId: "var-primary",
      name: "Color/Brand",
      scopes: ["NOT_A_REAL_SCOPE"],
    }),
    /unsupported scope/i,
  );

  const variable = await harness
    .globals("figma")
    .variables.getVariableByIdAsync("var-primary");
  assert.equal(
    variable.name,
    "Color/Primary",
    "a refusal on the LAST field must leave the FIRST one unwritten",
  );
});

test("R3-A Phase 2 — set_variable_metadata refuses a remote variable and a request with nothing to do", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const originalLookup = figma.variables.getVariableByIdAsync;
  let remoteWrites = 0;
  const remoteVariable = {
    id: "remote-variable",
    name: "Library/Primary",
    key: "remote-key",
    variableCollectionId: "remote-collection",
    resolvedType: "COLOR",
    remote: true,
    description: "",
    scopes: [],
    valuesByMode: {},
  };
  // Any assignment to a remote variable must be unreachable, so the guard is watched
  // rather than assumed: a refusal that fired AFTER a write would still read as a refusal.
  for (const field of ["name", "description", "scopes"]) {
    Object.defineProperty(remoteVariable, field, {
      enumerable: true,
      get: () => (field === "scopes" ? [] : ""),
      set: () => {
        remoteWrites += 1;
      },
    });
  }
  figma.variables.getVariableByIdAsync = async (id) =>
    id === remoteVariable.id ? remoteVariable : await originalLookup(id);

  const remote = await harness.command("set_variable_metadata", {
    variableId: remoteVariable.id,
    name: "Nope",
  });
  assert.equal(remote.success, false);
  assert.equal(remote.refusal.code, "remote_variable");
  assert.equal(remoteWrites, 0, "the refusal must fire BEFORE any assignment");

  await assert.rejects(
    harness.command("set_variable_metadata", { variableId: "var-primary" }),
    /at least one of name, description or scopes/i,
  );
});

// ===========================================================================
// bind_variable_to_node
// ===========================================================================

test("R3-A Phase 2 — bind_variable_to_node binds a plain field and names the signal that saw it", async () => {
  const harness = await loadPluginHarness();

  const receipt = await harness.command("bind_variable_to_node", {
    nodeId: "10:1",
    field: "itemSpacing",
    variableId: "var-space",
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "bound");
  assert.equal(receipt.field, "itemSpacing");
  assert.equal(receipt.variable.id, "var-space");
  assert.equal(receipt.node.id, "10:1");
  assert.equal(receipt.verificationDeferred, false);
  assert.equal(receipt.observation.observedBy, "node_bound_variables");
  assert.deepEqual(receipt.observation.boundBefore, []);
  assert.deepEqual(receipt.observation.boundAfter, ["var-space"]);

  const node = harness.getNode("10:1");
  assert.equal(node.boundVariables.itemSpacing.id, "var-space");
  assert.equal(node.boundVariables.itemSpacing.type, "VARIABLE_ALIAS");
});

test("R3-A Phase 2 — Figma's own type refusal is preserved rather than pre-empted by a local table", async () => {
  const harness = await loadPluginHarness({
    unbindableFields: ["10:1::characters"],
  });

  const receipt = await harness.command("bind_variable_to_node", {
    nodeId: "10:1",
    field: "characters",
    variableId: "var-space",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.refusal.code, "figma_refusal");
  // ⛔ The fork keeps NO table of which field accepts which resolvedType — Figma owns that
  // rule and grows it, so its message is passed through instead of a stale local guess.
  assert.match(receipt.refusal.message, /cannot be bound to a variable/);
  assert.deepEqual(receipt.boundBefore, []);
});

test("R3-A Phase 2 — a field Figma accepts but does not reflect is bind_unconfirmed, never bound", async () => {
  const harness = await loadPluginHarness({
    silentBindFields: ["10:1::notAField"],
  });

  const receipt = await harness.command("bind_variable_to_node", {
    nodeId: "10:1",
    field: "notAField",
    variableId: "var-space",
  });

  // ⚠️ This is the dangerous arm: Figma does not always throw for an unknown field, so a
  // silent no-op and a frame-deferred commit are the same bytes from inside the frame.
  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "bind_unconfirmed");
  assert.equal(receipt.verificationDeferred, true);
  assert.equal(receipt.observation.observedBy, null);
  assert.equal(receipt.refusal.code, "binding_not_observed_in_frame");
});

test("R3-A Phase 2 — bind_variable_to_node refuses a missing node, a missing variable and a node with no binding API", async () => {
  const harness = await loadPluginHarness({ bindingApiMissing: ["10:1"] });

  const noVariable = await harness.command("bind_variable_to_node", {
    nodeId: "10:1",
    field: "width",
    variableId: "VariableID:404:404",
  });
  assert.equal(noVariable.refusal.code, "variable_not_found");

  const noNode = await harness.command("bind_variable_to_node", {
    nodeId: "does-not-exist",
    field: "width",
    variableId: "var-space",
  });
  assert.equal(noNode.refusal.code, "node_not_found");
  // The variable resolved, so the receipt names it even though nothing was written.
  assert.equal(noNode.variable.id, "var-space");

  const noApi = await harness.command("bind_variable_to_node", {
    nodeId: "10:1",
    field: "width",
    variableId: "var-space",
  });
  assert.equal(noApi.refusal.code, "binding_unsupported");
});

// ===========================================================================
// bind_variable_to_paint — the trap row
// ===========================================================================

test("R3-A Phase 2 — bind_variable_to_paint writes the returned paint BACK and confirms it on the node", async () => {
  const harness = await loadPluginHarness();
  const before = harness.getNode("10:4").fills;
  assert.ok(Array.isArray(before) && before.length > 0, "the fixture needs a paint to bind");

  const receipt = await harness.command("bind_variable_to_paint", {
    nodeId: "10:4",
    paintTarget: "fills",
    paintIndex: 0,
    variableId: "var-primary",
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "bound");
  assert.equal(receipt.observation.writeBackPerformed, true);
  assert.equal(receipt.observation.observedBy, "paint_bound_variables");
  assert.equal(receipt.observation.paintBoundAfter, "var-primary");

  // ⭐ THE ASSERTION THE WHOLE ROW EXISTS FOR. setBoundVariableForPaint returns a NEW paint
  // and mutates nothing; a handler that forgot the write-back would throw nothing, report
  // nothing wrong, and leave this read exactly as it was.
  const after = harness.getNode("10:4").fills;
  assert.equal(after[0].boundVariables.color.id, "var-primary");
  assert.equal(after[0].boundVariables.color.type, "VARIABLE_ALIAS");
  assert.equal(after.length, before.length, "binding must not add or drop a paint");
  assert.equal(after[0].type, before[0].type, "the paint's other properties survive");
});

test("R3-A Phase 2 — the write-back is proved load-bearing: without it nothing on the node changes", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const node = harness.getNode("10:4");
  const before = JSON.stringify(node.fills);

  // Reproduce the defect this tool is built to avoid — call the API and discard its result.
  const variable = await figma.variables.getVariableByIdAsync("var-primary");
  const returned = figma.variables.setBoundVariableForPaint(
    node.fills[0],
    "color",
    variable,
  );

  assert.ok(returned.boundVariables.color, "the API returns a bound paint");
  assert.equal(
    JSON.stringify(node.fills),
    before,
    "…and changes the node in no way at all until the paint is written back",
  );
});

test("R3-A Phase 2 — a non-COLOR variable is refused before any Figma call", async () => {
  const harness = await loadPluginHarness();

  const receipt = await harness.command("bind_variable_to_paint", {
    nodeId: "10:4",
    paintTarget: "fills",
    paintIndex: 0,
    variableId: "var-space",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.refusal.code, "paint_requires_color_variable");
  // This one IS knowable locally — from the variable's own resolvedType — so it is a typed
  // refusal rather than a preserved platform error.
  assert.match(receipt.refusal.message, /resolves to FLOAT/);
});

test("R3-A Phase 2 — a mixed paint list and an out-of-range index are refused with the real count", async () => {
  const harness = await loadPluginHarness({ mixedFills: ["10:4"] });

  const mixed = await harness.command("bind_variable_to_paint", {
    nodeId: "10:4",
    paintTarget: "fills",
    paintIndex: 0,
    variableId: "var-primary",
  });
  assert.equal(mixed.refusal.code, "paints_mixed");

  const plain = await loadPluginHarness();
  const outOfRange = await plain.command("bind_variable_to_paint", {
    nodeId: "10:4",
    paintTarget: "fills",
    paintIndex: 9,
    variableId: "var-primary",
  });
  assert.equal(outOfRange.refusal.code, "paint_index_out_of_range");
  assert.equal(outOfRange.paintCount, plain.getNode("10:4").fills.length);
});

test("R3-A Phase 2 — a Figma refusal leaves writeBackPerformed false and the paints untouched", async () => {
  const harness = await loadPluginHarness({ paintBindingThrows: true });
  const before = JSON.stringify(harness.getNode("10:4").fills);

  const receipt = await harness.command("bind_variable_to_paint", {
    nodeId: "10:4",
    paintTarget: "fills",
    paintIndex: 0,
    variableId: "var-primary",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.refusal.code, "figma_refusal");
  assert.equal(receipt.writeBackPerformed, false);
  assert.equal(JSON.stringify(harness.getNode("10:4").fills), before);
});

// ===========================================================================
// The published contract
// ===========================================================================

test("R3-A Phase 2 — the five new tools ship additive-preview with honest scopes and directions", async () => {
  const built = await buildContract();
  const byName = new Map(built.contract.tools.map((tool) => [tool.name, tool]));

  const expected = {
    create_variable_collection: "document",
    rename_variable_mode: "variable_collection_mode",
    set_variable_metadata: "variable",
    bind_variable_to_node: "node",
    bind_variable_to_paint: "node",
  };

  for (const [name, scope] of Object.entries(expected)) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must be registered`);
    assert.equal(tool.direction, "write", `${name} is a write`);
    assert.equal(tool.scope, scope, `${name} scope`);
    // ⛔ CC1: a new tool ships `additive-preview`. `getResultStability` falls through to
    // `stable`, so an omission from ADDITIVE_PREVIEW_RESULTS would freeze a receipt no live
    // gate has judged — which is exactly what these five have not had yet.
    assert.equal(tool.resultStability, "additive-preview", `${name} stability`);
    assert.equal(tool.timeoutClass, "standard", `${name} timeout class`);
    assert.equal(tool.progress.pluginUpdates, "none", `${name} progress`);
  }

  assert.deepEqual(byName.get("create_variable_collection").inputSchema.required, [
    "name",
  ]);
  assert.deepEqual(byName.get("rename_variable_mode").inputSchema.required, [
    "collectionId",
    "modeId",
    "name",
  ]);
  assert.deepEqual(byName.get("set_variable_metadata").inputSchema.required, [
    "variableId",
  ]);
  assert.deepEqual(byName.get("bind_variable_to_node").inputSchema.required, [
    "nodeId",
    "field",
    "variableId",
  ]);
  assert.deepEqual(byName.get("bind_variable_to_paint").inputSchema.required, [
    "nodeId",
    "paintTarget",
    "paintIndex",
    "variableId",
  ]);

  // The two contract facts most likely to be quietly lost in a later edit.
  assert.match(
    byName.get("bind_variable_to_paint").description,
    /RETURNS A NEW PAINT/,
  );
  assert.match(
    byName.get("rename_variable_mode").description,
    /REFUSED as mode_name_unchanged/,
  );
});
