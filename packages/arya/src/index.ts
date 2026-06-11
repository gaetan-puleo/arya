#!/usr/bin/env node

import { basename, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

import { createPluginStore } from 'mu-harness';
import { aryaDirs } from './xdg';

// The directory arya is launched from — its project config/agents/tasks. Uses
// process.cwd() (not the module path) so a compiled standalone binary resolves
// project-relative paths from where the user runs it.
const root = process.cwd();

const argv = process.argv.slice(2);
const subcommand = argv[0];

const HELP = `arya — autonomous multi-agent runtime powered by mu

Usage:
  arya                       Show this help
  arya serve                 Run the autonomous host (WebSocket server for channels)
  arya --channel tui         Interactive TUI: boots a server in-process, then connects
  arya --channel tui --connect ws://host:port
                             Interactive TUI against an already-running arya server
  arya install <plugin.ts>   Install a local plugin into the XDG data dir

The harness is used two ways: same process (boots + connects locally) or a
separate process (--connect to a remote server). Config: ~/.config/arya/config.json
(falls back to <repo>/config.json).`;

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
      `       Create a config.json at ${candidates[0]} (fields: kind, baseUrl, model, primaryAgent, wsPort, wsHost, authToken).`,
  );
  process.exit(1);
}

if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (subcommand === 'install' || subcommand === 'i') {
  const spec = argv[1];
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

if (subcommand === '--channel') {
  const channel = argv[1];
  if (channel !== 'tui') {
    console.error(`[arya] Unknown channel "${channel ?? ''}". Available channels: tui`);
    process.exit(1);
  }
  const connectIdx = argv.indexOf('--connect');
  const connect = connectIdx >= 0 ? argv[connectIdx + 1] : undefined;
  if (connectIdx >= 0 && !connect) {
    console.error('usage: arya --channel tui --connect ws://host:port');
    process.exit(1);
  }
  const configPath = connect ? undefined : resolveConfigPath();
  const { runChannelTui } = await import('./run-tui');
  try {
    await runChannelTui(root, configPath, { connect });
  } catch (err) {
    console.error('[arya] Fatal error:', err);
    process.exit(1);
  }
} else if (subcommand === 'serve') {
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
} else {
  console.error(`[arya] Unknown command "${subcommand}".\n`);
  console.log(HELP);
  process.exit(1);
}
