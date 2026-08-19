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
  // Added in R2. Both scale their cost with the file rather than the arguments:
  // an export with the pixel area of the node, a token scan with the subtree size.
  "export_node_as_image",
  "get_node_variables",
  // Added in R2.5. Its cost scales with the MACHINE running Figma — thousands of
  // installed faces — which is neither the file nor the arguments, but is the same
  // reason get_document_info is here: the caller cannot bound it from outside.
  // ⛔ check_fonts is deliberately NOT here. Its cost scales with the caller's own
  // capped pair list, and the comment on TIMEOUT_RANK says reusing heavy_read for an
  // argument-scaled tool makes the contract lie about why the budget is large. It
  // ships `standard`, which is the weakest claim that can be true; raising a budget
  // after a live gate is the safe direction, lowering one is breaking.
  "get_available_fonts",
]);

// Ordered by budget, weakest -> strongest. Raising a tool's budget cannot break a
// consumer that was already prepared to wait less; lowering one can, because a call
// that used to finish starts timing out. So this is compared as a ladder, like
// resultStability — not as equality.
//
// `heavy_batch` is R2.4's. `heavy_read` is documented as "cost scales with the file
// rather than the arguments"; a batch scales with its arguments, so reusing that label
// would make the contract lie about why the budget is large.
// ⚠️ Adding a rank is safe for baseline replay ONLY because no existing tool changes
// class: the ladder check errors on an unknown value found in a PREVIOUS baseline, and a
// brand-new tool has no previous entry to compare against.
const TIMEOUT_RANK = {
  local: 0,
  preflight: 1,
  standard: 2,
  heavy_read: 3,
  heavy_batch: 4,
};

// Tools whose budget scales with the number of operations the caller submitted. Unlike a
// heavy read, the caller controls this cost directly, and declares its own ceiling with
// timeBudgetMs.
const HEAVY_BATCH_TOOLS = new Set(["apply_batch"]);

const ADDITIVE_PREVIEW_RESULTS = new Set([
  "get_document_info",
  "get_pages",
  "set_current_page",
  "get_styles",
  "get_local_components",
  "get_variables",
  "get_node_variables",
  "get_reactions",
  // Promoted from legacy in R1: the reply now carries a typed receipt identifying the
  // export, so a consumer no longer has to attribute it from its own request.
  "export_node_as_image",
  // R2.5 Phase 2, per CC1 of R2-TYPOGRAPHY-LAYOUT-VISUAL-PLAN.md. Listed in the SAME
  // change that registers them: getResultStability falls through to `stable`, and
  // compatibilityErrors() refuses to weaken a level, so an unlisted new tool is frozen
  // on the day it ships without ever having faced a live gate. Promotion is an
  // acceptance act — these two stay here until R2.5's live gate has earned it.
  "get_available_fonts",
  "check_fonts",
  // R2.5 Phase 3, same rule, same commit. `set_text_style` is a twelve-field write whose
  // reply shape is expected to grow — R2.6 adds the child-layout tools that share its
  // textAutoResize/layoutSizing boundary — so freezing it before a live gate has run
  // would be freezing a shape nobody has exercised.
  "set_text_style",
]);

// ⭐ `apply_batch` was here until R2.4 acceptance (2026-08-18), held at
// `additive-preview` on the stated condition that it had never run against a real Figma
// file. It has now passed three live gates — 5.5 (2026-08-12), 5.6 (2026-08-18) and the
// 4.1 re-run on the new server build — so the promise is promoted to `stable` and the
// entry is gone rather than commented out, because `getResultStability` falls through to
// `stable` and a leftover entry would silently hold it back.
//
// ⛔ `stable` means frozen: from here a change to the receipt shape needs a new
// `publicContractVersion`, not just a rebuild. Strengthening was allowed; the walk-back
// is not, and `compatibilityErrors()` rejects it by name.

const LEGACY_RESULTS = new Set(["read_my_design"]);

