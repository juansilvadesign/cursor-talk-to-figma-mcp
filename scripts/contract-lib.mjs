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
  // R3-A's collection-cleanup addendum is new and destructive. Its observation block
  // deliberately has room to grow after Figma is measured live, so it must not fall through
  // to stable before the dedicated gate judges it.
  "delete_variable_collection",
  "get_document_info",
  "get_pages",
  "set_current_page",
  "get_styles",
  "get_local_components",
  "get_variables",
  // ✅ R3-A Phase 2's remaining table — `create_variable_collection`,
  // `rename_variable_mode`, `set_variable_metadata`, `bind_variable_to_node`,
  // `bind_variable_to_paint` — was PROMOTED out of this set on 2026-08-25, after the
  // 18-gate live pass on channel `4k1jsjpo` judged all five and
  // `r3-a-public-contract.json` froze the `1.15.0` build that passed. They shipped
  // `additive-preview` for exactly one release, which is the point: the level exists to let
  // an `observation` block grow a field on its first live run, and all five did their
  // growing there. ⭐ Two of those growths were REFUSALS OF FICTION the offline suite had
  // asserted — Figma reorders `scopes` (it is a SET, so membership is the only correct
  // comparison) and Figma ACCEPTS duplicate mode names (the invented throw was deleted and
  // `nameCollidesWithModeIds` became a reading). A third was a dead read path in the GATE,
  // not the tool. ⛔ From here their receipts are frozen: a new field is a new
  // `publicContractVersion` and weakening the level is breaking.
  "get_node_variables",
  "get_reactions",
  // Promoted from legacy in R1: the reply now carries a typed receipt identifying the
  // export, so a consumer no longer has to attribute it from its own request.
  "export_node_as_image",
]);

// ⭐ `get_variable_capabilities` was here until 2026-08-25, the LAST R3-A tool at
// `additive-preview`. Its held-back note named two conditions, "a stable ceiling and a
// gate", and only one of those was ever payable:
//
//   ✅ THE GATE IS PAID. `scripts/live-variable-capabilities-gate.mjs` PASSED TWICE on
//      channel `jiydnb12`, byte-identical modulo timestamps and the per-run mode id, and
//      its refusal leg was proved to fire first (a throwaway copy pinned to
//      `r3-a-plugin-000000000000` exited 1 at `assertRuntime`, having reached only
//      `publishedSchema` and created nothing).
//
//   ⛔ THE "STABLE CEILING" CONDITION WAS UNPAYABLE, AND THE NOTE MISREAD ITS OWN TOOL.
//      `modeCeiling.value` is a hardcoded `null` on EVERY return path of
//      `getVariableCapabilities()` — `unknownModeCeiling()`, twice. This tool has never
//      reported a ceiling and cannot. The "both acceptance runs observed the ceiling at 10"
//      line in `docs/R3-A-VARIABLE-WRITE.md` credits it with `add_variable_mode`'s refusal
//      evidence, which is a different tool answering a different question. What
//      `additive-preview` was actually protecting is the freedom to START populating that
//      field if Figma ever ships a mode-limit API — and no live run can earn that, because
//      it depends on Figma, not on this fork. The condition was retired as unpayable rather
//      than declared met.
//
// ⛔ THE PRICE, ACCEPTED KNOWINGLY: the ladder is one-way. `compatibilityErrors()` rejects
// `stable` → `additive-preview` by name, so if Figma later exposes the numeric mode limit,
// populating `modeCeiling.value` is a `publicContractVersion` event with no walk-back.
// Same for `remoteCollectionInventoryAvailable` if a remote inventory ever lands.
//
// ⭐ WHAT THE GATE ACTUALLY PROVES, and why it is not the usual receipt-shape check: most of
// this receipt is CONSTANT — `modeCeiling.value`, `remoteCollectionInventoryAvailable`,
// `document.permissionVerified` are literals on every path, so asserting them is green for
// every possible document and discriminates nothing. The gate records them under
// `declaredLimitations`, explicitly NOT as evidence, and earns its verdict from a
// DIFFERENTIAL instead: it predicts the inventory BEFORE driving one real mode-count change
// through `add_variable_mode`, then requires this tool's next read to match the prediction.
// On `jiydnb12` that moved "7. Grids" 4 → 5 modes and `modeCeiling.knownGoodAtLeast` 4 → 5,
// agreeing across three independent derivations, with every other collection byte-identical;
// `remove_variable_mode` then restored the file and a cross-frame re-read confirmed the
// inventory returned canonically to baseline. A stale, cached or fabricated inventory fails
// that; nothing else in the receipt could have.
//
// ⛔ Its entry is GONE rather than commented out — `getResultStability` falls through to
// `stable`, so a leftover name silently holds a tool back at the weaker level.

