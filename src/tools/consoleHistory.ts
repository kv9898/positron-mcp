import type { RuntimeAdapter } from '../types';

export async function consoleHistoryTool(
  runtime: RuntimeAdapter,
  input: { max_entries?: number },
) {
  return runtime.getConsoleHistory(input.max_entries);
}
