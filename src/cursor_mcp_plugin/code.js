// This is the main code file for the Cursor MCP Figma plugin
// It handles Figma API commands

// talk-to-figma-runtime-metadata:start
const PLUGIN_RUNTIME_METADATA = Object.freeze({
  "name": "Talk to Figma (fork) plugin",
  "release": "R2",
  "buildId": "r2-plugin-a34d76fc6bc6",
  "apiVersion": "1.9.0",
  "serverSchemaVersion": "1.9.0",
  "relayProtocolVersion": "1",
  "capabilityFingerprint": "sha256:f636ecab99cc39989f6b79abaf06549a4e954f818f23d6fa2a369b08b6142fc0",
  "supportedCommands": [
    "get_runtime_info",
    "get_document_info",
    "get_pages",
    "set_current_page",
    "create_page",
    "get_plugin_data",
    "set_plugin_data",
    "apply_batch",
    "get_selection",
    "get_node_info",
    "get_nodes_info",
    "read_my_design",
    "create_rectangle",
    "create_frame",
    "create_text",
    "set_fill_color",
    "set_stroke_color",
    "move_node",
    "resize_node",
    "delete_node",
    "delete_multiple_nodes",
    "get_styles",
    "get_local_components",
    "get_variables",
    "get_node_variables",
    "get_available_fonts",
    "check_fonts",
    "create_component_instance",
    "export_node_as_image",
    "set_corner_radius",
    "set_text_content",
    "set_text_style",
    "clone_node",
    "scan_text_nodes",
    "set_multiple_text_contents",
    "get_annotations",
    "set_annotation",
    "scan_nodes_by_types",
    "set_multiple_annotations",
    "get_instance_overrides",
    "set_instance_overrides",
    "set_layout_mode",
    "set_padding",
    "set_axis_align",
    "set_layout_sizing",
    "set_item_spacing",
    "set_layout_child",
    "set_constraints",
    "set_size_limits",
    "set_clips_content",
    "set_fill",
    "set_effects",
    "set_opacity",
    "set_blend_mode",
    "get_reactions",
    "set_default_connector",
    "create_connections",
    "set_focus",
    "set_selections",
    "set_image_fill",
    "create_node_from_svg",
    "rename_node",
    "create_section",
    "set_parent"
  ],
  "capabilityIds": [
    "figma.command.apply_batch@1",
    "figma.command.check_fonts@1",
    "figma.command.clone_node@1",
    "figma.command.create_component_instance@1",
    "figma.command.create_connections@1",
    "figma.command.create_frame@1",
    "figma.command.create_node_from_svg@1",
    "figma.command.create_page@1",
    "figma.command.create_rectangle@1",
    "figma.command.create_section@1",
    "figma.command.create_text@1",
    "figma.command.delete_multiple_nodes@1",
    "figma.command.delete_node@1",
    "figma.command.export_node_as_image@1",
    "figma.command.get_annotations@1",
    "figma.command.get_available_fonts@1",
    "figma.command.get_document_info@1",
    "figma.command.get_instance_overrides@1",
    "figma.command.get_local_components@1",
    "figma.command.get_node_info@1",
    "figma.command.get_node_variables@1",
    "figma.command.get_nodes_info@1",
    "figma.command.get_pages@1",
    "figma.command.get_plugin_data@1",
    "figma.command.get_reactions@1",
    "figma.command.get_runtime_info@1",
    "figma.command.get_selection@1",
    "figma.command.get_styles@1",
    "figma.command.get_variables@1",
    "figma.command.move_node@1",
    "figma.command.read_my_design@1",
    "figma.command.rename_node@1",
    "figma.command.resize_node@1",
    "figma.command.scan_nodes_by_types@1",
    "figma.command.scan_text_nodes@1",
    "figma.command.set_annotation@1",
    "figma.command.set_axis_align@1",
    "figma.command.set_blend_mode@1",
    "figma.command.set_clips_content@1",
    "figma.command.set_constraints@1",
    "figma.command.set_corner_radius@1",
    "figma.command.set_current_page@1",
    "figma.command.set_default_connector@1",
    "figma.command.set_effects@1",
    "figma.command.set_fill@1",
    "figma.command.set_fill_color@1",
    "figma.command.set_focus@1",
    "figma.command.set_image_fill@1",
    "figma.command.set_instance_overrides@1",
    "figma.command.set_item_spacing@1",
    "figma.command.set_layout_child@1",
    "figma.command.set_layout_mode@1",
    "figma.command.set_layout_sizing@1",
    "figma.command.set_multiple_annotations@1",
    "figma.command.set_multiple_text_contents@1",
    "figma.command.set_opacity@1",
    "figma.command.set_padding@1",
    "figma.command.set_parent@1",
    "figma.command.set_plugin_data@1",
    "figma.command.set_selections@1",
    "figma.command.set_size_limits@1",
    "figma.command.set_stroke_color@1",
    "figma.command.set_text_content@1",
    "figma.command.set_text_style@1",
    "relay.channel@1"
  ]
});
// talk-to-figma-runtime-metadata:end

// Plugin state
const state = {
  serverPort: 3055, // Default port
};

// A raster export is encoded in the plugin sandbox before the server can write it to
// disk. Past this point the server cannot cancel Figma's work, so reject surprising
// requests before exportAsync can monopolize the plugin. 16 MP is this fork's safety
// ceiling, not a claim about a Figma platform limit: at four bytes per pixel it already
// represents about 64 MB of raw RGBA data before encoder/rendering overhead.
const RASTER_EXPORT_MEGAPIXEL_LIMIT = 16;


// Helper function for progress updates
async function sendProgressUpdate(
  commandId,
  commandType,
  status,
  progress,
  totalItems,
  processedItems,
  message,
  payload = null
) {
  const update = {
    type: "command_progress",
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now(),
  };

  // Add optional chunk information if present
  if (payload) {
    if (
      payload.currentChunk !== undefined &&
      payload.totalChunks !== undefined
    ) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }

  // Send to UI
  figma.ui.postMessage(update);
  console.log(`Progress update: ${status} - ${progress}% - ${message}`);

  // Yield so the Figma plugin sandbox flushes postMessage to ui.html
  // before the next iteration begins
  await new Promise((resolve) => setTimeout(resolve, 0));

  return update;
}

// Show UI
figma.showUI(__html__, { width: 350, height: 600 });

// Initialize anonymous analytics client_id (persisted via clientStorage)
(async () => {
  try {
    let clientId = await figma.clientStorage.getAsync("analyticsClientId");
    if (!clientId) {
      clientId =
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 10) +
        Math.random().toString(36).slice(2, 10);
      await figma.clientStorage.setAsync("analyticsClientId", clientId);
    }
    figma.ui.postMessage({ type: "analytics-client-id", clientId });
  } catch (e) {
    console.error("analytics init failed:", e);
  }
})();

// Plugin commands from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "execute-command":
      // Execute commands received from UI (which gets them from WebSocket)
      try {
        const result = await handleCommand(msg.command, msg.params);
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: error.message || "Error executing command",
        });
      }
      break;
  }
};

// Listen for plugin commands from menu
figma.on("run", ({ command }) => {
  figma.ui.postMessage({ type: "auto-connect" });
});

// Update plugin settings
function updateSettings(settings) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }

  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
  });
}

// Handle commands from UI
async function handleCommand(command, params) {
  switch (command) {
    case "get_runtime_info":
      return getRuntimeInfo();
    case "get_document_info":
      return await getDocumentInfo(params);
    case "get_pages":
      return await getPages(params);
    case "set_current_page":
      return await setCurrentPage(params);
    case "create_page":
      return await createPage(params);
    case "get_plugin_data":
      return await getPluginData(params);
    case "set_plugin_data":
      return await setPluginData(params);
    case "apply_batch":
      return await applyBatch(params);
    case "get_selection":
      return await getSelection();
    case "get_node_info":
      if (!params || !params.nodeId) {
        throw new Error("Missing nodeId parameter");
      }
      return await getNodeInfo(params.nodeId);
    case "get_nodes_info":
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return await getNodesInfo(params.nodeIds);
    case "read_my_design":
      return await readMyDesign();
    case "create_rectangle":
      return await createRectangle(params);
    case "create_frame":
      return await createFrame(params);
    case "create_text":
      return await createText(params);
    case "set_fill_color":
      return await setFillColor(params);
    case "set_stroke_color":
      return await setStrokeColor(params);
    case "move_node":
      return await moveNode(params);
    case "resize_node":
      return await resizeNode(params);
    case "delete_node":
      return await deleteNode(params);
    case "delete_multiple_nodes":
      return await deleteMultipleNodes(params);
    case "get_styles":
      return await getStyles(params);
    case "get_local_components":
      return await getLocalComponents(params);
    case "get_variables":
      return await getVariables(params);
    case "get_node_variables":
      return await getNodeVariables(params);
    case "get_available_fonts":
      return await getAvailableFonts(params);
    case "check_fonts":
      return await checkFonts(params);
    // case "get_team_components":
    //   return await getTeamComponents();
    case "create_component_instance":
      return await createComponentInstance(params);
    case "export_node_as_image":
      return await exportNodeAsImage(params);
    case "set_corner_radius":
      return await setCornerRadius(params);
    case "set_text_content":
      return await setTextContent(params);
    case "set_text_style":
      return await setTextStyle(params);
    case "clone_node":
      return await cloneNode(params);
    case "scan_text_nodes":
      return await scanTextNodes(params);
    case "set_multiple_text_contents":
      return await setMultipleTextContents(params);
    case "get_annotations":
      return await getAnnotations(params);
    case "set_annotation":
      return await setAnnotation(params);
    case "scan_nodes_by_types":
      return await scanNodesByTypes(params);
    case "set_multiple_annotations":
      return await setMultipleAnnotations(params);
    case "get_instance_overrides":
      // Check if instanceNode parameter is provided
      if (params && params.instanceNodeId) {
        // Get the instance node by ID
        const instanceNode = await figma.getNodeByIdAsync(params.instanceNodeId);
        if (!instanceNode) {
          throw new Error(`Instance node not found with ID: ${params.instanceNodeId}`);
        }
        return await getInstanceOverrides(instanceNode);
      }
      // Call without instance node if not provided
      return await getInstanceOverrides();

    case "set_instance_overrides":
      // Check if instanceNodeIds parameter is provided
      if (params && params.targetNodeIds) {
        // Validate that targetNodeIds is an array
        if (!Array.isArray(params.targetNodeIds)) {
          throw new Error("targetNodeIds must be an array");
        }

        // Get the instance nodes by IDs
        const targetNodes = await getValidTargetInstances(params.targetNodeIds);
        if (!targetNodes.success) {
          figma.notify(targetNodes.message);
          return { success: false, message: targetNodes.message };
        }

        if (params.sourceInstanceId) {

          // get source instance data
          let sourceInstanceData = null;
          sourceInstanceData = await getSourceInstanceData(params.sourceInstanceId);

          if (!sourceInstanceData.success) {
            figma.notify(sourceInstanceData.message);
            return { success: false, message: sourceInstanceData.message };
          }
          return await setInstanceOverrides(targetNodes.targetInstances, sourceInstanceData);
        } else {
          throw new Error("Missing sourceInstanceId parameter");
        }
      }
    case "set_layout_mode":
      return await setLayoutMode(params);
    case "set_padding":
      return await setPadding(params);
    case "set_axis_align":
      return await setAxisAlign(params);
    case "set_layout_sizing":
      return await setLayoutSizing(params);
    case "set_item_spacing":
      return await setItemSpacing(params);
    case "set_layout_child":
      return await setLayoutChild(params);
    case "set_constraints":
      return await setConstraints(params);
    case "set_size_limits":
      return await setSizeLimits(params);
    case "set_clips_content":
      return await setClipsContent(params);
    case "set_fill":
      return await setFill(params);
    case "set_effects":
      return await setEffects(params);
    case "set_opacity":
      return await setOpacity(params);
    case "set_blend_mode":
      return await setBlendMode(params);
    case "get_reactions":
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return await getReactions(params);
    case "set_default_connector":
      return await setDefaultConnector(params);
    case "create_connections":
      return await createConnections(params);
    case "set_focus":
      return await setFocus(params);
    case "set_selections":
      return await setSelections(params);
    case "set_image_fill":
      return await setImageFill(params);
    case "create_node_from_svg":
      return await createNodeFromSvg(params);
    case "rename_node":
      return await renameNode(params);
    case "create_section":
      return await createSection(params);
    case "set_parent":
      return await setParent(params);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Command implementations

function getRuntimeInfo() {
  return {
    ...PLUGIN_RUNTIME_METADATA,
    supportedCommands: [...PLUGIN_RUNTIME_METADATA.supportedCommands],
    capabilityIds: [...PLUGIN_RUNTIME_METADATA.capabilityIds],
    editorType: typeof figma.editorType === "string" ? figma.editorType : null,
    documentAccess: "dynamic-page",
  };
}

async function getDocumentInfo(params) {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;

  // This tool is the documented entry point ("first use get_document_info"), so it is
  // the one most likely to be called with no arguments at all — which is exactly why
  // the bounded shape has to be the DEFAULT. An unbounded `children` array on a page
  // with 826 top-level frames is the last read in this layer that can still exhaust a
  // context window before any real work starts.
  const summary = !params || params.summary !== false;
  const offset = Math.max(0, Number((params && params.offset) || 0));
  const limit = Math.min(
    500,
    Math.max(1, Number((params && params.limit) || 100))
  );
  const familyLimit = Math.min(
    500,
    Math.max(1, Number((params && params.familyLimit) || 100))
  );

  const pages = figma.root.children.map((documentPage) => {
    const isCurrentPage = documentPage.id === page.id;
    return {
      id: documentPage.id,
      name: documentPage.name,
      childCount: isCurrentPage ? documentPage.children.length : null,
      childCountStatus: isCurrentPage ? "available" : "not_requested",
    };
  });

  const allChildren = page.children;
  const childCount = allChildren.length;
  const children = allChildren.slice(offset, offset + limit).map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
  }));

  const base = {
    scope: "current_page_with_document_page_index",
    summary,
    document: {
      id: figma.root.id,
      name: figma.root.name,
      type: figma.root.type,
    },
    name: page.name,
    id: page.id,
    type: page.type,
    currentPage: {
      id: page.id,
      name: page.name,
      childCount,
    },
    // Always present, always accurate against the real total — a caller can never
    // read a truncated list as the whole page.
    childrenTruncated: children.length < childCount,
    pagination: {
      offset,
      limit,
      returned: children.length,
      hasMore: offset + children.length < childCount,
    },
    pageCount: pages.length,
    pages,
  };

  if (!summary) {
    return Object.assign(base, { children });
  }

  const typeCounts = new Map();
  const familyCounts = new Map();
  for (var i = 0; i < childCount; i++) {
    var child = allChildren[i];
    typeCounts.set(child.type, (typeCounts.get(child.type) || 0) + 1);
    var family = getNameFamily(child.name);
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }

  const byCountDesc = (left, right) =>
    right.count - left.count || left.name.localeCompare(right.name);
  const childTypes = Array.from(typeCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort(byCountDesc);
  const childFamilies = Array.from(familyCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort(byCountDesc);

  return Object.assign(base, {
    // Node types are a small closed set, so this rollup needs no cap and describes
    // the whole page even when `children` below is only the first slice of it.
    childTypes,
    childFamilyCount: childFamilies.length,
    childFamilies: childFamilies.slice(0, familyLimit),
    childFamiliesTruncated: childFamilies.length > familyLimit,
    familyLimit,
    children,
  });
}

async function getPages(params) {
  const includeChildCount = Boolean(params && params.includeChildCount);
  const commandId = (params && params.commandId) || generateCommandId();
  const documentPages = figma.root.children;
  const pages = [];

  if (includeChildCount) {
    await sendProgressUpdate(
      commandId,
      "get_pages",
      "started",
      0,
      documentPages.length,
      0,
      "Loading pages to count top-level children"
    );
  }

  for (let index = 0; index < documentPages.length; index++) {
    const page = documentPages[index];
    const pageInfo = {
      id: page.id,
      name: page.name,
    };

    if (includeChildCount) {
      const stopHeartbeat = startProgressHeartbeat(
        commandId,
        "get_pages",
        Math.round((index / documentPages.length) * 100),
        documentPages.length,
        index,
        `Still loading page ${page.name}`
      );
      try {
        await page.loadAsync();
      } finally {
        stopHeartbeat();
      }
      pageInfo.childCount = page.children.length;
      await sendProgressUpdate(
        commandId,
        "get_pages",
        "in_progress",
        Math.round(((index + 1) / documentPages.length) * 100),
        documentPages.length,
        index + 1,
        `Loaded page ${index + 1}/${documentPages.length}: ${page.name}`
      );
    }

    pages.push(pageInfo);
  }

  if (includeChildCount) {
    await sendProgressUpdate(
      commandId,
      "get_pages",
      "completed",
      100,
      documentPages.length,
      documentPages.length,
      `Loaded ${documentPages.length} pages`
    );
  }

  return {
    scope: "document",
    document: {
      id: figma.root.id,
      name: figma.root.name,
    },
    currentPageId: figma.currentPage.id,
    pageCount: pages.length,
    childCountIncluded: includeChildCount,
    pages,
  };
}

async function setCurrentPage(params) {
  const { pageId } = params || {};
  if (!pageId) {
    throw new Error("Missing pageId parameter");
  }

  const page = await figma.getNodeByIdAsync(pageId);
  if (!page) {
    throw new Error(`Page not found with ID: ${pageId}`);
  }
  if (page.type !== "PAGE") {
    throw new Error(`Node ${pageId} is ${page.type}, not a PAGE`);
  }

  await figma.setCurrentPageAsync(page);
  await page.loadAsync();

  return {
    success: true,
    currentPage: {
      id: page.id,
      name: page.name,
      childCount: page.children.length,
    },
  };
}

async function createPage(params) {
  const { name, onDuplicate, index } = params || {};

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Missing or empty name parameter");
  }

  // Figma itself permits duplicate page names, so the caller declares intent.
  // The default refuses, because a consumer re-running a sequence would
  // otherwise fan out same-named pages silently.
  const duplicatePolicy =
    onDuplicate === undefined || onDuplicate === null ? "error" : onDuplicate;
  if (duplicatePolicy !== "error" && duplicatePolicy !== "allow") {
    throw new Error(
      `Invalid onDuplicate value ${JSON.stringify(
        onDuplicate
      )}; expected "error" or "allow"`
    );
  }

  // Page id/name are readable without loadAsync under dynamic-page access;
  // only a page's children require loading.
  const pageCountBefore = figma.root.children.length;
  const requestedIndex =
    index === undefined || index === null ? null : index;

  if (requestedIndex !== null) {
    if (typeof requestedIndex !== "number" || !Number.isInteger(requestedIndex)) {
      throw new Error("index must be an integer when provided");
    }
    if (requestedIndex < 0 || requestedIndex > pageCountBefore) {
      throw new Error(
        `index ${requestedIndex} is out of range; expected 0..${pageCountBefore} for a document with ${pageCountBefore} pages`
      );
    }
  }

  const duplicateNameIds = figma.root.children
    .filter((existing) => existing.name === name)
    .map((existing) => existing.id);

  if (duplicateNameIds.length > 0 && duplicatePolicy === "error") {
    throw new Error(
      `A page named "${name}" already exists (${duplicateNameIds.join(
        ", "
      )}). Pass onDuplicate: "allow" to create another page with the same name.`
    );
  }

  const page = figma.createPage();
  page.name = name;

  if (requestedIndex !== null) {
    figma.root.insertChild(requestedIndex, page);
  }

  // Report the observed position rather than the requested one: reordering an
  // existing child is index-sensitive, and a receipt must state what happened.
  return {
    id: page.id,
    name: page.name,
    index: figma.root.children.indexOf(page),
    requestedIndex,
    pageCount: figma.root.children.length,
    onDuplicate: duplicatePolicy,
    duplicateNameExisted: duplicateNameIds.length > 0,
    existingPageIds: duplicateNameIds,
  };
}

// Figma's own documented per-entry ceiling. Declared here so an oversize write is
// refused with a message naming the limit, rather than surfacing as an opaque
// platform throw after the caller has already committed.
const PLUGIN_DATA_MAX_VALUE_BYTES = 100000;
const PLUGIN_DATA_DEFAULT_KEY_LIMIT = 100;
const PLUGIN_DATA_DEFAULT_MAX_VALUE_BYTES = 10000;

function utf8ByteLength(value) {
  // The plugin sandbox has no Buffer; count UTF-8 bytes directly so the reported
  // size matches what Figma actually stores rather than a UTF-16 code-unit count.
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

// Resolves the node plus the store the caller selected. Passing a namespace selects
// Figma's shared store, which any plugin or the REST API can read; omitting it uses
// the store private to this plugin's ID.
async function resolvePluginDataTarget(params) {
  const { nodeId, namespace } = params || {};

  if (typeof nodeId !== "string" || nodeId.length === 0) {
    throw new Error("Missing nodeId parameter");
  }
  if (namespace !== undefined && namespace !== null) {
    if (typeof namespace !== "string" || namespace.trim().length === 0) {
      throw new Error("namespace must be a non-empty string when provided");
    }
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const shared = namespace !== undefined && namespace !== null;
  return {
    node,
    shared,
    namespace: shared ? namespace : null,
    store: shared ? "shared" : "private",
    keys: () =>
      shared ? node.getSharedPluginDataKeys(namespace) : node.getPluginDataKeys(),
    read: (key) =>
      shared ? node.getSharedPluginData(namespace, key) : node.getPluginData(key),
    write: (key, value) =>
      shared
        ? node.setSharedPluginData(namespace, key, value)
        : node.setPluginData(key, value),
  };
}

async function getPluginData(params) {
  const { key, limit, offset, maxValueBytes } = params || {};
  const target = await resolvePluginDataTarget(params);

  if (key !== undefined && key !== null) {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("key must be a non-empty string when provided");
    }
  }

  const keyLimit =
    limit === undefined || limit === null ? PLUGIN_DATA_DEFAULT_KEY_LIMIT : limit;
  const keyOffset = offset === undefined || offset === null ? 0 : offset;
  const valueCap =
    maxValueBytes === undefined || maxValueBytes === null
      ? PLUGIN_DATA_DEFAULT_MAX_VALUE_BYTES
      : maxValueBytes;

  if (!Number.isInteger(keyLimit) || keyLimit <= 0) {
    throw new Error("limit must be a positive integer when provided");
  }
  if (!Number.isInteger(keyOffset) || keyOffset < 0) {
    throw new Error("offset must be a non-negative integer when provided");
  }
  if (!Number.isInteger(valueCap) || valueCap <= 0) {
    throw new Error("maxValueBytes must be a positive integer when provided");
  }

  // Whole-node total, kept independent of the returned window - the same
  // count-vs-window separation get_node_variables uses.
  const allKeys = target.keys();
  const requestedKey = key === undefined || key === null ? null : key;
  const selectedKeys = requestedKey === null ? allKeys : [requestedKey];
  const windowedKeys =
    requestedKey === null
      ? selectedKeys.slice(keyOffset, keyOffset + keyLimit)
      : selectedKeys;

  const limitations = [];
  let anyValueTruncated = false;

  const entries = windowedKeys.map((entryKey) => {
    // A key absent from the store reads back as "" in Figma, which is
    // indistinguishable from a stored empty string. Membership is the only
    // honest test, so report it rather than letting the caller guess.
    const present = allKeys.indexOf(entryKey) !== -1;
    const rawValue = present ? target.read(entryKey) : "";
    const bytes = utf8ByteLength(rawValue);
    const truncated = bytes > valueCap;
    if (truncated) anyValueTruncated = true;
    return {
      key: entryKey,
      present,
      value: truncated ? rawValue.slice(0, valueCap) : rawValue,
      bytes,
      truncated,
    };
  });

  const returned = entries.length;
  const hasMore =
    requestedKey === null ? keyOffset + returned < allKeys.length : false;

  if (hasMore) {
    limitations.push(
      `Returned ${returned} of ${allKeys.length} keys; raise limit or page with offset`,
    );
  }
  if (anyValueTruncated) {
    limitations.push(
      `At least one value exceeded maxValueBytes (${valueCap}) and was truncated`,
    );
  }

  return {
    nodeId: target.node.id,
    nodeName: target.node.name,
    nodeType: target.node.type,
    store: target.store,
    namespace: target.namespace,
    requestedKey,
    keyCount: allKeys.length,
    entries,
    pagination: {
      limit: keyLimit,
      offset: keyOffset,
      returned,
      hasMore,
    },
    maxValueBytes: valueCap,
    complete: !hasMore && !anyValueTruncated,
    limitations,
  };
}

async function setPluginData(params) {
  const { key, value } = params || {};
  const target = await resolvePluginDataTarget(params);

  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Missing or empty key parameter");
  }
  if (value !== null && typeof value !== "string") {
    throw new Error(
      "value must be a string, or null to remove the key. Figma stores plugin data as strings; serialize structured data yourself",
    );
  }
  // Figma removes a key when it is written the empty string, so "" is not a
  // storable value on this platform - it is a second, implicit spelling of
  // delete. Refuse it rather than accept a write that silently erases: the
  // caller learns the constraint here instead of discovering a missing key later.
  if (value === "") {
    throw new Error(
      `Figma removes a key when it is written the empty string, so "" cannot be stored. Pass value: null to remove "${key}" explicitly, or store a non-empty placeholder`,
    );
  }

  const keysBefore = target.keys();
  const existed = keysBefore.indexOf(key) !== -1;
  const previousBytes = existed ? utf8ByteLength(target.read(key)) : null;

  let operation;
  let bytes;
  if (value === null) {
    // null is the single, explicit spelling of delete. The "" spelling is
    // refused above, so a removal is never something the caller did by accident.
    if (existed) {
      target.write(key, "");
      operation = "removed";
    } else {
      operation = "noop_absent";
    }
    bytes = null;
  } else {
    bytes = utf8ByteLength(value);
    if (bytes > PLUGIN_DATA_MAX_VALUE_BYTES) {
      throw new Error(
        `Plugin data value for key "${key}" is ${bytes} bytes, above the ${PLUGIN_DATA_MAX_VALUE_BYTES} byte per-entry ceiling. Store a reference instead of the payload, or split it across keys`,
      );
    }
    target.write(key, value);
    operation = "set";
  }

  return {
    nodeId: target.node.id,
    nodeName: target.node.name,
    nodeType: target.node.type,
    store: target.store,
    namespace: target.namespace,
    key,
    operation,
    existed,
    previousBytes,
    bytes,
    keyCount: target.keys().length,
  };
}

async function getSelection() {
  return {
    scope: "current_page",
    pageId: figma.currentPage.id,
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
    })),
  };
}

function rgbaToHex(color) {
  if (typeof color === "string") {
    return color;
  }

  var r = Math.round(color.r * 255);
  var g = Math.round(color.g * 255);
  var b = Math.round(color.b * 255);
  var a = color.a !== undefined ? Math.round(color.a * 255) : 255;

  if (a === 255) {
    return (
      "#" +
      [r, g, b]
        .map((x) => {
          return x.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  return (
    "#" +
    [r, g, b, a]
      .map((x) => {
        return x.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

const variableCache = new Map();
const variableCollectionCache = new Map();
const styleCache = new Map();

// Style-backed tokens are NOT variables: a fill/text/effect style is a separate
// Figma concept with its own id space. A node can reference both, so reporting
// only variables would make a styled-but-unbound node look untokenised.
const STYLE_ID_PROPERTIES = [
  "fillStyleId",
  "strokeStyleId",
  "textStyleId",
  "effectStyleId",
  "gridStyleId",
];

function hasStylesApi() {
  return Boolean(figma.getStyleByIdAsync);
}

async function getStyleByIdCached(styleId) {
  if (!hasStylesApi()) {
    return null;
  }

  if (!styleCache.has(styleId)) {
    styleCache.set(
      styleId,
      figma.getStyleByIdAsync(styleId).catch(() => null)
    );
  }

  return await styleCache.get(styleId);
}

function collectStyleRefsForNode(node) {
  const records = [];

  for (const property of STYLE_ID_PROPERTIES) {
    if (!(property in node)) {
      continue;
    }

    const styleId = node[property];
    if (!styleId) {
      continue;
    }

    // A text node with more than one text style reports figma.mixed here.
    // Report it rather than dropping it: "mixed" is a real answer, absence is not.
    if (styleId === figma.mixed) {
      records.push({ property, styleId: null, mixed: true });
      continue;
    }

    if (typeof styleId === "string") {
      records.push({ property, styleId, mixed: false });
    }
  }

  return records;
}

// Read the style's own value so a reference is self-sufficient.
// This matters most for remote styles: get_styles only lists LOCAL styles, so on a file
// that references an external library the name resolves here but the value was
// previously recoverable only by joining against get_node_info — a lossy join, because
// get_node_info returns a fraction of the nodes this scan visits.
function readStyleValue(style) {
  switch (style.type) {
    case "PAINT":
      return { paints: style.paints ? Array.from(style.paints) : [] };
    case "TEXT":
      return {
        fontName: style.fontName,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        paragraphSpacing: style.paragraphSpacing,
        paragraphIndent: style.paragraphIndent,
        textCase: style.textCase,
        textDecoration: style.textDecoration,
      };
    case "EFFECT":
      return { effects: style.effects ? Array.from(style.effects) : [] };
    case "GRID":
      return { layoutGrids: style.layoutGrids ? Array.from(style.layoutGrids) : [] };
    default:
      return null;
  }
}

async function resolveNodeStyle(node, record) {
  const base = {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    nodePath: getNodePath(node),
    property: record.property,
    styleId: record.styleId,
  };

  if (record.mixed) {
    return Object.assign(base, {
      styleName: null,
      styleType: null,
      remote: null,
      value: null,
      valueStatus: "not_applicable",
      resolutionStatus: "mixed",
    });
  }

  const style = await getStyleByIdCached(record.styleId);
  if (!style) {
    return Object.assign(base, {
      styleName: null,
      styleType: null,
      remote: null,
      value: null,
      valueStatus: "not_applicable",
      resolutionStatus: "style_not_found",
    });
  }

  let value = null;
  let valueStatus = "resolved";
  try {
    value = readStyleValue(style);
    if (value === null) {
      // A style type this build does not know how to read. Say so rather than
      // implying the style has no value.
      valueStatus = "unsupported_style_type";
    }
  } catch (error) {
    value = null;
    valueStatus = "read_failed";
  }

  return Object.assign(base, {
    styleName: style.name,
    styleType: style.type,
    remote: Boolean(style.remote),
    value,
    valueStatus,
    resolutionStatus: "resolved",
  });
}

function hasVariablesApi() {
  return Boolean(
    figma.variables &&
    figma.variables.getLocalVariablesAsync &&
    figma.variables.getLocalVariableCollectionsAsync &&
    figma.variables.getVariableByIdAsync
  );
}

function hasVariableWriteApi() {
  return Boolean(
    figma.variables &&
    figma.variables.createVariable &&
    figma.variables.createVariableCollection &&
    figma.variables.createVariableAlias
  );
}

async function getVariableByIdCached(variableId) {
  if (!hasVariablesApi()) {
    return null;
  }

  if (!variableCache.has(variableId)) {
    variableCache.set(
      variableId,
      figma.variables.getVariableByIdAsync(variableId).catch(() => null)
    );
  }

  return await variableCache.get(variableId);
}

async function getVariableCollectionByIdCached(collectionId) {
  if (
    !figma.variables ||
    !figma.variables.getVariableCollectionByIdAsync
  ) {
    return null;
  }

  if (!variableCollectionCache.has(collectionId)) {
    variableCollectionCache.set(
      collectionId,
      figma.variables
        .getVariableCollectionByIdAsync(collectionId)
        .catch(() => null)
    );
  }

  return await variableCollectionCache.get(collectionId);
}

function serializeVariableValue(value) {
  if (
    value &&
    typeof value === "object" &&
    typeof value.r === "number" &&
    typeof value.g === "number" &&
    typeof value.b === "number"
  ) {
    return rgbaToHex(value);
  }

  if (Array.isArray(value)) {
    return value.map(serializeVariableValue);
  }

  if (value && typeof value === "object") {
    const serialized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      serialized[key] = serializeVariableValue(nestedValue);
    }
    return serialized;
  }

  return value;
}

async function resolveVariableAliasMetadata(alias) {
  if (Array.isArray(alias)) {
    return await Promise.all(alias.map(resolveVariableAliasMetadata));
  }

  if (!alias || typeof alias !== "object") {
    return alias;
  }

  if (typeof alias.id === "string") {
    const variable = await getVariableByIdCached(alias.id);
    return variable
      ? { id: alias.id, name: variable.name }
      : { id: alias.id };
  }

  const resolved = {};
  await Promise.all(
    Object.entries(alias).map(async ([key, value]) => {
      resolved[key] = await resolveVariableAliasMetadata(value);
    })
  );
  return resolved;
}

async function resolveBoundVariables(boundVariables) {
  if (!boundVariables || typeof boundVariables !== "object") {
    return boundVariables;
  }

  const resolved = {};
  await Promise.all(
    Object.entries(boundVariables).map(async ([property, alias]) => {
      resolved[property] = await resolveVariableAliasMetadata(alias);
    })
  );
  return resolved;
}

async function filterFigmaNode(node) {
  if (node.type === "VECTOR") {
    return null;
  }

  var filtered = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if (node.boundVariables) {
    filtered.boundVariables = await resolveBoundVariables(node.boundVariables);
  }

  if (node.fills && node.fills.length > 0) {
    filtered.fills = await Promise.all(node.fills.map(async (fill) => {
      var processedFill = Object.assign({}, fill);
      delete processedFill.imageRef;

      if (processedFill.boundVariables) {
        processedFill.boundVariables = await resolveBoundVariables(
          processedFill.boundVariables
        );
      }

      if (processedFill.gradientStops) {
        processedFill.gradientStops = await Promise.all(
          processedFill.gradientStops.map(async (stop) => {
            var processedStop = Object.assign({}, stop);
            if (processedStop.color) {
              processedStop.color = rgbaToHex(processedStop.color);
            }
            if (processedStop.boundVariables) {
              processedStop.boundVariables = await resolveBoundVariables(
                processedStop.boundVariables
              );
            }
            return processedStop;
          })
        );
      }

      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    }));
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = await Promise.all(node.strokes.map(async (stroke) => {
      var processedStroke = Object.assign({}, stroke);
      if (processedStroke.boundVariables) {
        processedStroke.boundVariables = await resolveBoundVariables(
          processedStroke.boundVariables
        );
      }
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    }));
  }

  // Effects need to survive the JSON_REST_V1 subset even when the array is empty: an
  // empty array witnesses a clear, while an omitted field cannot witness anything.
  if (Array.isArray(node.effects)) {
    filtered.effects = await Promise.all(node.effects.map(async (effect) => {
      var processedEffect = Object.assign({}, effect);
      if (processedEffect.color) {
        processedEffect.color = rgbaToHex(processedEffect.color);
      }
      if (processedEffect.boundVariables) {
        processedEffect.boundVariables = await resolveBoundVariables(
          processedEffect.boundVariables
        );
      }
      return processedEffect;
    }));
  }

  if (node.effectStyleId !== undefined) {
    filtered.effectStyleId = node.effectStyleId;
  }

  // Keep false and null. They are observations; omission is not.
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
      lineHeightPx: node.style.lineHeightPx,
    };
  }

  if (node.children) {
    filtered.children = (await Promise.all(
      node.children.map((child) => {
        return filterFigmaNode(child);
      })
    )).filter((child) => {
        return child !== null;
      });
  }

  return filtered;
}

// ⛔ `JSON_REST_V1` DOES NOT CARRY `effectStyleId`. Measured 2026-08-23 against a real
// bound frame, not inferred: the export's own keys are `…, effects, fills, styles, …` and
// `effectStyleId` is absent on a bound node, an unbound node and a bound CHILD alike. A
// bound style surfaces as `styles: { effect: "6052:226" }`, and `styles` is missing
// entirely when nothing is bound.
//
// ⛔ The two ids are NOT the same value. REST's `styles.effect` is a file-local key
// (`"6052:226"`) while the plugin's `effectStyleId` is `"S:0a45cd18…,"`. Republishing the
// REST key under the plugin's name would hand a consumer an id that silently fails to
// join against `set_effects`' own `styleIdBefore` / `styleIdAfter`, which read the plugin
// node — a wrong value that reads exactly like a right one.
//
// So the reading is taken from the plugin node, which every top-level reader already
// holds, and it is attached BEFORE `filterFigmaNode` so that both filter copies carry it
// through their existing `effectStyleId` branches. An unbound node reports `""` rather
// than omitting the key: omission is not an observation.
//
// ⚠️ Top-level only. Nested nodes in `children` have no plugin node in hand here, so they
// carry `effects` but no effect-style reading; closing that would mean publishing REST's
// `styles` map (a second id space) or a lossy join against the local-style list, and both
// are contract decisions this item did not take.
function withEffectStyleId(document, node) {
  if (document && node && typeof node.effectStyleId === "string") {
    document.effectStyleId = node.effectStyleId;
  }
  return document;
}

async function getNodeInfo(nodeId) {
  if (nodeId === figma.root.id || nodeId === "0:0") {
    throw new Error(
      "Document-root reads are not supported by get_node_info. Use get_pages to enumerate pages, then query a page or child node."
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type === "PAGE") {
    await node.loadAsync();
  }

  const response = await node.exportAsync({
    format: "JSON_REST_V1",
  });

  return await filterFigmaNode(withEffectStyleId(response.document, node));
}

async function getNodesInfo(nodeIds) {
  try {
    // Load all nodes in parallel
    const nodes = await Promise.all(
      nodeIds.map((id) => figma.getNodeByIdAsync(id))
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        if (node.type === "DOCUMENT") {
          throw new Error(
            "Document-root reads are not supported by get_nodes_info. Use get_pages to enumerate pages."
          );
        }
        if (node.type === "PAGE") {
          await node.loadAsync();
        }
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: await filterFigmaNode(
            withEffectStyleId(response.document, node)
          ),
        };
      })
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
}

async function getReactions(params) {
  try {
    const { nodeIds, commandId = generateCommandId() } = params;
    await sendProgressUpdate(
      commandId,
      "get_reactions",
      "started",
      0,
      nodeIds.length,
      0,
      `Starting deep search for reactions in ${nodeIds.length} nodes and their children`
    );

    // Function to find nodes with reactions from the node and all its children
    async function findNodesWithReactions(node, processedNodes = new Set(), depth = 0, results = []) {
      // Skip already processed nodes (prevent circular references)
      if (processedNodes.has(node.id)) {
        return results;
      }
      
      processedNodes.add(node.id);
      
      // Check if the current node has reactions
      const reactions =
        node.reactions && node.reactions.length > 0
          ? Array.from(node.reactions)
          : [];
      const hasReactions = reactions.length > 0;
      
      // CHANGE_TO reactions are intentionally retained: they power interactive
      // component transitions between variants.
      if (hasReactions) {
        results.push({
          id: node.id,
          name: node.name,
          type: node.type,
          depth: depth,
          hasReactions: true,
          reactions,
          path: getNodePath(node)
        });
      }

      // If node has children, recursively search them
      if (node.children) {
        for (const child of node.children) {
          await findNodesWithReactions(child, processedNodes, depth + 1, results);
        }
      }

      return results;
    }

    // Get node hierarchy path as a string
    function getNodePath(node) {
      const path = [];
      let current = node;
      
      while (current && current.parent) {
        path.unshift(current.name);
        current = current.parent;
      }
      
      return path.join(' > ');
    }

    // Array to store all results
    let allResults = [];
    let processedCount = 0;
    const totalCount = nodeIds.length;
    const errors = [];
    
    // Iterate through each node and its children to search for reactions
    for (let i = 0; i < nodeIds.length; i++) {
      try {
        const nodeId = nodeIds[i];
        const node = await figma.getNodeByIdAsync(nodeId);
        
        if (!node) {
          processedCount++;
          errors.push({ nodeId, error: "Node not found" });
          await sendProgressUpdate(
            commandId,
            "get_reactions",
            "in_progress",
            Math.round((processedCount / totalCount) * 100),
            totalCount,
            processedCount,
            `Node not found: ${nodeId}`
          );
          continue;
        }

        if (node.type === "PAGE") {
          await node.loadAsync();
        }
        
        // Search for reactions in the node and its children
        const processedNodes = new Set();
        const nodeResults = await findNodesWithReactions(node, processedNodes);
        
        // Add results
        allResults = allResults.concat(nodeResults);
        
        // Update progress
        processedCount++;
        await sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          Math.round((processedCount / totalCount) * 100),
          totalCount,
          processedCount,
          `Processed node ${processedCount}/${totalCount}, found ${nodeResults.length} nodes with reactions`
        );
      } catch (error) {
        processedCount++;
        errors.push({
          nodeId: nodeIds[i],
          error: error.message || String(error),
        });
        await sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          Math.round((processedCount / totalCount) * 100),
          totalCount,
          processedCount,
          `Error processing node: ${error.message}`
        );
      }
    }

    // Completion update
    await sendProgressUpdate(
      commandId,
      "get_reactions",
      "completed",
      100,
      totalCount,
      totalCount,
      `Completed deep search: found ${allResults.length} nodes with reactions.`
    );

    return {
      scope: "requested_node_subtrees",
      complete: errors.length === 0,
      coverage: {
        includesChangeToVariantTransitions: true,
        limitation:
          "Only reactions exposed by the Figma Plugin API on the requested nodes and descendants are included. An empty result does not prove that the file has no prototype or motion behavior.",
      },
      nodesCount: nodeIds.length,
      nodesWithReactions: allResults.length,
      nodes: allResults,
      errors,
    };
  } catch (error) {
    throw new Error(`Failed to get reactions: ${error.message}`);
  }
}

async function readMyDesign() {
  try {
    // Load all selected nodes in parallel
    const nodes = await Promise.all(
      figma.currentPage.selection.map((node) => figma.getNodeByIdAsync(node.id))
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: await filterFigmaNode(
            withEffectStyleId(response.document, node)
          ),
        };
      })
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
}

async function createRectangle(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Rectangle",
    parentId,
  } = params || {};

  const rect = figma.createRectangle();
  rect.x = x;
  rect.y = y;
  rect.resize(width, height);
  rect.name = name;

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(rect);
  } else {
    figma.currentPage.appendChild(rect);
  }

  return {
    id: rect.id,
    name: rect.name,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    parentId: rect.parent ? rect.parent.id : undefined,
  };
}

