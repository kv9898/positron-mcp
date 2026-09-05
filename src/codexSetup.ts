export function codexSetupCommands(endpoint: string): string {
  return [
    'codex mcp remove positron',
    `codex mcp add positron --url ${endpoint}`,
  ].join('\n');
}

export function endpointForFixedPort(port: number): string | undefined {
  return port === 0 ? undefined : `http://127.0.0.1:${port}/mcp`;
}
