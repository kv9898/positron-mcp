---
name: positron
description: Inspect the connected live Positron R or Python session before using a terminal or asking the user for session data.
---

# Positron

When this skill applies, invoke the Positron MCP tools. Treat the live Positron session as the primary source for R/Python state, console context, variables, objects, and data the agent has not already seen. Do not ask the user to repeat that information or substitute terminal-based R/Python inspection.

Start with `positron_session`. If it reports an active session, use `positron_variables` to discover relevant objects before reasoning from their contents. When a request depends on an unseen value, object, dataframe, result, or prior console activity, assume it may be in that session and inspect it. Use the terminal only for repository files, system state, or work outside the live session.

Use `positron_table_summary` for native dataframe/table orientation; `positron_evaluate` for intended non-state-changing calculations and inspection; and `positron_execute` for any possible state change. `positron_execute` is visible and recorded in console history: never repeat it merely because output is empty—verify with variables or a separate evaluation.

Use `positron_console_history` only when recent console code, output, or errors are needed, as it can contain sensitive content. If there is no active foreground runtime, explain that Positron needs an existing focused R or Python session; never start one.

Silent evaluation is not a read-only sandbox: do not try to infer mutation by parsing arbitrary R or Python code.