// ⭐ R3-A's five variable WRITES — `add_variable_mode`, `set_variable_value`,
// `create_variable`, `delete_variable` and `remove_variable_mode` — were here until the
// R3-A promotion (2026-08-25), held at `additive-preview` on the stated condition that
// their receipts had never been judged by real Figma. All five earned it, each on an
// owner-confirmed disposable file: `add_variable_mode` at Phase 1.3, `set_variable_value` /
// `create_variable` / `delete_variable` at Phase 2 acceptance on `hxpwe1ej` (PASSED TWICE),
// identity on `6a07fm2h`, and `remove_variable_mode` at Phase 4 on `yizlybxy` (PASSED
// TWICE). The entries are GONE rather than commented out — `getResultStability` falls
// through to `stable`, so a leftover entry silently holds a tool back at the weaker level.
//
// ⛔ This promotion rewrites `contractPayload.tools`, which feeds `serverBuildId`, so every
// pinned live gate re-stales. It is sequenced BEFORE the Phase 2 collections/bindings build
// deliberately: both changes move the build, and paying one re-pin + one live re-run for
// the pair is the whole reason the promotion did not ship on its own.
//
// ⛔ `stable` means frozen, and `delete_variable` / `remove_variable_mode` are the two to
// watch: both publish an `observation` block naming WHICH in-frame signal saw the absence,
// and from here that block cannot grow a new signal without a new `publicContractVersion`.
// `compatibilityErrors()` rejects the walk-back by name.

// R2 acceptance promotes the five R2.7 receipts — `set_fill`, `set_effects`,
// `set_opacity`, `set_blend_mode`, and `create_node_from_svg` — by REMOVING their names
// from the set above. `getResultStability` deliberately falls through to `stable`; leaving
// one name behind would silently make the published promise weaker than the acceptance act.
//
// ⚠️ This source change is not a substitute for a live result. The representative
// component/page fixture (`scripts/r2-acceptance-fixture.mjs`) is built and awaits a live
// channel. The historical gates must be re-pinned and re-run against the promoted server
// before R2 can be called accepted. The promotion changes `contractPayload.tools`, so it
// changes `serverBuildId` even though the plugin build, schema, fingerprint and tool count
// hold; `serverBuildId` is the pin that prevents that exact stale-server mistake.

