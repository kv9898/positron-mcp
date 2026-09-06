# Positron Codex MCP

This standalone TypeScript extension exposes the **existing foreground Positron R or Python session** to a trusted local MCP client such as Codex. It does not spawn R or Python, proxy OpenAI requests, or handle OpenAI credentials.

The extension provides six tools:

- `positron_session` — foreground session/runtime metadata.
- `positron_variables` — bounded variable metadata, optionally including one object's immediate children.
- `positron_table_summary` — bounded native table/data-frame metadata and column profiles.
- `positron_console_history` — bounded recent completed console entries, subject to Positron's history privacy setting.
- `positron_evaluate` — silent, result-returning calculation and inspection in that exact foreground session.
- `positron_execute` — visible, history-recorded state-changing execution, with best-effort output and static plot attachments where Positron emits them.

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

Open this repository as a folder in Positron and use one of these Run and Debug profiles:

- **Run Positron Extension** runs the `pnpm: build` task once before F5 launches the Extension Development Host.
- **Run Positron Extension (Watch)** starts `pnpm run build:watch`, waits for the initial bundle, and then launches the Extension Development Host. Subsequent source edits rebuild `dist/extension.js` automatically.

Breakpoints in `src/**/*.ts` map through the generated source map. After a watched rebuild, run **Developer: Reload Window** in the Extension Development Host to load the new extension bundle; rebuilding does not hot-replace an already activated extension.

Ctrl+Shift+B runs **pnpm: build**, the default one-shot build task. To start the persistent watcher without launching the debugger, run **Tasks: Run Build Task** and select **pnpm: watch**.

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
- `Positron Codex: Copy Codex MCP Setup Commands`
- `Positron Codex: Copy Codex Skill Install Command`
- `Positron Codex: Show Diagnostics`

The Output panel's **Positron Codex MCP** channel also shows the endpoint. It logs lifecycle events, never tool arguments or variable contents.

`positronCodexMcp.port` defaults to the stable loopback port `37821`. This keeps the MCP URL unchanged across Positron restarts, so Codex only needs to be configured once. Change it through the `positronCodexMcp.port` user setting in Positron Settings. Port `0` remains available as an explicit opt-in to automatic, non-stable port selection.

On first installation, the extension displays a non-blocking notification offering both the Codex MCP setup commands and an install command for the included `positron` skill. The extension never changes Codex configuration itself: run the copied command, then reload the Codex host so it discovers the skill. It also displays an update notification whenever the configured port changes, including changes made directly in Positron Settings. The update action can restart the server and copy replacement Codex commands in one step.

## Helping Codex choose the Positron tools

The MCP server supplies usage instructions during initialization and gives each tool a trigger-oriented description. The guidance tells MCP clients to check Positron whenever a request refers to the current/live R or Python interpreter, console, session, variables, objects, or data that is not present in the prompt or repository. It also tells the client not to ask for those values, or claim that no live interpreter exists, before calling `positron_session`.

For example, if `a` and `b` exist only in the Positron Console, a request such as “calculate `a + b`” should lead Codex to discover the live variables and evaluate the expression through this MCP server. Explicitly saying “use Positron” remains a useful override because tool selection is ultimately decided by the MCP client and model.

The server directs native table/data-frame orientation to `positron_table_summary`, and calculations, language-specific summaries, comparisons, and other inspection to `positron_evaluate`. It directs assignments, mutation, package loading, option or working-directory changes, random-number generation, plots, file operations, and other side effects to `positron_execute`. `positron_console_history` is reserved for requests that need recent console context because it can contain sensitive content. If transparent execution returns no result, Codex is told to verify the state through `positron_variables` or a separate evaluation rather than repeating the mutation.

The included `positron` skill reinforces this behavior when installed in Codex. It directs the agent to treat unseen live R/Python state as session information to inspect before using a terminal or asking the user. The skill uses the portable `SKILL.md` format, so other agents that support that format can reuse it, but the one-click discovery/install prompt currently targets Codex.

## Configure Codex

Codex CLI 0.153.2 accepts a Streamable HTTP URL directly:

```bash
codex mcp add positron --url http://127.0.0.1:37821/mcp
codex mcp get positron
```

Equivalent `~/.codex/config.toml`:

```toml
[mcp_servers.positron]
url = "http://127.0.0.1:37821/mcp"
```

The Codex CLI and IDE extension share this configuration, but an already-running Codex host may retain the MCP catalog created at startup. After adding or changing the server, run **Developer: Reload Window** in Positron once. The fixed port means subsequent Positron starts do not require another `codex mcp add`.

If an older installation already registered a random port, replace it once:

```bash
codex mcp remove positron
codex mcp add positron --url http://127.0.0.1:37821/mcp
```

Then reload the Positron window. No OpenAI API key is needed by this extension; Codex continues to use its own normal account authentication.

### Install the included Codex skill

Run **Positron Codex: Copy Codex Skill Install Command**, then run the copied command in your shell and reload the Codex host. This copies the bundled `skills/positron` folder into Codex's skills directory without the extension editing Codex configuration itself. Once installed, Codex can select it automatically when a request may depend on the live Positron session; you can also explicitly invoke it with `$positron`.

The explicit skill shorthand is `$positron`. The extension cannot register a literal `/pos` chat command in Codex; slash commands are owned by the Codex host.

The `SKILL.md` file is portable to other agents that support the Agent Skills format, but their skill-directory locations and reload behavior vary. The extension only provides an automated install command for Codex.

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

