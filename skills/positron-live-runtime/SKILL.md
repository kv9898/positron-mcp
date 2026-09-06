---
name: positron-live-runtime
description: Use the connected Positron MCP tools when a request may depend on the user's current live R or Python session, console, variables, objects, or data.
---

# Positron live runtime

Use the connected Positron MCP server for information that may exist only in the user's active Positron R or Python session. Do not ask the user to repeat session values before checking it.

Start with `positron_session`. If no foreground runtime is active, explain that Positron must have an existing focused R or Python session; never start a new interpreter.

Use `positron_variables` to discover objects or inspect one object's immediate children. Use `positron_table_summary` for bounded native metadata and profiles of existing data frames or tables. Use `positron_evaluate` for calculations and other intended non-state-changing inspection.

Use `positron_execute` for any possible state change, including assignments, mutation, package loading, option or working-directory changes, random-number generation, plots, and file operations. It runs visibly and is recorded in console history. Treat its output as best-effort: do not repeat a state-changing call merely because it returns no output; verify through `positron_variables` or a separate evaluation.

Use `positron_console_history` only when recent console code, output, or errors are necessary, because history can contain sensitive runtime content. It may be unavailable when the user disables Positron's console-history privacy setting.

Silent evaluation is an intent boundary rather than a sandbox: arbitrary R or Python passed to `positron_evaluate` can still mutate state. Do not try to infer mutation by parsing code.