// ⭐ R2.5's three tools — `get_available_fonts`, `check_fonts` and `set_text_style` —
// were here until R2.5 acceptance (2026-08-19), held at `additive-preview` on the stated
// condition that their reply shapes had never been judged by real Figma. The typography
// live gate earned it: validate-all-then-write held with Figma as the judge (eleven valid
// parameters plus a bad enum LAST → refused, node byte-identical on two independent read
// channels), and refuse-never-substitute held (`fontStyle` still `Bold` after an
// unloadable font, where `setCharacters`'s fallback would have left `Inter/Regular`).
// The entries are GONE rather than commented out — `getResultStability` falls through to
// `stable`, so a leftover entry silently holds a tool back at the weaker level.
//
// ⛔ This promotion rewrites `contractPayload.tools`, which feeds `serverBuildId` — so
// the gate is re-pinned and RE-RUN on the promoted build. Accepting a build the gate has
// never seen is the defect R2.4 spent three phases closing.
//
// ⛔ `stable` means frozen, and `set_text_style` is the one to watch: R2.6 adds the
// child-layout tools that share its textAutoResize/layoutSizing boundary, and from here
// its reply shape cannot grow without a new `publicContractVersion`.
//
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
  "get_variable_capabilities",
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
  get_variable_capabilities: "document",
  // A mode belongs to one collection; the handler resolves that exact ID and never scans
  // the document or manufactures a disposable resource to learn its plan ceiling.
  add_variable_mode: "variable_collection",
  // R3-A Phase 2's three direct writes. A variable value is a distinct resource/mode pair;
  // create changes one existing collection; delete changes one exact variable and carries a
  // destructive confirmation plus a post-remove lookup in its receipt.
  set_variable_value: "variable_mode",
  create_variable: "variable_collection",
  delete_variable: "variable",
  // A destructive collection call is scoped to the one exact collection ID. Its potential
  // variable blast radius is reported from pre-call membership, not hidden by calling the
  // scope "document" or by offering a cascade delete.
  delete_variable_collection: "variable_collection",
  // R3-A Phase 4. The WRITE target is one mode of one collection — a pair, so neither
  // "variable_collection" nor set_variable_value's "variable_mode" names it. ⚠️ Scope
  // describes where a call writes, not how far the consequence reaches: removing a mode
  // discards every variable-in-this-collection's value for it, which the receipt reports
  // as blastRadius rather than by widening the scope to the whole collection.
  remove_variable_mode: "variable_collection_mode",
  // R3-A Phase 2's remaining table. ⛔ `create_variable_collection` is "document", NOT
  // "variable_collection": there is no collection to scope it to until it returns one, and
  // its identity resolver reads EVERY local collection to rule out a duplicate. Naming a
  // narrower scope would claim it only touches a resource the caller already has.
  create_variable_collection: "document",
  // A rename targets one mode of one collection — the same pair as remove_variable_mode,
  // and it reuses that scope for that reason.
  rename_variable_mode: "variable_collection_mode",
  // Name/description/scopes all live ON the variable; nothing about a mode is read.
  set_variable_metadata: "variable",
  // ⚠️ Both bindings write the NODE, not the variable — the variable is the value being
  // pointed at and is not modified. So the scope is the node, as it is for every other
  // node write in this contract, and NOT "variable".
  bind_variable_to_node: "node",
  bind_variable_to_paint: "node",
  get_node_variables: "node_subtree",
  // Neither reads the document at all — the subject is the machine running Figma.
  // ⛔ The fallback below is "node", which would have been wrong and silent.
  get_available_fonts: "font_inventory",
  check_fonts: "font_inventory",
  get_instance_overrides: "node_or_current_page_selection",
  export_node_as_image: "node",
  create_rectangle: "current_page_or_parent",
  create_frame: "current_page_or_parent",
  // R2.7 Phase 2. Same scope as the other creates: it lands on the current page, or inside
  // an explicit parentId. ⚠️ The subtree it creates can be large, but scope describes WHERE
  // a call writes, not how much — createdNodeCount reports the size as a reading.
  create_node_from_svg: "current_page_or_parent",
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
  // R2.6 2.1, same reasoning. ⭐ Worth a second look here because the tool READS its
  // parent to decide whether to refuse — but scope describes what a call can CHANGE,
  // and this one changes exactly one node. The parent read is a precondition, not scope.
  set_layout_child: "node",
  // R2.6 2.2. Same answer, and the parent read is even more clearly a precondition here:
  // this tool reads the parent's layoutMode and the node's own layoutPositioning purely
  // to decide whether to REFUSE. One node changes.
  set_constraints: "node",
  // R2.6 2.4. Written out for the same reason as its three neighbours, and here the
  // fallback would actually have been RIGHT — which is precisely why it is not relied on.
  // ⭐ Worth stating because the answer is not obvious: clipping changes what the node's
  // CHILDREN look like, so "node" reads too narrow at a glance. Scope describes what a
  // call can CHANGE, and no child is touched — the parent stops painting past its own
  // bounds. The children are read for the receipt's geometry, which is a measurement.
  set_clips_content: "node",
  // R2.7 1.1. ⭐ "node" for the same reason `set_clips_content` is, arrived at from the
  // opposite direction: a fill visibly changes what the node PAINTS, which reads wider than
  // the node — but scope describes what a call can CHANGE, and no other node's properties
  // move. ⚠️ The one thing that gives pause is `fillStyleId`: if Figma detaches a bound
  // paint style, the STYLE is a document-level resource. It is still not modified — the
  // node stops pointing at it — so the scope holds, and the receipt reports the detach
  // precisely because it is the part a reader of this line would not expect.
  set_fill: "node",
  // R2.7 1.2. Same scope as set_fill: effects can change how a node renders, but the
  // assignment touches one node only. An effect-style detach changes the node's reference,
  // not the style resource itself, and the receipt makes that secondary reading explicit.
  set_effects: "node",
  // R2.7 1.3. The two BlendMixin writes change exactly one node. Their render can differ
  // because of layers behind it, but scope is what the call changes, not every pixel it
  // influences. Do not infer a wider get_node_info result from this: that stable read
  // surface remains deliberately unchanged after 1.2 spent the release bump.
  set_opacity: "node",
  set_blend_mode: "node",
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
  // ⛔ set_layout_child is deliberately absent for the same reason, and it is the
  // clearest case yet: one parent read, three synchronous property assignments, no
  // await in the write phase at all. A third declined declaration, not an oversight.
  // ⛔ set_constraints is absent on the same grounds and beats it: ONE synchronous
  // assignment. A fourth declined declaration.
  // ⛔ set_fill is deliberately absent, a FIFTH declined declaration — and the first where
  // the tool takes an unbounded-ish array, which is the shape that usually earns "chunked".
  // It does not here: validation is a synchronous pass over at most 16 paints, and the
  // write is ONE assignment with no await anywhere in either phase. There is no point
  // between them to report from, and a tool that declares progress it does not emit is
  // Finding 4. ⚠️ If a future paint type needs an await (an IMAGE paint would, via
  // createImage), this entry changes in the SAME commit that adds the await — per CC2, not
  // afterwards.
  // ⛔ set_effects is deliberately absent, a SIXTH declined declaration. It validates at
  // most 16 in-memory effects and performs one synchronous assignment; there is no await
  // or useful midpoint at which the plugin could truthfully report progress.
  // ⛔ set_opacity and set_blend_mode are deliberately absent too. Each validates one
  // scalar then makes one synchronous property assignment, so there is no truthful
  // intermediate progress state to declare.
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
