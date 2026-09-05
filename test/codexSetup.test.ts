import { describe, expect, it } from 'vitest';
import { codexSetupCommands, endpointForFixedPort } from '../src/codexSetup';

describe('Codex MCP setup', () => {
  it('creates replacement commands for the current endpoint', () => {
    expect(codexSetupCommands('http://127.0.0.1:37821/mcp')).toBe([
      'codex mcp remove positron',
      'codex mcp add positron --url http://127.0.0.1:37821/mcp',
    ].join('\n'));
  });

  it('only predicts endpoints for fixed ports', () => {
    expect(endpointForFixedPort(37821)).toBe('http://127.0.0.1:37821/mcp');
    expect(endpointForFixedPort(0)).toBeUndefined();
  });
});