async function createFrame(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Frame",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
    layoutMode = "NONE",
    layoutWrap = "NO_WRAP",
    paddingTop = 10,
    paddingRight = 10,
    paddingBottom = 10,
    paddingLeft = 10,
    primaryAxisAlignItems = "MIN",
    counterAxisAlignItems = "MIN",
    layoutSizingHorizontal = "FIXED",
    layoutSizingVertical = "FIXED",
    itemSpacing = 0,
  } = params || {};

  const frame = figma.createFrame();
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.name = name;

  // Set layout mode if provided
  if (layoutMode !== "NONE") {
    frame.layoutMode = layoutMode;
    frame.layoutWrap = layoutWrap;

    // Set padding values only when layoutMode is not NONE
    frame.paddingTop = paddingTop;
    frame.paddingRight = paddingRight;
    frame.paddingBottom = paddingBottom;
    frame.paddingLeft = paddingLeft;

    // Set axis alignment only when layoutMode is not NONE
    frame.primaryAxisAlignItems = primaryAxisAlignItems;
    frame.counterAxisAlignItems = counterAxisAlignItems;

    // Set layout sizing only when layoutMode is not NONE
    frame.layoutSizingHorizontal = layoutSizingHorizontal;
    frame.layoutSizingVertical = layoutSizingVertical;

    // Set item spacing only when layoutMode is not NONE
    frame.itemSpacing = itemSpacing;
  }

  // Set fill color if provided
  if (fillColor) {
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: parseFloat(fillColor.a) || 1,
    };
    frame.fills = [paintStyle];
  }

  // Set stroke color and weight if provided
  if (strokeColor) {
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: parseFloat(strokeColor.a) || 1,
    };
    frame.strokes = [strokeStyle];
  }

  // Set stroke weight if provided
  if (strokeWeight !== undefined) {
    frame.strokeWeight = strokeWeight;
  }

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(frame);
  } else {
    figma.currentPage.appendChild(frame);
  }

  return {
    id: frame.id,
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    fills: frame.fills,
    strokes: frame.strokes,
    strokeWeight: frame.strokeWeight,
    layoutMode: frame.layoutMode,
    layoutWrap: frame.layoutWrap,
    parentId: frame.parent ? frame.parent.id : undefined,
  };
}

/**
 * R2.6 item 2.0 — `create_text` carries `set_text_style`'s twelve typography parameters.
 *
 * ⛔ **Validate-all-then-CREATE.** On a mutation tool the F4 defect is a half-written
 * node; on a create tool it is a node that exists at all. A refusal raised after
 * `figma.createText()` leaves an orphan empty text node on the page, which is a partial
 * application wearing a different hat — so nothing is created until every parameter has
 * validated, the parent has resolved, and the font has loaded.
 *
 * ⛔ **It REFUSES an unloadable font; it never substitutes.** This tool used to swallow
 * the load failure in a `try/catch` and create the node anyway in whatever face Figma
 * happened to supply — F2 on the create surface. `create_text` is `stable`, which is why
 * ending that behaviour spends this release's contract bump rather than shipping quietly.
 *
 * ⚠️ The two legacy parameters are unchanged for every existing caller: `fontWeight`
 * still maps onto Inter's styles, and an omitted `fontSize` still writes 14. What is no
 * longer possible is supplying `fontWeight` *and* a named face — one of them would be
 * discarded, and a discarded value reads as an applied one.
 */
async function createText(params) {
  const input = params || {};
  const {
    x = 0,
    y = 0,
    text = "Text",
    fontColor = { r: 0, g: 0, b: 0, a: 1 }, // Default to black
    name = "",
    parentId,
  } = input;

  // Map common font weights to Figma font styles
  const getFontStyle = (weight) => {
    switch (weight) {
      case 100:
        return "Thin";
      case 200:
        return "Extra Light";
      case 300:
        return "Light";
      case 400:
        return "Regular";
      case 500:
        return "Medium";
      case 600:
        return "Semi Bold";
      case 700:
        return "Bold";
      case 800:
        return "Extra Bold";
      case 900:
        return "Black";
      default:
        return "Regular";
    }
  };

  // ══ VALIDATION PHASE ══════════════════════════════════════════════════════════════
  // ⛔ Nothing below this line creates a node or writes a property until the write phase
  // is reached. Moving a check down there is the F4 defect, on the one tool where it
  // leaves litter behind instead of a half-written node.
  const errors = [];
  const writes = [];
  const appliedFields = [];
  const supplied = (field) => input[field] !== undefined && input[field] !== null;

  // A direct plugin caller could always send `fontSize` as a string — `parseInt` was the
  // legacy coercion. Coercing before validation keeps every input that used to work,
  // while ending the `NaN` that used to reach the node unchallenged.
  const styleInput =
    typeof input.fontSize === "string"
      ? { ...input, fontSize: parseInt(input.fontSize, 10) }
      : input;

  const explicitFont = textStyleRequestedFont(styleInput, errors);
  const namedFace = supplied("fontFamily") || supplied("fontStyle");

  // ⛔ `fontWeight` and `fontFamily`/`fontStyle` are two ways to name one face, so
  // honouring either means discarding the other — and a discarded value reads as an
  // applied one. Same rule as `lineHeight: {value, unit: "AUTO"}`, which refuses the
  // value it would have to throw away.
  if (namedFace && supplied("fontWeight")) {
    errors.push(
      "fontWeight cannot be combined with fontFamily/fontStyle; they name the same face two ways and one of them would be silently discarded. fontWeight reaches Inter's styles only — drop it and name the face exactly.",
    );
  }

  const fontSource = namedFace
    ? "explicit"
    : supplied("fontWeight")
      ? "fontWeight"
      : "default";
  const requestedFont = explicitFont || {
    family: "Inter",
    style: getFontStyle(supplied("fontWeight") ? input.fontWeight : 400),
  };
  writes.push(["fontName", requestedFont]);
  if (explicitFont) appliedFields.push("fontFamily", "fontStyle");

  // ⚠️ The R1-era default, preserved deliberately: an omitted `fontSize` wrote 14, and a
  // fresh Figma text node does NOT default to 14. Dropping this write would silently
  // change the size of every text node created by a caller that never asked for one.
  // It is not an `appliedField` — the caller did not supply it.
  if (!supplied("fontSize")) writes.push(["fontSize", 14]);

  textStyleCollectWrites(styleInput, errors, writes, appliedFields);

  // Resolved BEFORE anything is created, so an unusable parent refuses the call instead
  // of stranding a node on the current page. Reading a node mutates nothing.
  let parentNode = null;
  if (parentId) {
    parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      errors.push(`Parent node not found with ID: ${parentId}`);
    } else if (!("appendChild" in parentNode)) {
      errors.push(`Parent node does not support children: ${parentId}`);
    }
  }

  if (errors.length > 0) {
    // ⛔ EVERY error, not the first — the same round-trip economics as `set_text_style`.
    throw new Error(
      `create_text refused ${errors.length} invalid ${errors.length === 1 ? "parameter" : "parameters"} and created nothing: ${errors.join("; ")}`,
    );
  }

  try {
    await figma.loadFontAsync(requestedFont);
  } catch (loadError) {
    // ⛔ REFUSE, never substitute — and refuse BEFORE creating the node, so the page is
    // untouched. This is the gate that lets `fontSubstituted: false` below be a
    // permanent declaration rather than a state.
    throw new Error(
      `create_text could not load ${requestedFont.family} ${requestedFont.style} (${loadError instanceof Error ? loadError.message : String(loadError)}) and created nothing. This tool refuses rather than substituting Inter, because a node in a font nobody asked for is harder to notice than an error. Preflight with check_fonts.`,
    );
  }

  // ══ WRITE PHASE ═══════════════════════════════════════════════════════════════════
  // ⛔ Every value here is validated and the font is loaded, so this phase cannot reject
  // on a caller's input. Do NOT add a check to it.
  const textNode = figma.createText();
  textNode.x = x;
  textNode.y = y;
  textNode.name = name || text;
  for (const [property, value] of writes) {
    textNode[property] = value;
  }

  // Set text color
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(fontColor.r) || 0,
      g: parseFloat(fontColor.g) || 0,
      b: parseFloat(fontColor.b) || 0,
    },
    // ⛔ `parseFloat(a) || 1` read a legitimate 0 as absent and wrote 1 — a fully
    // transparent fill silently became a fully opaque one, which is the F2 shape in
    // another channel: a supplied value replaced by a default.
    opacity: fontColor.a === undefined || fontColor.a === null ? 1 : parseFloat(fontColor.a),
  };
  textNode.fills = [paintStyle];

  // ⛔ AWAITED. Un-awaited, this was still a pending microtask when the reply was built,
  // so the reply reported `characters: ""` for text it had in fact written — and only on
  // the path WITHOUT `parentId`, whose own `await` let the write land first. The same
  // tool told the truth or lied depending on an unrelated parameter.
  // ⭐ Worse than a wrong field: a font failure inside it surfaced as an
  // unhandledRejection AFTER the command had already answered, where no caller can catch
  // it. The offline suite observed exactly that before this line grew its `await`.
  const characterReport = {};
  const written = await setCharacters(textNode, text, { report: characterReport });
  if (!written || characterReport.fontSubstituted) {
    // Roll back the node we just created. Rollback is available HERE and nowhere else in
    // this contract precisely because the node is ours — nothing existed to preserve.
    textNode.remove();
    throw new Error(
      characterReport.fontSubstituted
        ? `create_text loaded ${requestedFont.family} ${requestedFont.style} and the character write substituted ${characterReport.appliedFont} anyway; the node was removed rather than left in a font nobody asked for.`
        : `create_text could not write its characters and the node was removed, so nothing was left behind. The font loaded, so this is Figma refusing the write itself.`,
    );
  }

  if (parentNode) {
    parentNode.appendChild(textNode);
  } else {
    figma.currentPage.appendChild(textNode);
  }

  const limitations = [];
  if (fontSource !== "explicit") {
    limitations.push(
      `No face was named, so this call chose one for you: ${requestedFont.family} ${requestedFont.style}. fontWeight reaches Inter's styles only — supply fontFamily/fontStyle to use any installed face.`,
    );
  }
  if (
    parentNode &&
    parentNode.layoutMode &&
    parentNode.layoutMode !== "NONE" &&
    supplied("textAutoResize")
  ) {
    limitations.push(
      "The parent is an auto-layout frame, and textAutoResize and the parent's layoutSizing describe the same behaviour from two sides. Inside auto-layout the parent wins, so the node may not resize the way textAutoResize claims.",
    );
  }

  return {
    id: textNode.id,
    name: textNode.name,
    x: textNode.x,
    y: textNode.y,
    width: textNode.width,
    height: textNode.height,
    characters: textNode.characters,
    fontSize: textNode.fontSize,
    // ⭐ `null`, never absent, when the face was named explicitly: `JSON.stringify`
    // drops an undefined key and a dropped key reads as "not reported" rather than
    // "this call did not go through the weight map".
    fontWeight:
      fontSource === "explicit"
        ? null
        : supplied("fontWeight")
          ? input.fontWeight
          : 400,
    fontColor: fontColor,
    fontName: textStyleReadable(textNode.fontName),
    fills: textNode.fills,
    parentId: textNode.parent ? textNode.parent.id : undefined,
    // ── R2.6 item 2.0 ───────────────────────────────────────────────────────────────
    // Which of the three ways the face was chosen — named, mapped from a weight, or
    // defaulted. A caller cannot otherwise tell an Inter it asked for from an Inter it
    // was given.
    fontSource,
    requestedFont,
    appliedFont: textStyleReadable(textNode.fontName),
    // ⭐ A PERMANENT declaration, not a state — the same shape as `set_text_style`'s.
    // The load is gated above and a substitution rolls the node back, so this cannot be
    // true; `false` says the question was asked and answered, where an absent field
    // would leave a reader unable to tell "no" from "not reported".
    fontSubstituted: false,
    appliedFields,
    appliedFieldCount: appliedFields.length,
    fontsLoaded: [requestedFont],
    style: textStyleSnapshot(textNode),
    limitations,
  };
}

async function setFillColor(params) {
  console.log("setFillColor", params);
  const {
    nodeId,
    color: { r, g, b, a },
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  // Create RGBA color
  const rgbColor = {
    r: parseFloat(r) || 0,
    g: parseFloat(g) || 0,
    b: parseFloat(b) || 0,
    a: parseFloat(a) || 1,
  };

  // Set fill
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(rgbColor.r),
      g: parseFloat(rgbColor.g),
      b: parseFloat(rgbColor.b),
    },
    opacity: parseFloat(rgbColor.a),
  };

  console.log("paintStyle", paintStyle);

  node.fills = [paintStyle];

  return {
    id: node.id,
    name: node.name,
    fills: [paintStyle],
  };
}

async function setStrokeColor(params) {
  const {
    nodeId,
    color: { r, g, b, a },
    weight = 1,
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("strokes" in node)) {
    throw new Error(`Node does not support strokes: ${nodeId}`);
  }

  // Create RGBA color
  const rgbColor = {
    r: r !== undefined ? r : 0,
    g: g !== undefined ? g : 0,
    b: b !== undefined ? b : 0,
    a: a !== undefined ? a : 1,
  };

  // Set stroke
  const paintStyle = {
    type: "SOLID",
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  node.strokes = [paintStyle];

  // Set stroke weight if available
  if ("strokeWeight" in node) {
    node.strokeWeight = weight;
  }

  return {
    id: node.id,
    name: node.name,
    strokes: node.strokes,
    strokeWeight: "strokeWeight" in node ? node.strokeWeight : undefined,
  };
}

// ⛔ **CROP IS THE ONE SCALE MODE THAT NEEDS A SECOND ARGUMENT**, and until R2.7 Phase 2 it
// silently did without one. MEASURED live 2026-08-23 (page `R2.7 P2 CROP probe`): writing
// `scaleMode: "CROP"` with no `imageTransform` is **accepted** by Figma and stored with the
// identity matrix `[[1,0,0],[0,1,0]]`, which `JSON_REST_V1` reports as `scaleMode: "STRETCH"`
// — a DIFFERENT ID SPACE for the same stored state, the third time this fork has been bitten
// by one. An identity transform maps the whole image onto the whole box, so the render is a
// **stretch**: a 200×100 probe squashed into a 100×100 node kept BOTH its edge markers, where
// a real `FILL` centre-crop dropped both. The old receipt echoed the requested `"CROP"` back,
// so the caller was told *crop* and shown a *distortion*.
//
// ⭐ **Reading the mode back would NOT have caught this** — the plugin node answers `"CROP"`
// too, so both vocabularies agree while the pixels disagree. The field that discriminates a
// crop from a stretch is the **transform**, never the mode name. That is why the receipt below
// reports `imageTransform` read off the node, and why a bare `CROP` is now refused rather than
// quietly defaulted: a discarded value reads as an applied one.
const IMAGE_TRANSFORM_ROWS = 2;
const IMAGE_TRANSFORM_COLUMNS = 3;

// Validates and normalizes a caller-supplied 2×3 image transform. Runs entirely in the
// validation phase — every throw here has written nothing anywhere.
function validateImageTransform(imageTransform, scaleMode) {
  if (imageTransform === undefined || imageTransform === null) {
    if (scaleMode === "CROP") {
      throw new Error(
        "scaleMode CROP requires imageTransform, a 2x3 matrix naming WHICH region to crop to, and wrote nothing. " +
          "Figma accepts a bare CROP but stores the identity matrix [[1,0,0],[0,1,0]], which maps the whole image onto " +
          "the whole node and renders a STRETCH, not a crop — measured live 2026-08-23. Pass imageTransform, or use " +
          "scaleMode FILL/FIT/TILE if a stretch is what you meant."
      );
    }
    return null;
  }

  // ⛔ Supplying a transform with any other mode would be SILENTLY DISCARDED by Figma —
  // `imageTransform` is read only for CROP. Same rule as `create_text`'s fontWeight ×
  // fontFamily and `set_fill`'s color.a × opacity: refuse the pair, never pick a winner.
  if (scaleMode !== "CROP") {
    throw new Error(
      `imageTransform only applies to scaleMode CROP; received scaleMode ${JSON.stringify(
        scaleMode
      )} and wrote nothing. Figma reads the transform for CROP alone, so supplying both would discard one silently.`
    );
  }

  if (!Array.isArray(imageTransform) || imageTransform.length !== IMAGE_TRANSFORM_ROWS) {
    throw new Error(
      `imageTransform must be an array of ${IMAGE_TRANSFORM_ROWS} rows; received ${JSON.stringify(
        imageTransform
      )} and wrote nothing`
    );
  }

  const normalized = [];
  for (let row = 0; row < IMAGE_TRANSFORM_ROWS; row++) {
    const values = imageTransform[row];
    if (!Array.isArray(values) || values.length !== IMAGE_TRANSFORM_COLUMNS) {
      throw new Error(
        `imageTransform[${row}] must be an array of ${IMAGE_TRANSFORM_COLUMNS} numbers; received ${JSON.stringify(
          values
        )} and wrote nothing`
      );
    }
    const rowValues = [];
    for (let column = 0; column < IMAGE_TRANSFORM_COLUMNS; column++) {
      const value = values[column];
      if (typeof value !== "number" || !isFinite(value)) {
        throw new Error(
          `imageTransform[${row}][${column}] must be a finite number; received ${JSON.stringify(
            value
          )} and wrote nothing`
        );
      }
      rowValues.push(value);
    }
    normalized.push(rowValues);
  }
  return normalized;
}

// Figma hands back a readonly Transform; JSON needs plain arrays.
function readImageTransform(paint) {
  if (!paint || !paint.imageTransform) return null;
  const rows = [];
  for (let row = 0; row < paint.imageTransform.length; row++) {
    rows.push(Array.prototype.slice.call(paint.imageTransform[row]));
  }
  return rows;
}

// R2.7 Phase 2 — `create_node_from_svg`.
//
// ⛔ **THIS TOOL IS NOT IDEMPOTENT AND SAYS SO IN ITS OWN RECEIPT.** `figma.createNodeFromSvg`
// appends a fresh subtree every call, so running the same request twice leaves two copies in
// the file. The plan's rule for this item was that the duplication is *stated rather than
// silent*, which is why `duplicatesOnRerun: true` is a permanent field of the reply and not a
// line in the docs: a caller retrying after a timeout needs the warning at the call site.
//
// ⛔ **THE INPUT IS BOUNDED, and the bound is on the SVG, not on the node count.** Figma gives
// no way to preflight how many nodes a document will expand into, so the only honest ceiling
// is the source length. The count is reported AFTER the fact — a reading, never a promise.
const MAX_SVG_SOURCE_LENGTH = 512 * 1024;

// Counts the created subtree, root included. `createNodeFromSvg` returns one FrameNode whose
// depth is the SVG's, so this is a reading of what actually landed rather than a prediction.
function countSubtree(node) {
  let total = 1;
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      total += countSubtree(child);
    }
  }
  return total;
}

async function createNodeFromSvg(params) {
  const { svg, x = 0, y = 0, name, parentId } = params || {};

  if (typeof svg !== "string" || svg.length === 0) {
    throw new Error(
      "create_node_from_svg requires svg, a non-empty string of SVG source, and created nothing"
    );
  }
  if (svg.length > MAX_SVG_SOURCE_LENGTH) {
    throw new Error(
      `create_node_from_svg refused ${svg.length} characters of SVG: this fork's ceiling is ${MAX_SVG_SOURCE_LENGTH}. ` +
        "The limit is on the SOURCE because Figma offers no way to preflight how many nodes it will expand into, and created nothing"
    );
  }
  for (const [label, value] of [["x", x], ["y", y]]) {
    if (typeof value !== "number" || !isFinite(value)) {
      throw new Error(
        `create_node_from_svg requires ${label} to be a finite number; received ${JSON.stringify(
          value
        )} and created nothing`
      );
    }
  }

  // ⛔ VALIDATE-ALL-THEN-CREATE, the rule `create_text` established: the parent is resolved
  // BEFORE `createNodeFromSvg`, because on a create tool a late refusal leaves an orphan node
  // in the document rather than a half-written one.
  let parent = figma.currentPage;
  if (parentId) {
    parent = await figma.getNodeByIdAsync(parentId);
    if (!parent) {
      throw new Error(`Parent node not found with ID: ${parentId} — created nothing`);
    }
    if (!("appendChild" in parent)) {
      throw new Error(
        `create_node_from_svg cannot parent into ${parentId}: a ${parent.type} accepts no children, and created nothing`
      );
    }
  }

  let node;
  try {
    node = figma.createNodeFromSvg(svg);
  } catch (error) {
    // Figma's own parser is the authority on what SVG is; this fork does not second-guess it.
    throw new Error(
      `Figma rejected the SVG source and created nothing: ${error.message}`
    );
  }

  node.x = x;
  node.y = y;
  if (name !== undefined) {
    if (typeof name !== "string" || name.length === 0) {
      // ⚠️ The node already exists by this point, so a refusal here must REMOVE it — a
      // half-created node is exactly what validate-all-then-create exists to prevent, and
      // `name` is the one field that cannot be checked before Figma has parsed the source.
      node.remove();
      throw new Error(
        `create_node_from_svg requires name to be a non-empty string when supplied; received ${JSON.stringify(
          name
        )} and removed the node it had created`
      );
    }
    node.name = name;
  }
  if (parentId) {
    parent.appendChild(node);
  }

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    parentId: node.parent ? node.parent.id : null,
    // A reading taken after the fact, not a prediction — see the comment on countSubtree.
    createdNodeCount: countSubtree(node),
    svgSourceLength: svg.length,
    // ⛔ Permanent and always true. Idempotency is DEFERRED, not absent-by-oversight: a
    // caller who retries this request after a timeout gets a second copy, and the reply is
    // where that has to be said.
    duplicatesOnRerun: true,
  };
}

async function setImageFill(params) {
  const { nodeId, imageBase64, scaleMode = "FILL", imageTransform } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!imageBase64) {
    throw new Error("Missing imageBase64 parameter");
  }

  const validScaleModes = ["FILL", "FIT", "CROP", "TILE"];
  if (validScaleModes.indexOf(scaleMode) === -1) {
    throw new Error(
      `Invalid scaleMode: ${scaleMode}. Must be one of: ${validScaleModes.join(", ")}`
    );
  }

  // ⛔ VALIDATE-ALL-THEN-WRITE. The transform is checked before the node is resolved and
  // long before `createImage`, so a bad matrix cannot leave an orphaned image in the file.
  const requestedTransform = validateImageTransform(imageTransform, scaleMode);

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  const bytes = base64ToUint8Array(imageBase64);

  let image;
  try {
    image = figma.createImage(bytes);
  } catch (error) {
    throw new Error(
      `Figma rejected the image (supported: PNG/JPG/GIF/WEBP up to 4096x4096): ${error.message}`
    );
  }

  const paint = {
    type: "IMAGE",
    imageHash: image.hash,
    scaleMode: scaleMode,
  };
  if (requestedTransform) {
    paint.imageTransform = requestedTransform;
  }
  node.fills = [paint];

  let imageWidth;
  let imageHeight;
  try {
    const size = await image.getSizeAsync();
    imageWidth = size.width;
    imageHeight = size.height;
  } catch (sizeError) {
    // Size lookup is informational only
  }

  // ⭐ READ BACK off the node rather than echoing the request. `scaleMode` alone cannot
  // falsify itself here (see the block above), so the transform travels with it — that is
  // the reading a caller needs to tell a crop from a stretch.
  const appliedPaint = Array.isArray(node.fills) ? node.fills[0] : null;
  const appliedTransform = readImageTransform(appliedPaint);
  // ⛔ NO SILENT FALLBACK TO THE REQUEST. An earlier draft read
  // `appliedPaint.scaleMode ? appliedPaint.scaleMode : scaleMode`, which quietly reprinted the
  // caller's own argument whenever the node could not be read — turning an unreadable node
  // into a confident echo, indistinguishable from a real reading. `null` plus an explicit
  // readability flag is the same shape `set_opacity` uses, and it cannot be mistaken for a
  // measurement. See [[feedback_a_silent_default_is_byte_identical_to_a_decision]].
  const scaleModeReadable =
    !!appliedPaint && typeof appliedPaint.scaleMode === "string";

  return {
    id: node.id,
    name: node.name,
    imageHash: image.hash,
    scaleMode: scaleModeReadable ? appliedPaint.scaleMode : null,
    scaleModeReadable: scaleModeReadable,
    imageTransform: appliedTransform,
    // `caller` is the only reachable value while a bare CROP is refused; `none` covers every
    // non-CROP mode. ⛔ Recorded as a fact about the current refusal, not a permanent one —
    // if the refusal is ever relaxed, a `platform-default` reading becomes possible here.
    imageTransformSource: requestedTransform ? "caller" : "none",
    imageWidth: imageWidth,
    imageHeight: imageHeight,
  };
}

// Decode base64 in the plugin sandbox, where atob is not available
function base64ToUint8Array(base64) {
  if (typeof figma.base64Decode === "function") {
    return figma.base64Decode(base64);
  }

  const base64Chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const length = clean.length;
  const bytes = new Uint8Array(Math.floor((length * 3) / 4));

  let byteIndex = 0;
  for (let i = 0; i < length; i += 4) {
    const a = base64Chars.indexOf(clean[i]);
    const b = base64Chars.indexOf(clean[i + 1]);
    const c = base64Chars.indexOf(clean[i + 2]);
    const d = base64Chars.indexOf(clean[i + 3]);

    bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (c !== -1) bytes[byteIndex++] = ((b & 15) << 4) | (c >> 2);
    if (d !== -1) bytes[byteIndex++] = ((c & 3) << 6) | d;
  }

  return bytes.slice(0, byteIndex);
}

