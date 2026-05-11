/**
 * arya-agent-sources — registers additional agent definition directories
 * with mu-agents.
 *
 * mu-agents accepts a single `agentsDir` config, but exposes
 * `ctx.agents.registerSource(dir)` so other plugins can register
 * additional directories. This plugin uses that hook to merge agents
 * from multiple sources (e.g. project's `definitions/agents/` and the
 * user's XDG config dir `~/.config/arya/agents/`).
 *
 * Must activate AFTER `mu-agents` (whose `activate` publishes
 * `ctx.agents`). Plugins activate in registration order, so place this
 * after `createAgentsPlugin(...)` in the `startMu` plugin list.
 */

import { existsSync } from 'node:fs';
import type { Plugin } from 'mu-core';
import { createLogger } from '../lib/logger.js';

const log = createLogger('arya-agent-sources');

export interface AryaAgentSourcesConfig {
  /** Absolute paths of agent directories to merge in addition to the primary. */
  extraDirs: string[];
}

export function createAryaAgentSourcesPlugin(
  config: AryaAgentSourcesConfig,
): Plugin {
  const dirs = config.extraDirs.filter((d) => typeof d === 'string' && d.length > 0);

  return {
    name: 'arya-agent-sources',
    version: '0.1.0',
    activate(ctx) {
      const registry = ctx.agents;
      if (!registry) {
        log.warn(
          'ctx.agents is not available — is mu-agents registered before this plugin?',
        );
        return;
      }
      for (const dir of dirs) {
        if (!existsSync(dir)) {
          log.debug(`Skipping missing dir: ${dir}`);
          continue;
        }
        registry.registerSource(dir);
        log.info(`Registered extra agents dir: ${dir}`);
      }
    },
  };
}


