import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = path.join(ROOT, "src/talk_to_figma_mcp/server.ts");
const PLUGIN_PATH = path.join(ROOT, "src/cursor_mcp_plugin/code.js");
const PLUGIN_UI_PATH = path.join(ROOT, "src/cursor_mcp_plugin/ui.html");
const PLUGIN_MANIFEST_PATH = path.join(
  ROOT,
  "src/cursor_mcp_plugin/manifest.json",
);
const PACKAGE_PATH = path.join(ROOT, "package.json");
const RELEASE_PATH = path.join(ROOT, "runtime/release.json");

export const SNAPSHOT_PATH = path.join(ROOT, "contracts/public-contract.json");
export const SERVER_RUNTIME_PATH = path.join(
  ROOT,
  "src/talk_to_figma_mcp/runtime-metadata.ts",
);

export const PLUGIN_RUNTIME_START =
  "// talk-to-figma-runtime-metadata:start";
export const PLUGIN_RUNTIME_END = "// talk-to-figma-runtime-metadata:end";

export const CONNECTION_COMMANDS = ["join"];
export const PLUGIN_UI_MESSAGES = [
  "update-settings",
  "notify",
  "close-plugin",
  "execute-command",
];

const HEAVY_READ_TOOLS = new Set([
  "get_document_info",
  "get_pages",
  "get_styles",
  "get_local_components",
]);

const ADDITIVE_PREVIEW_RESULTS = new Set([
  "get_document_info",
  "get_pages",
  "set_current_page",
  "get_styles",
  "get_local_components",
  "get_variables",
  "get_node_variables",
  "get_reactions",
]);

const LEGACY_RESULTS = new Set(["read_my_design", "export_node_as_image"]);

const READ_TOOLS = new Set([
  "get_document_info",
  "get_pages",
  "set_current_page",
  "get_selection",
  "read_my_design",
  "get_node_info",
  "get_nodes_info",
  "get_annotations",
  "get_reactions",
  "scan_text_nodes",
  "scan_nodes_by_types",
  "get_styles",
  "get_local_components",
  "get_variables",
  "get_node_variables",
  "get_instance_overrides",
  "export_node_as_image",
]);

const TOOL_SCOPES = {
  get_runtime_info: "connection",
  join_channel: "connection",
  get_document_info: "current_page_with_document_page_index",
  get_pages: "document",
  set_current_page: "session_navigation",
  get_selection: "current_page_selection",
  read_my_design: "current_page_selection",
  get_node_info: "node_subtree",
  get_nodes_info: "requested_node_subtrees",
  get_annotations: "document_or_node_subtree",
  get_reactions: "requested_node_subtrees",
  scan_text_nodes: "node_subtree",
  scan_nodes_by_types: "node_subtree",
  get_styles: "document",
  get_local_components: "document_or_selected_pages",
  get_variables: "document",
  get_node_variables: "node_subtree",
  get_instance_overrides: "node_or_current_page_selection",
  export_node_as_image: "node",
  create_rectangle: "current_page_or_parent",
  create_frame: "current_page_or_parent",
  create_section: "current_page",
  create_text: "current_page_or_parent",
  create_component_instance: "current_page_or_parent",
  create_connections: "current_page",
  set_default_connector: "plugin_session",
  set_focus: "current_page_ui",
  set_selections: "current_page_ui",
  delete_multiple_nodes: "requested_nodes",
  set_multiple_text_contents: "node_subtree",
  set_multiple_annotations: "node_subtree",
};

