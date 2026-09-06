import * as vscode from 'vscode';
import { tryAcquirePositronApi } from '@posit-dev/positron';
import { codexSetupCommands, codexSkillInstallCommand, endpointForFixedPort } from './codexSetup';
import { PositronMcpHttpServer } from './mcpServer';
import { PositronRuntimeAdapter } from './positronRuntime';

const CODEX_ONBOARDING_NOTICE_KEY = 'positronCodexMcp.hasShownCodexOnboardingV2';

let server: PositronMcpHttpServer | undefined;
let output: vscode.OutputChannel | undefined;
let status: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Positron Codex MCP');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  status.command = 'positronCodexMcp.showEndpoint';
  status.name = 'Positron Codex MCP';
  setStoppedStatus();
  status.show();

  const api = tryAcquirePositronApi();
  if (!api) {
    output.appendLine('[Extension] Positron API unavailable; the MCP server was not started.');
    status.text = '$(warning) Positron MCP unavailable';
    status.tooltip = 'This extension requires Positron and its public extension API.';
  }

  let configuredPort = vscode.workspace
    .getConfiguration('positronCodexMcp')
    .get<number>('port', 37821);

  const copyCodexSetup = async (endpoint?: string) => {
    const resolvedEndpoint = endpoint ?? server?.endpoint ?? endpointForFixedPort(configuredPort);
    if (!resolvedEndpoint) {
      void vscode.window.showWarningMessage(
        'Start the MCP server first so its automatically allocated port can be included in the Codex setup command.',
      );
      return;
    }
    await vscode.env.clipboard.writeText(codexSetupCommands(resolvedEndpoint));
    void vscode.window.showInformationMessage(
      'Codex MCP setup commands copied. Run them, then use Developer: Reload Window so the Codex IDE extension refreshes its tools.',
    );
  };

  const copyCodexSkillInstall = async () => {
    const skillPath = vscode.Uri.joinPath(
      context.extensionUri,
      'skills',
      'positron',
    ).fsPath;
    await vscode.env.clipboard.writeText(codexSkillInstallCommand(skillPath));
    void vscode.window.showInformationMessage(
      'Codex skill-install command copied. Run it, then reload the Codex host so it discovers the Positron skill.',
    );
  };

  const notifyCodexSetup = async (message: string, endpoint?: string) => {
    const action = await vscode.window.showInformationMessage(
      message,
      'Copy Codex Setup',
      'Copy Skill Install',
      'Show Instructions',
    );
    if (action === 'Copy Codex Setup') await copyCodexSetup(endpoint);
    if (action === 'Copy Skill Install') await copyCodexSkillInstall();
    if (action === 'Show Instructions') {
      const upperCaseReadme = vscode.Uri.joinPath(context.extensionUri, 'README.md');
      const lowerCaseReadme = vscode.Uri.joinPath(context.extensionUri, 'readme.md');
      const readme = await vscode.workspace.fs.stat(upperCaseReadme)
        .then(() => upperCaseReadme, () => lowerCaseReadme);
      await vscode.commands.executeCommand(
        'markdown.showPreview',
        readme,
      );
    }
  };

  const start = async () => {
    if (!api) {
      void vscode.window.showErrorMessage('The Positron API is unavailable. Open this extension in Positron 2026.10.0 or newer.');
      return;
    }
    if (server?.endpoint) {
      await showEndpoint(server.endpoint);
      return;
    }

    const config = vscode.workspace.getConfiguration('positronCodexMcp');
    const runtime = new PositronRuntimeAdapter(
      api,
      () => new vscode.CancellationTokenSource(),
      {
        timeoutMs: config.get<number>('executionTimeoutMs', 60000),
        maxOutputCharacters: config.get<number>('maxOutputCharacters', 100000),
      },
    );
    const candidate = new PositronMcpHttpServer(runtime, {
      port: config.get<number>('port', 0),
      logger: output!,
    });

    try {
      const endpoint = await candidate.start();
      server = candidate;
      status!.text = '$(radio-tower) Positron MCP';
      status!.tooltip = `Trusted local runtime MCP: ${endpoint}`;
      output!.appendLine(`[Extension] Positron ${api.version} build ${api.buildNumber}`);
      output!.appendLine('[Security] This endpoint can execute arbitrary code in the foreground live interpreter.');
      output!.appendLine('[Security] Bound to IPv4 loopback only; no secrets are logged.');

      if (!context.globalState.get<boolean>(CODEX_ONBOARDING_NOTICE_KEY, false)) {
        await context.globalState.update(CODEX_ONBOARDING_NOTICE_KEY, true);
        void notifyCodexSetup(
          `Positron Codex MCP is listening at ${endpoint}. Connect Codex, then install the included skill so Codex reliably recognizes when to use your live Positron tools.`,
          endpoint,
        );
      }
    } catch (error) {
      await candidate.stop().catch(() => undefined);
      setStoppedStatus();
      const message = error instanceof Error ? error.message : String(error);
      output!.appendLine(`[Extension] start failed: ${message}`);
      void vscode.window.showErrorMessage(`Positron Codex MCP could not start: ${message}`);
    }
  };

  const stop = async () => {
    const current = server;
    server = undefined;
    await current?.stop();
    setStoppedStatus();
  };

  const restart = async () => {
    await stop();
    await start();
  };

  context.subscriptions.push(
    output,
    status,
    vscode.commands.registerCommand('positronCodexMcp.start', start),
    vscode.commands.registerCommand('positronCodexMcp.stop', stop),
    vscode.commands.registerCommand('positronCodexMcp.restart', restart),
    vscode.commands.registerCommand('positronCodexMcp.showEndpoint', async () => {
      if (server?.endpoint) await showEndpoint(server.endpoint);
      else void vscode.window.showInformationMessage('The Positron Codex MCP server is stopped.');
    }),
    vscode.commands.registerCommand('positronCodexMcp.copyEndpoint', async () => {
      if (!server?.endpoint) {
        void vscode.window.showInformationMessage('The Positron Codex MCP server is stopped.');
        return;
      }
      await vscode.env.clipboard.writeText(server.endpoint);
      void vscode.window.showInformationMessage('Positron MCP endpoint copied.');
    }),
    vscode.commands.registerCommand('positronCodexMcp.copyCodexSetup', () => copyCodexSetup()),
    vscode.commands.registerCommand('positronCodexMcp.copyCodexSkillInstall', copyCodexSkillInstall),
    vscode.commands.registerCommand('positronCodexMcp.showDiagnostics', async () => {
      output!.appendLine(`[Diagnostics] extension=0.1.0 positron=${api?.version ?? 'unavailable'} build=${api?.buildNumber ?? 'unavailable'} endpoint=${server?.endpoint ?? 'stopped'}`);
      if (api) {
        const foreground = await api.runtime.getForegroundSession();
        output!.appendLine(`[Diagnostics] foreground_session=${foreground?.metadata.sessionId ?? 'none'} language=${foreground?.runtimeMetadata.languageId ?? 'none'} state=${foreground?.getRuntimeState?.() ?? 'unknown'}`);
      }
      output!.show(true);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('positronCodexMcp.port')) {
        const previousPort = configuredPort;
        configuredPort = vscode.workspace
          .getConfiguration('positronCodexMcp')
          .get<number>('port', 37821);
        output!.appendLine(`[Extension] User-level MCP port changed from ${previousPort} to ${configuredPort}.`);

        void (async () => {
          const action = await vscode.window.showInformationMessage(
            `The MCP port changed from ${previousPort} to ${configuredPort}. Restart the server and update Codex to use the new endpoint.`,
            'Restart & Copy Setup',
            'Copy Setup Only',
          );
          if (action === 'Restart & Copy Setup') {
            await restart();
            await copyCodexSetup();
          }
          if (action === 'Copy Setup Only') {
            const endpoint = endpointForFixedPort(configuredPort);
            if (endpoint) await copyCodexSetup(endpoint);
            else {
              void vscode.window.showWarningMessage(
                'Port 0 is allocated only when the server starts. Restart the server before copying its new Codex setup commands.',
              );
            }
          }
        })();
      } else if (event.affectsConfiguration('positronCodexMcp') && server?.endpoint) {
        output!.appendLine('[Extension] Configuration changed; restart the MCP server to apply it.');
      }
    }),
    { dispose: () => { void stop(); } },
  );

  if (api && vscode.workspace.getConfiguration('positronCodexMcp').get<boolean>('autoStart', true)) {
    await start();
  }
}

export async function deactivate(): Promise<void> {
  const current = server;
  server = undefined;
  await current?.stop();
}

async function showEndpoint(endpoint: string): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    `Positron Codex MCP: ${endpoint}`,
    'Copy Endpoint',
    'Show Output',
  );
  if (action === 'Copy Endpoint') await vscode.env.clipboard.writeText(endpoint);
  if (action === 'Show Output') output?.show(true);
}

function setStoppedStatus(): void {
  if (!status) return;
  status.text = '$(debug-disconnect) Positron MCP';
  status.tooltip = 'Positron Codex MCP server is stopped.';
}
