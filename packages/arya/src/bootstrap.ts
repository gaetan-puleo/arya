import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createApprovalManager,
  createHarness,
  createPluginStore,
  createSessionsCommand,
  type Harness,
  importModule,
  loadAgents,
  type Plugin,
  runChannels,
  webSocketAdapter,
  type WireModel,
} from 'mu-harness';
import { createLocalProvider, listLocalModels, type LocalProviderConfig } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';
import webfetchPlugin from 'mu-webfetch';

import { aryaDirs, resolveXdg } from './xdg';
import { BUILTIN_AGENTS } from './default-agents';
import { BUILTIN_SKILLS } from './default-skills';
import { createScheduler, type Scheduler } from './scheduler';
import { startDefinitionWatcher } from './watch';

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
  const agentsDir = config.agentsDir ?? join(cwd, 'definitions', 'agents');
  // Definitions (agents/tasks/skills) are authored as files via the `write` tool
  // (guided by the create-* skills) and hot-reloaded — no dedicated create_* tools.
  const tools = createMuTools({ getCwd: () => cwd });
  const builtinPlugins: Plugin[] = [webfetchPlugin];
  const installedPlugins = await loadInstalledPlugins(
    aryaDirs('arya').pluginsDir,
    new Set(builtinPlugins.map((p) => p.name)),
  );
  const plugins = [...builtinPlugins, ...installedPlugins];
  const approvals = createApprovalManager();

  const configAgents = await loadAgents(join(xdg.configHome, 'arya', 'agents'));
  const projectAgents = config.agentsDir && existsSync(config.agentsDir) ? await loadAgents(config.agentsDir) : [];
  const userAgents = [...projectAgents, ...configAgents];
  // Built-in agents fill in only when the user hasn't defined one by the same
  // name, so arya always exists (with its color) even with no agent .md on disk.
  const builtinAgents = BUILTIN_AGENTS.filter((b) => !userAgents.some((u) => u.name === b.name));
  const allAgents = [...userAgents, ...builtinAgents];

  const primary = allAgents.find((a) => a.name === primaryName) ?? allAgents[0];

  let harnessRef: Harness | undefined;
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
      // Read the live registry so a hot-reloaded primary's grants take effect.
      activeAgent: () => harnessRef?.agents.get(primaryName) ?? primary,
    },
    // Built-in arya is the lowest-priority fallback; the harness loads the real
    // agents from agentDirs (definitions/agents + global config) and an override
    // of the same name wins. mergedAgents() re-reads these dirs on reload.
    defaultAgents: BUILTIN_AGENTS,
    // Skills embedded in the binary (the manage-* authoring skills), always
    // available via the `skill` tool regardless of cwd; disk skills can override.
    skills: BUILTIN_SKILLS,
    system: primary?.prompt,
    sourceUrl: 'https://github.com/gaetan-puleo/arya',
    title: true,
    // Agent dirs loaded (and watched) at boot: the repo's definitions/agents and
    // the global config dir; a same-named override there wins over the built-in.
    agentDirs: { local: agentsDir, config: join(xdg.configHome, 'arya', 'agents') },
  });
  harnessRef = harness;

  // Resolve the primary from the (hot-reloadable) registry, falling back to the
  // boot-time resolution if it ever vanishes.
  const getPrimary = () => harness.agents.get(primaryName) ?? primary;

  return { harness, approvals, primary, getPrimary, primaryName, tools, plugins };
}

export async function bootstrap(cwd: string = process.cwd(), configPath?: string): Promise<BootstrapHandle> {
  const config = loadConfig(cwd, configPath);
  const { harness, approvals, primaryName } = await buildHarness(cwd, config);

  // /sessions command (overrides any built-in of the same name).
  harness.commands.register(createSessionsCommand(harness.sessions), { override: true });

  log.info(`Bootstrap — cwd: ${cwd}`);
  log.info(`Config — baseUrl: ${config.baseUrl}, model: ${config.model}`);
  log.info(`Loaded ${harness.agents.list().length} agent(s); primary: ${primaryName}`);

  // The WebSocket channel surface (companion + TUI clients) now lives in mu-harness.
  const adapter = webSocketAdapter({
    port: config.wsPort,
    host: config.wsHost,
    authToken: config.authToken,
    activeAgentId: primaryName,
    listModels: async (): Promise<WireModel[]> =>
      (await listLocalModels({ kind: config.kind, baseUrl: config.baseUrl, apiKey: config.apiKey }))
        .map((m) => ({ id: m.id, ownedBy: m.ownedBy })),
    log: (msg) => log.info(`ws: ${msg}`),
  });

  const channels = await runChannels({ harness, approvals, adapters: [adapter] });
  log.info(`Listening on ${config.wsHost}:${config.wsPort} — accepting connections`);

  // Scheduled tasks run non-interactively through the harness sub-agent dispatcher.
  let scheduler: Scheduler | undefined;
  if (config.tasksDir) {
    scheduler = createScheduler({
      tasksDir: config.tasksDir,
      runTask: (agent, prompt) => harness.dispatchSubAgent(agent || primaryName, prompt, '').then((r) => r.text),
      onEvent: (event) => adapter.push({ type: 'scheduler_event', event }),
      log: (msg) => log.info(`scheduler: ${msg}`),
    });
    log.info(`Scheduler — ${scheduler.tasks().length} task(s) loaded`);
  }

  // Hot-reload definitions (agents/skills/tasks) on file changes — no restart.
  const cfgDir = harness.config.configDir;
  const watcher = startDefinitionWatcher({
    paths: [config.agentsDir, join(cfgDir, 'agents'), config.tasksDir, join(cwd, 'skills'), join(cfgDir, 'skills')]
      .filter((p): p is string => Boolean(p)),
    onChange: async () => {
      await harness.reloadDefinitions();
      await scheduler?.reload();
      adapter.push({
        type: 'agents',
        agents: harness.agents.list().map((a) => ({ name: a.name, description: a.description, color: a.color })),
        activeAgentId: primaryName,
      });
      log.info('reloaded definitions');
    },
    log: (msg) => log.info(`watch: ${msg}`),
  });

  return {
    shutdown: async () => {
      log.info('Shutting down...');
      watcher.stop();
      scheduler?.stop();
      await channels.stop();
      harness.close();
      log.info('Stopped');
    },
  };
}
