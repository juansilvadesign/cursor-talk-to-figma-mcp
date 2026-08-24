import assert from "node:assert/strict";
import test from "node:test";

import { buildContract } from "../scripts/contract-lib.mjs";
import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

test("R3-A 1.1 — variable writes require every Plugin API write entry point", async () => {
  const harness = await loadPluginHarness({ variableWriteApi: false });
  const hasVariablesApi = harness.globals("hasVariablesApi");
  const hasVariableWriteApi = harness.globals("hasVariableWriteApi");
  const figma = harness.globals("figma");

  assert.equal(hasVariablesApi(), true);
  assert.equal(
    hasVariableWriteApi(),
    false,
    "read APIs alone must not be reported as variable write support",
  );

  const writeMethods = [
    "createVariable",
    "createVariableCollection",
    "createVariableAlias",
  ];
  for (const method of writeMethods) {
    figma.variables[method] = () => undefined;
  }
  assert.equal(hasVariableWriteApi(), true);

  for (const method of writeMethods) {
    const original = figma.variables[method];
    delete figma.variables[method];
    assert.equal(
      hasVariableWriteApi(),
      false,
      `${method} is required before the plugin can claim variable write support`,
    );
    figma.variables[method] = original;
  }
});

test("R3-A 1.2 — variable capability preflight reports observed facts without writing", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  let writeCalls = 0;
  for (const method of [
    "createVariable",
    "createVariableCollection",
    "createVariableAlias",
  ]) {
    figma.variables[method] = () => {
      writeCalls += 1;
      throw new Error(`${method} must not be called by a capability read`);
    };
  }
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    "collection-1",
  );
  let addModeCalls = 0;
  let removeModeCalls = 0;
  collection.addMode = () => {
    addModeCalls += 1;
    throw new Error("addMode must not be called by a capability read");
  };
  collection.removeMode = () => {
    removeModeCalls += 1;
    throw new Error("removeMode must not be called by a capability read");
  };

  const capabilities = await harness.command("get_variable_capabilities");

  assert.equal(capabilities.supported, true);
  assert.equal(capabilities.complete, true);
  assert.equal(capabilities.readApiAvailable, true);
  assert.equal(capabilities.writeApiAvailable, true);
  assert.equal(capabilities.collectionInventoryAvailable, true);
  assert.equal(capabilities.collectionCount, 1);
  assert.equal(capabilities.localCollectionCount, 1);
  assert.deepEqual(capabilities.collections, [
    {
      id: "collection-1",
      name: "Foundation",
      key: "foundation-key",
      defaultModeId: "mode-light",
      isRemote: false,
      modeCount: 2,
    },
  ]);
  assert.deepEqual(capabilities.modeCeiling, {
    value: null,
    status: "unknown",
    knownGoodAtLeast: 2,
    limitation:
      "Figma exposes the mode limit only when addMode() is refused. This read-only probe intentionally does not create or delete a mode to discover it.",
  });
  assert.equal(capabilities.document.editable, null);
  assert.equal(
    capabilities.document.status,
    "file_permission_not_exposed",
  );
  assert.equal(capabilities.document.editorContextAllowsWrites, true);
  assert.equal(capabilities.document.permissionVerified, false);
  assert.match(capabilities.document.limitation, /no mutation was attempted/i);
  assert.equal(writeCalls, 0);
  assert.equal(addModeCalls, 0);
  assert.equal(removeModeCalls, 0);
});

