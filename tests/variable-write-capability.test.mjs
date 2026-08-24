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
