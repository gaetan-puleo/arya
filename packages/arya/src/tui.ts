import process from 'node:process';
import { join } from 'node:path';

import { ChatApp, type ChatHost } from 'mu-harness';
import { listLocalModels } from 'mu-local-provider';

import { type BootstrapConfig, buildHarness, loadConfig } from './bootstrap';
import { startDefinitionWatcher } from './watch';

const ARYA_BANNER = [
  '    .    .--..   .  .',
  '   / \\   |   )\\ /  / \\',
  "  /___\\  |--'  :  /___\\",
  ' /     \\ |  \\  | /     \\',
  "'       `'   ` ''       `",
].join('\n');

/**
 * Runs arya as a local in-process terminal chat — no WebSocket server.
 *
 * Uses the harness' unified {@link ChatApp} (the same base coding-agent runs on),
 * configured via a {@link ChatHost}. The session is created lazily: by omitting
 * `host.session`, the harness only spawns a session on the first user message,
 * never at startup. Tool approvals, the sub-agent panel, and the session/model
 * pickers are all handled by the shared base.
 */
export async function runTui(cwd: string, configPath?: string): Promise<void> {
  const config: BootstrapConfig = loadConfig(cwd, configPath);
  const { harness, approvals, getPrimary, primaryName } = await buildHarness(cwd, config);

  const providerConfig = { kind: config.kind, baseUrl: config.baseUrl, apiKey: config.apiKey };

  // Hot-reload agents/skills on file changes (no scheduler in the TUI → no tasks).
  const cfgDir = harness.config.configDir;
  const watcher = startDefinitionWatcher({
    paths: [config.agentsDir, join(cfgDir, 'agents'), join(cwd, 'skills'), join(cfgDir, 'skills')]
      .filter((p): p is string => Boolean(p)),
    onChange: () => harness.reloadDefinitions(),
  });

  const host: ChatHost = {
    // No initial `session` → created lazily on the first user message.
    approvals,
    cwd,
    createSession: () => harness.sessions.create(),
    forkSession: (id, upToIndex) => harness.sessions.fork(id, upToIndex),
    listSessions: () => harness.sessions.list({ cwd }),
    openSession: (id) => harness.sessions.open(id),
    selectModel: (ref) => harness.models.select(ref),
    modelRef: () => harness.models.selected,
    listModels: () => listLocalModels(providerConfig),
    agentRef: () => getPrimary()?.name ?? primaryName,
    agentColor: () => getPrimary()?.color,
    cycleAgent: () => getPrimary()?.name ?? primaryName,
    agentNames: () => harness.agents.list().map((a) => a.name).filter((n) => n !== primaryName && n !== 'title'),
    subAgents: harness.subAgents,
    dispatchSubAgent: (agent, task, parentId) => harness.dispatchSubAgent(agent, task, parentId),
    commands: () => harness.commands.list().map((c) => ({ name: c.name, description: c.description })),
    runCommand: (input) => harness.commands.run(input),
    initialTheme: 'dark',
    saveTheme: () => {},
    initialThinking: false,
    saveThinking: () => {},
    banner: ARYA_BANNER,
    minimal: true,
    onExit: (code) => {
      watcher.stop();
      harness.close();
      process.exit(code);
    },
  };

  const app = new ChatApp(host);
  process.on('SIGINT', () => void app.stop().then(() => process.exit(130)));
  process.on('SIGTERM', () => void app.stop().then(() => process.exit(143)));
  await app.start();
}
