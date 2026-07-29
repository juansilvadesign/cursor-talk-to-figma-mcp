# Talk to Figma Fork — Independent Tool Roadmap

> `talk-to-figma-fork` is an **independent MCP integration for Figma**. It is not
> the [`figma-to-code`](../figma-to-code/) product and it is not a Code → Figma
> compiler.
>
> The active implementation state lives in [`TASKS.md`](TASKS.md). The completed
> read-layer overhaul and its upstream PR sequence remain in
> [`docs/READ-LAYER-PLAN.md`](docs/READ-LAYER-PLAN.md). Deferred capabilities in
> this file are re-ranked after each release; they are options, not a fixed-scope
> promise.

## Product boundary

The fork owns the reusable connection and Figma capability layer:

```text
MCP clients
  ├─ AI agents / editors
  ├─ figma-to-code                 read-only consumer
  └─ future authoring pipelines    write-tool consumers
             │
             ▼
talk-to-figma-fork
MCP schemas ↔ server ↔ relay ↔ Figma plugin
             │
             ▼
           Figma
```

| Project | Owns | Does not own |
| --- | --- | --- |
| **`talk-to-figma-fork`** | MCP tool schemas, server, relay, plugin handlers, Figma reads/writes, capability reporting, reliability, tests, and distribution | Capture manifests, token mapping, OpenDesign packages, framework parsing, generated applications, or consumer-specific orchestration |
| [`figma-to-code`](../figma-to-code/) | Read-only capture plan, immutable evidence bundle, Figma normalization, OpenDesign emission, and optional Astro output | MCP transport/plugin implementation or generic Figma tools |
| [`ai-website-cloner-template`](../ai-website-cloner-template/) | Browser reconnaissance, website-derived OpenDesign packages, and page generation | Figma transport or plugin operations |
| **Any future Code → Figma project** | Code/browser extraction, scene/component mapping, ownership policy, retries, and product acceptance | Reimplementation of the MCP server, relay, or generic plugin commands |

### Dependency rule

Dependency flows **from consumers to the fork**, never back from the fork into a
consumer:

- Consumers invoke the fork through versioned MCP tools and normalize returned
  payloads inside their own repositories.
- The fork never imports sibling source, OpenDesign contracts, capture schemas,
  Astro/React code, or brand fixtures.
- A consumer-discovered gap becomes the smallest **generic** Figma capability in
  this repository, with its own tests and documentation. The consumer then updates
  its pinned fork commit/version.
- Consumer acceptance can prove usefulness, but it cannot become the fork's only
  regression harness.

## Current baseline

Inspected at `956a6af` on 2026-07-28:

- 48 registered MCP tools across document reads, annotations, prototyping, shapes,
  text, layout, images, components, exports, and connection management.
- The read-layer integrity work is built and live-validated: honest page scope,
  bounded document/component reads, variables/styles/bindings, declared
  completeness, and heavy-read timeout handling.
- Useful authoring primitives already exist, including frames, rectangles, text,
  sections, auto layout, image fills, parenting, component instances, and batch text/
  annotation operations.
- The independent-product foundation is still weak: no durable test suite or linter,
  no server↔plugin command parity guard, no runtime capability fingerprint, and no
  verified package release containing the complete fork read layer.

## Capability spine

| # | Independent capability | Why it belongs here | Active release |
| --- | --- | --- | --- |
| C1 | **Contract and dispatcher regression harness** | Every MCP client needs server schemas and plugin handlers to agree | R0 |
| C2 | **Runtime identity and capability handshake** | Consumers must detect stale/mismatched server, relay, plugin, and tool sets before a real operation | R0 |
| C3 | **Stable, bounded read contract** | Audits, importers, and agents need honest scope, completeness, and deterministic payload shapes | R1 |
| C4 | **Compact binary/export handling** | Any client may need images without base64 flooding logs or model context | R1 |
| C5 | **Safe generic write batching** | Authoring clients need fewer round trips, typed partial results, and explicit destructive boundaries | R2 |
| C6 | **Complete typography/layout/visual primitives** | General Figma automation should not hardcode Inter or flatten unsupported properties silently | R2 |
| C7 | **Variables, styles, and components authoring** | Design-system clients need generic Figma APIs, independent of OpenDesign or any one compiler | R3 |
| C8 | **Versioned distribution and compatibility policy** | A useful fork must be installable and its server/plugin combinations reproducible | R0–R3 |