async function renameNode(params) {
  const { nodeId, name } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (name === undefined || name === null) {
    throw new Error("Missing name parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const previousName = node.name;
  try {
    node.name = String(name);
  } catch (error) {
    throw new Error(`Cannot rename node: ${error.message}`);
  }

  return {
    id: node.id,
    previousName: previousName,
    name: node.name,
  };
}

async function createSection(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Section",
  } = params || {};

  const section = figma.createSection();
  section.name = name;
  section.x = x;
  section.y = y;
  section.resizeWithoutConstraints(width, height);

  return {
    id: section.id,
    name: section.name,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
  };
}

async function setParent(params) {
  const { nodeId, parentId, x, y, index } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (!parentId) {
    throw new Error("Missing parentId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const parentNode = await figma.getNodeByIdAsync(parentId);
  if (!parentNode) {
    throw new Error(`Parent node not found with ID: ${parentId}`);
  }

  if (!("appendChild" in parentNode)) {
    throw new Error(`Parent node does not support children: ${parentId}`);
  }

  // Refuse to create a cycle
  let ancestor = parentNode;
  while (ancestor) {
    if (ancestor.id === node.id) {
      throw new Error("Cannot move a node into its own subtree");
    }
    ancestor = ancestor.parent;
  }

  // Capture the absolute position so it can be preserved across the move
  const hasAbsolute = "absoluteTransform" in node;
  const absoluteX = hasAbsolute ? node.absoluteTransform[0][2] : undefined;
  const absoluteY = hasAbsolute ? node.absoluteTransform[1][2] : undefined;

  if (index !== undefined) {
    parentNode.insertChild(index, node);
  } else {
    parentNode.appendChild(node);
  }

  if (x !== undefined && y !== undefined) {
    node.x = x;
    node.y = y;
  } else if (hasAbsolute && "x" in node) {
    const parentAbsoluteX =
      "absoluteTransform" in parentNode ? parentNode.absoluteTransform[0][2] : 0;
    const parentAbsoluteY =
      "absoluteTransform" in parentNode ? parentNode.absoluteTransform[1][2] : 0;
    node.x = absoluteX - parentAbsoluteX;
    node.y = absoluteY - parentAbsoluteY;
  }

  return {
    id: node.id,
    name: node.name,
    parentId: parentNode.id,
    parentName: parentNode.name,
    x: "x" in node ? node.x : undefined,
    y: "y" in node ? node.y : undefined,
    index: parentNode.children.indexOf(node),
  };
}

async function moveNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (x === undefined || y === undefined) {
    throw new Error("Missing x or y parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("x" in node) || !("y" in node)) {
    throw new Error(`Node does not support position: ${nodeId}`);
  }

  node.x = x;
  node.y = y;

  return {
    id: node.id,
    name: node.name,
    x: node.x,
    y: node.y,
  };
}

async function resizeNode(params) {
  const { nodeId, width, height } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (width === undefined || height === undefined) {
    throw new Error("Missing width or height parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("resize" in node)) {
    throw new Error(`Node does not support resizing: ${nodeId}`);
  }

  node.resize(width, height);

  return {
    id: node.id,
    name: node.name,
    width: node.width,
    height: node.height,
  };
}

async function deleteNode(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Save node info before deleting
  const nodeInfo = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  node.remove();

  return nodeInfo;
}

function startProgressHeartbeat(
  commandId,
  commandType,
  progress,
  totalItems,
  processedItems,
  message
) {
  const timer = setInterval(() => {
    sendProgressUpdate(
      commandId,
      commandType,
      "in_progress",
      progress,
      totalItems,
      processedItems,
      message
    ).catch((error) => {
      console.error(`Failed to send ${commandType} heartbeat:`, error);
    });
  }, 15000);

  return () => clearInterval(timer);
}

async function getStyles(params) {
  const commandId = (params && params.commandId) || generateCommandId();
  const styleLoaders = [
    ["colors", () => figma.getLocalPaintStylesAsync()],
    ["texts", () => figma.getLocalTextStylesAsync()],
    ["effects", () => figma.getLocalEffectStylesAsync()],
    ["grids", () => figma.getLocalGridStylesAsync()],
  ];
  const styles = {};

  await sendProgressUpdate(
    commandId,
    "get_styles",
    "started",
    0,
    styleLoaders.length,
    0,
    "Loading document-wide local styles"
  );

  try {
    for (let index = 0; index < styleLoaders.length; index++) {
      const [styleType, loadStyles] = styleLoaders[index];
      const stopHeartbeat = startProgressHeartbeat(
        commandId,
        "get_styles",
        Math.round((index / styleLoaders.length) * 100),
        styleLoaders.length,
        index,
        `Still loading ${styleType} styles`
      );

      try {
        styles[styleType] = await loadStyles();
      } finally {
        stopHeartbeat();
      }

      await sendProgressUpdate(
        commandId,
        "get_styles",
        "in_progress",
        Math.round(((index + 1) / styleLoaders.length) * 100),
        styleLoaders.length,
        index + 1,
        `Loaded ${styles[styleType].length} ${styleType} styles`
      );
    }
  } catch (error) {
    await sendProgressUpdate(
      commandId,
      "get_styles",
      "error",
      0,
      styleLoaders.length,
      0,
      `Failed to load styles: ${error.message || String(error)}`
    );
    throw error;
  }

  const result = {
    scope: "document",
    colors: styles.colors.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      paint: style.paints[0],
    })),
    texts: styles.texts.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
  };

  result.counts = {
    colors: result.colors.length,
    texts: result.texts.length,
    effects: result.effects.length,
    grids: result.grids.length,
  };

  await sendProgressUpdate(
    commandId,
    "get_styles",
    "completed",
    100,
    styleLoaders.length,
    styleLoaders.length,
    `Loaded ${Object.values(result.counts).reduce((sum, count) => sum + count, 0)} local styles`
  );

  return result;
}

function getComponentFamilyName(component) {
  if (component.parent && component.parent.type === "COMPONENT_SET") {
    return component.parent.name;
  }

  return getNameFamily(component.name);
}

// "Icons/Arrow/Left" -> "Icons". Names without a path collapse to themselves, which
// still groups usefully because designers repeat top-level frame names.
function getNameFamily(name) {
  const firstPathSegment = String(name).split("/")[0].trim();
  return firstPathSegment || String(name);
}

// Figma node ids are "<session>:<local>", and the first segment is shared by every
// node created in the same authoring session. A bulk-pasted vendor kit therefore
// lands in one or two sessions while hand-authored work spreads across the ones the
// designer actually worked in — the split the portfolio audit derived by hand.
// This is an observed property of the id format, not a documented API, so the payload
// exposes the clusters and never labels one of them "the kit": that call needs a
// human who knows the file, and asserting it here would be exactly the kind of
// confident-but-invented finding this read layer exists to stop producing.
function getAuthoringSessionId(node) {
  const firstSegment = String(node.id).split(":")[0].trim();
  return firstSegment || "unknown";
}

async function getLocalComponents(params) {
  const commandId = (params && params.commandId) || generateCommandId();
  const summary = !params || params.summary !== false;
  const offset = Math.max(0, Number((params && params.offset) || 0));
  const limit = Math.min(
    500,
    Math.max(1, Number((params && params.limit) || 100))
  );
  const familyLimit = Math.min(
    500,
    Math.max(1, Number((params && params.familyLimit) || 100))
  );
  const sessionLimit = Math.min(
    100,
    Math.max(1, Number((params && params.sessionLimit) || 20))
  );
  // 0 (the default) means no budget — existing callers keep the old behaviour.
  const timeBudgetMs = Math.max(
    0,
    Number((params && params.timeBudgetMs) || 0)
  );
  const documentPages = figma.root.children;
  const totalPages = documentPages.length;

  // The dominant cost of this tool is page.loadAsync(), which dynamic-page access
  // forces before a page can be queried at all — not the component scan itself.
  // Scoping to specific pages is therefore the only real way to make it cheaper.
  // An empty array is treated as "no filter", not as "scan nothing" — the latter
  // would return count:0 with complete:true, which reads as a real finding.
  const requestedPageIdsRaw =
    params && Array.isArray(params.pages) ? params.pages.filter(Boolean) : [];
  const requestedPageIds =
    requestedPageIdsRaw.length > 0 ? requestedPageIdsRaw : null;
  const pagesNotFound = [];
  var targetPages = documentPages;

  if (requestedPageIds) {
    const byId = new Map(documentPages.map((page) => [page.id, page]));
    targetPages = [];
    for (const requestedId of requestedPageIds) {
      const match = byId.get(requestedId);
      if (match) {
        targetPages.push(match);
      } else {
        // Never drop an unknown id silently — a caller must be able to tell
        // "that page holds no components" from "that page does not exist".
        pagesNotFound.push(requestedId);
      }
    }
  }

  const targetPageCount = targetPages.length;

  await sendProgressUpdate(
    commandId,
    "get_local_components",
    "started",
    0,
    targetPageCount,
    0,
    "Starting component scan across " + targetPageCount + " of " + totalPages + " pages...",
    null
  );

  var totalComponents = 0;
  var components = [];
  var familyCounts = new Map();
  var sessionCounts = new Map();
  var pageCounts = [];
  var pagesSkipped = [];
  var budgetExhausted = false;
  const startedAt = Date.now();

  for (var i = 0; i < targetPageCount; i++) {
    var page = targetPages[i];

    // Check before loading, because loading is the expensive step. The first page
    // always runs, so a tight budget still returns something rather than nothing.
    if (
      timeBudgetMs > 0 &&
      i > 0 &&
      Date.now() - startedAt >= timeBudgetMs
    ) {
      budgetExhausted = true;
      for (var k = i; k < targetPageCount; k++) {
        pagesSkipped.push({
          id: targetPages[k].id,
          name: targetPages[k].name,
          reason: "time_budget_exhausted",
        });
      }
      break;
    }

    var stopHeartbeat = startProgressHeartbeat(
      commandId,
      "get_local_components",
      Math.round((i / targetPageCount) * 100),
      targetPageCount,
      i,
      "Still loading page " + page.name
    );
    try {
      await page.loadAsync();
    } finally {
      stopHeartbeat();
    }

    var pageComponents = page.findAllWithCriteria({ types: ["COMPONENT"] });

    for (var j = 0; j < pageComponents.length; j++) {
      var component = pageComponents[j];
      var family = getComponentFamilyName(component);
      familyCounts.set(family, (familyCounts.get(family) || 0) + 1);

      var session = getAuthoringSessionId(component);
      var sessionEntry = sessionCounts.get(session);
      if (!sessionEntry) {
        sessionEntry = { count: 0, families: new Map() };
        sessionCounts.set(session, sessionEntry);
      }
      sessionEntry.count++;
      sessionEntry.families.set(
        family,
        (sessionEntry.families.get(family) || 0) + 1
      );

      if (
        !summary &&
        totalComponents >= offset &&
        components.length < limit
      ) {
        components.push({
          id: component.id,
          name: component.name,
          family,
          key: "key" in component ? component.key : null,
          pageId: page.id,
          pageName: page.name,
        });
      }

      totalComponents++;
    }

    pageCounts.push({
      id: page.id,
      name: page.name,
      componentCount: pageComponents.length,
    });

    var progress = Math.round(((i + 1) / targetPageCount) * 100);
    await sendProgressUpdate(
      commandId,
      "get_local_components",
      "in_progress",
      progress,
      targetPageCount,
      i + 1,
      "Scanned " + page.name + ": " + pageComponents.length + " components (total so far: " + totalComponents + ")",
      null
    );
  }

  const pagesScanned = pageCounts.length;

  await sendProgressUpdate(
    commandId,
    "get_local_components",
    "completed",
    100,
    targetPageCount,
    pagesScanned,
    "Found " + totalComponents + " components across " + pagesScanned + " pages",
    null
  );

  const nameFamilies = Array.from(familyCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  // Sorted by volume so the dominant population reads first; `session` is kept in the
  // payload because a low id ordinarily means an earlier session, which is the signal
  // a human uses to tell a pasted library from the designer's own work.
  const authoringSessions = Array.from(sessionCounts.entries())
    .map(([session, entry]) => ({
      session,
      count: entry.count,
      familyCount: entry.families.size,
      topFamilies: Array.from(entry.families.entries())
        .map(([name, count]) => ({ name, count }))
        .sort(
          (left, right) =>
            right.count - left.count || left.name.localeCompare(right.name)
        )
        .slice(0, 3),
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.session.localeCompare(right.session)
    );

  const limitations = [];
  if (pagesNotFound.length > 0) {
    limitations.push(
      pagesNotFound.length +
        " requested page id(s) do not exist in this document and were not scanned: " +
        pagesNotFound.join(", ") +
        ". Use get_pages for valid ids."
    );
  }
  if (budgetExhausted) {
    limitations.push(
      "Time budget of " +
        timeBudgetMs +
        "ms was exhausted after " +
        pagesScanned +
        " of " +
        targetPageCount +
        " page(s). Counts below cover only the scanned pages — they are NOT a document total. Raise timeBudgetMs" +
        (requestedPageIds ? "" : " or scope with the pages parameter") +
        "."
    );
  }
  // Fires even when the budget also ran out: a reply that was BOTH scoped and
  // truncated used to disclose only the truncation, leaving the caller unable to see
  // that whole pages were never in scope to begin with.
  if (requestedPageIds) {
    limitations.push(
      "Scoped to " +
        requestedPageIds.length +
        " requested page(s); " +
        pagesScanned +
        " scanned of " +
        totalPages +
        " in the document. Counts are not a document total."
    );
  }

  // `complete` means "these counts describe every page asked for". It is false the
  // moment coverage is partial for any reason, so a scoped or truncated scan can
  // never be mistaken for a document-wide census.
  const coverage = {
    scope: requestedPageIds ? "selected_pages" : "document",
    complete: !budgetExhausted && pagesNotFound.length === 0,
    pagesTotal: totalPages,
    pagesRequested: requestedPageIds ? requestedPageIds.length : totalPages,
    pagesScanned,
    pagesSkipped,
    pagesNotFound,
    limitations,
  };

  if (summary) {
    return Object.assign({}, coverage, {
      summary: true,
      count: totalComponents,
      pages: pageCounts,
      familyCount: nameFamilies.length,
      nameFamilies: nameFamilies.slice(0, familyLimit),
      familiesTruncated: nameFamilies.length > familyLimit,
      familyLimit,
      sessionCount: authoringSessions.length,
      authoringSessions: authoringSessions.slice(0, sessionLimit),
      sessionsTruncated: authoringSessions.length > sessionLimit,
      sessionLimit,
    });
  }

  return Object.assign({}, coverage, {
    summary: false,
    count: totalComponents,
    pages: pageCounts,
    pagination: {
      offset,
      limit,
      returned: components.length,
      hasMore: offset + components.length < totalComponents,
    },
    components,
  });
}

const VARIABLE_TYPES = ["COLOR", "FLOAT", "STRING", "BOOLEAN"];

async function resolveVariableValueForMode(
  variable,
  modeId,
  modeName,
  visited = new Set()
) {
  const visitKey = `${variable.id}:${modeId}`;
  if (visited.has(visitKey)) {
    return {
      status: "cycle",
      value: null,
    };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(visitKey);

  let selectedModeId = modeId;
  let rawValue = variable.valuesByMode[selectedModeId];
  const collection = await getVariableCollectionByIdCached(
    variable.variableCollectionId
  );

  if (rawValue === undefined && collection) {
    const namedMode = collection.modes.find((mode) => mode.name === modeName);
    selectedModeId = namedMode
      ? namedMode.modeId
      : collection.defaultModeId;
    rawValue = variable.valuesByMode[selectedModeId];
  }

  if (
    rawValue &&
    typeof rawValue === "object" &&
    rawValue.type === "VARIABLE_ALIAS" &&
    typeof rawValue.id === "string"
  ) {
    const targetVariable = await getVariableByIdCached(rawValue.id);
    if (!targetVariable) {
      return {
        status: "unresolved_alias",
        value: serializeVariableValue(rawValue),
      };
    }

    return await resolveVariableValueForMode(
      targetVariable,
      selectedModeId,
      modeName,
      nextVisited
    );
  }

  if (rawValue === undefined) {
    return {
      status: "missing_mode_value",
      value: null,
    };
  }

  return {
    status: "resolved",
    value: serializeVariableValue(rawValue),
  };
}

async function getVariables(params) {
  if (!hasVariablesApi()) {
    return {
      scope: "document",
      supported: false,
      complete: false,
      limitation:
        "Variables API not available in this Figma version. No negative conclusion about variables can be drawn from this result.",
      collections: [],
    };
  }

  const requestedTypes =
    params && Array.isArray(params.types) && params.types.length > 0
      ? params.types.filter((type) => VARIABLE_TYPES.includes(type))
      : VARIABLE_TYPES;
  const commandId = (params && params.commandId) || generateCommandId();
  const typeResults = [];
  const errors = [];

  await sendProgressUpdate(
    commandId,
    "get_variables",
    "started",
    0,
    requestedTypes.length + 1,
    0,
    `Loading ${requestedTypes.length} variable types and collections`
  );

  for (let index = 0; index < requestedTypes.length; index++) {
    const type = requestedTypes[index];
    const stopHeartbeat = startProgressHeartbeat(
      commandId,
      "get_variables",
      Math.round((index / (requestedTypes.length + 1)) * 100),
      requestedTypes.length + 1,
      index,
      `Still loading ${type} variables`
    );
    try {
      const variables = await figma.variables.getLocalVariablesAsync(type);
      typeResults.push({ type, variables });
      for (const variable of variables) {
        variableCache.set(variable.id, Promise.resolve(variable));
      }
    } catch (error) {
      errors.push({
        type,
        error: error.message || String(error),
      });
      typeResults.push({ type, variables: [] });
    } finally {
      stopHeartbeat();
    }

    await sendProgressUpdate(
      commandId,
      "get_variables",
      "in_progress",
      Math.round(((index + 1) / (requestedTypes.length + 1)) * 100),
      requestedTypes.length + 1,
      index + 1,
      `Loaded ${typeResults[typeResults.length - 1].variables.length} ${type} variables`
    );
  }

  let collections;
  const stopCollectionHeartbeat = startProgressHeartbeat(
    commandId,
    "get_variables",
    Math.round(
      (requestedTypes.length / (requestedTypes.length + 1)) * 100
    ),
    requestedTypes.length + 1,
    requestedTypes.length,
    "Still loading variable collections"
  );
  try {
    collections =
      await figma.variables.getLocalVariableCollectionsAsync();
    for (const collection of collections) {
      variableCollectionCache.set(
        collection.id,
        Promise.resolve(collection)
      );
    }
  } catch (error) {
    return {
      scope: "document",
      supported: true,
      complete: false,
      limitation: `Variable collections could not be read: ${error.message || String(error)}`,
      collections: [],
      errors,
    };
  } finally {
    stopCollectionHeartbeat();
  }

  const variables = typeResults.flatMap((result) => result.variables);
  const variablesByCollection = new Map();
  for (const variable of variables) {
    const collectionVariables =
      variablesByCollection.get(variable.variableCollectionId) || [];
    collectionVariables.push(variable);
    variablesByCollection.set(
      variable.variableCollectionId,
      collectionVariables
    );
  }

  const stopResolutionHeartbeat = startProgressHeartbeat(
    commandId,
    "get_variables",
    95,
    requestedTypes.length + 1,
    requestedTypes.length,
    "Still resolving variable aliases by mode"
  );
  let collectionPayloads;
  try {
    collectionPayloads = await Promise.all(
      collections.map(async (collection) => {
      const collectionVariables =
        variablesByCollection.get(collection.id) || [];
      const modes = await Promise.all(
        collection.modes.map(async (mode) => {
          const modeVariables = await Promise.all(
            collectionVariables.map(async (variable) => {
              const rawValue = variable.valuesByMode[mode.modeId];
              const resolved = await resolveVariableValueForMode(
                variable,
                mode.modeId,
                mode.name
              );

              return {
                id: variable.id,
                name: variable.name,
                key: variable.key,
                description: variable.description,
                resolvedType: variable.resolvedType,
                scopes: variable.scopes,
                value:
                  rawValue === undefined
                    ? null
                    : serializeVariableValue(rawValue),
                resolvedValue: resolved.value,
                resolutionStatus: resolved.status,
              };
            })
          );

          return {
            id: mode.modeId,
            name: mode.name,
            variables: modeVariables,
          };
        })
      );

      return {
        id: collection.id,
        name: collection.name,
        key: collection.key,
        defaultModeId: collection.defaultModeId,
        variableCount: collectionVariables.length,
        modes,
      };
      })
    );
  } finally {
    stopResolutionHeartbeat();
  }

  const resolutionIssueCount = collectionPayloads.reduce(
    (collectionIssueCount, collection) =>
      collectionIssueCount +
      collection.modes.reduce(
        (modeIssueCount, mode) =>
          modeIssueCount +
          mode.variables.filter(
            (variable) => variable.resolutionStatus !== "resolved"
          ).length,
        0
      ),
    0
  );

  await sendProgressUpdate(
    commandId,
    "get_variables",
    "completed",
    100,
    requestedTypes.length + 1,
    requestedTypes.length + 1,
    `Loaded ${variables.length} variables in ${collections.length} collections`
  );

  const limitations = [];
  if (errors.length > 0) {
    limitations.push(
      `${errors.length} requested variable types could not be read; inspect errors.`
    );
  }
  if (resolutionIssueCount > 0) {
    limitations.push(
      `${resolutionIssueCount} mode values could not be fully resolved; inspect resolutionStatus.`
    );
  }

  return {
    scope: "document",
    supported: true,
    complete: errors.length === 0 && resolutionIssueCount === 0,
    requestedTypes,
    collectionCount: collectionPayloads.length,
    variableCount: variables.length,
    resolutionIssueCount,
    limitations,
    collections: collectionPayloads,
    errors,
  };
}

function appendVariableAliases(value, property, records) {
  if (Array.isArray(value)) {
    value.forEach((nestedValue, index) => {
      appendVariableAliases(
        nestedValue,
        `${property}[${index}]`,
        records
      );
    });
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (typeof value.id === "string") {
    records.push({
      property,
      variableId: value.id,
    });
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    appendVariableAliases(
      nestedValue,
      property ? `${property}.${key}` : key,
      records
    );
  }
}

function collectNestedBindings(items, property, records) {
  if (!Array.isArray(items)) {
    return;
  }

  items.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }

    if (item.boundVariables) {
      appendVariableAliases(
        item.boundVariables,
        `${property}[${index}]`,
        records
      );
    }

    if (Array.isArray(item.gradientStops)) {
      item.gradientStops.forEach((stop, stopIndex) => {
        if (stop && stop.boundVariables) {
          appendVariableAliases(
            stop.boundVariables,
            `${property}[${index}].gradientStops[${stopIndex}]`,
            records
          );
        }
      });
    }
  });
}

function collectBindingsForNode(node) {
  const records = [];
  const aggregateProperties = new Set([
    "fills",
    "strokes",
    "effects",
    "layoutGrids",
  ]);

  if ("boundVariables" in node && node.boundVariables) {
    for (const [property, value] of Object.entries(node.boundVariables)) {
      if (!aggregateProperties.has(property)) {
        appendVariableAliases(value, property, records);
      }
    }
  }

  collectNestedBindings("fills" in node ? node.fills : null, "fills", records);
  collectNestedBindings(
    "strokes" in node ? node.strokes : null,
    "strokes",
    records
  );
  collectNestedBindings(
    "effects" in node ? node.effects : null,
    "effects",
    records
  );
  collectNestedBindings(
    "layoutGrids" in node ? node.layoutGrids : null,
    "layoutGrids",
    records
  );

  if ("boundVariables" in node && node.boundVariables) {
    for (const property of aggregateProperties) {
      const aggregateValue = node.boundVariables[property];
      if (!aggregateValue) {
        continue;
      }

      const aggregateRecords = [];
      appendVariableAliases(aggregateValue, property, aggregateRecords);
      for (const aggregateRecord of aggregateRecords) {
        const aggregatePrefix = aggregateRecord.property.replace(
          /(\[[0-9]+\]).*$/,
          "$1"
        );
        const representedByNestedBinding = records.some(
          (record) =>
            record.variableId === aggregateRecord.variableId &&
            record.property.startsWith(aggregatePrefix)
        );
        if (!representedByNestedBinding) {
          records.push(aggregateRecord);
        }
      }
    }
  }

  const uniqueRecords = new Map();
  for (const record of records) {
    uniqueRecords.set(
      `${record.property}:${record.variableId}`,
      record
    );
  }
  return Array.from(uniqueRecords.values());
}

function getNodePath(node) {
  const path = [];
  let current = node;
  while (current && current.type !== "DOCUMENT") {
    path.unshift(current.name);
    current = current.parent;
  }
  return path.join(" > ");
}

async function resolveNodeBinding(node, record) {
  const variable = await getVariableByIdCached(record.variableId);
  if (!variable) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      nodePath: getNodePath(node),
      property: record.property,
      variableId: record.variableId,
      variableName: null,
      value: null,
      resolvedType: null,
      resolutionStatus: "variable_not_found",
    };
  }

  try {
    const resolved = variable.resolveForConsumer(node);
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      nodePath: getNodePath(node),
      property: record.property,
      variableId: variable.id,
      variableName: variable.name,
      value: serializeVariableValue(resolved.value),
      resolvedType: resolved.resolvedType,
      resolutionStatus: "resolved",
    };
  } catch (error) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      nodePath: getNodePath(node),
      property: record.property,
      variableId: variable.id,
      variableName: variable.name,
      value: null,
      resolvedType: variable.resolvedType,
      resolutionStatus: "resolution_failed",
      error: error.message || String(error),
    };
  }
}

// Ceiling on a single get_node_variables scan. A page-wide scan of 11,733 nodes
// produced a 3.66 MB reply and left the plugin unable to answer ANY subsequent
// command until it was reloaded — the traversal, not the payload, is what saturates
// it. Every other large read in this plugin is paged or budgeted; this default makes
// this one bounded too. It is deliberately a DEFAULT, not just an option: the failure
// mode it prevents is silent, and a truncated-but-declared reply is strictly better
// than a wedged plugin. Callers who know their subtree is small can raise it.
const NODE_VARIABLES_MAX_NODES_DEFAULT = 5000;
const NODE_VARIABLES_MAX_NODES_CEILING = 50000;
// Records returned per array. The counts stay whole-window totals; only the arrays
// are windowed, so a caller can always tell truncation from absence.
const NODE_VARIABLES_LIMIT_DEFAULT = 1000;
const NODE_VARIABLES_LIMIT_CEILING = 5000;

async function getNodeVariables(params) {
  const { nodeId, commandId = generateCommandId() } = params || {};
  const maxNodes = Math.min(
    NODE_VARIABLES_MAX_NODES_CEILING,
    Math.max(
      1,
      Number(
        (params && params.maxNodes) || NODE_VARIABLES_MAX_NODES_DEFAULT
      )
    )
  );
  const limit = Math.min(
    NODE_VARIABLES_LIMIT_CEILING,
    Math.max(1, Number((params && params.limit) || NODE_VARIABLES_LIMIT_DEFAULT))
  );
  const offset = Math.max(0, Number((params && params.offset) || 0));
  // 0 (the default) means no wall-clock budget, matching get_local_components.
  const timeBudgetMs = Math.max(
    0,
    Number((params && params.timeBudgetMs) || 0)
  );
  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }
  if (nodeId === figma.root.id || nodeId === "0:0") {
    throw new Error(
      "Document-root traversal is not supported by get_node_variables. Use get_pages, then query a page or child node."
    );
  }

  const rootNode = await figma.getNodeByIdAsync(nodeId);
  if (!rootNode) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  // The budget starts before the page load, not after: on a dynamic-page file that
  // load is frequently the single most expensive step, and a budget that excluded it
  // would under-report the time the caller actually waited.
  const startedAt = Date.now();
  if (rootNode.type === "PAGE") {
    await rootNode.loadAsync();
  }

  const canResolveVariables = hasVariablesApi();
  const canResolveStyles = hasStylesApi();
  // The arrays hold only the requested window; the counters describe everything the
  // scan actually saw. Keeping them separate is what lets a caller tell "1000 of 4820
  // returned" from "4820 found".
  const bindings = [];
  const styles = [];
  let nodesScanned = 0;
  let bindingCount = 0;
  let styleCount = 0;
  let unresolvedBindings = 0;
  let unresolvedStyles = 0;
  let unreadableStyleValues = 0;
  let nodeCapReached = false;
  let budgetExhausted = false;

  await sendProgressUpdate(
    commandId,
    "get_node_variables",
    "started",
    0,
    0,
    0,
    `Scanning variable bindings and style references under ${rootNode.name} (cap ${maxNodes} nodes)`
  );

  function windowRecord(target, index, record) {
    if (index >= offset && target.length < limit) {
      target.push(record);
    }
  }

  // Iterative pre-order DFS. It matches the previous recursive order exactly — which is
  // what makes offset/limit windows stable across calls — and it cannot blow the stack
  // on a deep subtree.
  async function scan(root) {
    const stack = [root];
    while (stack.length > 0) {
      if (nodesScanned >= maxNodes) {
        nodeCapReached = true;
        return;
      }
      if (
        timeBudgetMs > 0 &&
        nodesScanned > 0 &&
        Date.now() - startedAt >= timeBudgetMs
      ) {
        budgetExhausted = true;
        return;
      }

      const node = stack.pop();
      nodesScanned++;

      const nodeBindings = collectBindingsForNode(node);
      const resolvedBindings = await Promise.all(
        nodeBindings.map((record) => resolveNodeBinding(node, record))
      );
      for (const record of resolvedBindings) {
        if (record.resolutionStatus !== "resolved") {
          unresolvedBindings++;
        }
        windowRecord(bindings, bindingCount, record);
        bindingCount++;
      }

      const nodeStyleRefs = collectStyleRefsForNode(node);
      const resolvedStyles = await Promise.all(
        nodeStyleRefs.map((record) => resolveNodeStyle(node, record))
      );
      for (const record of resolvedStyles) {
        if (record.resolutionStatus !== "resolved") {
          unresolvedStyles++;
        } else if (record.valueStatus !== "resolved") {
          unreadableStyleValues++;
        }
        windowRecord(styles, styleCount, record);
        styleCount++;
      }

      if (nodesScanned % 100 === 0) {
        await sendProgressUpdate(
          commandId,
          "get_node_variables",
          "in_progress",
          Math.round((nodesScanned / maxNodes) * 100),
          maxNodes,
          nodesScanned,
          `Scanned ${nodesScanned} nodes; found ${bindingCount} bindings and ${styleCount} style references`
        );
      }

      if ("children" in node && node.children) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push(node.children[i]);
        }
      }
    }
  }

  const traversalHeartbeat = setInterval(() => {
    sendProgressUpdate(
      commandId,
      "get_node_variables",
      "in_progress",
      0,
      maxNodes,
      nodesScanned,
      `Still scanning: ${nodesScanned} nodes, ${bindingCount} bindings and ${styleCount} style references so far`
    ).catch((error) => {
      console.error("Failed to send get_node_variables heartbeat:", error);
    });
  }, 15000);
  try {
    await scan(rootNode);
  } finally {
    clearInterval(traversalHeartbeat);
  }

  const bindingsTruncated = bindings.length < Math.max(0, bindingCount - offset);
  const stylesTruncated = styles.length < Math.max(0, styleCount - offset);

  const limitations = [];
  if (!canResolveVariables) {
    limitations.push(
      "Variables API not available in this Figma version. Raw variable IDs are included, but names and values could not be resolved."
    );
  } else if (unresolvedBindings > 0) {
    limitations.push(
      `${unresolvedBindings} bindings could not be fully resolved; inspect each binding's resolutionStatus and error.`
    );
  }
  if (!canResolveStyles) {
    limitations.push(
      "getStyleByIdAsync not available in this Figma version. Style-backed tokens (fill/stroke/text/effect/grid styles) could not be reported, so an absent style reference here does not mean the node has none."
    );
  } else if (unresolvedStyles > 0) {
    limitations.push(
      `${unresolvedStyles} style references could not be fully resolved; inspect each entry's resolutionStatus ("mixed" means the node carries more than one style on that property).`
    );
  }

  if (canResolveStyles && unreadableStyleValues > 0) {
    limitations.push(
      `${unreadableStyleValues} resolved style references carry no value; inspect each entry's valueStatus ("unsupported_style_type" means this build cannot read that style type, "read_failed" means the style resolved but its value could not be read).`
    );
  }

  // Coverage limitations come last so they read as the headline caveat: the numbers
  // above are a census of the SCANNED window, never of the subtree, once either of
  // these fires.
  if (nodeCapReached) {
    limitations.push(
      `Node cap of ${maxNodes} was reached; the subtree has more nodes that were NOT scanned. Every count below covers only the scanned nodes — they are NOT a subtree total. Raise maxNodes (ceiling ${NODE_VARIABLES_MAX_NODES_CEILING}) or scan smaller roots. A page-wide scan of ~12k nodes has been observed to leave the plugin unresponsive, which is why this cap defaults to ${NODE_VARIABLES_MAX_NODES_DEFAULT}.`
    );
  }
  if (budgetExhausted) {
    limitations.push(
      `Time budget of ${timeBudgetMs}ms was exhausted after ${nodesScanned} node(s). Counts below cover only the scanned nodes — they are NOT a subtree total. Raise timeBudgetMs or scan a smaller root.`
    );
  }
  if (bindingsTruncated || stylesTruncated) {
    limitations.push(
      `Returned records are windowed at offset ${offset}, limit ${limit}: ${bindings.length} of ${bindingCount} bindings and ${styles.length} of ${styleCount} style references. The counts are whole-window totals; page with offset or raise limit (ceiling ${NODE_VARIABLES_LIMIT_CEILING}).`
    );
  }

  await sendProgressUpdate(
    commandId,
    "get_node_variables",
    "completed",
    100,
    nodesScanned,
    nodesScanned,
    `Found ${bindingCount} bindings and ${styleCount} style references across ${nodesScanned} nodes`
  );

  return {
    scope: "node_subtree",
    // `supported` and `complete` now cover BOTH token systems. Reporting
    // complete:true while silently omitting styles made a styled node
    // indistinguishable from an untokenised one.
    supported: canResolveVariables && canResolveStyles,
    variablesSupported: canResolveVariables,
    stylesSupported: canResolveStyles,
    // `complete` means "this reply describes the whole subtree and every record in
    // it". A capped, budget-cut or windowed reply can never read as a full census.
    complete:
      canResolveVariables &&
      canResolveStyles &&
      unresolvedBindings === 0 &&
      unresolvedStyles === 0 &&
      !nodeCapReached &&
      !budgetExhausted &&
      !bindingsTruncated &&
      !stylesTruncated,
    limitations,
    rootNode: {
      id: rootNode.id,
      name: rootNode.name,
      type: rootNode.type,
    },
    nodesScanned,
    coverage: {
      maxNodes,
      nodeCapReached,
      timeBudgetMs,
      budgetExhausted,
      // True when the traversal itself stopped early, for either reason — the one
      // flag a consumer has to branch on before trusting a count.
      traversalTruncated: nodeCapReached || budgetExhausted,
    },
    pagination: {
      offset,
      limit,
      bindings: {
        returned: bindings.length,
        total: bindingCount,
        truncated: bindingsTruncated,
        hasMore: offset + bindings.length < bindingCount,
      },
      styles: {
        returned: styles.length,
        total: styleCount,
        truncated: stylesTruncated,
        hasMore: offset + styles.length < styleCount,
      },
    },
    // Unchanged meaning: totals across everything scanned, not the array lengths.
    bindingCount,
    unresolvedBindings,
    bindings,
    styleCount,
    unresolvedStyles,
    styles,
  };
}

// ---------------------------------------------------------------------------
// R2.5 Phase 2 — the bounded font inventory and the write preflight.
//
// ⛔ Unbounded is not an option. `figma.listAvailableFontsAsync()` answers with every
// face installed on the MACHINE — not with what the file references — which is
// thousands of entries on an ordinary laptop. That is the 3.66 MB -> 518 KB defect R2.0
// paid off for variables, arriving again through a different door.
const FONT_INVENTORY_LIMIT_DEFAULT = 1000;
const FONT_INVENTORY_LIMIT_CEILING = 5000;
// A preflight that can outlast the write it precedes is not a preflight. Deliberately
// small: unlike the machine's inventory, the pair list belongs to the CALLER, so a
// caller with more to check pages rather than being handed a larger budget.
const CHECK_FONTS_MAX_PAIRS = 50;

// Figma does not document the order of `listAvailableFontsAsync()`, so `offset` paging
// would be repeatable only by luck. Compared with plain code-unit `<` rather than
// `localeCompare`, which is locale-dependent and would order one machine's inventory
// differently from another's — a paging defect that only appears abroad.
function compareFontFaces(left, right) {
  if (left.family !== right.family) return left.family < right.family ? -1 : 1;
  if (left.style === right.style) return 0;
  return left.style < right.style ? -1 : 1;
}

// A single space is not a safe separator on its own, so the key keeps the family length
// in front of it: "Foo Bar"/"Baz" and "Foo"/"Bar Baz" are different pairs and must not
// collide into one inventory entry.
function fontFaceKey(family, style) {
  return family.length + ":" + family + style;
}

// One fetch, shared by both tools. Answers `supported: false` rather than throwing when
// the host predates the API, so a consumer gets a typed reply instead of an error
// string — the shape `get_node_variables` already uses for a missing variables API.
//
// ⚠️ `timeBudgetMs` bounds THIS REPLY, not the underlying call: Figma's
// `listAvailableFontsAsync()` takes no cancellation signal, so an exhausted budget
// abandons the promise rather than stopping the work. Said out loud here and in
// `limitations` because a budget that quietly does neither is exactly the class of
// half-true field this fork keeps finding.
async function readFontInventory(timeBudgetMs) {
  if (typeof figma.listAvailableFontsAsync !== "function") {
    return { supported: false, fetched: false, faces: [], fetchMs: 0 };
  }
  const startedAt = Date.now();
  const pending = figma.listAvailableFontsAsync();
  let raw;
  if (timeBudgetMs > 0) {
    const abandoned = {};
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve(abandoned), timeBudgetMs);
    });
    // An abandoned fetch must not surface later as an unhandled rejection.
    pending.catch(() => undefined);
    raw = await Promise.race([pending, deadline]);
    if (timer !== null) clearTimeout(timer);
    if (raw === abandoned) {
      return {
        supported: true,
        fetched: false,
        faces: [],
        fetchMs: Date.now() - startedAt,
      };
    }
  } else {
    raw = await pending;
  }
  const fetchMs = Date.now() - startedAt;
  const faces = [];
  for (const entry of raw || []) {
    const fontName = entry && entry.fontName;
    if (
      !fontName ||
      typeof fontName.family !== "string" ||
      typeof fontName.style !== "string"
    ) {
      continue;
    }
    faces.push({ family: fontName.family, style: fontName.style });
  }
  faces.sort(compareFontFaces);
  return { supported: true, fetched: true, faces, fetchMs };
}

async function getAvailableFonts(params) {
  const requestedFamily =
    params && typeof params.family === "string" && params.family.length > 0
      ? params.family
      : null;
  if (params && params.family !== undefined && requestedFamily === null) {
    throw new Error("family must be a non-empty string when provided");
  }
  const limit = Math.min(
    FONT_INVENTORY_LIMIT_CEILING,
    Math.max(1, Number((params && params.limit) || FONT_INVENTORY_LIMIT_DEFAULT)),
  );
  const offset = Math.max(0, Number((params && params.offset) || 0));
  const timeBudgetMs = Math.max(0, Number((params && params.timeBudgetMs) || 0));

  const inventory = await readFontInventory(timeBudgetMs);
  const limitations = [];

  if (!inventory.supported) {
    limitations.push(
      "This Figma host does not expose listAvailableFontsAsync, so no inventory could be read. check_fonts still reports loadability, which is observed directly rather than looked up.",
    );
  } else if (!inventory.fetched) {
    limitations.push(
      `The inventory fetch did not finish within timeBudgetMs (${timeBudgetMs}ms). Figma's listAvailableFontsAsync takes no cancellation signal, so the call was abandoned rather than stopped and is still running. Raise timeBudgetMs or omit it.`,
    );
  }

  // Whole-inventory totals. They describe the MACHINE, never the returned window — the
  // count-vs-window separation get_node_variables and get_plugin_data both use. `null`
  // rather than 0 when nothing was read: a 0 here would read as "this machine has no
  // fonts", which is a real finding rather than the absence of one.
  const known = inventory.supported && inventory.fetched;
  const fontCount = known ? inventory.faces.length : null;
  let familyCount = null;
  const matches = [];
  if (known) {
    familyCount = 0;
    let lastFamily = null;
    for (const face of inventory.faces) {
      if (face.family !== lastFamily) {
        familyCount += 1;
        lastFamily = face.family;
      }
      if (requestedFamily === null || face.family === requestedFamily) {
        matches.push(face);
      }
    }
  }

  const matchCount = known ? matches.length : null;
  const fonts = matches.slice(offset, offset + limit);
  const returned = fonts.length;
  const hasMore = known ? offset + returned < matches.length : false;

  if (hasMore) {
    limitations.push(
      `Returned ${returned} of ${matches.length} matching faces; raise limit (ceiling ${FONT_INVENTORY_LIMIT_CEILING}) or page with offset.`,
    );
  }
  if (requestedFamily !== null && known && matches.length === 0) {
    limitations.push(
      `No face on this machine belongs to family "${requestedFamily}". The filter is an exact, case-sensitive family match, so a near miss reads identically to an absent family — page the unfiltered inventory to confirm the spelling.`,
    );
  }

  return {
    scope: "font_inventory",
    supported: inventory.supported,
    fonts,
    // Whole-machine totals, independent of both the window and the filter.
    fontCount,
    familyCount,
    // Faces matching `family`; equal to fontCount when no filter was supplied.
    matchCount,
    filter: { family: requestedFamily },
    pagination: { limit, offset, returned, hasMore },
    coverage: {
      timeBudgetMs,
      fetchMs: inventory.fetchMs,
      inventoryFetched: inventory.fetched,
      budgetExhausted: inventory.supported && !inventory.fetched,
      // ⛔ A permanent declaration, not a state: this budget bounds the reply, never the
      // underlying Figma call. Reading `budgetExhausted` without it would suggest work
      // was skipped, when in fact the fetch was merely abandoned mid-flight.
      budgetCancelsFetch: false,
    },
    complete: known && !hasMore,
    limitations,
  };
}