test("R3-A 1.2 — capability preflight refuses to overstate inaccessible inventory or editability", async () => {
  const unsupported = await loadPluginHarness({ variablesApi: false });
  const unavailable = await unsupported.command("get_variable_capabilities");
  assert.equal(unavailable.supported, false);
  assert.equal(unavailable.complete, false);
  assert.equal(unavailable.readApiAvailable, false);
  assert.equal(unavailable.writeApiAvailable, false);
  assert.equal(unavailable.collectionCount, null);
  assert.deepEqual(unavailable.collections, []);
  assert.match(unavailable.limitations.join("\n"), /inventory is not available/i);

  const dev = await loadPluginHarness({ editorType: "dev", mode: "inspect" });
  const context = await dev.command("get_variable_capabilities");
  assert.equal(context.document.editable, false);
  assert.equal(
    context.document.status,
    "not_editable_in_current_context",
  );
  assert.equal(context.document.editorContextAllowsWrites, false);
  assert.match(context.document.limitation, /does not permit normal document writes/i);

  const unreadable = await loadPluginHarness();
  unreadable.globals("figma").variables.getLocalVariableCollectionsAsync = async () => {
    throw new Error("collection inventory refused");
  };
  const partial = await unreadable.command("get_variable_capabilities");
  assert.equal(partial.supported, true);
  assert.equal(partial.complete, false);
  assert.equal(partial.collectionCount, null);
  assert.deepEqual(partial.collections, []);
  assert.match(partial.limitations.join("\n"), /collection inventory refused/);
});

test("R3-A 1.2 — the preflight declares that library collections are not enumerable", async () => {
  const harness = await loadPluginHarness();
  const capabilities = await harness.command("get_variable_capabilities");

  // ⛔ `isRemote:false` on every row is the ONLY value this path can ever report —
  // getLocalVariableCollectionsAsync() returns local collections only — so observing it
  // corroborates nothing. The payload has to say that out loud, or a client reads an empty
  // remote result as "this file uses no library variables".
  assert.equal(capabilities.remoteCollectionInventoryAvailable, false);
  assert.match(
    capabilities.limitations.join("\n"),
    /returns only this file's local collections/i,
  );
  assert.match(capabilities.limitations.join("\n"), /NOT evidence/);

  // Every branch declares it, including the two that can answer nothing.
  const unsupported = await loadPluginHarness({ variablesApi: false });
  const unavailable = await unsupported.command("get_variable_capabilities");
  assert.equal(unavailable.remoteCollectionInventoryAvailable, false);
  assert.match(
    unavailable.limitations.join("\n"),
    /not enumerable by this preflight/i,
  );

  const unreadable = await loadPluginHarness();
  unreadable.globals("figma").variables.getLocalVariableCollectionsAsync = async () => {
    throw new Error("collection inventory refused");
  };
  const refused = await unreadable.command("get_variable_capabilities");
  assert.equal(refused.remoteCollectionInventoryAvailable, false);
  assert.match(
    refused.limitations.join("\n"),
    /not enumerable by this preflight/i,
  );
});

test("R3-A 1.2 — the remote filter is a defensive branch, not dead code", async () => {
  // ⛔ This fixture is a shape Figma is NOT expected to produce. A `remote: true` row cannot
  // appear in getLocalVariableCollectionsAsync()'s result today, and the live pass on channel
  // `mlag5jfc` observed none — it could not have. It is stubbed here for exactly one reason:
  // to prove the per-collection `isRemote` and the local filter are load-bearing if Figma
  // ever widens that getter. ⛔ Never read this green as evidence that remote collections DO
  // reach the inventory.
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
  figma.variables.getLocalVariableCollectionsAsync = async () => [
    ...localCollections,
    {
      id: "collection-remote",
      name: "Library",
      key: "library-key",
      defaultModeId: "mode-a",
      remote: true,
      modes: [{ id: "mode-a" }, { id: "mode-b" }, { id: "mode-c" }],
    },
  ];

  const capabilities = await harness.command("get_variable_capabilities");
  assert.equal(capabilities.collectionCount, 2);
  assert.equal(capabilities.localCollectionCount, 1);
  assert.equal(capabilities.collections.at(-1).isRemote, true);
  // The 3-mode REMOTE collection must not raise the LOCAL lower bound.
  assert.equal(capabilities.modeCeiling.knownGoodAtLeast, 2);
});

