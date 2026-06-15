#!/usr/bin/env node

import { basename, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

import { createPluginStore } from 'mu-harness';
import { aryaDirs } from './xdg';
import { firstReadable, isValidPort, missingMandatory, readConfig } from './init';

/** Resolve the active config path/contents and which mandatory fields are missing. */
async function resolveConfigState(): Promise<{ target: string; config: Record<string, unknown>; missing: string[] }> {
  const xdgFile = aryaDirs('arya').configFile;
  const existing = firstReadable([xdgFile, resolve(root, 'config.json')]);
  const target = existing ?? xdgFile;
  const config = existing ? readConfig(existing) : {};
  return { target, config, missing: missingMandatory(config) };
}

const portOf = (c: Record<string, unknown>): number => isValidPort(c.wsPort) ? (c.wsPort as number) : 3001;

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
  arya --channel tui         Interactive TUI client of a running 'arya serve' (local)
  arya --channel tui --connect ws://host:port
                             Interactive TUI client of a remote arya server
  arya install <plugin.ts>   Install a local plugin into the XDG data dir

The TUI is a pure client — start 'arya serve' first (the autonomous host owns the
server; the TUI never boots one). Config: ~/.config/arya/config.json
(falls back to <repo>/config.json).`;

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
  const { runChannelTui, isPortOpen } = await import('./run-tui');
  try {
    if (connect) {
      // Remote server: connect directly, no local config needed.
      await runChannelTui(root, undefined, { connect });
    } else {
      const { target, config, missing } = await resolveConfigState();
      if (missing.length === 0) {
        // Complete config: ordinary client of a running `arya serve`.
        await runChannelTui(root, target, {});
      } else {
        // First run: do setup inside this TUI. Join a setup server if `arya serve`
        // is already hosting one on the port; otherwise host one on loopback.
        const port = portOf(config);
        let stopSetup: (() => Promise<void>) | undefined;
        if (!(await isPortOpen('127.0.0.1', port))) {
          const { startSetupServer } = await import('./setup-server');
          const setup = await startSetupServer({ port, host: '127.0.0.1', startingConfig: config, configPath: target });
          stopSetup = setup.stop;
          console.log('[arya] First-run setup — answer the questions in the TUI, then relaunch: arya serve');
        } else {
          console.log(`[arya] Joining first-run setup already running on 127.0.0.1:${port}`);
        }
        try {
          await runChannelTui(root, undefined, { connect: `ws://127.0.0.1:${port}` });
        } finally {
          await stopSetup?.();
        }
      }
    }
  } catch (err) {
    console.error('[arya] Fatal error:', err);
    process.exit(1);
  }
} else if (subcommand === 'serve') {
  const { target, config: startingConfig, missing } = await resolveConfigState();

  if (missing.length > 0) {
    // First run: host the setup server on a reachable address and wait for a
    // channel (TUI/companion) to answer; print a QR the companion can scan.
    const { startSetupServer } = await import('./setup-server');
    const { printConnectQr, lanIp } = await import('./qr');
    const port = portOf(startingConfig);
    const host = typeof startingConfig.wsHost === 'string' && startingConfig.wsHost ? startingConfig.wsHost : '0.0.0.0';
    const authToken = typeof startingConfig.authToken === 'string' && startingConfig.authToken
      ? startingConfig.authToken
      : undefined;
    const setup = await startSetupServer({
      port,
      host,
      startingConfig,
      configPath: target,
      authToken,
      log: (m) => console.log(`[arya] ${m}`),
    });
    console.log('[arya] First-run setup — no complete config found. Connect a channel and answer the questions:');
    console.log(`[arya]   • TUI:        arya --channel tui --connect ws://127.0.0.1:${port}`);
    console.log(`[arya]   • Companion:  scan the QR below (or Settings → ws://${lanIp()}:${port})`);
    await printConnectQr({ url: `ws://${lanIp()}:${port}`, token: authToken }, (l) => console.log(l));
    const { configPath } = await setup.done;
    await setup.stop();
    console.log(`[arya] Configuration written to ${configPath}.`);
    console.log('[arya] Setup complete — relaunch to start arya:  arya serve');
    process.exit(0);
  }

  const configPath = target;
  console.log(`[arya] Starting in ${root}`);
  console.log(`[arya] Config: ${configPath}`);

  const { printConnectQr, lanIp } = await import('./qr');
  await printConnectQr({
    url: `ws://${lanIp()}:${portOf(startingConfig)}`,
    token: typeof startingConfig.authToken === 'string' && startingConfig.authToken
      ? startingConfig.authToken
      : undefined,
  }, (l) => console.log(l));

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
