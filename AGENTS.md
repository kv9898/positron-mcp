# Repository instructions

Read `README.md` for user-facing behavior and `TECHNICAL_ASSESSMENT.md` for the API feasibility record. Keep this file focused on maintenance rules and decisions that are easy to miss from those documents.

## Release artifacts

- Do not change the extension version unless the user explicitly requests a version bump. The version is duplicated in `package.json`, the MCP server identity in `src/mcpServer.ts`, and diagnostics in `src/extension.ts`; an authorized bump must keep them synchronized.
- Do not run `pnpm run package`, invoke `vsce package`, or create or replace a release VSIX unless the user explicitly asks for a VSIX build/package operation.
- Do not edit `dist/` or a `.vsix` directly. They are generated artifacts.
- `pnpm run check` and `pnpm test` are the normal non-release verification commands. Do not substitute a successful bundle build for either check.

## Implementation boundaries

- Use TypeScript and pnpm. Keep `@posit-dev/positron` as the source of public Positron API types; do not recreate a local Positron declaration shim or depend on private Positron internals.
- Keep `RuntimeAdapter` in `src/types.ts` as the boundary between MCP transport/tool code and Positron integration. MCP tests should use this interface; Positron adapter tests should use the public-API mock in `test/helpers.ts`.
- Always pass the acquired foreground `session_id` to runtime operations. Never allow an omitted session ID to select or start another interpreter.
- A change to an MCP input or result must be reflected together in the Zod schema, shared TypeScript types, adapter/tool plumbing, MCP discovery tests, and user documentation.
- Preserve the two-tool code boundary: `positron_evaluate` uses `evaluateCode` for silent result-returning inspection, while `positron_execute` uses `executeCode` in `NonInteractive` mode for visible, history-recorded state changes. Do not restore client-selectable execution modes.
- Silent evaluation is an intent boundary, not enforced read-only execution. Do not attempt to infer mutation by parsing arbitrary R or Python code.
- Treat transparent execution results and successful output as best-effort. Never retry a potentially state-changing call merely because its result is empty; verify through variables or a separate evaluation.

## Configuration and lifecycle decisions

- The port is a user setting, not a command. Do not reintroduce a dedicated port-configuration command.
- Do not edit Codex configuration automatically. Setup actions may copy commands to the clipboard and explain that the Codex host must reload.
- Treat port `0` as dynamic: never predict or copy its endpoint until the restarted server has reported the allocated port.
- First-install and port-change notices must remain non-blocking and must not expose code, variable values, credentials, or other runtime contents.

## Change discipline

- Preserve unrelated user changes in a dirty worktree.
- Keep lifecycle logs metadata-only. Never log tool arguments, executed code, variable contents, results, or credentials.
- When changing activation, restart, or disposal behavior, verify that active MCP transports and the Node listener are still closed on stop and deactivation.
- For code-running changes, cover evaluation and transparent execution success plus relevant timeout, interruption, unsupported-result, state, result/output truncation, and exact session targeting. The HTTP-level test should continue to exercise initialization, discovery, and both code tools through a real loopback Streamable HTTP connection.
