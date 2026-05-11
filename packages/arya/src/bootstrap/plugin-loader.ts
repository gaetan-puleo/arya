/**
 * Dynamically load user-defined plugins from `~/.config/arya/plugins/*.ts`.
 *
 * Two factory shapes are accepted:
 *   1. `() => Plugin`     — `{ name, tools: [...] }` returned as-is.
 *   2. `() => PluginTool` — bundled into a single-plugin per file.
 *
 * Factories that throw on call with no arguments are logged at debug
 * and skipped — many factories take config, so the bare-call probe is
 * expected to fail for them. File-level errors (parse failure, bad
 * import) are surfaced at warn so operators see them.
 */

import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import type { Plugin, PluginTool } from 'mu-core';
import { createLogger } from '../lib/logger.js';
import { aryaPluginDepsDir, aryaPluginsDir } from './paths.js';

const log = createLogger('arya');

/**
 * Prepend custom plugin deps to NODE_PATH so dynamic imports can resolve
 * them. Must run before `loadIntegrationPlugins`.
 */
export function ensurePluginDepsInPath(): void {
  const depsDir = aryaPluginDepsDir();
  const nodeModules = join(depsDir, 'node_modules');
  if (!process.env.NODE_PATH) {
    process.env.NODE_PATH = nodeModules;
  } else if (!process.env.NODE_PATH.includes(nodeModules)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pathDelim = require('path').delimiter;
    process.env.NODE_PATH = nodeModules + pathDelim + process.env.NODE_PATH;
  }
  // Force Node's module loader to re-read NODE_PATH. The public API for
  // this is `Module._initPaths()` — private, but stable enough that the
  // ecosystem (e.g. ts-node, nx) relies on it. Worth a comment.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('module').Module._initPaths();
}

export async function loadIntegrationPlugins(): Promise<Plugin[]> {
  const pluginsDir = aryaPluginsDir();
  const plugins: Plugin[] = [];

  let entries: string[];
  try {
    entries = readdirSync(pluginsDir);
  } catch {
    // Plugins directory not found — operator may not have any. OK.
    return plugins;
  }

  const tsFiles = entries.filter((f) => f.endsWith('.ts') && f !== 'index.ts');

  for (const file of tsFiles) {
    try {
      const modulePath = join(pluginsDir, file);
      const mod = await import(modulePath);

      // Collect all exported `createXxx` factories.
      const factories: [string, unknown][] = [];
      for (const [key, value] of Object.entries(mod)) {
        if (typeof value === 'function' && key.startsWith('create')) {
          factories.push([key, value]);
        }
      }

      if (factories.length === 0) continue;

      const allTools: PluginTool[] = [];
      const pluginName = file.replace('.ts', '').replace(/-/g, '_');

      for (const [key, factory] of factories) {
        try {
          const result = (factory as () => unknown)();

          // Pattern 1: full Plugin object.
          if (
            result &&
            typeof result === 'object' &&
            'tools' in result &&
            Array.isArray((result as { tools: unknown }).tools)
          ) {
            const plugin = result as Plugin;
            plugins.push(plugin);
            log.info(`Loaded plugin: ${plugin.name} from ${file}`);
            continue;
          }

          // Pattern 2: standalone PluginTool.
          if (result && typeof result === 'object' && 'definition' in result && 'execute' in result) {
            allTools.push(result as PluginTool);
          }
        } catch (err) {
          // Factory likely requires arguments — skip, surface at debug.
          log.debug(`Factory ${key} in ${file} threw:`, err);
        }
      }

      if (allTools.length > 0) {
        plugins.push({
          name: pluginName,
          version: '0.1.0',
          tools: allTools,
        });
        log.info(`Loaded plugin: ${pluginName} (${allTools.length} tool(s)) from ${file}`);
      }
    } catch (err) {
      log.warn(`Failed to load plugin ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return plugins;
}
