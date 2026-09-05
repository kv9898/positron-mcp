import type { PositronApi, RuntimeVariable } from '@posit-dev/positron';
import { describe, expect, it, vi } from 'vitest';
import { PositronRuntimeAdapter } from '../src/positronRuntime';
import { NoActiveRuntimeError } from '../src/types';
import { createCancellationSource, createMockApi } from './helpers';

function adapter(api: PositronApi, timeoutMs = 1000) {
  return new PositronRuntimeAdapter(api, createCancellationSource, {
    timeoutMs,
    maxOutputCharacters: 10000,
  });
}

describe('PositronRuntimeAdapter', () => {
  it('returns a structured no-active-runtime error', async () => {
    await expect(adapter(createMockApi({ active: false })).getSession())
      .rejects.toBeInstanceOf(NoActiveRuntimeError);
  });

  it.each([
    ['r', 'R 4.5.1'],
    ['python', 'Python 3.13.7'],
  ] as const)('reports an active %s session', async (language, runtimeName) => {
    const session = await adapter(createMockApi({ language })).getSession();
    expect(session).toMatchObject({
      language,
      runtime: runtimeName,
      session_id: `${language}-session-1`,
      working_directory: '/workspace',
      state: 'idle',
    });
  });

  it('retrieves variable metadata and one level of children', async () => {
    const root: RuntimeVariable = {
      access_key: 'df', display_name: 'df', display_type: 'data.frame',
      display_value: '10 rows x 2 columns', type_info: 'data.frame',
      length: 2, size: 1024, has_children: true,
    };
    const child: RuntimeVariable = {
      access_key: 'a', display_name: 'a', display_type: 'integer',
      display_value: '1 2 3', length: 10, size: 96, has_children: false,
    };
    const result = await adapter(createMockApi({ variables: [[root], [child]] }))
      .getVariables({ name: 'df' });
    expect(result.variables[0]).toMatchObject({
      name: 'df', type: 'data.frame', children: [{ name: 'a', type: 'integer' }],
    });
  });

  it('captures successful execution from the existing session', async () => {
    const execute = vi.fn(async (...args: Parameters<PositronApi['runtime']['executeCode']>) => {
      args[6]?.onStarted?.();
      args[6]?.onOutput?.('summary output\n');
      return { 'text/plain': 'result' };
    });
    const result = await adapter(createMockApi({ execute })).execute('summary(df)');
    expect(result).toMatchObject({ success: true, status: 'success', stdout: 'summary output\n' });
    expect(execute.mock.calls[0]?.[7]).toBe('r-session-1');
    expect(execute.mock.calls[0]?.[4]).toBe('transient');
  });

  it('returns runtime execution errors without swallowing them', async () => {
    const runtimeError = Object.assign(new Error('object not found'), { name: 'RuntimeError' });
    const result = await adapter(createMockApi({ execute: async () => { throw runtimeError; } }))
      .execute('missing_object');
    expect(result).toMatchObject({
      success: false,
      status: 'error',
      error: { name: 'RuntimeError', message: 'object not found' },
    });
  });

  it('distinguishes interrupted execution', async () => {
    const result = await adapter(createMockApi({
      execute: async () => { throw Object.assign(new Error('Execution interrupted'), { name: 'InterruptedError' }); },
    })).execute('long_running()');
    expect(result.status).toBe('interrupted');
  });

  it('distinguishes an unsupported non-JSON result', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = await adapter(createMockApi({ execute: async () => cyclic })).execute('value');
    expect(result).toMatchObject({
      success: false,
      status: 'unsupported_result',
      error: { name: 'UnsupportedResultTypeError' },
    });
  });

  it('requests interruption and reports a timeout', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = adapter(createMockApi({
        execute: async (...args) => new Promise((_resolve, reject) => {
          args[6]?.token?.onCancellationRequested(() => reject(new Error('cancelled')));
        }),
      }), 1000).execute('long_running()');
      await vi.advanceTimersByTimeAsync(1001);
      await expect(resultPromise).resolves.toMatchObject({ success: false, status: 'timed_out' });
    } finally {
      vi.useRealTimers();
    }
  });
});
