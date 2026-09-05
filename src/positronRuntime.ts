import type * as vscode from 'vscode';
import type {
  BaseLanguageRuntimeSession,
  PositronApi,
  RuntimeVariable,
} from '@posit-dev/positron';
import {
  type ExecutionResult,
  type ExecutionMode,
  NoActiveRuntimeError,
  type RuntimeAdapter,
  type SessionInfo,
  type VariableInfo,
  type VariablesResult,
} from './types';

export interface CancellationSourceLike {
  readonly token: vscode.CancellationToken;
  cancel(): void;
  dispose(): void;
}

export type CancellationSourceFactory = () => CancellationSourceLike;

export interface RuntimeAdapterOptions {
  timeoutMs: number;
  maxOutputCharacters: number;
  maxDisplayValueCharacters?: number;
}

const DEFAULT_MAX_VARIABLES = 200;

export class PositronRuntimeAdapter implements RuntimeAdapter {
  constructor(
    private readonly api: PositronApi,
    private readonly createCancellationSource: CancellationSourceFactory,
    private readonly options: RuntimeAdapterOptions,
  ) {}

  async getSession(): Promise<SessionInfo> {
    const session = await this.requireForegroundSession();
    const dynamicState = await session.getDynState();
    const runtime = session.runtimeMetadata;

    return {
      language: runtime.languageId,
      language_name: runtime.languageName,
      language_version: runtime.languageVersion,
      runtime: runtime.runtimeName,
      runtime_version: runtime.runtimeVersion,
      runtime_source: runtime.runtimeSource,
      runtime_id: runtime.runtimeId,
      session_id: session.metadata.sessionId,
      session_name: dynamicState.sessionName,
      session_mode: session.metadata.sessionMode,
      working_directory: session.metadata.workingDirectory,
      state: session.getRuntimeState?.() ?? 'unknown',
    };
  }

  async getVariables(options: { name?: string; maxVariables?: number } = {}): Promise<VariablesResult> {
    const session = await this.requireForegroundSession();
    const maxVariables = clampInteger(options.maxVariables ?? DEFAULT_MAX_VARIABLES, 1, 1000);
    const rootGroups = await this.api.runtime.getSessionVariables(session.metadata.sessionId);
    const roots = rootGroups.flat();
    let selected = roots;
    let children: RuntimeVariable[] | undefined;

    if (options.name) {
      const match = roots.find(variable =>
        variable.display_name === options.name || variable.access_key === options.name,
      );
      if (!match) {
        throw namedError(
          'VARIABLE_NOT_FOUND',
          `Variable '${options.name}' was not found in the foreground ${session.runtimeMetadata.languageName} session.`,
        );
      }
      selected = [match];
      if (match.has_children) {
        const childGroups = await this.api.runtime.getSessionVariables(
          session.metadata.sessionId,
          [[match.access_key]],
        );
        children = childGroups[0] ?? [];
      }
    }

    const truncated = selected.length > maxVariables || (children?.length ?? 0) > maxVariables;
    const variables = selected.slice(0, maxVariables).map(variable => {
      const mapped = this.mapVariable(variable);
      if (options.name && children) {
        mapped.children = children.slice(0, maxVariables).map(child => this.mapVariable(child));
      }
      return mapped;
    });

    return {
      session_id: session.metadata.sessionId,
      language: session.runtimeMetadata.languageId,
      requested_name: options.name,
      variables,
      truncated,
    };
  }