const SPECIAL_PROGRESS = {
  get_pages: "conditional_per_page",
  get_styles: "per_resource_with_heartbeat",
  get_local_components: "per_page_with_heartbeat",
  get_variables: "per_type_with_heartbeat",
  get_node_variables: "per_100_nodes_with_heartbeat",
  get_reactions: "per_requested_root",
  get_annotations: "operation_specific",
  scan_text_nodes: "chunked",
  scan_nodes_by_types: "chunked",
  set_multiple_text_contents: "chunked",
  set_multiple_annotations: "chunked",
  delete_multiple_nodes: "chunked",
  create_connections: "chunked",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function literalText(node) {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }
  throw new Error(`Expected a string literal, got ${ts.SyntaxKind[node.kind]}`);
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function readTypeSurface(sourceFile, aliasName) {
  const alias = sourceFile.statements.find(
    (statement) =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === aliasName,
  );
  if (!alias) {
    throw new Error(`Missing type alias ${aliasName}`);
  }

  if (ts.isUnionTypeNode(alias.type)) {
    return alias.type.types.map((typeNode) => literalText(typeNode.literal));
  }
  if (ts.isTypeLiteralNode(alias.type)) {
    return alias.type.members.map((member) => {
      if (!member.name) {
        throw new Error(`${aliasName} has an unnamed member`);
      }
      return member.name.text;
    });
  }
  throw new Error(`${aliasName} must be a union or type literal`);
}

function evaluateToolSchema(schemaNode, sourceFile) {
  const shapeSource = schemaNode.getText(sourceFile);
  const shape = Function("z", `"use strict"; return (${shapeSource});`)(z);
  const jsonSchema = zodToJsonSchema(z.object(shape), {
    $refStrategy: "none",
  });
  delete jsonSchema.$schema;
  return jsonSchema;
}

function getDirection(name, kind) {
  if (kind === "prompt") return "read";
  if (name === "join_channel" || name === "get_runtime_info") {
    return "connection";
  }
  return READ_TOOLS.has(name) ? "read" : "write";
}

function getResultStability(name, kind) {
  if (kind === "prompt") return "stable";
  if (LEGACY_RESULTS.has(name)) return "legacy";
  if (ADDITIVE_PREVIEW_RESULTS.has(name)) return "additive-preview";
  return "stable";
}

function getPluginCommand(name, kind) {
  if (kind === "prompt") return null;
  if (name === "join_channel") return "join";
  return name;
}

function getProgress(name, kind, pluginCommand) {
  if (kind === "prompt" || name === "join_channel" || name === "get_runtime_info") {
    return { relayHeartbeatSeconds: null, pluginUpdates: "none" };
  }
  return {
    relayHeartbeatSeconds: 15,
    pluginUpdates: SPECIAL_PROGRESS[pluginCommand] || "none",
  };
}

function extractRegistrations(sourceFile) {
  const registrations = [];
  visit(sourceFile, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.expression.getText(sourceFile) !== "server" ||
      !["tool", "prompt"].includes(node.expression.name.text)
    ) {
      return;
    }

    const kind = node.expression.name.text;
    const name = literalText(node.arguments[0]);
    const description = literalText(node.arguments[1]);
    const inputSchema =
      kind === "tool"
        ? evaluateToolSchema(node.arguments[2], sourceFile)
        : {
            type: "object",
            properties: {},
            additionalProperties: false,
          };
    const pluginCommand = getPluginCommand(name, kind);

    registrations.push({
      kind,
      name,
      description,
      direction: getDirection(name, kind),
      scope: kind === "prompt" ? "server_static" : TOOL_SCOPES[name] || "node",
      inputSchema,
      timeoutClass:
        kind === "prompt"
          ? "local"
          : name === "get_runtime_info"
            ? "preflight"
            : HEAVY_READ_TOOLS.has(name)
              ? "heavy_read"
              : "standard",
      progress: getProgress(name, kind, pluginCommand),
      pluginCommand,
      resultStability: getResultStability(name, kind),
    });
  });
  return registrations.sort((left, right) => left.name.localeCompare(right.name));
}

function extractPluginCommands(pluginSource) {
  const sourceFile = ts.createSourceFile(
    PLUGIN_PATH,
    pluginSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let handler = null;
  visit(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "handleCommand") {
      handler = node;
    }
  });
  if (!handler) throw new Error("Missing plugin handleCommand function");

  const commands = [];
  visit(handler, (node) => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) {
      commands.push(node.expression.text);
    }
  });
  return commands;
}

function extractPluginUiMessages(pluginSource) {
  const beforeHandler = pluginSource.split("async function handleCommand", 1)[0];
  return [...beforeHandler.matchAll(/case\s+"([^"]+)"\s*:/g)].map(
    (match) => match[1],
  );
}

function stripPluginRuntimeMetadata(pluginSource) {
  const start = pluginSource.indexOf(PLUGIN_RUNTIME_START);
  const end = pluginSource.indexOf(PLUGIN_RUNTIME_END);
  if (start === -1 || end === -1 || end < start) return pluginSource;
  return (
    pluginSource.slice(0, start) +
    pluginSource.slice(end + PLUGIN_RUNTIME_END.length)
  );
}

