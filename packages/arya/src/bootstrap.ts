import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createApprovalManager,
  createHarness,
  createPluginStore,
  createSessionsCommand,
  importModule,
  loadAgents,
  type Plugin,
} from 'mu-harness';
import { createLocalProvider, type LocalProviderConfig } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';
import webfetchPlugin from 'mu-webfetch';

import { aryaDirs, resolveXdg } from './xdg';
import { createAryaRuntime } from './runtime';
import { createTaskWriterTool } from './definition-tools';
import { createScheduler, type Scheduler } from './scheduler';
import { observeSubAgent } from './sub-agent-channel';
import { createWebSocketServer } from './ws';
import type { WireAgent, WsOutbound } from './protocol';

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
  kind?: LocalProviderConfig['kind'];
  baseUrl: string;
  model: string;
  apiKey?: string;
  wsPort: number;
  wsHost?: string;
  authToken?: string;
  primaryAgent?: string;
  agentsDir?: string;
  tasksDir?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const isLoopback = (host: string): boolean => LOOPBACK_HOSTS.has(host);

const isPlugin = (value: unknown): value is Plugin =>
  typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string';

/**
 * Loads user-installed plugins (added via `arya install`) from the plugin store.
 * Each `.ts` file's default export must be a {@link Plugin}. Built-in plugins are
 * wired statically in {@link buildHarness}; this only covers the dynamic ones.
 * Failures are logged and skipped — one bad plugin must not abort startup.
 */
