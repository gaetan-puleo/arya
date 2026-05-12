import { join } from 'node:path';
import {
  attachAutoPersist,
  createJSONLSessionStore,
  createSessionScopedMessageBus,
  startMu,
} from 'mu-core';
import {
  createAgentsPlugin,
  getActiveAgentId,
  getMuAgents,
} from 'mu-agents';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';
import { createScheduler } from 'mu-scheduler';
import { createMuToolsPlugin } from 'mu-tools';
import { existsSync } from 'node:fs';
import { setupApprovalChannel } from './ws/approval-bootstrap.js';
import { createWebSocketChannel } from './ws-channel.js';
import { createAryaHttpToolsPlugin } from './plugins/tools/index.js';
import { createAryaCommandsPlugin } from './plugins/commands.js';
import { createLogger } from './lib/logger.js';
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

  // Session-scoped MessageBus, owned by mu-core. The `resolveSession`
  // and `onSyntheticAppend` callbacks need references that don't exist
  // yet at construction time (the SessionManager comes from `startMu`;
  // the WS push helper comes from `createWebSocketChannel`). We bind
  // them via the bus's late-binding setters once those values are in
  // scope, below.
  const messageBus = createSessionScopedMessageBus();

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
    messages: messageBus,
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
      // Register extra agent dirs through mu-agents' public
      // `ctx.agents` registry. Must come AFTER `createAgentsPlugin` so
      // the registry is published before this plugin's activate runs.
      {
        name: 'arya-extra-agent-sources',
        version: '0.1.0',
        activate(ctx) {
          for (const dir of extraAgentDirs) {
            if (!existsSync(dir)) {
              log.debug?.(`Skipping missing extra agents dir: ${dir}`);
              continue;
            }
            ctx.agents?.registerSource(dir);
            log.info(`Registered extra agents dir: ${dir}`);
          }
        },
      },
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

  // Now that the SessionManager exists, wire the message bus's
  // `resolveSession` callback. Synthetic appends through `bus.append`
  // mirror into the right session's transcript via this resolver.
  messageBus.setResolveSession((id) => handle.sessions.get(id));

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

  // Register the WebSocket approval channel against mu-agents' gateway
  // ONCE, at boot — not per-WS-connection. The gateway stores channels
  // in a Set and the same instance lives for the life of the process;
  // re-registering on every reconnect leaked entries.
  const { unregister: unregisterApprovalChannel } = setupApprovalChannel(
    handle.registry,
  );

  // Persistent session store (titles, history, list/CRUD). Lives under
  // $XDG_DATA_HOME/arya/sessions (defaults to ~/.local/share/arya/sessions).
  const sessionStore = createJSONLSessionStore({ dir: aryaSessionsDir() });
  log.info('Session store ready');

  // Rehydrate session.messages from disk on first creation, THEN attach
  // autoPersist. Without rehydration, a restart would start every
  // restored session with an empty `messages` array — the UI sees the
  // history (via `sessions:history` reading the store directly) but
  // the LLM gets no prior context on the first message after restart.
  //
  // `initialCursor` is seeded so autoPersist's tool-diff path on the
  // next `stream_ended` doesn't re-emit messages that are already on
  // disk.
  handle.sessions.onSessionCreated((session) => {
    const stored = sessionStore.get(session.id);
    if (stored && stored.messages.length > 0) {
      session.setMessages(stored.messages);
    }
    attachAutoPersist(session, sessionStore, {
      getActiveAgent: () => getActiveAgentId(handle.registry) ?? undefined,
      onError: (where, err) => log.error(`autoPersist:${where}`, err),
      initialCursor: stored?.messages.length ?? 0,
    });
  });

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
      messageBus,
    },
  );
  // Wire the channel's `push` helper into the bus so synthetic appends
  // (mu-agents' @-mention live updates) fan out to clients.
  messageBus.setSyntheticAppendListener((sessionId, message) => {
    wsChannel.push({ type: 'synthetic_message', sessionId, message });
  });
  handle.channels.register(wsChannel);
  log.info(`WebSocket channel registered on port ${config.wsPort}`);

  // Centralised session-store broadcast. The JSONL store emits
  // `created` / `updated` / `deleted` / `renamed` for every mutation —
  // including those driven by `attachAutoPersist`'s assistant + tool
  // writes. Subscribing once here means handlers don't have to push
  // `sessions:changed` / `sessions:listed` by hand after every CRUD
  // call (which they previously did, redundantly, in three places).
  const unsubscribeStore = sessionStore.subscribe((sessionId, kind) => {
    wsChannel.push({ type: 'sessions:changed', sessionId, kind });
    wsChannel.push({ type: 'sessions:listed', sessions: sessionStore.list() });
  });

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
      unsubscribeStore();
      unregisterApprovalChannel();
      scheduler.stop();
      await handle.shutdown();
      log.info('Stopped');
    },
  };
}
