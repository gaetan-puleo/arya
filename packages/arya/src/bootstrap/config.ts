/**
 * Bootstrap config — what every arya start needs to know.
 *
 * Required fields (`baseUrl`, `model`, …) throw at load time when
 * missing rather than silently defaulting; we deliberately refuse to
 * start with the wrong endpoint or model rather than appearing to work
 * and producing garbage answers.
 *
 * Runtime config lives in `~/.config/arya/config.json` by default;
 * environment variables are reserved for plugin integrations only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

export function loadConfig(cwd: string, configPath?: string): BootstrapConfig {
  const result: Partial<BootstrapConfig> = {};

  if (configPath) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf8'));
      Object.assign(result, raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[arya] Failed to load config from ${configPath}: ${msg}`);
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
