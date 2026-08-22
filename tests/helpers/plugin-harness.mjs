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

  // ⛔ Type-gated, NOT a blanket default — and that distinction is the whole point.
  // Item 2.1 gave every node `layoutMode: "NONE"`, pages included, so the arm for "a
  // parent with no layoutMode property at all" could only be reached by `delete`ing the
  // property inside a test. That is fiction dressed as a fixture, and the live gate was
  // the first thing to execute the branch for real. Figma's ConstraintMixin is carried by
  // laid-out nodes and NOT by DOCUMENT, PAGE, GROUP or SECTION, so the harness models
  // exactly that and `set_constraints`'s "this node has no constraints" refusal is
  // reachable honestly, offline, without surgery.
  // ⛔ The debt item 2.1's live gate recorded, paid here. `layoutMode` was a BLANKET
  // default — every node got `"NONE"`, pages and groups included — so `set_layout_child`'s
  // arm for "a parent with no layoutMode property at all" could only be reached by
  // `delete`ing the property inside a test, and the live gate was the first thing to
  // execute it for real. In Figma only frame-likes carry AutoLayoutMixin. Gating it here
  // makes that branch honestly reachable offline, for 2.1 and for 2.2's parent guard.
  const AUTO_LAYOUT_CARRIERS = new Set([
    "FRAME",
    "COMPONENT",
    "COMPONENT_SET",
    "INSTANCE",
  ]);

  // ⛔ Item 2.3's size-limit model, and it was WRONG on its first draft — corrected here
  // from a live measurement rather than from documentation.
  //
  // The first version gated these four properties by node TYPE, on the documented claim
  // that min/max belong to frame-likes and text. `live-size-limits-gate.mjs` §6 measured an
  // eight-cell matrix against real Figma and the answer is that TYPE IS IRRELEVANT: the
  // rule is purely CONTEXTUAL, exactly as the platform's own error says — "can only set
  // maxWidth on auto layout nodes and their children". A RECTANGLE inside an auto-layout
  // frame is accepted; a TEXT inside a plain frame is refused.
  //
  // ⭐ And the second half of the correction matters as much as the first: the properties
  // are READABLE on every node, returning null. Only the WRITE is gated. So a model that
  // deleted the properties from ineligible nodes would still be wrong — it would let a
  // handler distinguish eligible from ineligible by reading, which against Figma it cannot.
  // Every node therefore carries all four, and the SETTER is what refuses.
  const nodeIsAutoLayout = (node) =>
    Boolean(node) && node.layoutMode !== undefined && node.layoutMode !== "NONE";
  const takesSizeLimits = (node) =>
    nodeIsAutoLayout(node) || nodeIsAutoLayout(node && node.parent);

  const CONSTRAINT_CARRIERS = new Set([
    "FRAME",
    "COMPONENT",
    "COMPONENT_SET",
    "INSTANCE",
    "RECTANGLE",
    "ELLIPSE",
    "POLYGON",
    "STAR",
    "VECTOR",
    "LINE",
    "TEXT",
    "BOOLEAN_OPERATION",
    "SLICE",
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

    // MIN/MIN is what Figma hands back on a freshly created node, so a test that reads
    // `constraints` without writing sees the platform's own answer rather than the
    // tool's. A fixture may override it; a non-carrier can never have one.
    if (CONSTRAINT_CARRIERS.has(node.type)) {
      if (!node.constraints) node.constraints = { horizontal: "MIN", vertical: "MIN" };
    } else {
      delete node.constraints;
    }

    // Item 2.3's size limits, modelled on the live measurement: READABLE on every node,
    // WRITABLE only in an auto-layout context.
    {
      const limits = {
        minWidth: null,
        maxWidth: null,
        minHeight: null,
        maxHeight: null,
      };
      const axes = [
        ["minWidth", "maxWidth", "width"],
        ["minHeight", "maxHeight", "height"],
      ];
      for (const field of Object.keys(limits)) {
        if (raw && field in raw) limits[field] = raw[field];
        delete node[field];
      }
      // ⭐ Figma CLAMPS the node to a limit rather than merely storing it, and it REFUSES
      // a minimum above a maximum. Both are modelled, and the refusal is the one that
      // earns its keep: without it, a handler that wrote its four fields in a careless
      // order would pass offline and only fail against the real platform. With it, the
      // write-order test can actually fail — the intermediate state is checked, not just
      // the end state.
      const applyLimits = () => {
        for (const [min, max, size] of axes) {
          if (typeof limits[min] === "number" && node[size] < limits[min]) {
            node[size] = limits[min];
          }
          if (typeof limits[max] === "number" && node[size] > limits[max]) {
            node[size] = limits[max];
          }
        }
      };
      // ⭐ Opt-in COERCION, and it exists to make one specific lie detectable. A receipt
      // that echoed its own arguments instead of reading the node back is invisible while
      // the platform stores exactly what it is given — the write and the read agree, so
      // both implementations produce identical output and no test can separate them. A
      // node that rounds its limits separates them in one reading: the echo reports 12.5,
      // the read-back reports 13. ⚠️ Whether Figma actually rounds is NOT claimed here;
      // this models a platform that might, so the honesty of the read-back stops depending
      // on the platform being well-behaved.
      const rounds = (options.roundSizeLimits || []).includes(node.id);
      for (const field of Object.keys(limits)) {
        Object.defineProperty(node, field, {
          enumerable: true,
          configurable: true,
          get: () => limits[field],
          set: (value) => {
            // ⛔ The platform's own gate, quoted from the live measurement. This is what
            // makes `set_size_limits`'s context refusal reachable offline — and, more
            // importantly, what makes a handler that FORGOT the rule fail offline instead
            // of only in Figma. Evaluated at write time, not construction time, because
            // `set_layout_mode` can make a node eligible after it was created.
            if (!takesSizeLimits(node)) {
              throw new Error(
                `in set_${field}: Can only set ${field} on auto layout nodes and their children`
              );
            }
            const stored =
              rounds && typeof value === "number" ? Math.round(value) : value;
            const next = { ...limits, [field]: stored };
            for (const [min, max] of axes) {
              if (
                typeof next[min] === "number" &&
                typeof next[max] === "number" &&
                next[min] > next[max]
              ) {
                throw new Error(
                  `Cannot set ${min} to ${next[min]}, which is greater than ${max} ${next[max]}`
                );
              }
            }
            limits[field] = stored;
            applyLimits();
          },
        });
      }
      applyLimits();
    }

    // ⚠️ A fixture that DECLARES layoutMode on a non-carrier keeps it, so this cannot
    // silently drop a value a test deliberately set up; only the blanket default is
    // withdrawn. ⏳ The sibling auto-layout defaults (paddingTop, itemSpacing,
    // primaryAxisAlignItems, layoutSizing*) are blanket in exactly the same way and are
    // NOT fixed here — one property, the one 2.2's guard branches on.
    if (!AUTO_LAYOUT_CARRIERS.has(node.type) && !("layoutMode" in (raw || {}))) {
      delete node.layoutMode;
      delete node.layoutWrap;
    }

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
      // ⛔ `fontName` is a GETTER/SETTER pair on a ranged node, not a data property.
      // Assigning a font to a mixed node in Figma collapses its per-character runs; a
      // plain data property would have let `fontName` report the new face while
      // `getRangeFontName` went on describing the old mixed state, so a test asserting
      // "the node is no longer mixed" would have passed without the node ever changing.
      let fontNameValue =
        distinct.size > 1
          ? MIXED
          : { family: ranges[0].family, style: ranges[0].style };
      Object.defineProperty(node, "fontName", {
        enumerable: true,
        configurable: true,
        get: () => fontNameValue,
        set: (value) => {
          fontNameValue = value;
          if (value && value !== MIXED && typeof value !== "symbol") {
            const end = ranges.length > 0 ? ranges[ranges.length - 1].end : 0;
            ranges.length = 0;
            ranges.push({
              start: 0,
              end,
              family: value.family,
              style: value.style,
            });
          }
        },
      });
      node.getRangeFontName = (start, end) => rangeFontFor(ranges, start, end);
      node.setRangeFontName = (start, end, font) => {
        ranges.length = 0;
        ranges.push({ start, end, family: font.family, style: font.style });
      };
      // Figma's real range API answers with EVERY distinct face covering the range, so
      // a caller can load them all before writing. `getRangeFontName` cannot substitute
      // for it: on a mixed range it returns one symbol and names no face at all.
      node.getRangeAllFontNames = (start, end) => {
        const seen = new Set();
        const faces = [];
        for (const range of ranges) {
          if (range.start >= end || range.end <= start) continue;
          const key = fontKey(range);
          if (seen.has(key)) continue;
          seen.add(key);
          faces.push({ family: range.family, style: range.style });
        }
        return faces;
      };
    } else {
      node.getRangeFontName = () => node.fontName;
      node.setRangeFontName = () => undefined;
      node.getRangeAllFontNames = () =>
        node.fontName && typeof node.fontName !== "symbol"
          ? [{ family: node.fontName.family, style: node.fontName.style }]
          : [];
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
    // ⭐ Figma's own property setters refuse writes this fake would happily accept — a
    // non-numeric `y`, a non-numeric `strokeWeight`. That gap is the reason `move_node`
    // and `set_stroke_color` could only ever be PROVEN by a live gate: the harness could
    // not express the defect, exactly as with the mixed-font case. Opt-in, so a test can
    // ask what a handler leaves behind when the platform refuses its second write,
    // without pretending to know how often Figma actually refuses.
    for (const refusal of options.refusePropertyWrite || []) {
      if (refusal.nodeId !== node.id) continue;
      const held = node[refusal.property];
      Object.defineProperty(node, refusal.property, {
        enumerable: true,
        configurable: true,
        get: () => held,
        set: () => {
          throw new Error(
            `Cannot write ${refusal.property} on ${node.id}: refused by the platform`,
          );
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
      // ⛔ 12, which is what a real `figma.createText()` hands back — NOT 14, which is
      // what `create_text` writes when the caller omits fontSize. They were the same
      // number here, so the fixture could not tell "the tool wrote the default" from
      // "the tool wrote nothing and the platform's default happened to match". A
      // deleted default write scored green against it.
      raw.fontSize = 12;
      // ⛔ Geometry, because EVERY real Figma node has it. Without these the fields are
      // `undefined`, `JSON.stringify` drops them, and a reply that lost `width`/`height`
      // would read as green offline while shipping a hole a live consumer sees. The
      // harness lays out no text, so these are the empty-node values, not measurements.
      raw.width = 0;
      raw.height = 0;
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
    // R2.5 Phase 2. Figma answers `[{fontName: {family, style}}]`, so the wrapper object
    // is reproduced rather than flattened — a harness that returned bare pairs would let
    // an unwrapping bug pass offline and only appear live.
    //
    // ⚠️ CC6: this list is supplied by the TEST. Offline it can prove the window, the
    // filter, the sort and the available-vs-loadable split; it cannot prove that a real
    // machine's inventory has this shape or this size. That half is owed to the live gate.
    listAvailableFontsAsync: async () => {
      if (options.fontListNeverResolves) return new Promise(() => {});
      if (options.fontListError) throw new Error(options.fontListError);
      return clone(options.fonts || fixture.fonts || []).map((font) => ({
        fontName: { family: font.family, style: font.style },
      }));
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
      // A real font load costs wall-clock time, which is the only thing check_fonts's
      // budget can act on. Opt-in and 0 by default, so no existing font fixture changes
      // meaning — the same reason strictFontLoading is opt-in.
      clock.now += Number(options.fontLoadMs || 0);
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
  // A host that predates listAvailableFontsAsync. The tools must answer `supported:
  // false` with null counts rather than throwing, and check_fonts must still report
  // loadability — which it observes directly instead of looking up.
  if (options.fontInventoryApi === false) {
    delete figma.listAvailableFontsAsync;
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
