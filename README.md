# Positron Codex Live Runtime MCP

This standalone TypeScript extension exposes the **existing foreground Positron R or Python session** to a trusted local MCP client such as Codex. It does not spawn R or Python, proxy OpenAI requests, or handle OpenAI credentials.

The proof of concept provides three tools:

- `positron_session` — foreground session/runtime metadata.
- `positron_variables` — bounded variable metadata, optionally including one object's immediate children.
- `positron_execute` — transient code execution in that exact foreground session, with stdout, stderr, result/error, timeout status, and static plot attachments where Positron emits them.

## Requirements

- Positron 2026.09.1 or newer. Development and verification used Positron 2026.10.0 build 9.
- Node.js 18 or newer.
- pnpm.
- A Codex version with Streamable HTTP MCP support. Development and verification used `codex-cli 0.153.2`.

The extension follows Posit's [extension development guide](https://positron.posit.co/extension-development.html) and uses the published [`@posit-dev/positron`](https://www.npmjs.com/package/@posit-dev/positron) package to acquire and type the public API.

## Architecture

```text
Codex (normal ChatGPT/Codex authentication)
  -> Streamable HTTP at 127.0.0.1:<port>/mcp
  -> MCP tool handlers
  -> PositronRuntimeAdapter
  -> @posit-dev/positron tryAcquirePositronApi()
  -> foreground live Positron R/Python session
```

Runtime integration is isolated in `src/positronRuntime.ts`; the transport knows only the `RuntimeAdapter` interface. Tests inject a mock adapter/API.

## Build and package

```bash
pnpm install
pnpm run check
pnpm test
pnpm run build
pnpm run package
```

The last command creates `positron-codex-mcp-0.1.0.vsix`.

Install it from Positron's **Extensions: Install from VSIX...** command, or run:

```bash
positron --install-extension positron-codex-mcp-0.1.0.vsix
```

Reload Positron after installation.

## Debug in Positron

Open this repository as a folder in Positron, select **Run and Debug**, choose **Run Positron Extension**, and press F5. The pre-launch task runs `pnpm run build`, then Positron opens an Extension Development Host with this workspace loaded as a development extension. Breakpoints in `src/**/*.ts` map through the generated source map.

Two additional launch profiles are available for tests:

- **Debug Current Vitest File** runs the currently active test file.
- **Debug All Vitest Tests** runs the complete test suite under the Node debugger.

The current-file profile expects the active editor to be a Vitest test file when launched.

## Start the server and discover its URL

The server starts after Positron startup by default. The status bar shows **Positron MCP** while it is running. Available commands are:

- `Positron Codex: Start MCP Server`
- `Positron Codex: Stop MCP Server`
- `Positron Codex: Restart MCP Server`
- `Positron Codex: Show MCP Endpoint`
- `Positron Codex: Copy MCP Endpoint`
- `Positron Codex: Show Diagnostics`

The Output panel's **Positron Codex MCP** channel also shows the endpoint. It logs lifecycle events, never tool arguments or variable contents.

`positronCodexMcp.port` defaults to `0`, asking the operating system for a free port. This is conflict-resistant, but the URL can change after a restart. For one-time Codex configuration, choose an unused fixed port in Positron settings (for example `37821`) and restart the MCP server.

## Configure Codex

Codex CLI 0.153.2 accepts a Streamable HTTP URL directly:

```bash
codex mcp add positron --url http://127.0.0.1:<PORT>/mcp
codex mcp get positron
```

Equivalent `~/.codex/config.toml`:

```toml
[mcp_servers.positron]
url = "http://127.0.0.1:<PORT>/mcp"
```

Replace `<PORT>` with the status-bar/Output value. If automatic port selection produces a new port, remove and re-add the entry or edit the TOML. No OpenAI API key is needed by this extension; Codex continues to use its own normal account authentication.

## Example use

In the R console:

```r
x <- 1:10
df <- iris
positron_mcp_identity <- new.env()
```

Or in the Python console:

