# Consumer bug — a remote TEXT style value crashes `get_node_variables`

**Found:** 2026-09-24 by the `figma-to-code` consumer, during its R2 capture of a private
client fixture. **Status:** open. It is planned as **R3.3.1**, move 1 of
[`R3.4-CLOSURE.md`](../R3.4-CLOSURE.md), and no code is written yet. **Blocks:** that
consumer's R2.
**Evidence:** [`evidence/consumer-2026-09-24-remote-text-style-symbol/evidence.json`](evidence/consumer-2026-09-24-remote-text-style-symbol/evidence.json)
(sanitized: node ids, node types, UI-kit layer names, counts, window verdicts; no copy, no
file identity).

## Symptom

On the R3.2.1 pair (`r3.2.1-server-798028241619` ↔ `r3.2.1-plugin-d9b64d2ac562`, fork
`e136177`, compatibility `compatible`), `get_node_variables` on either landing-page frame root
returns this text instead of JSON:

```text
Error getting node variables: in postMessage: Cannot unwrap symbol
```

One bad record costs the whole reply: there is no partial result, and the error doesn't
name the node, the record, or the field. R3.3's `code.js` has the same unguarded code, so
the current `main` is affected too.

## Reproduction (read-only)

The trigger is a node whose subtree contains a TEXT layer that references a **remote
(library) TEXT style**. On the fixture those are UI-kit library text styles inside component
instances (`Button`, `Input field`, `Dropdown`).

A read-only bisection took 288 `get_node_variables` calls. It ran on every top-level section
of both frames, then descended into each failing node until all of its payload children
passed. The result was **66 culprit nodes in 13 of the 28 sections**: 60 `TEXT`, 4
`INSTANCE`, and 2 `FRAME`. The `INSTANCE` and `FRAME` culprits contain a failing layer that
`get_node_info`'s payload filters out.

## Isolation — it is the TEXT style value, not the binding

`offset`/`limit` window the `bindings` and `styles` arrays on their own, while the counts stay
whole-scan totals. So a window that serializes proves that its records are Symbol-free, and a
window past both arrays still returns the counts.

- Each TEXT culprit leaf has exactly one binding and one style reference, and both report
  `resolved`. The `offset 0` window (binding + style) fails. Every other window passes.
- In a subtree with 7 bindings and 5 styles, the two windows that hold **only a binding**
  (`offset 5`, `offset 6`) pass. One of those bindings is a TEXT layer's `fills[0].color`
  binding, so text fill bindings serialize.
- The windows holding a **remote PAINT** style (`fillStyleId`) and a **remote EFFECT** style
  (`effectStyleId`) pass.
- The three failing windows each carry the `textStyleId` reference of one of the subtree's
  three text layers, and those styles are remote.

So `readStyleValue()` (search `function readStyleValue` in `src/cursor_mcp_plugin/code.js`)
is the source. Its TEXT branch copies eight TextStyle fields verbatim (`fontName`, `fontSize`,
`lineHeight`, `letterSpacing`, `paragraphSpacing`, `paragraphIndent`, `textCase`,
`textDecoration`). For a remote TEXT style, at least one of them is a Symbol, presumably
`figma.mixed`, and `postMessage` cannot clone a Symbol.

**Still unknown: which field it is, and whether it is `figma.mixed` or some other Symbol.**
Name the field from a live diagnostic before writing the fixture. The R3 operating rule
applies: a fixture must not invent a platform rule.

## Same class, not observed failing

- `serializeVariableValue()` returns anything it doesn't recognize unchanged, so a Symbol
  resolved value would crash the same way. Every variable binding on this fixture serialized,
  so this is latent, not observed.
- Nothing on the response path names where a Symbol sits. Any handler that returns one fails
  with the same opaque message.

## What the consumer needs (the fork owns the design)

1. The record serializes and **says what it could not read**. It must never go silently
   `null`: the house rule is that `mixed` is a real answer and absence is not.
2. A regression fixture modelled on the observed field, with a known-bad leg (the unfixed
   handler must fail it).
3. A new plugin build id and release identity, plus a commit to pin. A fix that ships under
   an unchanged `pluginBuildId` would be indistinguishable from the broken build at the
   consumer's runtime handshake.
4. A refresh of **Consumer compatibility snapshot** in `TASKS.md`, which is stale. It still
   says the consumer pins `5e0c869` and found no defect. Today the consumer's new captures pin
   `e136177` (R3.2.1) from an isolated detached worktree, its historical capture stays bound to
   `5e0c869`, and this is its first fork defect.

## Consumer acceptance

`figma-to-code` re-runs its capture from a clean worktree of the fixed release: both frame
roots with `get_node_variables`, plus reactions on the hero component set. It passes when both
frame replies are JSON with complete coverage and every remote TEXT style record states which
fields it could not read. The consumer then adds the release to its `CAPTURE_FORK_PINS` and
moves new captures and its image-fill export lane onto it.
