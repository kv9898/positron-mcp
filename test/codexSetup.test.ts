import { describe, expect, it } from 'vitest';
import { codexSetupCommands, codexSkillInstallCommand, endpointForFixedPort } from '../src/codexSetup';

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

  it('creates portable manual skill-install commands', () => {
    expect(codexSkillInstallCommand('/opt/Positron Codex/skills/positron', 'linux'))
      .toBe('mkdir -p "$HOME/.codex/skills" && cp -R -- \'/opt/Positron Codex/skills/positron\' "$HOME/.codex/skills/"');
    expect(codexSkillInstallCommand("C:\\Positron's Codex\\skills\\positron", 'win32'))
      .toBe('New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.codex\\skills"; Copy-Item -Recurse -Path \'C:\\Positron\'\'s Codex\\skills\\positron\' -Destination "$env:USERPROFILE\\.codex\\skills"');
  });
});
