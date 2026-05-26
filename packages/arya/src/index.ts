#!/usr/bin/env node
/**
 * arya CLI entry. Subcommands:
 *
 *   arya           — start the runtime (default)
 *   arya init      — write the XDG config template (~/.config/arya/…)
 *   arya install   — install a plugin (npm spec or local .ts file)
 *
 * Config discovery for the default path:
 *   1. $XDG_CONFIG_HOME/arya/config.json
 *   2. <workspace>/config.json (dev override)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createXdgPaths, installLocalPluginFile, installNpmPlugin } from 'mu-harness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');

const subcommand = process.argv[2];

if (subcommand === 'init') {
  const { init } = await import('./init');
  init();
  process.exit(0);
}

if (subcommand === 'install' || subcommand === 'i') {
  const spec = process.argv[3];
  if (!spec) {
    console.error('usage: arya install <npm:spec | path.ts>');
    process.exit(1);
  }
  const paths = createXdgPaths('arya');
  try {
    if (spec.startsWith('npm:') || spec.startsWith('@')) {
      await installNpmPlugin(spec);
      console.log(`[arya] cached ${spec}`);
    } else {
      const dest = installLocalPluginFile(spec, paths.pluginsDir);
      console.log(`[arya] installed ${dest}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('[arya] install failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Default: start the runtime.
const paths = createXdgPaths('arya');
const candidates = [paths.configFile, resolve(root, 'config.json')];

let configPath: string | undefined;
for (const c of candidates) {
  try {
    readFileSync(c, 'utf-8');
    configPath = c;
    break;
  } catch {
    /* try next */
  }
}

if (!configPath) {
  console.error(
    `[arya] No config found. Looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}\n` +
      `       Run \`arya init\` to create one at ${candidates[0]}.`,
  );
  process.exit(1);
}

console.log(`[arya] Starting in ${root}`);
console.log(`[arya] Config: ${configPath}`);

const { bootstrap } = await import('./bootstrap');
try {
  const handle = await bootstrap(root, configPath);
  const shutdown = async (): Promise<void> => {
    await handle.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  console.error('[arya] Fatal error:', err);
  process.exit(1);
}
