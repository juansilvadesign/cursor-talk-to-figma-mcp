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

test("R3-A 1.3 — the public schema declares add_variable_mode as a stable write", async () => {
  const built = await buildContract();
  const tool = built.contract.tools.find(
    (entry) => entry.name === "add_variable_mode",
  );

  assert.ok(tool, "add_variable_mode must be registered");
  assert.equal(tool.direction, "write");
  assert.equal(tool.scope, "variable_collection");
  // ⭐ `stable` since the R3-A promotion, 2026-08-25. This assertion used to read
  // `additive-preview`, and updating it is the acceptance act itself — not a test chasing
  // the source. `compatibilityErrors()` now refuses the walk-back by name, so this literal
  // and the contract can no longer disagree in the weakening direction.
  assert.equal(tool.resultStability, "stable");
  assert.deepEqual(tool.inputSchema.required, ["collectionId", "name"]);
  assert.match(tool.description, /never creates a temporary collection or mode/i);
  assert.match(tool.description, /refusal text verbatim/i);
});

// ---------------------------------------------------------------------------
// R3-A Phase 4 — `remove_variable_mode`, the modes slice
//
// ⛔ THE DEFECT THIS SUITE IS SHAPED AROUND ALREADY HAPPENED ONCE, to `delete_variable`.
// That tool asked ONE question after `remove()` — `getVariableByIdAsync` — which Figma
// answers with a STALE object inside the deleting frame, so its success branch was
// unreachable live while an obliging harness kept it green. The fix was to probe several
// independent signals and name the one that fired.
//
// So the harness models "what does Figma make observable in-frame?" as an OPTION with
// three settings, and the DEFAULT is the conservative one where nothing is observable.
// The tests below therefore start from the deferral, not from the success: a green
// `removed` receipt is something a signal has to earn here, not the resting state.
// ---------------------------------------------------------------------------

const DEFAULT_MODE = "mode-light";
const SECOND_MODE = "mode-dark";

test("R3-A 2.5 — confirm must be literal true, and nothing is called without it", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    "collection-1",
  );
  let removeModeCalls = 0;
  collection.removeMode = () => {
    removeModeCalls += 1;
    throw new Error("removeMode must not be reached without confirm: true");
  };

  // ⛔ A generic truthy value is not a confirmation. The published schema is z.literal(true),
  // and the handler repeats the check because the plugin has a second entry point that the
  // schema does not police.
  for (const confirm of [undefined, false, "true", 1, {}]) {
    await assert.rejects(
      () =>
        harness.command("remove_variable_mode", {
          collectionId: "collection-1",
          modeId: SECOND_MODE,
          ...(confirm === undefined ? {} : { confirm }),
        }),
      /requires confirm: true; wrote nothing/,
      `confirm ${JSON.stringify(confirm)} must not be accepted`,
    );
  }
  assert.equal(removeModeCalls, 0);
  assert.equal(collection.modes.length, 2);
});

test("R3-A 2.5 — the DEFAULT mode is refused without calling removeMode", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    "collection-1",
  );
  let removeModeCalls = 0;
  collection.removeMode = () => {
    removeModeCalls += 1;
    throw new Error("the default mode must never reach removeMode");
  };

  const receipt = await harness.command("remove_variable_mode", {
    collectionId: "collection-1",
    modeId: DEFAULT_MODE,
    confirm: true,
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.outcome, "refused");
  assert.equal(receipt.refusal.code, "default_mode");
  assert.match(receipt.refusal.message, /does not document where defaultModeId lands/);
  assert.equal(receipt.collection.id, "collection-1");
  assert.equal(receipt.mode.id, DEFAULT_MODE);
  assert.equal(removeModeCalls, 0, "the refusal must precede every Figma call");
  assert.equal(collection.modes.length, 2);
  assert.equal(collection.defaultModeId, DEFAULT_MODE);
});

