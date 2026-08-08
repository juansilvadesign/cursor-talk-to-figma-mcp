# Runtime compatibility — R0

R0 supports one strict local server/plugin pair. The source of truth is generated into
[`runtime-metadata.ts`](../src/talk_to_figma_mcp/runtime-metadata.ts), the DEV plugin's
`code.js`, and the public [contract snapshot](../contracts/public-contract.json).

| Server | Plugin | Server schema | Relay protocol | Status |
| --- | --- | --- | --- | --- |
| Local `dist/server.js`, built from this checkout | Local DEV plugin linked from `src/cursor_mcp_plugin/manifest.json` after the same contract generation | `1.0.0` | `1` | Supported |
| npm `latest` | Community plugin | Does not expose the R0 identity contract | Unknown | Unsupported for this fork |
| R0 server with an older/newer local plugin build | Any non-matching fingerprint/build | Any mismatch | Any mismatch | Rejected before document operations |

## Preflight behavior

1. `join_channel` joins relay plumbing, then asks the plugin for
   `get_runtime_info` with a five-second preflight budget.
2. The server compares plugin build ID, Plugin API version, server schema version,
   relay protocol, capability fingerprint, and the complete public command set.
3. Any mismatch is returned explicitly. All document reads/writes remain blocked;
   `get_runtime_info` stays callable so the mismatch can be diagnosed.
4. Reconnecting the WebSocket clears the preflight. A client must join again.

Runtime diagnostics include only build/schema/plugin compatibility identifiers. They do
not include the channel, local filesystem paths, document names, node contents, or other
local secrets.

## Contract evolution

Every inventory entry declares one result class:

- `stable`: removals, type narrowing, newly required parameters, enum narrowing, and
  changed defaults are incompatible.
- `additive-preview`: the existing fields retain their meaning, but optional result
  fields may be added before the R1 read contract is frozen. Clients must ignore unknown
  result fields.
- `legacy`: retained for compatibility while a bounded/compact replacement is planned.
  R0 marks `read_my_design` and base64-oriented `export_node_as_image` this way.

The snapshot guard permits new tools and optional input fields, but rejects removals or
incompatible parameter changes. Command additions also change the capability
fingerprint, so the server and plugin must be regenerated and shipped together.

## Exact local setup

```bash
bun run setup
bun run socket
```

Then link `src/cursor_mcp_plugin/manifest.json` as a Figma Development plugin, connect
it to port 3055, join the displayed channel, and call `get_runtime_info`. `bun run setup`
writes `.cursor/mcp.json` and `.mcp.json` with an absolute path to this checkout's built
server; it never selects a network package.

The root `bun.lock` is authoritative. On 2026-08-07, a clean
`bun install --frozen-lockfile` installed 167 packages in 1.66 seconds. The retained
`package-lock.json` still identifies root version `0.3.1` while `package.json` is
`0.3.5`; a clean npm attempt hung and did not produce a valid dependency tree. It stays
checked in as legacy traceability, not as a supported R0 lockfile. The nested package
and lock under `src/talk_to_figma_mcp/` are legacy source metadata.