// Ordered weakest -> strongest. A release may strengthen a tool's promise; weakening it
// is a breaking change that requires a new contract version and a migration note.
const STABILITY_RANK = {
  legacy: 0,
  "additive-preview": 1,
  stable: 2,
};

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
  "get_plugin_data",
  // check_fonts calls loadFontAsync, which mutates the PLUGIN SESSION's font cache and
  // nothing in the document. Direction is about the file, so both are reads.
  "get_available_fonts",
  "check_fonts",
]);

const TOOL_SCOPES = {
  get_runtime_info: "connection",
  join_channel: "connection",
  get_document_info: "current_page_with_document_page_index",
  get_pages: "document",
  set_current_page: "session_navigation",
  create_page: "document",
  get_plugin_data: "node",
  set_plugin_data: "node",
  apply_batch: "requested_nodes",
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
  // Neither reads the document at all — the subject is the machine running Figma.
  // ⛔ The fallback below is "node", which would have been wrong and silent.
  get_available_fonts: "font_inventory",
  check_fonts: "font_inventory",
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
  // Written out rather than left to the "node" fallback. The value is the same either
  // way, so this costs nothing — but the fallback is what made get_available_fonts
  // silently wrong in Phase 2, and a write tool is the wrong place to rely on it.
  set_text_style: "node",
};

const SPECIAL_PROGRESS = {
  export_node_as_image: "preflight_and_encoding",
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
  // R2.4 3.1. Moved off the default "none" in the SAME change that added the chunking, so
  // this map never describes behaviour the runtime does not have — which is Finding 4.
  // `tests/progress-declaration.test.mjs` now asserts every entry here against code.js.
  apply_batch: "chunked",
  // R2.5 Phase 2. Declared in the same change that emits it, per CC2.
  // ⛔ get_available_fonts is deliberately absent: it is one un-cancellable await plus
  // an in-memory sort, with no point between them to report from. Declaring progress
  // there would mint Finding 4 a third time.
  check_fonts: "per_font",
  // ⛔ set_text_style is deliberately absent, per CC2 and for the same reason as
  // get_available_fonts. It touches ONE node: a short validation pass, at most a
  // handful of font loads, then a synchronous write loop. There is no point between
  // them worth reporting from, and declaring progress a tool does not emit is
  // Finding 4 — which this release has already declined to mint twice.
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
            : HEAVY_BATCH_TOOLS.has(name)
              ? "heavy_batch"
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
        "pluginCommand",
      ]) {
        if (previousEntry[field] !== currentEntry[field]) {
          errors.push(
            `${collectionName}.${previousEntry.name}.${field} changed from ${JSON.stringify(
              previousEntry[field],
            )} to ${JSON.stringify(currentEntry[field])}`,
          );
        }
      }

      const previousTimeout = TIMEOUT_RANK[previousEntry.timeoutClass];
      const currentTimeout = TIMEOUT_RANK[currentEntry.timeoutClass];
      if (previousTimeout === undefined || currentTimeout === undefined) {
        errors.push(
          `${collectionName}.${previousEntry.name}.timeoutClass has an unknown value (${JSON.stringify(
            previousEntry.timeoutClass,
          )} -> ${JSON.stringify(currentEntry.timeoutClass)})`,
        );
      } else if (currentTimeout < previousTimeout) {
        errors.push(
          `${collectionName}.${previousEntry.name}.timeoutClass was lowered from ${JSON.stringify(
            previousEntry.timeoutClass,
          )} to ${JSON.stringify(currentEntry.timeoutClass)}`,
        );
      }

      // Result stability is a ladder, not an equality check. Strengthening the promise
      // a consumer may rely on cannot break that consumer; weakening it can.
      const previousRank = STABILITY_RANK[previousEntry.resultStability];
      const currentRank = STABILITY_RANK[currentEntry.resultStability];
      if (previousRank === undefined || currentRank === undefined) {
        errors.push(
          `${collectionName}.${previousEntry.name}.resultStability has an unknown value (${JSON.stringify(
            previousEntry.resultStability,
          )} -> ${JSON.stringify(currentEntry.resultStability)})`,
        );
      } else if (currentRank < previousRank) {
        errors.push(
          `${collectionName}.${previousEntry.name}.resultStability was weakened from ${JSON.stringify(
            previousEntry.resultStability,
          )} to ${JSON.stringify(currentEntry.resultStability)}`,
        );
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
