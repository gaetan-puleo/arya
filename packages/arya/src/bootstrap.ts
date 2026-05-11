import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { startMu } from 'mu-core';
import type { Session, Plugin, PluginTool } from 'mu-core';
import { createAgentsPlugin } from 'mu-agents';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';
import { createWebSocketChannel } from './ws-channel.js';
import { createScheduler } from './scheduler.js';
import { createAryaToolsPlugin } from './plugins/tools/index.js';
import { createAryaAgentSourcesPlugin } from './plugins/agent-sources.js';
import { createAryaCommandsPlugin } from './plugins/commands.js';
import { createAryaMessageBus } from './message-bus.js';
import { createSessionStore } from './session-store.js';

/** Resolve the XDG config home directory for arya. */
function xdgAryaAgentsDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'arya', 'agents');
}

/** Simple .env loader — no external dependencies. */
function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file not found or unreadable — ignore
  }
}

/** Resolve the plugins directory. */
function xdgAryaPluginsDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'arya', 'plugins');
}

/** Resolve the custom plugin dependencies directory. */
function xdgAryaPluginDepsDir(): string {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(base, 'arya', 'plugins');
}

/**
 * Prepend custom plugin deps to NODE_PATH so dynamic imports can resolve them.
 * Called before loadIntegrationPlugins().
 */
function ensurePluginDepsInPath(): void {
  const depsDir = xdgAryaPluginDepsDir();
  const nodeModules = join(depsDir, 'node_modules');
  if (!process.env.NODE_PATH) {
    process.env.NODE_PATH = nodeModules;
  } else if (!process.env.NODE_PATH.includes(nodeModules)) {
    process.env.NODE_PATH = nodeModules + require('path').delimiter + process.env.NODE_PATH;
  }
  require('module').Module._initPaths();
}

/**
 * Dynamically load integration plugins from ~/.config/arya/plugins/*.ts
 * Supports two patterns:
 *  1. Factory functions returning { name, tools: [...] } — full Plugin objects
 *  2. Factory functions returning { definition, permission, execute } — PluginTool objects
 *     (each becomes a single-tool plugin)
 * Returns an array of Plugin objects.
 */
