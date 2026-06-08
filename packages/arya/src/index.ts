#!/usr/bin/env node

import { basename, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

import { createPluginStore } from 'mu-harness';
import { aryaDirs } from './xdg';

// The directory arya is launched from — its project config/agents/tasks. Uses
// process.cwd() (not the module path) so a compiled standalone binary resolves
// project-relative paths from where the user runs it.
const root = process.cwd();

const subcommand = process.argv[2];

if (subcommand === 'init') {
  const { init } = await import('./init');
  init();
  process.exit(0);
}

if (subcommand === 'install' || subcommand === 'i') {
  const spec = process.argv[3];
  if (!spec) {
    console.error('usage: arya install <path-to-plugin.ts>');
    process.exit(1);
  }
  if (spec.startsWith('npm:') || spec.startsWith('@')) {
    console.error('[arya] npm plugin installation is not supported in this build; pass a local .ts file path.');
    process.exit(1);
  }
  try {
    const store = createPluginStore({ dir: aryaDirs('arya').pluginsDir });
    const dest = await store.write(basename(spec), readFileSync(spec, 'utf-8'));
    console.log(`[arya] installed ${dest}`);
    process.exit(0);
  } catch (err) {
    console.error('[arya] install failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function resolveConfigPath(): string {
  const candidates = [aryaDirs('arya').configFile, resolve(root, 'config.json')];
  for (const c of candidates) {
    try {
      readFileSync(c, 'utf-8');
      return c;
    } catch {
      // keep looking
    }
  }
  console.error(
    `[arya] No config found. Looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}\n` +
      `       Run \`arya init\` to create one at ${candidates[0]}.`,
  );
  process.exit(1);
}

if (subcommand === 'tui') {
  const configPath = resolveConfigPath();
  const { runTui } = await import('./tui');
  try {
    await runTui(root, configPath);
  } catch (err) {
    console.error('[arya] Fatal error:', err);
    process.exit(1);
  }
} else {
  const configPath = resolveConfigPath();
  console.log(`[arya] Starting in ${root}`);
  console.log(`[arya] Config: ${configPath}`);

  const { bootstrap } = await import('./bootstrap');
  try {
    const handle = await bootstrap(root, configPath);
    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
      if (shuttingDown) {
        console.error(`[arya] Received ${signal} during shutdown — forcing exit.`);
        process.exit(1);
      }
      shuttingDown = true;
      try {
        await handle.shutdown();
        process.exit(0);
      } catch (err) {
        console.error('[arya] Shutdown failed:', err);
        process.exit(1);
      }
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (err) {
    console.error('[arya] Fatal error:', err);
    process.exit(1);
  }
}
