#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { RUNTIME_METADATA } from "./runtime-metadata.js";
import { comparePluginRuntimeMetadata } from "./runtime-compatibility.mjs";
import { buildExportReceipt } from "./export-receipt.mjs";
import { textContentsReply, annotationsReply } from "./legacy-batch-reply.mjs";
import { runtimeCompatibilityAfterTimeout } from "./timeout-safety.mjs";

// Define TypeScript interfaces for Figma responses
interface FigmaResponse {
  id: string;
  result?: any;
  error?: string;
}

// Define interface for command progress updates
interface CommandProgressUpdate {
  type: 'command_progress';
  commandId: string;
  commandType: string;
  status: 'started' | 'in_progress' | 'completed' | 'error';
  progress: number;
  totalItems: number;
  processedItems: number;
  currentChunk?: number;
  totalChunks?: number;
  chunkSize?: number;
  message: string;
  payload?: any;
  timestamp: number;
}

// Update the getInstanceOverridesResult interface to match the plugin implementation
interface getInstanceOverridesResult {
  success: boolean;
  message: string;
  sourceInstanceId: string;
  mainComponentId: string;
  overridesCount: number;
}

interface setInstanceOverridesResult {
  success: boolean;
  message: string;
  totalCount?: number;
  results?: Array<{
    success: boolean;
    instanceId: string;
    instanceName: string;
    appliedCount?: number;
    message?: string;
  }>;
}

// Custom logging functions that write to stderr instead of stdout to avoid being captured
const logger = {
  info: (message: string) => process.stderr.write(`[INFO] ${message}\n`),
  debug: (message: string) => process.stderr.write(`[DEBUG] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[WARN] ${message}\n`),
  error: (message: string) => process.stderr.write(`[ERROR] ${message}\n`),
  log: (message: string) => process.stderr.write(`[LOG] ${message}\n`)
};

// Budget for the document-wide / page-wide reads whose cost scales with file size
// rather than with the arguments. The default 30s is sized for a single-node write,
// not for a scan that has to load and walk every page, and `get_document_info` emits
// no progress updates at all — so for that one the initial budget IS the whole budget.
// Matches the "can exceed two minutes" warning already published in the tool
// descriptions. Measured reality on a 4,094-component file is ~5s, so this is
// headroom for cold page loads, not an expected duration.
const HEAVY_READ_TIMEOUT_MS = 120000;

// R2.4. A batch's cost scales with its arguments, not with the file, so it is its own
// timeout class rather than a second meaning for `heavy_read`. These mirror the ceilings
// the plugin enforces in `applyBatch`; the schema below refuses anything above them.
const BATCH_MAX_OPERATIONS = 200;
const BATCH_DEFAULT_TIME_BUDGET_MS = 60000;
const BATCH_MAX_TIME_BUDGET_MS = 240000;
// The transport timeout is derived from the batch's own declared budget plus slack, so
// the plugin's total budget always fires FIRST and the caller gets an honest receipt with
// `complete: false` instead of a transport error that says nothing about what was applied.
// This is Finding 5's fix: the shipped batch tools have only an inactivity timer, which a
// chunked run resets forever, so a 10k-node delete has no ceiling at all.
const BATCH_TIMEOUT_SLACK_MS = 30000;
const HEAVY_BATCH_TIMEOUT_MS =
  BATCH_MAX_TIME_BUDGET_MS + BATCH_TIMEOUT_SLACK_MS;
// R2.4 3.2. The three shipped batch tools pause a hard, unmeasured 1 s between chunks —
// 19 s of pure sleep on a 100-item batch. Here the pause defaults to 0 and is tunable, so
// a caller who actually needs Figma to breathe can ask for it and everyone else does not
// pay for it. The plugin skips the pause once the budget is spent, so the worst case stays
// inside the transport slack above.
const BATCH_DEFAULT_CHUNK_PAUSE_MS = 0;
const BATCH_MAX_CHUNK_PAUSE_MS = 5000;
const BATCH_CHUNK_SIZE = 5;

// WebSocket connection and request tracking
let ws: WebSocket | null = null;
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  command: FigmaCommand;
  timeoutMs: number; // The budget this request was armed with, reused on each reset
  lastActivity: number; // Add timestamp for last activity
}>();

// Track which channel each client is in
let currentChannel: string | null = null;

type RuntimeCompatibility = {
  status: "compatible" | "incompatible" | "not_checked";
  checkedAt: string | null;
  issues: string[];
  plugin: Record<string, any> | null;
};

let runtimeCompatibility: RuntimeCompatibility = {
  status: "not_checked",
  checkedAt: null,
  issues: ["Join a channel to run the server/plugin compatibility preflight."],
  plugin: null,
};

function latchRuntimeAfterTimeout(command: FigmaCommand): void {
  // exportAsync cannot be cancelled when the MCP-side inactivity budget expires.
  // Refuse subsequent document operations until get_runtime_info proves that the
  // plugin has recovered; otherwise the next caller rediscovers the wedge by timeout.
  runtimeCompatibility = runtimeCompatibilityAfterTimeout(
    runtimeCompatibility,
    command,
  ) as RuntimeCompatibility;
}

// Create MCP server
const server = new McpServer({
  name: "TalkToFigmaMCP",
  version: RUNTIME_METADATA.packageVersion,
});

// Add command line argument parsing
const args = process.argv.slice(2);
const serverArg = args.find(arg => arg.startsWith('--server='));
const serverUrl = serverArg ? serverArg.split('=')[1] : 'localhost';
const WS_URL = serverUrl === 'localhost' ? `ws://${serverUrl}` : `wss://${serverUrl}`;
// The relay port was a hardcoded 3055 with no override, which made an offline
// end-to-end test of the MCP wrappers impossible to run beside a live relay: the test
// would have had to bind the one port a real session is already holding. `--server=`
// cannot stand in for it — anything other than the literal `localhost` switches the
// scheme to `wss://` and drops the port entirely.
const portArg = args.find(arg => arg.startsWith('--port='));
const parsedPort = portArg ? Number.parseInt(portArg.split('=')[1], 10) : NaN;
const RELAY_PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536
  ? parsedPort
  : 3055;

function serverRuntimeInfo() {
  return {
    name: "TalkToFigmaMCP",
    packageVersion: RUNTIME_METADATA.packageVersion,
    release: RUNTIME_METADATA.release,
    buildId: RUNTIME_METADATA.serverBuildId,
    schemaVersion: RUNTIME_METADATA.serverSchemaVersion,
    capabilityFingerprint: RUNTIME_METADATA.capabilityFingerprint,
    supportedTools: [...RUNTIME_METADATA.supportedTools],
    supportedPrompts: [...RUNTIME_METADATA.supportedPrompts],
    expectedPlugin: {
      buildId: RUNTIME_METADATA.pluginBuildId,
      apiVersion: RUNTIME_METADATA.pluginApiVersion,
      supportedCommands: [...RUNTIME_METADATA.supportedCommands],
      capabilityIds: [...RUNTIME_METADATA.capabilityIds],
    },
  };
}

function runtimeDiagnosticSuffix(): string {
  const pluginBuild = runtimeCompatibility.plugin?.buildId || "unknown";
  return ` [runtime: server=${RUNTIME_METADATA.serverBuildId}, schema=${RUNTIME_METADATA.serverSchemaVersion}, plugin=${pluginBuild}, compatibility=${runtimeCompatibility.status}]`;
}

function comparePluginRuntime(plugin: Record<string, any>): RuntimeCompatibility {
  return comparePluginRuntimeMetadata(RUNTIME_METADATA, plugin) as RuntimeCompatibility;
}

