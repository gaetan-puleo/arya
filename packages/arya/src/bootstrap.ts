import { join } from 'node:path';
import { startMu } from 'mu-core';
import type { Session } from 'mu-core';
import { createAgentsPlugin } from 'mu-agents';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';
import { createScheduler } from 'mu-scheduler';
import { createMuToolsPlugin } from 'mu-tools';
import { createWebSocketChannel } from './ws-channel.js';
import { createAryaHttpToolsPlugin } from './plugins/tools/index.js';
import { createAryaAgentSourcesPlugin } from './plugins/agent-sources.js';
import { createAryaCommandsPlugin } from './plugins/commands.js';
import { createAryaMessageBus } from './message-bus.js';
import { createJSONLSessionStore } from 'mu-core';
import { createLogger } from './lib/logger.js';
import { getMuAgents } from 'mu-agents';
import { loadConfig } from './bootstrap/config.js';
import { loadEnvFile, maskEnvValue } from './bootstrap/env-loader.js';
import {
  aryaAgentsDir as xdgAgentsDir,
  aryaEnvPath,
  aryaPluginsDir,
  aryaSessionsDir,
} from './bootstrap/paths.js';
import {
  ensurePluginDepsInPath,
  loadIntegrationPlugins,
} from './bootstrap/plugin-loader.js';

const log = createLogger('arya');

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
  // Load .env from XDG config home (before env vars are read).
  const envPath = aryaEnvPath();
  const envResult = loadEnvFile(envPath);

  // Load config.
  const config = loadConfig(cwd, configPath);
  const agentsDir = config.agentsDir ?? join(cwd, 'definitions', 'agents');
  // Extra source dirs to merge with the primary agentsDir. Filter to dirs
  // distinct from the primary so we don't double-register.
  const extraAgentDirs = [xdgAgentsDir()].filter((d) => d !== agentsDir);

  log.info(`Bootstrap — cwd: ${cwd}`);
  log.info(`Config — baseUrl: ${config.baseUrl}, model: ${config.model}`);
  log.info(`Agents dir: ${agentsDir}`);
  if (extraAgentDirs.length > 0) {
    log.info(`Extra agents dirs: ${extraAgentDirs.join(', ')}`);
  }
  log.info(`Plugins dir: ${aryaPluginsDir()}`);

  // .env logging.
  if (!envResult.found) {
    log.info(`.env: not found at ${envPath}`);
  } else {
    log.info(`.env: loaded ${envResult.loaded.length} var(s) from ${envPath}`);
    for (const key of envResult.loaded) {
      log.info(`  ${key} = ${maskEnvValue(process.env[key])}`);
    }
    if (envResult.skipped.length > 0) {
      log.info(
        `.env: skipped ${envResult.skipped.length} var(s) (already set in process env): ${envResult.skipped.join(', ')}`,
      );
    }
  }

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

  // Ensure custom plugin deps are resolvable, then load integrations.
  ensurePluginDepsInPath();
  const integrationPlugins = await loadIntegrationPlugins();
  log.info(`Loaded ${integrationPlugins.length} integration plugin(s)`);

  // Start mu.
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
      // Agent switcher, sub-agents, permissions.
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
      // Merge additional agent source dirs. Must come AFTER createAgentsPlugin
      // so `ctx.agents` is published.
      createAryaAgentSourcesPlugin({ extraDirs: extraAgentDirs }),
      // Slash commands (/help). Must come AFTER mu-agents so it can read
      // `manager` on activate.
      createAryaCommandsPlugin(),
      // Filesystem + shell tools (shared with mu-coding). Restrict paths
      // to cwd so agent-defined permission globs can authorise safely.
      createMuToolsPlugin({ getCwd: () => cwd, restrictToCwd: true }),
      // HTTP tool (arya-specific).
      createAryaHttpToolsPlugin({ cwd }),
      // User-defined plugins (loaded dynamically from ~/.config/arya/plugins/).
      ...integrationPlugins,
    ],
  });

  // Log the loaded agent surface so operators can verify their definitions
  // are picked up. mu-agents ships zero default agents, so anything visible
  // here comes from `agentsDir` + `extraAgentDirs`.
  const muAgents = getMuAgents(handle.registry);
  if (muAgents?.manager) {
    const primary = muAgents.manager.getPrimary?.() ?? [];
    const subagents = muAgents.manager.getSubagents?.() ?? [];
    log.info(
      `Loaded ${primary.length} primary agent(s): ${
        primary.map((a) => a.name).join(', ') || 'none'
      }`,
    );
    log.info(
      `Loaded ${subagents.length} subagent(s)${
        subagents.length > 0 ? `: ${subagents.map((a) => a.name).join(', ')}` : ''
      }`,
    );
  }

  // Persistent session store (titles, history, list/CRUD). Lives under
  // $XDG_DATA_HOME/arya/sessions (defaults to ~/.local/share/arya/sessions).
  const sessionStore = createJSONLSessionStore({ dir: aryaSessionsDir() });
  log.info('Session store ready');

  // Late-bind the message-bus resolver now that the session manager exists.
  sessionResolverImpl = (id) => handle.sessions.get(id);

  // Register WebSocket channel for companion.
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
  log.info(`WebSocket channel registered on port ${config.wsPort}`);

  // Start scheduler for cron/heartbeat tasks. Lifecycle events bubble
  // up to connected companions via the WS push helper so the UI can
  // badge `task:*` sessions with running/ok/failed status.
  const scheduler = createScheduler({
    sessions: handle.sessions,
    tasksDir: config.tasksDir,
    onTaskEvent: (event) => {
      wsChannel.push({ type: 'scheduler_event', event });
      if (event.kind === 'output') {
        log.info(`[task ${event.taskId}] ${event.text.slice(0, 200)}`);
      } else if (event.kind === 'failed') {
        log.error(`[task ${event.taskId}] failed: ${event.error}`);
      }
    },
  });

  log.info('Ready — accepting connections');

  return {
    shutdown: async () => {
      log.info('Shutting down...');
      scheduler.stop();
      await handle.shutdown();
      log.info('Stopped');
    },
  };
}
