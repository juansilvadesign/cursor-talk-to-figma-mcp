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

  // ⛔ Item 2.4's model, and it is TYPE-gated where 2.3's is context-gated — which is the
  // opposite of the correction 2.3 had to make, so it needs stating rather than assuming.
  // Figma puts `clipsContent` on FrameNode and the three frame-likes that extend it; a
  // GROUP, a PAGE, a RECTANGLE and a TEXT do not have the property at all, they do not
  // have it set to `false`. That distinction is the tool's entire eligibility rule, so a
  // blanket default would erase the refusal branch exactly as 2.1's blanket
  // `layoutMode: "NONE"` erased its own.
  // ⚠️ SECTION is deliberately NOT here. Whether a section carries `clipsContent` is the
  // open question `live-clips-content-gate.mjs` measures, and encoding a guess would be
  // the fiction 2.3 shipped — green offline against a rule Figma does not have. Absent
  // here means "unmeasured", and the gate reports the answer either way.
  const CLIPS_CONTENT_CARRIERS = new Set([
    "FRAME",
    "COMPONENT",
    "COMPONENT_SET",
    "INSTANCE",
  ]);

  // Absolute position, by walking the parent chain. Arithmetic over data the fixture
  // already holds, so this claims nothing about the platform.
  function absoluteOrigin(node) {
    let x = 0;
    let y = 0;
    let current = node;
    while (current) {
      x += typeof current.x === "number" ? current.x : 0;
      y += typeof current.y === "number" ? current.y : 0;
      current = current.parent;
    }
    return { x, y };
  }

  function absoluteBoxOf(node) {
    const origin = absoluteOrigin(node);
    return {
      x: origin.x,
      y: origin.y,
      width: node.width,
      height: node.height,
    };
  }

  // R2.7 1.1. ⛔ THE BLANKET `fills: []` THIS REPLACES WAS A DISHONEST FIXTURE, of exactly
  // the family that cost R2.6 a shipped defect. Every node got `fills: []`, so `"fills" in
  // node` was TRUE for a GROUP and a SLICE — node types that carry no fills at all — and
  // `set_fill`'s only refusal would have been unreachable offline, with the live gate the
  // first thing ever to execute it. That is 2.1's debt, which 2.2 paid, and it is the same
  // shape as the blanket `layoutMode: "NONE"` that hid `set_layout_sizing`'s FILL guard
  // defect for six releases.
  // ⚠️ PAGE is deliberately absent, and so is SECTION. A page's background is
  // `backgrounds`, and whether the current API also exposes `fills` on either is a platform
  // question this project has not measured — `live-fill-gate.mjs` reports it. Absent here
  // means UNMEASURED, never "does not have it", which is the discipline
  // `CLIPS_CONTENT_CARRIERS` adopted for SECTION.
  const FILL_CARRIERS = new Set([
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
  ]);

  // R2.7 1.2. Effects come from BlendMixin, which is broader than fills (a GROUP can
  // carry effects) but deliberately excludes PAGE, DOCUMENT, SECTION and SLICE. The
  // presence check is the handler's only node-surface refusal, so a blanket `effects: []`
  // would hide it just as the old blanket fills hid `set_fill`'s refusal.
  const EFFECT_CARRIERS = new Set([
    "FRAME",
    "GROUP",
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
  ]);

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
        // ⛔ `effectStyleId` is a PLUGIN-node property and the real JSON_REST_V1 export
        // has never carried it — measured 2026-08-23 on a bound frame, an unbound frame
        // and a bound child alike. The effects model made it enumerable on the fake node,
        // and serializing the node's own properties then injected it into the fake export
        // for free, so every offline test read a field the live channel never returned.
        // That is what left the plugin filter's `effectStyleId` branch dead against real
        // input while the suite stayed green. The export models REST; REST has `styles`.
        key === "effectStyleId" ||
        typeof value === "function"
      ) {
        continue;
      }
      result[key] = clone(value);
    }
    // JSON_REST_V1's render-bounds field is the one the read filter must preserve, but
    // it is a non-enumerable getter on the fake node. An opt-in puts the value into the
    // exported response without claiming every real export includes or recomputes it.
    if ((options.includeAbsoluteRenderBoundsInExport || []).includes(node.id)) {
      result.absoluteRenderBounds = clone(node.absoluteRenderBounds);
    }
    // REST expresses a bound effect style here, and omits `styles` entirely when nothing
    // is bound. ⛔ The value is deliberately NOT the plugin's id: the real export uses a
    // file-local key ("6052:226") where the plugin uses "S:0a45cd18…,", so a harness that
    // reused one string would let a test assert an equality the platform never makes.
    if (typeof node.effectStyleId === "string" && node.effectStyleId !== "") {
      result.styles = { effect: `REST-KEY:${node.effectStyleId}` };
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
      // ⛔ NOT a blanket default any more — the fill block below type-gates presence and
      // deletes the property from non-carriers. This entry only seeds the initial value a
      // carrier starts from; a GROUP or SLICE ends up with no `fills` property at all.
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

    // R2.7 item 1.1's fill model. Four decisions, and three of them are opt-ins rather
    // than claims — the fill surface has more unmeasured platform behaviour attached to it
    // than any layout tool did.
    {
      // ① PRESENCE IS TYPE-GATED and the property is DELETED from non-carriers. See
      // FILL_CARRIERS: the blanket `fills: []` this replaces made `set_fill`'s only node
      // refusal unreachable offline.
      if (FILL_CARRIERS.has(node.type)) {
        // ④ `fillStyleId` exists on every fill carrier, "" meaning none — Figma's own
        // representation, which the tool normalizes to null so that "no style bound" and
        // "the reading failed" cannot be confused. Declared BEFORE the fills accessor,
        // which closes over it for the detach model below.
        let styleId = typeof node.fillStyleId === "string" ? node.fillStyleId : "";

        // ⛔ A TEXT node with per-character fills answers `figma.mixed`, and a test reaches
        // that through the `mixedFills` option rather than by embedding a symbol in the
        // fixture JSON. It matters because `[]` and `figma.mixed` are opposite claims — one says
        // the node has no fills, the other that the reading cannot be expressed as an
        // array — and a tool that collapses them reports the first when it means the
        // second. `set_fill` keeps them apart with `previousReadable`/`previousMixed`.
        let stored = (options.mixedFills || []).includes(node.id)
          ? MIXED
          : Array.isArray(node.fills)
            ? clone(node.fills)
            : [];

        // ⭐ ② OPT-IN SILENT-DISCARD — 2.4's instrument, and the ONLY thing holding this
        // tool's read-back honest. An echo of the argument and a read-back of the node
        // agree on every input while the platform stores what it is handed, so no
        // assertion over the reported array can separate them. A discarding node reports
        // the OLD fills through a read-back and the NEW ones through an echo, in one
        // reading — and it depends on no platform claim whatsoever.
        // ⛔ This is deliberately NOT modelled as "Figma normalizes paints on assignment".
        // That normalization probably happens and would also separate the two, but it is a
        // PLATFORM CLAIM, and resting the tool's honesty on one is what 2.3 shipped.
        const discardsFills = (options.ignoreFillWrites || []).includes(node.id);

        // ⭐ ③ OPT-IN STYLE DETACH, and it is the question this whole tool is careful
        // about. Whether assigning `fills` to a node with a paint style bound DETACHES
        // that style is UNMEASURED — `live-fill-gate.mjs` answers it. Encoding either
        // answer as the harness default would make every offline test green against a
        // platform behaviour nobody checked, which is 2.3's fiction exactly.
        // ⛔ So the harness models BOTH worlds on request and neither by default, and the
        // tool is asserted to report the reading correctly in each. `styleDetached` is a
        // reading, not a claim, and that is what makes it survive either answer.
        const detachesOnWrite = (options.detachStyleOnFillWrite || []).includes(node.id);

        Object.defineProperty(node, "fills", {
          enumerable: true,
          configurable: true,
          get: () => (stored === MIXED ? MIXED : clone(stored)),
          set: (value) => {
            if (discardsFills) return;
            stored = clone(value);
            if (detachesOnWrite) styleId = "";
          },
        });

        Object.defineProperty(node, "fillStyleId", {
          enumerable: true,
          configurable: true,
          get: () => styleId,
          set: (value) => {
            styleId = value;
          },
        });
      } else {
        delete node.fills;
        delete node.fillStyleId;
      }
    }

    // R2.7 item 1.2's effect model. The two opt-ins are instruments, not platform
    // claims: either one makes a receipt that echoes its arguments observably wrong.
    {
      if (EFFECT_CARRIERS.has(node.type)) {
        // Figma represents an unbound effect style as "". It is a plain string, unlike
        // fillStyleId, so there is no mixed branch to invent.
        let styleId = typeof node.effectStyleId === "string" ? node.effectStyleId : "";
        let stored = Array.isArray(node.effects) ? clone(node.effects) : [];
        const discardsEffects = (options.ignoreEffectWrites || []).includes(node.id);
        const detachesOnWrite = (options.detachStyleOnEffectWrite || []).includes(node.id);

        Object.defineProperty(node, "effects", {
          enumerable: true,
          configurable: true,
          get: () => clone(stored),
          set: (value) => {
            if (discardsEffects) return;
            stored = clone(value);
            if (detachesOnWrite) styleId = "";
          },
        });

        Object.defineProperty(node, "effectStyleId", {
          enumerable: true,
          configurable: true,
          get: () => styleId,
          set: (value) => {
            styleId = value;
          },
        });
      } else {
        delete node.effects;
        delete node.effectStyleId;
      }
    }

    // Item 2.4's clipping model. Three separate decisions live in this block and each one
    // is a place the fixture could quietly lie to the tool.
    {
      // ① PRESENCE is type-gated and the property is DELETED from non-carriers, not set
      // to false. `set_clips_content` refuses on `typeof previous !== "boolean"`, so a
      // blanket default would make that branch unreachable offline and the live gate would
      // be the first thing to execute it — 2.1's exact debt, which 2.2 then had to pay.
      if (CLIPS_CONTENT_CARRIERS.has(node.type)) {
        let clips = typeof node.clipsContent === "boolean" ? node.clipsContent : true;
        // ⭐ ② OPT-IN SILENT-DISCARD, and it is here for one specific lie. A receipt that
        // ECHOED its own argument is invisible while the platform stores what it is handed:
        // echo and read-back agree on every input, so no assertion over the reported boolean
        // can separate them. This is 2.3's `roundSizeLimits` pattern applied to a value that
        // cannot be rounded — a node that accepts the write and keeps its old value reports
        // `false` through a read-back and `true` through an echo, in one reading.
        // ⚠️ It is NOT claimed that Figma does this. It models a platform that might, so the
        // honesty of the read-back stops depending on the platform being well-behaved. And
        // it is not idle speculation either: `set_layout_child`'s decision ① exists because
        // Figma accepts all three of ITS assignments outside auto-layout and applies none.
        const discards = (options.ignoreClipsContentWrites || []).includes(node.id);
        Object.defineProperty(node, "clipsContent", {
          enumerable: true,
          configurable: true,
          get: () => clips,
          set: (value) => {
            if (discards) return;
            clips = value;
          },
        });
      } else {
        delete node.clipsContent;
      }

      Object.defineProperty(node, "absoluteBoundingBox", {
        enumerable: false,
        configurable: true,
        get: () => absoluteBoxOf(node),
      });

      // ⛔ ③ `absoluteRenderBounds` DEFAULTS TO NULL, and that default is the honest one.
      // Whether Figma recomputes render bounds synchronously with a `clipsContent`
      // assignment is UNMEASURED — `live-clips-content-gate.mjs` is what measures it. A
      // harness that computed it unconditionally would be asserting the answer, and every
      // offline test would then be green against a platform behaviour nobody had checked.
      // Null here means "the platform did not answer", which is the reading the tool must
      // propagate as `renderBoundsChanged: null` rather than collapsing to `false`.
      //
      // ⭐ A fixture opts IN with `clipRenderBounds`, and only then does the union geometry
      // exist. So the suite proves two different things on purpose: the null path proves the
      // absence never reads as an answer, and the opt-in path proves the arithmetic.
      const measuresRender = (options.clipRenderBounds || []).includes(node.id);
      Object.defineProperty(node, "absoluteRenderBounds", {
        enumerable: false,
        configurable: true,
        get: () => {
          if (!measuresRender) return null;
          const box = absoluteBoxOf(node);
          if (node.clipsContent !== false) return box;
          let minX = box.x;
          let minY = box.y;
          let maxX = box.x + box.width;
          let maxY = box.y + box.height;
          for (const child of descendants(node)) {
            if (child.visible === false) continue;
            const childBox = absoluteBoxOf(child);
            minX = Math.min(minX, childBox.x);
            minY = Math.min(minY, childBox.y);
            maxX = Math.max(maxX, childBox.x + childBox.width);
            maxY = Math.max(maxY, childBox.y + childBox.height);
          }
          return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        },
      });
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
