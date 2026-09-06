export function codexSetupCommands(endpoint: string): string {
  return [
    'codex mcp remove positron',
    `codex mcp add positron --url ${endpoint}`,
  ].join('\n');
}

export function endpointForFixedPort(port: number): string | undefined {
  return port === 0 ? undefined : `http://127.0.0.1:${port}/mcp`;
}

export function codexSkillInstallCommand(
  skillPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    return [
      'New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.codex\\skills"',
      `Copy-Item -Recurse -Path ${quotePowerShell(skillPath)} -Destination "$env:USERPROFILE\\.codex\\skills"`,
    ].join('; ');
  }
  return [
    'mkdir -p "$HOME/.codex/skills"',
    `cp -R -- ${quotePosix(skillPath)} "$HOME/.codex/skills/"`,
  ].join(' && ');
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
