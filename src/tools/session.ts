import type { RuntimeAdapter } from '../types';

export async function sessionTool(runtime: RuntimeAdapter) {
  return runtime.getSession();
}