  async execute(
    code: string,
    timeoutMs = this.options.timeoutMs,
    mode: ExecutionMode = 'transient',
  ): Promise<ExecutionResult> {
    if (!code.trim()) {
      throw namedError('INVALID_ARGUMENT', 'Code must not be empty.');
    }

    const session = await this.requireForegroundSession();
    const runtimeState = session.getRuntimeState?.();
    if (runtimeState && runtimeState !== 'idle') {
      throw namedError(
        'RUNTIME_NOT_IDLE',
        `The foreground Positron runtime is ${runtimeState}; execution was not queued. Wait until it is idle and try again.`,
      );
    }
    const cancellation = this.createCancellationSource();
    const startedAt = Date.now();
    let started = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    let outputTruncated = false;
    const plots: ExecutionResult['plots'] = [];

    const append = (current: string, value: string): string => {
      const remaining = this.options.maxOutputCharacters - current.length;
      if (remaining <= 0) {
        outputTruncated = true;
        return current;
      }
      if (value.length > remaining) {
        outputTruncated = true;
        return current + value.slice(0, remaining);
      }
      return current + value;
    };

    const effectiveTimeoutMs = clampInteger(timeoutMs, 1000, 600000);
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        cancellation.cancel();
        reject(namedError('ExecutionTimeoutError', `Execution exceeded ${effectiveTimeoutMs} ms.`));
      }, effectiveTimeoutMs);
    });

    try {
      const execution = this.api.runtime.executeCode(
        session.runtimeMetadata.languageId,
        code,
        false,
        false,
        executionMode(this.api, mode),
        this.api.RuntimeErrorBehavior.Stop,
        {
          token: cancellation.token,
          onStarted: () => { started = true; },
          onOutput: message => { stdout = append(stdout, message); },
          onError: message => { stderr = append(stderr, message); },
          onPlot: data => {
            const limited = limitText(data, this.options.maxOutputCharacters);
            plots.push({
              mime_type: inferPlotMimeType(data),
              data: limited.value,
              truncated: limited.truncated,
            });
          },
        },
        session.metadata.sessionId,
        undefined,
        { source: 'positron-codex-mcp' },
        { client: 'Codex MCP' },
      );
      const result = await Promise.race([execution, timeout]);

      const limitedResult = limitJson(result, this.options.maxOutputCharacters);
      outputTruncated ||= limitedResult.truncated;
      if (limitedResult.unsupported) {
        return {
          success: false,
          status: 'unsupported_result',
          session_id: session.metadata.sessionId,
          language: session.runtimeMetadata.languageId,
          mode,
          started,
          stdout,
          stderr,
          result: {},
          plots,
          output_truncated: outputTruncated,
          elapsed_ms: Date.now() - startedAt,
          error: {
            name: 'UnsupportedResultTypeError',
            message: limitedResult.unsupported,
          },
        };
      }
      return {
        success: true,
        status: 'success',
        session_id: session.metadata.sessionId,
        language: session.runtimeMetadata.languageId,
        mode,
        started,
        stdout,
        stderr,
        result: limitedResult.value,
        plots,
        output_truncated: outputTruncated,
        elapsed_ms: Date.now() - startedAt,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      const interrupted = /interrupt|cancel/i.test(`${normalized.name} ${normalized.message}`);
      return {
        success: false,
        status: timedOut ? 'timed_out' : interrupted ? 'interrupted' : 'error',
        session_id: session.metadata.sessionId,
        language: session.runtimeMetadata.languageId,
        mode,
        started,
        stdout,
        stderr,
        result: {},
        plots,
        output_truncated: outputTruncated,
        elapsed_ms: Date.now() - startedAt,
        error: {
          name: timedOut ? 'ExecutionTimeoutError' : normalized.name,
          message: timedOut
            ? `Execution exceeded ${effectiveTimeoutMs} ms and interruption was requested.`
            : normalized.message,
          traceback: normalized.stack,
        },
      };
    } finally {
      clearTimeout(timer!);
      cancellation.dispose();
    }
  }

  private async requireForegroundSession(): Promise<BaseLanguageRuntimeSession> {
    const session = await this.api.runtime.getForegroundSession();
    if (!session) {
      throw new NoActiveRuntimeError();
    }
    return session;
  }

  private mapVariable(variable: RuntimeVariable): VariableInfo {
    const display = limitText(
      variable.display_value,
      this.options.maxDisplayValueCharacters ?? 2000,
    );
    return {
      name: variable.display_name,
      access_key: variable.access_key,
      type: variable.type_info ?? variable.display_type,
      display_type: variable.display_type,
      display_value: display.value + (display.truncated ? '…' : ''),
      length: variable.length,
      size: variable.size,
      has_children: variable.has_children,
    };
  }
}

function executionMode(api: PositronApi, mode: ExecutionMode) {
  switch (mode) {
    case 'non-interactive': return api.RuntimeCodeExecutionMode.NonInteractive;
    case 'silent': return api.RuntimeCodeExecutionMode.Silent;
    case 'transient': return api.RuntimeCodeExecutionMode.Transient;
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}

function limitText(value: string, maximum: number): { value: string; truncated: boolean } {
  return value.length > maximum
    ? { value: value.slice(0, maximum), truncated: true }
    : { value, truncated: false };
}

function limitJson(
  value: Record<string, unknown>,
  maximum: number,
): { value: Record<string, unknown>; truncated: boolean; unsupported?: string } {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    return {
      value: {},
      truncated: false,
      unsupported: `The runtime returned a result that cannot be represented as JSON: ${normalizeError(error).message}`,
    };
  }
  if (serialized.length <= maximum) return { value, truncated: false };
  return {
    value: {
      truncated: true,
      preview: serialized.slice(0, maximum),
    },
    truncated: true,
  };
}

function inferPlotMimeType(data: string): string {
  if (data.trimStart().startsWith('<svg')) return 'image/svg+xml';
  if (data.startsWith('/9j/')) return 'image/jpeg';
  return 'image/png';
}
