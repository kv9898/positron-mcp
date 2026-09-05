import type { Server as HttpServer } from 'node:http';
import { Buffer } from 'node:buffer';
import type { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { executeTool } from './tools/execute';
import { sessionTool } from './tools/session';
import { variablesTool } from './tools/variables';
import type { ExecutionResult, RuntimeAdapter } from './types';

const HOST = '127.0.0.1';
const PATH = '/mcp';

export interface McpServerLogger {
  appendLine(message: string): void;
}

export interface McpHttpServerOptions {
  port: number;
  logger: McpServerLogger;
}

interface ActiveConnection {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export class PositronMcpHttpServer {
  private httpServer: HttpServer | undefined;
  private endpointValue: string | undefined;
  private readonly connections = new Set<ActiveConnection>();

  constructor(
    private readonly runtime: RuntimeAdapter,
    private readonly options: McpHttpServerOptions,
  ) {}

  get endpoint(): string | undefined {
    return this.endpointValue;
  }

  async start(): Promise<string> {
    if (this.httpServer && this.endpointValue) return this.endpointValue;

    const app = createMcpExpressApp({ host: HOST });
    app.use((request: Request, response: Response, next: NextFunction) => {
      const origin = request.header('origin');
      if (origin && !isLoopbackOrigin(origin)) {
        response.status(403).json({ error: 'Remote origins are not permitted.' });
        return;
      }
      next();
    });

    app.post(PATH, async (request: Request, response: Response) => {
      const connection: ActiveConnection = {
        server: createToolServer(this.runtime),
        transport: new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }),
      };
      this.connections.add(connection);
      this.options.logger.appendLine(`[MCP] ${new Date().toISOString()} request received`);

      try {
        await connection.server.connect(connection.transport);
        await connection.transport.handleRequest(request, response, request.body);
      } catch (error) {
        const message = errorMessage(error);
        this.options.logger.appendLine(`[MCP] request failed: ${message}`);
        if (!response.headersSent) {
          response.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      } finally {
        this.connections.delete(connection);
        await closeConnection(connection);
      }
    });

    app.get(PATH, (_request: Request, response: Response) => methodNotAllowed(response));
    app.delete(PATH, (_request: Request, response: Response) => methodNotAllowed(response));

    const server = await new Promise<HttpServer>((resolve, reject) => {
      const candidate = app.listen(this.options.port, HOST);
      candidate.once('listening', () => resolve(candidate));
      candidate.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('The MCP server did not receive a TCP address.');
    }

    this.httpServer = server;
    this.endpointValue = `http://${HOST}:${address.port}${PATH}`;
    this.options.logger.appendLine(`[MCP] listening at ${this.endpointValue}`);
    return this.endpointValue;
  }

  async stop(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = undefined;
    this.endpointValue = undefined;

    await Promise.allSettled([...this.connections].map(closeConnection));
    this.connections.clear();

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      this.options.logger.appendLine('[MCP] stopped');
    }
  }
}

export function createToolServer(runtime: RuntimeAdapter): McpServer {
  const server = new McpServer({
    name: 'positron-codex-live-runtime',
    version: '0.1.0',
  });

  server.registerTool(
    'positron_session',
    {
      title: 'Positron foreground runtime',
      description: 'Return metadata for the existing foreground Positron R or Python session. Never starts a runtime.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolResponse(() => sessionTool(runtime)),
  );

  server.registerTool(
    'positron_variables',
    {
      title: 'Positron live variables',
      description: 'List metadata for variables in the foreground live session, or inspect one variable and its immediate children. Values are truncated.',
      inputSchema: {
        name: z.string().min(1).optional().describe('Optional display name or Positron access key of one variable to inspect.'),
        max_variables: z.number().int().min(1).max(1000).optional().describe('Maximum variables or children to return; default 200.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async input => toolResponse(() => variablesTool(runtime, input)),
  );

  server.registerTool(
    'positron_execute',
    {
      title: 'Execute in foreground Positron runtime',
      description: 'Execute code transiently in the existing foreground Positron session identified before dispatch. Never starts a second interpreter.',
      inputSchema: {
        code: z.string().min(1).describe('R or Python code to execute in the live foreground session.'),
        mode: z.literal('transient').optional().default('transient').describe('Only transient execution is supported in this proof of concept.'),
        timeout_ms: z.number().int().min(1000).max(600000).optional().describe('Execution timeout in milliseconds.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async input => executionToolResponse(runtime, input),
  );

  return server;
}

async function toolResponse(action: () => Promise<unknown>) {
  try {
    const value = await action();
    return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return errorToolResponse(error);
  }
}

async function executionToolResponse(
  runtime: RuntimeAdapter,
  input: { code: string; mode?: 'transient'; timeout_ms?: number },
) {
  try {
    const value = await executeTool(runtime, input);
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
    > = [{
      type: 'text',
      text: JSON.stringify(withoutPlotData(value), null, 2),
    }];

    for (const plot of value.plots) {
      if (plot.truncated) continue;
      content.push({
        type: 'image',
        data: plot.mime_type === 'image/svg+xml'
          ? Buffer.from(plot.data, 'utf8').toString('base64')
          : stripDataUrl(plot.data),
        mimeType: plot.mime_type,
      });
    }
    return { content, isError: !value.success };
  } catch (error) {
    return errorToolResponse(error);
  }
}

function withoutPlotData(result: ExecutionResult) {
  return {
    ...result,
    plots: result.plots.map(plot => ({
      mime_type: plot.mime_type,
      characters: plot.data.length,
      truncated: plot.truncated,
      attached_as_mcp_image: !plot.truncated,
    })),
  };
}

function errorToolResponse(error: unknown) {
  const normalized = error instanceof Error ? error : new Error(errorMessage(error));
  const code = 'code' in normalized && typeof normalized.code === 'string'
    ? normalized.code
    : normalized.name;
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        success: false,
        error: { code, name: normalized.name, message: normalized.message },
      }, null, 2),
    }],
  };
}

function stripDataUrl(value: string): string {
  const match = /^data:[^;]+;base64,(.*)$/s.exec(value);
  return match?.[1] ?? value;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

function methodNotAllowed(response: { status(code: number): { json(body: unknown): void } }): void {
  response.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
}

async function closeConnection(connection: ActiveConnection): Promise<void> {
  await Promise.allSettled([
    connection.transport.close(),
    connection.server.close(),
  ]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
