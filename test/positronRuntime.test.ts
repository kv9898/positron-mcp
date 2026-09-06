import type { PositronApi, RuntimeVariable } from '@posit-dev/positron';
import { describe, expect, it, vi } from 'vitest';
import { PositronRuntimeAdapter } from '../src/positronRuntime';
import { NoActiveRuntimeError } from '../src/types';
import { createCancellationSource, createMockApi } from './helpers';

function adapter(api: PositronApi, timeoutMs = 1000, maxOutputCharacters = 10000) {
  return new PositronRuntimeAdapter(api, createCancellationSource, {
    timeoutMs,
    maxOutputCharacters,
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

  it('returns bounded native table summaries for exact foreground-session variables', async () => {
    const df: RuntimeVariable = {
      access_key: 'df-key', display_name: 'df', display_type: 'data.frame',
      display_value: '10 rows x 2 columns', length: 2, size: 1024, has_children: true,
    };
    const tableSummaries = vi.fn(async (..._args: Parameters<PositronApi['runtime']['querySessionTables']>) => [{
      num_rows: 10,
      num_columns: 2,
      column_schemas: ['species: string', 'value: number'],
      column_profiles: ['3 distinct values', 'min=1, max=20'],
    }]);
    const result = await adapter(createMockApi({ variables: [[df]], tableSummaries }))
      .getTableSummaries(['df']);

    expect(result).toMatchObject({
      session_id: 'r-session-1',
      language: 'r',
      tables: [{ name: 'df', access_key: 'df-key', num_rows: 10, num_columns: 2 }],
      truncated: false,
    });
    expect(tableSummaries).toHaveBeenCalledWith('r-session-1', [['df-key']], ['summary']);
  });

  it('bounds table-summary text at the configured output cap', async () => {
    const df: RuntimeVariable = {
      access_key: 'df', display_name: 'df', display_type: 'data.frame',
      display_value: '', length: 1, size: 1, has_children: true,
    };
    const result = await adapter(createMockApi({
      variables: [[df]],
      tableSummaries: async () => [{
        num_rows: 1, num_columns: 1, column_schemas: ['abcdefghijklmnop'], column_profiles: ['profile'],
      }],
    }), 1000, 10).getTableSummaries(['df']);
    expect(result).toMatchObject({
      tables: [{ column_schemas: ['abcdefghij'], column_profiles: [] }],
      truncated: true,
    });
  });

  it('returns bounded recent history from the exact foreground session', async () => {
    const consoleHistory = vi.fn(async (..._args: Parameters<PositronApi['runtime']['getConsoleHistory']>) => [{
      input: 'x <- 1', output: '[1] 1', when: 123, error: undefined,
    }]);
    const result = await adapter(createMockApi({ consoleHistory })).getConsoleHistory(7);
    expect(result).toMatchObject({
      session_id: 'r-session-1', language: 'r',
      entries: [{ input: 'x <- 1', output: '[1] 1', when: 123 }], truncated: false,
    });
    expect(consoleHistory).toHaveBeenCalledWith('r-session-1', 7);
  });

  it('bounds console-history content and reports the history privacy setting', async () => {
    const bounded = await adapter(createMockApi({
      consoleHistory: async () => [{ input: 'abcdefghijklmnop', output: 'output', when: 123 }],
    }), 1000, 10).getConsoleHistory();
    expect(bounded).toMatchObject({ entries: [{ input: 'abcdefghij', output: '' }], truncated: true });

    await expect(adapter(createMockApi({
      consoleHistory: async () => { throw new Error('console.historyApiEnabled is disabled'); },
    })).getConsoleHistory()).rejects.toMatchObject({
      name: 'CONSOLE_HISTORY_DISABLED', code: 'CONSOLE_HISTORY_DISABLED',
    });
  });

  it('silently evaluates code and returns its scalar result and combined output', async () => {
    const evaluate = vi.fn(async (..._args: Parameters<PositronApi['runtime']['evaluateCode']>) => ({
      result: 3,
      output: 'calculated\n',
    }));
    const result = await adapter(createMockApi({ evaluate })).evaluate('a + b');

    expect(result).toMatchObject({
      success: true,
      status: 'success',
      mode: 'silent',
      output: 'calculated\n',
      result: 3,
    });
    expect(evaluate.mock.calls[0]?.[0]).toBe('r');
    expect(evaluate.mock.calls[0]?.[2]).toBeDefined();
    expect(evaluate.mock.calls[0]?.[3]).toBe('r-session-1');
    expect(evaluate.mock.calls[0]?.[4]).toBe('reject');
  });

  it('truncates silent evaluation output and JSON results', async () => {
    const result = await adapter(createMockApi({
      evaluate: async () => ({
        result: { value: 'abcdefghijklmnop' },
        output: 'abcdefghijklmnop',
      }),
    }), 1000, 10).evaluate('summary(df)');

    expect(result).toMatchObject({
      success: true,
      output: 'abcdefghij',
      result: { truncated: true, preview: '{"value":"' },
      output_truncated: true,
    });
  });

  it('returns silent evaluation errors', async () => {
    const result = await adapter(createMockApi({
      evaluate: async () => { throw Object.assign(new Error('object not found'), { name: 'RuntimeError' }); },
    })).evaluate('missing_object');
    expect(result).toMatchObject({
      success: false,
      status: 'error',
      mode: 'silent',
      error: { name: 'RuntimeError', message: 'object not found' },
    });
  });

  it('rejects unsupported silent evaluation results', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = await adapter(createMockApi({
      evaluate: async () => ({ result: cyclic, output: '' }),
    })).evaluate('value');
    expect(result).toMatchObject({
      success: false,
      status: 'unsupported_result',
      mode: 'silent',
      error: { name: 'UnsupportedResultTypeError' },
    });
  });

  it('requests cancellation and reports a silent evaluation timeout', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = adapter(createMockApi({
        evaluate: async (...args) => new Promise((_resolve, reject) => {
          args[2]?.onCancellationRequested(() => reject(new Error('cancelled')));
        }),
      }), 1000).evaluate('long_running()');
      await vi.advanceTimersByTimeAsync(1001);
      await expect(resultPromise).resolves.toMatchObject({
        success: false,
        status: 'timed_out',
        mode: 'silent',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects evaluation and execution while the foreground runtime is busy', async () => {
    const busy = adapter(createMockApi({ state: 'busy' }));
    await expect(busy.evaluate('a + b')).rejects.toMatchObject({ name: 'RUNTIME_NOT_IDLE' });
    await expect(busy.execute('x <- a + b')).rejects.toMatchObject({ name: 'RUNTIME_NOT_IDLE' });
  });

  it('captures transparent execution output and plots from the existing session', async () => {
    const execute = vi.fn(async (...args: Parameters<PositronApi['runtime']['executeCode']>) => {
      args[6]?.onStarted?.();
      args[6]?.onOutput?.('summary output\n');
      args[6]?.onPlot?.('iVBORw0KGgo=');
      return { 'text/plain': 'result' };
    });
    const result = await adapter(createMockApi({ execute })).execute('x <- summary(df)');
    expect(result).toMatchObject({
      success: true,
      status: 'success',
      mode: 'non-interactive',
      stdout: 'summary output\n',
      plots: [{ mime_type: 'image/png', data: 'iVBORw0KGgo=', truncated: false }],
    });
    expect(execute.mock.calls[0]?.[7]).toBe('r-session-1');
    expect(execute.mock.calls[0]?.[4]).toBe('non-interactive');
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
