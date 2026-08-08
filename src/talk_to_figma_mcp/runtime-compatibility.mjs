export function comparePluginRuntimeMetadata(
  expected,
  plugin,
  checkedAt = new Date().toISOString(),
) {
  const actual = plugin && typeof plugin === "object" ? plugin : {};
  const issues = [];
  if (actual.buildId !== expected.pluginBuildId) {
    issues.push(
      `Plugin build mismatch: expected ${expected.pluginBuildId}, received ${actual.buildId || "missing"}.`,
    );
  }
  if (actual.apiVersion !== expected.pluginApiVersion) {
    issues.push(
      `Plugin API mismatch: expected ${expected.pluginApiVersion}, received ${actual.apiVersion || "missing"}.`,
    );
  }
  if (actual.serverSchemaVersion !== expected.serverSchemaVersion) {
    issues.push(
      `Server schema mismatch: expected ${expected.serverSchemaVersion}, received ${actual.serverSchemaVersion || "missing"}.`,
    );
  }
  if (actual.relayProtocolVersion !== expected.relayProtocolVersion) {
    issues.push(
      `Relay protocol mismatch: expected ${expected.relayProtocolVersion}, received ${actual.relayProtocolVersion || "missing"}.`,
    );
  }
  if (actual.capabilityFingerprint !== expected.capabilityFingerprint) {
    issues.push(
      `Capability fingerprint mismatch: expected ${expected.capabilityFingerprint}, received ${actual.capabilityFingerprint || "missing"}.`,
    );
  }

  const expectedCommands = new Set(expected.supportedCommands);
  const actualCommands = new Set(
    Array.isArray(actual.supportedCommands) ? actual.supportedCommands : [],
  );
  const missingCommands = [...expectedCommands].filter(
    (command) => !actualCommands.has(command),
  );
  const unexpectedCommands = [...actualCommands].filter(
    (command) => !expectedCommands.has(command),
  );
  if (missingCommands.length > 0) {
    issues.push(`Plugin is missing commands: ${missingCommands.join(", ")}.`);
  }
  if (unexpectedCommands.length > 0) {
    issues.push(`Plugin exposes unexpected commands: ${unexpectedCommands.join(", ")}.`);
  }

  return {
    status: issues.length === 0 ? "compatible" : "incompatible",
    checkedAt,
    issues,
    plugin: actual,
  };
}