async function checkFonts(params) {
  const commandId = (params && params.commandId) || generateCommandId();
  const requested = params && params.fonts;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error("fonts must be a non-empty array of {family, style} pairs");
  }
  if (requested.length > CHECK_FONTS_MAX_PAIRS) {
    throw new Error(
      `fonts contains ${requested.length} pairs, above the ${CHECK_FONTS_MAX_PAIRS}-pair cap. A preflight that outlasts the write it precedes is not a preflight; split the list across calls.`,
    );
  }
  // Validate every pair before probing any of them. This tool writes nothing, so there
  // is no partial document state to leave behind — but a list that fails on its ninth
  // entry after loading eight fonts still charges the caller for work it then refuses
  // to report, which is the same shape as the atomicity debt F4 names.
  const pairs = [];
  for (let index = 0; index < requested.length; index++) {
    const entry = requested[index];
    if (
      !entry ||
      typeof entry.family !== "string" ||
      entry.family.length === 0 ||
      typeof entry.style !== "string" ||
      entry.style.length === 0
    ) {
      throw new Error(
        `fonts[${index}] must be {family, style}, both non-empty strings`,
      );
    }
    pairs.push({ family: entry.family, style: entry.style });
  }
  const timeBudgetMs = Math.max(0, Number((params && params.timeBudgetMs) || 0));

  await sendProgressUpdate(
    commandId,
    "check_fonts",
    "started",
    0,
    pairs.length,
    0,
    `Checking ${pairs.length} font${pairs.length === 1 ? "" : "s"}`,
  );

  const startedAt = Date.now();
  // The inventory is deliberately NOT budgeted here: a truncated inventory would turn
  // every `available` into a false negative, which is a far worse answer than a slow
  // one. The budget below governs the load probes instead.
  const inventory = await readFontInventory(0);
  const installed = new Set();
  const families = new Set();
  for (const face of inventory.faces) {
    installed.add(fontFaceKey(face.family, face.style));
    families.add(face.family);
  }

  const results = [];
  const missing = [];
  const limitations = [];
  let availableCount = 0;
  let loadableCount = 0;
  let budgetExhausted = false;

  for (const pair of pairs) {
    // Checked BETWEEN probes: an individual loadFontAsync takes no cancellation signal
    // either, so the budget bounds how many probes start, not how long one runs.
    if (timeBudgetMs > 0 && Date.now() - startedAt > timeBudgetMs) {
      budgetExhausted = true;
      break;
    }
    // ⭐ `available` and `loadable` are separate facts, and the gap between them is the
    // whole reason this tool exists: a face can be listed and still refuse to load, and
    // `setCharacters` answers that refusal by silently substituting Inter.
    const available = inventory.supported
      ? installed.has(fontFaceKey(pair.family, pair.style))
      : null;
    const familyAvailable = inventory.supported
      ? families.has(pair.family)
      : null;
    const probeStartedAt = Date.now();
    let loadable = false;
    let error = null;
    try {
      await figma.loadFontAsync({ family: pair.family, style: pair.style });
      loadable = true;
    } catch (probeError) {
      error =
        probeError instanceof Error ? probeError.message : String(probeError);
    }
    if (available === true) availableCount += 1;
    if (loadable) loadableCount += 1;
    else missing.push({ family: pair.family, style: pair.style });
    results.push({
      requested: { family: pair.family, style: pair.style },
      available,
      // True when the family exists under some OTHER style — the difference between
      // "this machine has no Ghost" and "Inter is here but has no Blond".
      familyAvailable,
      loadable,
      error,
      loadMs: Date.now() - probeStartedAt,
    });
    await sendProgressUpdate(
      commandId,
      "check_fonts",
      "in_progress",
      Math.round((results.length / pairs.length) * 100),
      pairs.length,
      results.length,
      `Checked ${results.length} of ${pairs.length} fonts`,
    );
  }

  if (!inventory.supported) {
    limitations.push(
      "This Figma host does not expose listAvailableFontsAsync, so `available` and `familyAvailable` are null rather than false — the inventory could not be consulted. `loadable` is unaffected: it is observed by attempting the load.",
    );
  }
  if (budgetExhausted) {
    limitations.push(
      `timeBudgetMs (${timeBudgetMs}ms) was exhausted after ${results.length} of ${pairs.length} pairs; the rest were never probed and are absent from results rather than reported as unavailable.`,
    );
  }

  await sendProgressUpdate(
    commandId,
    "check_fonts",
    "completed",
    100,
    pairs.length,
    results.length,
    `${loadableCount} of ${results.length} checked fonts are loadable`,
  );

  return {
    scope: "font_inventory",
    inventorySupported: inventory.supported,
    results,
    requestedCount: pairs.length,
    checkedCount: results.length,
    skippedCount: pairs.length - results.length,
    availableCount,
    loadableCount,
    // Every checked pair that would NOT survive a write, so a caller can branch on one
    // array instead of filtering `results` itself.
    missing,
    fontCount: inventory.supported ? inventory.faces.length : null,
    coverage: {
      timeBudgetMs,
      budgetExhausted,
      fetchMs: inventory.fetchMs,
    },
    complete: inventory.supported && results.length === pairs.length,
    limitations,
  };
}

// async function getTeamComponents() {
//   try {
//     const teamComponents =
//       await figma.teamLibrary.getAvailableComponentsAsync();

//     return {
//       count: teamComponents.length,
//       components: teamComponents.map((component) => ({
//         key: component.key,
//         name: component.name,
//         description: component.description,
//         libraryName: component.libraryName,
//       })),
//     };
//   } catch (error) {
//     throw new Error(`Error getting team components: ${error.message}`);
//   }
// }

async function createComponentInstance(params) {
  const { componentKey, componentId, x = 0, y = 0, parentId } = params || {};

  if (!componentKey && !componentId) {
    throw new Error("Missing componentKey or componentId parameter. Use componentId for local components (from get_local_components), or componentKey for published library components.");
  }

  try {
    let component;

    if (componentId) {
      // Local component: get node directly by ID
      const node = await figma.getNodeByIdAsync(componentId);
      if (!node) {
        throw new Error(`Component node not found with id: ${componentId}`);
      }
      if (node.type !== "COMPONENT") {
        throw new Error(`Node ${componentId} is not a COMPONENT (got type: ${node.type}). Use get_local_components to find valid component IDs.`);
      }
      component = node;
    } else {
      // Published library component: import by key
      component = await figma.importComponentByKeyAsync(componentKey);
    }

    const instance = component.createInstance();
    instance.x = x;
    instance.y = y;

    if (parentId) {
      const parent = await figma.getNodeByIdAsync(parentId);
      if (parent && "appendChild" in parent) {
        parent.appendChild(instance);
      } else {
        figma.currentPage.appendChild(instance);
      }
    } else {
      figma.currentPage.appendChild(instance);
    }

    const mainComponent = await instance.getMainComponentAsync();

    return {
      id: instance.id,
      name: instance.name,
      x: instance.x,
      y: instance.y,
      width: instance.width,
      height: instance.height,
      mainComponentId: mainComponent ? mainComponent.id : undefined,
    };
  } catch (error) {
    throw new Error(`Error creating component instance: ${error.message}`);
  }
}

async function exportNodeAsImage(params) {
  const {
    nodeId,
    scale = 1,
    allowLargeExport = false,
    commandId = generateCommandId(),
  } = params || {};

  const format = (params && params.format || "PNG").toUpperCase();

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("exportAsync" in node)) {
    throw new Error(`Node does not support exporting: ${nodeId}`);
  }

  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Export scale must be a finite positive number; received ${scale}`);
  }

  const rasterFormat = format === "PNG" || format === "JPG";
  const nodeWidth = Number.isFinite(node.width) && node.width >= 0
    ? node.width
    : null;
  const nodeHeight = Number.isFinite(node.height) && node.height >= 0
    ? node.height
    : null;
  const renderBounds = node.absoluteRenderBounds;
  const hasRenderBounds = Boolean(
    renderBounds &&
    Number.isFinite(renderBounds.width) &&
    renderBounds.width >= 0 &&
    Number.isFinite(renderBounds.height) &&
    renderBounds.height >= 0
  );
  const boundsWidth = hasRenderBounds ? renderBounds.width : nodeWidth;
  const boundsHeight = hasRenderBounds ? renderBounds.height : nodeHeight;
  const scaledWidth = boundsWidth === null ? null : boundsWidth * scale;
  const scaledHeight = boundsHeight === null ? null : boundsHeight * scale;
  const costKnown = Boolean(
    Number.isFinite(scaledWidth) &&
    scaledWidth >= 0 &&
    Number.isFinite(scaledHeight) &&
    scaledHeight >= 0
  );
  const projectedWidth = costKnown ? Math.ceil(scaledWidth) : null;
  const projectedHeight = costKnown ? Math.ceil(scaledHeight) : null;
  const projectedPixels = costKnown ? projectedWidth * projectedHeight : null;
  const projectedMegapixels = Number.isFinite(projectedPixels)
    ? Number((projectedPixels / 1000000).toFixed(6))
    : null;
  const overLimit = Boolean(
    rasterFormat &&
    projectedPixels !== null &&
    projectedPixels > RASTER_EXPORT_MEGAPIXEL_LIMIT * 1000000
  );
  const preflight = {
    nodeWidth,
    nodeHeight,
    boundsWidth,
    boundsHeight,
    boundsSource: hasRenderBounds ? "absoluteRenderBounds" : "node-width-height",
    projectedWidth,
    projectedHeight,
    projectedMegapixels,
    megapixelLimit: RASTER_EXPORT_MEGAPIXEL_LIMIT,
    limitApplied: rasterFormat,
    costKnown,
    overLimit,
    overrideUsed: Boolean(allowLargeExport && rasterFormat && (!costKnown || overLimit)),
  };

  if (rasterFormat && !costKnown && !allowLargeExport) {
    throw new Error(
      `Export preflight refused ${format} for node ${nodeId}: finite export bounds could not be determined at scale ${scale}. Export a bounded child node or retry with allowLargeExport: true to accept the unbounded cost.`
    );
  }

  if (overLimit && !allowLargeExport) {
    throw new Error(
      `Export preflight refused ${format} for node ${nodeId}: ${boundsWidth}x${boundsHeight} at scale ${scale} projects to ${projectedWidth}x${projectedHeight} (${projectedMegapixels} MP), above the ${RASTER_EXPORT_MEGAPIXEL_LIMIT} MP safety ceiling. Reduce the scale or node area, or retry with allowLargeExport: true to accept the session-saturation risk.`
    );
  }

  try {
    const settings = {
      format: format,
      constraint: { type: "SCALE", value: scale },
    };

    await sendProgressUpdate(
      commandId,
      "export_node_as_image",
      "started",
      0,
      1,
      0,
      `Encoding ${format} export for ${nodeId} (${projectedMegapixels === null ? "unknown cost" : `${projectedMegapixels} MP projected`})`,
      { preflight }
    );

    const bytes = await node.exportAsync(settings);

    await sendProgressUpdate(
      commandId,
      "export_node_as_image",
      "in_progress",
      90,
      1,
      1,
      `Figma encoded ${format}; preparing ${bytes.byteLength} bytes for delivery`,
      { preflight, encodedBytes: bytes.byteLength }
    );

    let mimeType;
    switch (format) {
      case "PNG":
        mimeType = "image/png";
        break;
      case "JPG":
        mimeType = "image/jpeg";
        break;
      case "SVG":
        mimeType = "image/svg+xml";
        break;
      case "PDF":
        mimeType = "application/pdf";
        break;
      default:
        mimeType = "application/octet-stream";
    }

    // Proper way to convert Uint8Array to base64
    const base64 = customBase64Encode(bytes);
    // const imageData = `data:${mimeType};base64,${base64}`;

    await sendProgressUpdate(
      commandId,
      "export_node_as_image",
      "completed",
      100,
      1,
      1,
      `Prepared ${format} export for delivery`,
      { preflight, encodedBytes: bytes.byteLength }
    );

    return {
      nodeId,
      format,
      scale,
      mimeType,
      imageData: base64,
      preflight,
    };
  } catch (error) {
    await sendProgressUpdate(
      commandId,
      "export_node_as_image",
      "error",
      0,
      1,
      0,
      `Export failed: ${error.message || String(error)}`,
      { preflight }
    );
    throw new Error(`Error exporting node as image: ${error.message}`);
  }
}
function customBase64Encode(bytes) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";

  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  // Main loop deals with bytes in chunks of 3
  for (let i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048 = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032 = (2^6 - 1) << 6
    d = chunk & 63; // 63 = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += chars[a] + chars[b] + chars[c] + chars[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder === 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3 = 2^2 - 1

    base64 += chars[a] + chars[b] + "==";
  } else if (byteRemainder === 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008 = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15 = 2^4 - 1

    base64 += chars[a] + chars[b] + chars[c] + "=";
  }

  return base64;
}

async function setCornerRadius(params) {
  const { nodeId, radius, corners } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (radius === undefined) {
    throw new Error("Missing radius parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if node supports corner radius
  if (!("cornerRadius" in node)) {
    throw new Error(`Node does not support corner radius: ${nodeId}`);
  }

  // If corners array is provided, set individual corner radii
  if (corners && Array.isArray(corners) && corners.length === 4) {
    if ("topLeftRadius" in node) {
      // Node supports individual corner radii
      if (corners[0]) node.topLeftRadius = radius;
      if (corners[1]) node.topRightRadius = radius;
      if (corners[2]) node.bottomRightRadius = radius;
      if (corners[3]) node.bottomLeftRadius = radius;
    } else {
      // Node only supports uniform corner radius
      node.cornerRadius = radius;
    }
  } else {
    // Set uniform corner radius
    node.cornerRadius = radius;
  }

  return {
    id: node.id,
    name: node.name,
    cornerRadius: "cornerRadius" in node ? node.cornerRadius : undefined,
    topLeftRadius: "topLeftRadius" in node ? node.topLeftRadius : undefined,
    topRightRadius: "topRightRadius" in node ? node.topRightRadius : undefined,
    bottomRightRadius:
      "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
    bottomLeftRadius:
      "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined,
  };
}

async function setTextContent(params) {
  const { nodeId, text } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (text === undefined) {
    throw new Error("Missing text parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    // ⛔ Do NOT pre-load `node.fontName` here. On a node carrying more than one font it
    // is `figma.mixed` — a symbol — and `loadFontAsync` cannot unwrap it, which is the
    // whole of the long-standing mixed-font defect. The load is also redundant:
    // `setCharacters` below branches on `figma.mixed` and loads a concrete font in
    // every branch, including the single-font one.
    // ⛔ `setCharacters` returns false when Figma refuses the assignment — it logs
    // "Failed to set characters. Skipped." and returns. Discarding that return made this
    // function answer success over a document it had not changed, and the batch tool
    // above counts its per-entry `success` flags into R2.4's unified totals — so the
    // aggregate that was fixed to stop lying would have been fed a lie from below.
    const fontReport = {};
    const applied = await setCharacters(node, text, { report: fontReport });
    if (!applied) {
      throw new Error(
        `Figma refused the character write for ${nodeId}; the node was not modified`,
      );
    }

    return {
      id: node.id,
      name: node.name,
      characters: node.characters,
      fontName: node.fontName,
      // ⭐ Additive, and load-bearing: a substitution means this call CHANGED THE FONT of
      // the node as a side effect of setting its text. Silence is what made that
      // invisible; `false` is now an answer, not an absence.
      fontSubstituted: fontReport.fontSubstituted === true,
      requestedFont: fontReport.requestedFont,
      appliedFont: fontReport.appliedFont,
    };
  } catch (error) {
    throw new Error(`Error setting text content: ${error.message}`);
  }
}
// ── R2.5 Phase 3 — the typography write surface ────────────────────────────────────
//
// ⛔ VALIDATE-ALL-THEN-WRITE, FROM BIRTH (plan 3.2, non-negotiable). This is a
// twelve-field write, which is exactly the shape F4 proves broken in three ops that
// ship today: `setAxisAlign`, `setLayoutSizing` and `setItemSpacing` each validate
// their first field, WRITE it, then validate the second and throw — leaving a failed
// result sitting on top of a changed document. Building this tool the same way would
// mint a fourth instance in the release that pays the first three off.
//
// ⛔ It REFUSES an unloadable font; it never substitutes. `setCharacters` answers a
// refused load by silently retyping the node to Inter — F2, the defect Phase 2's
// `check_fonts` exists to let a caller avoid. A style write that repeated it would
// change the document's font as a side effect of a call that asked for something else.
const TEXT_STYLE_ENUMS = {
  textCase: [
    "ORIGINAL",
    "UPPER",
    "LOWER",
    "TITLE",
    "SMALL_CAPS",
    "SMALL_CAPS_FORCED",
  ],
  textDecoration: ["NONE", "UNDERLINE", "STRIKETHROUGH"],
  textAlignHorizontal: ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"],
  textAlignVertical: ["TOP", "CENTER", "BOTTOM"],
  textAutoResize: ["NONE", "HEIGHT", "WIDTH_AND_HEIGHT", "TRUNCATE"],
};

// Bounds Figma enforces itself. Checking them here is not duplication: Figma enforces
// them at ASSIGNMENT time, which on field seven means six fields are already written.
const TEXT_STYLE_NUMERIC = {
  fontSize: { min: 1, max: 65535 },
  paragraphSpacing: { min: 0 },
  paragraphIndent: { min: 0 },
};

// The node properties this tool can write, in write order. `fontName` leads so the
// per-range properties that follow land on whatever font the node ends up carrying,
// which makes the result independent of the order the caller happened to supply.
const TEXT_STYLE_PROPERTIES = [
  "fontName",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "textCase",
  "textDecoration",
  "textAlignHorizontal",
  "textAlignVertical",
  "paragraphSpacing",
  "paragraphIndent",
  "textAutoResize",
];

// The twelve caller-facing parameters, for the "supply at least one" refusal.
const TEXT_STYLE_PARAMETERS = [
  "fontFamily",
  "fontStyle",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "textCase",
  "textDecoration",
  "textAlignHorizontal",
  "textAlignVertical",
  "paragraphSpacing",
  "paragraphIndent",
  "textAutoResize",
];

// ⛔ `figma.mixed` is a unique symbol and `JSON.stringify` renders a symbol as
// `undefined` — which DROPS THE KEY. A mixed field would therefore vanish from the
// reply entirely and read as "not reported" rather than "this node holds more than one
// value". Every read-back goes through here so an absence is never mistaken for a fact.
function textStyleReadable(value) {
  return typeof value === "symbol" ? "MIXED" : value;
}

function textStyleSnapshot(node) {
  const snapshot = {};
  for (const property of TEXT_STYLE_PROPERTIES) {
    snapshot[property] = textStyleReadable(node[property]);
  }
  return snapshot;
}

// ⭐ `getRangeAllFontNames`, not `fontName`: on a mixed node `fontName` is `figma.mixed`
// and names no face at all, so "load the node's font" would load nothing and Figma
// would then refuse the write for a font we never saw.
function textStyleExistingFonts(node) {
  const fonts = [];
  const seen = new Set();
  const push = (font) => {
    if (!font || typeof font === "symbol") return;
    if (typeof font.family !== "string" || typeof font.style !== "string") return;
    const key = `${font.family}::${font.style}`;
    if (seen.has(key)) return;
    seen.add(key);
    fonts.push({ family: font.family, style: font.style });
  };
  const length = typeof node.characters === "string" ? node.characters.length : 0;
  if (length > 0 && typeof node.getRangeAllFontNames === "function") {
    try {
      for (const font of node.getRangeAllFontNames(0, length)) push(font);
    } catch (rangeError) {
      // Fall through to fontName below rather than failing the call: an older host
      // that lacks the range API can still write a single-font node.
    }
  }
  if (fonts.length === 0) push(node.fontName);
  return fonts;
}

// `{value, unit}` per plan 3.4 — never a bare number, because a number-typed schema
// here would be a breaking correction later.
function textStyleUnitValue(field, raw, allowedUnits, errors, options) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(
      `${field} must be an object {value, unit}, not ${Array.isArray(raw) ? "an array" : typeof raw}. A bare number cannot say whether it means pixels or percent.`,
    );
    return undefined;
  }
  if (!allowedUnits.includes(raw.unit)) {
    errors.push(
      `${field}.unit must be one of ${allowedUnits.join(", ")}; received ${JSON.stringify(raw.unit)}`,
    );
    return undefined;
  }
  if (raw.unit === "AUTO") {
    // ⛔ Refuse rather than ignore. Accepting a value here and dropping it would let a
    // caller believe a number took effect that never did.
    if (raw.value !== undefined) {
      errors.push(
        `${field}.value must be omitted when unit is AUTO; it would be silently discarded, and a discarded value reads as an applied one.`,
      );
      return undefined;
    }
    return { unit: "AUTO" };
  }
  if (typeof raw.value !== "number" || !isFinite(raw.value)) {
    errors.push(
      `${field}.value must be a finite number when unit is ${raw.unit}; received ${JSON.stringify(raw.value)}`,
    );
    return undefined;
  }
  if (options && options.nonNegative && raw.value < 0) {
    errors.push(`${field}.value must not be negative; received ${raw.value}`);
    return undefined;
  }
  return { value: raw.value, unit: raw.unit };
}

/**
 * The `fontFamily` / `fontStyle` pair rule, shared by `set_text_style` and `create_text`.
 *
 * ⛔ Half a pair is refused on both surfaces. Supplying a family without a style has no
 * single answer on a mixed-font node and is a guess everywhere else, and inventing the
 * missing half is the silent substitution these tools exist to refuse.
 *
 * Returns the requested face, or `null` when none was supplied AND when one was supplied
 * invalidly — the caller distinguishes those two by asking whether the field was present,
 * which is why this never throws on its own.
 */
function textStyleRequestedFont(input, errors) {
  const supplied = (name) => input[name] !== undefined && input[name] !== null;
  const hasFamily = supplied("fontFamily");
  const hasStyle = supplied("fontStyle");
  if (hasFamily !== hasStyle) {
    errors.push(
      `fontFamily and fontStyle must be supplied together or not at all; received only ${hasFamily ? "fontFamily" : "fontStyle"}. Deriving the missing half from the node is impossible when the node is mixed and a guess elsewhere.`,
    );
    return null;
  }
  if (!hasFamily) return null;
  const familyOk = typeof input.fontFamily === "string" && input.fontFamily.length > 0;
  const styleOk = typeof input.fontStyle === "string" && input.fontStyle.length > 0;
  if (!familyOk) errors.push("fontFamily must be a non-empty string");
  if (!styleOk) errors.push("fontStyle must be a non-empty string");
  if (!familyOk || !styleOk) return null;
  return { family: input.fontFamily, style: input.fontStyle };
}

/**
 * The ten non-font typography parameters, validated once for both write surfaces.
 *
 * ⭐ `set_text_style` and `create_text` take the SAME twelve parameters, and a second
 * copy of a ten-field validator is how two surfaces start disagreeing about what is
 * valid — the divergence R2.4's live gate caught between `set_fill_color`'s batch shape
 * and its standalone shape. One implementation, two callers, one answer.
 *
 * ⛔ Appends to `errors` rather than throwing: EVERY invalid parameter is reported, not
 * the first. A caller fixing a twelve-field payload one refusal per round trip is being
 * charged for the tool's convenience.
 */
function textStyleCollectWrites(input, errors, writes, appliedFields) {
  const supplied = (name) => input[name] !== undefined && input[name] !== null;

  for (const field of ["fontSize", "paragraphSpacing", "paragraphIndent"]) {
    if (!supplied(field)) continue;
    const value = input[field];
    const bounds = TEXT_STYLE_NUMERIC[field];
    if (typeof value !== "number" || !isFinite(value)) {
      errors.push(
        `${field} must be a finite number; received ${JSON.stringify(value)}`,
      );
      continue;
    }
    if (bounds.min !== undefined && value < bounds.min) {
      errors.push(`${field} must be at least ${bounds.min}; received ${value}`);
      continue;
    }
    if (bounds.max !== undefined && value > bounds.max) {
      errors.push(`${field} must be at most ${bounds.max}; received ${value}`);
      continue;
    }
    writes.push([field, value]);
    appliedFields.push(field);
  }

  if (supplied("lineHeight")) {
    const value = textStyleUnitValue(
      "lineHeight",
      input.lineHeight,
      ["PIXELS", "PERCENT", "AUTO"],
      errors,
      { nonNegative: true },
    );
    if (value !== undefined) {
      writes.push(["lineHeight", value]);
      appliedFields.push("lineHeight");
    }
  }

  if (supplied("letterSpacing")) {
    // Negative letter spacing is legitimate tracking, so no non-negative bound here.
    const value = textStyleUnitValue(
      "letterSpacing",
      input.letterSpacing,
      ["PIXELS", "PERCENT"],
      errors,
    );
    if (value !== undefined) {
      writes.push(["letterSpacing", value]);
      appliedFields.push("letterSpacing");
    }
  }

  for (const field of Object.keys(TEXT_STYLE_ENUMS)) {
    if (!supplied(field)) continue;
    const allowed = TEXT_STYLE_ENUMS[field];
    if (!allowed.includes(input[field])) {
      errors.push(
        `${field} must be one of ${allowed.join(", ")}; received ${JSON.stringify(input[field])}`,
      );
      continue;
    }
    writes.push([field, input[field]]);
    appliedFields.push(field);
  }
}

async function setTextStyle(params) {
  const input = params || {};
  const { nodeId } = input;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }
  if (node.type !== "TEXT") {
    throw new Error(
      `Node is not a text node: ${nodeId} (type ${node.type}); set_text_style writes TEXT properties only`,
    );
  }

  // ══ VALIDATION PHASE ══════════════════════════════════════════════════════════════
  // ⛔ Nothing below this line assigns to the node until the write phase is reached.
  const errors = [];
  const writes = [];
  const appliedFields = [];
  const supplied = (name) => input[name] !== undefined && input[name] !== null;

  // fontFamily and fontStyle are one decision, not two — the pair rule is shared with
  // `create_text` so the two write surfaces cannot drift apart on what is valid.
  const requestedFont = textStyleRequestedFont(input, errors);
  if (requestedFont) {
    writes.push(["fontName", requestedFont]);
    appliedFields.push("fontFamily", "fontStyle");
  }

  textStyleCollectWrites(input, errors, writes, appliedFields);

  if (appliedFields.length === 0 && errors.length === 0) {
    throw new Error(
      `set_text_style needs at least one property to write; supply one or more of ${TEXT_STYLE_PARAMETERS.join(", ")}. A call that changes nothing and reports success is the aggregate lying.`,
    );
  }

  if (errors.length > 0) {
    // ⛔ EVERY error, not the first. A caller fixing a twelve-field payload one refusal
    // per round trip is being charged for the tool's convenience.
    throw new Error(
      `set_text_style refused ${errors.length} invalid ${errors.length === 1 ? "parameter" : "parameters"} and wrote nothing: ${errors.join("; ")}`,
    );
  }

  // Figma refuses to modify ANY property of a text node whose current fonts are not
  // loaded — not only the font itself — so the node's existing faces are loaded here,
  // in the validation phase, even for a call that only moves textAlignHorizontal.
  // ⭐ Loading a font mutates the plugin session's font cache and nothing in the
  // document, which is why `check_fonts` is classified a read; this is still not a write.
  const existingFonts = textStyleExistingFonts(node);
  const pending = requestedFont ? existingFonts.concat([requestedFont]) : existingFonts;
  const loadFailures = [];
  for (const font of pending) {
    try {
      await figma.loadFontAsync(font);
    } catch (loadError) {
      loadFailures.push({
        font,
        error: loadError instanceof Error ? loadError.message : String(loadError),
      });
    }
  }
  if (loadFailures.length > 0) {
    // ⛔ REFUSE, never substitute. This is the last gate before the write phase and it
    // is why `fontSubstituted` can be a permanent `false` in the reply below.
    const detail = loadFailures
      .map((failure) => `${failure.font.family} ${failure.font.style} (${failure.error})`)
      .join("; ");
    throw new Error(
      `set_text_style could not load ${loadFailures.length} font${loadFailures.length === 1 ? "" : "s"} and wrote nothing: ${detail}. This tool refuses rather than substituting Inter, because a substitution would change the document's font as a side effect. Preflight with check_fonts.`,
    );
  }

  // ══ WRITE PHASE ═══════════════════════════════════════════════════════════════════
  // ⛔ Every value here is validated and every font is loaded, so this loop cannot
  // reject. Do NOT add a check to it: the guarantee is that the document is never left
  // half-written, and that guarantee lives in this loop being unable to fail — not in
  // this comment. Moving a validation down here is the F4 defect, exactly.
  const wasMixed = typeof node.fontName === "symbol";
  const before = textStyleSnapshot(node);
  for (const [property, value] of writes) {
    node[property] = value;
  }
  const after = textStyleSnapshot(node);

  const limitations = [];
  if (wasMixed && requestedFont) {
    limitations.push(
      "The node carried more than one font before this call, and supplying fontFamily/fontStyle unified it — the per-character font runs are gone. That is a document change wider than the property named, so it is reported rather than left to be discovered.",
    );
  }
  if (wasMixed && !requestedFont) {
    limitations.push(
      'The node carries more than one font and no fontFamily/fontStyle was supplied, so its font was left mixed; after.fontName is the string "MIXED" rather than a face.',
    );
  }
  if (existingFonts.length === 0) {
    limitations.push(
      "The node's existing faces could not be enumerated (no getRangeAllFontNames and a mixed fontName), so only the requested font was loaded before writing.",
    );
  }

  return {
    scope: "node",
    id: node.id,
    name: node.name,
    // ⭐ Reported whether or not the font was unified: when it was not, this is what
    // explains an after.fontName of "MIXED".
    wasMixed,
    fontUnified: requestedFont !== null,
    requestedFont,
    appliedFont: requestedFont ? textStyleReadable(node.fontName) : null,
    // ⭐ A PERMANENT declaration, never a state — the same shape as
    // coverage.budgetCancelsFetch. This tool refuses an unloadable font in its
    // validation phase, so a substitution cannot occur; `false` says the question was
    // considered and answered, where an absent field would leave a reader unable to
    // tell "no" from "not reported".
    fontSubstituted: false,
    appliedFields,
    appliedFieldCount: appliedFields.length,
    fontsLoaded: pending,
    before,
    after,
    limitations,
  };
}

// Initialize settings on load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync("settings");
    if (savedSettings) {
      if (savedSettings.serverPort) {
        state.serverPort = savedSettings.serverPort;
      }
    }

    // Send initial settings to UI
    figma.ui.postMessage({
      type: "init-settings",
      settings: {
        serverPort: state.serverPort,
      },
    });
  } catch (error) {
    console.error("Error loading settings:", error);
  }
})();

