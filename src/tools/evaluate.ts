import type { RuntimeAdapter } from '../types';

export async function evaluateTool(
  runtime: RuntimeAdapter,
  input: { code: string; timeout_ms?: number },
) {
  return runtime.evaluate(input.code, input.timeout_ms);
}
