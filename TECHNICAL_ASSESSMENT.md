# Technical assessment

Assessment date: 2026-09-05.

## Investigated environment

- Installed Positron: **2026.10.0 build 9**, commit `65281e825031d4017b91f375498ebdc9c2ce3347`, based on Code OSS 1.130.0.
- Installed Codex: **codex-cli 0.153.2**.
- Published Positron API package: **`@posit-dev/positron` 0.2.10**, whose compatibility table targets Positron 2026.09.1+.
- MCP SDK: **`@modelcontextprotocol/sdk` 1.30.0**.

Evidence was checked against the installed `out/positron-dts/positron.d.ts`, its implementation in the matching Positron source checkout at the installed commit, the published API package declarations, Posit's official extension-development guide, and the local Codex CLI help.

## Directly supported

The following public `runtime` APIs are present in both the installed declarations and `@posit-dev/positron` 0.2.10:

- `getForegroundSession()` returns `BaseLanguageRuntimeSession | undefined`.
- `getSessionVariables(sessionId, accessKeys?)` returns runtime-supplied variable metadata.
- `executeCode(languageId, code, focus, allowIncomplete, mode, errorBehavior, observer, sessionId, ...)` returns the MIME-keyed result and reports output, stderr, failures, completion, and static plots through `ExecutionObserver`.
- `BaseLanguageRuntimeSession.getRuntimeState()` supplies the last known state.
- The session/runtime metadata supplies IDs, language/runtime names and versions, mode, and optional starting working directory.
- Cancellation of an observed execution is implemented by interrupting the assigned session once it is running.

These APIs are language-neutral. R and Python runtime providers both implement the common session/variables/execution contracts, so the adapter has no R-specific branch.

Codex 0.153.2 directly supports local Streamable HTTP MCP servers. `codex mcp add --help` documents `--url <URL>` as a Streamable HTTP endpoint, and the equivalent configuration is an `mcp_servers.<name>.url` entry.

## Adaptation required

- External extensions should not import the injected `positron` module directly. Per the current official guide, this project uses `tryAcquirePositronApi()` from `@posit-dev/positron`; it returns the injected API only in Positron.
- `executeCode` can start/select a session when `sessionId` is omitted. The adapter first requires a foreground session and always passes its exact ID, preventing that fallback.
- The variables API returns arrays aligned to access-key requests. The adapter maps those arrays into bounded MCP-friendly metadata and resolves a requested display name to its opaque access key before asking for children.
- The plot callback supplies a string but not its MIME type. The adapter recognizes SVG and JPEG signatures and otherwise labels it PNG. Dynamic plots are not emitted.
- A dynamically allocated port conflicts with one-time Codex configuration. The default remains port `0` for safety/convenience, while a configurable fixed port provides stable configuration.

## Stability

`tryAcquirePositronApi()` and its `PositronApi` type are marked stable by the package. The runtime namespaces track Positron releases rather than carrying an independent stability guarantee. Pinning `@posit-dev/positron` 0.2.10 and declaring Positron 2026.09.1+ makes that coupling explicit, but future Positron upgrades should be checked against the package compatibility table and tests.

No private API or Posit Assistant authentication/internal service is used.

## Positron's existing MCP infrastructure

The installed Code OSS/Positron API contains MCP **client/provider** support (`McpHttpServerDefinition` and `registerMcpServerDefinitionProvider`) so extensions can advertise servers for the editor to consume. It does not expose a general-purpose MCP server transport that an extension can reuse to serve external Codex clients. This project therefore uses the official TypeScript MCP SDK's stateless Streamable HTTP transport and Node listener inside the extension host.

## Local server lifecycle and security

VS Code/Positron workspace extensions run in a Node extension host and can safely own a Node HTTP server if they close it from their disposable/deactivation path. This implementation:

- listens explicitly on `127.0.0.1` with OS-selected or configured port;
- uses the MCP SDK's localhost Host-header validation;
- rejects non-loopback browser origins and enables no CORS policy;
- creates a fresh stateless MCP server/transport per request;
- closes active transports and the listener during stop/deactivation;
- logs lifecycle/diagnostic metadata but never code, tool arguments, credentials, or variable values.

Localhost does not authenticate other same-machine processes. The user must treat the endpoint as privileged and must not expose/forward it.

## What cannot currently be done faithfully

- Retrieve dynamic plots through `ExecutionObserver`.
- Reliably determine an emitted plot's MIME type from the public callback alone.
- Read the current Plots pane through the public runtime execution API.
- Claim an always-current working directory without evaluating language-specific code; session metadata documents the starting directory.
- Complete the interactive same-process R/Python acceptance test without a running Positron extension host and live consoles. The automated suite instead verifies session-ID targeting with mocks.

## Richer context available for a later phase

The current public API also contains:

- `getConsoleHistory(sessionId, count)`, gated by the user's `console.historyApiEnabled` privacy setting;
- `querySessionTables(sessionId, accessKeys, queryTypes)` for table summaries;
- active-session enumeration and foreground-session change events.

They were intentionally left out of the minimal three-tool implementation. Public retrieval of the current Plots-pane contents was not established.

## Conclusion

Positron core changes are **not required** for the requested proof of concept. The critical same-session guarantee is possible through supported extension APIs by acquiring the foreground session and passing its exact ID into execution and variable calls. The remaining limitations concern richer Assistant parity and plot/working-directory fidelity, not the core live-runtime bridge.
