import type { RuntimeAdapter } from '../types';

export async function variablesTool(
  runtime: RuntimeAdapter,
  input: { name?: string; max_variables?: number },
) {
  return runtime.getVariables({ name: input.name, maxVariables: input.max_variables });
}