export function parityErrors(surface) {
  const errors = [];
  const unionCommands = new Set(surface.figmaCommands);
  const paramCommands = new Set(surface.commandParams);
  const pluginCommands = new Set(surface.pluginCommands);
  const toolCommands = new Set(
    surface.registrations
      .filter((entry) => entry.kind === "tool")
      .map((entry) => entry.pluginCommand),
  );
  const connectionCommands = new Set(CONNECTION_COMMANDS);

  for (const command of unionCommands) {
    if (!paramCommands.has(command)) {
      errors.push(`FigmaCommand ${command} has no CommandParams entry`);
    }
    if (!connectionCommands.has(command) && !pluginCommands.has(command)) {
      errors.push(`FigmaCommand ${command} has no plugin dispatcher case`);
    }
    if (!toolCommands.has(command)) {
      errors.push(`FigmaCommand ${command} has no registered MCP tool`);
    }
  }
  for (const command of paramCommands) {
    if (!unionCommands.has(command)) {
      errors.push(`CommandParams ${command} is not in FigmaCommand`);
    }
  }
  for (const command of pluginCommands) {
    if (!unionCommands.has(command)) {
      errors.push(`Plugin command ${command} has no server command schema`);
    }
  }
  for (const command of toolCommands) {
    if (command && !unionCommands.has(command)) {
      errors.push(`MCP tool maps to unknown plugin command ${command}`);
    }
  }

  const expectedUi = new Set(PLUGIN_UI_MESSAGES);
  const actualUi = new Set(surface.pluginUiMessages);
  for (const message of expectedUi) {
    if (!actualUi.has(message)) {
      errors.push(`Expected plugin UI message ${message} is missing`);
    }
  }
  for (const message of actualUi) {
    if (!expectedUi.has(message)) {
      errors.push(`Plugin UI message ${message} is not explicitly allowlisted`);
    }
  }
  return errors;
}

