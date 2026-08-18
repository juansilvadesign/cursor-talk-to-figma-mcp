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

// Figma's `figma.mixed` is a unique symbol, and that is the whole point: it cannot
// survive `JSON.stringify`, cannot be compared structurally, and cannot be unwrapped by
// an API that expects `{family, style}`. Declared at module scope because fixture nodes
// are built before the `figma` object exists.
const MIXED = Symbol("mixed");

function fontKey(font) {
  return `${font.family}::${font.style}`;
}

// Real `getRangeFontName` answers `figma.mixed` whenever the requested range spans more
// than one font, and a concrete `{family, style}` when it does not. Modelling only the
// first half would let a test pass by reading a symbol where Figma returns a font.
function rangeFontFor(ranges, start, end) {
  const covering = ranges.filter((range) => range.start < end && range.end > start);
  if (covering.length === 0) return null;
  const distinct = new Set(covering.map(fontKey));
  if (distinct.size > 1) return MIXED;
  return { family: covering[0].family, style: covering[0].style };
}

function createFixtureRuntime(fixture, options) {
  const nodes = new Map();
  const messages = [];
  const notifications = [];
  const exportCalls = [];
  const fontLoads = [];
  const loadedFonts = new Set();
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
      exportCalls.push({ nodeId: node.id, settings: clone(settings) });
      if (settings?.format === "JSON_REST_V1") {
        return { document: serializeNode(node) };
      }
      if (options.exportError) throw new Error(options.exportError);
      if (options.exportBytes) return Uint8Array.from(options.exportBytes);
      return Uint8Array.from([137, 80, 78, 71]);
    };
    // A fixture declares `fontRanges` to model a genuinely mixed text node. Without
    // this the harness could only ever build single-font text, which is exactly why no
    // offline test could reach the mixed-font defect.
    if (Array.isArray(node.fontRanges) && node.fontRanges.length > 0) {
      const ranges = node.fontRanges;
      const distinct = new Set(ranges.map(fontKey));
      if (distinct.size > 1) node.fontName = MIXED;
      else node.fontName = { family: ranges[0].family, style: ranges[0].style };
      node.getRangeFontName = (start, end) => rangeFontFor(ranges, start, end);
      node.setRangeFontName = (start, end, font) => {
        ranges.length = 0;
        ranges.push({ start, end, family: font.family, style: font.style });
      };
    } else {
      node.getRangeFontName = () => node.fontName;
      node.setRangeFontName = () => undefined;
    }
    // Figma refuses to write characters while the node's font is unloaded. Opt-in,
    // because turning it on globally would change the meaning of every existing text
    // fixture rather than adding a case to them.
    if (node.type === "TEXT" && options.strictFontLoading) {
      let characters = node.characters;
      Object.defineProperty(node, "characters", {
        enumerable: true,
        configurable: true,
        get: () => characters,
        set: (value) => {
          // Figma can refuse a character write for reasons of its own, with the font
          // perfectly loaded. Modelled as an explicit opt-in so a test can ask what the
          // plugin *reports* when a write is refused, without pretending to know how
          // often Figma actually refuses.
          if ((options.refuseCharacterWrite || []).includes(node.id)) {
            throw new Error("Cannot write to node: refused");
          }
          const font = node.fontName;
          if (font === MIXED || !font || !loadedFonts.has(fontKey(font))) {
            throw new Error(
              `Cannot write to node with unloaded font "${
                font === MIXED ? "mixed" : font && font.family
              }"`,
            );
          }
          characters = value;
        },
      });
    }
    node.setRangeFills = () => undefined;
    node.findAll = (predicate) => descendants(node).filter(predicate);
    node.findAllWithCriteria = ({ types }) =>
      descendants(node).filter((candidate) => types.includes(candidate.type));

    // Plugin data. Figma deletes a key when it is written the empty string, and
    // reads an absent key back as "" — both reproduced here, because the tools
    // exist precisely to make that ambiguity visible to a caller.
    const privateData = new Map();
    const sharedData = new Map();
    function pluginDataStore(namespace) {
      if (namespace === undefined) return privateData;
      if (!sharedData.has(namespace)) sharedData.set(namespace, new Map());
      return sharedData.get(namespace);
    }
    function writePluginData(store, key, value) {
      if (value === "") store.delete(key);
      else store.set(key, value);
    }
    node.getPluginData = (key) => privateData.get(key) ?? "";
    node.setPluginData = (key, value) => writePluginData(privateData, key, value);
    node.getPluginDataKeys = () => [...privateData.keys()];
    node.getSharedPluginData = (namespace, key) =>
      pluginDataStore(namespace).get(key) ?? "";
    node.setSharedPluginData = (namespace, key, value) =>
      writePluginData(pluginDataStore(namespace), key, value);
    node.getSharedPluginDataKeys = (namespace) => [
      ...pluginDataStore(namespace).keys(),
    ];

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
  // Remote (library) styles resolve by ID but are deliberately absent from every
  // getLocal*StylesAsync loader — that is exactly how Figma behaves on a file that
  // references an external library, and it is why get_node_variables has to carry the
  // value itself rather than leaving consumers to join against get_styles.
  const allStyles = Object.entries(styles)
    .filter(([bucket]) => bucket !== "remote")
    .flatMap(([, entries]) => entries)
    .concat(styles.remote || []);

  const figma = {
    editorType: "figma",
    root: rootNode,
    mixed: MIXED,
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
    // ⛔ The previous stub accepted anything, including `figma.mixed` — so the offline
    // suite could not observe the one failure this API actually produces. Figma cannot
    // unwrap a symbol, and says so.
    loadFontAsync: async (font) => {
      if (typeof font === "symbol" || font === MIXED) {
        throw new Error("Cannot unwrap symbol");
      }
      if (!font || typeof font.family !== "string" || typeof font.style !== "string") {
        throw new Error(`Cannot load font: ${String(font)}`);
      }
      // A font that is referenced by the document but absent from the machine — the
      // condition that sends `setCharacters` down its silent-substitution path.
      if ((options.unavailableFonts || []).includes(fontKey(font))) {
        throw new Error(`Font ${font.family} ${font.style} is not available`);
      }
      loadedFonts.add(fontKey(font));
      fontLoads.push({ family: font.family, style: font.style });
      return undefined;
    },
    createRectangle: () => createDynamicNode("RECTANGLE", "Rectangle"),
    createFrame: () => createDynamicNode("FRAME", "Frame"),
    createText: () => createDynamicNode("TEXT", "Text"),
    createSection: () => createDynamicNode("SECTION", "Section"),
    // Pages attach to the document root, not to the current page, so this
    // deliberately does not go through createDynamicNode.
    createPage: () => {
      const page = makeNode({
        id: `900:${dynamicId++}`,
        type: "PAGE",
        name: "Page",
        children: [],
      });
      appendChild(rootNode, page);
      return page;
    },
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
    // code.js reads this off figma.annotations, which is where the real API lives.
    // The stub previously hung it on the figma root, so get_annotations could not be
    // exercised offline at all.
    annotations: {
      getAnnotationCategoriesAsync: async () => [],
    },
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
    exportCalls,
    fontLoads,
    loadedFonts,
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
      // A non-zero delay normally stays pending forever, which is what lets the
      // timeout-safety tests observe a hang. `runTimers` opts a suite out of that so a
      // deliberate yield — R2.4's chunkPauseMs — can be executed instead of shipped
      // untested; it advances the fake clock so elapsed time stays honest.
      if (delay === 0 || options.runTimers) {
        if (delay > 0) runtime.clock.now += delay;
        queueMicrotask(() => {
          if (timers.delete(id)) callback();
        });
      }
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
    // Reach a top-level declaration inside the plugin script. A `vm` context exposes
    // function declarations on the global object but NOT `const` bindings, so anything
    // a test needs to inspect has to be reachable through a function — which is why the
    // batch vocabulary mirror publishes itself through `batchVocabulary()`.
    globals(name) {
      const value = context[name];
      if (value === undefined) {
        throw new Error(
          `plugin global ${name} is not reachable (const bindings are not exposed by vm)`,
        );
      }
      return value;
    },
    messages: runtime.messages,
    notifications: runtime.notifications,
    exportCalls: runtime.exportCalls,
    // Which fonts the plugin actually asked Figma to load, in order — the only way to
    // tell "loaded the right font" from "never looked".
    fontLoads: runtime.fontLoads,
    isFontLoaded: (family, style) => runtime.loadedFonts.has(`${family}::${style}`),
    advanceClock(milliseconds) {
      runtime.clock.now += milliseconds;
    },
  };
}