test("R3-A 2.5 — the SOLE remaining mode is refused, and the guard is not the default guard", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  // A fresh single-mode collection whose one mode is ALSO its default would be refused by
  // the default guard first, which would leave the sole-mode branch unproven. So the
  // default is pointed elsewhere: this reaches the sole-mode refusal on its own merits.
  const collection = figma.variables.createVariableCollection("Solo");
  const soleMode = collection.modes[0].modeId;
  collection.defaultModeId = "mode-not-this-one";
  let removeModeCalls = 0;
  collection.removeMode = () => {
    removeModeCalls += 1;
    throw new Error("the last mode must never reach removeMode");
  };

  const receipt = await harness.command("remove_variable_mode", {
    collectionId: collection.id,
    modeId: soleMode,
    confirm: true,
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.refusal.code, "sole_remaining_mode");
  assert.match(receipt.refusal.message, /no slot to hold any variable's value/);
  assert.equal(removeModeCalls, 0);
  assert.equal(collection.modes.length, 1);
});

test("R3-A 2.5 — a mode that belongs to another collection is refused by ID, not by name", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const other = figma.variables.createVariableCollection("Other");

  const receipt = await harness.command("remove_variable_mode", {
    collectionId: "collection-1",
    modeId: other.modes[0].modeId,
    confirm: true,
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.refusal.code, "mode_not_in_collection");
  assert.equal(other.modes.length, 1, "the other collection must be untouched");
});

test("R3-A 2.5 — a missing collection and a remote collection each get their own typed refusal", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");

  const missing = await harness.command("remove_variable_mode", {
    collectionId: "VariableCollectionId:0:0",
    modeId: SECOND_MODE,
    confirm: true,
  });
  assert.equal(missing.refusal.code, "collection_not_found");

  const remote = figma.variables.createVariableCollection("Library");
  remote.remote = true;
  const refused = await harness.command("remove_variable_mode", {
    collectionId: remote.id,
    modeId: remote.modes[0].modeId,
    confirm: true,
  });
  assert.equal(refused.refusal.code, "remote_collection");
});

test("R3-A 2.5 — when NOTHING in-frame can observe the removal, the receipt defers instead of claiming it", async () => {
  // ⛔ This is the `delete_not_observed` shape, and it is the DEFAULT harness model on
  // purpose: `modeRemovalSignal: "none"` is the conservative reading of a platform that
  // documents `removeMode(modeId)` and says nothing about when it becomes visible.
  const harness = await loadPluginHarness();
  const receipt = await harness.command("remove_variable_mode", {
    collectionId: "collection-1",
    modeId: SECOND_MODE,
    confirm: true,
  });

  assert.equal(receipt.success, false, "an unobservable removal is NOT a success");
  assert.equal(receipt.outcome, "removal_unconfirmed");
  assert.equal(receipt.removalObserved, false);
  assert.equal(receipt.verificationDeferred, true);
  assert.equal(receipt.partialApplicationPossible, true);
  assert.equal(receipt.refusal.code, "mode_removal_not_observed_in_frame");
  assert.equal(receipt.observation.observedBy, null);
  assert.equal(receipt.observation.resolvedCollectionStillLists, true);
  assert.equal(receipt.observation.freshCollectionStillLists, true);

  // ⭐ And the removal WAS real — the frame commits it, so the caller's own later read is
  // the instrument the receipt told it to use. A handler that had claimed success here
  // would have been RIGHT about the outcome and WRONG about what it could see, which is
  // the distinction the deferral exists to keep.
  const figma = harness.globals("figma");
  const after = await figma.variables.getVariableCollectionByIdAsync("collection-1");
  assert.equal(
    after.modes.some((mode) => mode.modeId === SECOND_MODE),
    false,
    "the deferred removal must genuinely land at frame end",
  );
});

