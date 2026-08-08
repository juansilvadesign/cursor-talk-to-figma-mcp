import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createFixtureRuntime(fixture, options) {
  const nodes = new Map();
  const messages = [];
  const notifications = [];
  const storage = new Map();
  const clock = { now: 0 };
  let dynamicId = 1;

  const containers = new Set([
    "DOCUMENT",
    "PAGE",
    "FRAME",
    "GROUP",
    "SECTION",
    "COMPONENT",
    "COMPONENT_SET",
    "INSTANCE",
  ]);

  function serializeNode(node) {
    const result = {};
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "parent" ||
        key === "children" ||
        key === "loadMs" ||
        typeof value === "function"
      ) {
        continue;
      }
      result[key] = clone(value);
    }
    if (Array.isArray(node.children)) {
      result.children = node.children.map(serializeNode);
    }
    return result;
  }

  function unregister(node) {
    nodes.delete(node.id);
    for (const child of node.children || []) unregister(child);
  }

  function detach(node) {
    if (!node.parent?.children) return;
    const index = node.parent.children.indexOf(node);
    if (index !== -1) node.parent.children.splice(index, 1);
  }

  function appendChild(parent, child, index = parent.children.length) {
    detach(child);
    child.parent = parent;
    parent.children.splice(Math.max(0, Math.min(index, parent.children.length)), 0, child);
  }

  function descendants(node) {
    const result = [];
    for (const child of node.children || []) {
      result.push(child, ...descendants(child));
    }
    return result;
  }

  function makeNode(raw, parent = null) {
    const node = {
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fills: [],
      strokes: [],
      effects: [],
      layoutGrids: [],
      cornerRadius: 0,
      layoutMode: "NONE",
      layoutWrap: "NO_WRAP",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
      itemSpacing: 0,
      ...clone(raw),
      parent,
    };
    if (!node.type) node.type = "RECTANGLE";
    if (containers.has(node.type)) node.children = [];
    else delete node.children;

    node.resize = (width, height) => {
      node.width = width;
      node.height = height;
    };
    node.resizeWithoutConstraints = node.resize;
    node.remove = () => {
      detach(node);
      unregister(node);
    };
    node.exportAsync = async (settings) => {
      if (settings?.format === "JSON_REST_V1") {
        return { document: serializeNode(node) };
      }
      return Uint8Array.from([137, 80, 78, 71]);
    };
    node.getRangeFontName = () => node.fontName;
    node.setRangeFontName = () => undefined;
    node.setRangeFills = () => undefined;
    node.findAll = (predicate) => descendants(node).filter(predicate);
    node.findAllWithCriteria = ({ types }) =>
      descendants(node).filter((candidate) => types.includes(candidate.type));

    if (containers.has(node.type)) {
      node.appendChild = (child) => appendChild(node, child);
      node.insertChild = (index, child) => appendChild(node, child, index);
    }
    if (node.type === "PAGE") {
      node.loadAsync = async () => {
        clock.now += Number(node.loadMs || 0);
      };
      node.selection = [];
    }
    if (node.type === "COMPONENT") {
      node.createInstance = () => {
        const instance = createDynamicNode("INSTANCE", node.name);
        instance.mainComponent = node;
        instance.getMainComponentAsync = async () => node;
        return instance;
      };
    }

    nodes.set(node.id, node);
    for (const childRaw of raw.children || []) {
      const child = makeNode(childRaw, node);
      node.children.push(child);
    }
    return node;
  }

  const rootNode = makeNode(
    {
      ...fixture.document,
      type: "DOCUMENT",
      children: fixture.pages.map((page) => ({ ...page, type: "PAGE" })),
    },
    null,
  );

  let currentPage = nodes.get(fixture.currentPageId);

  function createDynamicNode(type, name) {
    const raw = {
      id: `900:${dynamicId++}`,
      type,
      name,
      children: containers.has(type) ? [] : undefined,
    };
    if (type === "TEXT") {
      raw.characters = "";
      raw.fontName = { family: "Inter", style: "Regular" };
      raw.fontSize = 14;
    }
    const node = makeNode(raw);
    appendChild(currentPage, node);
    return node;
  }

  const collections = fixture.variables.collections.map((item) => clone(item));
  const variables = fixture.variables.items.map((item) => {
    const variable = clone(item);
    variable.resolveForConsumer = () => {
      const collection = collections.find(
        (candidate) => candidate.id === variable.variableCollectionId,
      );
      let value = variable.valuesByMode[collection.defaultModeId];
      const visited = new Set([variable.id]);
      while (value?.type === "VARIABLE_ALIAS") {
        if (visited.has(value.id)) throw new Error("Variable alias cycle");
        visited.add(value.id);
        const target = variables.find((candidate) => candidate.id === value.id);
        if (!target) throw new Error(`Missing alias ${value.id}`);
        value = target.valuesByMode[collection.defaultModeId];
      }
      return { value: clone(value), resolvedType: variable.resolvedType };
    };
    return variable;
  });
  const styles = fixture.styles;
  const allStyles = Object.values(styles).flat();

  const figma = {
    editorType: "figma",
    root: rootNode,
    mixed: Symbol("mixed"),
    showUI: () => undefined,
    closePlugin: () => undefined,
    notify: (message) => notifications.push(message),
    on: () => undefined,
    ui: { postMessage: (message) => messages.push(clone(message)) },
    clientStorage: {
      getAsync: async (key) => storage.get(key),
      setAsync: async (key, value) => storage.set(key, clone(value)),
    },
    getNodeByIdAsync: async (id) => nodes.get(id) || null,
    setCurrentPageAsync: async (page) => {
      currentPage = page;
    },
    loadFontAsync: async () => undefined,
    createRectangle: () => createDynamicNode("RECTANGLE", "Rectangle"),
    createFrame: () => createDynamicNode("FRAME", "Frame"),
    createText: () => createDynamicNode("TEXT", "Text"),
    createSection: () => createDynamicNode("SECTION", "Section"),
    createImage: (bytes) => ({
      hash: `image-${bytes.length}`,
      getSizeAsync: async () => ({ width: 2, height: 2 }),
    }),
    base64Decode: (value) => Uint8Array.from(Buffer.from(value, "base64")),
    importComponentByKeyAsync: async (key) =>
      [...nodes.values()].find(
        (node) => node.type === "COMPONENT" && node.key === key,
      ) || null,
    viewport: {
      scrollAndZoomIntoView: () => undefined,
      center: { x: 0, y: 0 },
    },
    getLocalPaintStylesAsync: async () => {
      if (options.styleLoaderErrors?.includes("colors")) throw new Error("paint styles unavailable");
      return clone(styles.colors);
    },
    getLocalTextStylesAsync: async () => {
      if (options.styleLoaderErrors?.includes("texts")) throw new Error("text styles unavailable");
      return clone(styles.texts);
    },
    getLocalEffectStylesAsync: async () => {
      if (options.styleLoaderErrors?.includes("effects")) throw new Error("effect styles unavailable");
      return clone(styles.effects);
    },
    getLocalGridStylesAsync: async () => {
      if (options.styleLoaderErrors?.includes("grids")) throw new Error("grid styles unavailable");
      return clone(styles.grids);
    },
    getStyleByIdAsync: async (id) => clone(allStyles.find((style) => style.id === id)) || null,
    getAnnotationCategoriesAsync: async () => [],
  };

  Object.defineProperty(figma, "currentPage", {
    get: () => currentPage,
  });

  if (options.variablesApi === false) {
    figma.variables = undefined;
  } else {
    figma.variables = {
      getLocalVariablesAsync: async (type) => {
        if (options.variableTypeErrors?.includes(type)) {
          throw new Error(`${type} variables unavailable`);
        }
        return variables.filter((variable) => variable.resolvedType === type);
      },
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableByIdAsync: async (id) =>
        variables.find((variable) => variable.id === id) || null,
      getVariableCollectionByIdAsync: async (id) =>
        collections.find((collection) => collection.id === id) || null,
    };
  }
  if (options.stylesApi === false) {
    delete figma.getStyleByIdAsync;
  }

  return {
    figma,
    nodes,
    messages,
    notifications,
    clock,
    plain: clone,
  };
}

