/**
 * arya bootstrap — composes the shared `mu-harness` bootstrap with the
 * arya-specific bits (config file, local provider, WS transport).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AgentRuntime,
  bootstrap as harnessBootstrap,
  createAgentRuntime,
  createLogger,
  createSchedulerPlugin,
  createXdgPaths,
  maskEnvValue,
} from 'mu-harness';
import { createLocalProviderPlugin, type LocalBackendKind } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';
import webfetchPlugin from 'mu-webfetch';

import { createWebSocketServer } from './ws';

const log = createLogger('arya', { levelEnvVar: 'ARYA_LOG_LEVEL' });

export interface BootstrapConfig {
  /** Local provider backend kind (currently only 'llama-swap' is supported). */
  kind?: LocalBackendKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  wsPort: number;
  authToken?: string;
  /** Override agents directory (defaults to `<cwd>/definitions/agents` if present). */
  agentsDir?: string;
  /** Override skills directory (defaults to `<cwd>/definitions/skills` if present). */
  skillsDir?: string;
  /** Override tasks directory (defaults to `<cwd>/definitions/tasks` if present). */
  tasksDir?: string;
}

function loadConfig(cwd: string, configPath?: string): BootstrapConfig {
  const result: Partial<BootstrapConfig> = {};
  if (configPath) {
    try {
      Object.assign(result, JSON.parse(readFileSync(configPath, 'utf-8')));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[arya] Failed to load config from ${configPath}: ${msg}`);
    }
  }
  const missing: string[] = [];
  if (!result.baseUrl) missing.push('baseUrl');
  if (!result.model) missing.push('model');
  if (result.wsPort == null) missing.push('wsPort');
  if (missing.length > 0) {
    throw new Error(
      `[arya] Missing required config field(s): ${missing.join(', ')}.\n` +
        `       Edit ${configPath ?? '~/.config/arya/config.json'}.`,
    );
  }
  return {
    kind: result.kind,
    baseUrl: result.baseUrl as string,
    model: result.model as string,
    apiKey: result.apiKey,
    wsPort: result.wsPort as number,
    authToken: result.authToken,
    agentsDir: result.agentsDir ?? join(cwd, 'definitions', 'agents'),
    skillsDir: result.skillsDir ?? join(cwd, 'definitions', 'skills'),
    tasksDir: result.tasksDir ?? join(cwd, 'definitions', 'tasks'),
  };
}

export interface BootstrapHandle {
  shutdown: () => Promise<void>;
  /** Exposed for tests / introspection. */
  agent: AgentRuntime;
}

export async function bootstrap(
  cwd: string = process.cwd(),
  configPath?: string,
): Promise<BootstrapHandle> {
  const config = loadConfig(cwd, configPath);
  const paths = createXdgPaths('arya');

  // Provider plugin (arya-specific).
  const providerPlugin = createLocalProviderPlugin({
    kind: config.kind,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
  });

  // mu-tools (filesystem + shell) made available to the runtime, scoped to cwd.
  const baseTools = createMuTools({ getCwd: () => cwd, restrictToCwd: false });

  // Bootstrap with project-local overrides on top of the XDG layout.
  const result = await harnessBootstrap({
    hostName: 'arya',
    paths,
    extraAgentsDirs: config.agentsDir ? [config.agentsDir] : [],
    extraSkillsDirs: config.skillsDir ? [config.skillsDir] : [],
    providerPlugin,
    extraPlugins: [webfetchPlugin],
    baseTools,
    permissionSource: 'primary-agent',
    defaultPermissionDecision: 'ask',
    sessionStore: 'jsonl',
  });

  // Logging.
  log.info(`Bootstrap — cwd: ${cwd}`);
  log.info(`Config — baseUrl: ${config.baseUrl}, model: ${config.model}`);
  if (!result.envResult.found) {
    log.info(`.env: not found at ${paths.envFile}`);
  } else {
    log.info(`.env: loaded ${result.envResult.loaded.length} var(s) from ${paths.envFile}`);
    for (const key of result.envResult.loaded) log.info(`  ${key} = ${maskEnvValue(process.env[key])}`);
    if (result.envResult.skipped.length > 0) {
      log.info(`.env: skipped ${result.envResult.skipped.length} var(s) (already set)`);
    }
  }
  log.info(`Loaded ${result.plugins.length - 1} runtime plugin(s) + provider`);
  log.info(`Loaded ${result.subAgents.length + (result.primaryAgent ? 1 : 0)} agent(s)`);
  log.info(`Primary agent: ${result.primaryAgent?.name ?? '<none>'}`);
  log.info(`Loaded ${result.skills.length} skill(s)`);

  // Add the scheduler plugin (it needs the bus, which is only available now).
  const scheduler = createSchedulerPlugin({
    tasksDir: config.tasksDir && existsSync(config.tasksDir) ? config.tasksDir : undefined,
    bus: result.bus,
    onEvent: (event) => ws.push({ type: 'scheduler_event', event }),
  });
  result.plugins.push(scheduler);

  // ── Agent runtime (managed by harness, multi-session) ───────────────
  const agent = createAgentRuntime({
    tools: result.tools,
    plugins: result.plugins,
    hooks: result.hooks,
    systemPrompt: result.systemPrompt,
    model: config.model,
    store: result.store,
    bus: result.bus,
  });

  // ── WS transport (arya-specific) ────────────────────────────────────
  const ws = createWebSocketServer({
    port: config.wsPort,
    authToken: config.authToken,
    agent,
    approvalQueue: result.approvalQueue,
    commandRegistry: result.commandRegistry,
    getSubAgents: () => result.subAgents,
  });

  await ws.start();
  log.info(`Listening on port ${config.wsPort} — accepting connections`);

  return {
    agent,
    shutdown: async () => {
      log.info('Shutting down...');
      await ws.stop();
      log.info('Stopped');
    },
  };
}
