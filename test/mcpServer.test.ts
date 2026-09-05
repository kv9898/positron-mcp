import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { PositronMcpHttpServer } from '../src/mcpServer';
import type { RuntimeAdapter } from '../src/types';

const running: PositronMcpHttpServer[] = [];

const runtime: RuntimeAdapter = {
  getSession: async () => ({
    language: 'r', language_name: 'R', language_version: '4.5.1', runtime: 'R 4.5.1',
    runtime_version: '4.5.1', runtime_source: 'System', runtime_id: 'runtime-1',
    session_id: 'session-1', session_name: 'R Console', session_mode: 'console', state: 'idle',
  }),
  getVariables: async () => ({ session_id: 'session-1', language: 'r', variables: [], truncated: false }),
  evaluate: async () => ({
    success: true, status: 'success', session_id: 'session-1', language: 'r', mode: 'silent',
    output: '', result: 3, output_truncated: false, elapsed_ms: 1,
  }),
  execute: async () => ({
    success: true, status: 'success', session_id: 'session-1', language: 'r', mode: 'non-interactive',
    started: true, stdout: '', stderr: '', result: {}, plots: [], output_truncated: false, elapsed_ms: 1,
  }),
};

afterEach(async () => {
  await Promise.all(running.splice(0).map(server => server.stop()));
});

describe('PositronMcpHttpServer', () => {
  it('starts on an automatically selected IPv4-loopback port and stops cleanly', async () => {
    const server = new PositronMcpHttpServer(runtime, { port: 0, logger: { appendLine() {} } });
    running.push(server);
    const endpoint = await server.start();
    expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const remoteOrigin = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.com' },
      body: '{}',
    });
    expect(remoteOrigin.status).toBe(403);

    await server.stop();
    running.splice(running.indexOf(server), 1);
    await expect(fetch(endpoint)).rejects.toThrow();
  });

  it('supports MCP initialization and tool discovery over Streamable HTTP', async () => {
    const server = new PositronMcpHttpServer(runtime, { port: 0, logger: { appendLine() {} } });
    running.push(server);
    const endpoint = await server.start();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint));
    try {
      await client.connect(transport);
      expect(client.getInstructions()).toContain(
        'Do not ask the user to provide those values before checking Positron.',
      );
      expect(client.getInstructions()).toContain('calculate a + b');
      expect(client.getInstructions()).toContain(
        'Use positron_evaluate for calculations, summaries, comparisons',
      );
      expect(client.getInstructions()).toContain(
        'Use positron_execute for operations that may create, assign, mutate, or delete objects',
      );
      expect(client.getInstructions()).toContain('do not repeat a state-changing call');
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name)).toEqual([
        'positron_session', 'positron_variables', 'positron_evaluate', 'positron_execute',
      ]);
      expect(tools.tools.find(tool => tool.name === 'positron_session')?.description)
        .toContain('Never infer that no interpreter exists without calling this tool.');
      expect(tools.tools.find(tool => tool.name === 'positron_variables')?.description)
        .toContain('instead of asking the user for values');
      expect(tools.tools.find(tool => tool.name === 'positron_evaluate')?.description)
        .toContain('such as a + b');
      expect(tools.tools.find(tool => tool.name === 'positron_evaluate')?.inputSchema.properties)
        .not.toHaveProperty('mode');
      expect(tools.tools.find(tool => tool.name === 'positron_execute')?.description)
        .toContain('displayed in the console and added to history');
      expect(tools.tools.find(tool => tool.name === 'positron_execute')?.inputSchema.properties)
        .not.toHaveProperty('mode');

      const sessionResult = await client.callTool({ name: 'positron_session', arguments: {} });
      expect(sessionResult.isError).not.toBe(true);
      const evaluationResult = await client.callTool({
        name: 'positron_evaluate', arguments: { code: 'a + b' },
      });
      expect(evaluationResult.isError).not.toBe(true);
      const executionResult = await client.callTool({
        name: 'positron_execute', arguments: { code: 'x <- a + b' },
      });
      expect(executionResult.isError).not.toBe(true);
    } finally {
      await client.close();
    }
  });
});