export async function loadPluginHarness(options = {}) {
  const [pluginSource, fixtureText] = await Promise.all([
    readFile(path.join(root, "src/cursor_mcp_plugin/code.js"), "utf8"),
    readFile(path.join(root, "tests/fixtures/small-document.json"), "utf8"),
  ]);
  const runtime = createFixtureRuntime(JSON.parse(fixtureText), options);

  class FakeDate extends Date {
    static now() {
      return runtime.clock.now;
    }
  }

  let timerId = 0;
  const timers = new Map();
  const context = vm.createContext({
    figma: runtime.figma,
    __html__: "<html></html>",
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    Buffer,
    Uint8Array,
    Date: FakeDate,
    setTimeout(callback, delay = 0) {
      const id = ++timerId;
      timers.set(id, callback);
      if (delay === 0) queueMicrotask(() => {
        if (timers.delete(id)) callback();
      });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback) {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
  });
  vm.runInContext(pluginSource, context, {
    filename: "src/cursor_mcp_plugin/code.js",
  });

  return {
    async command(name, params = {}) {
      return runtime.plain(await context.handleCommand(name, params));
    },
    getNode(id) {
      return runtime.nodes.get(id) || null;
    },
    messages: runtime.messages,
    notifications: runtime.notifications,
    advanceClock(milliseconds) {
      runtime.clock.now += milliseconds;
    },
  };
}
