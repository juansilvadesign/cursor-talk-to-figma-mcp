# Talk to Figma Fork — Code → Figma Roadmap

> The active, acceptance-gated build lives in [`TASKS.md`](TASKS.md). The completed
> read-layer overhaul and its upstream split remain in
> [`docs/READ-LAYER-PLAN.md`](docs/READ-LAYER-PLAN.md).
>
> This file records the product direction, the tool spine required for a credible
> Code → Figma workflow, and the valuable post-MVP work that must not inflate the
> next release. Scope is re-ranked after every release retrospective; later items are
> options, not a fixed-scope promise.

## Direction

Turn the fork from a collection of useful read/write commands into the dependable
**Figma authoring backend** for an evidence-backed Code → Figma pipeline:

```text
authorized code / built page
        │
        ▼
ai-website-cloner-template
rendered evidence · OpenDesign package · topology · component specs · assets
        │
        ▼
normalized code-to-figma.scene.json
stable client IDs · source citations · explicit responsive frames
        │
        ▼
talk-to-figma-fork
validate · dry-run · create/upsert · resume · return write receipt
        │
        ▼
editable Figma page
variables · styles · components · auto layout · real text/assets
        │
        ▼
read back + export + compare with the browser reference
```

The neighboring projects establish the two reusable seams:

- [`ai-website-cloner-template`](../ai-website-cloner-template/) owns browser
  reconnaissance and already emits a validated OpenDesign package, page topology,
  component specs, real content, assets, and viewport references.
- [`figma-to-code`](../figma-to-code/) established the evidence discipline:
  immutable raw inputs, a normalized intermediate, deterministic replay, explicit
  completeness, and fresh visual acceptance.
- **This fork owns the normalized scene contract and safe Figma application.** It
  should not grow a Next.js/Astro/React parser inside the plugin.

## Stance: fork first, upstream-compatible

Code → Figma work lands and is proven on this fork first. Small generic improvements
can be offered upstream as narrow source-only PRs, but the local release never waits
for an upstream merge or npm publication.

At the inspected `956a6af` baseline, the published
`cursor-talk-to-figma-mcp@latest` does not contain the fork's full read layer. Local
development therefore continues to use the fork's built `dist/server.js`, DEV plugin,
and relay until a separately verified release supersedes them.

## MVP capability spine

These are the capabilities required to call the result a Code → Figma pipeline rather
than an agent manually drawing rectangles. Their detailed work and acceptance gates
live in [`TASKS.md`](TASKS.md).

| # | Capability | Existing baseline | Required result | Release |
| --- | --- | --- | --- | --- |
| F1 | **Normalized scene contract** | No Code → Figma input contract | Versioned scene, asset, evidence, target, and write-receipt schemas with stable `clientId` references | R0 |
| F2 | **Safe target lifecycle** | Page switching and sections exist; page creation and ownership do not | Create a dedicated page/root, tag owned nodes, refuse unrelated mutations, and support a no-write dry run | R1 |
| F3 | **Batched, idempotent application** | Narrow per-node commands | `apply_scene` validates first, chunks work, reports progress, maps client IDs to Figma IDs, and safely resumes after a lost reply | R1 |
| F4 | **Typography and font preflight** | `create_text` hardcodes Inter and exposes a small property set | Available-font probe, explicit substitution report, full text styling, and mixed-font-safe content changes | R1 |
| F5 | **Responsive auto layout** | Frame layout, padding, alignment, sizing, gap, resize, and parenting exist | Child grow/align/absolute behavior, constraints, clipping, min/max sizing, wrap, and desktop/mobile frame relationships | R1 |
| F6 | **Visual and asset fidelity** | Solid fill/stroke, radius, image fill, rectangles, frames, text | SVG/vector import, gradients, effects, opacity/blend, reliable image crop/fit, and asset-hash evidence | R1 |
| F7 | **Design-system authoring** | Variables/styles are read-only | Idempotent local variables, modes, aliases, bindings, and paint/text/effect styles sourced from the OpenDesign package | R2 |
| F8 | **Components and variants** | Existing component instances and overrides can be used | Create components/sets, define properties and variants, instantiate them, and preserve a source-to-node map | R2 |
| F9 | **Round-trip verification** | Strong reads plus base64-oriented export | Read authored properties back, export without flooding model context, compare 1440px/390px evidence, and report declared gaps | R1–R3 |
| F10 | **Regression and distribution** | Build only; no durable tests or linter | Offline plugin harness, schema/dispatcher parity tests, live smoke fixture, pinned install, documented local runtime, and versioned release | R0–R3 |

## Benefit-delivering release path

| Release | Value shipped | Riskiest assumption retired |
| --- | --- | --- |
| **R0 — Safe proof loop** | A small source-backed scene is validated, authored on an isolated Figma page, read back, and exported with durable evidence | The current transport and primitives can support a repeatable write harness without corrupting an existing file |
| **R1 — Static page MVP** | One authorized page produces editable desktop/mobile Figma frames with real text, assets, layout, and visual evidence | A normalized scene plus a small set of additive write tools can reproduce a real built page without hundreds of fragile MCP calls |
| **R2 — Design-system-native MVP** | The same page uses local variables/styles and real component instances instead of detached raw shapes | OpenDesign semantics can map honestly onto Figma variables, styles, components, and plan limitations |
| **R3 — Generalized release** | A second unrelated source passes deterministic replay, idempotency, visual QA, docs, and release checks | The executor is a reusable tool rather than a one-page collection of special cases |

