import assert from "node:assert/strict";
import test from "node:test";

import { buildContract } from "../scripts/contract-lib.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function variable(harness, id) {
  return await harness.globals("figma").variables.getVariableByIdAsync(id);
}

test("R3-A Phase 2 — create_variable targets the resolved local collection object and reports the created variable", async () => {
  const harness = await loadPluginHarness();

  const receipt = await harness.command("create_variable", {
    collectionId: "collection-1",
    name: "Family/Accent",
    resolvedType: "STRING",
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "created");
  assert.equal(receipt.collection.id, "collection-1");
  assert.equal(receipt.collection.remote, false);
  assert.equal(receipt.variable.name, "Family/Accent");
  assert.equal(receipt.variable.resolvedType, "STRING");
  assert.equal(receipt.variable.variableCollectionId, "collection-1");
  assert.equal(receipt.variable.remote, false);

  const created = await variable(harness, receipt.variable.id);
  assert.ok(created, "the returned ID must resolve to the resource Figma created");
  assert.equal(created.name, "Family/Accent");
  assert.equal(created.resolvedType, "STRING");
});

test("R3-A Phase 2 — an unreadable create result is unverified, never presented as a clean refusal", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const originalCreate = figma.variables.createVariable;
  let receivedCollection = null;
  figma.variables.createVariable = (name, collection, resolvedType) => {
    receivedCollection = collection;
    assert.equal(name, "Unverifiable/Create");
    assert.equal(resolvedType, "BOOLEAN");
    return {};
  };

  const receipt = await harness.command("create_variable", {
    collectionId: "collection-1",
    name: "Unverifiable/Create",
    resolvedType: "BOOLEAN",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "unverified");
  assert.equal(receipt.partialApplicationPossible, true);
  assert.equal(receipt.refusal.code, "invalid_create_result");
  assert.equal(receivedCollection.id, "collection-1");
  figma.variables.createVariable = originalCreate;
});

test("R3-A Phase 2 — set_variable_value writes raw FLOAT, STRING, BOOLEAN and RGBA values and reads the stored value back", async () => {
  const harness = await loadPluginHarness();

  const floatReceipt = await harness.command("set_variable_value", {
    variableId: "var-space",
    modeId: "mode-light",
    value: 0,
  });
  assert.equal(floatReceipt.success, true);
  assert.equal(floatReceipt.outcome, "applied");
  assert.equal(floatReceipt.previousValue, 24);
  assert.equal(floatReceipt.value, 0, "zero is a value, not a missing field");
  assert.equal((await variable(harness, "var-space")).valuesByMode["mode-light"], 0);

  const string = await harness.command("create_variable", {
    collectionId: "collection-1",
    name: "Family/Body",
    resolvedType: "STRING",
  });
  const stringReceipt = await harness.command("set_variable_value", {
    variableId: string.variable.id,
    modeId: "mode-dark",
    value: "Source Serif 4",
  });
  assert.equal(stringReceipt.value, "Source Serif 4");
  assert.equal(
    (await variable(harness, string.variable.id)).valuesByMode["mode-dark"],
    "Source Serif 4",
  );

  const boolean = await harness.command("create_variable", {
    collectionId: "collection-1",
    name: "Feature/Enabled",
    resolvedType: "BOOLEAN",
  });
  const booleanReceipt = await harness.command("set_variable_value", {
    variableId: boolean.variable.id,
    modeId: "mode-light",
    value: false,
  });
  assert.equal(booleanReceipt.value, false, "false is a value, not a missing field");

  const colorReceipt = await harness.command("set_variable_value", {
    variableId: "var-primary",
    modeId: "mode-light",
    value: { r: 1, g: 0, b: 0, a: 0 },
  });
  assert.equal(colorReceipt.value, "#ff000000");
  assert.deepEqual((await variable(harness, "var-primary")).valuesByMode["mode-light"], {
    r: 1,
    g: 0,
    b: 0,
    a: 0,
  });
});

test("R3-A Phase 2 — raw values are type-checked before Figma sees a write", async () => {
  const harness = await loadPluginHarness();
  const source = await variable(harness, "var-primary");
  const before = clone(source.valuesByMode["mode-light"]);
  let writes = 0;
  source.setValueForMode = () => {
    writes += 1;
    throw new Error("raw validation must happen before setValueForMode");
  };

  await assert.rejects(
    () =>
      harness.command("set_variable_value", {
        variableId: "var-primary",
        modeId: "mode-light",
        value: "#ff0000",
      }),
    /RGBA object.*hex strings are not accepted/i,
  );
  await assert.rejects(
    () =>
      harness.command("set_variable_value", {
        variableId: "var-primary",
        modeId: "mode-light",
        value: { r: 1, g: 0, b: 0, a: 1, hex: "#ff0000" },
      }),
    /unexpected hex would be discarded/i,
  );

  assert.equal(writes, 0);
  assert.deepEqual(source.valuesByMode["mode-light"], before);
});

test("R3-A Phase 2 — aliases are values, reject type mismatch and never create a self/cyclic dependency", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");

  const aliasReceipt = await harness.command("set_variable_value", {
    variableId: "var-alias",
    modeId: "mode-light",
    aliasOf: "var-primary",
  });
  assert.equal(aliasReceipt.success, true);
  assert.deepEqual(aliasReceipt.assignment, { kind: "alias", aliasOf: "var-primary" });
  assert.deepEqual(aliasReceipt.value, { type: "VARIABLE_ALIAS", id: "var-primary" });

  const primary = await variable(harness, "var-primary");
  const primaryBefore = clone(primary.valuesByMode["mode-light"]);
  let sourceWrites = 0;
  primary.setValueForMode = () => {
    sourceWrites += 1;
    throw new Error("cycle preflight must run before setValueForMode");
  };

  const cycle = await harness.command("set_variable_value", {
    variableId: "var-primary",
    modeId: "mode-light",
    aliasOf: "var-alias",
  });
  assert.equal(cycle.success, false);
  assert.equal(cycle.outcome, "refused");
  assert.equal(cycle.refusal.code, "alias_cycle");
  assert.equal(sourceWrites, 0);
  assert.deepEqual(primary.valuesByMode["mode-light"], primaryBefore);

  const typeMismatch = await harness.command("set_variable_value", {
    variableId: "var-space",
    modeId: "mode-light",
    aliasOf: "var-primary",
  });
  assert.equal(typeMismatch.success, false);
  assert.equal(typeMismatch.refusal.code, "alias_type_mismatch");

  let aliasCalls = 0;
  figma.variables.createVariableAlias = () => {
    aliasCalls += 1;
    throw new Error("self alias must be refused before alias creation");
  };
  const selfAlias = await harness.command("set_variable_value", {
    variableId: "var-primary",
    modeId: "mode-dark",
    aliasOf: "var-primary",
  });
  assert.equal(selfAlias.success, false);
  assert.equal(selfAlias.refusal.code, "alias_cycle");
  assert.equal(aliasCalls, 0);
});