function uniqBy(arr, predicate) {
  const cb = typeof predicate === "function" ? predicate : (o) => o[predicate];
  return [
    ...arr
      .reduce((map, item) => {
        const key = item === null || item === undefined ? item : cb(item);

        map.has(key) || map.set(key, item);

        return map;
      }, new Map())
      .values(),
  ];
}
const setCharacters = async (node, characters, options) => {
  const fallbackFont = (options && options.fallbackFont) || {
    family: "Inter",
    style: "Regular",
  };
  // An optional out-parameter. This function silently retypes a node to the fallback
  // font whenever the real font will not load — a document mutation the caller never
  // learned about, because the only record was a console.warn. The boolean return is
  // deliberately unchanged so the other call site keeps working.
  const report = (options && options.report) || null;
  if (report) {
    report.fontSubstituted = false;
    report.requestedFont =
      node.fontName === figma.mixed
        ? "mixed"
        : node.fontName && `${node.fontName.family} ${node.fontName.style}`;
  }
  try {
    if (node.fontName === figma.mixed) {
      if (options && options.smartStrategy === "prevail") {
        const fontHashTree = {};
        for (let i = 1; i < node.characters.length; i++) {
          const charFont = node.getRangeFontName(i - 1, i);
          const key = `${charFont.family}::${charFont.style}`;
          fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
        }
        const prevailedTreeItem = Object.entries(fontHashTree).sort(
          (a, b) => b[1] - a[1]
        )[0];
        const [family, style] = prevailedTreeItem[0].split("::");
        const prevailedFont = {
          family,
          style,
        };
        await figma.loadFontAsync(prevailedFont);
        node.fontName = prevailedFont;
      } else if (options && options.smartStrategy === "strict") {
        return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
      } else if (options && options.smartStrategy === "experimental") {
        return setCharactersWithSmartMatchFont(node, characters, fallbackFont);
      } else {
        const firstCharFont = node.getRangeFontName(0, 1);
        await figma.loadFontAsync(firstCharFont);
        node.fontName = firstCharFont;
      }
    } else {
      await figma.loadFontAsync({
        family: node.fontName.family,
        style: node.fontName.style,
      });
    }
  } catch (err) {
    console.warn(
      `Failed to load "${node.fontName["family"]} ${node.fontName["style"]}" font and replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
      err
    );
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
    if (report) report.fontSubstituted = true;
  }
  if (report) {
    report.appliedFont =
      node.fontName === figma.mixed
        ? "mixed"
        : node.fontName && `${node.fontName.family} ${node.fontName.style}`;
  }
  try {
    node.characters = characters;
    return true;
  } catch (err) {
    console.warn(`Failed to set characters. Skipped.`, err);
    return false;
  }
};

const setCharactersWithStrictMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const fontHashTree = {};
  for (let i = 1; i < node.characters.length; i++) {
    const startIdx = i - 1;
    const startCharFont = node.getRangeFontName(startIdx, i);
    const startCharFontVal = `${startCharFont.family}::${startCharFont.style}`;
    while (i < node.characters.length) {
      i++;
      const charFont = node.getRangeFontName(i - 1, i);
      if (startCharFontVal !== `${charFont.family}::${charFont.style}`) {
        break;
      }
    }
    fontHashTree[`${startIdx}_${i}`] = startCharFontVal;
  }
  await figma.loadFontAsync(fallbackFont);
  node.fontName = fallbackFont;
  node.characters = characters;
  console.log(fontHashTree);
  await Promise.all(
    Object.keys(fontHashTree).map(async (range) => {
      console.log(range, fontHashTree[range]);
      const [start, end] = range.split("_");
      const [family, style] = fontHashTree[range].split("::");
      const matchedFont = {
        family,
        style,
      };
      await figma.loadFontAsync(matchedFont);
      return node.setRangeFontName(Number(start), Number(end), matchedFont);
    })
  );
  return true;
};

const getDelimiterPos = (str, delimiter, startIdx = 0, endIdx = str.length) => {
  const indices = [];
  let temp = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    if (
      str[i] === delimiter &&
      i + startIdx !== endIdx &&
      temp !== i + startIdx
    ) {
      indices.push([temp, i + startIdx]);
      temp = i + startIdx + 1;
    }
  }
  temp !== endIdx && indices.push([temp, endIdx]);
  return indices.filter(Boolean);
};

const buildLinearOrder = (node) => {
  const fontTree = [];
  const newLinesPos = getDelimiterPos(node.characters, "\n");
  newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd], n) => {
    const newLinesRangeFont = node.getRangeFontName(
      newLinesRangeStart,
      newLinesRangeEnd
    );
    if (newLinesRangeFont === figma.mixed) {
      const spacesPos = getDelimiterPos(
        node.characters,
        " ",
        newLinesRangeStart,
        newLinesRangeEnd
      );
      spacesPos.forEach(([spacesRangeStart, spacesRangeEnd], s) => {
        const spacesRangeFont = node.getRangeFontName(
          spacesRangeStart,
          spacesRangeEnd
        );
        if (spacesRangeFont === figma.mixed) {
          const spacesRangeFont = node.getRangeFontName(
            spacesRangeStart,
            spacesRangeStart[0]
          );
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        } else {
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        }
      });
    } else {
      fontTree.push({
        start: newLinesRangeStart,
        delimiter: "\n",
        family: newLinesRangeFont.family,
        style: newLinesRangeFont.style,
      });
    }
  });
  return fontTree
    .sort((a, b) => +a.start - +b.start)
    .map(({ family, style, delimiter }) => ({ family, style, delimiter }));
};

const setCharactersWithSmartMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const rangeTree = buildLinearOrder(node);
  const fontsToLoad = uniqBy(
    rangeTree,
    ({ family, style }) => `${family}::${style}`
  ).map(({ family, style }) => ({
    family,
    style,
  }));

  await Promise.all([...fontsToLoad, fallbackFont].map(figma.loadFontAsync));

  node.fontName = fallbackFont;
  node.characters = characters;

  let prevPos = 0;
  rangeTree.forEach(({ family, style, delimiter }) => {
    if (prevPos < node.characters.length) {
      const delimeterPos = node.characters.indexOf(delimiter, prevPos);
      const endPos =
        delimeterPos > prevPos ? delimeterPos : node.characters.length;
      const matchedFont = {
        family,
        style,
      };
      node.setRangeFontName(prevPos, endPos, matchedFont);
      prevPos = endPos + 1;
    }
  });
  return true;
};

// Add the cloneNode function implementation
async function cloneNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Clone the node
  const clone = node.clone();

  // If x and y are provided, move the clone to that position
  if (x !== undefined && y !== undefined) {
    if (!("x" in clone) || !("y" in clone)) {
      throw new Error(`Cloned node does not support position: ${nodeId}`);
    }
    clone.x = x;
    clone.y = y;
  }

  // Add the clone to the same parent as the original node
  if (node.parent) {
    node.parent.appendChild(clone);
  } else {
    figma.currentPage.appendChild(clone);
  }

  return {
    id: clone.id,
    name: clone.name,
    x: "x" in clone ? clone.x : undefined,
    y: "y" in clone ? clone.y : undefined,
    width: "width" in clone ? clone.width : undefined,
    height: "height" in clone ? clone.height : undefined,
  };
}

async function scanTextNodes(params) {
  console.log(`Starting to scan text nodes from node ID: ${params.nodeId}`);
  const {
    nodeId,
    useChunking = true,
    chunkSize = 10,
    commandId = generateCommandId(),
  } = params || {};

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    console.error(`Node with ID ${nodeId} not found`);
    // Send error progress update
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "error",
      0,
      0,
      0,
      `Node with ID ${nodeId} not found`,
      { error: `Node not found: ${nodeId}` }
    );
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // If chunking is not enabled, use the original implementation
  if (!useChunking) {
    const textNodes = [];
    try {
      // Send started progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "started",
        0,
        1, // Not known yet how many nodes there are
        0,
        `Starting scan of node "${node.name || nodeId}" without chunking`,
        null
      );

      await findTextNodes(node, [], 0, textNodes);

      // Send completed progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "completed",
        100,
        textNodes.length,
        textNodes.length,
        `Scan complete. Found ${textNodes.length} text nodes.`,
        { textNodes }
      );

      return {
        success: true,
        message: `Scanned ${textNodes.length} text nodes.`,
        count: textNodes.length,
        textNodes: textNodes,
        commandId,
      };
    } catch (error) {
      console.error("Error scanning text nodes:", error);

      // Send error progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "error",
        0,
        0,
        0,
        `Error scanning text nodes: ${error.message}`,
        { error: error.message }
      );

      throw new Error(`Error scanning text nodes: ${error.message}`);
    }
  }

  // Chunked implementation
  console.log(`Using chunked scanning with chunk size: ${chunkSize}`);

  // First, collect all nodes to process (without processing them yet)
  const nodesToProcess = [];

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "started",
    0,
    0, // Not known yet how many nodes there are
    0,
    `Starting chunked scan of node "${node.name || nodeId}"`,
    { chunkSize }
  );

  await collectNodesToProcess(node, [], 0, nodesToProcess);

  const totalNodes = nodesToProcess.length;
  console.log(`Found ${totalNodes} total nodes to process`);

  // Calculate number of chunks needed
  const totalChunks = Math.ceil(totalNodes / chunkSize);
  console.log(`Will process in ${totalChunks} chunks`);

  // Send update after node collection
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "in_progress",
    5, // 5% progress for collection phase
    totalNodes,
    0,
    `Found ${totalNodes} nodes to scan. Will process in ${totalChunks} chunks.`,
    {
      totalNodes,
      totalChunks,
      chunkSize,
    }
  );

  // Process nodes in chunks
  const allTextNodes = [];
  let processedNodes = 0;
  let chunksProcessed = 0;

  for (let i = 0; i < totalNodes; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, totalNodes);
    console.log(
      `Processing chunk ${chunksProcessed + 1}/${totalChunks} (nodes ${i} to ${chunkEnd - 1
      })`
    );

    // Send update before processing chunk
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processing chunk ${chunksProcessed + 1}/${totalChunks}`,
      {
        currentChunk: chunksProcessed + 1,
        totalChunks,
        textNodesFound: allTextNodes.length,
      }
    );

    const chunkNodes = nodesToProcess.slice(i, chunkEnd);
    const chunkTextNodes = [];

    // Process each node in this chunk
    for (const nodeInfo of chunkNodes) {
      if (nodeInfo.node.type === "TEXT") {
        try {
          const textNodeInfo = await processTextNode(
            nodeInfo.node,
            nodeInfo.parentPath,
            nodeInfo.depth
          );
          if (textNodeInfo) {
            chunkTextNodes.push(textNodeInfo);
          }
        } catch (error) {
          console.error(`Error processing text node: ${error.message}`);
          // Continue with other nodes
        }
      }

      // Brief delay to allow UI updates and prevent freezing
      await delay(5);
    }

    // Add results from this chunk
    allTextNodes.push(...chunkTextNodes);
    processedNodes += chunkNodes.length;
    chunksProcessed++;

    // Send update after processing chunk
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processed chunk ${chunksProcessed}/${totalChunks}. Found ${allTextNodes.length} text nodes so far.`,
      {
        currentChunk: chunksProcessed,
        totalChunks,
        processedNodes,
        textNodesFound: allTextNodes.length,
        chunkResult: chunkTextNodes,
      }
    );

    // Small delay between chunks to prevent UI freezing
    if (i + chunkSize < totalNodes) {
      await delay(50);
    }
  }

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "completed",
    100,
    totalNodes,
    processedNodes,
    `Scan complete. Found ${allTextNodes.length} text nodes.`,
    {
      textNodes: allTextNodes,
      processedNodes,
      chunks: chunksProcessed,
    }
  );

  return {
    success: true,
    message: `Chunked scan complete. Found ${allTextNodes.length} text nodes.`,
    totalNodes: allTextNodes.length,
    processedNodes: processedNodes,
    chunks: chunksProcessed,
    textNodes: allTextNodes,
    commandId,
  };
}

// Helper function to collect all nodes that need to be processed
async function collectNodesToProcess(
  node,
  parentPath = [],
  depth = 0,
  nodesToProcess = []
) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  // Add this node to the processing list
  nodesToProcess.push({
    node: node,
    parentPath: nodePath,
    depth: depth,
  });

  // Recursively add children
  if ("children" in node) {
    for (const child of node.children) {
      await collectNodesToProcess(child, nodePath, depth + 1, nodesToProcess);
    }
  }
}

// Process a single text node
async function processTextNode(node, parentPath, depth) {
  if (node.type !== "TEXT") return null;

  try {
    // Safely extract font information
    let fontFamily = "";
    let fontStyle = "";

    if (node.fontName) {
      if (typeof node.fontName === "object") {
        if ("family" in node.fontName) fontFamily = node.fontName.family;
        if ("style" in node.fontName) fontStyle = node.fontName.style;
      }
    }

    // Create a safe representation of the text node
    const safeTextNode = {
      id: node.id,
      name: node.name || "Text",
      type: node.type,
      characters: node.characters,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
      fontFamily: fontFamily,
      fontStyle: fontStyle,
      x: typeof node.x === "number" ? node.x : 0,
      y: typeof node.y === "number" ? node.y : 0,
      width: typeof node.width === "number" ? node.width : 0,
      height: typeof node.height === "number" ? node.height : 0,
      path: parentPath.join(" > "),
      depth: depth,
    };

    return safeTextNode;
  } catch (nodeErr) {
    console.error("Error processing text node:", nodeErr);
    return null;
  }
}

// A delay function that returns a promise
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep the original findTextNodes for backward compatibility
async function findTextNodes(node, parentPath = [], depth = 0, textNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node including its name
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  if (node.type === "TEXT") {
    try {
      // Safely extract font information to avoid Symbol serialization issues
      let fontFamily = "";
      let fontStyle = "";

      if (node.fontName) {
        if (typeof node.fontName === "object") {
          if ("family" in node.fontName) fontFamily = node.fontName.family;
          if ("style" in node.fontName) fontStyle = node.fontName.style;
        }
      }

      // Create a safe representation of the text node with only serializable properties
      const safeTextNode = {
        id: node.id,
        name: node.name || "Text",
        type: node.type,
        characters: node.characters,
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontFamily: fontFamily,
        fontStyle: fontStyle,
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
        path: nodePath.join(" > "),
        depth: depth,
      };

      textNodes.push(safeTextNode);
    } catch (nodeErr) {
      console.error("Error processing text node:", nodeErr);
      // Skip this node but continue with others
    }
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findTextNodes(child, nodePath, depth + 1, textNodes);
    }
  }
}

// Replace text in a specific node
async function setMultipleTextContents(params) {
  const { nodeId, text } = params || {};
  const commandId = params.commandId || generateCommandId();

  if (!nodeId || !text || !Array.isArray(text)) {
    const errorMsg = "Missing required parameters: nodeId and text array";

    // Send error progress update
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "error",
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg }
    );

    throw new Error(errorMsg);
  }

  console.log(
    `Starting text replacement for node: ${nodeId} with ${text.length} text replacements`
  );

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "started",
    0,
    text.length,
    0,
    `Starting text replacement for ${text.length} nodes`,
    { totalReplacements: text.length }
  );

  // Define the results array and counters
  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Split text replacements into chunks of 5
  const CHUNK_SIZE = 5;
  const chunks = [];

  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Split ${text.length} replacements into ${chunks.length} chunks`);

  // Send chunking info update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "in_progress",
    5, // 5% progress for planning phase
    text.length,
    0,
    `Preparing to replace text in ${text.length} nodes using ${chunks.length} chunks`,
    {
      totalReplacements: text.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
    }
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(
      `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length
      } replacements`
    );

    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
      }
    );

    // Process replacements within a chunk in parallel
    const chunkPromises = chunk.map(async (replacement) => {
      if (!replacement.nodeId || replacement.text === undefined) {
        console.error(`Missing nodeId or text for replacement`);
        return {
          success: false,
          nodeId: replacement.nodeId || "unknown",
          error: "Missing nodeId or text in replacement entry",
        };
      }

      try {
        console.log(
          `Attempting to replace text in node: ${replacement.nodeId}`
        );

        // Get the text node to update (just to check it exists and get original text)
        const textNode = await figma.getNodeByIdAsync(replacement.nodeId);

        if (!textNode) {
          console.error(`Text node not found: ${replacement.nodeId}`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node not found: ${replacement.nodeId}`,
          };
        }

        if (textNode.type !== "TEXT") {
          console.error(
            `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`
          );
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`,
          };
        }

        // Save original text for the result
        const originalText = textNode.characters;
        console.log(`Original text: "${originalText}"`);
        console.log(`Will translate to: "${replacement.text}"`);

        // Use the existing setTextContent function to handle font loading and text setting
        await setTextContent({
          nodeId: replacement.nodeId,
          text: replacement.text,
        });

        console.log(
          `Successfully replaced text in node: ${replacement.nodeId}`
        );
        return {
          success: true,
          nodeId: replacement.nodeId,
          originalText: originalText,
          translatedText: replacement.text,
        };
      } catch (error) {
        console.error(
          `Error replacing text in node ${replacement.nodeId}: ${error.message}`
        );
        return {
          success: false,
          nodeId: replacement.nodeId,
          error: `Error applying replacement: ${error.message}`,
        };
      }
    });

    // Wait for all replacements in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Process results for this chunk
    chunkResults.forEach((result) => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    // Send chunk processing complete update with partial results
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${chunks.length
      }. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults,
      }
    );

    // Add a small delay between chunks to avoid overloading Figma
    if (chunkIndex < chunks.length - 1) {
      console.log("Pausing between chunks to avoid overloading Figma...");
      await delay(1000); // 1 second delay between chunks
    }
  }

  console.log(
    `Replacement complete: ${successCount} successful, ${failureCount} failed`
  );

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "completed",
    100,
    text.length,
    successCount + failureCount,
    `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalReplacements: text.length,
      replacementsApplied: successCount,
      replacementsFailed: failureCount,
      completedInChunks: chunks.length,
      results: results,
    }
  );

  return Object.assign(legacyBatchSummary(successCount, failureCount), {
    success: successCount > 0,
    nodeId: nodeId,
    replacementsApplied: successCount,
    replacementsFailed: failureCount,
    totalReplacements: text.length,
    results: results,
    completedInChunks: chunks.length,
    commandId,
  });
}

// Function to generate simple UUIDs for command IDs
function generateCommandId() {
  return (
    "cmd_" +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

async function getAnnotations(params) {
  try {
    const { nodeId, includeCategories = true } = params;

    // Get categories first if needed
    let categoriesMap = {};
    if (includeCategories) {
      const categories = await figma.annotations.getAnnotationCategoriesAsync();
      categoriesMap = categories.reduce((map, category) => {
        map[category.id] = {
          id: category.id,
          label: category.label,
          color: category.color,
          isPreset: category.isPreset,
        };
        return map;
      }, {});
    }

    if (nodeId) {
      // Get annotations for a specific node
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found: ${nodeId}`);
      }

      if (node.type === "PAGE") {
        await node.loadAsync();
      }

      // Collect annotations from this node and all its descendants
      const mergedAnnotations = [];
      const collect = async (n) => {
        if ("annotations" in n && n.annotations && n.annotations.length > 0) {
          for (const a of n.annotations) {
            mergedAnnotations.push({ nodeId: n.id, annotation: a });
          }
        }
        if ("children" in n) {
          for (const child of n.children) {
            await collect(child);
          }
        }
      };
      await collect(node);

      const result = {
        scope: "node_subtree",
        nodeId: node.id,
        name: node.name,
        type: node.type,
        annotationCount: mergedAnnotations.length,
        annotations: mergedAnnotations,
      };

      if (includeCategories) {
        result.categories = Object.values(categoriesMap);
      }

      return result;
    } else {
      // Get all annotations in the current page
      const annotations = [];
      const processNode = async (node) => {
        if (
          "annotations" in node &&
          node.annotations &&
          node.annotations.length > 0
        ) {
          annotations.push({
            nodeId: node.id,
            name: node.name,
            annotations: node.annotations,
          });
        }
        if ("children" in node) {
          for (const child of node.children) {
            await processNode(child);
          }
        }
      };

      // Start from current page
      await processNode(figma.currentPage);

      const result = {
        scope: "current_page",
        pageId: figma.currentPage.id,
        annotationCount: annotations.reduce(
          (count, node) => count + node.annotations.length,
          0
        ),
        annotatedNodes: annotations,
      };

      if (includeCategories) {
        result.categories = Object.values(categoriesMap);
      }

      return result;
    }
  } catch (error) {
    console.error("Error in getAnnotations:", error);
    throw error;
  }
}

async function setAnnotation(params) {
  try {
    console.log("=== setAnnotation Debug Start ===");
    console.log("Input params:", JSON.stringify(params, null, 2));

    const { nodeId, annotationId, labelMarkdown, categoryId, properties } =
      params;

    // Validate required parameters
    if (!nodeId) {
      console.error("Validation failed: Missing nodeId");
      return { success: false, error: "Missing nodeId" };
    }

    if (!labelMarkdown) {
      console.error("Validation failed: Missing labelMarkdown");
      return { success: false, error: "Missing labelMarkdown" };
    }

    console.log("Attempting to get node:", nodeId);
    // Get and validate node
    const node = await figma.getNodeByIdAsync(nodeId);
    console.log("Node lookup result:", {
      id: nodeId,
      found: !!node,
      type: node ? node.type : undefined,
      name: node ? node.name : undefined,
      hasAnnotations: node ? "annotations" in node : false,
    });

    if (!node) {
      console.error("Node lookup failed:", nodeId);
      return { success: false, error: `Node not found: ${nodeId}` };
    }

    // Validate node supports annotations
    if (!("annotations" in node)) {
      console.error("Node annotation support check failed:", {
        nodeType: node.type,
        nodeId: node.id,
      });
      return {
        success: false,
        error: `Node type ${node.type} does not support annotations`,
      };
    }

    // Create the annotation object
    const newAnnotation = {
      labelMarkdown,
    };

    // Validate and add categoryId if provided
    if (categoryId) {
      console.log("Adding categoryId to annotation:", categoryId);
      newAnnotation.categoryId = categoryId;
    }

    // Validate and add properties if provided
    if (properties && Array.isArray(properties) && properties.length > 0) {
      console.log(
        "Adding properties to annotation:",
        JSON.stringify(properties, null, 2)
      );
      newAnnotation.properties = properties;
    }

    // Log current annotations before update
    console.log("Current node annotations:", node.annotations);

    // Overwrite annotations
    console.log(
      "Setting new annotation:",
      JSON.stringify(newAnnotation, null, 2)
    );
    node.annotations = [newAnnotation];

    // Verify the update
    console.log("Updated node annotations:", node.annotations);
    console.log("=== setAnnotation Debug End ===");

    return {
      success: true,
      nodeId: node.id,
      name: node.name,
      annotations: node.annotations,
    };
  } catch (error) {
    console.error("=== setAnnotation Error ===");
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      params: JSON.stringify(params, null, 2),
    });
    return { success: false, error: error.message };
  }
}

/**
 * Scan for nodes with specific types within a node
 * @param {Object} params - Parameters object
 * @param {string} params.nodeId - ID of the node to scan within
 * @param {Array<string>} params.types - Array of node types to find (e.g. ['COMPONENT', 'FRAME'])
 * @returns {Object} - Object containing found nodes
 */
async function scanNodesByTypes(params) {
  console.log(`Starting to scan nodes by types from node ID: ${params.nodeId}`);
  const { nodeId, types = [] } = params || {};

  if (nodeId === figma.root.id || nodeId === "0:0") {
    throw new Error(
      "Document-root traversal is not supported by scan_nodes_by_types. Use get_pages, optionally set_current_page, then scan a page or child node."
    );
  }

  if (!types || types.length === 0) {
    throw new Error("No types specified to search for");
  }

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  if (node.type === "PAGE") {
    await node.loadAsync();
  }

  // Simple implementation without chunking
  const matchingNodes = [];

  // Send a single progress update to notify start
  const commandId = generateCommandId();
  sendProgressUpdate(
    commandId,
    "scan_nodes_by_types",
    "started",
    0,
    1,
    0,
    `Starting scan of node "${node.name || nodeId}" for types: ${types.join(
      ", "
    )}`,
    null
  );

  // Recursively find nodes with specified types
  await findNodesByTypes(node, types, matchingNodes);

  // Send completion update
  sendProgressUpdate(
    commandId,
    "scan_nodes_by_types",
    "completed",
    100,
    matchingNodes.length,
    matchingNodes.length,
    `Scan complete. Found ${matchingNodes.length} matching nodes.`,
    { matchingNodes }
  );

  return {
    scope: "node_subtree",
    success: true,
    message: `Found ${matchingNodes.length} matching nodes.`,
    count: matchingNodes.length,
    matchingNodes: matchingNodes,
    searchedTypes: types,
  };
}

/**
 * Helper function to recursively find nodes with specific types
 * @param {SceneNode} node - The root node to start searching from
 * @param {Array<string>} types - Array of node types to find
 * @param {Array} matchingNodes - Array to store found nodes
 */
async function findNodesByTypes(node, types, matchingNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Check if this node is one of the specified types
  if (types.includes(node.type)) {
    // Create a minimal representation with just ID, type and bbox
    matchingNodes.push({
      id: node.id,
      name: node.name || `Unnamed ${node.type}`,
      type: node.type,
      // Basic bounding box info
      bbox: {
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
      },
    });
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findNodesByTypes(child, types, matchingNodes);
    }
  }
}

// Set multiple annotations with async progress updates
async function setMultipleAnnotations(params) {
  console.log("=== setMultipleAnnotations Debug Start ===");
  console.log("Input params:", JSON.stringify(params, null, 2));

  const { nodeId, annotations } = params;
  const commandId = (params && params.commandId) || generateCommandId();

  if (!annotations || annotations.length === 0) {
    console.error("Validation failed: No annotations provided");
    return { success: false, error: "No annotations provided" };
  }

  console.log(
    `Processing ${annotations.length} annotations for node ${nodeId}`
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Phase 4.3 — Finding 4 made TRUE rather than corrected downward. The public contract
  // has always declared this tool `pluginUpdates: "chunked"` and it emitted nothing: a
  // hand-written behavioural claim with no runtime behind it. ⛔ Correcting the map to
  // "none" instead would WEAKEN a declared behaviour and leave this tool the only batch
  // tool on the plain 30 s wall, because nothing would reset the inactivity timer.
  await sendProgressUpdate(
    commandId,
    "set_multiple_annotations",
    "started",
    0,
    annotations.length,
    0,
    `Starting annotation of ${annotations.length} node${annotations.length === 1 ? "" : "s"}`,
    { chunkSize: 1, currentChunk: 0, totalChunks: annotations.length }
  );

  // Process annotations sequentially
  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i];
    console.log(
      `\nProcessing annotation ${i + 1}/${annotations.length}:`,
      JSON.stringify(annotation, null, 2)
    );

    try {
      console.log("Calling setAnnotation with params:", {
        nodeId: annotation.nodeId,
        labelMarkdown: annotation.labelMarkdown,
        categoryId: annotation.categoryId,
        properties: annotation.properties,
      });

      const result = await setAnnotation({
        nodeId: annotation.nodeId,
        labelMarkdown: annotation.labelMarkdown,
        categoryId: annotation.categoryId,
        properties: annotation.properties,
      });

      console.log("setAnnotation result:", JSON.stringify(result, null, 2));

      if (result.success) {
        successCount++;
        results.push({ success: true, nodeId: annotation.nodeId });
        console.log(`✓ Annotation ${i + 1} applied successfully`);
      } else {
        failureCount++;
        results.push({
          success: false,
          nodeId: annotation.nodeId,
          error: result.error,
        });
        console.error(`✗ Annotation ${i + 1} failed:`, result.error);
      }
    } catch (error) {
      failureCount++;
      const errorResult = {
        success: false,
        nodeId: annotation.nodeId,
        error: error.message,
      };
      results.push(errorResult);
      console.error(`✗ Annotation ${i + 1} failed with error:`, error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
      });
    }

    // Per item, because that is the unit this tool actually processes — it has no chunks
    // to report. Each update resets the inactivity timer, which is the point: a long
    // annotation run no longer races a 30 s wall it never announced it could hit.
    await sendProgressUpdate(
      commandId,
      "set_multiple_annotations",
      i === annotations.length - 1 ? "completed" : "in_progress",
      Math.round(((i + 1) / annotations.length) * 100),
      annotations.length,
      i + 1,
      `Annotated ${i + 1}/${annotations.length}. ${successCount} successful, ${failureCount} failed`,
      { chunkSize: 1, currentChunk: i + 1, totalChunks: annotations.length }
    );
  }

  const summary = Object.assign(legacyBatchSummary(successCount, failureCount), {
    success: successCount > 0,
    annotationsApplied: successCount,
    annotationsFailed: failureCount,
    totalAnnotations: annotations.length,
    results: results,
  });

  console.log("\n=== setMultipleAnnotations Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("=== setMultipleAnnotations Debug End ===");

  return summary;
}

async function deleteMultipleNodes(params) {
  const { nodeIds } = params || {};
  const commandId = generateCommandId();

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
    const errorMsg = "Missing or invalid nodeIds parameter";
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "error",
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg }
    );
    throw new Error(errorMsg);
  }

  console.log(`Starting deletion of ${nodeIds.length} nodes`);

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "started",
    0,
    nodeIds.length,
    0,
    `Starting deletion of ${nodeIds.length} nodes`,
    { totalNodes: nodeIds.length }
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Process nodes in chunks of 5 to avoid overwhelming Figma
  const CHUNK_SIZE = 5;
  const chunks = [];

  for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
    chunks.push(nodeIds.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Split ${nodeIds.length} deletions into ${chunks.length} chunks`);

  // Send chunking info update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "in_progress",
    5,
    nodeIds.length,
    0,
    `Preparing to delete ${nodeIds.length} nodes using ${chunks.length} chunks`,
    {
      totalNodes: nodeIds.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
    }
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(
      `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length
      } nodes`
    );

    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Processing deletion chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
      }
    );

    // Process deletions within a chunk in parallel
    const chunkPromises = chunk.map(async (nodeId) => {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);

        if (!node) {
          console.error(`Node not found: ${nodeId}`);
          return {
            success: false,
            nodeId: nodeId,
            error: `Node not found: ${nodeId}`,
          };
        }

        // Save node info before deleting
        const nodeInfo = {
          id: node.id,
          name: node.name,
          type: node.type,
        };

        // Delete the node
        node.remove();

        console.log(`Successfully deleted node: ${nodeId}`);
        return {
          success: true,
          nodeId: nodeId,
          nodeInfo: nodeInfo,
        };
      } catch (error) {
        console.error(`Error deleting node ${nodeId}: ${error.message}`);
        return {
          success: false,
          nodeId: nodeId,
          error: error.message,
        };
      }
    });

    // Wait for all deletions in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Process results for this chunk
    chunkResults.forEach((result) => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    // Send chunk processing complete update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${chunks.length
      }. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults,
      }
    );

    // Add a small delay between chunks
    if (chunkIndex < chunks.length - 1) {
      console.log("Pausing between chunks...");
      await delay(1000);
    }
  }

  console.log(
    `Deletion complete: ${successCount} successful, ${failureCount} failed`
  );

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "completed",
    100,
    nodeIds.length,
    successCount + failureCount,
    `Node deletion complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalNodes: nodeIds.length,
      nodesDeleted: successCount,
      nodesFailed: failureCount,
      completedInChunks: chunks.length,
      results: results,
    }
  );

  return Object.assign(legacyBatchSummary(successCount, failureCount), {
    success: successCount > 0,
    nodesDeleted: successCount,
    nodesFailed: failureCount,
    totalNodes: nodeIds.length,
    results: results,
    completedInChunks: chunks.length,
    commandId,
  });
}

// Implementation for getInstanceOverrides function
async function getInstanceOverrides(instanceNode = null) {
  console.log("=== getInstanceOverrides called ===");

  let sourceInstance = null;

  // Check if an instance node was passed directly
  if (instanceNode) {
    console.log("Using provided instance node");

    // Validate that the provided node is an instance
    if (instanceNode.type !== "INSTANCE") {
      console.error("Provided node is not an instance");
      figma.notify("Provided node is not a component instance");
      return { success: false, message: "Provided node is not a component instance" };
    }

    sourceInstance = instanceNode;
  } else {
    // No node provided, use selection
    console.log("No node provided, using current selection");

    // Get the current selection
    const selection = figma.currentPage.selection;

    // Check if there's anything selected
    if (selection.length === 0) {
      console.log("No nodes selected");
      figma.notify("Please select at least one instance");
      return { success: false, message: "No nodes selected" };
    }

    // Filter for instances in the selection
    const instances = selection.filter(node => node.type === "INSTANCE");

    if (instances.length === 0) {
      console.log("No instances found in selection");
      figma.notify("Please select at least one component instance");
      return { success: false, message: "No instances found in selection" };
    }

    // Take the first instance from the selection
    sourceInstance = instances[0];
  }

  try {
    console.log(`Getting instance information:`);
    console.log(sourceInstance);

    // Get component overrides and main component
    const overrides = sourceInstance.overrides || [];
    console.log(`  Raw Overrides:`, overrides);

    // Get main component
    const mainComponent = await sourceInstance.getMainComponentAsync();
    if (!mainComponent) {
      console.error("Failed to get main component");
      figma.notify("Failed to get main component");
      return { success: false, message: "Failed to get main component" };
    }

    // return data to MCP server
    const returnData = {
      success: true,
      message: `Got component information from "${sourceInstance.name}" for overrides.length: ${overrides.length}`,
      sourceInstanceId: sourceInstance.id,
      mainComponentId: mainComponent.id,
      overridesCount: overrides.length
    };

    console.log("Data to return to MCP server:", returnData);
    figma.notify(`Got component information from "${sourceInstance.name}"`);

    return returnData;
  } catch (error) {
    console.error("Error in getInstanceOverrides:", error);
    figma.notify(`Error: ${error.message}`);
    return {
      success: false,
      message: `Error: ${error.message}`
    };
  }
}

/**
 * Helper function to validate and get target instances
 * @param {string[]} targetNodeIds - Array of instance node IDs
 * @returns {instanceNode[]} targetInstances - Array of target instances
 */
async function getValidTargetInstances(targetNodeIds) {
  let targetInstances = [];

  // Handle array of instances or single instance
  if (Array.isArray(targetNodeIds)) {
    if (targetNodeIds.length === 0) {
      return { success: false, message: "No instances provided" };
    }
    for (const targetNodeId of targetNodeIds) {
      const targetNode = await figma.getNodeByIdAsync(targetNodeId);
      if (targetNode && targetNode.type === "INSTANCE") {
        targetInstances.push(targetNode);
      }
    }
    if (targetInstances.length === 0) {
      return { success: false, message: "No valid instances provided" };
    }
  } else {
    return { success: false, message: "Invalid target node IDs provided" };
  }


  return { success: true, message: "Valid target instances provided", targetInstances };
}

/**
 * Helper function to validate and get saved override data
 * @param {string} sourceInstanceId - Source instance ID
 * @returns {Promise<Object>} - Validation result with source instance data or error
 */
async function getSourceInstanceData(sourceInstanceId) {
  if (!sourceInstanceId) {
    return { success: false, message: "Missing source instance ID" };
  }

  // Get source instance by ID
  const sourceInstance = await figma.getNodeByIdAsync(sourceInstanceId);
  if (!sourceInstance) {
    return {
      success: false,
      message: "Source instance not found. The original instance may have been deleted."
    };
  }

  // Verify it's an instance
  if (sourceInstance.type !== "INSTANCE") {
    return {
      success: false,
      message: "Source node is not a component instance."
    };
  }

  // Get main component
  const mainComponent = await sourceInstance.getMainComponentAsync();
  if (!mainComponent) {
    return {
      success: false,
      message: "Failed to get main component from source instance."
    };
  }

  return {
    success: true,
    sourceInstance,
    mainComponent,
    overrides: sourceInstance.overrides || []
  };
}

/**
 * Sets saved overrides to the selected component instance(s)
 * @param {InstanceNode[] | null} targetInstances - Array of instance nodes to set overrides to
 * @param {Object} sourceResult - Source instance data from getSourceInstanceData
 * @returns {Promise<Object>} - Result of the set operation
 */
async function setInstanceOverrides(targetInstances, sourceResult) {
  try {


    const { sourceInstance, mainComponent, overrides } = sourceResult;

    console.log(`Processing ${targetInstances.length} instances with ${overrides.length} overrides`);
    console.log(`Source instance: ${sourceInstance.id}, Main component: ${mainComponent.id}`);
    console.log(`Overrides:`, overrides);

    // Process all instances
    const results = [];
    let totalAppliedCount = 0;

    for (const targetInstance of targetInstances) {
      try {
        // // Skip if trying to apply to the source instance itself
        // if (targetInstance.id === sourceInstance.id) {
        //   console.log(`Skipping source instance itself: ${targetInstance.id}`);
        //   results.push({
        //     success: false,
        //     instanceId: targetInstance.id,
        //     instanceName: targetInstance.name,
        //     message: "This is the source instance itself, skipping"
        //   });
        //   continue;
        // }

        // Swap component
        try {
          targetInstance.swapComponent(mainComponent);
          console.log(`Swapped component for instance "${targetInstance.name}"`);
        } catch (error) {
          console.error(`Error swapping component for instance "${targetInstance.name}":`, error);
          results.push({
            success: false,
            instanceId: targetInstance.id,
            instanceName: targetInstance.name,
            message: `Error: ${error.message}`
          });
        }

        // Prepare overrides by replacing node IDs
        let appliedCount = 0;

        // Apply each override
        for (const override of overrides) {
          // Skip if no ID or overriddenFields
          if (!override.id || !override.overriddenFields || override.overriddenFields.length === 0) {
            continue;
          }

          // Replace source instance ID with target instance ID in the node path
          const overrideNodeId = override.id.replace(sourceInstance.id, targetInstance.id);
          const overrideNode = await figma.getNodeByIdAsync(overrideNodeId);

          if (!overrideNode) {
            console.log(`Override node not found: ${overrideNodeId}`);
            continue;
          }

          // Get source node to copy properties from
          const sourceNode = await figma.getNodeByIdAsync(override.id);
          if (!sourceNode) {
            console.log(`Source node not found: ${override.id}`);
            continue;
          }

          // Apply each overridden field
          let fieldApplied = false;
          for (const field of override.overriddenFields) {
            try {
              if (field === "componentProperties") {
                // Apply component properties
                if (sourceNode.componentProperties && overrideNode.componentProperties) {
                  const properties = {};
                  for (const key in sourceNode.componentProperties) {
                    // if INSTANCE_SWAP use id, otherwise use value
                    if (sourceNode.componentProperties[key].type === 'INSTANCE_SWAP') {
                      properties[key] = sourceNode.componentProperties[key].value;
                    
                    } else {
                      properties[key] = sourceNode.componentProperties[key].value;
                    }
                  }
                  overrideNode.setProperties(properties);
                  fieldApplied = true;
                }
              } else if (field === "characters" && overrideNode.type === "TEXT") {
                // For text nodes, need to load fonts first
                await figma.loadFontAsync(overrideNode.fontName);
                overrideNode.characters = sourceNode.characters;
                fieldApplied = true;
              } else if (field in overrideNode) {
                // Direct property assignment
                overrideNode[field] = sourceNode[field];
                fieldApplied = true;
              }
            } catch (fieldError) {
              console.error(`Error applying field ${field}:`, fieldError);
            }
          }

          if (fieldApplied) {
            appliedCount++;
          }
        }

        if (appliedCount > 0) {
          totalAppliedCount += appliedCount;
          results.push({
            success: true,
            instanceId: targetInstance.id,
            instanceName: targetInstance.name,
            appliedCount
          });
          console.log(`Applied ${appliedCount} overrides to "${targetInstance.name}"`);
        } else {
          results.push({
            success: false,
            instanceId: targetInstance.id,
            instanceName: targetInstance.name,
            message: "No overrides were applied"
          });
        }
      } catch (instanceError) {
        console.error(`Error processing instance "${targetInstance.name}":`, instanceError);
        results.push({
          success: false,
          instanceId: targetInstance.id,
          instanceName: targetInstance.name,
          message: `Error: ${instanceError.message}`
        });
      }
    }

    // Return results
    if (totalAppliedCount > 0) {
      const instanceCount = results.filter(r => r.success).length;
      const message = `Applied ${totalAppliedCount} overrides to ${instanceCount} instances`;
      figma.notify(message);
      return {
        success: true,
        message,
        totalCount: totalAppliedCount,
        results
      };
    } else {
      const message = "No overrides applied to any instance";
      figma.notify(message);
      return { success: false, message, results };
    }

  } catch (error) {
    console.error("Error in setInstanceOverrides:", error);
    const message = `Error: ${error.message}`;
    figma.notify(message);
    return { success: false, message };
  }
}

async function setLayoutMode(params) {
  const { nodeId, layoutMode = "NONE", layoutWrap = "NO_WRAP" } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports layoutMode
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support layoutMode`);
  }

  // Set layout mode
  node.layoutMode = layoutMode;

  // Set layoutWrap if applicable
  if (layoutMode !== "NONE") {
    node.layoutWrap = layoutWrap;
  }

  return {
    id: node.id,
    name: node.name,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
  };
}

async function setPadding(params) {
  const { nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft } =
    params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports padding
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support padding`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Padding can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // Set padding values if provided
  if (paddingTop !== undefined) node.paddingTop = paddingTop;
  if (paddingRight !== undefined) node.paddingRight = paddingRight;
  if (paddingBottom !== undefined) node.paddingBottom = paddingBottom;
  if (paddingLeft !== undefined) node.paddingLeft = paddingLeft;

  return {
    id: node.id,
    name: node.name,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
  };
}

async function setAxisAlign(params) {
  const { nodeId, primaryAxisAlignItems, counterAxisAlignItems } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports axis alignment
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support axis alignment`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Axis alignment can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // ---- Validation phase: nothing below this block writes ----
  // ⛔ F4. Every check, including the cross-field one, runs before the first
  // assignment, so a throw from this handler means the node is untouched.
  // ⭐ This is a pure REORDERING, not a rewrite: the cross-field check reads
  // `node.layoutMode` — node state, never `primaryAxisAlignItems` — and no write
  // below can change what it reads. Hoisting therefore yields identical verdicts
  // and identical messages, which is the whole licence for calling it a reorder.
  if (primaryAxisAlignItems !== undefined) {
    if (
      !["MIN", "MAX", "CENTER", "SPACE_BETWEEN"].includes(primaryAxisAlignItems)
    ) {
      throw new Error(
        "Invalid primaryAxisAlignItems value. Must be one of: MIN, MAX, CENTER, SPACE_BETWEEN"
      );
    }
  }

  if (counterAxisAlignItems !== undefined) {
    if (!["MIN", "MAX", "CENTER", "BASELINE"].includes(counterAxisAlignItems)) {
      throw new Error(
        "Invalid counterAxisAlignItems value. Must be one of: MIN, MAX, CENTER, BASELINE"
      );
    }
    // BASELINE is only valid for horizontal layout
    if (
      counterAxisAlignItems === "BASELINE" &&
      node.layoutMode !== "HORIZONTAL"
    ) {
      throw new Error(
        "BASELINE alignment is only valid for horizontal auto-layout frames"
      );
    }
  }

  // ---- Write phase: this block cannot reject ----
  if (primaryAxisAlignItems !== undefined) {
    node.primaryAxisAlignItems = primaryAxisAlignItems;
  }
  if (counterAxisAlignItems !== undefined) {
    node.counterAxisAlignItems = counterAxisAlignItems;
  }

  return {
    id: node.id,
    name: node.name,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    layoutMode: node.layoutMode,
  };
}

async function setLayoutSizing(params) {
  const { nodeId, layoutSizingHorizontal, layoutSizingVertical } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports layout sizing
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support layout sizing`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Layout sizing can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // ---- Validation phase: nothing below this block writes ----
  // ⛔ F4. ⭐ Pure REORDERING: both cross-field checks read node state
  // (`node.type`, `node.parent.layoutMode`) and never the sibling parameter, and
  // writing a node's own layoutSizing cannot retype it or re-parent it — so the
  // hoisted checks return exactly the verdicts the interleaved ones did.
  if (layoutSizingHorizontal !== undefined) {
    if (!["FIXED", "HUG", "FILL"].includes(layoutSizingHorizontal)) {
      throw new Error(
        "Invalid layoutSizingHorizontal value. Must be one of: FIXED, HUG, FILL"
      );
    }
    // HUG is only valid on auto-layout frames and text nodes
    if (
      layoutSizingHorizontal === "HUG" &&
      !["FRAME", "TEXT"].includes(node.type)
    ) {
      throw new Error(
        "HUG sizing is only valid on auto-layout frames and text nodes"
      );
    }
    // FILL is only valid on auto-layout children
    // ⛔ `undefined` is checked alongside "NONE" and that is not defensive padding: a
    // PAGE and a GROUP have no `layoutMode` property AT ALL, so this guard passed for
    // every top-level frame and wrote a FILL that Figma silently ignores. It was masked
    // by the harness giving every node a blanket `layoutMode: "NONE"`; R2.6 item 2.2
    // type-gated that default and the hole surfaced immediately. `setLayoutChild` has
    // always tested both, which is what the two being read side by side revealed.
    if (
      layoutSizingHorizontal === "FILL" &&
      (!node.parent ||
        node.parent.layoutMode === undefined ||
        node.parent.layoutMode === "NONE")
    ) {
      throw new Error("FILL sizing is only valid on auto-layout children");
    }
  }

  if (layoutSizingVertical !== undefined) {
    if (!["FIXED", "HUG", "FILL"].includes(layoutSizingVertical)) {
      throw new Error(
        "Invalid layoutSizingVertical value. Must be one of: FIXED, HUG, FILL"
      );
    }
    // HUG is only valid on auto-layout frames and text nodes
    if (
      layoutSizingVertical === "HUG" &&
      !["FRAME", "TEXT"].includes(node.type)
    ) {
      throw new Error(
        "HUG sizing is only valid on auto-layout frames and text nodes"
      );
    }
    // FILL is only valid on auto-layout children
    // ⛔ Same hole, same fix — see the horizontal branch above.
    if (
      layoutSizingVertical === "FILL" &&
      (!node.parent ||
        node.parent.layoutMode === undefined ||
        node.parent.layoutMode === "NONE")
    ) {
      throw new Error("FILL sizing is only valid on auto-layout children");
    }
  }

  // ---- Write phase: this block cannot reject ----
  if (layoutSizingHorizontal !== undefined) {
    node.layoutSizingHorizontal = layoutSizingHorizontal;
  }
  if (layoutSizingVertical !== undefined) {
    node.layoutSizingVertical = layoutSizingVertical;
  }

  return {
    id: node.id,
    name: node.name,
    layoutSizingHorizontal: node.layoutSizingHorizontal,
    layoutSizingVertical: node.layoutSizingVertical,
    layoutMode: node.layoutMode,
  };
}

