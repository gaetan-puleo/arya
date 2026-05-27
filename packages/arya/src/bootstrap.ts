/**
 * arya bootstrap — composes the shared `mu-harness` bootstrap with the
 * arya-specific bits (config file, local provider, WS transport).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AgentRuntime,
  bootstrap as harnessBootstrap,
  createAgentsCommand,
  createAgentRuntime,
  createCommandRegistry,
  createHelpCommand,
  createSchedulerPlugin,
  createSessionsCommand,
  createXdgPaths,
} from 'mu-harness';
import { createLocalProviderPlugin, type LocalProviderConfig } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';
import webfetchPlugin from 'mu-webfetch';

import { createWebSocketServer } from './ws';

// Minimal level-gated logger. Replaces the removed `createLogger` from
// mu-harness; preserves the ARYA_LOG_LEVEL knob so operators can silence info.
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
function makeLog(scope: string, levelEnvVar: string) {
  const raw = (process.env[levelEnvVar] ?? 'info').toLowerCase();
  const level: LogLevel = (raw in LEVEL_ORDER ? raw : 'info') as LogLevel;
  const threshold = LEVEL_ORDER[level];
  const at = (lvl: LogLevel) => LEVEL_ORDER[lvl] >= threshold;
  return {
    debug: (msg: string) => at('debug') && console.log(`[${scope}] ${msg}`),
    info: (msg: string) => at('info') && console.log(`[${scope}] ${msg}`),
    warn: (msg: string) => at('warn') && console.warn(`[${scope}] ${msg}`),
    error: (msg: string) => at('error') && console.error(`[${scope}] ${msg}`),
  };
}
const log = makeLog('arya', 'ARYA_LOG_LEVEL');

export interface BootstrapConfig {
  /** Local provider backend kind (currently only 'llama-swap' is supported). */
  kind?: LocalProviderConfig['kind'];
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
  const baseTools = createMuTools({ getCwd: () => cwd });

  // Bootstrap with project-local overrides on top of the XDG layout.
  const result = await harnessBootstrap({
    hostName: 'arya',
    paths,
    extraAgentsDirs: config.agentsDir ? [config.agentsDir] : [],
    providerPlugin,
    extraPlugins: [webfetchPlugin],
    baseTools,
    permissionSource: 'primary-agent',
    defaultPermissionDecision: 'ask',
    sessionStore: 'jsonl',
  });

  // Logging. Note: harness no longer loads `.env` or surfaces a skills list,
  // so those lines were dropped along with their underlying APIs.
  log.info(`Bootstrap — cwd: ${cwd}`);
  log.info(`Config — baseUrl: ${config.baseUrl}, model: ${config.model}`);
  log.info(`Loaded ${result.plugins.length - 1} runtime plugin(s) + provider`);
  log.info(`Loaded ${result.subAgents.length + (result.primaryAgent ? 1 : 0)} agent(s)`);
  log.info(`Primary agent: ${result.primaryAgent?.name ?? '<none>'}`);

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

  // Command registry — the harness `bootstrap` no longer surfaces one, so
  // arya assembles the default `/agents`, `/sessions`, `/help` commands here
  // for the WS `command`/`commands` protocol.
  const commandRegistry = createCommandRegistry();
  commandRegistry.register(createAgentsCommand({ getSubAgents: () => result.subAgents }));
  commandRegistry.register(createSessionsCommand({ store: result.store }));
  commandRegistry.register(createHelpCommand({ list: () => commandRegistry.list() }));

  // ── WS transport (arya-specific) ────────────────────────────────────
  const ws = createWebSocketServer({
    port: config.wsPort,
    host: config.wsHost,
    authToken: config.authToken,
    agent,
    approvalQueue: result.approvalQueue,
    commandRegistry,
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