test("R3-A Phase 2 — remote variables and collections get typed refusals without their mutators running", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const originalVariableLookup = figma.variables.getVariableByIdAsync;
  const originalCollectionLookup = figma.variables.getVariableCollectionByIdAsync;
  const originalCreate = figma.variables.createVariable;
  let remoteWriteCalls = 0;
  let createCalls = 0;
  const remoteVariable = {
    id: "remote-variable",
    name: "Library/Primary",
    key: "remote-key",
    variableCollectionId: "remote-collection",
    resolvedType: "COLOR",
    remote: true,
    valuesByMode: {},
    setValueForMode() {
      remoteWriteCalls += 1;
    },
    remove() {
      remoteWriteCalls += 1;
    },
  };
  const remoteCollection = {
    id: "remote-collection",
    name: "Library",
    key: "remote-collection-key",
    defaultModeId: "mode-remote",
    remote: true,
    modes: [{ modeId: "mode-remote", name: "Default" }],
  };

  figma.variables.getVariableByIdAsync = async (id) =>
    id === remoteVariable.id ? remoteVariable : await originalVariableLookup(id);
  figma.variables.getVariableCollectionByIdAsync = async (id) =>
    id === remoteCollection.id ? remoteCollection : await originalCollectionLookup(id);
  figma.variables.createVariable = (...args) => {
    createCalls += 1;
    return originalCreate.apply(figma.variables, args);
  };

  const remoteSet = await harness.command("set_variable_value", {
    variableId: remoteVariable.id,
    modeId: "mode-remote",
    value: { r: 1, g: 0, b: 0 },
  });
  assert.equal(remoteSet.success, false);
  assert.equal(remoteSet.refusal.code, "remote_variable");

  const remoteDelete = await harness.command("delete_variable", {
    variableId: remoteVariable.id,
    confirm: true,
  });
  assert.equal(remoteDelete.success, false);
  assert.equal(remoteDelete.refusal.code, "remote_variable");

  const remoteCreate = await harness.command("create_variable", {
    collectionId: remoteCollection.id,
    name: "Local/Attempt",
    resolvedType: "STRING",
  });
  assert.equal(remoteCreate.success, false);
  assert.equal(remoteCreate.refusal.code, "remote_collection");
  assert.equal(remoteWriteCalls, 0);
  assert.equal(createCalls, 0);
});

