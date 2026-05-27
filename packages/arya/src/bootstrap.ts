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
  /**
   * Bind address for the WebSocket server. Defaults to `127.0.0.1` (loopback-only).
   * Set to `'0.0.0.0'` to accept LAN connections — requires a non-empty `authToken`.
   */
  wsHost?: string;
  authToken?: string;
  /** Override agents directory (defaults to `<cwd>/definitions/agents` if present). */
  agentsDir?: string;
  /** Override skills directory (defaults to `<cwd>/definitions/skills` if present). */
  skillsDir?: string;
  /** Override tasks directory (defaults to `<cwd>/definitions/tasks` if present). */
  tasksDir?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

function validatePort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(
      `[arya] Invalid wsPort: ${JSON.stringify(value)}. Must be an integer in [1, 65535].`,
    );
  }
  return value;
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
  const wsPort = validatePort(result.wsPort);
  const wsHost = typeof result.wsHost === 'string' && result.wsHost ? result.wsHost : '127.0.0.1';
  const authToken = typeof result.authToken === 'string' ? result.authToken : undefined;

  // Refuse to start with empty auth on a public bind. Loopback-only gets a warning.
  if (!authToken) {
    if (!isLoopback(wsHost)) {
      throw new Error(
        `[arya] Refusing to start: authToken is empty/missing and wsHost is "${wsHost}" (non-loopback).\n` +
          `       Set a non-empty "authToken" in your config, or set "wsHost": "127.0.0.1".`,
      );
    }
    log.info(
      `[arya] WARNING: authToken is empty — relying on loopback-only bind (${wsHost}). Set authToken to harden.`,
    );
  }

  return {
    kind: result.kind,
    baseUrl: result.baseUrl as string,
    model: result.model as string,
    apiKey: result.apiKey,
    wsPort,
    wsHost,
    authToken,
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

  // Scheduler plugin must be added BEFORE `createAgentRuntime`, which snapshots
  // tools/provider from the plugin list at construction time. The scheduler's
  // event sink is wired through a deferred handle so it can forward to `ws.push`
  // once the WS server is constructed below.
  type SchedulerEventSink = (event: Record<string, unknown>) => void;
  let pushSchedulerEvent: SchedulerEventSink = () => {
    /* dropped until ws is wired */
  };
  const scheduler = createSchedulerPlugin({
    tasksDir: config.tasksDir && existsSync(config.tasksDir) ? config.tasksDir : undefined,
    bus: result.bus,
    onEvent: (event) => pushSchedulerEvent({ type: 'scheduler_event', event }),
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
    host: config.wsHost,
    authToken: config.authToken,
    agent,
    approvalQueue: result.approvalQueue,
    commandRegistry: result.commandRegistry,
    getSubAgents: () => result.subAgents,
  });

  // Now that ws exists, route scheduler events through it.
  pushSchedulerEvent = (event) => ws.push(event);

  await ws.start();
  log.info(`Listening on ${config.wsHost}:${config.wsPort} — accepting connections`);

  return {
    agent,
    shutdown: async () => {
      log.info('Shutting down...');
      await ws.stop();
      log.info('Stopped');
    },
  };
}