export async function buildContract() {
  const [
    serverSource,
    pluginSource,
    pluginUiSource,
    pluginManifestSource,
    packageJsonText,
    releaseJsonText,
  ] =
    await Promise.all([
      readFile(SERVER_PATH, "utf8"),
      readFile(PLUGIN_PATH, "utf8"),
      readFile(PLUGIN_UI_PATH, "utf8"),
      readFile(PLUGIN_MANIFEST_PATH, "utf8"),
      readFile(PACKAGE_PATH, "utf8"),
      readFile(RELEASE_PATH, "utf8"),
    ]);
  const packageJson = JSON.parse(packageJsonText);
  const release = JSON.parse(releaseJsonText);
  const serverSourceFile = ts.createSourceFile(
    SERVER_PATH,
    serverSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const registrations = extractRegistrations(serverSourceFile);
  const figmaCommands = readTypeSurface(serverSourceFile, "FigmaCommand");
  const commandParams = readTypeSurface(serverSourceFile, "CommandParams");
  const pluginCommands = extractPluginCommands(pluginSource);
  const pluginUiMessages = extractPluginUiMessages(pluginSource);
  const capabilityIds = pluginCommands
    .map((command) => `figma.command.${command}@1`)
    .concat([`relay.channel@${release.relayProtocolVersion}`])
    .sort();
  const capabilityFingerprint = `sha256:${sha256(
    canonicalJson({
      serverSchemaVersion: release.serverSchemaVersion,
      capabilityIds,
    }),
  )}`;
  const contractPayload = {
    release: release.release,
    publicContractVersion: release.publicContractVersion,
    serverSchemaVersion: release.serverSchemaVersion,
    packageVersion: packageJson.version,
    relayProtocolVersion: release.relayProtocolVersion,
    capabilityFingerprint,
    capabilities: capabilityIds,
    connectionPlumbing: {
      relayCommands: CONNECTION_COMMANDS,
      pluginUiMessages: PLUGIN_UI_MESSAGES,
    },
    commands: {
      figmaCommand: figmaCommands,
      commandParams,
      pluginDispatcher: pluginCommands,
    },
    tools: registrations.filter((entry) => entry.kind === "tool"),
    prompts: registrations.filter((entry) => entry.kind === "prompt"),
  };

  return {
    contract: contractPayload,
    surface: {
      registrations,
      figmaCommands,
      commandParams,
      pluginCommands,
      pluginUiMessages,
    },
    sources: { serverSource, pluginSource },
    release,
    runtime: {
      packageVersion: packageJson.version,
      release: release.release,
      serverBuildId: `${release.release.toLowerCase()}-server-${sha256(
        serverSource + canonicalJson(contractPayload),
      ).slice(0, 12)}`,
      pluginBuildId: `${release.release.toLowerCase()}-plugin-${sha256(
        stripPluginRuntimeMetadata(pluginSource) +
          pluginUiSource +
          pluginManifestSource,
      ).slice(0, 12)}`,
      serverSchemaVersion: release.serverSchemaVersion,
      pluginApiVersion: release.pluginApiVersion,
      relayProtocolVersion: release.relayProtocolVersion,
      capabilityFingerprint,
      supportedCommands: pluginCommands,
      capabilityIds,
      supportedTools: contractPayload.tools.map((tool) => tool.name),
      supportedPrompts: contractPayload.prompts.map((prompt) => prompt.name),
    },
  };
}

function compareSchema(previous, current, location, errors) {
  if (!previous || !current) {
    if (previous && !current) errors.push(`${location} was removed`);
    return;
  }

  const previousTypes = new Set(
    Array.isArray(previous.type) ? previous.type : [previous.type].filter(Boolean),
  );
  const currentTypes = new Set(
    Array.isArray(current.type) ? current.type : [current.type].filter(Boolean),
  );
  for (const type of previousTypes) {
    if (!currentTypes.has(type)) {
      errors.push(`${location} no longer accepts type ${type}`);
    }
  }

  if (previous.enum) {
    const values = new Set(current.enum || []);
    for (const value of previous.enum) {
      if (!values.has(value)) {
        errors.push(`${location} removed enum value ${JSON.stringify(value)}`);
      }
    }
  }

  for (const key of ["minimum", "minLength", "minItems"]) {
    if (
      previous[key] !== undefined &&
      current[key] !== undefined &&
      current[key] > previous[key]
    ) {
      errors.push(`${location} tightened ${key}`);
    }
  }
  for (const key of ["maximum", "maxLength", "maxItems"]) {
    if (
      previous[key] !== undefined &&
      current[key] !== undefined &&
      current[key] < previous[key]
    ) {
      errors.push(`${location} tightened ${key}`);
    }
  }

  if (
    Object.hasOwn(previous, "default") &&
    canonicalJson(previous.default) !== canonicalJson(current.default)
  ) {
    errors.push(`${location} changed its default`);
  }

  const previousRequired = new Set(previous.required || []);
  const currentRequired = new Set(current.required || []);
  for (const name of currentRequired) {
    if (!previousRequired.has(name)) {
      errors.push(`${location}.${name} became newly required`);
    }
  }

  for (const [name, schema] of Object.entries(previous.properties || {})) {
    if (!current.properties || !Object.hasOwn(current.properties, name)) {
      errors.push(`${location}.${name} was removed`);
      continue;
    }
    compareSchema(schema, current.properties[name], `${location}.${name}`, errors);
  }
  if (previous.items) {
    compareSchema(previous.items, current.items, `${location}[]`, errors);
  }
}

export function compatibilityErrors(previous, current) {
  const errors = [];
  for (const collectionName of ["tools", "prompts"]) {
    const currentByName = new Map(
      current[collectionName].map((entry) => [entry.name, entry]),
    );
    for (const previousEntry of previous[collectionName]) {
      const currentEntry = currentByName.get(previousEntry.name);
      if (!currentEntry) {
        errors.push(`${collectionName}.${previousEntry.name} was removed`);
        continue;
      }
      for (const field of [
        "kind",
        "direction",
        "scope",
        "timeoutClass",
        "pluginCommand",
        "resultStability",
      ]) {
        if (previousEntry[field] !== currentEntry[field]) {
          errors.push(
            `${collectionName}.${previousEntry.name}.${field} changed from ${JSON.stringify(
              previousEntry[field],
            )} to ${JSON.stringify(currentEntry[field])}`,
          );
        }
      }
      compareSchema(
        previousEntry.inputSchema,
        currentEntry.inputSchema,
        `${collectionName}.${previousEntry.name}.input`,
        errors,
      );
    }
  }
  return errors;
}

export function renderServerRuntime(runtime) {
  return `// Generated by scripts/generate-contract.mjs. Do not edit by hand.\nexport const RUNTIME_METADATA = ${JSON.stringify(
    runtime,
    null,
    2,
  )} as const;\n`;
}

export function renderPluginRuntime(runtime) {
  const pluginRuntime = {
    name: "Talk to Figma (fork) plugin",
    release: runtime.release,
    buildId: runtime.pluginBuildId,
    apiVersion: runtime.pluginApiVersion,
    serverSchemaVersion: runtime.serverSchemaVersion,
    relayProtocolVersion: runtime.relayProtocolVersion,
    capabilityFingerprint: runtime.capabilityFingerprint,
    supportedCommands: runtime.supportedCommands,
    capabilityIds: runtime.capabilityIds,
  };
  return `${PLUGIN_RUNTIME_START}\nconst PLUGIN_RUNTIME_METADATA = Object.freeze(${JSON.stringify(
    pluginRuntime,
    null,
    2,
  )});\n${PLUGIN_RUNTIME_END}`;
}

export function withPluginRuntime(pluginSource, renderedMetadata) {
  const start = pluginSource.indexOf(PLUGIN_RUNTIME_START);
  const end = pluginSource.indexOf(PLUGIN_RUNTIME_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Plugin runtime markers are missing (${PLUGIN_RUNTIME_START} / ${PLUGIN_RUNTIME_END})`,
    );
  }
  return (
    pluginSource.slice(0, start) +
    renderedMetadata +
    pluginSource.slice(end + PLUGIN_RUNTIME_END.length)
  );
}

export function renderSnapshot(contract) {
  return `${JSON.stringify(contract, null, 2)}\n`;
}

export { ROOT, PLUGIN_PATH };