async function setItemSpacing(params) {
  const { nodeId, itemSpacing, counterAxisSpacing } = params || {};

  // Validate that at least one spacing parameter is provided
  if (itemSpacing === undefined && counterAxisSpacing === undefined) {
    throw new Error("At least one of itemSpacing or counterAxisSpacing must be provided");
  }

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports item spacing
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support item spacing`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Item spacing can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // ---- Validation phase: nothing below this block writes ----
  // ⛔ F4. ⭐ Pure REORDERING: the cross-field check reads `node.layoutWrap` —
  // node state, never `itemSpacing` — and writing itemSpacing cannot change it.
  if (itemSpacing !== undefined) {
    if (typeof itemSpacing !== "number") {
      throw new Error("Item spacing must be a number");
    }
  }

  if (counterAxisSpacing !== undefined) {
    if (typeof counterAxisSpacing !== "number") {
      throw new Error("Counter axis spacing must be a number");
    }
    // counterAxisSpacing only applies when layoutWrap is WRAP
    if (node.layoutWrap !== "WRAP") {
      throw new Error(
        "Counter axis spacing can only be set on frames with layoutWrap set to WRAP"
      );
    }
  }

  // ---- Write phase: this block cannot reject ----
  if (itemSpacing !== undefined) {
    node.itemSpacing = itemSpacing;
  }
  if (counterAxisSpacing !== undefined) {
    node.counterAxisSpacing = counterAxisSpacing;
  }

  return {
    id: node.id,
    name: node.name,
    itemSpacing: node.itemSpacing || undefined,
    counterAxisSpacing: node.counterAxisSpacing || undefined,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
  };
}

// R2.6 item 2.1 — the child side of auto-layout.
//
// ⛔ VALIDATE-ALL-THEN-WRITE FROM BIRTH (plan 2.5, now the house rule rather than a
// per-tool decision). Phase 1 paid this debt off in three shipped ops; a fourth
// instance minted in the release that fixed them would be indefensible.
//
// ⛔ All three properties describe how a node participates in ITS PARENT's auto-layout.
// Assigned to a child of a non-auto-layout parent, Figma accepts every one of them and
// they change nothing — the silent discard item 2.0 refused for `fontWeight`. So the
// parent is a precondition on the WHOLE call, not a per-field one: a per-field rule
// would make the same tool refuse or succeed depending on which fields were sent, which
// is a worse contract than either answer.
const LAYOUT_CHILD_ALIGN = ["MIN", "CENTER", "MAX", "INHERIT"];
const LAYOUT_CHILD_POSITIONING = ["AUTO", "ABSOLUTE"];

async function setLayoutChild(params) {
  const { nodeId, layoutGrow, layoutAlign, layoutPositioning } = params || {};

  // ⛔ A zero-property call is REFUSED, not answered "done". `setItemSpacing` and
  // `set_text_style` both refuse it: replying success to a call that changed nothing
  // teaches a caller their write landed.
  if (
    layoutGrow === undefined &&
    layoutAlign === undefined &&
    layoutPositioning === undefined
  ) {
    throw new Error(
      "set_layout_child requires at least one of layoutGrow, layoutAlign or layoutPositioning, and wrote nothing"
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // ---- Validation phase: nothing below this block writes ----

  const parent = node.parent;
  if (!parent) {
    throw new Error(
      `Node ${nodeId} has no parent, so it participates in no auto-layout; wrote nothing`
    );
  }
  // A PAGE has no `layoutMode` at all; a plain FRAME reports "NONE". Both mean the same
  // thing here, and both are named in the message so the caller knows which one they hit.
  if (parent.layoutMode === undefined || parent.layoutMode === "NONE") {
    throw new Error(
      `set_layout_child requires an auto-layout parent and wrote nothing: node ${nodeId}'s parent "${parent.name}" (${parent.type}) has layoutMode ${
        parent.layoutMode === undefined ? "unset" : parent.layoutMode
      }. These three properties only take effect inside auto-layout — set it with set_layout_mode first.`
    );
  }

  if (layoutGrow !== undefined) {
    if (typeof layoutGrow !== "number" || Number.isNaN(layoutGrow)) {
      throw new Error("layoutGrow must be a number; wrote nothing");
    }
    if (layoutGrow !== 0 && layoutGrow !== 1) {
      throw new Error(
        `layoutGrow accepts 0 (keep its own size) or 1 (fill the parent's primary axis); received ${layoutGrow} and wrote nothing`
      );
    }
  }

  if (layoutAlign !== undefined) {
    // ⛔ STRETCH is REFUSED, and this is the point of the tool's narrow enum. It is the
    // legacy spelling of the counter-axis fill `set_layout_sizing` writes as FILL — one
    // document change reachable under two names. R2.4's live gate already caught a
    // divergence of exactly this shape (set_fill vs set_fill_color shipping different
    // param shapes for one behaviour), so the second spelling is refused rather than
    // quietly supported and left to drift.
    if (layoutAlign === "STRETCH") {
      throw new Error(
        'layoutAlign: "STRETCH" is refused and nothing was written. STRETCH is the legacy spelling of the counter-axis fill that set_layout_sizing writes as FILL — the same document change under two names. Use set_layout_sizing({ layoutSizingHorizontal | layoutSizingVertical: "FILL" }) so one behaviour keeps one spelling.'
      );
    }
    if (!LAYOUT_CHILD_ALIGN.includes(layoutAlign)) {
      throw new Error(
        `layoutAlign must be one of: ${LAYOUT_CHILD_ALIGN.join(
          ", "
        )} (STRETCH is refused — use set_layout_sizing FILL); received ${JSON.stringify(
          layoutAlign
        )} and wrote nothing`
      );
    }
  }

  if (layoutPositioning !== undefined) {
    if (!LAYOUT_CHILD_POSITIONING.includes(layoutPositioning)) {
      throw new Error(
        `layoutPositioning must be one of: ${LAYOUT_CHILD_POSITIONING.join(
          ", "
        )}; received ${JSON.stringify(layoutPositioning)} and wrote nothing`
      );
    }
  }

  // ⛔ Cross-field, and the same collision item 2.0 refused: an ABSOLUTE child sits
  // OUTSIDE the parent's flow, so `layoutGrow` and `layoutAlign` have nothing left to
  // act on. Figma stores them and they do nothing. Accepting both in one call would
  // discard one silently, and a discarded value reads as an applied one.
  if (layoutPositioning === "ABSOLUTE") {
    const ignored = [];
    if (layoutGrow !== undefined) ignored.push("layoutGrow");
    if (layoutAlign !== undefined) ignored.push("layoutAlign");
    if (ignored.length > 0) {
      throw new Error(
        `layoutPositioning: "ABSOLUTE" cannot be combined with ${ignored.join(
          " or "
        )}, and nothing was written: an absolutely-positioned child is outside the parent's auto-layout flow, so ${
          ignored.length === 1 ? "that value" : "those values"
        } would be stored and never applied. Position it with move_node instead.`
      );
    }
  }

  // ---- Write phase: this block cannot reject ----
  // ⭐ Positioning goes FIRST. Returning a child from ABSOLUTE to AUTO in the same call
  // that sets its grow/align has to re-enter the flow before those two mean anything;
  // the reverse order would write them against the outgoing state.
  const appliedFields = [];
  if (layoutPositioning !== undefined) {
    node.layoutPositioning = layoutPositioning;
    appliedFields.push("layoutPositioning");
  }
  if (layoutGrow !== undefined) {
    node.layoutGrow = layoutGrow;
    appliedFields.push("layoutGrow");
  }
  if (layoutAlign !== undefined) {
    node.layoutAlign = layoutAlign;
    appliedFields.push("layoutAlign");
  }

  return {
    id: node.id,
    name: node.name,
    appliedFields,
    appliedFieldCount: appliedFields.length,
    layoutGrow: node.layoutGrow,
    layoutAlign: node.layoutAlign,
    layoutPositioning: node.layoutPositioning,
    parentId: parent.id,
    parentLayoutMode: parent.layoutMode,
  };
}

// Set Constraints (R2.6 item 2.2) — how a node resizes with its parent frame.
//
// ⚠️ The parent rule here is the EXACT INVERSE of `set_layout_child`'s, and that is not an
// inconsistency: it is the same principle pointing the other way. Auto-layout and
// constraints are two mutually exclusive ways to answer "where does this child go", so a
// child in the flow of an auto-layout frame has its constraints stored and never resolved
// — the layout engine owns its position. `set_layout_child` refuses when the parent is NOT
// auto-layout; this refuses when it IS. Between the two, exactly one is always the right
// tool, and neither ever writes a value the platform will discard.
//
// The single exception is an ABSOLUTE child: `layoutPositioning: "ABSOLUTE"` takes a node
// out of the flow, and constraints govern it again. So the refusal tests the CHILD's
// positioning too, not just the parent's layoutMode.
const CONSTRAINT_VALUES = ["MIN", "CENTER", "MAX", "STRETCH", "SCALE"];

async function setConstraints(params) {
  const { nodeId, horizontal, vertical } = params || {};

  // ⛔ A zero-property call is REFUSED, not answered "done" — `setLayoutChild`,
  // `setItemSpacing` and `set_text_style` all refuse it. Replying success to a call that
  // changed nothing teaches a caller their write landed.
  if (horizontal === undefined && vertical === undefined) {
    throw new Error(
      "set_constraints requires at least one of horizontal or vertical, and wrote nothing"
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // ---- Validation phase: nothing below this block writes ----

  // ⭐ The eligibility test asks the NODE, it does not consult a type allowlist. A hand
  // written list of constraint-carrying types is the guard shape item 2.1's live gate
  // flagged as a debt — `set_layout_sizing` refuses RECTANGLE, which the Figma UI accepts
  // — and it goes stale every time Figma adds a node type. Reading the property is exact,
  // costs one access, and needs no maintenance.
  const current = node.constraints;
  const carriesConstraints =
    current !== null &&
    typeof current === "object" &&
    typeof current.horizontal === "string" &&
    typeof current.vertical === "string";
  if (!carriesConstraints) {
    throw new Error(
      `set_constraints wrote nothing: node ${nodeId} is a ${node.type}, which has no constraints property. Constraints exist on nodes that can be laid out inside a frame; a PAGE, a GROUP or a SECTION has none.`
    );
  }

  const parent = node.parent;
  if (!parent) {
    throw new Error(
      `Node ${nodeId} has no parent, so a constraint has nothing to resolve against; wrote nothing`
    );
  }
  // ⛔ A top-level node on a PAGE keeps a `constraints` value that nothing ever reads:
  // constraints resolve against a containing frame, and a page never resizes. Figma
  // stores the write happily, which is the silent discard this release refuses.
  // ⚠️ GROUP is deliberately NOT refused here. Whether a group child resolves its
  // constraints against the enclosing frame is a platform claim I could not verify, and
  // the house rule is to MEASURE a platform claim rather than encode it — an unverified
  // refusal is worse than none, because it looks authoritative. `live-constraints-gate`
  // measures it and reports a three-way verdict.
  if (parent.type === "PAGE" || parent.type === "DOCUMENT") {
    throw new Error(
      `set_constraints requires a node inside a container and wrote nothing: node ${nodeId}'s parent is a ${parent.type}. Constraints resolve against a containing frame — a top-level node has nothing to resize with, so Figma would store the value and never apply it.`
    );
  }

  // ⛔ The auto-layout refusal. Same shape as 2.1's, opposite polarity — see the note
  // above the function. An ABSOLUTE child is out of the flow and keeps its constraints.
  const parentIsAutoLayout =
    parent.layoutMode !== undefined && parent.layoutMode !== "NONE";
  if (parentIsAutoLayout && node.layoutPositioning !== "ABSOLUTE") {
    throw new Error(
      `set_constraints wrote nothing: node ${nodeId}'s parent "${parent.name}" (${parent.type}) is an auto-layout frame with layoutMode ${parent.layoutMode}, and this node is in its flow. Auto-layout owns an in-flow child's position, so Figma stores constraints there and never applies them. Size it with set_layout_sizing / set_layout_child, or take it out of the flow with set_layout_child({ layoutPositioning: "ABSOLUTE" }) first.`
    );
  }

  if (horizontal !== undefined && !CONSTRAINT_VALUES.includes(horizontal)) {
    throw new Error(
      `horizontal must be one of: ${CONSTRAINT_VALUES.join(
        ", "
      )}; received ${JSON.stringify(horizontal)} and wrote nothing`
    );
  }
  if (vertical !== undefined && !CONSTRAINT_VALUES.includes(vertical)) {
    throw new Error(
      `vertical must be one of: ${CONSTRAINT_VALUES.join(
        ", "
      )}; received ${JSON.stringify(vertical)} and wrote nothing`
    );
  }

  // ---- Write phase: this block cannot reject ----
  // ⭐ ONE assignment, which is why partial application is structurally impossible here
  // rather than merely avoided. `constraints` is a single object property: Figma refuses
  // a half-object, so the axis the caller did not supply must be carried over from the
  // node's current value. The merge is a REQUIREMENT of the platform's setter, not a
  // convenience — and it is also the reason the receipt reports `previous`, so a caller
  // can see the axis they did not name.
  const previous = {
    horizontal: current.horizontal,
    vertical: current.vertical,
  };
  const requestedFields = [];
  if (horizontal !== undefined) requestedFields.push("horizontal");
  if (vertical !== undefined) requestedFields.push("vertical");

  node.constraints = {
    horizontal: horizontal !== undefined ? horizontal : previous.horizontal,
    vertical: vertical !== undefined ? vertical : previous.vertical,
  };

  // ⛔ Read back through the node's own getter, never echo the object just assigned. An
  // echo describes the argument, not the document, and would report success against a
  // setter that silently dropped the write.
  const applied = {
    horizontal: node.constraints.horizontal,
    vertical: node.constraints.vertical,
  };
  // ⚠️ NOT "appliedFields": both axes are written on every call, so a field list of what
  // was WRITTEN would be the constant ["horizontal","vertical"] and could never fail.
  // These two can. `preservedFields` makes the merge visible; `changedFields` distinguishes
  // a write that moved something from an idempotent rewrite of the same value.
  const preservedFields = ["horizontal", "vertical"].filter(
    (axis) => !requestedFields.includes(axis)
  );
  const changedFields = ["horizontal", "vertical"].filter(
    (axis) => applied[axis] !== previous[axis]
  );

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    constraints: applied,
    previous,
    requestedFields,
    preservedFields,
    changedFields,
    unchanged: changedFields.length === 0,
    parentId: parent.id,
    parentType: parent.type,
    parentLayoutMode:
      parent.layoutMode === undefined ? null : parent.layoutMode,
    layoutPositioning:
      node.layoutPositioning === undefined ? null : node.layoutPositioning,
  };
}

// ---------------------------------------------------------------------------
// R2.6 item 2.3 — `set_size_limits(nodeId, minWidth?, maxWidth?, minHeight?, maxHeight?)`
//
// ⛔ THE FIRST LAYOUT TOOL SINCE PHASE 1 WHERE PARTIAL APPLICATION IS GENUINELY POSSIBLE.
// 2.1 and 2.2 were each a single assignment — 2.2's was one OBJECT property, so a
// half-written state could not even be represented. This writes up to FOUR independent
// number properties, which puts it in the same structural family as `set_corner_radius`
// and `set_padding`, both of which sit in `NON_ATOMIC_BATCH_OPERATIONS` for exactly that
// reason. Validate-all-then-write (plan 2.5) is load-bearing here, not ceremonial.
//
// ⚠️ THE PAIR TRAP, and it has two halves. Figma rejects a minimum above a maximum, so
// ① validation is on the EFFECTIVE post-write pair — supplied merged over stored — rather
// than on the fields the call happens to name, because a caller writing `minWidth: 500`
// onto a node already holding `maxWidth: 300` is conflicting with something invisible in
// their own arguments; and ② the WRITE ORDER matters even after validation passes, since
// two assignments pass through an intermediate state and raising a floor before raising
// the ceiling hands Figma a momentary min > max.
//
// ⛔ `null` is the single clear verb and an omitted field preserves — R2.3's plugin-data
// semantics, reused rather than reinvented. Figma types these four as `number | null`
// where null means "no limit", so a tool without a clear is a tool that can only tighten.
//
// ⚠️ THERE IS NO CONTEXT REFUSAL HERE, and that is a decision rather than an oversight.
// 2.1 refuses a parent that is NOT auto-layout, 2.2 refuses one that IS; whether min/max
// are inert outside an auto-layout context is a platform claim this project has not
// measured, and the house rule is that an unverified refusal is worse than none because it
// looks authoritative. `live-size-limits-gate.mjs` measures it and reports a three-way
// verdict — the same shape 2.2 used for its GROUP question. The only refusal about the
// node itself is that it does not carry the properties at all.
const SIZE_LIMIT_FIELDS = ["minWidth", "maxWidth", "minHeight", "maxHeight"];

// Each axis as the (min, max) pair the platform validates together. ⭐ The PAIR is the
// unit of validation; the FIELD is the unit of writing. Conflating the two is how a tool
// ends up checking the arguments against each other and calling that a pair check.
const SIZE_LIMIT_AXES = [
  { axis: "width", min: "minWidth", max: "maxWidth" },
  { axis: "height", min: "minHeight", max: "maxHeight" },
];

// ⭐ The eligibility probe, and it CANNOT be a value-shape test like 2.2's. There the
// stored value was always a string, so its shape answered "does this node carry
// constraints". Here `null` is a legal stored value meaning "no limit set", so only the
// absent/`null` distinction can separate a node with no surface from a carrier with
// nothing set. Reading an undefined property returns `undefined`; a few node proxies throw
// instead. Both mean no surface, and neither can be mistaken for `null`.
function readSizeLimit(node, field) {
  try {
    return node[field];
  } catch (error) {
    return undefined;
  }
}

async function setSizeLimits(params) {
  const source = params || {};
  const { nodeId } = source;

  // ⛔ The zero-field refusal its four neighbours all carry. `undefined` is "not supplied";
  // `null` IS supplied — it is the clear — so it has to count as a field here or the one
  // call that removes a limit would be refused as empty.
  const requestedFields = SIZE_LIMIT_FIELDS.filter(
    (field) => source[field] !== undefined
  );
  if (requestedFields.length === 0) {
    throw new Error(
      `set_size_limits requires at least one of ${SIZE_LIMIT_FIELDS.join(
        ", "
      )}, and wrote nothing. Pass a positive number to set a limit, or null to remove one`
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // ---- Validation phase: nothing below this block writes ----

  const parent = node.parent;

  // ⛔ THE ELIGIBILITY RULE, and it is MEASURED rather than documented — `live-size-limits-
  // gate.mjs` §6 put an eight-cell matrix against real Figma. Two things came back, and the
  // first draft of this handler had both of them wrong:
  //
  //   ① The rule is CONTEXTUAL, not type-based. A RECTANGLE inside an auto-layout frame is
  //      accepted; a TEXT inside a plain frame is refused. Node type is irrelevant, exactly
  //      as the platform's own message says: "can only set maxWidth on auto layout nodes
  //      and their children".
  //   ② The four properties are READABLE on every node, returning null. Only the WRITE is
  //      gated. So the obvious probe — read the property and see if it is there — cannot
  //      distinguish eligible from ineligible, and the first draft's did not: all four
  //      ineligible cases in the matrix were refused by FIGMA during the write phase, never
  //      by this handler.
  //
  // ⭐ That second point is why this rule has to live here rather than being left to the
  // platform. This tool writes up to four independent fields, and a write phase that can
  // throw is a partial application waiting for the right ordering. The gate measured that
  // Figma happens to refuse the FIRST field, so nothing lands today — but that is the
  // platform's ordering, not this tool's guarantee, and "validate-all-then-write" has to
  // mean the validation actually happened.
  //
  // ⚠️ Decision ③ originally ALLOWED this case rather than refusing it, on the house rule
  // that an unverified refusal is worse than none. That was right at the time and is
  // superseded by the measurement, not overturned by an opinion.
  const isAutoLayout = (candidate) =>
    Boolean(candidate) &&
    candidate.layoutMode !== undefined &&
    candidate.layoutMode !== "NONE";

  if (!isAutoLayout(node) && !isAutoLayout(parent)) {
    throw new Error(
      `set_size_limits wrote nothing: node ${nodeId} is a ${node.type} with layoutMode ${
        node.layoutMode === undefined ? "unset" : node.layoutMode
      }, and its parent ${
        parent
          ? `"${parent.name}" (${parent.type}) has layoutMode ${
              parent.layoutMode === undefined ? "unset" : parent.layoutMode
            }`
          : "does not exist"
      }. Figma only accepts min/max sizing on auto-layout nodes and their children — the write would be refused by the platform, not stored and ignored. Give the node or its parent an auto-layout with set_layout_mode first.`
    );
  }

  const previous = {};
  const surface = [];
  for (const field of SIZE_LIMIT_FIELDS) {
    const value = readSizeLimit(node, field);
    if (value === undefined) continue;
    surface.push(field);
    previous[field] = value;
  }

  // ⚠️ A residual guard, NOT the eligibility test — the matrix showed these properties are
  // readable everywhere, so in practice this is unreachable on a node that passed the
  // context rule above. It stays because the pair merge below indexes `previous`, and a
  // field that silently read back `undefined` would turn the merge into a comparison
  // against nothing. ⛔ Per-FIELD, so a future node type that exposed only some of them
  // would not be refused wholesale.
  const missing = requestedFields.filter((field) => !surface.includes(field));
  if (missing.length > 0) {
    throw new Error(
      `set_size_limits wrote nothing: node ${nodeId} is a ${
        node.type
      } and does not expose ${missing.join(", ")}${
        surface.length > 0 ? `. It does expose ${surface.join(", ")}` : ""
      }`
    );
  }

  // Each supplied value is either a clear or a positive finite number. ⛔ `0` is REFUSED
  // rather than read as "no limit": `null` already says that unambiguously, and a
  // `maxWidth: 0` describes a node that cannot exist. `create_text` set the precedent when
  // it stopped turning `fontSize: 0` into 14 silently.
  for (const field of requestedFields) {
    const value = source[field];
    if (value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        `${field} must be a positive number, or null to clear it; received ${JSON.stringify(
          value
        )} and wrote nothing`
      );
    }
    if (value <= 0) {
      throw new Error(
        `${field} must be greater than 0; received ${value} and wrote nothing. Pass null to remove the limit instead`
      );
    }
  }

  // ⚠️ Half one of the pair trap. The pair that matters is the one the node will HOLD
  // after the write, so a supplied value is merged over the stored one before comparing.
  // This is what catches a lone `minWidth: 500` landing on a stored `maxWidth: 300` — a
  // conflict the caller cannot see anywhere in their own arguments.
  const target = {};
  for (const field of surface) {
    target[field] =
      source[field] !== undefined ? source[field] : previous[field];
  }
  for (const { axis, min, max } of SIZE_LIMIT_AXES) {
    const low = target[min];
    const high = target[max];
    if (low === undefined || high === undefined) continue;
    if (low === null || high === null) continue;
    if (low > high) {
      throw new Error(
        `set_size_limits wrote nothing: ${min} ${low} (${
          source[min] !== undefined ? "requested" : "already stored"
        }) is greater than ${max} ${high} (${
          source[max] !== undefined ? "requested" : "already stored"
        }), and Figma rejects a minimum above a maximum. The ${axis} pair is validated together, so a call naming only one of the two is still checked against the value the node already holds`
      );
    }
  }

  // ---- Write phase: this block cannot reject ----

  const before = { width: node.width, height: node.height };
  const writeOrder = [];

  for (const { min, max } of SIZE_LIMIT_AXES) {
    const writing = [min, max].filter((field) =>
      requestedFields.includes(field)
    );
    if (writing.length === 0) continue;

    // ⚠️ Half two of the pair trap, and the half that survives a passing validation. The
    // END state is valid by construction, but two assignments pass THROUGH an intermediate
    // one. Writing the min first is unsafe exactly when the new min exceeds the max the
    // node is still holding; there the max goes first.
    // ⭐ One of the two orders is always available, and that is provable rather than
    // hopeful: for both to be unsafe we would need target-min > current-max AND
    // current-min > target-max, which chain to current-min > current-max — a state the
    // platform cannot have been holding in the first place.
    // ⛔ A clear never creates a violation, so it needs no special case: `null` fails the
    // comparison below and takes the default order.
    const minFirstUnsafe =
      writing.includes(min) &&
      typeof target[min] === "number" &&
      typeof previous[max] === "number" &&
      target[min] > previous[max];

    for (const field of minFirstUnsafe ? [max, min] : [min, max]) {
      if (!writing.includes(field)) continue;
      node[field] = source[field];
      writeOrder.push(field);
    }
  }

  // ⛔ Read back through the node's own getters, never echo the values just assigned. An
  // echo describes the argument rather than the document, and would report success against
  // a platform that dropped, rounded or refused the write.
  const applied = {};
  for (const field of surface) {
    const value = readSizeLimit(node, field);
    applied[field] = value === undefined ? null : value;
  }
  const after = { width: node.width, height: node.height };

  // ⚠️ `appliedFields` is here on purpose, and it is the deliberate INVERSE of 2.2's
  // receipt. There both axes were written on every call, so the list would have been the
  // constant ["horizontal","vertical"] and could never have failed in either direction —
  // the false-green shape item 2.1 was caught by. Here the four fields are independent and
  // each optional, so this is a real reading: a field the platform did not take is absent
  // from it, and a caller can tell that from the reply alone.
  const appliedFields = requestedFields.filter(
    (field) => applied[field] === source[field]
  );
  const clearedFields = requestedFields.filter(
    (field) => source[field] === null
  );
  const preservedFields = surface.filter(
    (field) => !requestedFields.includes(field)
  );
  const changedFields = surface.filter(
    (field) => applied[field] !== previous[field]
  );

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    limits: applied,
    previous,
    requestedFields,
    appliedFields,
    clearedFields,
    preservedFields,
    changedFields,
    unchanged: changedFields.length === 0,
    // The order the fields were actually written in, which is the only place half two of
    // the pair trap is visible to a caller — or to a test.
    writeOrder,
    // ⭐ A size limit does not merely store a number: Figma CLAMPS the node to it, so the
    // write has a geometric side effect the stored value cannot report. Measuring in a
    // second currency is also what lets the live gate distinguish a limit that resolved
    // from one that was stored and ignored.
    size: { before, after },
    resized: before.width !== after.width || before.height !== after.height,
    parentId: parent ? parent.id : null,
    parentType: parent ? parent.type : null,
    parentLayoutMode:
      parent && parent.layoutMode !== undefined ? parent.layoutMode : null,
    layoutPositioning:
      node.layoutPositioning === undefined ? null : node.layoutPositioning,
  };
}

// R2.6 item 2.4 — `set_clips_content(nodeId, clipsContent)`
//
// The LAST of the four layout tools, and the smallest surface any of them has: one
// boolean. That is also the whole design problem.
//
// ⛔ A ONE-BOOLEAN RECEIPT CANNOT TELL AN ECHO FROM A READ-BACK. While the platform stores
// exactly what it is handed, `applied = source.clipsContent` and `applied = node.clipsContent`
// produce identical output on every input, so no assertion over the reported value can
// separate an honest receipt from a decorative one. Item 2.3 met this and closed it with an
// opt-in harness coercion (`roundSizeLimits`); item 2.1 met the same family from the other
// side and shipped a check that could not fail in either direction. See
// [[feedback_a_zero_valued_write_reads_as_no_write]] — the fix is to measure in a DIFFERENT
// CURRENCY, and this tool has a real one rather than a modelled one.
//
// ⭐ The currency is `absoluteRenderBounds`. Unlike 2.3's clamp, a boolean write has no
// effect the STORED value can report — but clipping is precisely a statement about what the
// node paints, and Figma answers that separately from what the node measures:
// `absoluteRenderBounds` extends past `absoluteBoundingBox` exactly when unclipped content
// spills out. Reading both, before and after, is a reading an echo cannot fabricate.
//
// ⚠️ WHETHER FIGMA RECOMPUTES THAT SYNCHRONOUSLY WITH THE ASSIGNMENT IS NOT CLAIMED HERE.
// `live-clips-content-gate.mjs` measures it and returns a three-way verdict. Until it does,
// `renderBoundsChanged` is `null` whenever either reading was unavailable and NEVER `false`
// — a `false` would read as "nothing happened", which is the one thing an absent measurement
// must not be allowed to say.
//
// ⛔ NO `appliedFields`, and that is the deliberate inverse of 2.3 rather than an omission.
// There the four fields were independent and each optional, so the list was a real reading
// that a dropped field would falsify. Here one field is written on every single call, so
// the list would be the constant ["clipsContent"] and could never fail in either direction
// — exactly 2.2's reasoning, and exactly the false-green shape 2.1's gate was caught by.
//
// ⭐ Partial application is structurally impossible: one assignment, like 2.2's single
// object write. Validate-all-then-write (plan 2.5) is therefore satisfied by construction
// here, and the interesting half of the rule is that the ELIGIBILITY refusal happens before
// the write rather than being left to the platform.
const CLIPS_CONTENT_TYPES = ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"];

// ⭐ THE ELIGIBILITY PROBE, and 2.3 is why a presence test needs an argument rather than an
// apology. There the identical-looking probe was WRONG: min/max are readable on EVERY node,
// returning null, and only the WRITE is gated — so "can I read it" could not distinguish an
// eligible node from an ineligible one, and all four refusals came from Figma mid-write.
// See [[feedback_a_readable_property_is_not_a_writable_one]].
//
// The ambiguity that defeated it cannot arise here: `clipsContent` is a boolean with no
// "unset" value, so a node reading back a boolean carries the surface and one reading
// `undefined` does not. There is no third state for a null to hide in.
//
// ⚠️ What that argument does NOT establish is that everything which READS a boolean will
// ACCEPT the write — that is 2.3's lesson stated exactly, and it is unmeasured. The live
// gate puts a matrix against real Figma and reports where readable and writable disagree.
// If they do, this rule moves, superseded by its own measurement rather than by an opinion.
function readClipsContent(node) {
  try {
    return node.clipsContent;
  } catch (error) {
    // A few node proxies throw on an absent property rather than answering `undefined`.
    // Both mean "no surface", and neither can be mistaken for a stored boolean.
    return undefined;
  }
}

// Kill float noise without hiding sub-pixel spill. Rounding to whole pixels would report a
// 0.5px stroke overhang as no overhang at all, which is the direction that under-warns.
function roundOverflow(value) {
  return Math.round(value * 10000) / 10000;
}

// ⛔ `null` here means THE PLATFORM DID NOT ANSWER, and it is deliberately not `false`.
// A node Figma declines to measure must never read as a node with nothing to clip —
// [[feedback_a_zero_valued_write_reads_as_no_write]] one layer down, where an absence
// would otherwise be indistinguishable from a real measurement of zero.
//
// ⚠️ `absoluteRenderBounds` includes strokes and effects, so a non-zero overflow is not by
// itself proof of an overflowing CHILD. This reports the reading and derives nothing from
// it beyond the arithmetic; interpreting it is the gate's job, against a fixture it built.
function readRenderGeometry(node) {
  let boundingBox = null;
  let renderBounds = null;
  try {
    boundingBox = node.absoluteBoundingBox || null;
  } catch (error) {
    boundingBox = null;
  }
  try {
    renderBounds = node.absoluteRenderBounds || null;
  } catch (error) {
    renderBounds = null;
  }
  if (!boundingBox || !renderBounds) {
    return { boundingBox, renderBounds, overflow: null, overflowing: null };
  }
  const overflow = {
    left: roundOverflow(boundingBox.x - renderBounds.x),
    top: roundOverflow(boundingBox.y - renderBounds.y),
    right: roundOverflow(
      renderBounds.x + renderBounds.width - (boundingBox.x + boundingBox.width)
    ),
    bottom: roundOverflow(
      renderBounds.y + renderBounds.height - (boundingBox.y + boundingBox.height)
    ),
  };
  return {
    boundingBox,
    renderBounds,
    overflow,
    overflowing: Object.keys(overflow).some((edge) => overflow[edge] > 0.01),
  };
}

function sameRenderBounds(before, after) {
  // `null` propagates rather than collapsing to a verdict — see the comment on
  // `readRenderGeometry`. Two unavailable readings are not two equal readings.
  if (!before.renderBounds || !after.renderBounds) return null;
  return (
    before.renderBounds.x === after.renderBounds.x &&
    before.renderBounds.y === after.renderBounds.y &&
    before.renderBounds.width === after.renderBounds.width &&
    before.renderBounds.height === after.renderBounds.height
  );
}

async function setClipsContent(params) {
  const source = params || {};
  const { nodeId, clipsContent } = source;

  // ⛔ Zod owns this type at the transport boundary and the gate asserts the refusal
  // arrives at `layer: "schema"`. It is repeated here because the plugin dispatcher is a
  // second entry point, and a handler that trusts its caller's schema is a handler that
  // writes `undefined` into a boolean property the first time anything else calls it.
  if (typeof clipsContent !== "boolean") {
    throw new Error(
      `set_clips_content requires clipsContent to be true or false; received ${JSON.stringify(
        clipsContent
      )} and wrote nothing`
    );
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // ---- Validation phase: nothing below this block writes ----

  const previous = readClipsContent(node);
  if (typeof previous !== "boolean") {
    throw new Error(
      `set_clips_content wrote nothing: node ${nodeId} is a ${node.type} and does not carry clipsContent, so there is nothing to clip with. Frame-like nodes have it — ${CLIPS_CONTENT_TYPES.join(
        ", "
      )}. A GROUP is sized by its children and cannot clip them; put the content in a frame with create_frame instead.`
    );
  }

  const parent = node.parent;
  const before = readRenderGeometry(node);

  // ---- Write phase: this block cannot reject ----
  //
  // ⭐ ONE assignment. There is no ordering, no intermediate state and no field that can
  // land while another is refused, which is why this tool could never join
  // NON_ATOMIC_BATCH_OPERATIONS even if 2.6 had let it into the batch allowlist.
  node.clipsContent = clipsContent;

  // ⛔ Read back through the node's own getter. On a boolean this looks like ceremony and
  // is the exact opposite: it is the only line that separates this receipt from one that
  // reports the caller's own argument back to them, and the offline suite mutates it.
  const applied = readClipsContent(node);
  const after = readRenderGeometry(node);

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    clipsContent: applied,
    previous,
    requested: clipsContent,
    // ⚠️ `changed` describes the STORED boolean and nothing else. A caller writing `true`
    // over `true` gets `changed: false` and a successful call — a no-op is not an error,
    // but it must not be reported as a change either.
    changed: applied !== previous,
    // ⭐ The second currency. `previous`/`applied` is a coin flip; this is not.
    render: { before, after },
    renderBoundsChanged: (() => {
      const same = sameRenderBounds(before, after);
      return same === null ? null : !same;
    })(),
    childCount: Array.isArray(node.children) ? node.children.length : null,
    parentId: parent ? parent.id : null,
    parentType: parent ? parent.type : null,
  };
}

// R2.7 item 1.1 — `set_fill(nodeId, paints)`
//
// The first visual tool, and the one that ends a divergence rather than only adding a
// surface. R2.4's live gate caught `apply_batch`'s `set_fill_color` taking
// `{color:{r,g,b,a}}` while the standalone `set_fill_color` takes flat `r,g,b,a` — two
// shapes behind one name, and the contract's "same shape" claim was simply false.
// ⛔ `set_fill_color` is `stable` and CANNOT be changed to fix it. So `set_fill` ships ONE
// shape, the old tool is documented as legacy, and the divergence stops spreading instead
// of being retroactively healed.
//
// ⭐ THE ARITY IS AN ARRAY, and that is the decision the item existed to make. Figma's own
// property is `node.fills`, a Paint[]; a real design stacks a gradient over a solid, and a
// single-paint surface cannot express it. Adding arity later to a `stable` tool is
// breaking, so the array is here from birth. `node.fills = [...]` is ONE assignment, which
// makes partial application structurally impossible — the same free guarantee 2.2 and 2.4
// had, and the one 2.3 had to work for.
//
// ⛔ `null` CLEARS, an empty array is REFUSED. R2.3's plugin-data semantics, reused rather
// than reinvented: `paints: null` sets `fills = []`, and `paints: []` is refused as the
// zero-field "wrote nothing" its four R2.6 neighbours all carry. Two ways to say one thing
// is how a discarded value reads as an applied one — `create_text`'s `fontWeight` ×
// `fontFamily` collision, in a different costume.
//
// ⚠️ THE ELIGIBILITY REFUSAL IS DELIBERATELY NARROW, and 2.3 is why. That item probed
// whether a node *exposed* `minWidth`, but Figma exposes all four on every node and gates
// only the WRITE — so the probe measured nothing and 4/4 refusals came from the platform
// mid-write. The lesson is not "probe harder", it is that a readable property is not a
// writable one and only a MEASUREMENT can tell you which contexts refuse. So the only
// refusal here is the genuine surface question — a node with no `fills` property cannot
// take one — and whether any *context* refuses despite the surface being present is left
// to `live-fill-gate.mjs` to measure. ⛔ An unverified refusal is worse than none, because
// it looks authoritative. See [[feedback_a_readable_property_is_not_a_writable_one]].
//
// ⭐ THE SECOND CURRENCY IS `fillStyleId`, and it is the reason this tool is not a
// one-liner. A node can have a paint STYLE bound, and assigning `fills` may detach it —
// a destructive edit to a design system, performed as a side effect of a colour change,
// on a property the caller never named. Whether Figma actually detaches is NOT claimed
// here; the receipt reports `styleIdBefore` / `styleIdAfter` / `styleDetached` as three
// separate readings and the gate measures what really happens. This is 2.2's
// allow-and-measure shape (decision ③), and 2.3 is the warning that the measurement may
// come back and supersede it — which is the process working, not failing.
//
// ⚠️ THE READ-BACK IS A READ-BACK, AND NOTHING ABOUT THE PLATFORM IS ASSUMED TO PROVE IT.
// It is tempting to argue that Figma NORMALIZES a paint on assignment — supplying
// `visible`/`opacity`/`blendMode` defaults the caller never sent — so that an echo and a
// read-back could be told apart by eye. That may well be true, and `live-fill-gate.mjs`
// measures it, but it is a PLATFORM CLAIM, and a tool whose honesty rests on one is the
// defect 2.3 shipped: an offline harness green against a rule Figma does not have.
// ⭐ What actually holds the read-back honest is the harness's opt-in discarding node
// (`ignoreFillWrites`) — 2.4's instrument, which depends on no platform behaviour at all.
// A node that accepts the assignment and keeps its old fills reports the OLD array through
// a read-back and the NEW one through an echo, in a single reading.
const FILL_SOLID_TYPE = "SOLID";
const FILL_GRADIENT_TYPES = [
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
  "GRADIENT_ANGULAR",
  "GRADIENT_DIAMOND",
];
const FILL_PAINT_TYPES = [FILL_SOLID_TYPE].concat(FILL_GRADIENT_TYPES);

// ⛔ `PASS_THROUGH` is absent on purpose. It is a NODE-level blend mode for groups, not a
// Paint one, and Figma refuses it on a paint. Listing it would advertise a mode the handler
// cannot deliver — F5's `CROP` defect, which R2.7 Phase 2 exists to repair, reintroduced by
// this tool in the same release.
const FILL_BLEND_MODES = [
  "NORMAL", "DARKEN", "MULTIPLY", "LINEAR_BURN", "COLOR_BURN",
  "LIGHTEN", "SCREEN", "LINEAR_DODGE", "COLOR_DODGE", "OVERLAY",
  "SOFT_LIGHT", "HARD_LIGHT", "DIFFERENCE", "EXCLUSION",
  "HUE", "SATURATION", "COLOR", "LUMINOSITY",
];

// Bounds on caller-supplied structure, per the cross-cutting "bound payloads" rule. Neither
// is a Figma limit — both are this fork refusing to let one call expand without a ceiling,
// the same reasoning `check_fonts` used for its 50-pair cap.
const MAX_FILL_PAINTS = 16;
const MAX_GRADIENT_STOPS = 64;

// ⛔ `node.fills` is `figma.mixed` on a TEXT node carrying per-character fills, and a few
// node proxies throw instead of exposing the property. All three are "no readable array",
// and NONE of them may be reported as an empty one — `[]` means "this node has no fills",
// which is a claim about the document that a failed reading has not earned.
function readFills(node) {
  let raw;
  try {
    raw = node.fills;
  } catch (error) {
    return { readable: false, mixed: false, fills: null };
  }
  if (raw === figma.mixed) return { readable: false, mixed: true, fills: null };
  if (!Array.isArray(raw)) return { readable: false, mixed: false, fills: null };
  return { readable: true, mixed: false, fills: clonePaints(raw) };
}

// Figma hands back live proxy objects; the receipt has to carry inert data or the "before"
// reading mutates underneath the caller when the write lands.
function clonePaints(paints) {
  return JSON.parse(JSON.stringify(paints));
}

// ⛔ `fillStyleId` is `figma.mixed` on a node with mixed styles, and absent entirely on a
// node with no style surface. Both collapse to null in the receipt, but `styleReadable`
// keeps them distinguishable from "no style bound" — a false "nothing was bound" is exactly
// the reading that would hide a detach.
function readFillStyleId(node) {
  let raw;
  try {
    raw = node.fillStyleId;
  } catch (error) {
    return { readable: false, styleId: null };
  }
  if (raw === undefined) return { readable: false, styleId: null };
  if (raw === figma.mixed) return { readable: true, styleId: null };
  return { readable: true, styleId: raw === "" ? null : raw };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// A colour channel is a 0-1 float and out-of-range is REFUSED, never clamped. The legacy
// `set_fill_color` runs `parseFloat(r) || 0`, which turns a typo into black and reports
// success — the same silent-coercion defect `create_text` closed when it stopped turning
// `fontSize: 0` into 14. A clamp here would be a discarded value reading as an applied one.
function validateColorChannel(value, label, where) {
  if (!isFiniteNumber(value)) {
    throw new Error(
      `${where}: ${label} must be a number between 0 and 1; received ${JSON.stringify(
        value
      )} and wrote nothing`
    );
  }
  if (value < 0 || value > 1) {
    throw new Error(
      `${where}: ${label} must be between 0 and 1; received ${value} and wrote nothing. Figma colour channels are 0-1 floats, not 0-255 bytes`
    );
  }
}

// ⭐ THE ANGLE → MATRIX CONVERSION, AND ITS CONVENTION IS UNVERIFIED UNTIL THE GATE RUNS.
//
// `gradientTransform` maps the node's normalized space into gradient space, where the ramp
// runs along x from 0 to 1. Rotating the ramp by θ about the centre means transforming
// points by the INVERSE rotation, hence the sign pattern below:
//
//     x' =  cosθ·(x-0.5) + sinθ·(y-0.5) + 0.5
//     y' = -sinθ·(x-0.5) + cosθ·(y-0.5) + 0.5
//
// θ=0 collapses to [[1,0,0],[0,1,0]] — Figma's own default linear transform, left→right,
// which is the one anchor point this derivation has that is not self-referential. θ=90
// gives [[0,1,0],[-1,0,1]], mapping top-centre to ramp position 0 and bottom-centre to 1,
// i.e. top→bottom. So the declared convention is **0° = left→right, 90° = top→bottom**,
// clockwise on screen because Figma's y axis points down.
//
// ⚠️ THAT IS ARITHMETIC, NOT A MEASUREMENT. It is consistent and it agrees with the
// documented default at one point, which is exactly the evidence a WRONG convention would
// also produce if the sign of θ were flipped — both agree at θ=0. `live-fill-gate.mjs`
// settles it by rendering, because reading `gradientTransform` back only echoes what this
// function computed. ⛔ Do not promote this tool on a read-back agreeing with the write.
function gradientTransformFromAngle(angle, scale) {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const s = scale === undefined ? 1 : scale;
  const a = cos / s;
  const b = sin / s;
  const d = -sin / s;
  const e = cos / s;
  return [
    [a, b, 0.5 - a * 0.5 - b * 0.5],
    [d, e, 0.5 - d * 0.5 - e * 0.5],
  ];
}

function validateGradientTransform(matrix, where) {
  if (
    !Array.isArray(matrix) ||
    matrix.length !== 2 ||
    !matrix.every((row) => Array.isArray(row) && row.length === 3)
  ) {
    throw new Error(
      `${where}: gradientTransform must be a 2x3 matrix, [[a,b,c],[d,e,f]]; received ${JSON.stringify(
        matrix
      )} and wrote nothing`
    );
  }
  for (const row of matrix) {
    for (const value of row) {
      if (!isFiniteNumber(value)) {
        throw new Error(
          `${where}: every gradientTransform entry must be a finite number; received ${JSON.stringify(
            value
          )} and wrote nothing`
        );
      }
    }
  }
}

// Builds ONE validated Paint. Throws on anything it cannot express — this runs entirely
// inside the validation phase, so a throw here has written nothing anywhere.
function buildFillPaint(input, index) {
  const where = `paints[${index}]`;

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `${where} must be an object describing one paint; received ${JSON.stringify(
        input
      )} and wrote nothing`
    );
  }

  const { type } = input;
  if (FILL_PAINT_TYPES.indexOf(type) === -1) {
    throw new Error(
      `${where}: type must be one of ${FILL_PAINT_TYPES.join(
        ", "
      )}; received ${JSON.stringify(type)} and wrote nothing`
    );
  }

  const paint = { type };

  // `visible`, `opacity` and `blendMode` are shared by every paint type.
  if (input.visible !== undefined) {
    if (typeof input.visible !== "boolean") {
      throw new Error(
        `${where}: visible must be true or false; received ${JSON.stringify(
          input.visible
        )} and wrote nothing`
      );
    }
    paint.visible = input.visible;
  }

  if (input.blendMode !== undefined) {
    if (FILL_BLEND_MODES.indexOf(input.blendMode) === -1) {
      throw new Error(
        `${where}: blendMode must be one of ${FILL_BLEND_MODES.join(
          ", "
        )}; received ${JSON.stringify(
          input.blendMode
        )} and wrote nothing. PASS_THROUGH is a node-level mode for groups and is not a valid paint blend mode`
      );
    }
    paint.blendMode = input.blendMode;
  }

  // Shared by every paint type. ⚠️ For a SOLID this collides with `color.a`, and the SOLID
  // branch below refuses the combination rather than letting this assignment win silently.
  if (input.opacity !== undefined) {
    validateColorChannel(input.opacity, "opacity", where);
    paint.opacity = input.opacity;
  }

  if (type === FILL_SOLID_TYPE) {
    const color = input.color;
    if (!color || typeof color !== "object" || Array.isArray(color)) {
      throw new Error(
        `${where}: a SOLID paint requires color: {r, g, b} with optional a; received ${JSON.stringify(
          color
        )} and wrote nothing`
      );
    }
    validateColorChannel(color.r, "color.r", where);
    validateColorChannel(color.g, "color.g", where);
    validateColorChannel(color.b, "color.b", where);

    // ⛔ TWO WAYS TO SAY ALPHA, SO THE COMBINATION IS REFUSED. Figma stores a solid's alpha
    // in the paint's `opacity`, not in `color`, but every caller who has met the legacy
    // `set_fill_color` will reach for `color.a`. Both are accepted; supplying both would
    // silently discard one, and a discarded value reads as an applied one. This is
    // `create_text`'s `fontWeight` × `fontFamily` refusal, on a different pair.
    if (color.a !== undefined && input.opacity !== undefined) {
      throw new Error(
        `${where}: pass color.a OR opacity, not both — they set the same thing (a solid paint's alpha lives in its opacity) and supplying both would silently discard one. Received color.a ${JSON.stringify(
          color.a
        )} and opacity ${JSON.stringify(input.opacity)}, and wrote nothing`
      );
    }
    if (color.a !== undefined) {
      validateColorChannel(color.a, "color.a", where);
      paint.opacity = color.a;
    }
    paint.color = { r: color.r, g: color.g, b: color.b };
  } else {
    const stops = input.gradientStops;
    if (!Array.isArray(stops) || stops.length < 2) {
      throw new Error(
        `${where}: a ${type} paint requires gradientStops, an array of at least 2 stops; received ${JSON.stringify(
          stops
        )} and wrote nothing`
      );
    }
    if (stops.length > MAX_GRADIENT_STOPS) {
      throw new Error(
        `${where}: ${stops.length} gradient stops exceeds this fork's ceiling of ${MAX_GRADIENT_STOPS} and wrote nothing`
      );
    }

    paint.gradientStops = stops.map((stop, stopIndex) => {
      const stopWhere = `${where}.gradientStops[${stopIndex}]`;
      if (!stop || typeof stop !== "object" || Array.isArray(stop)) {
        throw new Error(
          `${stopWhere} must be an object with position and color; received ${JSON.stringify(
            stop
          )} and wrote nothing`
        );
      }
      if (!isFiniteNumber(stop.position) || stop.position < 0 || stop.position > 1) {
        throw new Error(
          `${stopWhere}: position must be a number between 0 and 1; received ${JSON.stringify(
            stop.position
          )} and wrote nothing`
        );
      }
      const color = stop.color;
      if (!color || typeof color !== "object" || Array.isArray(color)) {
        throw new Error(
          `${stopWhere}: color must be {r, g, b} with optional a; received ${JSON.stringify(
            color
          )} and wrote nothing`
        );
      }
      validateColorChannel(color.r, "color.r", stopWhere);
      validateColorChannel(color.g, "color.g", stopWhere);
      validateColorChannel(color.b, "color.b", stopWhere);
      if (color.a !== undefined) validateColorChannel(color.a, "color.a", stopWhere);
      // ⚠️ Unlike a solid, a gradient STOP carries its alpha inside the colour — Figma
      // types stop colours as RGBA and there is no per-stop opacity to collide with. So
      // the default is supplied here rather than refused, and there is nothing to refuse
      // it against.
      return {
        position: stop.position,
        color: {
          r: color.r,
          g: color.g,
          b: color.b,
          a: color.a === undefined ? 1 : color.a,
        },
      };
    });

    // ⛔ THE SECOND REFUSED COMBINATION. `gradientTransform` is what Figma stores; `angle`
    // is a convenience this fork computes into one. Accepting both would mean silently
    // picking a winner, and the loser would read as applied. Same refusal shape as
    // color.a × opacity above and `create_text`'s font pair — one question, one answer.
    const hasTransform = input.gradientTransform !== undefined;
    const hasAngle = input.angle !== undefined;
    if (hasTransform && hasAngle) {
      throw new Error(
        `${where}: pass gradientTransform OR angle, not both — angle is converted into a gradientTransform, so supplying both would silently discard one. Received angle ${JSON.stringify(
          input.angle
        )} and wrote nothing`
      );
    }
    if (input.scale !== undefined && !hasAngle) {
      throw new Error(
        `${where}: scale only applies to angle, which was not supplied. Bake the scale into gradientTransform directly, or pass angle. Wrote nothing`
      );
    }

    if (hasTransform) {
      validateGradientTransform(input.gradientTransform, where);
      paint.gradientTransform = input.gradientTransform;
      paint.gradientAim = { source: "gradientTransform", angle: null, scale: null };
    } else if (hasAngle) {
      if (!isFiniteNumber(input.angle)) {
        throw new Error(
          `${where}: angle must be a finite number of degrees; received ${JSON.stringify(
            input.angle
          )} and wrote nothing`
        );
      }
      if (input.scale !== undefined) {
        if (!isFiniteNumber(input.scale) || input.scale <= 0) {
          throw new Error(
            `${where}: scale must be a number greater than 0; received ${JSON.stringify(
              input.scale
            )} and wrote nothing`
          );
        }
      }
      paint.gradientTransform = gradientTransformFromAngle(
        input.angle,
        input.scale
      );
      paint.gradientAim = {
        source: "angle",
        angle: input.angle,
        scale: input.scale === undefined ? 1 : input.scale,
      };
    } else {
      // Neither supplied: leave the property off entirely and let Figma apply its own
      // default, rather than this fork asserting what that default is.
      paint.gradientAim = { source: "figma-default", angle: null, scale: null };
    }

  }

  return paint;
}