test("R3-A 1.3 — add_variable_mode changes exactly the caller-requested collection and never probes by removing", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    "collection-1",
  );
  const modeCountBefore = collection.modes.length;
  let addModeCalls = 0;
  let removeModeCalls = 0;
  let unrelatedWriteCalls = 0;

  collection.addMode = (name) => {
    addModeCalls += 1;
    const modeId = "mode-high-contrast";
    collection.modes.push({ modeId, name });
    return modeId;
  };
  collection.removeMode = () => {
    removeModeCalls += 1;
    throw new Error("add_variable_mode must never remove a mode after adding one");
  };
  for (const method of [
    "createVariable",
    "createVariableCollection",
    "createVariableAlias",
  ]) {
    figma.variables[method] = () => {
      unrelatedWriteCalls += 1;
      throw new Error(`${method} is not part of add_variable_mode`);
    };
  }

  const receipt = await harness.command("add_variable_mode", {
    collectionId: "collection-1",
    name: "High contrast",
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "created");
  assert.deepEqual(receipt.collection, {
    id: "collection-1",
    name: "Foundation",
    key: "foundation-key",
    modeCountBefore,
    modeCountAfter: modeCountBefore + 1,
  });
  assert.deepEqual(receipt.mode, {
    id: "mode-high-contrast",
    name: "High contrast",
    nameReadable: true,
  });
  assert.deepEqual(receipt.modeCeiling, {
    value: null,
    status: "unknown",
    knownGoodAtLeast: modeCountBefore + 1,
    limitation:
      "Figma accepted this caller-requested addMode() call, so it did not reveal the numeric mode limit. No separate create/delete probe was performed.",
  });
  assert.equal(addModeCalls, 1);
  assert.equal(removeModeCalls, 0);
  assert.equal(unrelatedWriteCalls, 0);
  assert.equal(collection.modes.length, modeCountBefore + 1);
});

test("R3-A 1.3 — add_variable_mode returns Figma's first ceiling refusal verbatim without a cleanup mutation", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    "collection-1",
  );
  const modeCountBefore = collection.modes.length;
  // Deliberately unlike the fixture's current count: this proves the reported ceiling is
  // parsed from Figma's own refusal, not guessed from a collection count or a plan table.
  const observedLimit = 37;
  const refusal = `in addMode: Limited to ${observedLimit} modes only`;
  let addModeCalls = 0;
  let removeModeCalls = 0;

  collection.addMode = () => {
    addModeCalls += 1;
    throw new Error(refusal);
  };
  collection.removeMode = () => {
    removeModeCalls += 1;
    throw new Error("add_variable_mode must never remove a failed mode");
  };

  const receipt = await harness.command("add_variable_mode", {
    collectionId: "collection-1",
    name: "Dark",
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "refused");
  assert.deepEqual(receipt.collection, {
    id: "collection-1",
    name: "Foundation",
    key: "foundation-key",
    modeCountBefore,
    modeCountAfter: modeCountBefore,
  });
  assert.equal(receipt.mode, null);
  assert.deepEqual(receipt.modeCeiling, {
    value: observedLimit,
    status: "observed",
    knownGoodAtLeast: modeCountBefore,
    limitation:
      "The numeric mode ceiling was observed only in Figma's direct refusal of this caller-requested addMode() call. No create/delete probe was performed.",
  });
  assert.equal(receipt.refusal, refusal);
  assert.equal(addModeCalls, 1);
  assert.equal(removeModeCalls, 0);
  assert.equal(collection.modes.length, modeCountBefore);
});

test("R3-A 1.3 — the public schema declares add_variable_mode as an additive preview write", async () => {
  const built = await buildContract();
  const tool = built.contract.tools.find(
    (entry) => entry.name === "add_variable_mode",
  );

  assert.ok(tool, "add_variable_mode must be registered");
  assert.equal(tool.direction, "write");
  assert.equal(tool.scope, "variable_collection");
  assert.equal(tool.resultStability, "additive-preview");
  assert.deepEqual(tool.inputSchema.required, ["collectionId", "name"]);
  assert.match(tool.description, /never creates a temporary collection or mode/i);
  assert.match(tool.description, /refusal text verbatim/i);
});
