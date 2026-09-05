import type { RuntimeAdapter } from '../types';

export async function executeTool(
  runtime: RuntimeAdapter,
  input: { code: string; mode?: 'transient'; timeout_ms?: number },
) {
  return runtime.execute(input.code, input.timeout_ms);
}