async function setFill(params) {
  const source = params || {};
  const { nodeId, paints } = source;

  // ⛔ The zero-field refusal its R2.6 neighbours all carry, with the R2.3 clear layered on
  // top. `undefined` is "not supplied" and is refused; `null` IS supplied and means clear;
  // `[]` is refused because `null` already says that unambiguously.
  if (paints === undefined) {
    throw new Error(
      `set_fill requires paints: an array of 1-${MAX_FILL_PAINTS} paints, or null to remove every fill. Received nothing and wrote nothing`
    );
  }
  if (paints !== null) {
    if (!Array.isArray(paints)) {
      throw new Error(
        `set_fill requires paints to be an array or null; received ${JSON.stringify(
          paints
        )} and wrote nothing`
      );
    }
    if (paints.length === 0) {
      throw new Error(
        `set_fill received an empty paints array and wrote nothing. Pass null to remove every fill — an empty array and null would be two ways to say one thing`
      );
    }
    if (paints.length > MAX_FILL_PAINTS) {
      throw new Error(
        `set_fill received ${paints.length} paints, above this fork's ceiling of ${MAX_FILL_PAINTS}, and wrote nothing`
      );
    }
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // ---- Validation phase: nothing below this block writes ----

  // The genuine surface question, and the ONLY refusal about the node itself. See the
  // header: 2.3 is the proof that a readable property is not a writable one, so what this
  // does NOT do is invent a context rule the gate has not measured.
  if (!("fills" in node)) {
    throw new Error(
      `set_fill wrote nothing: node ${nodeId} is a ${node.type} and does not support fills`
    );
  }
  const beforeRead = readFills(node);

  // ⛔ Every paint is validated BEFORE the single assignment. The assignment itself cannot
  // partially apply — one property, one write — but a caller handed a five-paint array with
  // a bad enum in the last slot must get the whole call refused, not four paints applied
  // and one error. Validate-all-then-write, with the array built completely first.
  const built =
    paints === null
      ? []
      : paints.map((paint, index) => buildFillPaint(paint, index));

  // `gradientAim` is this fork's provenance record, not a Figma Paint field — strip it
  // before the write or Figma refuses the unknown property, and keep it for the receipt.
  const aims = built.map((paint) => paint.gradientAim || null);
  const writable = built.map((paint) => {
    const copy = Object.assign({}, paint);
    delete copy.gradientAim;
    return copy;
  });

  const styleBefore = readFillStyleId(node);

  // ---- Write phase: one assignment, so this block cannot partially apply ----

  node.fills = writable;

  // ⛔ Read back through the node's own getter. An echo of `writable` would describe the
  // argument rather than the document, and Figma NORMALIZES on assignment — it supplies
  // `visible`/`opacity`/`blendMode` defaults the caller never sent. That normalization is
  // what makes this read-back a real measurement rather than 2.4's coin flip.
  const afterRead = readFills(node);
  const styleAfter = readFillStyleId(node);

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    // What the document holds now, read back — never the argument.
    fills: afterRead.fills,
    fillCount: afterRead.fills === null ? null : afterRead.fills.length,
    // What it held before. ⛔ `null` here means the reading FAILED or was `figma.mixed`,
    // and is not the same claim as `[]` (this node had no fills). `previousReadable`
    // separates them, because a failed reading reported as an empty array would say
    // something about the document that nobody measured.
    previous: beforeRead.fills,
    previousReadable: beforeRead.readable,
    previousMixed: beforeRead.mixed,
    requestedCount: paints === null ? 0 : paints.length,
    cleared: paints === null,
    // ⭐ Provenance per paint: did the caller aim this gradient with a raw matrix, with an
    // angle this fork converted, or not at all? A silent default and a decision are
    // otherwise byte-identical in the stored value. See
    // [[feedback_a_silent_default_is_byte_identical_to_a_decision]].
    gradientAim: aims,
    // ⭐ The second currency — a fills write's effect on a property the caller never named.
    // ⚠️ NOT a claim that Figma detaches; it is the reading, and `live-fill-gate.mjs` is
    // what turns it into a claim. `styleDetached` is null when either side was unreadable,
    // never false, because a false would read as "nothing was detached".
    styleIdBefore: styleBefore.styleId,
    styleIdAfter: styleAfter.styleId,
    styleReadable: styleBefore.readable && styleAfter.readable,
    styleDetached:
      styleBefore.readable && styleAfter.readable
        ? Boolean(styleBefore.styleId) && !styleAfter.styleId
        : null,
  };
}

// R2.7 item 1.2 — `set_effects(nodeId, effects)`.
//
// Effects deliberately use the same bounded array-or-null / validate-all-then-write
// contract as `set_fill`. One assignment is structurally unable to partially apply, but
// every member still has to be built before that assignment so a bad last effect cannot
// leave a good first effect behind.
const EFFECT_TYPES = [
  "DROP_SHADOW",
  "INNER_SHADOW",
  "LAYER_BLUR",
  "BACKGROUND_BLUR",
];

// PASS_THROUGH belongs to a layer, not a paint or effect. Figma's BlendMode docs make that
// distinction explicitly, so advertising it here would promise a value the effect surface
// cannot carry.
const EFFECT_BLEND_MODES = [
  "NORMAL", "DARKEN", "MULTIPLY", "LINEAR_BURN", "COLOR_BURN",
  "LIGHTEN", "SCREEN", "LINEAR_DODGE", "COLOR_DODGE", "OVERLAY",
  "SOFT_LIGHT", "HARD_LIGHT", "DIFFERENCE", "EXCLUSION",
  "HUE", "SATURATION", "COLOR", "LUMINOSITY",
];
const MAX_EFFECTS = 16;

// The table is the ownership rule. Every field is optional at the transport layer so the
// plugin can name cross-type fields, missing required fields, and unknown fields rather
// than silently dropping one. Do not replace this with type-specific branches: a missing
// table entry must be able to fail a mutation test.
//
// ⛔ `defaults` exists because Figma's effect union is STRICTER than this fork's schema, and
// that was measured live (2026-08-23, channel `w113vf7y`) rather than read off the docs. A
// DROP_SHADOW omitting `visible` or `blendMode` is refused by the platform with "Required
// value missing" — so two fields this fork advertises as `.optional()` could not actually be
// omitted, and a generic client following the published schema hit a wall. Filling them here
// is what makes the word "optional" true.
//
// ⚠️ The split is NOT cosmetic: blurs require `visible` but have no `blendMode` at all, and
// sending one would come back as an unrecognized key. That is why the defaults live per type
// in this table and not in one shared object — and why `defaults ⊆ allowed` is asserted by a
// test rather than trusted to review.
const EFFECT_FIELD_RULES = Object.freeze({
  DROP_SHADOW: Object.freeze({
    required: Object.freeze(["color", "offset", "radius"]),
    allowed: Object.freeze([
      "type", "color", "offset", "radius", "spread", "visible", "blendMode",
      "showShadowBehindNode",
    ]),
    defaults: Object.freeze({ visible: true, blendMode: "NORMAL" }),
  }),
  INNER_SHADOW: Object.freeze({
    required: Object.freeze(["color", "offset", "radius"]),
    allowed: Object.freeze([
      "type", "color", "offset", "radius", "spread", "visible", "blendMode",
    ]),
    defaults: Object.freeze({ visible: true, blendMode: "NORMAL" }),
  }),
  LAYER_BLUR: Object.freeze({
    required: Object.freeze(["radius"]),
    allowed: Object.freeze(["type", "radius", "visible"]),
    defaults: Object.freeze({ visible: true }),
  }),
  BACKGROUND_BLUR: Object.freeze({
    required: Object.freeze(["radius"]),
    allowed: Object.freeze(["type", "radius", "visible"]),
    defaults: Object.freeze({ visible: true }),
  }),
});

function cloneEffects(effects) {
  return JSON.parse(JSON.stringify(effects));
}

// Unlike fills, Figma types effects as a plain array rather than a value that can be
// `figma.mixed`. A thrown getter or a non-array is still unreadable, and must never become
// a claim that the node held no effects.
function readEffects(node) {
  let raw;
  try {
    raw = node.effects;
  } catch (error) {
    return { readable: false, effects: null };
  }
  if (!Array.isArray(raw)) return { readable: false, effects: null };
  return { readable: true, effects: cloneEffects(raw) };
}

// effectStyleId is a string, not a mixed-valued property. An absent or unreadable surface
// is kept distinct from an empty string, which Figma uses for "no style bound".
function readEffectStyleId(node) {
  let raw;
  try {
    raw = node.effectStyleId;
  } catch (error) {
    return { readable: false, styleId: null };
  }
  if (typeof raw !== "string") return { readable: false, styleId: null };
  return { readable: true, styleId: raw === "" ? null : raw };
}

function validateEffectColor(color, where) {
  if (!color || typeof color !== "object" || Array.isArray(color)) {
    throw new Error(
      `${where}: color must be {r, g, b} with optional a; received ${JSON.stringify(
        color
      )} and wrote nothing`
    );
  }
  validateColorChannel(color.r, "color.r", where);
  validateColorChannel(color.g, "color.g", where);
  validateColorChannel(color.b, "color.b", where);
  if (color.a !== undefined) validateColorChannel(color.a, "color.a", where);
  // A shadow's alpha lives inside RGBA; unlike a solid paint there is no second opacity
  // spelling to collide with, so omitted alpha simply means Figma's opaque default.
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    a: color.a === undefined ? 1 : color.a,
  };
}

function validateEffectOffset(offset, where) {
  if (!offset || typeof offset !== "object" || Array.isArray(offset)) {
    throw new Error(
      `${where}: offset must be {x, y}; received ${JSON.stringify(
        offset
      )} and wrote nothing`
    );
  }
  if (!isFiniteNumber(offset.x) || !isFiniteNumber(offset.y)) {
    throw new Error(
      `${where}: offset.x and offset.y must be finite numbers; received ${JSON.stringify(
        offset
      )} and wrote nothing`
    );
  }
  return { x: offset.x, y: offset.y };
}

function validateEffectRadius(radius, where) {
  if (!isFiniteNumber(radius) || radius < 0) {
    throw new Error(
      `${where}: radius must be a finite number greater than or equal to 0; received ${JSON.stringify(
        radius
      )} and wrote nothing`
    );
  }
  return radius;
}

function buildEffect(input, index) {
  const where = `effects[${index}]`;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(
      `${where} must be an object describing one effect; received ${JSON.stringify(
        input
      )} and wrote nothing`
    );
  }

  const type = input.type;
  if (EFFECT_TYPES.indexOf(type) === -1) {
    throw new Error(
      `${where}: type must be one of ${EFFECT_TYPES.join(
        ", "
      )}; received ${JSON.stringify(type)} and wrote nothing`
    );
  }
  const rule = EFFECT_FIELD_RULES[type];

  for (const field of Object.keys(input)) {
    if (rule.allowed.indexOf(field) === -1) {
      throw new Error(
        `${where}: ${field} is not valid for ${type}. ${type} supports ${rule.allowed
          .filter((name) => name !== "type")
          .join(", ")}; wrote nothing`
      );
    }
  }
  for (const field of rule.required) {
    if (input[field] === undefined) {
      throw new Error(
        `${where}: ${type} requires ${field}; received no ${field} and wrote nothing`
      );
    }
  }

  const effect = { type };
  if (rule.allowed.indexOf("color") !== -1) {
    effect.color = validateEffectColor(input.color, where);
    effect.offset = validateEffectOffset(input.offset, where);
  }
  effect.radius = validateEffectRadius(input.radius, where);

  if (input.spread !== undefined) {
    if (!isFiniteNumber(input.spread)) {
      throw new Error(
        `${where}: spread must be a finite number; received ${JSON.stringify(
          input.spread
        )} and wrote nothing`
      );
    }
    // The sign is intentionally unbounded. Figma's UI accepts negative spread, but the
    // plugin surface has not been measured; a made-up sign rule would be a false contract.
    effect.spread = input.spread;
  }
  if (input.visible !== undefined) {
    if (typeof input.visible !== "boolean") {
      throw new Error(
        `${where}: visible must be true or false; received ${JSON.stringify(
          input.visible
        )} and wrote nothing`
      );
    }
    effect.visible = input.visible;
  }
  if (input.blendMode !== undefined) {
    if (EFFECT_BLEND_MODES.indexOf(input.blendMode) === -1) {
      throw new Error(
        `${where}: blendMode must be one of ${EFFECT_BLEND_MODES.join(
          ", "
        )}; received ${JSON.stringify(input.blendMode)} and wrote nothing`
      );
    }
    effect.blendMode = input.blendMode;
  }
  if (input.showShadowBehindNode !== undefined) {
    if (typeof input.showShadowBehindNode !== "boolean") {
      throw new Error(
        `${where}: showShadowBehindNode must be true or false; received ${JSON.stringify(
          input.showShadowBehindNode
        )} and wrote nothing`
      );
    }
    effect.showShadowBehindNode = input.showShadowBehindNode;
  }

  // Applied LAST and only where the caller said nothing. A supplied value must win —
  // defaulting over an explicit `visible: false` would silently discard a write, which is
  // the same "a discarded value reads as an applied one" failure this tool refuses
  // elsewhere. Every filled field is reported back through the receipt's node read-back,
  // so a default is visible to the caller rather than an invisible substitution.
  for (const field of Object.keys(rule.defaults)) {
    if (effect[field] === undefined) effect[field] = rule.defaults[field];
  }
  return effect;
}

async function setEffects(params) {
  const source = params || {};
  const { nodeId, effects } = source;

  if (effects === undefined) {
    throw new Error(
      `set_effects requires effects: an array of 1-${MAX_EFFECTS} effects, or null to remove every effect. Received nothing and wrote nothing`
    );
  }
  if (effects !== null) {
    if (!Array.isArray(effects)) {
      throw new Error(
        `set_effects requires effects to be an array or null; received ${JSON.stringify(
          effects
        )} and wrote nothing`
      );
    }
    if (effects.length === 0) {
      throw new Error(
        "set_effects received an empty effects array and wrote nothing. Pass null to remove every effect — an empty array and null would be two ways to say one thing"
      );
    }
    if (effects.length > MAX_EFFECTS) {
      throw new Error(
        `set_effects received ${effects.length} effects, above this fork's ceiling of ${MAX_EFFECTS}, and wrote nothing`
      );
    }
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // ---- Validation phase: nothing below this block writes ----
  if (!("effects" in node)) {
    throw new Error(
      `set_effects wrote nothing: node ${nodeId} is a ${node.type} and does not support effects`
    );
  }
  const beforeRead = readEffects(node);
  const built = effects === null ? [] : effects.map(buildEffect);
  const styleBefore = readEffectStyleId(node);

  // ---- Write phase: one assignment, so this block cannot partially apply ----
  node.effects = built;

  const afterRead = readEffects(node);
  const styleAfter = readEffectStyleId(node);

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    effects: afterRead.effects,
    effectCount: afterRead.effects === null ? null : afterRead.effects.length,
    previous: beforeRead.effects,
    previousReadable: beforeRead.readable,
    requestedCount: effects === null ? 0 : effects.length,
    cleared: effects === null,
    // A style detachment is read, not assumed. The live gate can turn these readings into
    // a platform finding without this tool ever claiming that all effects writes detach.
    styleIdBefore: styleBefore.styleId,
    styleIdAfter: styleAfter.styleId,
    styleReadable: styleBefore.readable && styleAfter.readable,
    styleDetached:
      styleBefore.readable && styleAfter.readable
        ? Boolean(styleBefore.styleId) && !styleAfter.styleId
        : null,
  };
}

// R2.7 item 1.3 — Layer opacity and layer blend mode.
//
// These values belong to Figma's BlendMixin. They are intentionally NOT added to
// filterFigmaNode: publishing them through get_node_info would widen a stable read result,
// which needs a public-contract bump that R2.7 no longer has. The two new write tools are
// additive-preview instead, and their receipts carry the direct plugin-node read-back.
//
// `PASS_THROUGH` belongs here. Paint and effect blend modes deliberately exclude it, but
// Figma's node-level BlendMode includes it — silently reusing either narrower enum would
// make this layer tool promise less than the platform surface it names.
const LAYER_BLEND_MODES = [
  "PASS_THROUGH",
  "NORMAL", "DARKEN", "MULTIPLY", "LINEAR_BURN", "COLOR_BURN",
  "LIGHTEN", "SCREEN", "LINEAR_DODGE", "COLOR_DODGE", "OVERLAY",
  "SOFT_LIGHT", "HARD_LIGHT", "DIFFERENCE", "EXCLUSION",
  "HUE", "SATURATION", "COLOR", "LUMINOSITY",
];

function readLayerOpacity(node) {
  let raw;
  try {
    raw = node.opacity;
  } catch (error) {
    return { readable: false, value: null };
  }
  return {
    readable: isFiniteNumber(raw),
    value: isFiniteNumber(raw) ? raw : null,
  };
}

function readLayerBlendMode(node) {
  let raw;
  try {
    raw = node.blendMode;
  } catch (error) {
    return { readable: false, value: null };
  }
  return {
    readable: typeof raw === "string",
    value: typeof raw === "string" ? raw : null,
  };
}

function validateLayerOpacity(opacity) {
  if (!isFiniteNumber(opacity) || opacity < 0 || opacity > 1) {
    throw new Error(
      `set_opacity requires opacity to be a finite number from 0 to 1; received ${JSON.stringify(
        opacity
      )} and wrote nothing`
    );
  }
}

function validateLayerBlendMode(blendMode) {
  if (LAYER_BLEND_MODES.indexOf(blendMode) === -1) {
    throw new Error(
      `set_blend_mode requires blendMode to be one of ${LAYER_BLEND_MODES.join(
        ", "
      )}; received ${JSON.stringify(blendMode)} and wrote nothing`
    );
  }
}

function layerWriteReceipt(node, field, before, after) {
  const changed =
    before.readable && after.readable ? before.value !== after.value : null;
  const common = {
    id: node.id,
    name: node.name,
    type: node.type,
    changed,
  };
  if (field === "opacity") {
    return {
      ...common,
      opacity: after.value,
      opacityReadable: after.readable,
      previousOpacity: before.value,
      previousOpacityReadable: before.readable,
    };
  }
  return {
    ...common,
    blendMode: after.value,
    blendModeReadable: after.readable,
    previousBlendMode: before.value,
    previousBlendModeReadable: before.readable,
  };
}

async function setOpacity(params) {
  const { nodeId, opacity } = params || {};
  validateLayerOpacity(opacity);

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node with ID ${nodeId} not found`);
  if (!("opacity" in node)) {
    throw new Error(
      `set_opacity wrote nothing: node ${nodeId} is a ${node.type} and does not support layer opacity`
    );
  }

  const before = readLayerOpacity(node);
  node.opacity = opacity;
  const after = readLayerOpacity(node);
  return layerWriteReceipt(node, "opacity", before, after);
}

async function setBlendMode(params) {
  const { nodeId, blendMode } = params || {};
  validateLayerBlendMode(blendMode);

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node with ID ${nodeId} not found`);
  if (!("blendMode" in node)) {
    throw new Error(
      `set_blend_mode wrote nothing: node ${nodeId} is a ${node.type} and does not support layer blendMode`
    );
  }

  const before = readLayerBlendMode(node);
  node.blendMode = blendMode;
  const after = readLayerBlendMode(node);
  return layerWriteReceipt(node, "blendMode", before, after);
}

async function setDefaultConnector(params) {
  const { connectorId } = params || {};
  
  // If connectorId is provided, search and set by that ID (do not check existing storage)
  if (connectorId) {
    // Get node by specified ID
    const node = await figma.getNodeByIdAsync(connectorId);
    if (!node) {
      throw new Error(`Connector node not found with ID: ${connectorId}`);
    }
    
    // Check node type
    if (node.type !== 'CONNECTOR') {
      throw new Error(`Node is not a connector: ${connectorId}`);
    }
    
    // Set the found connector as the default connector
    await figma.clientStorage.setAsync('defaultConnectorId', connectorId);
    
    return {
      success: true,
      message: `Default connector set to: ${connectorId}`,
      connectorId: connectorId
    };
  } 
  // If connectorId is not provided, check existing storage
  else {
    // Check if there is an existing default connector in client storage
    try {
      const existingConnectorId = await figma.clientStorage.getAsync('defaultConnectorId');
      
      // If there is an existing connector ID, check if the node is still valid
      if (existingConnectorId) {
        try {
          const existingConnector = await figma.getNodeByIdAsync(existingConnectorId);
          
          // If the stored connector still exists and is of type CONNECTOR
          if (existingConnector && existingConnector.type === 'CONNECTOR') {
            return {
              success: true,
              message: `Default connector is already set to: ${existingConnectorId}`,
              connectorId: existingConnectorId,
              exists: true
            };
          }
          // The stored connector is no longer valid - find a new connector
          else {
            console.log(`Stored connector ID ${existingConnectorId} is no longer valid, finding a new connector...`);
          }
        } catch (error) {
          console.log(`Error finding stored connector: ${error.message}. Will try to set a new one.`);
        }
      }
    } catch (error) {
      console.log(`Error checking for existing connector: ${error.message}`);
    }
    
    // If there is no stored default connector or it is invalid, find one in the current page
    try {
      // Find CONNECTOR type nodes in the current page
      const currentPageConnectors = figma.currentPage.findAllWithCriteria({ types: ['CONNECTOR'] });
      
      if (currentPageConnectors && currentPageConnectors.length > 0) {
        // Use the first connector found
        const foundConnector = currentPageConnectors[0];
        const autoFoundId = foundConnector.id;
        
        // Set the found connector as the default connector
        await figma.clientStorage.setAsync('defaultConnectorId', autoFoundId);
        
        return {
          success: true,
          message: `Automatically found and set default connector to: ${autoFoundId}`,
          connectorId: autoFoundId,
          autoSelected: true
        };
      } else {
        // If no connector is found in the current page, show a guide message
        throw new Error('No connector found in the current page. Please create a connector in Figma first or specify a connector ID.');
      }
    } catch (error) {
      // Error occurred while running findAllWithCriteria
      throw new Error(`Failed to find a connector: ${error.message}`);
    }
  }
}

