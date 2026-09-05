export type RuntimeState =
  | 'uninitialized'
  | 'initializing'
  | 'starting'
  | 'ready'
  | 'idle'
  | 'busy'
  | 'restarting'
  | 'exiting'
  | 'exited'
  | 'offline'
  | 'interrupting'
  | 'unknown';

export interface SessionInfo {
  language: string;
  language_name: string;
  language_version: string;
  runtime: string;
  runtime_version: string;
  runtime_source: string;
  runtime_id: string;
  session_id: string;
  session_name: string;
  session_mode: string;
  working_directory?: string;
  state: RuntimeState;
}

export interface VariableInfo {
  name: string;
  access_key: string;
  type: string;
  display_type: string;
  display_value: string;
  length: number;
  size: number;
  has_children: boolean;
  children?: VariableInfo[];
}

export interface VariablesResult {
  session_id: string;
  language: string;
  requested_name?: string;
  variables: VariableInfo[];
  truncated: boolean;
}

export type ExecutionStatus = 'success' | 'error' | 'interrupted' | 'timed_out';

export interface PlotResult {
  mime_type: string;
  data: string;
  truncated: boolean;
}

export interface ExecutionResult {
  success: boolean;
  status: ExecutionStatus;
  session_id: string;
  language: string;
  mode: 'transient';
  started: boolean;
  stdout: string;
  stderr: string;
  result: Record<string, unknown>;
  plots: PlotResult[];
  output_truncated: boolean;
  elapsed_ms: number;
  error?: {
    name: string;
    message: string;
    traceback?: string;
  };
}

export interface RuntimeAdapter {
  getSession(): Promise<SessionInfo>;
  getVariables(options?: { name?: string; maxVariables?: number }): Promise<VariablesResult>;
  execute(code: string, timeoutMs?: number): Promise<ExecutionResult>;
}

export class NoActiveRuntimeError extends Error {
  readonly code = 'NO_ACTIVE_RUNTIME';

  constructor() {
    super('No foreground Positron runtime is active. Start or focus an existing R or Python console and try again.');
    this.name = 'NoActiveRuntimeError';
  }
}