test("R3-A 2.5 — the resolved collection's own modes array is one observing signal", async () => {
  const harness = await loadPluginHarness({ modeRemovalSignal: "collection_modes" });
  const receipt = await harness.command("remove_variable_mode", {
    collectionId: "collection-1",
    modeId: SECOND_MODE,
    confirm: true,
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.outcome, "removed");
  assert.equal(receipt.removalObserved, true);
  assert.equal(receipt.verificationDeferred, false);
  assert.equal(receipt.observation.observedBy, "resolved_collection_modes");
  assert.equal(receipt.observation.resolvedCollectionStillLists, false);
  assert.equal(receipt.modeCountBefore, 2);
  assert.equal(receipt.observation.modeCountAfter, 1);
  assert.equal(receipt.defaultModeIdStable, true);
});

test("R3-A 2.5 — a FRESH lookup is a genuinely separate signal, and it is load-bearing", async () => {
  // ⛔ Without this arm the second probe could be dead code and every test would still be
  // green — the same "a dead read path sat 332/332 green" shape the fork has already paid
  // for once. Here the resolved object STILL lists the mode and only a new lookup does not,
  // so the receipt can only be right if the handler actually asked the second question.
  const harness = await loadPluginHarness({ modeRemovalSignal: "fresh_lookup" });
  const receipt = await harness.command("remove_variable_mode", {
    collectionId: "collection-1",
    modeId: SECOND_MODE,
    confirm: true,
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.observation.observedBy, "fresh_collection_modes");
  assert.equal(
    receipt.observation.resolvedCollectionStillLists,
    true,
    "the first signal must be reported as NOT having observed it",
  );
  assert.equal(receipt.observation.freshCollectionStillLists, false);
  assert.equal(receipt.defaultModeIdStable, true);
});

test("R3-A 2.5 — the blast radius is read BEFORE the call and names what survives", async () => {
  const harness = await loadPluginHarness({ modeRemovalSignal: "collection_modes" });
  const figma = harness.globals("figma");
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    "collection-1",
  );
  const variableCountBefore = collection.variableIds.length;
  assert.ok(variableCountBefore > 0, "the fixture must carry variables to have a radius");

  const receipt = await harness.command("remove_variable_mode", {
    collectionId: "collection-1",
    modeId: SECOND_MODE,
    confirm: true,
  });

  assert.equal(receipt.blastRadius.variableCount, variableCountBefore);
  assert.match(receipt.blastRadius.valuesDiscarded, /other modes are untouched/);
});

test("R3-A 2.5 — a Figma throw is reported as a refusal that may have applied", async () => {
  const harness = await loadPluginHarness();
  const figma = harness.globals("figma");
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    "collection-1",
  );
  collection.removeMode = () => {
    throw new Error("in removeMode: something the platform owns");
  };

  const receipt = await harness.command("remove_variable_mode", {
    collectionId: "collection-1",
    modeId: SECOND_MODE,
    confirm: true,
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.refusal.code, "figma_refusal");
  assert.match(receipt.refusal.message, /in removeMode: something the platform owns/);
  assert.equal(
    receipt.partialApplicationPossible,
    true,
    "a platform throw is not proof that no state changed",
  );
});

test("R3-A 2.5 — the public schema declares remove_variable_mode as a destructive stable write", async () => {
  const built = await buildContract();
  const tool = built.contract.tools.find(
    (entry) => entry.name === "remove_variable_mode",
  );

  assert.ok(tool, "remove_variable_mode must be registered");
  assert.equal(tool.direction, "write");
  assert.equal(tool.scope, "variable_collection_mode");
  // ⭐ `stable` since the R3-A promotion, 2026-08-25. This assertion used to read
  // `additive-preview`, and updating it is the acceptance act itself — not a test chasing
  // the source. `compatibilityErrors()` now refuses the walk-back by name, so this literal
  // and the contract can no longer disagree in the weakening direction.
  assert.equal(tool.resultStability, "stable");
  assert.deepEqual(tool.inputSchema.required, ["collectionId", "modeId", "confirm"]);
  // The literal is what makes a truthy value fail at the transport rather than at the
  // handler's second line of defence.
  assert.equal(tool.inputSchema.properties.confirm.const, true);
  assert.equal(tool.inputSchema.properties.confirm.type, "boolean");
  assert.match(tool.description, /default mode/i);
  assert.match(tool.description, /sole remaining mode/i);
  assert.match(tool.description, /removal_unconfirmed/);
});