async function createCursorNode(targetNodeId) {
  const svgString = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 8V35.2419L22 28.4315L27 39.7823C27 39.7823 28.3526 40.2722 29 39.7823C29.6474 39.2924 30.2913 38.3057 30 37.5121C28.6247 33.7654 25 26.1613 25 26.1613H32L16 8Z" fill="#202125" />
  </svg>`;
  try {
    const targetNode = await figma.getNodeByIdAsync(targetNodeId);
    if (!targetNode) throw new Error("Target node not found");

    // The targetNodeId has semicolons since it is a nested node.
    // So we need to get the parent node ID from the target node ID and check if we can appendChild to it or not.
    let parentNodeId = targetNodeId.includes(';') 
      ? targetNodeId.split(';')[0] 
      : targetNodeId;
    if (!parentNodeId) throw new Error("Could not determine parent node ID");

    // Find the parent node to append cursor node as child
    let parentNode = await figma.getNodeByIdAsync(parentNodeId);
    if (!parentNode) throw new Error("Parent node not found");

    // If the parent node is not eligible to appendChild, set the parentNode to the parent of the parentNode
    if (parentNode.type === 'INSTANCE' || parentNode.type === 'COMPONENT' || parentNode.type === 'COMPONENT_SET') {
      parentNode = parentNode.parent;
      if (!parentNode) throw new Error("Parent node not found");
    }

    // Create the cursor node
    const importedNode = await figma.createNodeFromSvg(svgString);
    if (!importedNode || !importedNode.id) {
      throw new Error("Failed to create imported cursor node");
    }
    importedNode.name = "TTF_Connector / Mouse Cursor";
    importedNode.resize(48, 48);

    const cursorNode = importedNode.findOne(node => node.type === 'VECTOR');
    if (cursorNode) {
      cursorNode.fills = [{
        type: 'SOLID',
        color: { r: 0, g: 0, b: 0 },
        opacity: 1
      }];
      cursorNode.strokes = [{
        type: 'SOLID',
        color: { r: 1, g: 1, b: 1 },
        opacity: 1
      }];
      cursorNode.strokeWeight = 2;
      cursorNode.strokeAlign = 'OUTSIDE';
      cursorNode.effects = [{
        type: "DROP_SHADOW",
        color: { r: 0, g: 0, b: 0, a: 0.3 },
        offset: { x: 1, y: 1 },
        radius: 2,
        spread: 0,
        visible: true,
        blendMode: "NORMAL"
      }];
    }

    // Append the cursor node to the parent node
    parentNode.appendChild(importedNode);

    // if the parentNode has auto-layout enabled, set the layoutPositioning to ABSOLUTE
    if ('layoutMode' in parentNode && parentNode.layoutMode !== 'NONE') {
      importedNode.layoutPositioning = 'ABSOLUTE';
    }

    // Adjust the importedNode's position to the targetNode's position
    if (
      targetNode.absoluteBoundingBox &&
      parentNode.absoluteBoundingBox
    ) {
      // if the targetNode has absoluteBoundingBox, set the importedNode's absoluteBoundingBox to the targetNode's absoluteBoundingBox
      console.log('targetNode.absoluteBoundingBox', targetNode.absoluteBoundingBox);
      console.log('parentNode.absoluteBoundingBox', parentNode.absoluteBoundingBox);
      importedNode.x = targetNode.absoluteBoundingBox.x - parentNode.absoluteBoundingBox.x  + targetNode.absoluteBoundingBox.width / 2 - 48 / 2
      importedNode.y = targetNode.absoluteBoundingBox.y - parentNode.absoluteBoundingBox.y + targetNode.absoluteBoundingBox.height / 2 - 48 / 2;
    } else if (
      'x' in targetNode && 'y' in targetNode && 'width' in targetNode && 'height' in targetNode) {
        // if the targetNode has x, y, width, height, calculate center based on relative position
        console.log('targetNode.x/y/width/height', targetNode.x, targetNode.y, targetNode.width, targetNode.height);
        importedNode.x = targetNode.x + targetNode.width / 2 - 48 / 2;
        importedNode.y = targetNode.y + targetNode.height / 2 - 48 / 2;
    } else {
      // Fallback: Place at top-left of target if possible, otherwise at (0,0) relative to parent
      if ('x' in targetNode && 'y' in targetNode) {
        console.log('Fallback to targetNode x/y');
        importedNode.x = targetNode.x;
        importedNode.y = targetNode.y;
      } else {
        console.log('Fallback to (0,0)');
        importedNode.x = 0;
        importedNode.y = 0;
      }
    }

    // get the importedNode ID and the importedNode
    console.log('importedNode', importedNode);


    return { id: importedNode.id, node: importedNode };
    
  } catch (error) {
    console.error("Error creating cursor from SVG:", error);
    return { id: null, node: null, error: error.message };
  }
}

async function createConnections(params) {
  if (!params || !params.connections || !Array.isArray(params.connections)) {
    throw new Error('Missing or invalid connections parameter');
  }
  
  const { connections } = params;
  
  // Command ID for progress tracking
  const commandId = generateCommandId();
  sendProgressUpdate(
    commandId,
    "create_connections",
    "started",
    0,
    connections.length,
    0,
    `Starting to create ${connections.length} connections`
  );
  
  // Get default connector ID from client storage
  const defaultConnectorId = await figma.clientStorage.getAsync('defaultConnectorId');
  if (!defaultConnectorId) {
    throw new Error('No default connector set. Please try one of the following options to create connections:\n1. Create a connector in FigJam and copy/paste it to your current page, then run the "set_default_connector" command.\n2. Select an existing connector on the current page, then run the "set_default_connector" command.');
  }
  
  // Get the default connector
  const defaultConnector = await figma.getNodeByIdAsync(defaultConnectorId);
  if (!defaultConnector) {
    throw new Error(`Default connector not found with ID: ${defaultConnectorId}`);
  }
  if (defaultConnector.type !== 'CONNECTOR') {
    throw new Error(`Node is not a connector: ${defaultConnectorId}`);
  }
  
  // Results array for connection creation
  const results = [];
  let processedCount = 0;
  const totalCount = connections.length;
  
  // Preload fonts (used for text if provided)
  let fontLoaded = false;
  
  for (let i = 0; i < connections.length; i++) {
    try {
      const { startNodeId: originalStartId, endNodeId: originalEndId, text } = connections[i];
      let startId = originalStartId;
      let endId = originalEndId;

      // Check and potentially replace start node ID
      if (startId.includes(';')) {
        console.log(`Nested start node detected: ${startId}. Creating cursor node.`);
        const cursorResult = await createCursorNode(startId);
        if (!cursorResult || !cursorResult.id) {
          throw new Error(`Failed to create cursor node for nested start node: ${startId}`);
        }
        startId = cursorResult.id; 
      }  
      
      const startNode = await figma.getNodeByIdAsync(startId);
      if (!startNode) throw new Error(`Start node not found with ID: ${startId}`);

      // Check and potentially replace end node ID
      if (endId.includes(';')) {
        console.log(`Nested end node detected: ${endId}. Creating cursor node.`);
        const cursorResult = await createCursorNode(endId);
        if (!cursorResult || !cursorResult.id) {
          throw new Error(`Failed to create cursor node for nested end node: ${endId}`);
        }
        endId = cursorResult.id;
      }
      const endNode = await figma.getNodeByIdAsync(endId);
      if (!endNode) throw new Error(`End node not found with ID: ${endId}`);

      
      // Clone the default connector
      const clonedConnector = defaultConnector.clone();
      
      // Update connector name using potentially replaced node names
      clonedConnector.name = `TTF_Connector/${startNode.id}/${endNode.id}`;
      
      // Set start and end points using potentially replaced IDs
      clonedConnector.connectorStart = {
        endpointNodeId: startId,
        magnet: 'AUTO'
      };
      
      clonedConnector.connectorEnd = {
        endpointNodeId: endId,
        magnet: 'AUTO'
      };
      
      // Add text (if provided)
      if (text) {
        try {
          // Try to load the necessary fonts
          try {
            // First check if default connector has font and use the same
            if (defaultConnector.text && defaultConnector.text.fontName) {
              const fontName = defaultConnector.text.fontName;
              await figma.loadFontAsync(fontName);
              clonedConnector.text.fontName = fontName;
            } else {
              // Try default Inter font
              await figma.loadFontAsync({ family: "Inter", style: "Regular" });
            }
          } catch (fontError) {
            // If first font load fails, try another font style
            try {
              await figma.loadFontAsync({ family: "Inter", style: "Medium" });
            } catch (mediumFontError) {
              // If second font fails, try system font
              try {
                await figma.loadFontAsync({ family: "System", style: "Regular" });
              } catch (systemFontError) {
                // If all font loading attempts fail, throw error
                throw new Error(`Failed to load any font: ${fontError.message}`);
              }
            }
          }
          
          // Set the text
          clonedConnector.text.characters = text;
        } catch (textError) {
          console.error("Error setting text:", textError);
          // Continue with connection even if text setting fails
          results.push({
            id: clonedConnector.id,
            startNodeId: startNodeId,
            endNodeId: endNodeId,
            text: "",
            textError: textError.message
          });
          
          // Continue to next connection
          continue;
        }
      }
      
      // Add to results (using the *original* IDs for reference if needed)
      results.push({
        id: clonedConnector.id,
        originalStartNodeId: originalStartId,
        originalEndNodeId: originalEndId,
        usedStartNodeId: startId, // ID actually used for connection
        usedEndNodeId: endId,     // ID actually used for connection
        text: text || ""
      });
      
      // Update progress
      processedCount++;
      sendProgressUpdate(
        commandId,
        "create_connections",
        "in_progress",
        processedCount / totalCount,
        totalCount,
        processedCount,
        `Created connection ${processedCount}/${totalCount}`
      );
      
    } catch (error) {
      console.error("Error creating connection", error);
      // Continue processing remaining connections even if an error occurs
      processedCount++;
      sendProgressUpdate(
        commandId,
        "create_connections",
        "in_progress",
        processedCount / totalCount,
        totalCount,
        processedCount,
        `Error creating connection: ${error.message}`
      );
      
      results.push({
        error: error.message,
        connectionInfo: connections[i]
      });
    }
  }
  
  // Completion update
  sendProgressUpdate(
    commandId,
    "create_connections",
    "completed",
    1,
    totalCount,
    totalCount,
    `Completed creating ${results.length} connections`
  );
  
  return {
    success: true,
    count: results.length,
    connections: results
  };
}

// Set focus on a specific node
async function setFocus(params) {
  if (!params || !params.nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(params.nodeId);
  if (!node) {
    throw new Error(`Node with ID ${params.nodeId} not found`);
  }

  // Set selection to the node
  figma.currentPage.selection = [node];
  
  // Scroll and zoom to show the node in viewport
  figma.viewport.scrollAndZoomIntoView([node]);

  return {
    success: true,
    name: node.name,
    id: node.id,
    message: `Focused on node "${node.name}"`
  };
}

// Set selection to multiple nodes
async function setSelections(params) {
  if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
    throw new Error("Missing or invalid nodeIds parameter");
  }

  if (params.nodeIds.length === 0) {
    throw new Error("nodeIds array cannot be empty");
  }

  // Get all valid nodes
  const nodes = [];
  const notFoundIds = [];
  
  for (const nodeId of params.nodeIds) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node) {
      nodes.push(node);
    } else {
      notFoundIds.push(nodeId);
    }
  }

  if (nodes.length === 0) {
    throw new Error(`No valid nodes found for the provided IDs: ${params.nodeIds.join(', ')}`);
  }

  // Set selection to the nodes
  figma.currentPage.selection = nodes;
  
  // Scroll and zoom to show all nodes in viewport
  figma.viewport.scrollAndZoomIntoView(nodes);

  const selectedNodes = nodes.map(node => ({
    name: node.name,
    id: node.id
  }));

  return {
    success: true,
    count: nodes.length,
    selectedNodes: selectedNodes,
    notFoundIds: notFoundIds,
    message: `Selected ${nodes.length} nodes${notFoundIds.length > 0 ? ` (${notFoundIds.length} not found)` : ''}`
  };
}

// ============================================================================
// R2.4 apply_batch — the generic batch operation contract
// ============================================================================

// talk-to-figma-batch-receipt-mirror:start
// ⛔ MIRROR of src/talk_to_figma_mcp/batch-receipt.mjs. Do not edit one copy alone.
//
// code.js runs in the Figma plugin sandbox as a single bundled file and cannot `import`,
// so "share the module" is not available here and the vocabulary has to exist twice.
// Finding 2 of the R2.4 audit is what three independent dialects of one concept cost, so
// the two copies are held together by a parity test rather than by convention: the test
// evaluates this block through the offline harness and compares every constant and every
// function's behaviour against the module. `utf8ByteLength` is deliberately NOT mirrored
// — the plugin already has its own from R2.3, and the parity test asserts the two
// independent implementations agree instead of adding a third.

const BATCH_OUTCOMES = Object.freeze([
  "all_succeeded",
  "partial",
  "all_failed",
  "prevalidated",
  "refused_prevalidation",
]);

const OPERATION_STATUSES = Object.freeze(["succeeded", "failed", "skipped"]);

const BATCH_ERROR_CODES = Object.freeze({
  DUPLICATE_OPERATION_ID: "duplicate_operation_id",
  OPERATION_NOT_ALLOWED: "operation_not_allowed",
  NODE_NOT_FOUND: "node_not_found",
  BUDGET_EXHAUSTED: "budget_exhausted",
  OPERATION_FAILED: "operation_failed",
  STOPPED_AFTER_FAILURE: "stopped_after_failure",
});

const V1_BATCH_OPERATIONS = Object.freeze([
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
]);

const EXCLUDED_BATCH_OPERATIONS = Object.freeze({
  create_rectangle: "v1 is mutate-only; creates arrive later as a new op kind",
  create_frame: "v1 is mutate-only; creates arrive later as a new op kind",
  create_text: "v1 is mutate-only; creates arrive later as a new op kind",
  create_section: "v1 is mutate-only; creates arrive later as a new op kind",
  create_page: "v1 is mutate-only; creates arrive later as a new op kind",
  create_component_instance:
    "v1 is mutate-only; creates arrive later as a new op kind",
  create_connections: "v1 is mutate-only; creates arrive later as a new op kind",
  // R2.7 Phase 2. Excluded on the mutate-only rule like every other create_*, and the plan
  // named the exclusion before the tool existed. ⚠️ It is also the create_* with the
  // strongest independent reason: the tool is NOT idempotent, so a retried batch would
  // duplicate whole subtrees rather than re-apply one field.
  create_node_from_svg:
    "v1 is mutate-only; creates arrive later as a new op kind — and this one duplicates its whole subtree on rerun, so a retried batch would multiply nodes",
  export_node_as_image:
    "binary payloads have their own bounded contract and belong nowhere near a 200-item receipt",
  join_channel: "connection plumbing stays distinct from document commands",
  get_runtime_info: "connection plumbing stays distinct from document commands",
  set_multiple_text_contents: "a batch of batches has no defined receipt",
  set_multiple_annotations: "a batch of batches has no defined receipt",
  delete_multiple_nodes: "a batch of batches has no defined receipt",
  // ⛔ R2.6 item 2.6 decided this BEFORE the tool existed, so landing it is not the
  // moment the question reopens. It would fit — mutate-only over an existing nodeId —
  // and that is exactly why the absence needs a reason on the record: allowlist parity
  // across both copies, receipt tests and a longer live gate are not owed until a
  // consumer asks for them.
  set_layout_child:
    "R2.6 2.6 keeps the layout tools out of v1 by decision; it would fit, but batch parity is not owed until a consumer asks",
  // ⛔ Second of the four, same decision, and it is worth noting that this one would fit
  // BETTER than any op already on the allowlist: it is a single object assignment, so it
  // is the one layout op that could never land in `NON_ATOMIC_BATCH_OPERATIONS`. Fitting
  // well is not the criterion — 2.6 decided the set, not the members.
  set_constraints:
    "R2.6 2.6 keeps the layout tools out of v1 by decision; it would fit, but batch parity is not owed until a consumer asks",
  // ⛔ Third of the four, same decision — and the exact OPPOSITE case from its neighbour
  // above. `set_constraints` could never have landed in `NON_ATOMIC_BATCH_OPERATIONS`;
  // this one would have to be evaluated for it, because it writes up to four independent
  // number properties. It is validate-all-then-write from birth, so today it would qualify
  // as atomic — but that is a property a future edit could quietly lose, and the entry
  // would then be wrong in the direction that under-warns.
  set_size_limits:
    "R2.6 2.6 keeps the layout tools out of v1 by decision; it would fit, but batch parity is not owed until a consumer asks",
  // ⛔ FOURTH AND LAST, which COMPLETES the set 2.6 decided — and the completion is the
  // point. The decision named four tools before any of them existed; four entries now
  // carry it. A set that was decided as a whole and lands three-quarters honoured is
  // indistinguishable from one where somebody forgot the last one.
  // ⚠️ This is the strongest fit of all four and still excluded: a single boolean
  // assignment cannot partially apply under any future edit, so unlike `set_size_limits`
  // its atomicity is structural rather than maintained. Fitting well has never been the
  // criterion — 2.6 decided the SET, not the members.
  set_clips_content:
    "R2.6 2.6 keeps the layout tools out of v1 by decision; it would fit, but batch parity is not owed until a consumer asks",
  // ⛔ R2.7 1.1. CC8 holds the allowlist at 15 ops for all three sub-releases, and D3
  // defers any extension to after R2 acceptance — so this is the rule applying, not a
  // judgement about the tool.
  // ⚠️ AND IT IS THE ONE ENTRY WHERE ADMITTING THE TOOL WOULD BE ACTIVELY HARMFUL. The
  // allowlist already carries `set_fill_color`, whose batch shape (`{color:{r,g,b,a}}`)
  // diverges from its own standalone shape (flat `r,g,b,a`) — the defect R2.4's gate caught
  // and the defect `set_fill` exists to stop spreading. Adding a SECOND fill op to the same
  // allowlist would put two different paint shapes behind one batch surface, which is the
  // original divergence with an extra participant.
  set_fill:
    "CC8 holds the v1 allowlist at 15 ops through R2.7; and admitting it would put a second, different paint shape alongside set_fill_color's in one batch surface — the divergence this tool exists to end",
  // R2.7 1.2. Same release-wide CC8 rule as set_fill: the v1 allowlist stays frozen at
  // 15 until R2 acceptance, so a batch receipt and parity work are not silently owed here.
  set_effects:
    "CC8 holds the v1 allowlist at 15 ops through R2.7; effect batching and its receipt contract are deferred until a consumer asks",
  // R2.7 1.3. Both are single-property writes and would fit v1 mechanically. That is not
  // enough: CC8 froze the set at 15 through R2 acceptance, and admitting them would create
  // a batch receipt surface that this item neither designs nor gates.
  set_opacity:
    "CC8 holds the v1 allowlist at 15 ops through R2.7; layer-opacity batching and its receipt contract are deferred until a consumer asks",
  set_blend_mode:
    "CC8 holds the v1 allowlist at 15 ops through R2.7; layer-blend-mode batching and its receipt contract are deferred until a consumer asks",
});

const NON_ATOMIC_BATCH_OPERATIONS = Object.freeze({
  set_stroke_color:
    "proven: writes strokes, then the platform rejects a non-numeric strokeWeight",
  move_node: "proven: writes x, then the platform rejects a non-numeric y",
  set_layout_mode: "writes layoutMode, then layoutWrap, with no rollback",
  set_padding: "writes up to four padding fields in sequence, with no rollback",
  set_corner_radius: "writes up to four corner radii in sequence, with no rollback",
  set_parent: "reparents the node, then writes its position, with no rollback",
});

function partialApplicationPossible(op) {
  return Object.prototype.hasOwnProperty.call(NON_ATOMIC_BATCH_OPERATIONS, op);
}

function classifyOutcome(counts) {
  const {
    total,
    succeeded,
    failed,
    skipped,
    refusedPrevalidation,
    prevalidateOnly,
  } = counts;

  if (!Number.isInteger(total) || total < 1) {
    throw new Error("a batch outcome requires at least one operation");
  }
  if (succeeded + failed + skipped !== total) {
    throw new Error(
      `operation counts do not sum to total: ${succeeded}+${failed}+${skipped} !== ${total}`,
    );
  }

  if (refusedPrevalidation) return "refused_prevalidation";
  if (prevalidateOnly) return "prevalidated";

  if (succeeded === total) return "all_succeeded";
  if (succeeded === 0) return "all_failed";
  return "partial";
}

function summarizeOperations(operations, options) {
  const settings = options || {};
  const counts = { total: operations.length, succeeded: 0, failed: 0, skipped: 0 };

  for (const operation of operations) {
    if (OPERATION_STATUSES.indexOf(operation.status) === -1) {
      throw new Error(`unknown operation status ${JSON.stringify(operation.status)}`);
    }
    counts[operation.status] += 1;
  }

  return Object.assign(
    {
      outcome: classifyOutcome(
        Object.assign({}, counts, {
          refusedPrevalidation: settings.refusedPrevalidation,
          prevalidateOnly: settings.prevalidateOnly,
        }),
      ),
    },
    counts,
  );
}

function duplicateOperationIds(operations) {
  const seen = new Set();
  const duplicates = new Set();
  for (const operation of operations) {
    if (seen.has(operation.id)) duplicates.add(operation.id);
    seen.add(operation.id);
  }
  return [...duplicates];
}

function disallowedOperations(operations) {
  return operations
    .filter((operation) => V1_BATCH_OPERATIONS.indexOf(operation.op) === -1)
    .map((operation) => ({
      id: operation.id,
      op: operation.op,
      reason:
        EXCLUDED_BATCH_OPERATIONS[operation.op] ||
        "not a v1 batch operation; see V1_BATCH_OPERATIONS",
    }));
}

function truncateResult(result, maxResultBytes) {
  if (result === undefined) {
    return { result: null, bytes: 0, truncated: false };
  }

  const encoded = JSON.stringify(result);
  const bytes = utf8ByteLength(encoded);
  if (bytes <= maxResultBytes) {
    return { result, bytes, truncated: false };
  }

  return {
    result: encoded.slice(0, Math.max(0, maxResultBytes)),
    bytes,
    truncated: true,
  };
}

// The parity test's single entry point. A `vm` context exposes function declarations but
// not `const` bindings, so the values are unreachable without this.
function batchVocabulary() {
  return {
    BATCH_OUTCOMES,
    OPERATION_STATUSES,
    BATCH_ERROR_CODES,
    V1_BATCH_OPERATIONS,
    EXCLUDED_BATCH_OPERATIONS,
    NON_ATOMIC_BATCH_OPERATIONS,
    partialApplicationPossible,
    classifyOutcome,
    summarizeOperations,
    duplicateOperationIds,
    disallowedOperations,
    truncateResult,
    utf8ByteLength,
  };
}
// talk-to-figma-batch-receipt-mirror:end

// D6 bounds this three ways: a ceiling on the operation count refused at schema level, a
// total wall-clock budget, and per-operation result truncation. The budget ceiling is
// lower than the server's transport timeout on purpose, so the batch's own budget always
// fires first and the caller gets an honest receipt instead of a transport error.
const BATCH_MAX_OPERATIONS = 200;
const BATCH_DEFAULT_TIME_BUDGET_MS = 60000;
const BATCH_MAX_TIME_BUDGET_MS = 240000;
const BATCH_DEFAULT_MAX_RESULT_BYTES = 2000;

// 3.1 / 3.2. Chunk size matches the three shipped batch tools so one mental model covers
// all four. The pause between chunks does NOT: theirs is a hard 1 s that costs 19 s on a
// 100-item batch and was never measured. Here it defaults to 0 and is a caller-tunable
// yield — the live gate's job is to prove 0 keeps the plugin responsive, which is a
// falsifiable claim in a way "sleep a second and hope" never was.
const BATCH_CHUNK_SIZE = 5;
const BATCH_DEFAULT_CHUNK_PAUSE_MS = 0;
const BATCH_MAX_CHUNK_PAUSE_MS = 5000;

/**
 * Phase 4.1 — the unified aggregate for the three shipped batch tools, built from the
 * SAME mirrored vocabulary `apply_batch` uses, so a fourth dialect cannot appear.
 *
 * ⛔ Purely additive. The caller's `success`, `nodesDeleted`, `replacementsApplied`,
 * `annotationsApplied` and every `total*` spelling keep their exact current meaning —
 * including `success: successCount > 0`, which is Finding 1 and is now documented as
 * legacy rather than silently corrected. `outcome` is the field that cannot lie.
 *
 * The vacuous case is explicit rather than thrown: `set_multiple_text_contents` accepts
 * an empty `text` array today, and adding a field must not add a failure mode to a tool
 * that already shipped.
 */
function legacyBatchSummary(successCount, failureCount) {
  const total = successCount + failureCount;
  if (total === 0) {
    return { outcome: "all_succeeded", total: 0, succeeded: 0, failed: 0, skipped: 0 };
  }
  const operations = [];
  for (let index = 0; index < successCount; index++) operations.push({ status: "succeeded" });
  for (let index = 0; index < failureCount; index++) operations.push({ status: "failed" });
  return summarizeOperations(operations);
}

// The v1 allowlist bound to the handlers that implement it. Built on call rather than at
// load so it never depends on declaration order, and asserted against V1_BATCH_OPERATIONS
// by a test — an allowlist entry with no handler would otherwise fail at runtime only.
function batchOperationHandlers() {
  return {
    delete_node: deleteNode,
    move_node: moveNode,
    rename_node: renameNode,
    resize_node: resizeNode,
    set_axis_align: setAxisAlign,
    set_corner_radius: setCornerRadius,
    set_fill_color: setFillColor,
    set_item_spacing: setItemSpacing,
    set_layout_mode: setLayoutMode,
    set_layout_sizing: setLayoutSizing,
    set_padding: setPadding,
    set_parent: setParent,
    set_plugin_data: setPluginData,
    set_stroke_color: setStrokeColor,
    set_text_content: setTextContent,
  };
}

/**
 * Apply many node mutations in one call, against node IDs that already exist.
 *
 * The envelope is validated, then every target is resolved in one total pass that writes
 * nothing (D1), then the resolved operations execute in order. Envelope violations throw
 * — a duplicate `id` makes the receipt's correlation undefined and an unknown `op` has no
 * entry shape, so neither can be reported inside the structure it breaks. Everything
 * below that is reported in a typed receipt.
 */
async function applyBatch(params) {
  const settings = params || {};
  const operations = settings.operations;
  const onError = settings.onError === undefined ? "stop" : settings.onError;
  const prevalidateOnly = settings.prevalidateOnly === true;
  const maxResultBytes =
    settings.maxResultBytes === undefined
      ? BATCH_DEFAULT_MAX_RESULT_BYTES
      : settings.maxResultBytes;
  const timeBudgetMs =
    settings.timeBudgetMs === undefined
      ? BATCH_DEFAULT_TIME_BUDGET_MS
      : settings.timeBudgetMs;
  const chunkPauseMs =
    settings.chunkPauseMs === undefined
      ? BATCH_DEFAULT_CHUNK_PAUSE_MS
      : settings.chunkPauseMs;
  const commandId = settings.commandId || generateCommandId();

  // ---- envelope: refusals that cannot be expressed as a receipt ----
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("operations must be a non-empty array");
  }
  if (operations.length > BATCH_MAX_OPERATIONS) {
    throw new Error(
      `operations has ${operations.length} entries, above the ${BATCH_MAX_OPERATIONS} per-batch ceiling`,
    );
  }
  if (onError !== "stop" && onError !== "continue") {
    throw new Error(`onError must be "stop" or "continue", received ${JSON.stringify(onError)}`);
  }
  if (
    typeof timeBudgetMs !== "number" ||
    !Number.isFinite(timeBudgetMs) ||
    timeBudgetMs < 1000 ||
    timeBudgetMs > BATCH_MAX_TIME_BUDGET_MS
  ) {
    throw new Error(
      `timeBudgetMs must be between 1000 and ${BATCH_MAX_TIME_BUDGET_MS} ms, received ${JSON.stringify(timeBudgetMs)}`,
    );
  }
  if (typeof maxResultBytes !== "number" || !Number.isFinite(maxResultBytes) || maxResultBytes < 0) {
    throw new Error(
      `maxResultBytes must be a non-negative number, received ${JSON.stringify(maxResultBytes)}`,
    );
  }
  if (
    typeof chunkPauseMs !== "number" ||
    !Number.isFinite(chunkPauseMs) ||
    chunkPauseMs < 0 ||
    chunkPauseMs > BATCH_MAX_CHUNK_PAUSE_MS
  ) {
    throw new Error(
      `chunkPauseMs must be between 0 and ${BATCH_MAX_CHUNK_PAUSE_MS} ms, received ${JSON.stringify(chunkPauseMs)}`,
    );
  }
  for (const operation of operations) {
    if (!operation || typeof operation.id !== "string" || operation.id.length === 0) {
      throw new Error("every operation requires a non-empty caller-supplied id");
    }
    if (typeof operation.nodeId !== "string" || operation.nodeId.length === 0) {
      throw new Error(`operation ${operation.id} requires a nodeId`);
    }
    if (operation.params !== undefined && (typeof operation.params !== "object" || operation.params === null || Array.isArray(operation.params))) {
      throw new Error(`operation ${operation.id} params must be an object`);
    }
  }

  const duplicates = duplicateOperationIds(operations);
  if (duplicates.length > 0) {
    throw new Error(
      `${BATCH_ERROR_CODES.DUPLICATE_OPERATION_ID}: receipts correlate by id, so ids must be unique. Repeated: ${duplicates.join(", ")}`,
    );
  }

  const disallowed = disallowedOperations(operations);
  if (disallowed.length > 0) {
    const detail = disallowed
      .map((entry) => `${entry.id} (${entry.op}: ${entry.reason})`)
      .join("; ");
    throw new Error(`${BATCH_ERROR_CODES.OPERATION_NOT_ALLOWED}: ${detail}`);
  }

  const startedAt = Date.now();

  // 3.1. The resolve pass is a real await per operation, so it is inside the reported
  // work rather than before it — 200 targets on a cold page is not instant.
  await sendProgressUpdate(
    commandId,
    "apply_batch",
    "started",
    0,
    operations.length,
    0,
    `Resolving ${operations.length} target${operations.length === 1 ? "" : "s"}`,
    { chunkSize: BATCH_CHUNK_SIZE, currentChunk: 0, totalChunks: Math.ceil(operations.length / BATCH_CHUNK_SIZE) }
  );

  // ---- 2.1 / 2.2 prevalidation: resolve every target, write nothing ----
  const resolved = [];
  const unresolved = [];
  const unresolvedIds = new Set();
  for (const operation of operations) {
    const node = await figma.getNodeByIdAsync(operation.nodeId);
    if (!node) {
      unresolved.push({
        id: operation.id,
        nodeId: operation.nodeId,
        reason: BATCH_ERROR_CODES.NODE_NOT_FOUND,
      });
      unresolvedIds.add(operation.id);
      continue;
    }
    resolved.push({
      id: operation.id,
      nodeId: node.id,
      name: node.name,
      type: node.type,
      // D7: the caller sees the blast radius before anything is mutated. null rather
      // than 0 for a leaf, because "cannot have children" is not "has none". Note this
      // counts DIRECT children — a delete takes the whole subtree with it.
      childCount: "children" in node ? node.children.length : null,
    });
  }

  const refusedPrevalidation = unresolved.length > 0 && onError === "stop";
  const prevalidation = { resolved, unresolved };

  const baseReceipt = (operation) => ({
    id: operation.id,
    op: operation.op,
    nodeId: operation.nodeId,
  });

  // ---- 2.3 dry run / 2.4 atomic refusal: both write nothing ----
  if (refusedPrevalidation || prevalidateOnly) {
    const receipts = operations.map((operation) => {
      const receipt = Object.assign(baseReceipt(operation), { status: "skipped" });
      if (unresolvedIds.has(operation.id)) {
        receipt.error = {
          code: BATCH_ERROR_CODES.NODE_NOT_FOUND,
          message: `Node not found with ID: ${operation.nodeId}`,
        };
      }
      return receipt;
    });

    // Both paths are a completed unit of work, not an abandoned one — the caller asked a
    // question and got a total answer, so the progress stream has to close.
    await sendProgressUpdate(
      commandId,
      "apply_batch",
      "completed",
      100,
      operations.length,
      operations.length,
      refusedPrevalidation
        ? `Refused: ${unresolved.length} target${unresolved.length === 1 ? "" : "s"} unresolvable under onError "stop"`
        : `Prevalidated ${operations.length} operation${operations.length === 1 ? "" : "s"}, nothing written`,
      { chunkSize: BATCH_CHUNK_SIZE, currentChunk: 0, totalChunks: 0 }
    );

    return Object.assign(
      summarizeOperations(receipts, { refusedPrevalidation, prevalidateOnly }),
      {
        onError,
        prevalidateOnly,
        prevalidation,
        operations: receipts,
        timing: { startedAt, elapsedMs: Date.now() - startedAt, budgetExhausted: false },
        // A refusal and a dry run are both final, total decisions: every operation
        // reached the answer the caller asked for. Only an interrupted run is incomplete.
        complete: true,
      },
    );
  }

  // ---- the executor: 3.3 budget, 3.4 stop/continue, 3.5 truncation ----
  const handlers = batchOperationHandlers();
  const receipts = [];
  let budgetExhausted = false;
  let stopped = false;

  // 3.1. Chunked so the Figma UI gets a breath and the caller gets progress; the chunk is
  // a reporting and yielding unit only — every decision below is still per operation.
  const chunks = [];
  for (let index = 0; index < operations.length; index += BATCH_CHUNK_SIZE) {
    chunks.push(operations.slice(index, index + BATCH_CHUNK_SIZE));
  }

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    // 3.2. Between chunks only, never before the first, and CLAMPED to what is left of
    // the budget. Skipping the pause only once the budget is already spent would still
    // let a 5 s pause overshoot a 6 s budget by 4 s, which would make "timeBudgetMs is
    // the total ceiling" false — the exact class of claim Finding 5 was about.
    if (chunkIndex > 0 && chunkPauseMs > 0 && !budgetExhausted) {
      const remainingMs = timeBudgetMs - (Date.now() - startedAt);
      if (remainingMs > 0) await delay(Math.min(chunkPauseMs, remainingMs));
    }

    for (const operation of chunks[chunkIndex]) {
      const receipt = baseReceipt(operation);

      if (unresolvedIds.has(operation.id)) {
        // Only reachable under "continue" — "stop" refused above without writing.
        receipt.status = "skipped";
        receipt.error = {
          code: BATCH_ERROR_CODES.NODE_NOT_FOUND,
          message: `Node not found with ID: ${operation.nodeId}`,
        };
        receipts.push(receipt);
        continue;
      }

      if (stopped) {
        receipt.status = "skipped";
        receipt.error = {
          code: BATCH_ERROR_CODES.STOPPED_AFTER_FAILURE,
          message: 'not attempted: an earlier operation failed under onError: "stop"',
        };
        receipts.push(receipt);
        continue;
      }

      // Checked before starting, never mid-operation: stopping halfway through a write is
      // the partial application this contract already has to declare, not add to.
      if (budgetExhausted || Date.now() - startedAt >= timeBudgetMs) {
        budgetExhausted = true;
        receipt.status = "skipped";
        receipt.error = {
          code: BATCH_ERROR_CODES.BUDGET_EXHAUSTED,
          message: `not attempted: the ${timeBudgetMs} ms total budget was exhausted`,
        };
        receipts.push(receipt);
        continue;
      }

      try {
        // The envelope's nodeId wins over anything of the same name inside params: it is
        // the field prevalidation resolved, so the executed target must be the reported one.
        const handlerParams = Object.assign({}, operation.params, {
          nodeId: operation.nodeId,
        });
        const raw = await handlers[operation.op](handlerParams);
        const truncated = truncateResult(raw, maxResultBytes);
        receipt.status = "succeeded";
        receipt.result = truncated.result;
        receipt.resultBytes = truncated.bytes;
        receipt.resultTruncated = truncated.truncated;
      } catch (error) {
        receipt.status = "failed";
        receipt.error = {
          code: BATCH_ERROR_CODES.OPERATION_FAILED,
          message: (error && error.message) || String(error),
        };
        // ⛔ Per-operation atomicity is FALSE for the six ops listed in the mirror above,
        // two of them proven. A failed receipt does NOT imply an unchanged document, so
        // say which case this is rather than let a caller assume its request was a no-op.
        receipt.partialApplicationPossible = partialApplicationPossible(operation.op);
        if (receipt.partialApplicationPossible) {
          receipt.partialApplicationReason = NON_ATOMIC_BATCH_OPERATIONS[operation.op];
        }
        if (onError === "stop") stopped = true;
      }

      receipts.push(receipt);
    }

    // ⚠️ Finding 5 stays closed BECAUSE of what this update does not do. It resets the
    // server's inactivity timer, exactly as the shipped tools' updates do — the reason
    // that is safe here is that `timeBudgetMs` is enforced plugin-side and capped at
    // BATCH_MAX_TIME_BUDGET_MS, so the run has a real total ceiling no reset can extend.
    // ⛔ Never make the pause or the chunk loop skip that check.
    await sendProgressUpdate(
      commandId,
      "apply_batch",
      chunkIndex === chunks.length - 1 ? "completed" : "in_progress",
      Math.round(((chunkIndex + 1) / chunks.length) * 100),
      operations.length,
      receipts.length,
      `Applied ${receipts.length}/${operations.length} operations`,
      {
        chunkSize: BATCH_CHUNK_SIZE,
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
      }
    );
  }

  return Object.assign(
    summarizeOperations(receipts, { refusedPrevalidation: false, prevalidateOnly: false }),
    {
      onError,
      prevalidateOnly,
      prevalidation,
      operations: receipts,
      timing: { startedAt, elapsedMs: Date.now() - startedAt, budgetExhausted },
      // Honest incompleteness, the get_node_variables shape: false whenever operations
      // were never attempted because the run was cut short, rather than decided.
      complete: !budgetExhausted && !stopped,
    },
  );
}
