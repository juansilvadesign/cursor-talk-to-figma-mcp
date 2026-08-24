import assert from "node:assert/strict";
import test from "node:test";

import { loadPluginHarness } from "./helpers/plugin-harness.mjs";

test("R3-A 1.1 — variable writes require every Plugin API write entry point", async () => {
  const harness = await loadPluginHarness();
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