test("R3-A Phase 2 — delete_variable needs literal confirmation, and on a frame-deferred platform refuses to claim EITHER outcome in-frame", async () => {
  const harness = await loadPluginHarness();
  const candidate = await variable(harness, "var-space");
  let removeCalls = 0;
  const originalRemove = candidate.remove;
  candidate.remove = () => {
    removeCalls += 1;
    return originalRemove();
  };

  await assert.rejects(
    () => harness.command("delete_variable", { variableId: "var-space" }),
    /requires confirm: true/i,
  );
  await assert.rejects(
    () =>
      harness.command("delete_variable", {
        variableId: "var-space",
        confirm: false,
      }),
    /requires confirm: true/i,
  );
  assert.equal(removeCalls, 0);
  assert.ok(await variable(harness, "var-space"));

  const receipt = await harness.command("delete_variable", {
    variableId: "var-space",
    confirm: true,
  });
  assert.equal(removeCalls, 1);
  assert.equal(receipt.confirm, true);

  // ⛔ This is the shape live Figma actually answers with (channel hvq0orwg, 2026-08-24):
  // remove() worked, yet nothing in this frame can prove it. The handler must not claim
  // success it cannot observe — and must not report failure either, because the deletion
  // is real.
  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "removal_unconfirmed");
  assert.equal(receipt.removalObserved, false);
  assert.equal(receipt.verificationDeferred, true);
  assert.equal(receipt.partialApplicationPossible, true);
  assert.equal(receipt.refusal.code, "delete_not_observed_in_frame");
  assert.equal(receipt.observation.lookupResolved, true);
  assert.equal(receipt.observation.observedBy, null);

  // The removal IS real, and the next frame is the only place that can say so.
  assert.equal(await variable(harness, "var-space"), null);
});

test("R3-A Phase 2 — a remove() that does nothing is indistinguishable IN-FRAME and is caught only by the cross-frame re-read", async () => {
  const harness = await loadPluginHarness();
  const candidate = await variable(harness, "var-space");
  candidate.remove = () => undefined;

  const receipt = await harness.command("delete_variable", {
    variableId: "var-space",
    confirm: true,
  });

  // ⛔ Byte-identical in-frame verdict to the honest deferred delete above. That is the
  // whole point: an in-frame signal CANNOT separate a no-op remove from a deferred commit,
  // so a handler that reports success here would be guessing.
  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "removal_unconfirmed");
  assert.equal(receipt.removalObserved, false);
  assert.equal(receipt.refusal.code, "delete_not_observed_in_frame");
  assert.equal(receipt.observation.observedBy, null);

  // ...and this is the known-bad leg: the caller's cross-frame re-read is what still fails.
  assert.ok(
    await variable(harness, "var-space"),
    "a remove() that did nothing must remain observable after the frame commits",
  );
});

