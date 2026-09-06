import type { RuntimeAdapter } from '../types';

export async function tableSummaryTool(
  runtime: RuntimeAdapter,
  input: { names: string[] },
) {
  return runtime.getTableSummaries(input.names);
}