async function loadInstalledPlugins(pluginsDir: string, skip: Set<string>): Promise<Plugin[]> {
  const store = createPluginStore({ dir: pluginsDir });
  const out: Plugin[] = [];
  for (const name of await store.list()) {
    if (!/\.(?:[cm]?ts|tsx)$/.test(name)) continue;
    try {
      const mod = await importModule(join(pluginsDir, name));
      const plugin = mod.default;
      if (!isPlugin(plugin)) {
        log.warn(`plugin "${name}" has no valid default export — skipping`);
        continue;
      }
      if (skip.has(plugin.name)) {
        log.warn(`plugin "${name}" (${plugin.name}) shadows a built-in — skipping`);
        continue;
      }
      skip.add(plugin.name);
      out.push(plugin);
      log.info(`loaded plugin "${plugin.name}" from ${name}`);
    } catch (err) {
      log.error(`failed to load plugin "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

function validatePort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`[arya] Invalid wsPort: ${JSON.stringify(value)}. Must be an integer in [1, 65535].`);
  }
  return value;
}

function validateConfig(obj: Record<string, unknown>, configPath: string | undefined, cwd: string): BootstrapConfig {
  const missing: string[] = [];
  if (typeof obj.baseUrl !== 'string' || !obj.baseUrl) missing.push('baseUrl');
  if (typeof obj.model !== 'string' || !obj.model) missing.push('model');
  if (obj.wsPort == null) missing.push('wsPort');
  if (missing.length > 0) {
    throw new Error(
      `[arya] Missing required config field(s): ${missing.join(', ')}.\n` +
        `       Edit ${configPath ?? '~/.config/arya/config.json'}.`,
    );
  }

  const wsPort = validatePort(obj.wsPort);
  const wsHost = typeof obj.wsHost === 'string' && obj.wsHost ? obj.wsHost : '127.0.0.1';
  const authToken = typeof obj.authToken === 'string' ? obj.authToken : undefined;
  const apiKey = typeof obj.apiKey === 'string' ? obj.apiKey : undefined;
  const kind = typeof obj.kind === 'string' ? (obj.kind as LocalProviderConfig['kind']) : undefined;
  const primaryAgent = typeof obj.primaryAgent === 'string' ? obj.primaryAgent : undefined;
  const agentsDir = typeof obj.agentsDir === 'string' ? obj.agentsDir : join(cwd, 'definitions', 'agents');
  const tasksDir = typeof obj.tasksDir === 'string' ? obj.tasksDir : join(cwd, 'definitions', 'tasks');

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
    kind,
    baseUrl: obj.baseUrl as string,
    model: obj.model as string,
    apiKey,
    wsPort,
    wsHost,
    authToken,
    primaryAgent,
    agentsDir,
    tasksDir,
  };
}

export function loadConfig(cwd: string, configPath?: string): BootstrapConfig {
  if (!configPath) return validateConfig({}, undefined, cwd);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[arya] Failed to load config from ${configPath}: ${msg}`);
  }
  return validateConfig(parsed, configPath, cwd);
}

export interface BootstrapHandle {
  shutdown: () => Promise<void>;
}

/**
 * Builds the mu-harness instance plus the pieces arya wires around it (approvals,
 * resolved primary agent, shared tool/plugin lists). Shared by the WebSocket
 * server ({@link bootstrap}) and the local TUI ({@link runTui}).
 */
export async function buildHarness(cwd: string, config: BootstrapConfig) {
  const xdg = resolveXdg();
  const primaryName = config.primaryAgent ?? 'arya';
  const tasksDir = config.tasksDir ?? join(cwd, 'definitions', 'tasks');
  const agentsDir = config.agentsDir ?? join(cwd, 'definitions', 'agents');
  // Late-bound so the create_task tool can reach the scheduler that bootstrap()
  // builds after the harness (the TUI never sets it → create_task persists only).
  const schedulerRef: { current?: Scheduler } = {};
  const tools = [
    ...createMuTools({ getCwd: () => cwd }),
    createTaskWriterTool({ tasksDir, getScheduler: () => schedulerRef.current }),
  ];
  const builtinPlugins: Plugin[] = [webfetchPlugin];
  const installedPlugins = await loadInstalledPlugins(
    aryaDirs('arya').pluginsDir,
    new Set(builtinPlugins.map((p) => p.name)),
  );
  const plugins = [...builtinPlugins, ...installedPlugins];
  const approvals = createApprovalManager();

  const configAgents = await loadAgents(join(xdg.configHome, 'arya', 'agents'));
  const projectAgents = config.agentsDir && existsSync(config.agentsDir) ? await loadAgents(config.agentsDir) : [];
  const allAgents = [...projectAgents, ...configAgents];

  const primary = allAgents.find((a) => a.name === primaryName) ?? allAgents[0];

  const harness = await createHarness({
    hostName: 'arya',
    xdg,
    cwd,
    providers: {
      local: createLocalProvider({
        kind: config.kind,
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey,
      }),
    },
    model: `local/${config.model}`,
    tools,
    plugins,
    approvals: {
      manager: approvals,
      activeAgent: () => primary,
    },
    agents: projectAgents,
    system: primary?.prompt,
    sourceUrl: 'https://github.com/gaetan-puleo/arya',
    title: true,
    // Arya runs from the repo as its cwd; keep agent-authored skills out of the
    // project tree and in the global config dir (~/.config/arya/skills).
    skillScope: 'config',
    // create_agent scopes: "local" = the repo's definitions/agents (alongside
    // the built-ins), "config" = the global config dir. Model chooses per call.
    agentDirs: { local: agentsDir, config: join(xdg.configHome, 'arya', 'agents') },
  });

  return { harness, approvals, primary, primaryName, tools, plugins, schedulerRef };
}

export async function bootstrap(cwd: string = process.cwd(), configPath?: string): Promise<BootstrapHandle> {
  const config = loadConfig(cwd, configPath);
  const { harness, approvals, primaryName, tools, plugins, schedulerRef } = await buildHarness(cwd, config);

  let pushFrame: (frame: WsOutbound) => void = () => {};

  const runtime = createAryaRuntime({ harness, tools, plugins, primaryName });

  runtime.subAgents.subscribe((run) =>
    observeSubAgent(
      run.session,
      { runId: run.runId, agentName: run.agent, parentSessionId: run.parentId ?? '' },
      (frame) => pushFrame(frame),
    )
  );

  const commands = harness.commands;
  commands.register(createSessionsCommand(harness.sessions), { override: true });
  const getAgents = (): WireAgent[] => runtime.agents().map((a) => ({ name: a.name, description: a.description }));

  log.info(`Bootstrap — cwd: ${cwd}`);
  log.info(`Config — baseUrl: ${config.baseUrl}, model: ${config.model}`);
  log.info(`Loaded ${harness.agents.list().length} agent(s); primary: ${primaryName}`);

  const ws = createWebSocketServer({
    port: config.wsPort,
    host: config.wsHost,
    authToken: config.authToken,
    runtime,
    approvals,
    commands,
    getAgents,
    activeAgentId: primaryName,
  });

  await ws.start();
  pushFrame = ws.push;
  log.info(`Listening on ${config.wsHost}:${config.wsPort} — accepting connections`);

  // Always start the scheduler (loadTasks tolerates a missing/empty dir) so that
  // create_task can register new tasks live without a restart.
  let scheduler: Scheduler | undefined;
  if (config.tasksDir) {
    scheduler = createScheduler({
      tasksDir: config.tasksDir,
      runtime,
      onEvent: (event) => ws.push({ type: 'scheduler_event', event }),
      log: (msg) => log.info(`scheduler: ${msg}`),
    });
    schedulerRef.current = scheduler;
    log.info(`Scheduler — ${scheduler.tasks().length} task(s) loaded`);
  }

  return {
    shutdown: async () => {
      log.info('Shutting down...');
      scheduler?.stop();
      await ws.stop();
      runtime.close();
      log.info('Stopped');
    },
  };
}