async function loadIntegrationPlugins(): Promise<Plugin[]> {
  const pluginsDir = xdgAryaPluginsDir();
  const plugins: Plugin[] = [];

  try {
    const entries = readdirSync(pluginsDir);
    const tsFiles = entries.filter((f) => f.endsWith('.ts') && f !== 'index.ts');

    for (const file of tsFiles) {
      try {
        // Use dynamic import with file:// URL to load .ts files
        // Bun supports this natively
        const modulePath = join(pluginsDir, file);
        const mod = await import(modulePath);

        // Collect all exported factory functions
        const factories: [string, unknown][] = [];
        for (const [key, value] of Object.entries(mod)) {
          if (typeof value === 'function' && key.startsWith('create')) {
            factories.push([key, value]);
          }
        }

        if (factories.length === 0) continue;

        // Try each factory
        const allTools: PluginTool[] = [];
        let pluginName = file.replace('.ts', '').replace(/-/g, '_');

        for (const [key, factory] of factories) {
          try {
            const result = (factory as () => unknown)();

            // Pattern 1: Full Plugin object { name, tools: [...] }
            if (result && typeof result === 'object' && 'tools' in result && Array.isArray((result as any).tools)) {
              const plugin = result as Plugin;
              plugins.push(plugin);
              console.log(`[arya] Loaded plugin: ${plugin.name} from ${file}`);
              continue;
            }

            // Pattern 2: PluginTool object { definition, permission, execute }
            if (result && typeof result === 'object' && 'definition' in result && 'execute' in result) {
              allTools.push(result as PluginTool);
            }
          } catch {
            // Function may require arguments — skip
          }
        }

        // Wrap collected PluginTool objects into a single plugin
        if (allTools.length > 0) {
          plugins.push({
            name: pluginName,
            version: '0.1.0',
            tools: allTools,
          });
          console.log(`[arya] Loaded plugin: ${pluginName} (${allTools.length} tool(s)) from ${file}`);
        }
      } catch (err) {
        console.warn(`[arya] Failed to load plugin ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch {
    // Plugins directory not found — ignore
  }

  return plugins;
}

/**
 * Fully-resolved config. Required fields (`baseUrl`, `model`) are
 * non-optional because `loadConfig` refuses to return when they're
 * missing — we want a loud failure at boot rather than silent fallbacks
 * to wrong endpoints / wrong models when the user's config is incomplete.
 */
export interface BootstrapConfig {
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  streamTimeoutMs: number;
  wsPort: number;
  authToken?: string;
  agentsDir?: string;
  tasksDir?: string;
  cwd?: string;
}

export interface BootstrapHandle {
  shutdown: () => Promise<void>;
}

/**
 * Bootstrap arya — creates the mu handle, registers the WebSocket channel,
 * and starts the scheduler.
 */
export async function bootstrap(
  cwd: string = process.cwd(),
  configPath?: string,
): Promise<BootstrapHandle> {
  // Load .env from XDG config home (before env vars are read)
  const configDir =
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const envPath = join(configDir, 'arya', '.env');
  loadEnvFile(envPath);

  // Load config
  const config = loadConfig(cwd, configPath);
  const agentsDir = config.agentsDir ?? join(cwd, 'definitions', 'agents');
  const xdgAgentsDir = xdgAryaAgentsDir();
  // Extra source dirs to merge with the primary agentsDir. Filter to dirs
  // distinct from the primary so we don't double-register.
  const extraAgentDirs = [xdgAgentsDir].filter((d) => d !== agentsDir);

  console.log(`[arya] Bootstrap — cwd: ${cwd}`);
  console.log(`[arya] Config — baseUrl: ${config.baseUrl}, model: ${config.model}`);
  console.log(`[arya] Agents dir: ${agentsDir}`);
  if (extraAgentDirs.length > 0) {
    console.log(`[arya] Extra agents dirs: ${extraAgentDirs.join(', ')}`);
  }
  console.log(`[arya] Plugins dir: ${xdgAryaPluginsDir()}`);

  // MessageBus needed by mu-agents for `@<subagent>` dispatch (live
  // appends + relay-prompt injection). We construct it before `startMu`
  // because the registry consumes it at construction, but its bindings
  // (session resolver + push fn) are populated *after* startMu returns
  // and after the WS channel is created. Both `resolveSession` and
  // `push` capture refs that get filled in below.
  let sessionResolverImpl: ((id: string) => Session | undefined) | null = null;
  let pushImpl: ((event: Record<string, unknown>) => void) | null = null;
  const messageBusHandle = createAryaMessageBus(
    (id) => sessionResolverImpl?.(id),
    (event) => pushImpl?.(event),
  );

  // Ensure custom plugin deps are resolvable
  ensurePluginDepsInPath();

  // Load integration plugins from ~/.config/arya/plugins/
  const integrationPlugins = await loadIntegrationPlugins();
  console.log(`[arya] Loaded ${integrationPlugins.length} integration plugin(s)`);

  // Start mu
  const handle = await startMu({
    config: {
      baseUrl: config.baseUrl,
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      streamTimeoutMs: config.streamTimeoutMs,
      cwd,
    },
    messages: messageBusHandle.bus,
    plugins: [
      // OpenAI-compatible LLM provider (Ollama, etc.)
      createOpenAIProviderPlugin({ id: 'openai' }),
      // Agent switcher, sub-agents, permissions
      createAgentsPlugin({
        agentsDir,
        config: {
          baseUrl: config.baseUrl,
          model: config.model,
          maxTokens: config.maxTokens,
          temperature: config.temperature,
          streamTimeoutMs: config.streamTimeoutMs,
        },
        approvalChannelId: 'websocket',
      }),
      // Merge additional agent source dirs (e.g. ~/.config/arya/agents).
      // Must come AFTER createAgentsPlugin so ctx.agents is published.
      createAryaAgentSourcesPlugin({ extraDirs: extraAgentDirs }),
      // Slash commands (/help + one /<agent> switcher per primary).
      // Must come AFTER mu-agents so it can read `manager` on activate.
      createAryaCommandsPlugin(),
      // Filesystem, shell, HTTP tools
      createAryaToolsPlugin({ cwd }),
      // Integration plugins (loaded dynamically from ~/.config/arya/plugins/)
      ...integrationPlugins,
    ],
  });

  // mu-agents ships zero default agents now (build/plan/review live in
  // mu-coding-agents, which Arya doesn't load), so the only agents in the
  // manager are the user-defined ones from `agentsDir` + `extraAgentDirs`.
  const muAgentsPlugin = handle.registry.getPlugin('mu-agents') as
    | {
        manager: {
          getPrimary(): Array<{ name: string }>;
          getSubagents(): Array<{ name: string }>;
        };
      }
    | undefined;

  if (muAgentsPlugin?.manager) {
    const primary = muAgentsPlugin.manager.getPrimary();
    const subagents = muAgentsPlugin.manager.getSubagents();
    console.log(
      `[arya] Loaded ${primary.length} primary agent(s): ${
        primary.map((a) => a.name).join(', ') || 'none'
      }`,
    );
    console.log(
      `[arya] Loaded ${subagents.length} subagent(s)${
        subagents.length > 0 ? `: ${subagents.map((a) => a.name).join(', ')}` : ''
      }`,
    );
  }

  // Persistent session store (titles, history, list/CRUD). Lives under
  // $XDG_DATA_HOME/arya/sessions (defaults to ~/.local/share/arya/sessions).
  const sessionStore = createSessionStore();
  console.log('[arya] Session store ready');

  // Late-bind the message-bus resolver now that the session manager exists.
  sessionResolverImpl = (id) => handle.sessions.get(id);

  // Register WebSocket channel for companion
  const wsChannel = createWebSocketChannel(
    handle.sessions,
    handle.registry,
    handle.activity,
    {
      port: config.wsPort,
      authToken: config.authToken,
      store: sessionStore,
      providerConfig: {
        baseUrl: config.baseUrl,
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        streamTimeoutMs: config.streamTimeoutMs,
      },
      messageBus: messageBusHandle,
    },
  );
  // The channel publishes a `push` helper used by all event broadcasts.
  // Wire it back into the bus so synthetic appends fan out to clients.
  pushImpl = wsChannel.push;
  handle.channels.register(wsChannel);
  console.log(`[arya] WebSocket channel registered on port ${config.wsPort}`);

  // Start scheduler for cron/heartbeat tasks
  const scheduler = createScheduler(handle.sessions, config.tasksDir);

  console.log('[arya] Ready — accepting connections');

  return {
    shutdown: async () => {
      console.log('[arya] Shutting down...');
      scheduler.stop();
      await handle.shutdown();
      console.log('[arya] Stopped');
    },
  };
}

/**
 * Load and validate config. Throws when required fields (`baseUrl`,
 * `model`) are missing — we deliberately refuse to start with silent
 * defaults so the user immediately sees what's wrong instead of the
 * agent quietly talking to a non-existent endpoint.
 *
 * All runtime configuration lives in the config file
 * (`~/.config/arya/config.json` by default). Environment variables are
 * reserved for plugin integrations only.
 */
function loadConfig(cwd: string, configPath?: string): BootstrapConfig {
  const result: Partial<BootstrapConfig> = {};

  if (configPath) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf8'));
      Object.assign(result, raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[arya] Failed to load config from ${configPath}: ${msg}`,
      );
    }
  }

  const missing: string[] = [];
  if (!result.baseUrl) missing.push('baseUrl');
  if (!result.model) missing.push('model');
  if (result.maxTokens == null) missing.push('maxTokens');
  if (result.temperature == null) missing.push('temperature');
  if (result.streamTimeoutMs == null) missing.push('streamTimeoutMs');
  if (result.wsPort == null) missing.push('wsPort');
  if (missing.length > 0) {
    throw new Error(
      `[arya] Missing required config field(s): ${missing.join(', ')}.\n` +
        `       Edit ${configPath ?? '~/.config/arya/config.json'}.`,
    );
  }

  return {
    baseUrl: result.baseUrl!,
    model: result.model!,
    maxTokens: result.maxTokens!,
    temperature: result.temperature!,
    streamTimeoutMs: result.streamTimeoutMs!,
    wsPort: result.wsPort!,
    authToken: result.authToken,
    agentsDir: result.agentsDir ?? join(cwd, 'definitions', 'agents'),
    tasksDir: result.tasksDir ?? join(cwd, 'definitions', 'tasks'),
    cwd: result.cwd,
  };
}