Only R0 is execution-ready before implementation begins. Later checklists define
capability boundaries, not a locked implementation sequence. After each release,
record the retrospective, re-cut scope, and detail the next release.

## Post-MVP / v2+ options

| # | Item | Extends | Why deferred / notes |
| --- | --- | --- | --- |
| RM1 | **Multi-page sites and complete product flows** | R1 page compiler | MVP proves one coherent page with a desktop/mobile pair. Routing, shared chrome, repeated page templates, and cross-flow QA multiply scope. |
| RM2 | **Framework-specific source adapters** for Astro, React, Next.js, Vue, and Storybook | Scene compiler | Rendered evidence plus the OpenDesign seam is framework-neutral. AST adapters are useful only when they add semantics the built page cannot expose. |
| RM3 | **Watch mode / live code sync** | `apply_scene` idempotency | Rebuild and patch Figma as code changes. Needs stable ownership, semantic diffs, debouncing, conflict policy, and trustworthy resume first. |
| RM4 | **Patch an existing human-authored Figma page** | Safe target lifecycle | MVP writes only inside its own page/root. Merging into irreplaceable work needs three-way matching, conflict previews, and an explicit approval boundary. |
| RM5 | **Remote/team-library variables and components** | R2 design-system authoring | Local resources prove the mapping. Publishing or consuming team libraries adds permissions, licensing, plan gates, and cross-file identity. |
| RM6 | **Full multi-axis modes** | R2 variable modes | Light/dark is tractable. Theme × breakpoint × density × brand requires an explicit projection policy and may need multiple collections or files. |
| RM7 | **Prototype interactions and interactive-component transitions** | R2 components | The fork can read reactions, but setting navigations, overlays, variant transitions, and scroll behavior is a separate acceptance surface. |
| RM8 | **Motion reconstruction** | RM7 | CSS/GSAP/Lottie/WebGL behavior is not a static node property. Prefer static correctness and documented fallback before approximating runtime motion. |
| RM9 | **Advanced vector, mask, boolean, and illustration reconstruction** | R1 visual fidelity | SVG import covers the useful MVP path. Editable path topology, boolean stacks, masks, and complex illustrations need dedicated fixtures. |
| RM10 | **Automated visual-diff scoring** | R3 QA | Durable side-by-side evidence comes first. Thresholds need font/render normalization, masking, and a policy for acceptable responsive differences. |
| RM11 | **Batch/operator mode** | R3 release | Processing many codebases needs queueing, resource caps, isolated namespaces, cancellation, and aggregate reporting. |
| RM12 | **Hosted relay and multi-user sessions** | Local relay | The local channel model is enough for MVP. Remote use needs authentication, authorization, encryption, expiry, audit logs, and tenant isolation. |
| RM13 | **Design/code drift monitoring** | RM3 watch mode | Periodically rebuild the scene, diff code/OpenDesign/Figma state, and route conflicts for review. This depends on stable semantic IDs. |
| RM14 | **Accessibility and design-lint report** | Verification | Contrast, target size, text scaling, focus order, and component-state coverage deserve an explicit report; visual fidelity alone is not quality. |
| RM15 | **Code Connect publishing** | R2 components | Mapping generated components back to production implementations is valuable after names, variants, and source identity survive two unrelated fixtures. |
| RM16 | **Bidirectional round-trip experiments** | `figma-to-code` + this project | Code → Figma → Code without semantic drift is a research track, not an MVP promise. Compare normalized artifacts before attempting live two-way sync. |
| RM17 | **Shared scene/emitter package** | All three sibling projects | Extract a shared package only after duplication causes measured maintenance cost; premature sharing would couple three still-moving tools. |

## Out of scope

- **Figma → Code extraction.** That is
  [`figma-to-code`](../figma-to-code/); this project may reuse its evidence and
  replay conventions but does not duplicate its importer.
- **Browser/brand extraction.** That remains
  [`ai-website-cloner-template`](../ai-website-cloner-template/).
- **Backend behavior.** Databases, APIs, authentication, billing, and business logic
  cannot be represented faithfully as Figma nodes.
- **Unbounded mutation of an existing file.** MVP creates or updates only nodes it
  owns under an explicit namespace.
- **Unauthorized replication.** Only owned code, authorized client work, migrations,
  and legitimate learning fixtures may enter the pipeline.
- **Perfect runtime equivalence.** Figma is an editable design artifact, not a browser;
  unsupported behavior is recorded rather than hidden behind a plausible screenshot.

## Parking lot

- FigJam journey-map output from route and interaction evidence.
- A human-readable scene/receipt viewer.
- DTCG/Tokens Studio import alongside OpenDesign.
- Component documentation pages generated next to the authored Figma page.
- A Figma page containing browser reference screenshots beside generated frames.
- Optional annotations linking generated nodes to source files, selectors, and commits.