test("R3-A Phase 2 — a platform whose in-frame lookup misses is reported as an observed deletion", async () => {
  const harness = await loadPluginHarness({ variableRemovalSignal: "lookup_missed" });

  const receipt = await harness.command("delete_variable", {
    variableId: "var-space",
    confirm: true,
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "deleted");
  assert.equal(receipt.removalObserved, true);
  assert.equal(receipt.verificationDeferred, false);
  assert.equal(receipt.observation.observedBy, "lookup_missed");
  assert.equal(receipt.observation.lookupResolved, false);
  assert.equal(await variable(harness, "var-space"), null);
});

test("R3-A Phase 2 — a platform that flags the removed object is reported as an observed deletion", async () => {
  const harness = await loadPluginHarness({ variableRemovalSignal: "removed_flag" });

  const receipt = await harness.command("delete_variable", {
    variableId: "var-space",
    confirm: true,
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "deleted");
  assert.equal(receipt.removalObserved, true);
  assert.equal(receipt.observation.observedBy, "removed_flag");
  assert.equal(receipt.observation.lookupResolved, true);
  assert.equal(receipt.observation.removedFlag, true);
  assert.equal(await variable(harness, "var-space"), null);
});

test("R3-A Phase 2 — a platform that drops collection membership in-frame is reported as an observed deletion", async () => {
  const harness = await loadPluginHarness({
    variableRemovalSignal: "collection_membership",
  });

  const receipt = await harness.command("delete_variable", {
    variableId: "var-space",
    confirm: true,
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "deleted");
  assert.equal(receipt.removalObserved, true);
  assert.equal(receipt.observation.observedBy, "collection_membership");
  assert.equal(receipt.observation.lookupResolved, true);
  assert.equal(receipt.observation.collectionStillLists, false);
  assert.equal(await variable(harness, "var-space"), null);
});

test("R3-A Phase 2 — published schemas keep the three new receipts additive-preview and scoped", async () => {
  const built = await buildContract();
  const byName = new Map(built.contract.tools.map((tool) => [tool.name, tool]));
  const setValue = byName.get("set_variable_value");
  const create = byName.get("create_variable");
  const remove = byName.get("delete_variable");

  assert.ok(setValue);
  assert.ok(create);
  assert.ok(remove);
  assert.equal(setValue.direction, "write");
  assert.equal(setValue.scope, "variable_mode");
  assert.equal(setValue.resultStability, "additive-preview");
  assert.deepEqual(setValue.inputSchema.required, ["variableId", "modeId"]);
  assert.match(setValue.description, /exactly one of value or aliasOf/i);
  assert.match(setValue.description, /hex strings are not accepted/i);
  assert.match(setValue.description, /typed refusal/i);

  assert.equal(create.direction, "write");
  assert.equal(create.scope, "variable_collection");
  assert.equal(create.resultStability, "additive-preview");
  assert.deepEqual(create.inputSchema.required, ["collectionId", "name", "resolvedType"]);
  assert.match(create.description, /not an upsert/i);

  assert.equal(remove.direction, "write");
  assert.equal(remove.scope, "variable");
  assert.equal(remove.resultStability, "additive-preview");
  assert.deepEqual(remove.inputSchema.required, ["variableId", "confirm"]);
  assert.equal(remove.inputSchema.properties.confirm.const, true);
  assert.match(remove.description, /disposable Figma file/i);
});
