import assert from "node:assert/strict";
import test from "node:test";

import { buildContract } from "../scripts/contract-lib.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

async function collection(harness, id) {
  return await harness
    .globals("figma")
    .variables.getVariableCollectionByIdAsync(id);
}

async function createEmptyCollection(harness, name = "Disposable") {
  const receipt = await harness.command("create_variable_collection", { name });
  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "created");
  assert.equal(receipt.collection.modeCount, 1);
  return receipt.collection;
}

test("delete_variable_collection needs literal confirmation and never reaches remove() without it", async () => {
  const harness = await loadPluginHarness();
  const candidate = await createEmptyCollection(harness, "Confirm gate");
  const resource = await collection(harness, candidate.id);
  let removeCalls = 0;
  const originalRemove = resource.remove;
  resource.remove = () => {
    removeCalls += 1;
    return originalRemove();
  };

  await assert.rejects(
    () =>
      harness.command("delete_variable_collection", {
        collectionId: candidate.id,
      }),
    /requires confirm: true/i,
  );
  await assert.rejects(
    () =>
      harness.command("delete_variable_collection", {
        collectionId: candidate.id,
        confirm: "true",
      }),
    /requires confirm: true/i,
  );

  assert.equal(removeCalls, 0);
  assert.ok(await collection(harness, candidate.id));
});

test("delete_variable_collection refuses an exact remote collection before remove()", async () => {
  const harness = await loadPluginHarness();
  const resource = await collection(harness, "collection-1");
  const originalRemote = resource.remote;
  const originalRemove = resource.remove;
  let removeCalls = 0;
  resource.remote = true;
  resource.remove = () => {
    removeCalls += 1;
    return originalRemove();
  };

  const receipt = await harness.command("delete_variable_collection", {
    collectionId: resource.id,
    confirm: true,
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "refused");
  assert.equal(receipt.refusal.code, "remote_collection");
  assert.equal(removeCalls, 0);
  resource.remote = originalRemote;
});

test("delete_variable_collection refuses a non-empty collection with its pre-call membership", async () => {
  const harness = await loadPluginHarness();
  const resource = await collection(harness, "collection-1");
  const memberIds = resource.variableIds.slice();
  assert.ok(memberIds.length > 0, "fixture collection must hold variables for this guard");
  const originalRemove = resource.remove;
  let removeCalls = 0;
  resource.remove = () => {
    removeCalls += 1;
    return originalRemove();
  };

  const receipt = await harness.command("delete_variable_collection", {
    collectionId: resource.id,
    confirm: true,
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "refused");
  assert.equal(receipt.refusal.code, "collection_not_empty");
  assert.equal(receipt.confirm, true);
  assert.deepEqual(receipt.blastRadius.variableIds, memberIds);
  assert.equal(receipt.blastRadius.variableCount, memberIds.length);
  assert.match(receipt.blastRadius.consequence, /never removed/i);
  assert.equal(removeCalls, 0, "the collection must be refused before Figma remove()");
  assert.ok(await collection(harness, resource.id));
});

test("delete_variable_collection defers when no in-frame signal can prove a real remove", async () => {
  const harness = await loadPluginHarness({ collectionRemovalSignal: "none" });
  const candidate = await createEmptyCollection(harness, "Deferred removal");

  const receipt = await harness.command("delete_variable_collection", {
    collectionId: candidate.id,
    confirm: true,
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "removal_unconfirmed");
  assert.equal(receipt.removalObserved, false);
  assert.equal(receipt.verificationDeferred, true);
  assert.equal(receipt.partialApplicationPossible, true);
  assert.equal(receipt.refusal.code, "collection_removal_not_observed_in_frame");
  assert.equal(receipt.blastRadius.variableCount, 0);
  assert.deepEqual(receipt.blastRadius.variableIds, []);
  assert.equal(receipt.observation.lookupResolved, true);
  assert.equal(receipt.observation.localInventoryStillLists, true);
  assert.equal(receipt.observation.observedBy, null);

  // The harness commits after it builds the response. This is the caller's later frame, the
  // only place that can distinguish the truthful deferral from a no-op remove().
  assert.equal(await collection(harness, candidate.id), null);
});

test("delete_variable_collection names the independent local-inventory signal on success", async () => {
  const harness = await loadPluginHarness({
    collectionRemovalSignal: "local_inventory",
  });
  const candidate = await createEmptyCollection(harness, "Inventory signal");

  const receipt = await harness.command("delete_variable_collection", {
    collectionId: candidate.id,
    confirm: true,
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "deleted");
  assert.equal(receipt.removalObserved, true);
  assert.equal(receipt.verificationDeferred, false);
  assert.equal(receipt.observation.lookupResolved, true);
  assert.equal(receipt.observation.localInventoryStillLists, false);
  assert.equal(receipt.observation.observedBy, "local_collection_inventory");
  assert.equal(await collection(harness, candidate.id), null);
});

test("delete_variable_collection also accepts a lookup-missed observation without depending on inventory", async () => {
  const harness = await loadPluginHarness({
    collectionRemovalSignal: "lookup_missed",
  });
  const candidate = await createEmptyCollection(harness, "Lookup signal");

  const receipt = await harness.command("delete_variable_collection", {
    collectionId: candidate.id,
    confirm: true,
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "deleted");
  assert.equal(receipt.observation.lookupResolved, false);
  assert.equal(receipt.observation.localInventoryStillLists, true);
  assert.equal(receipt.observation.observedBy, "lookup_missed");
  assert.equal(await collection(harness, candidate.id), null);
});

test("delete_variable_collection publishes an additive-preview exact-collection contract", async () => {
  const built = await buildContract();
  const tool = built.contract.tools.find(
    (candidate) => candidate.name === "delete_variable_collection",
  );

  assert.ok(tool);
  assert.equal(tool.direction, "write");
  assert.equal(tool.scope, "variable_collection");
  assert.equal(tool.resultStability, "additive-preview");
  assert.equal(tool.timeoutClass, "standard");
  assert.equal(tool.progress.pluginUpdates, "none");
  assert.deepEqual(tool.inputSchema.required, ["collectionId", "confirm"]);
  assert.equal(tool.inputSchema.properties.confirm.const, true);
  assert.match(tool.description, /EMPTY local variable collection/);
  assert.match(tool.description, /collection_not_empty/);
  assert.match(tool.description, /removal_unconfirmed/);
});
