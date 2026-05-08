import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startMu } from 'mu-core';
import { createAgentsPlugin } from 'mu-agents';
import { createOpenAIProviderPlugin } from 'mu-openai-provider';
import type { AgentDefinition } from 'mu-agents';
import { createWebSocketChannel } from './ws-channel.js';
import { createScheduler } from './scheduler.js';
import { createAryaToolsPlugin } from './plugins/tools/index.js';

export interface BootstrapConfig {
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  streamTimeoutMs?: number;
  wsPort?: number;
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
  // Load config
  const config = loadConfig(cwd, configPath);
  const agentsDir = config.agentsDir ?? join(cwd, 'definitions', 'agents');

  console.log(`[arya] Bootstrap — cwd: ${cwd}`);
  console.log(`[arya] Config — baseUrl: ${config.baseUrl}, model: ${config.model}`);
  console.log(`[arya] Agents dir: ${agentsDir}`);

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
    plugins: [
      // OpenAI-compatible LLM provider (Ollama, etc.)
      createOpenAIProviderPlugin({ id: 'openai' }),
      // Agent switcher, sub-agents, permissions
      createAgentsPlugin({
        agentsDir,
        config: {
          baseUrl: config.baseUrl ?? 'http://localhost:11434/v1',
          model: config.model,
          maxTokens: config.maxTokens ?? 4096,
          temperature: config.temperature ?? 0.7,
          streamTimeoutMs: config.streamTimeoutMs ?? 60000,
        },
        approvalChannelId: 'websocket',
      }),
      // Filesystem, shell, HTTP tools
      createAryaToolsPlugin({ cwd }),
    ],
  });

  // Log loaded agents from the mu-agents manager
  const muAgentsPlugin = handle.registry.getPlugin('mu-agents') as { manager: { getPrimary: () => AgentDefinition[]; getSubagents: () => AgentDefinition[] } } | undefined;
  if (muAgentsPlugin?.manager) {
    const primary = muAgentsPlugin.manager.getPrimary();
    const subagents = muAgentsPlugin.manager.getSubagents();
    console.log(`[arya] Loaded ${primary.length} primary agent(s): ${primary.map((a) => a.name).join(', ') || 'none'}`);
    if (subagents.length > 0) {
      console.log(`[arya] Loaded ${subagents.length} subagent(s): ${subagents.map((a) => a.name).join(', ') || 'none'}`);
    }
  }

  // Register WebSocket channel for companion
  const wsChannel = createWebSocketChannel(
    handle.sessions,
    handle.registry,
    handle.activity,
    {
      port: config.wsPort ?? 3001,
      authToken: config.authToken,
    },
  );
  handle.channels.register(wsChannel);
  console.log(`[arya] WebSocket channel registered on port ${config.wsPort ?? 3001}`);

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

function loadConfig(cwd: string, configPath?: string): BootstrapConfig {
  const result: Partial<BootstrapConfig> = {};

  if (configPath) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf8'));
      Object.assign(result, raw);
    } catch {
      console.warn(`[arya] Failed to load config from ${configPath}`);
    }
  }

  // Environment variables override config file (higher priority)
  const envBaseUrl = process.env.ARYA_BASE_URL ?? process.env.ARYA_OPENAI_BASE_URL;
  const envModel = process.env.ARYA_MODEL ?? process.env.ARYA_OPENAI_MODEL;
  const envWsPort = process.env.ARYA_WS_PORT ?? process.env.ARYA_COMPANION_PORT;
  const envMaxTokens = process.env.ARYA_MAX_TOKENS ?? process.env.ARYA_OPENAI_MAX_TOKENS;
  const envTemperature = process.env.ARYA_TEMPERATURE ?? process.env.ARYA_OPENAI_TEMPERATURE;
  const envStreamTimeout = process.env.ARYA_STREAM_TIMEOUT_MS;
  const envAuth = process.env.ARYA_COMPANION_TOKEN ?? process.env.COMPANION_TOKEN;
  const envAgentsDir = process.env.ARYA_AGENTS_DIR;
  const envTasksDir = process.env.ARYA_TASKS_DIR;
  const envCwd = process.env.ARYA_CWD;

  return {
    baseUrl: envBaseUrl ?? result.baseUrl ?? 'http://localhost:11434/v1',
    model: envModel ?? result.model ?? 'qwen2.5-coder:7b',
    maxTokens: envMaxTokens
      ? parseInt(envMaxTokens, 10)
      : result.maxTokens ?? 4096,
    temperature: envTemperature
      ? parseFloat(envTemperature)
      : result.temperature ?? 0.7,
    streamTimeoutMs: envStreamTimeout
      ? parseInt(envStreamTimeout, 10)
      : result.streamTimeoutMs ?? 60_000,
    wsPort: envWsPort
      ? parseInt(envWsPort, 10)
      : result.wsPort ?? 3001,
    authToken: envAuth ?? result.authToken,
    agentsDir: envAgentsDir ?? result.agentsDir ?? join(cwd, 'definitions', 'agents'),
    tasksDir: envTasksDir ?? result.tasksDir,
    cwd: envCwd,
  };
}