```python
x = [1, 2, 3]
import pandas as pd
df = pd.DataFrame({"group": ["a", "a", "b"], "value": [1, 2, 20]})
positron_mcp_identity = object()
```

Then ask Codex:

> Inspect my current live interpreter. Tell me what variables exist, inspect `df`, then run an appropriate summary and explain anything unusual.

`positron_variables` should see the manually created identity object. `positron_execute` can then mutate it or create another object. Confirm that object immediately in the Positron Console. Because the adapter passes the already acquired foreground `session_id` to `runtime.executeCode`, seeing the mutation from both MCP and Console demonstrates that no subprocess was used.

## Tool behavior

### `positron_session`

Takes no arguments. Returns language, runtime, session ID/name/mode, last known runtime state, and the session's starting working directory when available. It returns `NO_ACTIVE_RUNTIME` rather than starting a session.

### `positron_variables`

Optional arguments:

```json
{ "name": "df", "max_variables": 200 }
```

Without `name`, it lists root variables. With `name`, it returns that variable and at most one level of children. Display values are capped at 2,000 characters and counts are capped, so this is metadata inspection rather than an object dump.

### `positron_execute`

```json
{ "code": "summary(df)", "mode": "transient", "timeout_ms": 60000 }
```

Only `transient` mode is accepted. The code is sent to the foreground session ID with console focus disabled. Runtime failures, interruption, timeout, and non-JSON result types have distinct statuses. A non-idle runtime is rejected instead of silently queueing work. On timeout the Positron cancellation token requests interruption of the running session. Static plots are attached as MCP image content when the current API emits them and the configured output cap does not truncate them.

## Security

This endpoint is a privileged local interface: calling `positron_execute` is equivalent to typing arbitrary code into your live interpreter.

- The HTTP listener binds only to `127.0.0.1`, never all interfaces.
- The MCP SDK's localhost Host-header/DNS-rebinding protection is enabled.
- Requests with a non-loopback `Origin` are rejected.
- No CORS headers are enabled.
- No credentials are accepted, forwarded, or logged.
- Tool inputs and variable contents are not logged.

Other processes running as your local user can generally reach localhost. Stop the server when it is not needed, and do not forward or proxy its port. This proof of concept intentionally has no bearer token because its endpoint must remain easy for the local Codex client to use; loopback is a boundary, not strong authentication.

## Current limitations

- Automated tests use public-API mocks; the final R/Python same-session workflow still requires an interactive Positron verification because this build environment has no running GUI console.
- `working_directory` is Positron's session metadata value (the starting directory), not a silently evaluated live `getwd()`/`os.getcwd()` value.
- Variables depend on the language runtime's Positron Variables provider being available.
- Only immediate variable children are returned; there is no recursive object dumping.
- Positron's execution observer currently emits only static plots and gives the extension plot data without its MIME type. The adapter detects SVG/JPEG signatures and otherwise treats the payload as PNG.
- There is no authentication beyond the loopback/network-origin restrictions.
- Dynamic ports require updating Codex after an extension-host restart; set a fixed port for durable configuration.

## Why Positron core changes are not required

The published public API exposes every operation needed for this proof of concept: `getForegroundSession()`, `getSessionVariables(sessionId, ...)`, and `executeCode(..., observer, sessionId, ...)`. Passing the foreground session ID prevents the documented fallback that may select or start a different session. The extension hosts its own small localhost MCP transport, so Positron core does not need a new server or authentication path.

## Remaining gaps vs Posit Assistant

This extension deliberately does not reproduce Posit Assistant. It lacks automatic dataframe profiling, deep table queries, console-history tooling, current Plots-pane introspection, dynamic-widget capture, notebook/editor context, package/module context, UI state, prompt orchestration, and Assistant authentication. The current public API does expose session table queries and privacy-gated console history for a later phase; they are not part of the initial three-tool proof of concept.

See `TECHNICAL_ASSESSMENT.md` for the API and feasibility investigation.
