import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  createJSONLSessionStore,
  createSessionScopedMessageBus,
  type MuRuntime,
  startMu,
} from 'mu-core';
import {
  createAgentsPlugin,
  getMuAgents,
} from 'mu-agents';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';
import { createScheduler } from 'mu-scheduler';
import { createMuToolsPlugin } from 'mu-tools';
import { createWebFetchPlugin } from 'mu-webfetch';
import { setupApprovalChannel } from './ws/approval-bootstrap.js';
import { createWebSocketChannel } from './ws-channel.js';
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
  runtime: MuRuntime;
  shutdown: () => Promise<void>;
}

/**
 * Bootstrap arya — creates the MuRuntime, registers the WebSocket channel,
 * wires auto-persistence via the core store, and starts the scheduler.
 */
export async function bootstrap(
  cwd: string = process.cwd(),
  configPath?: string,
): Promise<BootstrapHandle> {
  const envPath = aryaEnvPath();
  const envResult = loadEnvFile(envPath);

  const config = loadConfig(cwd, configPath);
  const agentsDir = config.agentsDir ?? join(cwd, 'definitions', 'agents');
  const extraAgentDirs = [xdgAgentsDir()].filter((d) => d !== agentsDir);

  log.info(`Bootstrap — cwd: ${cwd}`);
  log.info(`Config — baseUrl: ${config.baseUrl}, model: ${config.model}`);
  log.info(`Agents dir: ${agentsDir}`);
  if (extraAgentDirs.length > 0) {
    log.info(`Extra agents dirs: ${extraAgentDirs.join(', ')}`);
  }
  log.info(`Plugins dir: ${aryaPluginsDir()}`);

  if (!envResult.found) {
    log.info(`.env: not found at ${envPath}`);
  } else {
    log.info(`.env: loaded ${envResult.loaded.length} var(s) from ${envPath}`);
    for (const key of envResult.loaded) {
      log.info(`  ${key} = ${maskEnvValue(process.env[key])}`);
    }
    if (envResult.skipped.length > 0) {
      log.info(
        `.env: skipped ${envResult.skipped.length} var(s) (already set): ${envResult.skipped.join(', ')}`,
      );
    }
  }

  const messageBus = createSessionScopedMessageBus();

  // Persistent session store. Passed to startMu — the runtime wires
  // exact transcript persistence on stream_ended automatically.
  const sessionStore = createJSONLSessionStore({ dir: aryaSessionsDir() });
  log.info('Session store ready');

  ensurePluginDepsInPath();
  const integrationPlugins = await loadIntegrationPlugins();
  log.info(`Loaded ${integrationPlugins.length} integration plugin(s)`);

  const runtime = await startMu({
    config: {
      baseUrl: config.baseUrl,
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      streamTimeoutMs: config.streamTimeoutMs,
      cwd,
    },
    messages: messageBus,
    store: sessionStore,
    plugins: [
      createOpenAIProviderPlugin({ id: 'openai' }),
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
      createAryaCommandsPlugin(),
      createMuToolsPlugin({ getCwd: () => cwd, restrictToCwd: true }),
      createWebFetchPlugin(),
      ...integrationPlugins,
    ],
  });

  messageBus.setResolveSession((id) => runtime.sessions.get(id));

  const muAgents = getMuAgents(runtime.registry);
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

  const { unregister: unregisterApprovalChannel } = setupApprovalChannel(
    runtime.registry,
  );

  // Rehydrate sessions from disk on first creation. Auto-persist is
  // already wired by startMu (via the store option) so we only need to
  // seed the in-memory transcript from the stored one.
  runtime.sessions.onSessionCreated((session) => {
    const stored = sessionStore.get(session.id);
    if (stored && stored.messages.length > 0) {
      session.setMessages(stored.messages);
    }
  });

  const wsChannel = createWebSocketChannel(
    runtime,
    {
      port: config.wsPort,
      authToken: config.authToken,
      store: sessionStore,
      messageBus,
    },
  );
  messageBus.setSyntheticAppendListener((sessionId, message) => {
    wsChannel.push({ type: 'synthetic_message', sessionId, message });
  });
  runtime.channels.register(wsChannel);
  log.info(`WebSocket channel registered on port ${config.wsPort}`);

  const unsubscribeStore = sessionStore.subscribe((sessionId, kind) => {
    wsChannel.push({ type: 'sessions:changed', sessionId, kind });
    wsChannel.push({ type: 'sessions:listed', sessions: sessionStore.list() });
  });

  const scheduler = createScheduler({
    submitText: (input) => runtime.submitText(input),
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
    runtime,
    shutdown: async () => {
      log.info('Shutting down...');
      unsubscribeStore();
      unregisterApprovalChannel();
      scheduler.stop();
      await runtime.shutdown();
      log.info('Stopped');
    },
  };
}
