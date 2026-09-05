import type * as vscode from 'vscode';
import type { PositronApi, RuntimeVariable } from '@posit-dev/positron';
import type { CancellationSourceLike } from '../src/positronRuntime';

type ExecuteImplementation = PositronApi['runtime']['executeCode'];
type EvaluateImplementation = PositronApi['runtime']['evaluateCode'];

export interface MockApiOptions {
  language?: 'r' | 'python';
  active?: boolean;
  variables?: RuntimeVariable[][];
  execute?: ExecuteImplementation;
  evaluate?: EvaluateImplementation;
  state?: string;
}

export function createMockApi(options: MockApiOptions = {}): PositronApi {
  const language = options.language ?? 'r';
  const session = {
    metadata: {
      sessionId: `${language}-session-1`,
      sessionMode: 'console' as const,
      workingDirectory: '/workspace',
    },
    runtimeMetadata: {
      runtimeId: `${language}-runtime-1`,
      runtimeName: language === 'r' ? 'R 4.5.1' : 'Python 3.13.7',
      runtimeShortName: language === 'r' ? '4.5.1' : '3.13.7',
      runtimeVersion: language === 'r' ? '4.5.1' : '3.13.7',
      runtimeSource: 'System',
      languageName: language === 'r' ? 'R' : 'Python',
      languageId: language,
      languageVersion: language === 'r' ? '4.5.1' : '3.13.7',
    },
    getDynState: async () => ({
      inputPrompt: language === 'r' ? '>' : '>>>',
      continuationPrompt: language === 'r' ? '+' : '...',
      sessionName: `${language.toUpperCase()} Console`,
    }),
    getRuntimeState: () => options.state ?? 'idle',
  };

  const execute: ExecuteImplementation = options.execute ?? (async (
    _languageId,
    _code,
    _focus,
    _allowIncomplete,
    _mode,
    _errorBehavior,
    observer,
  ) => {
    observer?.onStarted?.();
    observer?.onOutput?.('ok\n');
    const result = { 'text/plain': '42' };
    observer?.onCompleted?.(result);
    observer?.onFinished?.();
    return result;
  });
  const evaluate: EvaluateImplementation = options.evaluate ?? (async () => ({
    result: 42,
    output: '',
  }));

  return {
    version: '2026.10.0',
    buildNumber: 9,
    RuntimeCodeExecutionMode: {
      Interactive: 'interactive',
      NonInteractive: 'non-interactive',
      Transient: 'transient',
      Silent: 'silent',
      Unprocessed: 'unprocessed',
    },
    RuntimeErrorBehavior: { Stop: 'stop', Continue: 'continue' },
    RuntimeBusyBehavior: { Queue: 'queue', Reject: 'reject' },
    runtime: {
      getForegroundSession: async () => options.active === false ? undefined : session,
      getSessionVariables: async (_sessionId: string, accessKeys?: string[][]) => {
        const variables = options.variables ?? [[]];
        return accessKeys ? variables.slice(1) : variables.slice(0, 1);
      },
      evaluateCode: evaluate,
      executeCode: execute,
    },
  } as unknown as PositronApi;
}

export function createCancellationSource(): CancellationSourceLike {
  let cancelled = false;
  const listeners = new Set<(event: void) => unknown>();
  return {
    token: {
      get isCancellationRequested() { return cancelled; },
      onCancellationRequested: listener => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    } as vscode.CancellationToken,
    cancel: () => {
      cancelled = true;
      for (const listener of listeners) listener(undefined);
    },
    dispose: () => listeners.clear(),
  };
}