async function refreshRuntimeCompatibility(): Promise<RuntimeCompatibility> {
  try {
    const plugin = (await sendCommandToFigma(
      "get_runtime_info",
      {},
      5000
    )) as Record<string, any>;
    runtimeCompatibility = comparePluginRuntime(plugin);
    return runtimeCompatibility;
  } catch (error) {
    runtimeCompatibility = {
      status: "incompatible",
      checkedAt: new Date().toISOString(),
      issues: [
        `Plugin runtime probe failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
      plugin: null,
    };
    throw error;
  }
}

function combinedRuntimeInfo() {
  return {
    server: serverRuntimeInfo(),
    plugin: runtimeCompatibility.plugin,
    relay: {
      protocolVersion: RUNTIME_METADATA.relayProtocolVersion,
      transport: "websocket-channel",
    },
    compatibility: {
      status: runtimeCompatibility.status,
      checkedAt: runtimeCompatibility.checkedAt,
      issues: [...runtimeCompatibility.issues],
    },
  };
}

server.tool(
  "get_runtime_info",
  "Report the exact local fork server, plugin, schema, relay protocol, and capability fingerprint. After joining a channel, this also refreshes the compatibility preflight without reading or modifying the Figma document.",
  {},
  async () => {
    if (currentChannel) {
      try {
        await refreshRuntimeCompatibility();
      } catch {
        // The combined payload below carries the explicit incompatibility details.
      }
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(combinedRuntimeInfo()),
        },
      ],
    };
  }
);

// Document Info Tool
server.tool(
  "get_document_info",
  "[Current-page scoped, with a document-wide page index] Get top-level details for the current Figma page plus an honest index of every page in the document. Non-current page child counts are explicitly marked as not requested. The current page's `children` array is ALWAYS bounded by limit/offset — `currentPage.childCount`, `childrenTruncated` and `pagination.hasMore` report the real total, so a truncated list can never be read as the whole page. Summary mode is the default and adds `childTypes` plus bounded `childFamilies` rollups covering every child, not just the returned slice.",
  {
    summary: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Include childTypes and childFamilies rollups describing every child on the page (default: true). Set false for just the paginated children slice."
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .default(100)
      .describe("Maximum current-page children returned (default: 100)"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("Offset into the current page's children"),
    familyLimit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .default(100)
      .describe("Maximum child name families returned in summary mode"),
  },
  async ({ summary, limit, offset, familyLimit }: any) => {
    try {
      const result = await sendCommandToFigma("get_document_info", {
        summary,
        limit,
        offset,
        familyLimit,
      }, HEAVY_READ_TIMEOUT_MS);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting document info: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Pages Tool
server.tool(
  "get_pages",
  "[Document-wide] Enumerate every page in the Figma document. Top-level child counts are opt-in because dynamic-page access must load each page.",
  {
    includeChildCount: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Load every page and include its top-level child count (default: false)"
      ),
  },
  async ({ includeChildCount }: any) => {
    try {
      const result = await sendCommandToFigma("get_pages", {
        includeChildCount,
      }, HEAVY_READ_TIMEOUT_MS);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting pages: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Current Page Tool
server.tool(
  "set_current_page",
  "Switch the active Figma page so subsequent page-scoped reads and writes operate there",
  {
    pageId: z.string().describe("The PAGE node ID returned by get_pages"),
  },
  async ({ pageId }: any) => {
    try {
      const result = await sendCommandToFigma("set_current_page", { pageId });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting current page: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Create Page Tool
server.tool(
  "create_page",
  "[Document scoped] Create a new page in the Figma document. Does not switch the active page - call set_current_page afterwards if you need to work inside it",
  {
    name: z.string().describe("Name for the new page"),
    onDuplicate: z
      .enum(["error", "allow"])
      .optional()
      .describe(
        "What to do when a page with this exact name already exists. 'error' (default) refuses and names the existing page IDs; 'allow' creates another page with the same name, as Figma itself permits"
      ),
    index: z
      .number()
      .int()
      .optional()
      .describe(
        "Optional 0-based position among the document's pages. Defaults to appending last. The reply reports the observed index alongside the requested one"
      ),
  },
  async ({ name, onDuplicate, index }: any) => {
    try {
      const result = await sendCommandToFigma("create_page", {
        name,
        onDuplicate,
        index,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating page: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Plugin Data Tools
server.tool(
  "get_plugin_data",
  "[Node scoped] Read the plugin metadata stored on a node. Omit `namespace` for this plugin's private store, or pass one to read Figma's shared store, which any plugin or the REST API can also read",
  {
    nodeId: z.string().describe("The ID of the node to read metadata from"),
    key: z
      .string()
      .optional()
      .describe("Read a single key. Omit to read every key on the node, bounded by limit/offset"),
    namespace: z
      .string()
      .optional()
      .describe(
        "Shared-plugin-data namespace. Omit to use this plugin's private store, which nothing else can read"
      ),
    limit: z
      .number()
      .int()
      .optional()
      .describe("Maximum number of keys to return (default 100). Ignored when `key` is given"),
    offset: z
      .number()
      .int()
      .optional()
      .describe("0-based key offset for paging (default 0). Ignored when `key` is given"),
    maxValueBytes: z
      .number()
      .int()
      .optional()
      .describe(
        "Truncate any value longer than this many UTF-8 bytes (default 10000). The full length is still reported as `bytes` and the truncation is declared"
      ),
  },
  async ({ nodeId, key, namespace, limit, offset, maxValueBytes }: any) => {
    try {
      const result = await sendCommandToFigma("get_plugin_data", {
        nodeId,
        key,
        namespace,
        limit,
        offset,
        maxValueBytes,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting plugin data: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "set_plugin_data",
  "[Node scoped] Write or remove one plugin metadata entry on a node. Pass `value: null` to remove the key. An empty string is refused, because Figma treats writing \"\" as a removal and it would delete silently. Omit `namespace` for this plugin's private store",
  {
    nodeId: z.string().describe("The ID of the node to write metadata to"),
    key: z.string().describe("The metadata key to write"),
    value: z
      .string()
      .nullable()
      .describe(
        "The value to store as a string, or null to remove the key. Figma stores plugin data as strings; serialize structured data yourself"
      ),
    namespace: z
      .string()
      .optional()
      .describe(
        "Shared-plugin-data namespace. Omit to use this plugin's private store, which nothing else can read"
      ),
  },
  async ({ nodeId, key, value, namespace }: any) => {
    try {
      const result = await sendCommandToFigma("set_plugin_data", {
        nodeId,
        key,
        value,
        namespace,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting plugin data: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Batch Tool (R2.4)
server.tool(
  "apply_batch",
  "[Multi-node scoped] Apply many node mutations in one call, against node IDs that already exist. Every target is resolved in one pass before anything is written, and the resolved scope is reported either way. Creates are not accepted in v1. Returns a typed per-operation receipt correlated by your own `id`, and an `outcome` that cannot report success when nothing succeeded. Refusals for a duplicate `id` or a disallowed `op` are thrown, not returned. Operations are NOT atomic: a failed operation on a multi-field mutation may have partially applied, and says so. Runs in chunks of 5 with progress updates; `timeBudgetMs` is the total ceiling and is enforced regardless",
  {
    operations: z
      .array(
        z.object({
          id: z
            .string()
            .min(1)
            .describe("Your own identifier for this operation. Receipts correlate by it, never by array position, so it must be unique within the batch"),
          op: z
            .enum([
              "delete_node",
              "move_node",
              "rename_node",
              "resize_node",
              "set_axis_align",
              "set_corner_radius",
              "set_fill_color",
              "set_item_spacing",
              "set_layout_mode",
              "set_layout_sizing",
              "set_padding",
              "set_parent",
              "set_plugin_data",
              "set_stroke_color",
              "set_text_content",
            ])
            .describe("The mutation to apply. Only these fifteen node-scoped mutations are accepted; every create_* is excluded because v1 is mutate-only"),
          nodeId: z
            .string()
            .min(1)
            .describe("The existing node to mutate. Lifted out of `params` deliberately: this is the field prevalidation resolves, and it wins over any nodeId inside `params`"),
          params: z
            .record(z.any())
            .optional()
            .describe("The parameters that operation takes, minus nodeId. ⚠️ These go straight to the plugin handler, so for two operations they are NOT the standalone tool's shape: set_fill_color and set_stroke_color take {color:{r,g,b,a}} here (plus weight for the stroke), where the standalone tools take flat r,g,b,a. Everything else matches its tool. This object is not schema-validated, so a wrong shape fails plugin-side and comes back as a failed receipt entry rather than a schema error"),
        })
      )
      .min(1)
      // ⚠️ 200 and 240000 below are inline literals, not BATCH_MAX_OPERATIONS /
      // BATCH_MAX_TIME_BUDGET_MS, and that is forced rather than sloppy: the contract
      // generator extracts this schema by re-evaluating its SOURCE TEXT through
      // Function("z", …), where `z` is the only binding in scope, so any identifier from
      // module scope is a ReferenceError at generation time. A test asserts these
      // literals equal the constants the runtime actually enforces.
      .max(200)
      .describe("The operations to apply, in order"),
    onError: z
      .enum(["stop", "continue"])
      .optional()
      .describe("\"stop\" (default) refuses the whole batch if any target is unresolvable, and halts after the first failure. \"continue\" skips unresolvable targets and runs the rest"),
    prevalidateOnly: z
      .boolean()
      .optional()
      .describe("true runs the resolve pass and returns the report without writing anything — a dry run against the live file. Default false"),
    timeBudgetMs: z
      .number()
      .int()
      .min(1000)
      .max(240000)
      .optional()
      .describe("Total wall clock for the whole batch, not per operation (default 60000). On exhaustion the remaining operations are skipped and `complete` is false"),
    maxResultBytes: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Truncate each operation's result above this many UTF-8 bytes (default 2000). The true size is still reported as `resultBytes`"),
    chunkPauseMs: z
      .number()
      .int()
      .min(0)
      // ⚠️ Inline literal for the same reason as 200 and 240000 above: the contract
      // generator re-evaluates this schema's source text with `z` as the only binding.
      .max(5000)
      .optional()
      .describe("Milliseconds to yield between chunks of 5 operations (default 0). Raise it only if Figma's UI needs to breathe on a heavy batch — the pause is skipped once timeBudgetMs is spent, so it can never push a run past its own ceiling"),
  },
  async ({ operations, onError, prevalidateOnly, timeBudgetMs, maxResultBytes, chunkPauseMs }: any) => {
    try {
      // Arm the transport just past the batch's own budget, so the plugin's ceiling is
      // always the one that fires and the reply is a receipt rather than a timeout.
      const budget =
        typeof timeBudgetMs === "number" ? timeBudgetMs : BATCH_DEFAULT_TIME_BUDGET_MS;
      const result = await sendCommandToFigma(
        "apply_batch",
        {
          operations,
          onError,
          prevalidateOnly,
          timeBudgetMs,
          maxResultBytes,
          chunkPauseMs,
        },
        Math.min(HEAVY_BATCH_TIMEOUT_MS, budget + BATCH_TIMEOUT_SLACK_MS)
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error applying batch: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Selection Tool
server.tool(
  "get_selection",
  "[Current-page scoped] Get information about the current selection in Figma",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_selection");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting selection: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Read My Design Tool
server.tool(
  "read_my_design",
  "[Current-page selection scoped] Get detailed information about the current selection in Figma, including each selected node subtree",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("read_my_design", {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node info: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Node Info Tool
server.tool(
  "get_node_info",
  "[Node-subtree scoped] Get detailed information about a specific Figma node. Document-root ID 0:0 is unsupported; use get_pages first.",
  {
    nodeId: z.string().describe("The ID of the node to get information about"),
  },
  async ({ nodeId }: any) => {
    try {
      const result = await sendCommandToFigma("get_node_info", { nodeId });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filterFigmaNode(result))
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node info: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

function rgbaToHex(color: any): string {
  // skip if color is already hex
  if (typeof color === "string") {
    return color;
  }

  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a === undefined ? 255 : Math.round(color.a * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a === 255 ? '' : a.toString(16).padStart(2, '0')}`;
}

function filterFigmaNode(node: any) {
  if (!node || typeof node !== "object") {
    return node;
  }

  // Skip VECTOR type nodes
  if (node.type === "VECTOR") {
    return null;
  }

  const filtered: any = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if (node.boundVariables) {
    filtered.boundVariables = node.boundVariables;
  }

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill: any) => {
      const processedFill = { ...fill };

      // imageRef can be very large/noisy; variable binding metadata is retained.
      delete processedFill.imageRef;

      // Process gradientStops if present
      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map((stop: any) => {
          const processedStop = { ...stop };
          // Convert color to hex if present
          if (processedStop.color) {
            processedStop.color = rgbaToHex(processedStop.color);
          }
          return processedStop;
        });
      }

      // Convert solid fill colors to hex
      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke: any) => {
      const processedStroke = { ...stroke };
      // Convert color to hex if present
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  // Effects are a read channel for the visual tools. Keep an empty array too: `[]` is
  // the observable result of clearing effects, whereas an omitted field says nothing.
  if (Array.isArray(node.effects)) {
    filtered.effects = node.effects.map((effect: any) => {
      const processedEffect = { ...effect };
      if (processedEffect.color) {
        processedEffect.color = rgbaToHex(processedEffect.color);
      }
      return processedEffect;
    });
  }

  if (node.effectStyleId !== undefined) {
    filtered.effectStyleId = node.effectStyleId;
  }

  // Preserve false and null: both are real readings, unlike an absent field.
  if (node.clipsContent !== undefined) {
    filtered.clipsContent = node.clipsContent;
  }

  if (node.absoluteRenderBounds !== undefined) {
    filtered.absoluteRenderBounds = node.absoluteRenderBounds;
  }

  if (node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  if (node.characters) {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx
    };
  }

  if (node.children) {
    filtered.children = node.children
      .map((child: any) => filterFigmaNode(child))
      .filter((child: any) => child !== null); // Remove null children (VECTOR nodes)
  }

  return filtered;
}

// Nodes Info Tool
server.tool(
  "get_nodes_info",
  "[Node-subtree scoped] Get detailed information about multiple Figma nodes",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to get information about")
  },
  async ({ nodeIds }: any) => {
    try {
      const results = await Promise.all(
        nodeIds.map(async (nodeId: any) => {
          const result = await sendCommandToFigma('get_node_info', { nodeId });
          return { nodeId, info: result };
        })
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results.map((result) => filterFigmaNode(result.info)))
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting nodes info: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);


// Create Rectangle Tool
server.tool(
  "create_rectangle",
  "Create a new rectangle in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the rectangle"),
    height: z.number().describe("Height of the rectangle"),
    name: z.string().optional().describe("Optional name for the rectangle"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent node ID to append the rectangle to"),
  },
  async ({ x, y, width, height, name, parentId }: any) => {
    try {
      const result = await sendCommandToFigma("create_rectangle", {
        x,
        y,
        width,
        height,
        name: name || "Rectangle",
        parentId,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created rectangle "${JSON.stringify(result)}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating rectangle: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Frame Tool
server.tool(
  "create_frame",
  "Create a new frame in Figma",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the frame"),
    height: z.number().describe("Height of the frame"),
    name: z.string().optional().describe("Optional name for the frame"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent node ID to append the frame to"),
    fillColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Alpha component (0-1)"),
      })
      .optional()
      .describe("Fill color in RGBA format"),
    strokeColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Alpha component (0-1)"),
      })
      .optional()
      .describe("Stroke color in RGBA format"),
    strokeWeight: z.number().positive().optional().describe("Stroke weight"),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).optional().describe("Auto-layout mode for the frame"),
    layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Whether the auto-layout frame wraps its children"),
    paddingTop: z.number().optional().describe("Top padding for auto-layout frame"),
    paddingRight: z.number().optional().describe("Right padding for auto-layout frame"),
    paddingBottom: z.number().optional().describe("Bottom padding for auto-layout frame"),
    paddingLeft: z.number().optional().describe("Left padding for auto-layout frame"),
    primaryAxisAlignItems: z
      .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
      .optional()
      .describe("Primary axis alignment for auto-layout frame. Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."),
    counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe("Counter axis alignment for auto-layout frame"),
    layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode for auto-layout frame"),
    layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode for auto-layout frame"),
    itemSpacing: z
      .number()
      .optional()
      .describe("Distance between children in auto-layout frame. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN.")
  },
  async ({
    x,
    y,
    width,
    height,
    name,
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
    layoutMode,
    layoutWrap,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    primaryAxisAlignItems,
    counterAxisAlignItems,
    layoutSizingHorizontal,
    layoutSizingVertical,
    itemSpacing
  }: any) => {
    try {
      const result = await sendCommandToFigma("create_frame", {
        x,
        y,
        width,
        height,
        name: name || "Frame",
        parentId,
        fillColor: fillColor || { r: 1, g: 1, b: 1, a: 1 },
        strokeColor: strokeColor,
        strokeWeight: strokeWeight,
        layoutMode,
        layoutWrap,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
        primaryAxisAlignItems,
        counterAxisAlignItems,
        layoutSizingHorizontal,
        layoutSizingVertical,
        itemSpacing
      });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            text: `Created frame "${typedResult.name}" with ID: ${typedResult.id}. Use the ID as the parentId to appendChild inside this frame.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating frame: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Text Tool
server.tool(
  "create_text",
  "Create a new text element in Figma, with the same typography parameters set_text_style writes onto an existing node. ⛔ Validate-all-then-create: every parameter is checked, the parent resolved and the font loaded BEFORE the node is created, so a refusal leaves no orphan node on the page. ⛔ An unloadable font is REFUSED, never substituted — this tool will not create a node in a face nobody asked for, so preflight with check_fonts and expect an error rather than a fallback. fontWeight reaches Inter's styles only and cannot be combined with fontFamily/fontStyle; supply the pair to name any installed face exactly.",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    text: z.string().describe("Text content"),
    fontSize: z.number().optional().describe("Font size (default: 14)"),
    fontWeight: z
      .number()
      .optional()
      .describe(
        "Font weight (e.g., 400 for Regular, 700 for Bold). Legacy shortcut: it maps onto Inter's styles and nothing else. Refused when fontFamily/fontStyle is also supplied, because one of the two would be silently discarded."
      ),
    fontFamily: z
      .string()
      .optional()
      .describe(
        "Font family, e.g. Inter. Must be supplied together with fontStyle. Case-sensitive and exact; a near miss is refused, not approximated."
      ),
    fontStyle: z
      .string()
      .optional()
      .describe(
        "Font style, e.g. Regular or Semi Bold. Must be supplied together with fontFamily."
      ),
    lineHeight: z
      .object({
        value: z
          .number()
          .nonnegative()
          .optional()
          .describe("Omit when unit is AUTO; supplying it there is refused rather than discarded."),
        unit: z.enum(["PIXELS", "PERCENT", "AUTO"]),
      })
      .optional()
      .describe(
        "Line height as {value, unit} — never a bare number, because a number cannot say whether it means pixels or percent."
      ),
    letterSpacing: z
      .object({
        value: z.number().describe("May be negative; tracking-in is legitimate."),
        unit: z.enum(["PIXELS", "PERCENT"]),
      })
      .optional()
      .describe("Letter spacing as {value, unit}. AUTO is not a letter-spacing unit."),
    textCase: z
      .enum(["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"])
      .optional()
      .describe("Letter case transform applied for display; the underlying characters are unchanged."),
    textDecoration: z
      .enum(["NONE", "UNDERLINE", "STRIKETHROUGH"])
      .optional()
      .describe("Text decoration."),
    textAlignHorizontal: z
      .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
      .optional()
      .describe("Horizontal alignment within the text box."),
    textAlignVertical: z
      .enum(["TOP", "CENTER", "BOTTOM"])
      .optional()
      .describe("Vertical alignment within the text box."),
    paragraphSpacing: z
      .number()
      .nonnegative()
      .optional()
      .describe("Space between paragraphs, in pixels."),
    paragraphIndent: z
      .number()
      .nonnegative()
      .optional()
      .describe("First-line indent, in pixels."),
    textAutoResize: z
      .enum(["NONE", "HEIGHT", "WIDTH_AND_HEIGHT", "TRUNCATE"])
      .optional()
      .describe(
        "How the text box resizes to its content. ⚠️ Inside an auto-layout parent this and the parent's layoutSizing describe the same behaviour from two sides, and the parent wins; the reply reports that in limitations."
      ),
    fontColor: z
      .object({
        r: z.number().min(0).max(1).describe("Red component (0-1)"),
        g: z.number().min(0).max(1).describe("Green component (0-1)"),
        b: z.number().min(0).max(1).describe("Blue component (0-1)"),
        a: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Alpha component (0-1)"),
      })
      .optional()
      .describe("Font color in RGBA format"),
    name: z
      .string()
      .optional()
      .describe("Semantic layer name for the text node"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent node ID to append the text to"),
  },
  async ({ x, y, text, fontColor, name, parentId, ...style }: any) => {
    try {
      const result = await sendCommandToFigma("create_text", {
        x,
        y,
        text,
        // ⛔ fontSize and fontWeight are NOT defaulted here any more. The plugin applies
        // the same 14 and 400, so no behaviour moves — but a default applied on this side
        // reaches the handler indistinguishable from a caller's own value, and the
        // fontWeight-versus-fontFamily refusal has to know which of the two it is.
        ...style,
        fontColor: fontColor || { r: 0, g: 0, b: 0, a: 1 },
        name: name || "Text",
        parentId,
      });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            // ⛔ The first line is byte-identical to what this tool has always answered —
            // `create_frame`, `create_section` and the live gates all parse "with ID:",
            // and `clone_node`'s "with new ID:" already proved how expensive a reworded
            // creator reply is. The receipt is appended, never substituted.
            text: `Created text "${typedResult.name}" with ID: ${typedResult.id}\n${JSON.stringify(result)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating text: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Fill Color Tool
server.tool(
  "set_fill_color",
  "Set the fill color of a node in Figma can be TextNode or FrameNode",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    r: z.number().min(0).max(1).describe("Red component (0-1)"),
    g: z.number().min(0).max(1).describe("Green component (0-1)"),
    b: z.number().min(0).max(1).describe("Blue component (0-1)"),
    a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
  },
  async ({ nodeId, r, g, b, a }: any) => {
    try {
      const result = await sendCommandToFigma("set_fill_color", {
        nodeId,
        color: { r, g, b, a: a || 1 },
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Set fill color of node "${typedResult.name
              }" to RGBA(${r}, ${g}, ${b}, ${a || 1})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting fill color: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Stroke Color Tool
server.tool(
  "set_stroke_color",
  "Set the stroke color of a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    r: z.number().min(0).max(1).describe("Red component (0-1)"),
    g: z.number().min(0).max(1).describe("Green component (0-1)"),
    b: z.number().min(0).max(1).describe("Blue component (0-1)"),
    a: z.number().min(0).max(1).optional().describe("Alpha component (0-1)"),
    weight: z.number().positive().optional().describe("Stroke weight"),
  },
  async ({ nodeId, r, g, b, a, weight }: any) => {
    try {
      const result = await sendCommandToFigma("set_stroke_color", {
        nodeId,
        color: { r, g, b, a: a || 1 },
        weight: weight || 1,
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Set stroke color of node "${typedResult.name
              }" to RGBA(${r}, ${g}, ${b}, ${a || 1}) with weight ${weight || 1}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting stroke color: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Move Node Tool
server.tool(
  "move_node",
  "Move a node to a new position in Figma",
  {
    nodeId: z.string().describe("The ID of the node to move"),
    x: z.number().describe("New X position"),
    y: z.number().describe("New Y position"),
  },
  async ({ nodeId, x, y }: any) => {
    try {
      const result = await sendCommandToFigma("move_node", { nodeId, x, y });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Moved node "${typedResult.name}" to position (${x}, ${y})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error moving node: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Clone Node Tool
server.tool(
  "clone_node",
  "Clone an existing node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to clone"),
    x: z.number().optional().describe("New X position for the clone"),
    y: z.number().optional().describe("New Y position for the clone")
  },
  async ({ nodeId, x, y }: any) => {
    try {
      const result = await sendCommandToFigma('clone_node', { nodeId, x, y });
      const typedResult = result as { name: string, id: string };
      return {
        content: [
          {
            type: "text",
            text: `Cloned node "${typedResult.name}" with new ID: ${typedResult.id}${x !== undefined && y !== undefined ? ` at position (${x}, ${y})` : ''}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error cloning node: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Resize Node Tool
server.tool(
  "resize_node",
  "Resize a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to resize"),
    width: z.number().positive().describe("New width"),
    height: z.number().positive().describe("New height"),
  },
  async ({ nodeId, width, height }: any) => {
    try {
      const result = await sendCommandToFigma("resize_node", {
        nodeId,
        width,
        height,
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Resized node "${typedResult.name}" to width ${width} and height ${height}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error resizing node: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Delete Node Tool
server.tool(
  "delete_node",
  "Delete a node from Figma",
  {
    nodeId: z.string().describe("The ID of the node to delete"),
  },
  async ({ nodeId }: any) => {
    try {
      await sendCommandToFigma("delete_node", { nodeId });
      return {
        content: [
          {
            type: "text",
            text: `Deleted node with ID: ${nodeId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting node: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Delete Multiple Nodes Tool
server.tool(
  "delete_multiple_nodes",
  "Delete multiple nodes from Figma at once",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to delete"),
  },
  async ({ nodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("delete_multiple_nodes", { nodeIds });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting multiple nodes: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Export Node as Image Tool
server.tool(
  "export_node_as_image",
  "[Node scoped] Export a node as an image from Figma. Always returns a JSON receipt identifying the export plus a preflight cost estimate. PNG/JPG exports above the fork's 16 MP safety ceiling are refused unless allowLargeExport is explicitly true. Pass filePath to write the bytes to disk and keep base64 out of the transcript entirely.",
  {
    nodeId: z.string().describe("The ID of the node to export"),
    format: z
      .enum(["PNG", "JPG", "SVG", "PDF"])
      .optional()
      .describe("Export format"),
    scale: z.number().positive().optional().describe("Export scale"),
    allowLargeExport: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Explicitly accept the risk of a PNG/JPG export above the 16 MP safety ceiling (default: false). A timed-out Figma export cannot be cancelled and may leave the plugin unresponsive; prefer reducing scale or exporting a smaller node."
      ),
    filePath: z
      .string()
      .optional()
      .describe(
        "Absolute path to write the exported bytes to. When set, the reply is the receipt only — no base64 image block — which keeps multi-megabyte exports out of the model context. Parent directories are created."
      ),
  },
  async ({ nodeId, format, scale, allowLargeExport, filePath }: any) => {
    try {
      if (filePath !== undefined && filePath !== "" && !path.isAbsolute(filePath)) {
        throw new Error(
          `filePath must be an absolute path; received "${filePath}"`
        );
      }

      const requestedFormat = format || "PNG";
      const requestedScale = scale || 1;
      // Heavy budget, not the 30s default: an export's cost scales with pixel area and
      // with base64-transferring the bytes back through the relay. The plugin emits a
      // pre-encoding progress update, but the 120s inactivity budget remains a hard
      // bound while Figma is inside exportAsync; raising it would only lengthen a wedge.
      const result = await sendCommandToFigma("export_node_as_image", {
        nodeId,
        format: requestedFormat,
        scale: requestedScale,
        allowLargeExport: Boolean(allowLargeExport),
      }, HEAVY_READ_TIMEOUT_MS);
      const typedResult = result as {
        nodeId?: string;
        format?: string;
        scale?: number;
        imageData: string;
        mimeType: string;
        preflight?: Record<string, unknown>;
      };

      const mimeType = typedResult.mimeType || "image/png";
      const bytes = Buffer.from(typedResult.imageData, "base64");
      const receipt = buildExportReceipt(bytes, mimeType, {
        nodeId: typedResult.nodeId || nodeId,
        format: typedResult.format || requestedFormat,
        scale: typedResult.scale ?? requestedScale,
        filePath,
        preflight: typedResult.preflight,
      });

      if (filePath) {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, bytes);
        return {
          content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }],
        };
      }

      return {
        content: [
          {
            type: "image",
            data: typedResult.imageData,
            mimeType,
          },
          { type: "text", text: JSON.stringify(receipt, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error exporting node as image: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Text Content Tool
server.tool(
  "set_text_content",
  "Set the text content of an existing text node in Figma",
  {
    nodeId: z.string().describe("The ID of the text node to modify"),
    text: z.string().describe("New text content"),
  },
  async ({ nodeId, text }: any) => {
    try {
      const result = await sendCommandToFigma("set_text_content", {
        nodeId,
        text,
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Updated text content of node "${typedResult.name}" to "${text}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting text content: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Text Style Tool
server.tool(
  "set_text_style",
  "[Node scoped] Set typography properties on one existing TEXT node — font, size, line height, letter spacing, case, decoration, alignment, paragraph spacing/indent and auto-resize. Every parameter is optional but at least one is required. ⛔ Validate-all-then-write: every parameter is checked and every font loaded BEFORE the first property is assigned, so a refusal leaves the node completely untouched rather than half-written. ⛔ An unloadable font is REFUSED, never substituted — unlike a text-content write, this tool will not silently retype the node to Inter, so preflight with check_fonts and expect an error rather than a fallback. Properties are node-level; character ranges are not addressable. Supplying fontFamily/fontStyle on a mixed-font node unifies it, which discards its per-character font runs and is reported in limitations.",
  {
    nodeId: z.string().describe("The ID of the TEXT node to restyle"),
    fontFamily: z
      .string()
      .optional()
      .describe(
        "Font family, e.g. Inter. Must be supplied together with fontStyle — a family without a style has no single answer on a mixed-font node. Case-sensitive and exact; a near miss is refused, not approximated."
      ),
    fontStyle: z
      .string()
      .optional()
      .describe(
        "Font style, e.g. Regular or Semi Bold. Must be supplied together with fontFamily."
      ),
    fontSize: z
      .number()
      .min(1)
      .max(65535)
      .optional()
      .describe("Font size in pixels."),
    lineHeight: z
      .object({
        value: z
          .number()
          .nonnegative()
          .optional()
          .describe("Omit when unit is AUTO; supplying it there is refused rather than discarded."),
        unit: z.enum(["PIXELS", "PERCENT", "AUTO"]),
      })
      .optional()
      .describe(
        "Line height as {value, unit} — never a bare number, because a number cannot say whether it means pixels or percent. Use {unit: 'AUTO'} for Figma's automatic line height."
      ),
    letterSpacing: z
      .object({
        value: z.number().describe("May be negative; tracking-in is legitimate."),
        unit: z.enum(["PIXELS", "PERCENT"]),
      })
      .optional()
      .describe("Letter spacing as {value, unit}. AUTO is not a letter-spacing unit."),
    textCase: z
      .enum(["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"])
      .optional()
      .describe("Letter case transform applied for display; the underlying characters are unchanged."),
    textDecoration: z
      .enum(["NONE", "UNDERLINE", "STRIKETHROUGH"])
      .optional()
      .describe("Text decoration."),
    textAlignHorizontal: z
      .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
      .optional()
      .describe("Horizontal alignment within the text box."),
    textAlignVertical: z
      .enum(["TOP", "CENTER", "BOTTOM"])
      .optional()
      .describe("Vertical alignment within the text box."),
    paragraphSpacing: z
      .number()
      .nonnegative()
      .optional()
      .describe("Space between paragraphs, in pixels."),
    paragraphIndent: z
      .number()
      .nonnegative()
      .optional()
      .describe("First-line indent, in pixels."),
    textAutoResize: z
      .enum(["NONE", "HEIGHT", "WIDTH_AND_HEIGHT", "TRUNCATE"])
      .optional()
      .describe(
        "How the text box resizes to its content. ⚠️ This and an auto-layout parent's layoutSizing describe the same behaviour from two sides; inside auto-layout the parent wins, and the fork's child-layout tools land in R2.6."
      ),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("set_text_style", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting text style: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Get Styles Tool
server.tool(
  "get_styles",
  "[Document-wide] Get all local paint, text, effect, and grid styles from the Figma document",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_styles", {}, HEAVY_READ_TIMEOUT_MS);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting styles: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Get Local Components Tool
server.tool(
  "get_local_components",
  "[Document-wide by default, or scoped to chosen pages] Get local components. Summary mode is the default and returns counts plus bounded name families; set summary=false for a paginated component list. COST WARNING: every page must be fully loaded before it can be scanned, so runtime tracks page weight, not component count — on a large document this can exceed two minutes. Pass `pages` to scan only what you need, and/or `timeBudgetMs` to bound it. The reply always declares its own coverage via `complete`, `pagesScanned` and `pagesSkipped`, so a scoped or truncated scan is never mistakable for a document total. INTERPRETING THE COUNT: summary mode also returns `authoringSessions`, clustering components by the leading segment of their node id, which every node created in one authoring session shares. A bulk-pasted vendor kit therefore collapses into one or two sessions (usually low-numbered, since they were pasted early) while hand-authored work spreads across others — so a raw `count` often describes a purchased library rather than the designer's work. Treat the clusters as evidence for that judgement, not as a verdict: the tool deliberately does not label any session 'a kit'.",
  {
    summary: z
      .boolean()
      .optional()
      .default(true)
      .describe("Return compact counts and name families (default: true)"),
    pages: z
      .array(z.string())
      .optional()
      .describe(
        "Page IDs (from get_pages) to scan. Omit to scan every page. This is the main cost control: unlisted pages are never loaded. Unknown IDs are reported in pagesNotFound, never ignored."
      ),
    timeBudgetMs: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe(
        "Stop starting new pages once this many ms have elapsed and return partial results with complete=false (0 = no budget, the default). The first page always runs."
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .default(100)
      .describe("Maximum components returned when summary=false"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("Component offset when summary=false"),
    familyLimit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .default(100)
      .describe("Maximum name families returned in summary mode"),
    sessionLimit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe("Maximum authoring sessions returned in summary mode"),
  },
  async ({
    summary,
    limit,
    offset,
    familyLimit,
    sessionLimit,
    pages,
    timeBudgetMs,
  }: any) => {
    try {
      const result = await sendCommandToFigma("get_local_components", {
        summary,
        limit,
        offset,
        familyLimit,
        sessionLimit,
        pages,
        timeBudgetMs,
      }, HEAVY_READ_TIMEOUT_MS);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting local components: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Get Variables Tool
server.tool(
  "get_variables",
  "[Document-wide] Get local variable collections, modes, and variables with raw and alias-resolved values per mode. Returns an explicit unsupported/incomplete payload when the Variables API cannot answer.",
  {
    types: z
      .array(z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]))
      .min(1)
      .optional()
      .describe("Optional variable types to include; defaults to all four types"),
  },
  async ({ types }: any) => {
    try {
      const result = await sendCommandToFigma("get_variables", { types });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting variables: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Get Variable Capabilities Tool
server.tool(
  "get_variable_capabilities",
  "[Document-wide, read-only preflight] Report the Variable API write surface, the running editor's write context, and local collection mode usage before a variable write. Figma does not expose a read-only file-permission check or a numeric mode-limit API, so document.editable and modeCeiling.value are explicitly null when unknown rather than guessed; no create/delete probe is performed. The inventory is LOCAL-ONLY and remoteCollectionInventoryAvailable is always false: Figma returns only this file's own collections, so every returned collection carries isRemote:false plus modeCount, and seeing no library collection here is NOT evidence that the file references none.",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_variable_capabilities", {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting variable capabilities: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Add Variable Mode Tool
server.tool(
  "add_variable_mode",
  "[Exact local variable collection, caller-requested write] Add one named mode to an existing local variable collection. This is not a plan-ceiling probe: it makes exactly one collection.addMode(name) call for this request and never creates a temporary collection or mode, nor calls removeMode. If Figma refuses at its pricing-tier mode limit, the receipt keeps Figma's refusal text verbatim and reports the pre-call known-good mode count; modeCeiling.value is populated only from Figma's own `in addMode: Limited to N modes only` message, never from a hardcoded plan table. A successful write returns Figma's mode ID and a post-call collection count.",
  {
    collectionId: z
      .string()
      .min(1)
      .describe("ID of the existing local variable collection to change"),
    name: z
      .string()
      .min(1)
      .describe("Name of the mode to add; this is a real document write, not a probe"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("add_variable_mode", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error adding variable mode: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R3-A Phase 2 — set one existing local variable's value for one existing mode.
// The server owns the syntactic XOR; the plugin resolves the actual variable/type/mode and
// performs every semantic refusal before it reaches Figma's setter.
server.tool(
  "set_variable_value",
  "[Exact local variable and mode, caller-requested write] Set one existing local variable's value for one mode. Pass exactly one of value or aliasOf: raw COLOR values are RGBA objects with 0–1 r/g/b and optional a (hex strings are not accepted), FLOAT is a finite number, STRING is a string, and BOOLEAN is true/false; aliasOf is an existing local variable ID of the same resolved type. The handler rejects self-aliases and every resolvable alias cycle before writing, then reads Figma's stored value back. Remote source variables, remote collections, and remote alias chains return a typed refusal and are never silently skipped. This R3-A slice supports COLOR, FLOAT, STRING and BOOLEAN only.",
  {
    variableId: z
      .string()
      .min(1)
      .describe("ID of the existing local variable to change"),
    modeId: z
      .string()
      .min(1)
      .describe("ID of an existing mode in that variable's local collection"),
    value: z
      .union([
        z.string().describe("Raw STRING value"),
        z.number().finite().describe("Raw finite FLOAT value"),
        z.boolean().describe("Raw BOOLEAN value"),
        z
          .object({
            r: z.number().min(0).max(1).describe("Red channel, 0–1"),
            g: z.number().min(0).max(1).describe("Green channel, 0–1"),
            b: z.number().min(0).max(1).describe("Blue channel, 0–1"),
            a: z
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe("Alpha channel, 0–1; defaults to 1"),
          })
          .strict()
          .describe("Raw COLOR value as RGBA floats; no hex-string form"),
      ])
      .optional()
      .describe("Raw value; supply this XOR aliasOf"),
    aliasOf: z
      .string()
      .min(1)
      .optional()
      .describe("Existing local variable ID to alias; supply this XOR value"),
  },
  async (args: any) => {
    const hasValue = Object.prototype.hasOwnProperty.call(args, "value") && args.value !== undefined;
    const hasAlias = Object.prototype.hasOwnProperty.call(args, "aliasOf") && args.aliasOf !== undefined;
    if (hasValue === hasAlias) {
      return {
        content: [
          {
            type: "text",
            text: "Error setting variable value: provide exactly one of value or aliasOf; no request was sent to Figma",
          },
        ],
      };
    }
    try {
      const result = await sendCommandToFigma("set_variable_value", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting variable value: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R3-A Phase 3 — create-or-match into one exact existing local collection. Identity is
// deliberately layered: an explicit id is authoritative, otherwise exact collection/name,
// otherwise an opaque caller-owned private-plugin-data key. The plugin reports whether it
// matched or created so a rerun is auditable without a second read.
server.tool(
  "create_variable",
  "[Exact existing local variable collection, idempotent caller-requested write] Create or match one named COLOR, FLOAT, STRING or BOOLEAN variable in an existing local collection. Resolution is fixed: supplied id first; otherwise exact collectionId + name; otherwise supplied opaque identityKey stored as this plugin's private data in the same collection. A wrong explicit id never falls through to create, duplicate name/key matches are refused, and a different existing identityKey is never overwritten. Every receipt carries created and matchedBy: a fresh create is created:true/matchedBy:null; an existing resource is created:false with matchedBy id, name, or identityKey. identityKey is compared byte-for-byte only and is never parsed, normalized, or echoed. The collection is resolved before any write; remote resources return a typed refusal without calling Figma.",
  {
    collectionId: z
      .string()
      .min(1)
      .describe("ID of the existing local collection that will own the new variable"),
    name: z
      .string()
      .min(1)
      .describe("Name for the new variable; this is a real document write"),
    resolvedType: z
      .enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"])
      .describe("Figma variable type for the new variable"),
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Optional exact local variable ID; when supplied it is the first identity layer and must belong to collectionId"),
    identityKey: z
      .string()
      .min(1)
      .optional()
      .describe("Optional opaque caller-owned string for idempotent identity; stored privately on a newly created or matching untagged variable and never interpreted or returned"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("create_variable", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating variable: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R3-A Phase 2 — the only destructive tool in the slice. A literal true survives both the
// published schema and the plugin's own direct-call guard; a generic truthy value is not a
// confirmation and never reaches Variable.remove().
server.tool(
  "delete_variable",
  "[Exact local variable, destructive caller-requested write] Permanently remove one existing local variable. confirm must be literal true; without it no Figma call is made. Remote variables return a typed refusal. Figma commits the removal at the END of the plugin execution frame, so after remove() the handler probes independent in-frame signals and names the one that observed the absence; when none can, it reports outcome removal_unconfirmed with verificationDeferred and partialApplicationPossible instead of claiming deletion. A real deletion and a no-op remove() are indistinguishable from inside that frame, so confirm absence with a later read. Run live validation only on a disposable Figma file.",
  {
    variableId: z
      .string()
      .min(1)
      .describe("ID of the existing local variable to permanently remove"),
    confirm: z
      .literal(true)
      .describe("Required explicit destructive confirmation; must be true, not merely truthy"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("delete_variable", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting variable: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R3-A Phase 4 — the modes slice. This is the ONLY tool in the fork that removes a mode,
// and the reason the Phase 1.3 ceiling gate's debris was previously unclearable from here.
// Its guard rail is narrower than delete_variable's on purpose: the default mode and the
// sole remaining mode are refused outright, because Figma documents removeMode(modeId) but
// documents nothing about where defaultModeId lands when the default itself is removed —
// and every variable in a collection resolves through that default.
server.tool(
  "remove_variable_mode",
  "[Exact local variable collection + exact mode, destructive caller-requested write] Permanently remove one mode from one existing local variable collection. confirm must be literal true; without it no Figma call is made. Removing a mode discards the value every variable in that collection held FOR THAT MODE — the variables themselves and their other modes are untouched — and the receipt reports the pre-call variable count as the blast radius. Two removals are refused rather than attempted: the collection's default mode, because Figma does not document where defaultModeId lands when the default is removed and every variable resolves through it, and the sole remaining mode, because a collection with no modes has no slot for any value. Reassign the default in Figma first if you mean to remove it. Remote collections and a modeId that does not belong to the named collection get typed refusals. Figma may commit the removal at the END of the plugin execution frame, so after removeMode() the handler probes independent in-frame signals and names the one that observed the absence; when none can, it reports outcome removal_unconfirmed with verificationDeferred and partialApplicationPossible instead of claiming removal. Confirm absence with a later read. Run live validation only on a disposable Figma file.",
  {
    collectionId: z
      .string()
      .min(1)
      .describe("ID of the existing local variable collection that owns the mode"),
    modeId: z
      .string()
      .min(1)
      .describe(
        "ID of the mode to remove; it must already belong to collectionId. One mode per call"
      ),
    confirm: z
      .literal(true)
      .describe("Required explicit destructive confirmation; must be true, not merely truthy"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("remove_variable_mode", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error removing variable mode: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R3-A Phase 2 — the collections row. Reuses Phase 3's layered identity rather than a
// second one: a blind create on a rerun is how a file ends up with four collections named
// "Colors", and the variable half already paid for that lesson.
server.tool(
  "create_variable_collection",
  "[Document-scoped, idempotent caller-requested write] Create or match one named local variable collection. Resolution is fixed and identical to create_variable's: supplied id first; otherwise exact name across local collections; otherwise supplied opaque identityKey stored as this plugin's private data. A wrong explicit id never falls through to create, duplicate name or key matches are refused as ambiguous, and a different existing identityKey is never overwritten. Figma returns a collection that ALREADY has one mode and that mode is its defaultModeId — the receipt publishes it as defaultMode so a caller does not need a second read before writing a value. Every receipt carries created and matchedBy: a fresh create is created:true/matchedBy:null; an existing collection is created:false with matchedBy id, name, or identityKey. identityKey is compared byte-for-byte only and is never parsed, normalized, or echoed. Remote collections return a typed refusal.",
  {
    name: z
      .string()
      .min(1)
      .describe("Name for the collection; this is a real document write"),
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Optional exact local variable collection ID; when supplied it is the first identity layer and a miss refuses rather than creating"),
    identityKey: z
      .string()
      .min(1)
      .optional()
      .describe("Optional opaque caller-owned string for idempotent identity; stored privately on a newly created or matching untagged collection and never interpreted or returned"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("create_variable_collection", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating variable collection: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R3-A Phase 2 — the mode rename row. The only variable-mode write that changes nothing a
// variable resolves through, and the only one that is not destructive.
server.tool(
  "rename_variable_mode",
  "[Exact local variable collection + exact mode, caller-requested write] Rename one mode of one existing local variable collection. Nothing a variable resolves through changes: values, the default mode, and every other mode are untouched. A rename to the name the mode ALREADY has is REFUSED as mode_name_unchanged rather than reported as applied, because a no-op rename and a rename that silently failed produce identical bytes. Figma refuses a duplicate mode name inside one collection and that refusal is preserved verbatim. Remote collections and a modeId that does not belong to the named collection get typed refusals. After renameMode() the handler probes independent in-frame signals and names the one that observed the new name; when none can, it reports outcome rename_unconfirmed with verificationDeferred instead of claiming the rename.",
  {
    collectionId: z
      .string()
      .min(1)
      .describe("ID of the existing local variable collection that owns the mode"),
    modeId: z
      .string()
      .min(1)
      .describe("ID of the mode to rename; it must already belong to collectionId"),
    name: z
      .string()
      .min(1)
      .describe("New name for the mode; must differ from its current name"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("rename_variable_mode", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error renaming variable mode: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R3-A Phase 2 — rename + description + scope correction in one tool, and the one tool in
// this slice that writes SEVERAL fields with no transaction underneath it.
server.tool(
  "set_variable_metadata",
  "[Exact local variable, caller-requested write] Change the name, description and/or scopes of one existing local variable. Supply at least one; an empty description is legal and is how a description is cleared. Every supplied value is validated BEFORE the first assignment, because Figma offers no transaction across these three fields — so a late refusal on a multi-field write would otherwise leave a half-changed variable. The receipt reports per-field before, after, applied and observed. If Figma refuses part-way the outcome is partially_applied with the exact appliedFields and partialApplicationPossible:true, never a plain refusal that would read as nothing changed. A field the platform accepted but did not reflect on read-back is reported as metadata_unconfirmed naming the field, not as success. Remote variables return a typed refusal.",
  {
    variableId: z
      .string()
      .min(1)
      .describe("ID of the existing local variable to change"),
    name: z
      .string()
      .min(1)
      .optional()
      .describe("New variable name; omit to leave it unchanged"),
    description: z
      .string()
      .optional()
      .describe("New description; the empty string clears it. Omit to leave it unchanged"),
    scopes: z
      .array(
        z.enum([
          "ALL_SCOPES",
          "ALL_FILLS",
          "FRAME_FILL",
          "SHAPE_FILL",
          "TEXT_FILL",
          "STROKE_COLOR",
          "STROKE_FLOAT",
          "EFFECT_FLOAT",
          "EFFECT_COLOR",
          "OPACITY",
          "CORNER_RADIUS",
          "WIDTH_HEIGHT",
          "GAP",
          "TEXT_CONTENT",
          "FONT_FAMILY",
          "FONT_STYLE",
          "FONT_WEIGHT",
          "FONT_SIZE",
          "LINE_HEIGHT",
          "LETTER_SPACING",
          "PARAGRAPH_SPACING",
          "PARAGRAPH_INDENT",
        ])
      )
      .min(1)
      .optional()
      .describe("Complete replacement list of Figma variable scopes; this REPLACES the current scopes rather than adding to them. Omit to leave them unchanged"),
  },
  async (args: any) => {
    const supplied = ["name", "description", "scopes"].filter(
      (field) =>
        Object.prototype.hasOwnProperty.call(args, field) && args[field] !== undefined
    );
    if (supplied.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Error setting variable metadata: supply at least one of name, description or scopes; no request was sent to Figma",
          },
        ],
      };
    }
    try {
      const result = await sendCommandToFigma("set_variable_metadata", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting variable metadata: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R3-A Phase 2 — the bindings rows. Both bind an EXISTING local variable to an EXISTING
// node; neither creates a variable, a paint, or a node.
server.tool(
  "bind_variable_to_node",
  "[Exact node + exact plain field, caller-requested write] Bind one existing local variable to one plain bindable field of one existing node — width, height, characters, fontSize, fontFamily, itemSpacing, padding*, cornerRadius fields, visible, opacity and the other single-value fields Figma marks bindable. For a paint colour use bind_variable_to_paint instead. This fork keeps NO table of which field accepts which resolvedType: Figma owns that rule and changes it as it ships new bindable fields, so a type mismatch returns Figma's own refusal verbatim rather than a stale local guess. After setBoundVariable() the handler re-reads node.boundVariables and reports the binding only when it can see it; when it cannot, the outcome is bind_unconfirmed with verificationDeferred, which is also what an unbindable field name looks like, because Figma does not always throw for one. Unbinding is not part of this slice.",
  {
    nodeId: z
      .string()
      .min(1)
      .describe("ID of the existing node to bind the variable on"),
    field: z
      .string()
      .min(1)
      .describe("Bindable plain field name, e.g. width, height, characters, fontSize, itemSpacing, paddingLeft, topLeftRadius, visible, opacity"),
    variableId: z
      .string()
      .min(1)
      .describe("ID of the existing local variable to bind; its resolved type must suit the field"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("bind_variable_to_node", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error binding variable to node: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "bind_variable_to_paint",
  "[Exact node + exact paint slot, caller-requested write] Bind one existing local COLOR variable to the colour of one paint in a node's fills or strokes. ⚠️ Figma's setBoundVariableForPaint does not mutate the paint — it RETURNS A NEW PAINT — and node.fills is a readonly array, so this handler replaces the whole array and reports writeBackPerformed; a call that skipped that step would throw nothing and change nothing. A non-COLOR variable is refused before any Figma call, from the variable's own resolvedType. fills that read as figma.mixed are refused because paintIndex then names no single paint, and an index past the end is refused with the real paint count. After the write-back the handler re-reads the paint's boundVariables.color and reports the binding only when it can see it; otherwise the outcome is bind_unconfirmed with verificationDeferred. Existing paint properties other than the bound colour are preserved by Figma's own returned paint.",
  {
    nodeId: z
      .string()
      .min(1)
      .describe("ID of the existing node that owns the paint"),
    paintTarget: z
      .enum(["fills", "strokes"])
      .describe("Which paint list on the node holds the paint to bind"),
    paintIndex: z
      .number()
      .int()
      .min(0)
      .describe("Zero-based index of the paint within that list; it must already exist"),
    variableId: z
      .string()
      .min(1)
      .describe("ID of the existing local COLOR variable to bind to the paint's colour"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("bind_variable_to_paint", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error binding variable to paint: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Get Node Variables Tool
server.tool(
  "get_node_variables",
  "[Node-subtree scoped] Resolve every design token in a node and its descendants: variable bindings (property, variable name, active value) AND style references (fill/stroke/text/effect/grid styles), which are a separate Figma concept a node can use instead of variables. Anything the client cannot answer is declared in `limitations` rather than omitted. Document-root ID 0:0 is unsupported; use get_pages first.",
  {
    nodeId: z.string().describe("Root node ID whose subtree should be scanned"),
    maxNodes: z
      .number()
      .int()
      .positive()
      .max(50000)
      .optional()
      .describe(
        "Maximum nodes to traverse; defaults to 5000. The scan is bounded by default because an unbounded page-wide scan (~12k nodes) has been observed to leave the plugin unable to answer any further command. When the cap is hit, coverage.nodeCapReached is true and complete is false — the counts then describe only the scanned nodes."
      ),
    timeBudgetMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Optional wall-clock budget for the traversal in milliseconds; 0 (the default) means no budget. Exhausting it sets coverage.budgetExhausted and complete:false."
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(5000)
      .optional()
      .describe(
        "Maximum records returned per array (bindings and styles are windowed independently); defaults to 1000. bindingCount/styleCount remain whole-scan totals, so truncation is always visible."
      ),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Record offset within each array, for paging a large subtree. Traversal order is stable, so paging is repeatable as long as maxNodes is unchanged."
      ),
  },
  async ({ nodeId, maxNodes, timeBudgetMs, limit, offset }: any) => {
    try {
      const result = await sendCommandToFigma("get_node_variables", {
        nodeId,
        maxNodes,
        timeBudgetMs,
        limit,
        offset,
      }, HEAVY_READ_TIMEOUT_MS);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node variables: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Get Available Fonts Tool
server.tool(
  "get_available_fonts",
  "[Font-inventory scoped] List the fonts installed on the machine running Figma, as a bounded window. This is the MACHINE's inventory, not the file's: a real machine returns thousands of faces, so the reply is always windowed and fontCount/familyCount stay whole-inventory totals against any window or filter. Pass family to narrow to one family in a single call instead of paging. Ordering is a deterministic family-then-style code-unit sort, so offset paging is repeatable. Use check_fonts, not this tool, to decide whether a specific font will survive a write.",
  {
    family: z
      .string()
      .optional()
      .describe(
        "Exact, case-sensitive family name to filter by; omit for the whole inventory. A near miss returns zero matches and reads identically to an absent family, so the reply says so in limitations."
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(5000)
      .optional()
      .describe(
        "Maximum faces returned; defaults to 1000. fontCount, familyCount and matchCount remain whole-inventory totals, so truncation is always visible."
      ),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Face offset within the matching set, for paging. The sort is deterministic and locale-independent, so paging is repeatable as long as the machine's font set does not change."
      ),
    timeBudgetMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Optional wall-clock budget for the inventory fetch; 0 (the default) means no budget. ⚠️ It bounds the REPLY, not the work: Figma's listAvailableFontsAsync takes no cancellation signal, so an exhausted budget abandons the call rather than stopping it and returns coverage.budgetExhausted with coverage.inventoryFetched false and null counts."
      ),
  },
  async ({ family, limit, offset, timeBudgetMs }: any) => {
    try {
      const result = await sendCommandToFigma("get_available_fonts", {
        family,
        limit,
        offset,
        timeBudgetMs,
      }, HEAVY_READ_TIMEOUT_MS);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting available fonts: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Check Fonts Tool
server.tool(
  "check_fonts",
  "[Font-inventory scoped] Preflight {family, style} pairs before a text write commits. Each pair reports `available` (present in the machine's inventory), `familyAvailable` (the family exists under some other style, which separates a misspelled style from an absent family), and `loadable` (figma.loadFontAsync actually succeeded), plus the error when it did not. Availability and loadability are reported separately on purpose: a listed face can still refuse to load, and a write that assumes otherwise substitutes Inter silently. Writes nothing to the document, but it does load the fonts it probes into the plugin session. Capped at 50 pairs per call.",
  {
    fonts: z
      .array(
        z.object({
          family: z.string().describe("Font family, e.g. Inter"),
          style: z.string().describe("Font style, e.g. Regular or Semi Bold"),
        })
      )
      .min(1)
      .max(50)
      .describe(
        "Font pairs to preflight. Capped at 50 because a preflight that outlasts the write it precedes is not a preflight; split longer lists across calls."
      ),
    timeBudgetMs: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Optional wall-clock budget for the load probes; 0 (the default) means no budget. Checked between probes, since an individual loadFontAsync cannot be cancelled either. Unprobed pairs are absent from results and counted in skippedCount rather than reported as unavailable."
      ),
  },
  async ({ fonts, timeBudgetMs }: any) => {
    try {
      const result = await sendCommandToFigma("check_fonts", {
        fonts,
        timeBudgetMs,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error checking fonts: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Get Annotations Tool
server.tool(
  "get_annotations",
  "[Current-page scoped when nodeId is omitted; otherwise node-subtree scoped] Get annotations. Nodes that cannot own annotations still return a typed result and their descendants are scanned.",
  {
    nodeId: z
      .string()
      .optional()
      .describe("Optional root node ID; omit to scan the current page"),
    includeCategories: z.boolean().optional().default(true).describe("Whether to include category information")
  },
  async ({ nodeId, includeCategories }: any) => {
    try {
      const result = await sendCommandToFigma("get_annotations", {
        nodeId,
        includeCategories
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting annotations: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Set Annotation Tool
server.tool(
  "set_annotation",
  "Create or update an annotation",
  {
    nodeId: z.string().describe("The ID of the node to annotate"),
    annotationId: z.string().optional().describe("The ID of the annotation to update (if updating existing annotation)"),
    labelMarkdown: z.string().describe("The annotation text in markdown format"),
    categoryId: z.string().optional().describe("The ID of the annotation category"),
    properties: z.array(z.object({
      type: z.string()
    })).optional().describe("Additional properties for the annotation")
  },
  async ({ nodeId, annotationId, labelMarkdown, categoryId, properties }: any) => {
    try {
      const result = await sendCommandToFigma("set_annotation", {
        nodeId,
        annotationId,
        labelMarkdown,
        categoryId,
        properties
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting annotation: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

interface SetMultipleAnnotationsParams {
  nodeId: string;
  annotations: Array<{
    nodeId: string;
    labelMarkdown: string;
    categoryId?: string;
    annotationId?: string;
    properties?: Array<{ type: string }>;
  }>;
}

// Set Multiple Annotations Tool
server.tool(
  "set_multiple_annotations",
  "Set multiple annotations in a node, one at a time — this tool does not batch or parallelise, and emits one progress frame per annotation. The reply keeps its existing two prose blocks and appends a JSON receipt carrying the unified `outcome`/`succeeded`/`failed`/`skipped`/`total` alongside every legacy field, so the aggregate cannot be read from a `success` flag that is true whenever a single item succeeded",
  {
    nodeId: z
      .string()
      .describe("The ID of the node containing the elements to annotate"),
    annotations: z
      .array(
        z.object({
          nodeId: z.string().describe("The ID of the node to annotate"),
          labelMarkdown: z.string().describe("The annotation text in markdown format"),
          categoryId: z.string().optional().describe("The ID of the annotation category"),
          annotationId: z.string().optional().describe("The ID of the annotation to update (if updating existing annotation)"),
          properties: z.array(z.object({
            type: z.string()
          })).optional().describe("Additional properties for the annotation")
        })
      )
      .describe("Array of annotations to apply"),
  },
  async ({ nodeId, annotations }: any) => {
    try {
      if (!annotations || annotations.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No annotations provided",
            },
          ],
        };
      }

      const result = await sendCommandToFigma("set_multiple_annotations", {
        nodeId,
        annotations,
      });

      // Phase 4.1 reaches a live consumer here — see set_multiple_text_contents. The
      // opening line also stops promising "batches of 5": this handler processes one
      // annotation at a time (`chunkSize: 1`) and reports no `completedInChunks` at all,
      // so both the promise and the "Processed in 1 batches" that `|| 1` fabricated
      // described work that never happened.
      return { content: annotationsReply(result, annotations.length) as any };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting multiple annotations: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Component Instance Tool
server.tool(
  "create_component_instance",
  "Create an instance of a component in Figma. For LOCAL components (from get_local_components), use componentId with the id field. For published LIBRARY components, use componentKey with the publishedKey field.",
  {
    componentId: z.string().optional().describe("ID of a local component (use the id field from get_local_components result). Use this for unpublished/local components."),
    componentKey: z.string().optional().describe("Key of a published library component to instantiate (use the publishedKey field from get_local_components result). Only works for published components."),
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    parentId: z.string().optional().describe("Optional parent node ID to place the instance into"),
  },
  async ({ componentId, componentKey, x, y, parentId }: any) => {
    try {
      const result = await sendCommandToFigma("create_component_instance", {
        componentId,
        componentKey,
        x,
        y,
        parentId,
      });
      const typedResult = result as any;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(typedResult),
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating component instance: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Copy Instance Overrides Tool
server.tool(
  "get_instance_overrides",
  "[Current-page selection scoped when instanceNodeId is omitted; otherwise node scoped] Get override properties from a component instance. These overrides can be applied to other instances, which will swap them to match the source component.",
  {
    nodeId: z.string().optional().describe("Optional ID of the component instance to get overrides from. If not provided, currently selected instance will be used."),
  },
  async ({ nodeId }: any) => {
    try {
      const result = await sendCommandToFigma("get_instance_overrides", {
        instanceNodeId: nodeId || null
      });
      const typedResult = result as getInstanceOverridesResult;

      return {
        content: [
          {
            type: "text",
            text: typedResult.success
              ? `Successfully got instance overrides: ${typedResult.message}`
              : `Failed to get instance overrides: ${typedResult.message}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error copying instance overrides: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Set Instance Overrides Tool
server.tool(
  "set_instance_overrides",
  "Apply previously copied overrides to selected component instances. Target instances will be swapped to the source component and all copied override properties will be applied.",
  {
    sourceInstanceId: z.string().describe("ID of the source component instance"),
    targetNodeIds: z.array(z.string()).describe("Array of target instance IDs. Currently selected instances will be used.")
  },
  async ({ sourceInstanceId, targetNodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("set_instance_overrides", {
        sourceInstanceId: sourceInstanceId,
        targetNodeIds: targetNodeIds || []
      });
      const typedResult = result as setInstanceOverridesResult;

      if (typedResult.success) {
        const successCount = typedResult.results?.filter(r => r.success).length || 0;
        return {
          content: [
            {
              type: "text",
              text: `Successfully applied ${typedResult.totalCount || 0} overrides to ${successCount} instances.`
            }
          ]
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Failed to set instance overrides: ${typedResult.message}`
            }
          ]
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting instance overrides: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);


// Set Corner Radius Tool
server.tool(
  "set_corner_radius",
  "Set the corner radius of a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    radius: z.number().min(0).describe("Corner radius value"),
    corners: z
      .array(z.boolean())
      .length(4)
      .optional()
      .describe(
        "Optional array of 4 booleans to specify which corners to round [topLeft, topRight, bottomRight, bottomLeft]"
      ),
  },
  async ({ nodeId, radius, corners }: any) => {
    try {
      const result = await sendCommandToFigma("set_corner_radius", {
        nodeId,
        radius,
        corners: corners || [true, true, true, true],
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Set corner radius of node "${typedResult.name}" to ${radius}px`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting corner radius: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Define design strategy prompt
server.prompt(
  "design_strategy",
  "Best practices for working with Figma designs",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `When working with Figma designs, follow these best practices:

1. Start with Document Structure:
   - First use get_document_info() to understand the current document
   - Plan your layout hierarchy before creating elements
   - Create a main container frame for each screen/section

2. Naming Conventions:
   - Use descriptive, semantic names for all elements
   - Follow a consistent naming pattern (e.g., "Login Screen", "Logo Container", "Email Input")
   - Group related elements with meaningful names

3. Layout Hierarchy:
   - Create parent frames first, then add child elements
   - For forms/login screens:
     * Start with the main screen container frame
     * Create a logo container at the top
     * Group input fields in their own containers
     * Place action buttons (login, submit) after inputs
     * Add secondary elements (forgot password, signup links) last

4. Input Fields Structure:
   - Create a container frame for each input field
   - Include a label text above or inside the input
   - Group related inputs (e.g., username/password) together

5. Element Creation:
   - Use create_frame() for containers and input fields
   - Use create_text() for labels, buttons text, and links
   - Set appropriate colors and styles:
     * Use fillColor for backgrounds
     * Use strokeColor for borders
     * Set proper fontWeight for different text elements

6. Mofifying existing elements:
  - use set_text_content() to modify text content.

7. Visual Hierarchy:
   - Position elements in logical reading order (top to bottom)
   - Maintain consistent spacing between elements
   - Use appropriate font sizes for different text types:
     * Larger for headings/welcome text
     * Medium for input labels
     * Standard for button text
     * Smaller for helper text/links

8. Best Practices:
   - Verify each creation with get_node_info()
   - Use parentId to maintain proper hierarchy
   - Group related elements together in frames
   - Keep consistent spacing and alignment

Example Login Screen Structure:
- Login Screen (main frame)
  - Logo Container (frame)
    - Logo (image/text)
  - Welcome Text (text)
  - Input Container (frame)
    - Email Input (frame)
      - Email Label (text)
      - Email Field (frame)
    - Password Input (frame)
      - Password Label (text)
      - Password Field (frame)
  - Login Button (frame)
    - Button Text (text)
  - Helper Links (frame)
    - Forgot Password (text)
    - Don't have account (text)`,
          },
        },
      ],
      description: "Best practices for working with Figma designs",
    };
  }
);

server.prompt(
  "read_design_strategy",
  "Best practices for reading Figma designs",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `When reading Figma designs, follow these best practices:

1. Start with selection:
   - First use read_my_design() to understand the current selection
   - If no selection ask user to select single or multiple nodes
`,
          },
        },
      ],
      description: "Best practices for reading Figma designs",
    };
  }
);

// Text Node Scanning Tool
server.tool(
  "scan_text_nodes",
  "[Node-subtree scoped] Scan all text nodes below a specific Figma node",
  {
    nodeId: z.string().describe("ID of the node to scan"),
  },
  async ({ nodeId }: any) => {
    try {
      // Initial response to indicate we're starting the process
      const initialStatus = {
        type: "text" as const,
        text: "Starting text node scanning. This may take a moment for large designs...",
      };

      // Use the plugin's scan_text_nodes function with chunking flag
      const result = await sendCommandToFigma("scan_text_nodes", {
        nodeId,
        useChunking: true,  // Enable chunking on the plugin side
        chunkSize: 10       // Process 10 nodes at a time
      });

      // If the result indicates chunking was used, format the response accordingly
      if (result && typeof result === 'object' && 'chunks' in result) {
        const typedResult = result as {
          success: boolean,
          totalNodes: number,
          processedNodes: number,
          chunks: number,
          textNodes: Array<any>
        };

        const summaryText = `
        Scan completed:
        - Found ${typedResult.totalNodes} text nodes
        - Processed in ${typedResult.chunks} chunks
        `;

        return {
          content: [
            initialStatus,
            {
              type: "text" as const,
              text: summaryText
            },
            {
              type: "text" as const,
              text: JSON.stringify(typedResult.textNodes, null, 2)
            }
          ],
        };
      }

      // If chunking wasn't used or wasn't reported in the result format, return the result as is
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error scanning text nodes: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Node Type Scanning Tool
server.tool(
  "scan_nodes_by_types",
  "[Node-subtree scoped] Scan for descendants with specific types. Document-root ID 0:0 is unsupported; use get_pages first.",
  {
    nodeId: z.string().describe("ID of the node to scan"),
    types: z.array(z.string()).describe("Array of node types to find in the child nodes (e.g. ['COMPONENT', 'FRAME'])")
  },
  async ({ nodeId, types }: any) => {
    try {
      // Initial response to indicate we're starting the process
      const initialStatus = {
        type: "text" as const,
        text: `Starting node type scanning for types: ${types.join(', ')}...`,
      };

      // Use the plugin's scan_nodes_by_types function
      const result = await sendCommandToFigma("scan_nodes_by_types", {
        nodeId,
        types
      });

      // Format the response
      if (result && typeof result === 'object' && 'matchingNodes' in result) {
        const typedResult = result as {
          success: boolean,
          count: number,
          matchingNodes: Array<{
            id: string,
            name: string,
            type: string,
            bbox: {
              x: number,
              y: number,
              width: number,
              height: number
            }
          }>,
          searchedTypes: Array<string>
        };

        const summaryText = `Scan completed: Found ${typedResult.count} nodes matching types: ${typedResult.searchedTypes.join(', ')}`;

        return {
          content: [
            initialStatus,
            {
              type: "text" as const,
              text: summaryText
            },
            {
              type: "text" as const,
              text: JSON.stringify(typedResult.matchingNodes, null, 2)
            }
          ],
        };
      }

      // If the result is in an unexpected format, return it as is
      return {
        content: [
          initialStatus,
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error scanning nodes by types: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Text Replacement Strategy Prompt
server.prompt(
  "text_replacement_strategy",
  "Systematic approach for replacing text in Figma designs",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Intelligent Text Replacement Strategy

## 1. Analyze Design & Identify Structure
- Scan text nodes to understand the overall structure of the design
- Use AI pattern recognition to identify logical groupings:
  * Tables (rows, columns, headers, cells)
  * Lists (items, headers, nested lists)
  * Card groups (similar cards with recurring text fields)
  * Forms (labels, input fields, validation text)
  * Navigation (menu items, breadcrumbs)
\`\`\`
scan_text_nodes(nodeId: "node-id")
get_node_info(nodeId: "node-id")  // optional
\`\`\`

## 2. Strategic Chunking for Complex Designs
- Divide replacement tasks into logical content chunks based on design structure
- Use one of these chunking strategies that best fits the design:
  * **Structural Chunking**: Table rows/columns, list sections, card groups
  * **Spatial Chunking**: Top-to-bottom, left-to-right in screen areas
  * **Semantic Chunking**: Content related to the same topic or functionality
  * **Component-Based Chunking**: Process similar component instances together

## 3. Progressive Replacement with Verification
- Create a safe copy of the node for text replacement
- Replace text chunk by chunk with continuous progress updates
- After each chunk is processed:
  * Export that section as a small, manageable image
  * Verify text fits properly and maintain design integrity
  * Fix issues before proceeding to the next chunk

\`\`\`
// Clone the node to create a safe copy
clone_node(nodeId: "selected-node-id", x: [new-x], y: [new-y])

// Replace text chunk by chunk
set_multiple_text_contents(
  nodeId: "parent-node-id", 
  text: [
    { nodeId: "node-id-1", text: "New text 1" },
    // More nodes in this chunk...
  ]
)

// Verify chunk with small, targeted image exports
export_node_as_image(nodeId: "chunk-node-id", format: "PNG", scale: 0.5)
\`\`\`

## 4. Intelligent Handling for Table Data
- For tabular content:
  * Process one row or column at a time
  * Maintain alignment and spacing between cells
  * Consider conditional formatting based on cell content
  * Preserve header/data relationships

## 5. Smart Text Adaptation
- Adaptively handle text based on container constraints:
  * Auto-detect space constraints and adjust text length
  * Apply line breaks at appropriate linguistic points
  * Maintain text hierarchy and emphasis
  * Consider font scaling for critical content that must fit

## 6. Progressive Feedback Loop
- Establish a continuous feedback loop during replacement:
  * Real-time progress updates (0-100%)
  * Small image exports after each chunk for verification
  * Issues identified early and resolved incrementally
  * Quick adjustments applied to subsequent chunks

## 7. Final Verification & Context-Aware QA
- After all chunks are processed:
  * Export the entire design at reduced scale for final verification
  * Check for cross-chunk consistency issues
  * Verify proper text flow between different sections
  * Ensure design harmony across the full composition

## 8. Chunk-Specific Export Scale Guidelines
- Scale exports appropriately based on chunk size:
  * Small chunks (1-5 elements): scale 1.0
  * Medium chunks (6-20 elements): scale 0.7
  * Large chunks (21-50 elements): scale 0.5
  * Very large chunks (50+ elements): scale 0.3
  * Full design verification: scale 0.2

## Sample Chunking Strategy for Common Design Types

### Tables
- Process by logical rows (5-10 rows per chunk)
- Alternative: Process by column for columnar analysis
- Tip: Always include header row in first chunk for reference

### Card Lists
- Group 3-5 similar cards per chunk
- Process entire cards to maintain internal consistency
- Verify text-to-image ratio within cards after each chunk

### Forms
- Group related fields (e.g., "Personal Information", "Payment Details")
- Process labels and input fields together
- Ensure validation messages and hints are updated with their fields

### Navigation & Menus
- Process hierarchical levels together (main menu, submenu)
- Respect information architecture relationships
- Verify menu fit and alignment after replacement

## Best Practices
- **Preserve Design Intent**: Always prioritize design integrity
- **Structural Consistency**: Maintain alignment, spacing, and hierarchy
- **Visual Feedback**: Verify each chunk visually before proceeding
- **Incremental Improvement**: Learn from each chunk to improve subsequent ones
- **Balance Automation & Control**: Let AI handle repetitive replacements but maintain oversight
- **Respect Content Relationships**: Keep related content consistent across chunks

Remember that text is never just text—it's a core design element that must work harmoniously with the overall composition. This chunk-based strategy allows you to methodically transform text while maintaining design integrity.`,
          },
        },
      ],
      description: "Systematic approach for replacing text in Figma designs",
    };
  }
);

// Set Multiple Text Contents Tool
server.tool(
  "set_multiple_text_contents",
  "Set multiple text contents parallelly in a node. The reply keeps its existing two prose blocks and appends a JSON receipt carrying the unified `outcome`/`succeeded`/`failed`/`skipped`/`total` alongside every legacy field, so the aggregate cannot be read from a `success` flag that is true whenever a single item succeeded",
  {
    nodeId: z
      .string()
      .describe("The ID of the node containing the text nodes to replace"),
    text: z
      .array(
        z.object({
          nodeId: z.string().describe("The ID of the text node"),
          text: z.string().describe("The replacement text"),
        })
      )
      .describe("Array of text node IDs and their replacement texts"),
  },
  async ({ nodeId, text }: any) => {
    try {
      if (!text || text.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No text provided",
            },
          ],
        };
      }

      // Use the plugin's set_multiple_text_contents function with chunking
      const result = await sendCommandToFigma("set_multiple_text_contents", {
        nodeId,
        text,
      });

      // Phase 4.1 reaches a live consumer here. The prose above the JSON block is
      // unchanged and stays in the same two content positions; the plugin's unified
      // `outcome/succeeded/failed/total/skipped` is APPENDED rather than substituted, so
      // nothing that reads the prose breaks and anything that wants the fields can now
      // parse them. Before this, the wrapper computed prose from the reply and dropped
      // the rest — the fields existed on the wire and reached nobody.
      return { content: textContentsReply(result, text.length) as any };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting multiple text contents: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Annotation Conversion Strategy Prompt
server.prompt(
  "annotation_conversion_strategy",
  "Strategy for converting manual annotations to Figma's native annotations",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Automatic Annotation Conversion
            
## Process Overview

The process of converting manual annotations (numbered/alphabetical indicators with connected descriptions) to Figma's native annotations:

1. Get selected frame/component information
2. Scan and collect all annotation text nodes
3. Scan target UI elements (components, instances, frames)
4. Match annotations to appropriate UI elements
5. Apply native Figma annotations

## Step 1: Get Selection and Initial Setup

First, get the selected frame or component that contains annotations:

\`\`\`typescript
// Get the selected frame/component
const selection = await get_selection();
const selectedNodeId = selection[0].id

// Get available annotation categories for later use
const annotationData = await get_annotations({
  nodeId: selectedNodeId,
  includeCategories: true
});
const categories = annotationData.categories;
\`\`\`

## Step 2: Scan Annotation Text Nodes

Scan all text nodes to identify annotations and their descriptions:

\`\`\`typescript
// Get all text nodes in the selection
const textNodes = await scan_text_nodes({
  nodeId: selectedNodeId
});

// Filter and group annotation markers and descriptions

// Markers typically have these characteristics:
// - Short text content (usually single digit/letter)
// - Specific font styles (often bold)
// - Located in a container with "Marker" or "Dot" in the name
// - Have a clear naming pattern (e.g., "1", "2", "3" or "A", "B", "C")


// Identify description nodes
// Usually longer text nodes near markers or with matching numbers in path
  
\`\`\`

## Step 3: Scan Target UI Elements

Get all potential target elements that annotations might refer to:

\`\`\`typescript
// Scan for all UI elements that could be annotation targets
const targetNodes = await scan_nodes_by_types({
  nodeId: selectedNodeId,
  types: [
    "COMPONENT",
    "INSTANCE",
    "FRAME"
  ]
});
\`\`\`

## Step 4: Match Annotations to Targets

Match each annotation to its target UI element using these strategies in order of priority:

1. **Path-Based Matching**:
   - Look at the marker's parent container name in the Figma layer hierarchy
   - Remove any "Marker:" or "Annotation:" prefixes from the parent name
   - Find UI elements that share the same parent name or have it in their path
   - This works well when markers are grouped with their target elements

2. **Name-Based Matching**:
   - Extract key terms from the annotation description
   - Look for UI elements whose names contain these key terms
   - Consider both exact matches and semantic similarities
   - Particularly effective for form fields, buttons, and labeled components

3. **Proximity-Based Matching** (fallback):
   - Calculate the center point of the marker
   - Find the closest UI element by measuring distances to element centers
   - Consider the marker's position relative to nearby elements
   - Use this method when other matching strategies fail

Additional Matching Considerations:
- Give higher priority to matches found through path-based matching
- Consider the type of UI element when evaluating matches
- Take into account the annotation's context and content
- Use a combination of strategies for more accurate matching

## Step 5: Apply Native Annotations

Convert matched annotations to Figma's native annotations using batch processing:

\`\`\`typescript
// Prepare annotations array for batch processing
const annotationsToApply = Object.values(annotations).map(({ marker, description }) => {
  // Find target using multiple strategies
  const target = 
    findTargetByPath(marker, targetNodes) ||
    findTargetByName(description, targetNodes) ||
    findTargetByProximity(marker, targetNodes);
  
  if (target) {
    // Determine appropriate category based on content
    const category = determineCategory(description.characters, categories);

    // Determine appropriate additional annotationProperty based on content
    const annotationProperty = determineProperties(description.characters, target.type);
    
    return {
      nodeId: target.id,
      labelMarkdown: description.characters,
      categoryId: category.id,
      properties: annotationProperty
    };
  }
  return null;
}).filter(Boolean); // Remove null entries

// Apply annotations in batches using set_multiple_annotations
if (annotationsToApply.length > 0) {
  await set_multiple_annotations({
    nodeId: selectedNodeId,
    annotations: annotationsToApply
  });
}
\`\`\`


This strategy focuses on practical implementation based on real-world usage patterns, emphasizing the importance of handling various UI elements as annotation targets, not just text nodes.`
          },
        },
      ],
      description: "Strategy for converting manual annotations to Figma's native annotations",
    };
  }
);

// Instance Slot Filling Strategy Prompt
server.prompt(
  "swap_overrides_instances",
  "Guide to swap instance overrides between instances",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Swap Component Instance and Override Strategy

## Overview
This strategy enables transferring content and property overrides from a source instance to one or more target instances in Figma, maintaining design consistency while reducing manual work.

## Step-by-Step Process

### 1. Selection Analysis
- Use \`get_selection()\` to identify the parent component or selected instances
- For parent components, scan for instances with \`scan_nodes_by_types({ nodeId: "parent-id", types: ["INSTANCE"] })\`
- Identify custom slots by name patterns (e.g. "Custom Slot*" or "Instance Slot") or by examining text content
- Determine which is the source instance (with content to copy) and which are targets (where to apply content)

### 2. Extract Source Overrides
- Use \`get_instance_overrides()\` to extract customizations from the source instance
- This captures text content, property values, and style overrides
- Command syntax: \`get_instance_overrides({ nodeId: "source-instance-id" })\`
- Look for successful response like "Got component information from [instance name]"

### 3. Apply Overrides to Targets
- Apply captured overrides using \`set_instance_overrides()\`
- Command syntax:
  \`\`\`
  set_instance_overrides({
    sourceInstanceId: "source-instance-id", 
    targetNodeIds: ["target-id-1", "target-id-2", ...]
  })
  \`\`\`

### 4. Verification
- Verify results with \`get_node_info()\` or \`read_my_design()\`
- Confirm text content and style overrides have transferred successfully

## Key Tips
- Always join the appropriate channel first with \`join_channel()\`
- When working with multiple targets, check the full selection with \`get_selection()\`
- Preserve component relationships by using instance overrides rather than direct text manipulation`,
          },
        },
      ],
      description: "Strategy for transferring overrides between component instances in Figma",
    };
  }
);

// Set Layout Mode Tool
server.tool(
  "set_layout_mode",
  "Set the layout mode and wrap behavior of a frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).describe("Layout mode for the frame"),
    layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Whether the auto-layout frame wraps its children")
  },
  async ({ nodeId, layoutMode, layoutWrap }: any) => {
    try {
      const result = await sendCommandToFigma("set_layout_mode", {
        nodeId,
        layoutMode,
        layoutWrap: layoutWrap || "NO_WRAP"
      });
      const typedResult = result as { name: string };
      return {
        content: [
          {
            type: "text",
            text: `Set layout mode of frame "${typedResult.name}" to ${layoutMode}${layoutWrap ? ` with ${layoutWrap}` : ''}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting layout mode: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Padding Tool
server.tool(
  "set_padding",
  "Set padding values for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    paddingTop: z.number().optional().describe("Top padding value"),
    paddingRight: z.number().optional().describe("Right padding value"),
    paddingBottom: z.number().optional().describe("Bottom padding value"),
    paddingLeft: z.number().optional().describe("Left padding value"),
  },
  async ({ nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft }: any) => {
    try {
      const result = await sendCommandToFigma("set_padding", {
        nodeId,
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
      });
      const typedResult = result as { name: string };

      // Create a message about which padding values were set
      const paddingMessages = [];
      if (paddingTop !== undefined) paddingMessages.push(`top: ${paddingTop}`);
      if (paddingRight !== undefined) paddingMessages.push(`right: ${paddingRight}`);
      if (paddingBottom !== undefined) paddingMessages.push(`bottom: ${paddingBottom}`);
      if (paddingLeft !== undefined) paddingMessages.push(`left: ${paddingLeft}`);

      const paddingText = paddingMessages.length > 0
        ? `padding (${paddingMessages.join(', ')})`
        : "padding";

      return {
        content: [
          {
            type: "text",
            text: `Set ${paddingText} for frame "${typedResult.name}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting padding: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Axis Align Tool
server.tool(
  "set_axis_align",
  "Set primary and counter axis alignment for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    primaryAxisAlignItems: z
      .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
      .optional()
      .describe("Primary axis alignment (MIN/MAX = left/right in horizontal, top/bottom in vertical). Note: When set to SPACE_BETWEEN, itemSpacing will be ignored as children will be evenly spaced."),
    counterAxisAlignItems: z
      .enum(["MIN", "MAX", "CENTER", "BASELINE"])
      .optional()
      .describe("Counter axis alignment (MIN/MAX = top/bottom in horizontal, left/right in vertical)")
  },
  async ({ nodeId, primaryAxisAlignItems, counterAxisAlignItems }: any) => {
    try {
      const result = await sendCommandToFigma("set_axis_align", {
        nodeId,
        primaryAxisAlignItems,
        counterAxisAlignItems
      });
      const typedResult = result as { name: string };

      // Create a message about which alignments were set
      const alignMessages = [];
      if (primaryAxisAlignItems !== undefined) alignMessages.push(`primary: ${primaryAxisAlignItems}`);
      if (counterAxisAlignItems !== undefined) alignMessages.push(`counter: ${counterAxisAlignItems}`);

      const alignText = alignMessages.length > 0
        ? `axis alignment (${alignMessages.join(', ')})`
        : "axis alignment";

      return {
        content: [
          {
            type: "text",
            text: `Set ${alignText} for frame "${typedResult.name}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting axis alignment: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Layout Sizing Tool
server.tool(
  "set_layout_sizing",
  "Set horizontal and vertical sizing modes for an auto-layout frame in Figma",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    layoutSizingHorizontal: z
      .enum(["FIXED", "HUG", "FILL"])
      .optional()
      .describe("Horizontal sizing mode (HUG for frames/text only, FILL for auto-layout children only)"),
    layoutSizingVertical: z
      .enum(["FIXED", "HUG", "FILL"])
      .optional()
      .describe("Vertical sizing mode (HUG for frames/text only, FILL for auto-layout children only)")
  },
  async ({ nodeId, layoutSizingHorizontal, layoutSizingVertical }: any) => {
    try {
      const result = await sendCommandToFigma("set_layout_sizing", {
        nodeId,
        layoutSizingHorizontal,
        layoutSizingVertical
      });
      const typedResult = result as { name: string };

      // Create a message about which sizing modes were set
      const sizingMessages = [];
      if (layoutSizingHorizontal !== undefined) sizingMessages.push(`horizontal: ${layoutSizingHorizontal}`);
      if (layoutSizingVertical !== undefined) sizingMessages.push(`vertical: ${layoutSizingVertical}`);

      const sizingText = sizingMessages.length > 0
        ? `layout sizing (${sizingMessages.join(', ')})`
        : "layout sizing";

      return {
        content: [
          {
            type: "text",
            text: `Set ${sizingText} for frame "${typedResult.name}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting layout sizing: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Layout Child Tool (R2.6 item 2.1) — the child side of auto-layout.
//
// ⭐ The reply is pure JSON, not the prose-plus-receipt shape `create_text` carries. That
// shape exists only because existing callers parse `create_text`'s historical first line;
// a tool with no history owes no prose, and a gate reading it needs no embedded-JSON
// helper.
//
// ⛔ The narrow parts of this surface live in the PLUGIN, not in Zod, and deliberately:
// `layoutAlign` publishes all five values Figma defines and the handler refuses STRETCH
// with a message naming its replacement, and `layoutGrow` publishes `number` and the
// handler pins 0|1. Item 2.0 set that precedent — its fontWeight × fontFamily collision
// is a handler refusal, and the live gate asserts `layer === "handler"` on it. A schema
// that rejected these first would answer a semantic decision with a generic enum error
// and make the handler rule unreachable through this transport.
server.tool(
  "set_layout_child",
  "Set how a node participates in its parent's auto-layout: layoutGrow, layoutAlign and layoutPositioning. Requires an auto-layout parent — outside one Figma stores these properties and never applies them, so the whole call is REFUSED rather than silently discarded. layoutAlign does not accept STRETCH: that is the legacy spelling of set_layout_sizing's counter-axis FILL, and one behaviour keeps one spelling. Validate-all-then-write — a rejected parameter leaves the node untouched.",
  {
    nodeId: z
      .string()
      .describe("The ID of the auto-layout CHILD to modify (not the parent frame)"),
    layoutGrow: z
      .number()
      .optional()
      .describe(
        "0 keeps the child's own size along the parent's primary axis; 1 fills it. Only 0 and 1 are accepted, and the refusal comes from the plugin"
      ),
    layoutAlign: z
      .enum(["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"])
      .optional()
      .describe(
        "Counter-axis alignment. STRETCH is published but REFUSED — use set_layout_sizing FILL, so one behaviour keeps one spelling"
      ),
    layoutPositioning: z
      .enum(["AUTO", "ABSOLUTE"])
      .optional()
      .describe(
        "AUTO keeps the child in the parent's flow; ABSOLUTE takes it out. ABSOLUTE cannot be combined with layoutGrow or layoutAlign — position it with move_node instead"
      ),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("set_layout_child", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting layout child: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Constraints Tool (R2.6 item 2.2) — how a node resizes with its parent frame.
//
// ⭐ Pure-JSON reply, like `set_layout_child` and unlike `create_text`: the prose-plus-
// receipt shape exists only to keep existing callers of `create_text`'s historical first
// line working, and a tool with no history owes no prose.
//
// ⚠️ Unlike 2.1, the enum here is published in FULL and refused nowhere. All five values
// Figma defines are legal and distinct, so a closed Zod enum is the honest layer for them
// — there is no semantic decision hiding behind a type error. The refusals this tool does
// own (an in-flow auto-layout child, a PAGE parent, a node with no constraints property)
// are all about the node's CONTEXT, which Zod cannot see, so those live in the plugin and
// stay reachable through the transport.
//
// ⛔ Both axes are optional and the handler merges. That is forced by the platform:
// `constraints` is one object property and Figma refuses a half-object, so a call naming
// one axis must carry the other over. Sending both as required would make every call a
// two-axis overwrite and silently clobber the axis the caller never thought about.
server.tool(
  "set_constraints",
  "Set how a node resizes with its parent frame: horizontal and vertical constraints (MIN, CENTER, MAX, STRETCH, SCALE). Either axis may be omitted and is carried over from the node's current value, because Figma writes both axes as one object. Requires a node that has constraints and a container parent: a top-level node on a PAGE is refused, and so is a child in the flow of an auto-layout frame — auto-layout owns that child's position, so Figma would store the constraint and never apply it. Take the child out of the flow with set_layout_child({ layoutPositioning: \"ABSOLUTE\" }) first. Validate-all-then-write — a rejected parameter leaves the node untouched.",
  {
    nodeId: z
      .string()
      .describe("The ID of the node to constrain (the CHILD, not the parent frame)"),
    horizontal: z
      .enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"])
      .optional()
      .describe(
        "Horizontal constraint: MIN pins to the left, MAX to the right, CENTER keeps the centre offset, STRETCH holds both edges, SCALE resizes proportionally. Omit to keep the node's current horizontal constraint"
      ),
    vertical: z
      .enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"])
      .optional()
      .describe(
        "Vertical constraint: MIN pins to the top, MAX to the bottom, CENTER keeps the centre offset, STRETCH holds both edges, SCALE resizes proportionally. Omit to keep the node's current vertical constraint"
      ),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("set_constraints", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting constraints: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Size Limits Tool (R2.6 item 2.3)
//
// ⚠️ Every parameter is `.nullable().optional()`, and the two halves mean different
// things: OMITTED preserves what the node holds, explicit NULL clears the limit. That is
// R2.3's plugin-data semantics, and it is the only way to express Figma's `number | null`
// honestly — a schema of plain numbers would let a caller set a limit and never remove it.
//
// ⛔ Zod owns the TYPE of each field and nothing else. It cannot see the other three
// fields' stored values, so the pair rule — a minimum above a maximum — is unrepresentable
// here and lives entirely in the plugin, where the node is. That split is deliberate and
// the live gate asserts it: a bad type arrives at `layer: "schema"`, a bad pair at
// `layer: "handler"`. ⭐ `.positive()` is likewise NOT declared here even though it could
// be: the zero refusal belongs with the pair rule it is part of, and splitting one tool's
// numeric validation across two layers is how the two copies start disagreeing.
server.tool(
  "set_size_limits",
  "Set a node's minimum and maximum width and height. Each of the four limits is independent: omit one to leave it as it is, pass a positive number to set it, or pass null to remove it. Requires an auto-layout context: Figma accepts min/max sizing only on auto-layout nodes and their children, so a node whose own layoutMode is unset and whose parent is not an auto-layout frame is refused — give either one an auto-layout with set_layout_mode first. Node type is not the rule; a rectangle inside an auto-layout frame is accepted and a text node outside one is not. Figma rejects a minimum above a maximum, so the two fields of an axis are validated as a PAIR against the values the node already holds — a call naming only minWidth is still checked against the stored maxWidth, and refused before anything is written. Setting a limit that conflicts with the node's current size makes Figma resize the node to fit; the reply reports the size before and after and a `resized` flag. Validate-all-then-write: a rejected parameter leaves all four fields untouched.",
  {
    nodeId: z.string().describe("The ID of the node to limit"),
    minWidth: z
      .number()
      .nullable()
      .optional()
      .describe(
        "Minimum width in pixels, greater than 0. Pass null to remove the limit; omit to keep the node's current value"
      ),
    maxWidth: z
      .number()
      .nullable()
      .optional()
      .describe(
        "Maximum width in pixels, greater than 0 and not below minWidth. Pass null to remove the limit; omit to keep the node's current value"
      ),
    minHeight: z
      .number()
      .nullable()
      .optional()
      .describe(
        "Minimum height in pixels, greater than 0. Pass null to remove the limit; omit to keep the node's current value"
      ),
    maxHeight: z
      .number()
      .nullable()
      .optional()
      .describe(
        "Maximum height in pixels, greater than 0 and not below minHeight. Pass null to remove the limit; omit to keep the node's current value"
      ),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("set_size_limits", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting size limits: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Clips Content Tool (R2.6 item 2.4)
//
// ⭐ Zod owns the WHOLE parameter here, and unlike 2.1 that is not a close call: a boolean
// has exactly two values and both are legal, so there is no semantic decision hiding
// behind a type error the way `layoutAlign: "STRETCH"` hid behind an enum. This follows
// 2.2's split rather than 2.1's. The one refusal the tool owns — a node that does not
// carry `clipsContent` at all — is about the NODE, which Zod cannot see, so it lives in
// the plugin and stays reachable through the transport. The live gate asserts the two
// arrive at different layers, which is the only place the split is visible.
//
// ⚠️ `clipsContent` is REQUIRED, not optional, and it is the only one of the four layout
// tools with no optional field. There is nothing to merge and no "omit to preserve" case:
// a call that named no value would be a read, and `get_node_info` is already the read.
server.tool(
  "set_clips_content",
  "Set whether a frame clips content that extends past its bounds. Requires a node that carries clipsContent — a FRAME, COMPONENT, COMPONENT_SET or INSTANCE; a GROUP is sized by its children and cannot clip them, and is refused. Writing the value the node already holds succeeds and reports changed: false. Because a stored boolean cannot show that anything happened, the reply also reports the node's absoluteRenderBounds and absoluteBoundingBox before and after the write, plus the per-edge overflow between them: an unclipped frame renders past its own box exactly when its content spills out, which is the only reading in the reply that a clipped frame and an unclipped one cannot both produce. A null render measurement means the platform did not answer and is never reported as zero overflow.",
  {
    nodeId: z
      .string()
      .describe("The ID of the frame-like node whose clipping is being set"),
    clipsContent: z
      .boolean()
      .describe(
        "true to clip content to the node's bounds, false to let it render outside them"
      ),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("set_clips_content", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting clips content: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R2.7 item 1.1 — `set_fill`, the first visual tool.
//
// ⛔ THE SCHEMA IS THE POINT OF THIS TOOL, not a formality. `apply_batch`'s `set_fill_color`
// takes `{color:{r,g,b,a}}` while the standalone `set_fill_color` takes flat `r,g,b,a` —
// two shapes behind one name, which R2.4's live gate caught and which the contract had been
// describing as the same shape. `set_fill_color` is `stable` and cannot be repaired, so this
// tool ships ONE nested shape and the old one is documented as legacy.
//
// ⚠️ THE ENUMS LIVE IN ZOD, following 2.2's split rather than 2.1's. Every paint type and
// every blend mode is legal — there is no semantic decision hiding behind a type error the
// way `layoutAlign: "STRETCH"` hid behind an enum in 2.1 — so a wrong value is a caller
// mistake best refused at the transport boundary with the legal set named. The refusals the
// tool OWNS are the ones about the node and about pairs of arguments (`color.a` × `opacity`,
// `gradientTransform` × `angle`), which Zod cannot see; those live in the plugin and stay
// reachable through the transport. ⭐ The live gate asserts the two arrive at DIFFERENT
// layers, which is the only place the split is visible.
// ⛔ THE SCHEMA IS INLINE, AND IT HAS TO BE. `evaluateToolSchema` (contract-lib.mjs:380)
// lifts the third argument's SOURCE TEXT and evaluates it with `z` as the only binding in
// scope, so a hoisted `const fillColorSchema` would generate a contract that throws rather
// than one that is wrong — which is the better failure, but still a failure. That
// constraint is what forces the colour shape to appear TWICE below, once for a solid paint
// and once for a gradient stop.
// ⭐ Two copies of one shape is how two surfaces start disagreeing — the exact hazard
// `create_text` cited for sharing one validator with `set_text_style`. It is held here the
// way the `batch-receipt.mjs` ↔ `code.js` mirror is held: by a PARITY TEST over the
// generated contract (`tests/set-fill.test.mjs`), not by convention. Edit one copy and the
// suite fails.
server.tool(
  "set_fill",
  "Replace a node's fills with one or more paints — solid or gradient (linear, radial, angular, diamond). This is the current fill surface and takes one nested colour shape everywhere, including inside apply_batch's sibling operation; the older set_fill_color remains for compatibility and takes a flat r,g,b,a, which is a different shape for the same job. Pass paints: null to remove every fill; an empty array is refused, because null already says that and two ways to say one thing lets one of them be discarded silently. All paints are validated before anything is written, and the whole array lands as a single assignment, so a bad paint anywhere refuses the entire call without touching the document. The reply reports the fills read back from the node rather than the argument — Figma normalizes a paint on assignment, supplying visible, opacity and blendMode defaults — plus the node's fillStyleId before and after, because writing fills to a node with a paint style bound may detach that style, which is a change to a property the caller never named.",
  {
    nodeId: z.string().describe("The ID of the node whose fills are being replaced"),
    paints: z
      .array(
        z.object({
          type: z
            .enum([
              "SOLID",
              "GRADIENT_LINEAR",
              "GRADIENT_RADIAL",
              "GRADIENT_ANGULAR",
              "GRADIENT_DIAMOND",
            ])
            .describe(
              "The kind of paint. SOLID takes color; the four gradients take gradientStops"
            ),
          color: z
            .object({
              r: z.number().min(0).max(1).describe("Red channel, 0-1"),
              g: z.number().min(0).max(1).describe("Green channel, 0-1"),
              b: z.number().min(0).max(1).describe("Blue channel, 0-1"),
              a: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .describe(
                  "Alpha, 0-1. On a SOLID paint this sets the paint's opacity, so passing both this and opacity is refused rather than silently picking one"
                ),
            })
            .optional()
            .describe(
              "Required for a SOLID paint. A gradient takes its colour from gradientStops, so supplying color alongside a gradient type is REFUSED rather than silently discarded"
            ),
          gradientStops: z
            .array(
              z.object({
                position: z
                  .number()
                  .min(0)
                  .max(1)
                  .describe("Where this stop sits along the ramp, 0-1"),
                color: z
                  .object({
                    r: z.number().min(0).max(1).describe("Red channel, 0-1"),
                    g: z.number().min(0).max(1).describe("Green channel, 0-1"),
                    b: z.number().min(0).max(1).describe("Blue channel, 0-1"),
                    a: z
                      .number()
                      .min(0)
                      .max(1)
                      .optional()
                      .describe(
                        "Alpha, 0-1. A gradient stop carries its own alpha because Figma types stop colours as RGBA and there is no per-stop opacity to collide with. Defaults to 1"
                      ),
                  })
                  .describe("The stop's colour"),
              })
            )
            .min(2)
            .max(64)
            .optional()
            .describe(
              "Required for any GRADIENT_* paint: at least 2 stops, at most 64"
            ),
          gradientTransform: z
            .array(z.array(z.number()).length(3))
            .length(2)
            .optional()
            .describe(
              "The 2x3 matrix Figma actually stores, [[a,b,c],[d,e,f]]. Mutually exclusive with angle — supplying both is refused, because angle is converted into one of these and the loser would read as applied"
            ),
          angle: z
            .number()
            .optional()
            .describe(
              "Aim the gradient in degrees instead of writing a matrix: 0 is left-to-right, 90 is top-to-bottom (clockwise on screen, because Figma's y axis points down). Converted into gradientTransform, and the reply reports both the matrix it produced and the fact that an angle produced it. Mutually exclusive with gradientTransform"
            ),
          scale: z
            .number()
            .positive()
            .optional()
            .describe(
              "Optional multiplier on the gradient's extent, only meaningful alongside angle. Passing it without angle is refused rather than ignored"
            ),
          opacity: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe(
              "Paint opacity, 0-1. On a SOLID this sets the same thing as color.a and passing both is refused"
            ),
          visible: z
            .boolean()
            .optional()
            .describe("Whether this paint is drawn"),
          blendMode: z
            .enum([
              "NORMAL", "DARKEN", "MULTIPLY", "LINEAR_BURN", "COLOR_BURN",
              "LIGHTEN", "SCREEN", "LINEAR_DODGE", "COLOR_DODGE", "OVERLAY",
              "SOFT_LIGHT", "HARD_LIGHT", "DIFFERENCE", "EXCLUSION",
              "HUE", "SATURATION", "COLOR", "LUMINOSITY",
            ])
            .optional()
            .describe(
              "How this paint blends with the ones under it. PASS_THROUGH is absent deliberately: it is a node-level mode for groups, not a paint mode, and Figma refuses it on a paint"
            ),
        })
      )
      .min(1)
      .max(16)
      .nullable()
      .describe(
        "1-16 paints, painted bottom-first the way Figma stores them, or null to remove every fill"
      ),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("set_fill", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting fill: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R2.7 item 1.2 — effects. The flat optional-field object is intentional: ownership
// depends on `type`, so the plugin can refuse a cross-type or unknown field by name rather
// than Zod silently dropping it before the handler can explain what would be discarded.
server.tool(
  "set_effects",
  "Replace a node's effects with shadows or standard blurs. Supported types are DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, and BACKGROUND_BLUR; NOISE, TEXTURE, and newer effect types are intentionally outside this release. Pass effects: null to remove every effect; an empty array is refused because null already says that. Each effect is validated against its type before the one array assignment, so a field that belongs to a different type (for example color on LAYER_BLUR), an unknown field, or a missing required field refuses the whole call without changing the document. Effects are read back from the node rather than echoed, and the reply separately reports effectStyleId before and after because writing effects may detach a bound effect style.",
  {
    nodeId: z.string().describe("The ID of the node whose effects are being replaced"),
    effects: z
      .array(
        z
          .object({
            type: z
              .enum([
                "DROP_SHADOW",
                "INNER_SHADOW",
                "LAYER_BLUR",
                "BACKGROUND_BLUR",
              ])
              .describe("The kind of effect. Only the four R2.7 effect types are supported"),
            color: z
              .object({
                r: z.number().finite().min(0).max(1).describe("Red channel, 0-1"),
                g: z.number().finite().min(0).max(1).describe("Green channel, 0-1"),
                b: z.number().finite().min(0).max(1).describe("Blue channel, 0-1"),
                a: z
                  .number()
                  .finite()
                  .min(0)
                  .max(1)
                  .optional()
                  .describe("Alpha, 0-1. Defaults to 1; a shadow has no second opacity spelling"),
              })
              .optional()
              .describe("Required by DROP_SHADOW and INNER_SHADOW; refused on blur effects"),
            offset: z
              .object({
                x: z.number().finite().describe("Horizontal offset in pixels"),
                y: z.number().finite().describe("Vertical offset in pixels"),
              })
              .optional()
              .describe("Required by DROP_SHADOW and INNER_SHADOW; refused on blur effects"),
            radius: z
              .number()
              .finite()
              .min(0)
              .optional()
              .describe("Required blur or shadow radius, greater than or equal to 0"),
            spread: z
              .number()
              .finite()
              .optional()
              .describe("Optional shadow spread. Its sign is intentionally not constrained"),
            visible: z.boolean().optional().describe("Whether this effect is drawn"),
            blendMode: z
              .enum([
                "NORMAL", "DARKEN", "MULTIPLY", "LINEAR_BURN", "COLOR_BURN",
                "LIGHTEN", "SCREEN", "LINEAR_DODGE", "COLOR_DODGE", "OVERLAY",
                "SOFT_LIGHT", "HARD_LIGHT", "DIFFERENCE", "EXCLUSION",
                "HUE", "SATURATION", "COLOR", "LUMINOSITY",
              ])
              .optional()
              .describe("Optional shadow blend mode. PASS_THROUGH is layer-only and is refused"),
            showShadowBehindNode: z
              .boolean()
              .optional()
              .describe("Optional DROP_SHADOW-only setting; refused on every other effect type"),
          })
          .passthrough()
      )
      .min(1)
      .max(16)
      .nullable()
      .describe("1-16 effects in Figma draw order, or null to remove every effect"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("set_effects", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting effects: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// R2.7 item 1.3 — layer opacity and layer blend mode.
//
// ⛔ These are deliberately two small, standalone write tools. They expose properties from
// Figma's BlendMixin, but do NOT add either property to filterFigmaNode: get_node_info is
// stable, and widening its result would require the next public-contract bump. Each new
// tool instead reports the plugin node's own post-write reading in its additive-preview
// receipt. That keeps 1.3 additive after item 1.2 spent 1.9.0.
server.tool(
  "set_opacity",
  "Set a node's layer opacity, from 0 (fully transparent) through 1 (fully opaque). This is the node-level Layer panel value, distinct from a paint's or effect's opacity. It requires a node with Figma's opacity surface; a page or document root is refused rather than treated as opacity 1. The one property assignment is read back from the plugin node, so the receipt reports the stored opacity and its previous value rather than echoing the request. get_node_info intentionally does not gain an opacity field in R2.7: that stable read result would need a new public-contract version, so use this receipt to observe the write.",
  {
    nodeId: z.string().describe("The ID of the node whose layer opacity is being set"),
    opacity: z
      .number()
      .finite()
      .min(0)
      .max(1)
      .describe("Layer opacity, 0-1 inclusive; 0 is a real fully transparent value"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("set_opacity", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting opacity: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "set_blend_mode",
  "Set a node's layer blend mode, the Layer panel setting that controls how the whole node blends with layers behind it. This is distinct from paint and effect blend modes. The full layer enum is accepted here, including PASS_THROUGH; PASS_THROUGH is intentionally excluded only from paint and effect tools. It requires a node with Figma's blendMode surface. The one property assignment is read back from the plugin node, so the receipt reports the stored mode and its previous value rather than echoing the request. get_node_info intentionally does not gain a blendMode field in R2.7: that stable read result would need a new public-contract version, so use this receipt to observe the write.",
  {
    nodeId: z.string().describe("The ID of the node whose layer blend mode is being set"),
    blendMode: z
      .enum([
        "PASS_THROUGH",
        "NORMAL",
        "DARKEN",
        "MULTIPLY",
        "LINEAR_BURN",
        "COLOR_BURN",
        "LIGHTEN",
        "SCREEN",
        "LINEAR_DODGE",
        "COLOR_DODGE",
        "OVERLAY",
        "SOFT_LIGHT",
        "HARD_LIGHT",
        "DIFFERENCE",
        "EXCLUSION",
        "HUE",
        "SATURATION",
        "COLOR",
        "LUMINOSITY",
      ])
      .describe(
        "Layer blend mode. PASS_THROUGH is valid here because this is a node-level setting, unlike paint and effect blend modes"
      ),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("set_blend_mode", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting blend mode: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Item Spacing Tool
server.tool(
  "set_item_spacing",
  "Set distance between children in an auto-layout frame",
  {
    nodeId: z.string().describe("The ID of the frame to modify"),
    itemSpacing: z.number().optional().describe("Distance between children. Note: This value will be ignored if primaryAxisAlignItems is set to SPACE_BETWEEN."),
    counterAxisSpacing: z.number().optional().describe("Distance between wrapped rows/columns. Only works when layoutWrap is set to WRAP.")
  },
  async ({ nodeId, itemSpacing, counterAxisSpacing}: any) => {
    try {
      const params: any = { nodeId };
      if (itemSpacing !== undefined) params.itemSpacing = itemSpacing;
      if (counterAxisSpacing !== undefined) params.counterAxisSpacing = counterAxisSpacing;
      
      const result = await sendCommandToFigma("set_item_spacing", params);
      const typedResult = result as { name: string, itemSpacing?: number, counterAxisSpacing?: number };

      let message = `Updated spacing for frame "${typedResult.name}":`;
      if (itemSpacing !== undefined) message += ` itemSpacing=${itemSpacing}`;
      if (counterAxisSpacing !== undefined) message += ` counterAxisSpacing=${counterAxisSpacing}`;

      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting spacing: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// A tool to get Figma Prototyping Reactions from multiple nodes
server.tool(
  "get_reactions",
  "[Requested-node-subtrees scoped, read-only] Get Figma prototyping reactions, including CHANGE_TO interactive-component variant transitions. The payload states API coverage limits; an empty result is not proof that the file has no motion. If connector visualization is desired, the optional reaction_to_connector_strategy prompt can transform this read result.",
  {
    nodeIds: z
      .array(z.string())
      .min(1)
      .describe("Array of root node IDs whose subtrees should be searched"),
  },
  async ({ nodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("get_reactions", { nodeIds });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting reactions: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Connectors Tool
server.tool(
  "set_default_connector",
  "Set a copied connector node as the default connector",
  {
    connectorId: z.string().optional().describe("The ID of the connector node to set as default")
  },
  async ({ connectorId }: any) => {
    try {
      const result = await sendCommandToFigma("set_default_connector", {
        connectorId
      });

      return {
        content: [
          {
            type: "text",
            text: `Default connector set: ${JSON.stringify(result)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting default connector: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Connect Nodes Tool
server.tool(
  "create_connections",
  "Create connections between nodes using the default connector style",
  {
    connections: z.array(z.object({
      startNodeId: z.string().describe("ID of the starting node"),
      endNodeId: z.string().describe("ID of the ending node"),
      text: z.string().optional().describe("Optional text to display on the connector")
    })).describe("Array of node connections to create")
  },
  async ({ connections }: any) => {
    try {
      if (!connections || connections.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No connections provided"
            }
          ]
        };
      }

      const result = await sendCommandToFigma("create_connections", {
        connections
      });

      return {
        content: [
          {
            type: "text",
            text: `Created ${connections.length} connections: ${JSON.stringify(result)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating connections: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      };
    }
  }
);

// Set Focus Tool
server.tool(
  "set_focus",
  "Set focus on a specific node in Figma by selecting it and scrolling viewport to it",
  {
    nodeId: z.string().describe("The ID of the node to focus on"),
  },
  async ({ nodeId }: any) => {
    try {
      const result = await sendCommandToFigma("set_focus", { nodeId });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            text: `Focused on node "${typedResult.name}" (ID: ${typedResult.id})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting focus: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Selections Tool
server.tool(
  "set_selections",
  "Set selection to multiple nodes in Figma and scroll viewport to show them",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to select"),
  },
  async ({ nodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("set_selections", { nodeIds });
      const typedResult = result as { selectedNodes: Array<{ name: string; id: string }>; count: number };
      return {
        content: [
          {
            type: "text",
            text: `Selected ${typedResult.count} nodes: ${typedResult.selectedNodes.map(node => `"${node.name}" (${node.id})`).join(', ')}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting selections: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Strategy for converting Figma prototype reactions to connector lines
server.prompt(
  "reaction_to_connector_strategy",
  "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'",
  (extra) => {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Strategy: Convert Figma Prototype Reactions to Connector Lines

## Goal
Process the JSON output from the \`get_reactions\` tool to generate an array of connection objects suitable for the \`create_connections\` tool. This visually represents prototype flows as connector lines on the Figma canvas.

## Input Data
You will receive JSON data from the \`get_reactions\` tool. This data contains an array of nodes, each with potential reactions. A typical reaction object looks like this:
\`\`\`json
{
  "trigger": { "type": "ON_CLICK" },
  "action": {
    "type": "NAVIGATE",
    "destinationId": "destination-node-id",
    "navigationTransition": { ... },
    "preserveScrollPosition": false
  }
}
\`\`\`

## Step-by-Step Process

### 1. Preparation & Context Gathering
   - **Action:** Call \`read_my_design\` on the relevant node(s) to get context about the nodes involved (names, types, etc.). This helps in generating meaningful connector labels later.
   - **Action:** Call \`set_default_connector\` **without** the \`connectorId\` parameter.
   - **Check Result:** Analyze the response from \`set_default_connector\`.
     - If it confirms a default connector is already set (e.g., "Default connector is already set"), proceed to Step 2.
     - If it indicates no default connector is set (e.g., "No default connector set..."), you **cannot** proceed with \`create_connections\` yet. Inform the user they need to manually copy a connector from FigJam, paste it onto the current page, select it, and then you can run \`set_default_connector({ connectorId: "SELECTED_NODE_ID" })\` before attempting \`create_connections\`. **Do not proceed to Step 2 until a default connector is confirmed.**

### 2. Filter and Transform Reactions from \`get_reactions\` Output
   - **Iterate:** Go through the JSON array provided by \`get_reactions\`. For each node in the array:
     - Iterate through its \`reactions\` array.
   - **Filter:** Keep only reactions where the \`action\` meets these criteria:
     - Has a \`type\` that implies a connection (e.g., \`NAVIGATE\`, \`OPEN_OVERLAY\`, \`SWAP_OVERLAY\`). **Ignore** types like \`CHANGE_TO\`, \`CLOSE_OVERLAY\`, etc.
     - Has a valid \`destinationId\` property.
   - **Extract:** For each valid reaction, extract the following information:
     - \`sourceNodeId\`: The ID of the node the reaction belongs to (from the outer loop).
     - \`destinationNodeId\`: The value of \`action.destinationId\`.
     - \`actionType\`: The value of \`action.type\`.
     - \`triggerType\`: The value of \`trigger.type\`.

### 3. Generate Connector Text Labels
   - **For each extracted connection:** Create a concise, descriptive text label string.
   - **Combine Information:** Use the \`actionType\`, \`triggerType\`, and potentially the names of the source/destination nodes (obtained from Step 1's \`read_my_design\` or by calling \`get_node_info\` if necessary) to generate the label.
   - **Example Labels:**
     - If \`triggerType\` is "ON\_CLICK" and \`actionType\` is "NAVIGATE": "On click, navigate to [Destination Node Name]"
     - If \`triggerType\` is "ON\_DRAG" and \`actionType\` is "OPEN\_OVERLAY": "On drag, open [Destination Node Name] overlay"
   - **Keep it brief and informative.** Let this generated string be \`generatedText\`.

### 4. Prepare the \`connections\` Array for \`create_connections\`
   - **Structure:** Create a JSON array where each element is an object representing a connection.
   - **Format:** Each object in the array must have the following structure:
     \`\`\`json
     {
       "startNodeId": "sourceNodeId_from_step_2",
       "endNodeId": "destinationNodeId_from_step_2",
       "text": "generatedText_from_step_3"
     }
     \`\`\`
   - **Result:** This final array is the value you will pass to the \`connections\` parameter when calling the \`create_connections\` tool.

### 5. Execute Connection Creation
   - **Action:** Call the \`create_connections\` tool, passing the array generated in Step 4 as the \`connections\` argument.
   - **Verify:** Check the response from \`create_connections\` to confirm success or failure.

This detailed process ensures you correctly interpret the reaction data, prepare the necessary information, and use the appropriate tools to create the connector lines.`
          },
        },
      ],
      description: "Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'",
    };
  }
);


// Define command types and parameters
type FigmaCommand =
  | "get_runtime_info"
  | "get_document_info"
  | "get_pages"
  | "set_current_page"
  | "create_page"
  | "get_plugin_data"
  | "set_plugin_data"
  | "apply_batch"
  | "get_selection"
  | "get_node_info"
  | "get_nodes_info"
  | "read_my_design"
  | "create_rectangle"
  | "create_frame"
  | "create_text"
  | "set_fill_color"
  | "set_stroke_color"
  | "move_node"
  | "resize_node"
  | "delete_node"
  | "delete_multiple_nodes"
  | "get_styles"
  | "get_local_components"
  | "get_variables"
  | "get_variable_capabilities"
  | "add_variable_mode"
  | "set_variable_value"
  | "create_variable"
  | "delete_variable"
  | "remove_variable_mode"
  | "create_variable_collection"
  | "rename_variable_mode"
  | "set_variable_metadata"
  | "bind_variable_to_node"
  | "bind_variable_to_paint"
  | "get_node_variables"
  | "get_available_fonts"
  | "check_fonts"
  | "create_component_instance"
  | "get_instance_overrides"
  | "set_instance_overrides"
  | "export_node_as_image"
  | "join"
  | "set_corner_radius"
  | "clone_node"
  | "set_text_content"
  | "set_text_style"
  | "scan_text_nodes"
  | "set_multiple_text_contents"
  | "get_annotations"
  | "set_annotation"
  | "set_multiple_annotations"
  | "scan_nodes_by_types"
  | "set_layout_mode"
  | "set_padding"
  | "set_axis_align"
  | "set_layout_sizing"
  | "set_item_spacing"
  | "set_layout_child"
  | "set_constraints"
  | "set_size_limits"
  | "set_clips_content"
  | "set_fill"
  | "set_effects"
  | "set_opacity"
  | "set_blend_mode"
  | "create_node_from_svg"
  | "get_reactions"
  | "set_default_connector"
  | "create_connections"
  | "set_focus"
  | "set_selections"
  | "set_image_fill"
  | "rename_node"
  | "create_section"
  | "set_parent";

type CommandParams = {
  get_runtime_info: Record<string, never>;
  get_document_info: {
    summary?: boolean;
    limit?: number;
    offset?: number;
    familyLimit?: number;
  };
  get_pages: { includeChildCount?: boolean };
  set_current_page: { pageId: string };
  create_page: {
    name: string;
    onDuplicate?: "error" | "allow";
    index?: number;
  };
  get_plugin_data: {
    nodeId: string;
    key?: string;
    namespace?: string;
    limit?: number;
    offset?: number;
    maxValueBytes?: number;
  };
  set_plugin_data: {
    nodeId: string;
    key: string;
    value: string | null;
    namespace?: string;
  };
  apply_batch: {
    operations: Array<{
      id: string;
      op: string;
      nodeId: string;
      params?: Record<string, unknown>;
    }>;
    onError?: "stop" | "continue";
    prevalidateOnly?: boolean;
    timeBudgetMs?: number;
    maxResultBytes?: number;
    chunkPauseMs?: number;
  };
  get_selection: Record<string, never>;
  get_node_info: { nodeId: string };
  get_nodes_info: { nodeIds: string[] };
  read_my_design: Record<string, never>;
  create_rectangle: {
    x: number;
    y: number;
    width: number;
    height: number;
    name?: string;
    parentId?: string;
  };
  create_frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    name?: string;
    parentId?: string;
    fillColor?: { r: number; g: number; b: number; a?: number };
    strokeColor?: { r: number; g: number; b: number; a?: number };
    strokeWeight?: number;
  };
  create_text: {
    x: number;
    y: number;
    text: string;
    fontSize?: number;
    fontWeight?: number;
    fontColor?: { r: number; g: number; b: number; a?: number };
    name?: string;
    parentId?: string;
    // R2.6 item 2.0 — the same twelve set_text_style writes, on the create surface.
    fontFamily?: string;
    fontStyle?: string;
    lineHeight?: { value?: number; unit: "PIXELS" | "PERCENT" | "AUTO" };
    letterSpacing?: { value: number; unit: "PIXELS" | "PERCENT" };
    textCase?:
      | "ORIGINAL"
      | "UPPER"
      | "LOWER"
      | "TITLE"
      | "SMALL_CAPS"
      | "SMALL_CAPS_FORCED";
    textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
    textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
    textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
    paragraphSpacing?: number;
    paragraphIndent?: number;
    textAutoResize?: "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | "TRUNCATE";
  };
  set_fill_color: {
    nodeId: string;
    r: number;
    g: number;
    b: number;
    a?: number;
  };
  set_stroke_color: {
    nodeId: string;
    r: number;
    g: number;
    b: number;
    a?: number;
    weight?: number;
  };
  move_node: {
    nodeId: string;
    x: number;
    y: number;
  };
  resize_node: {
    nodeId: string;
    width: number;
    height: number;
  };
  delete_node: {
    nodeId: string;
  };
  delete_multiple_nodes: {
    nodeIds: string[];
  };
  get_styles: Record<string, never>;
  get_local_components: {
    summary?: boolean;
    limit?: number;
    offset?: number;
    familyLimit?: number;
    pages?: string[];
    timeBudgetMs?: number;
    sessionLimit?: number;
  };
  get_variables: {
    types?: Array<"COLOR" | "FLOAT" | "STRING" | "BOOLEAN">;
  };
  get_variable_capabilities: Record<string, never>;
  add_variable_mode: {
    collectionId: string;
    name: string;
  };
  set_variable_value: {
    variableId: string;
    modeId: string;
    // Exactly one is required at the public MCP surface; the command type retains both
    // optional because TypeScript cannot express that XOR without making every caller
    // carry a synthetic union. The server and plugin both reject neither/both before a write.
    value?:
      | string
      | number
      | boolean
      | { r: number; g: number; b: number; a?: number };
    aliasOf?: string;
  };
  create_variable: {
    collectionId: string;
    name: string;
    resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  };
  delete_variable: {
    variableId: string;
    confirm: true;
  };
  remove_variable_mode: {
    collectionId: string;
    modeId: string;
    confirm: true;
  };
  create_variable_collection: {
    name: string;
    id?: string;
    identityKey?: string;
  };
  rename_variable_mode: {
    collectionId: string;
    modeId: string;
    name: string;
  };
  set_variable_metadata: {
    variableId: string;
    name?: string;
    description?: string;
    scopes?: string[];
  };
  bind_variable_to_node: {
    nodeId: string;
    field: string;
    variableId: string;
  };
  bind_variable_to_paint: {
    nodeId: string;
    paintTarget: "fills" | "strokes";
    paintIndex: number;
    variableId: string;
  };
  get_node_variables: { nodeId: string };
  get_available_fonts: {
    family?: string;
    limit?: number;
    offset?: number;
    timeBudgetMs?: number;
  };
  check_fonts: {
    fonts: Array<{ family: string; style: string }>;
    timeBudgetMs?: number;
  };
  create_component_instance: {
    componentId?: string;
    componentKey?: string;
    x: number;
    y: number;
    parentId?: string;
  };
  get_instance_overrides: {
    instanceNodeId: string | null;
  };
  set_instance_overrides: {
    targetNodeIds: string[];
    sourceInstanceId: string;
  };
  export_node_as_image: {
    nodeId: string;
    format?: "PNG" | "JPG" | "SVG" | "PDF";
    scale?: number;
    allowLargeExport?: boolean;
  };
  join: {
    channel: string;
  };
  set_corner_radius: {
    nodeId: string;
    radius: number;
    corners?: boolean[];
  };
  clone_node: {
    nodeId: string;
    x?: number;
    y?: number;
  };
  set_text_content: {
    nodeId: string;
    text: string;
  };
  set_text_style: {
    nodeId: string;
    fontFamily?: string;
    fontStyle?: string;
    fontSize?: number;
    lineHeight?: { value?: number; unit: "PIXELS" | "PERCENT" | "AUTO" };
    letterSpacing?: { value: number; unit: "PIXELS" | "PERCENT" };
    textCase?:
      | "ORIGINAL"
      | "UPPER"
      | "LOWER"
      | "TITLE"
      | "SMALL_CAPS"
      | "SMALL_CAPS_FORCED";
    textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
    textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
    textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
    paragraphSpacing?: number;
    paragraphIndent?: number;
    textAutoResize?: "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | "TRUNCATE";
  };
  scan_text_nodes: {
    nodeId: string;
    useChunking: boolean;
    chunkSize: number;
  };
  set_multiple_text_contents: {
    nodeId: string;
    text: Array<{ nodeId: string; text: string }>;
  };
  get_annotations: {
    nodeId?: string;
    includeCategories?: boolean;
  };
  set_annotation: {
    nodeId: string;
    annotationId?: string;
    labelMarkdown: string;
    categoryId?: string;
    properties?: Array<{ type: string }>;
  };
  set_multiple_annotations: SetMultipleAnnotationsParams;
  scan_nodes_by_types: {
    nodeId: string;
    types: Array<string>;
  };
  set_layout_mode: {
    nodeId: string;
    layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL";
    layoutWrap?: "NO_WRAP" | "WRAP";
  };
  set_padding: {
    nodeId: string;
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
  };
  set_axis_align: {
    nodeId: string;
    primaryAxisAlignItems?: "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN";
    counterAxisAlignItems?: "MIN" | "MAX" | "CENTER" | "BASELINE";
  };
  set_layout_sizing: {
    nodeId: string;
    layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
    layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  };
  set_item_spacing: {
    nodeId: string;
    itemSpacing?: number;
    counterAxisSpacing?: number;
  };
  set_layout_child: {
    nodeId: string;
    layoutGrow?: number;
    layoutAlign?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
    layoutPositioning?: "AUTO" | "ABSOLUTE";
  };
  set_constraints: {
    nodeId: string;
    horizontal?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
    vertical?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
  };
  // ⛔ `number | null`, not `number` — null is the clear, and typing it away here would
  // make the one call that removes a limit unrepresentable at the transport boundary.
  set_size_limits: {
    nodeId: string;
    minWidth?: number | null;
    maxWidth?: number | null;
    minHeight?: number | null;
    maxHeight?: number | null;
  };
  // ⛔ REQUIRED, not `clipsContent?`. The other three layout tools all have optional
  // fields because they merge with what the node holds; this one has nothing to merge,
  // and an optional boolean would make "no value supplied" indistinguishable from `false`
  // at the transport boundary — the same absence-reads-as-an-answer trap the receipt's
  // `renderBoundsChanged: null` exists to avoid one layer down.
  set_clips_content: {
    nodeId: string;
    clipsContent: boolean;
  };
  // ⛔ `paints` is REQUIRED and NULLABLE, which is a different shape from both of its
  // neighbours and deliberately so. `set_clips_content` is required-non-null because it has
  // nothing to merge; `set_size_limits` is optional-and-nullable because each field merges
  // with what the node holds. Here there is nothing to merge — a fills write replaces the
  // array wholesale — but removal is a real operation, so `null` is the clear (R2.3's
  // semantics) while ABSENT is refused as "wrote nothing". An optional `paints` would make
  // "remove every fill" and "you forgot an argument" the same call.
  set_fill: {
    nodeId: string;
    paints: Array<{
      type:
        | "SOLID"
        | "GRADIENT_LINEAR"
        | "GRADIENT_RADIAL"
        | "GRADIENT_ANGULAR"
        | "GRADIENT_DIAMOND";
      color?: { r: number; g: number; b: number; a?: number };
      gradientStops?: Array<{
        position: number;
        color: { r: number; g: number; b: number; a?: number };
      }>;
      gradientTransform?: number[][];
      angle?: number;
      scale?: number;
      opacity?: number;
      visible?: boolean;
      blendMode?: string;
    }> | null;
  };
  set_effects: {
    nodeId: string;
    effects: Array<{
      type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
      color?: { r: number; g: number; b: number; a?: number };
      offset?: { x: number; y: number };
      radius?: number;
      spread?: number;
      visible?: boolean;
      blendMode?: string;
      showShadowBehindNode?: boolean;
      [key: string]: unknown;
    }> | null;
  };
  set_opacity: {
    nodeId: string;
    opacity: number;
  };
  set_blend_mode: {
    nodeId: string;
    blendMode:
      | "PASS_THROUGH"
      | "NORMAL"
      | "DARKEN"
      | "MULTIPLY"
      | "LINEAR_BURN"
      | "COLOR_BURN"
      | "LIGHTEN"
      | "SCREEN"
      | "LINEAR_DODGE"
      | "COLOR_DODGE"
      | "OVERLAY"
      | "SOFT_LIGHT"
      | "HARD_LIGHT"
      | "DIFFERENCE"
      | "EXCLUSION"
      | "HUE"
      | "SATURATION"
      | "COLOR"
      | "LUMINOSITY";
  };
  get_reactions: { nodeIds: string[] };
  set_default_connector: {
    connectorId?: string | undefined;
  };
  create_connections: {
    connections: Array<{
      startNodeId: string;
      endNodeId: string;
      text?: string;
    }>;
  };
  set_focus: {
    nodeId: string;
  };
  set_selections: {
    nodeIds: string[];
  };
  set_image_fill: {
    nodeId: string;
    imageBase64: string;
    scaleMode?: "FILL" | "FIT" | "CROP" | "TILE";
    imageTransform?: number[][];
  };
  create_node_from_svg: {
    svg: string;
    x?: number;
    y?: number;
    name?: string;
    parentId?: string;
  };
  rename_node: {
    nodeId: string;
    name: string;
  };
  create_section: {
    x: number;
    y: number;
    width: number;
    height: number;
    name?: string;
  };
  set_parent: {
    nodeId: string;
    parentId: string;
    x?: number;
    y?: number;
    index?: number;
  };

};


// Helper function to process Figma node responses
function processFigmaNodeResponse(result: unknown): any {
  if (!result || typeof result !== "object") {
    return result;
  }

  // Check if this looks like a node response
  const resultObj = result as Record<string, unknown>;
  if ("id" in resultObj && typeof resultObj.id === "string") {
    // It appears to be a node response, log the details
    console.info(
      `Processed Figma node: ${resultObj.name || "Unknown"} (ID: ${resultObj.id
      })`
    );

    if ("x" in resultObj && "y" in resultObj) {
      console.debug(`Node position: (${resultObj.x}, ${resultObj.y})`);
    }

    if ("width" in resultObj && "height" in resultObj) {
      console.debug(`Node dimensions: ${resultObj.width}×${resultObj.height}`);
    }
  }

  return result;
}

// Update the connectToFigma function
function connectToFigma(port: number = RELAY_PORT) {
  // Do not create parallel sockets while the initial connection is still opening.
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    logger.info('Figma socket is already connected or connecting');
    return;
  }

  const wsUrl = serverUrl === 'localhost' ? `${WS_URL}:${port}` : WS_URL;
  logger.info(`Connecting to Figma socket server at ${wsUrl}...`);
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    logger.info('Connected to Figma socket server');
    // Reset channel on new connection
    currentChannel = null;
    runtimeCompatibility = {
      status: "not_checked",
      checkedAt: null,
      issues: ["Join a channel to run the server/plugin compatibility preflight."],
      plugin: null,
    };
  });

  ws.on("message", (data: any) => {
    try {
      // Define a more specific type with an index signature to allow any property access
      interface ProgressMessage {
        message: FigmaResponse | any;
        type?: string;
        id?: string;
        [key: string]: any; // Allow any other properties
      }

      const json = JSON.parse(data) as ProgressMessage;

      // Handle progress updates
      if (json.type === 'progress_update') {
        const progressData = json.message.data as CommandProgressUpdate;
        const requestId = json.id || '';

        if (requestId && pendingRequests.has(requestId)) {
          const request = pendingRequests.get(requestId)!;

          // Update last activity timestamp
          request.lastActivity = Date.now();

          // Reset the timeout to prevent timeouts during long-running operations
          clearTimeout(request.timeout);

          // A heavy read sends its "started" update within milliseconds, so without
          // this max() the larger budget would be discarded almost immediately and
          // the command would silently fall back to 60s. The binding constraint on a
          // scan is the gap BETWEEN updates — a page's loadAsync + synchronous
          // findAllWithCriteria run with no chance to emit — so the declared budget
          // has to survive the reset, not just arm the first window.
          const inactivityMs = Math.max(60000, request.timeoutMs);
          request.timeout = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
              logger.error(`Request ${requestId} timed out after extended period of inactivity`);
              pendingRequests.delete(requestId);
              latchRuntimeAfterTimeout(request.command);
              request.reject(new Error(`Request to Figma timed out${runtimeDiagnosticSuffix()}`));
            }
          }, inactivityMs);

          // Log progress
          logger.info(`Progress update for ${progressData.commandType}: ${progressData.progress}% - ${progressData.message}`);

          // For completed updates, we could resolve the request early if desired
          if (progressData.status === 'completed' && progressData.progress === 100) {
            // Optionally resolve early with partial data
            // request.resolve(progressData.payload);
            // pendingRequests.delete(requestId);

            // Instead, just log the completion, wait for final result from Figma
            logger.info(`Operation ${progressData.commandType} completed, waiting for final result`);
          }
        }
        return;
      }

      // Handle regular responses
      const myResponse = json.message;
      logger.debug(`Received message: ${JSON.stringify(myResponse)}`);
      logger.log('myResponse' + JSON.stringify(myResponse));

      // Handle response to a request
      if (myResponse?.id && pendingRequests.has(myResponse.id)) {
        const request = pendingRequests.get(myResponse.id)!;
        clearTimeout(request.timeout);

        if (myResponse.error) {
          logger.error(`Error from Figma: ${myResponse.error}`);
          request.reject(new Error(`${myResponse.error}${runtimeDiagnosticSuffix()}`));
        } else if (Object.prototype.hasOwnProperty.call(myResponse, "result")) {
          request.resolve(myResponse.result);
        } else {
          request.reject(
            new Error(`Malformed response from Figma${runtimeDiagnosticSuffix()}`)
          );
        }

        pendingRequests.delete(myResponse.id);
      } else {
        // Handle broadcast messages or events
        logger.info(`Received broadcast message: ${JSON.stringify(myResponse)}`);
      }
    } catch (error) {
      logger.error(`Error parsing message: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ws.on('error', (error) => {
    logger.error(`Socket error: ${error}`);
  });

  ws.on('close', () => {
    logger.info('Disconnected from Figma socket server');
    ws = null;
    currentChannel = null;
    runtimeCompatibility = {
      status: "not_checked",
      checkedAt: null,
      issues: ["The relay connection closed; join a channel again."],
      plugin: null,
    };

    // Reject all pending requests
    for (const [id, request] of pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error(`Connection closed${runtimeDiagnosticSuffix()}`));
      pendingRequests.delete(id);
    }

    // Attempt to reconnect
    logger.info('Attempting to reconnect in 2 seconds...');
    setTimeout(() => connectToFigma(port), 2000);
  });
}

// Function to join a channel
async function joinChannel(channelName: string): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected to Figma");
  }

  try {
    await sendCommandToFigma("join", { channel: channelName });
    currentChannel = channelName;
    logger.info(`Joined channel: ${channelName}`);
    const compatibility = await refreshRuntimeCompatibility();
    if (compatibility.status !== "compatible") {
      throw new Error(
        `Server/plugin compatibility preflight failed: ${compatibility.issues.join(" ")}${runtimeDiagnosticSuffix()}`
      );
    }
  } catch (error) {
    logger.error(`Failed to join channel: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Function to send commands to Figma
function sendCommandToFigma(
  command: FigmaCommand,
  params: unknown = {},
  timeoutMs: number = 30000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // If not connected, try to connect first
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToFigma();
      reject(new Error(`Not connected to Figma. Attempting to connect...${runtimeDiagnosticSuffix()}`));
      return;
    }

    // Check if we need a channel for this command
    const requiresChannel = command !== "join";
    if (requiresChannel && !currentChannel) {
      reject(new Error(`Must join a channel before sending commands${runtimeDiagnosticSuffix()}`));
      return;
    }

    const bypassesPreflight = command === "join" || command === "get_runtime_info";
    if (!bypassesPreflight && runtimeCompatibility.status !== "compatible") {
      reject(
        new Error(
          `Runtime compatibility preflight has not passed. Call join_channel, then get_runtime_info before document operations. ${runtimeCompatibility.issues.join(" ")}${runtimeDiagnosticSuffix()}`
        )
      );
      return;
    }

    const id = uuidv4();
    const request = {
      id,
      type: command === "join" ? "join" : "message",
      ...(command === "join"
        ? { channel: (params as any).channel }
        : { channel: currentChannel }),
      message: {
        id,
        command,
        params: {
          ...(params as any),
          commandId: id, // Include the command ID in params
        },
      },
    };

    // Set timeout for request
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        logger.error(`Request ${id} to Figma timed out after ${timeoutMs / 1000} seconds`);
        latchRuntimeAfterTimeout(command);
        reject(new Error(`Request to Figma timed out${runtimeDiagnosticSuffix()}`));
      }
    }, timeoutMs);

    // Store the promise callbacks to resolve/reject later
    pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
      command,
      timeoutMs,
      lastActivity: Date.now()
    });

    // Send the request
    logger.info(`Sending command to Figma: ${command}`);
    logger.debug(`Request details: ${JSON.stringify(request)}`);
    ws.send(JSON.stringify(request));
  });
}

server.tool(
  "create_node_from_svg",
  "Create a Figma node tree from SVG source, using Figma's own SVG parser. Returns one FrameNode containing the parsed subtree. IMPORTANT: this tool is NOT idempotent — every call appends a fresh copy, so retrying after a timeout leaves two subtrees in the file; the reply carries duplicatesOnRerun to say so at the call site. The input is bounded by SVG source length rather than by node count, because Figma offers no way to preflight how many nodes a document expands into; createdNodeCount in the reply is a reading taken afterwards, never a prediction. This tool is deliberately absent from apply_batch's allowlist: a retried batch would multiply whole subtrees rather than re-apply one field.",
  {
    svg: z
      .string()
      .min(1)
      .max(
        512 * 1024,
        "SVG source exceeds this fork's 512KB ceiling; the limit is on the source because node count cannot be preflighted"
      )
      .describe("SVG source to parse. Figma's parser is the authority on what is valid"),
    x: z.number().optional().describe("X position of the created frame (default: 0)"),
    y: z.number().optional().describe("Y position of the created frame (default: 0)"),
    name: z
      .string()
      .min(1)
      .optional()
      .describe("Optional name for the created frame; Figma's own default is kept when omitted"),
    parentId: z
      .string()
      .optional()
      .describe("Optional parent node ID. Defaults to the current page"),
  },
  async (args: any) => {
    try {
      const result = await sendCommandToFigma("create_node_from_svg", args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating node from SVG: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Set Image Fill Tool
server.tool(
  "set_image_fill",
  "Fill a node in Figma with an image from a local file path, a URL, or base64 data (replaces the node's existing fills). IMPORTANT: scaleMode CROP requires imageTransform, a 2x3 matrix naming which region to crop to. Figma accepts a bare CROP but stores the identity matrix, which maps the whole image onto the whole node and renders a STRETCH rather than a crop — measured live 2026-08-23 — so a CROP without a transform is refused instead of silently degrading. Supplying imageTransform with any other scaleMode is also refused, because Figma reads it for CROP alone and would discard it. The reply reports scaleMode, imageTransform and imageTransformSource read back off the node rather than echoed from the request; scaleMode is null with scaleModeReadable false when the node's fills cannot be read.",
  {
    nodeId: z.string().describe("The ID of the node to fill"),
    imagePath: z
      .string()
      .optional()
      .describe(
        "Absolute path to a local image file, read by the MCP server (preferred: keeps image bytes out of the model context)"
      ),
    imageUrl: z
      .string()
      .optional()
      .describe(
        "Image URL, fetched by the MCP server (the Figma plugin cannot fetch arbitrary domains itself)"
      ),
    imageBase64: z
      .string()
      .optional()
      .describe(
        "Base64-encoded image data, with or without a data: URI prefix (only when the image exists nowhere else)"
      ),
    scaleMode: z
      .enum(["FILL", "FIT", "CROP", "TILE"])
      .optional()
      .describe("How the image fills the node (default: FILL)"),
    imageTransform: z
      .array(z.array(z.number()).length(3))
      .length(2)
      .optional()
      .describe(
        "2x3 matrix naming WHICH region a CROP maps the node onto. REQUIRED for scaleMode CROP and refused for every other mode. Figma accepts a bare CROP but stores the identity matrix [[1,0,0],[0,1,0]], which renders a STRETCH rather than a crop"
      ),
  },
  async ({ nodeId, imagePath, imageUrl, imageBase64, scaleMode, imageTransform }: any) => {
    try {
      const sources = [imagePath, imageUrl, imageBase64].filter(
        (source) => source !== undefined && source !== ""
      );
      if (sources.length !== 1) {
        throw new Error("Provide exactly one of imagePath, imageUrl or imageBase64");
      }

      let base64Data: string;
      if (imagePath) {
        base64Data = (await readFile(imagePath)).toString("base64");
      } else if (imageUrl) {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image URL (HTTP ${response.status})`);
        }
        base64Data = Buffer.from(await response.arrayBuffer()).toString("base64");
      } else {
        base64Data = imageBase64.replace(/^data:[^;,]+;base64,/, "");
      }

      // Keep well under the websocket relay's default 16MB frame limit
      if (base64Data.length > 12 * 1024 * 1024) {
        throw new Error(
          "Image is too large to send over the relay (~9MB binary max); downscale it first"
        );
      }

      const result = await sendCommandToFigma("set_image_fill", {
        nodeId,
        imageBase64: base64Data,
        scaleMode: scaleMode || "FILL",
        ...(imageTransform === undefined ? {} : { imageTransform }),
      });
      const typedResult = result as {
        name: string;
        imageHash: string;
        scaleMode?: string | null;
        scaleModeReadable?: boolean;
        imageTransform?: number[][] | null;
        imageTransformSource?: string;
        imageWidth?: number;
        imageHeight?: number;
      };
      const sizeInfo = typedResult.imageWidth
        ? ` (${typedResult.imageWidth}x${typedResult.imageHeight})`
        : "";
      // ⛔ The mode is quoted from the RECEIPT, not from the request. This line used to print
      // `scaleMode || "FILL"` — the caller's own argument — so it said CROP even when Figma
      // had stored a stretch. Several gates parse this line; it must not narrate an intent.
      // ⛔ And an unreadable mode prints as `unreadable`, never as the request: falling back
      // to the argument here would reinstate the same echo one layer up.
      const appliedMode = typedResult.scaleModeReadable
        ? typedResult.scaleMode
        : "unreadable";
      const transformInfo = typedResult.imageTransform
        ? `, imageTransform: ${JSON.stringify(typedResult.imageTransform)} (${typedResult.imageTransformSource || "unknown"})`
        : "";
      // ⛔ THE PROSE LINE IS HISTORICAL AND SEVERAL GATES PARSE IT, so it is preserved
      // verbatim in shape and the receipt is APPENDED underneath — `create_text`'s pattern,
      // for the same reason. ⭐ Without this the transform was only reachable by regexing an
      // English sentence, which is not "reporting" it: a receipt no consumer can parse is a
      // receipt in name only, and the whole point of the CROP repair is that the transform is
      // the field that distinguishes a crop from a stretch.
      return {
        content: [
          {
            type: "text",
            text:
              `Set image fill of node "${typedResult.name}"${sizeInfo} with scale mode ${appliedMode}${transformInfo}, imageHash: ${typedResult.imageHash}\n` +
              JSON.stringify(typedResult),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting image fill: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Rename Node Tool
server.tool(
  "rename_node",
  "Rename a node in Figma",
  {
    nodeId: z.string().describe("The ID of the node to rename"),
    name: z.string().describe("The new name for the node"),
  },
  async ({ nodeId, name }: any) => {
    try {
      const result = await sendCommandToFigma("rename_node", { nodeId, name });
      const typedResult = result as { previousName: string; name: string };
      return {
        content: [
          {
            type: "text",
            text: `Renamed node from "${typedResult.previousName}" to "${typedResult.name}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error renaming node: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Create Section Tool
server.tool(
  "create_section",
  "Create a section in Figma to group related content on the canvas",
  {
    x: z.number().describe("X position"),
    y: z.number().describe("Y position"),
    width: z.number().describe("Width of the section"),
    height: z.number().describe("Height of the section"),
    name: z.string().optional().describe("Optional name for the section"),
  },
  async ({ x, y, width, height, name }: any) => {
    try {
      const result = await sendCommandToFigma("create_section", {
        x,
        y,
        width,
        height,
        name: name || "Section",
      });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            text: `Created section "${typedResult.name}" with ID: ${typedResult.id}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating section: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Set Parent Tool
server.tool(
  "set_parent",
  "Move a node into a new parent node (e.g. a section, frame or group). Preserves the node's absolute position unless x/y are provided",
  {
    nodeId: z.string().describe("The ID of the node to move"),
    parentId: z
      .string()
      .describe("The ID of the new parent node (must support children, e.g. a section, frame or group)"),
    x: z.number().optional().describe("Optional X position relative to the new parent"),
    y: z.number().optional().describe("Optional Y position relative to the new parent"),
    index: z
      .number()
      .optional()
      .describe("Optional child index to insert at (default: appended as last child)"),
  },
  async ({ nodeId, parentId, x, y, index }: any) => {
    try {
      const result = await sendCommandToFigma("set_parent", {
        nodeId,
        parentId,
        x,
        y,
        index,
      });
      const typedResult = result as {
        name: string;
        parentName: string;
        x?: number;
        y?: number;
      };
      return {
        content: [
          {
            type: "text",
            text: `Moved node "${typedResult.name}" into "${typedResult.parentName}" at (${typedResult.x}, ${typedResult.y})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting parent: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Update the join_channel tool
server.tool(
  "join_channel",
  "Join a specific channel to communicate with Figma",
  {
    channel: z.string().describe("The name of the channel to join").default(""),
  },
  async ({ channel }: any) => {
    try {
      if (!channel) {
        // If no channel provided, ask the user for input
        return {
          content: [
            {
              type: "text",
              text: "Please provide a channel name to join:",
            },
          ],
          followUp: {
            tool: "join_channel",
            description: "Join the specified channel",
          },
        };
      }

      await joinChannel(channel);
      return {
        content: [
          {
            type: "text",
            text: `Successfully joined channel: ${channel}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error joining channel: ${error instanceof Error ? error.message : String(error)
              }`,
          },
        ],
      };
    }
  }
);

// Start the server
async function main() {
  try {
    // Try to connect to Figma socket server
    connectToFigma();
  } catch (error) {
    logger.warn(`Could not connect to Figma initially: ${error instanceof Error ? error.message : String(error)}`);
    logger.warn('Will try to connect when the first command is sent');
  }

  // Start the MCP server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('FigmaMCP server running on stdio');
}

// Run the server
main().catch(error => {
  logger.error(`Error starting FigmaMCP server: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