`positron_variables` should see the manually created identity object. `positron_table_summary` can inspect `df` without evaluating code, while `positron_evaluate` can run language-specific calculations without displaying code in the console. `positron_execute` can then mutate the identity object or create another object; this code is displayed and added to console history. Because the adapter passes the already acquired foreground `session_id` to every runtime API, seeing the mutation from both MCP and Console demonstrates that no subprocess was used.

## Tool behavior

### `positron_session`

Takes no arguments. Returns language, runtime, session ID/name/mode, last known runtime state, and the session's starting working directory when available. It returns `NO_ACTIVE_RUNTIME` rather than starting a session.

### `positron_variables`

Optional arguments:

```json
{ "name": "df", "max_variables": 200 }
```

Without `name`, it lists root variables. With `name`, it returns that variable and at most one level of children. Display values are capped at 2,000 characters and counts are capped, so this is metadata inspection rather than an object dump.

### `positron_table_summary`

```json
{ "names": ["df"] }
```

Returns Positron's native summary for existing data frames or tables in the foreground session: row and column counts, column schemas, and column profiles. Names may be displayed variable names or Positron access keys. First use `positron_variables` to find the relevant object. The result is bounded by the configured output cap and does not evaluate code or change the session.

### `positron_console_history`

```json
{ "max_entries": 5 }
```

Returns the requested number of most recent completed console executions, oldest first, with their code, output, errors, and timestamps. This is read-only but may reveal sensitive runtime content, so use it only when the recent console context is needed. It respects Positron's `console.historyApiEnabled` privacy setting and returns `CONSOLE_HISTORY_DISABLED` when that setting is off. Text is bounded by the configured output cap.

### `positron_evaluate`

```json
{ "code": "summary(df)", "timeout_ms": 60000 }
```

Uses Positron's `evaluateCode()` API to run silently and return a JSON-compatible `result` plus combined `output`. It is intended for calculations and inspection that do not change interpreter or external state. It has no plot callback and does not separate stdout from stderr.

Silent evaluation is an intent boundary, not a sandbox: arbitrary R or Python code can still mutate state. The server does not attempt to infer mutation by parsing code.

### `positron_execute`

```json
{ "code": "summary_result <- summary(df)", "timeout_ms": 60000 }
```

Uses Positron's `executeCode()` API in `non-interactive` mode. Code is displayed and stored in console history without combining with pending console input. Use it for any potentially state-changing operation, including assignments, mutation, deletion, package loading, option or working-directory changes, random-number generation, plots, and file operations.

Returned results, stdout, and stderr are best-effort because Positron does not consistently emit successful execution output through this API. An empty result does not mean execution failed and must not trigger an automatic retry. Verify important state changes with `positron_variables` or a subsequent `positron_evaluate`. Static plots are attached as MCP image content when Positron emits them and the configured output cap does not truncate them.

Both code tools reject a non-idle runtime instead of queueing work, request interruption on timeout, and always target the acquired foreground session ID.

## Security

This endpoint is a privileged local interface: both code tools can run arbitrary code in your live interpreter.

- The HTTP listener binds only to `127.0.0.1`, never all interfaces.
- The MCP SDK's localhost Host-header/DNS-rebinding protection is enabled.
- Requests with a non-loopback `Origin` are rejected.
- No CORS headers are enabled.
- No credentials are accepted, forwarded, or logged.
- Tool inputs and variable contents are not logged.

Other processes running as your local user can generally reach localhost. Stop the server when it is not needed, and do not forward or proxy its port. The endpoint has no bearer token because it must remain easy for the local Codex client to use; loopback is a boundary, not strong authentication.

## Current limitations

- Automated tests use public-API mocks; the final R/Python same-session workflow still requires an interactive Positron verification because this build environment has no running GUI console.
- `working_directory` is Positron's session metadata value (the starting directory), not a silently evaluated live `getwd()`/`os.getcwd()` value.
- Variables depend on the language runtime's Positron Variables provider being available.
- Only immediate variable children are returned; there is no recursive object dumping.
- Silent evaluation returns combined output and has no plot callback or separate stderr channel.
- Transparent execution results and successful output are best-effort because of current `executeCode()` observer limitations.
- Positron's execution observer currently emits only static plots and gives the extension plot data without its MIME type. The adapter detects SVG/JPEG signatures and otherwise treats the payload as PNG.
- There is no authentication beyond the loopback/network-origin restrictions.
- Port `0` is intentionally non-stable and requires updating/reloading Codex when it changes; the default fixed port avoids that lifecycle problem.

## Why Positron core changes are not required

The published public API exposes every operation needed by this extension: `getForegroundSession()`, `getSessionVariables(sessionId, ...)`, `querySessionTables(sessionId, ...)`, `getConsoleHistory(sessionId, ...)`, `evaluateCode(..., sessionId, ...)`, and `executeCode(..., observer, sessionId, ...)`. Passing the foreground session ID prevents the documented fallback that may select or start a different session. The extension hosts its own small localhost MCP transport, so Positron core does not need a new server or authentication path.

## Remaining gaps vs Posit Assistant

This extension deliberately does not reproduce Posit Assistant. It lacks automatic dataframe profiling, deep table queries, console-history search, current Plots-pane introspection, dynamic-widget capture, notebook/editor context, package/module context, UI state, prompt orchestration, and Assistant authentication. It provides bounded native table summaries and privacy-gated recent console history, rather than the broader Assistant experience.