## Benefit-delivering release path

| Release | Value shipped | Riskiest assumption retired |
| --- | --- | --- |
| **R0 — Independently verifiable tool** | A clean checkout can build, test server/plugin parity, report its runtime identity, and pass a small live read/write smoke | The fork can be maintained safely without relying on ad-hoc sessions or a consumer repository |
| **R1 — Consumer-stable read release** | Any MCP client can pin the fork and capture bounded, typed Figma evidence plus compact exports | The current read layer is stable enough to serve consumers such as `figma-to-code` through a documented interface |
| **R2 — Safe authoring release** | Agents and authoring pipelines gain reliable typography, layout, visual, page, metadata, and generic batch operations | The narrow tool collection can support real authoring without a consumer-specific scene compiler inside the fork |
| **R3 — Design-system authoring release** | Generic tools create/bind variables and styles and create components/variants/instances | Figma design-system primitives can be exposed cleanly without coupling to OpenDesign or one client |

Only R0 is execution-ready. R1–R3 define capability boundaries and must be re-cut
after the preceding retrospective.

## Post-MVP / v2+ options

| # | Item | Extends | Why deferred / notes |
| --- | --- | --- | --- |
| RM1 | **Remote/team-library inventory and import** | R1/R3 | Local variables/styles/components are sufficient for the first stable contract. Remote resources add permissions, licensing, plan limits, and cross-file identity. |
| RM2 | **Prototype interaction authoring** | R2 | Reactions can be read today. Creating navigations, overlays, scroll targets, and variant transitions needs separate safety and acceptance fixtures. |
| RM3 | **Advanced vectors, masks, and booleans** | R2 visuals | SVG import covers many clients. Editable path topology and boolean stacks deserve narrow, independently tested tools. |
| RM4 | **Generic idempotency keys for create operations** | R2 batching | Valuable for reconnecting clients, but semantics must be tool-level and consumer-neutral rather than tied to a scene format. |
| RM5 | **Hosted relay and multi-user sessions** | Connection layer | Local channels are enough now. Remote use needs authentication, authorization, encryption, expiry, tenant isolation, and audit logs. |
| RM6 | **Alternate transports** | MCP/relay | WebSocket is the proven path. HTTP/SSE or direct plugin bridges should be added only for a measured client need. |
| RM7 | **Capability negotiation across plugin versions** | R0 handshake | Start with strict server/plugin compatibility. Graceful negotiation matters only after multiple supported versions exist. |
| RM8 | **Streaming/chunked binary resources** | R1 exports | File-path/hash output solves local clients first. Streaming matters for remote clients and larger artifacts. |
| RM9 | **Code Connect primitives** | R3 components | Publishing mappings is independently useful but introduces code ownership and library permissions beyond basic component creation. |
| RM10 | **Accessibility/design lint tools** | Read layer | Contrast, touch target, naming, focus, and state-coverage reports are useful generic reads, but separate from transport correctness. |
| RM11 | **Batch/operator administration** | Distribution | Multiple concurrent documents need queues, cancellation, resource caps, and observability. Prove one-session reliability first. |
| RM12 | **Upstream convergence** | All releases | Continue offering small generic source-only PRs. Never make local capability or consumer progress depend on upstream merge timing. |

## Out of scope

- **Figma → Code orchestration.** Capture bundles, token resolution, OpenDesign
  emission, and Astro generation belong to
  [`figma-to-code`](../figma-to-code/).
- **Code → Figma orchestration.** Framework parsing, scene schemas, responsive page
  mapping, source evidence, and product-level retry/ownership rules belong to a
  separate consumer project if one is created.
- **Website extraction.** Browser inspection and website cloning belong to
  [`ai-website-cloner-template`](../ai-website-cloner-template/).
- **A hard dependency on OpenDesign.** The fork may expose generic variable/style/
  component tools; it does not know OpenDesign slot names or package layouts.
- **Backend/application generation.** Figma operations do not implement APIs,
  authentication, databases, billing, or application logic.

## Update cadence

After each release:

1. Run the fork's own offline and live acceptance.
2. Record contract changes and compatibility impact.
3. Let consumers update their pin and run their separate acceptance.
4. Re-rank this roadmap from measured generic gaps.

Consumer findings inform the roadmap; they do not redefine the fork as that consumer.
