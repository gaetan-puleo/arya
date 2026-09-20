import process from 'node:process';
import { createConnection } from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatApp } from 'mu-coding';
import { connectHarness, type RemoteHarness } from '@arya-ai/arya-core';
import { loadConfig } from './bootstrap';

const ARYA_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const ARYA_BANNER = [
  '⠀⠀⠀⠀⢰⡆⠀⠀⠀⠀',
  '⠀⠀⠀⢠⠉⣿⡄⠀⠀⠀',
  '⠀⠀⢀⡏⠀⢹⣿⡀⠀⠀',
  '⠀⠀⣾⠁⠀⠈⣿⣷⠀⠀',
  '⠀⣼⡏⠀⠀⠀⢹⣿⣧⠀',
  '⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶',
].join('\n');

export interface RunTuiOptions {
  connect?: string;
}

export function isPortOpen(host: string, port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * The TUI: an interactive terminal CLIENT of an autonomous arya server. It is a
 * view over a `ChatHost` (the remote harness), not a channel — it never boots a
 * server. The autonomous host (`arya serve`) owns serving; the TUI only connects.
 * By default it attaches to the configured host:port; with `--connect ws://…` it
 * attaches to a remote server (token via ARYA_TOKEN).
 */
export async function runTui(cwd: string, configPath: string | undefined, opts: RunTuiOptions): Promise<void> {
  let url: string;
  let token: string | undefined;

  if (opts.connect) {
    url = opts.connect;
    token = process.env.ARYA_TOKEN || undefined;
  } else {
    const config = loadConfig(cwd, configPath);
    const host = config.wsHost && config.wsHost !== '0.0.0.0' ? config.wsHost : '127.0.0.1';
    url = `ws://${host}:${config.wsPort}`;
    token = config.authToken;
    if (!(await isPortOpen(host, config.wsPort))) {
      throw new Error(`No arya server is running at ${host}:${config.wsPort}. Start one first: arya serve`);
    }
  }

  let remote: RemoteHarness;
  let tearingDown = false;
  const teardown = async (code: number): Promise<void> => {
    if (tearingDown) return;
    tearingDown = true;
    try {
      await remote.close();
    } finally {
      process.exit(code);
    }
  };

  remote = await connectHarness({
    url,
    token,
    cwd,
    banner: ARYA_BANNER,
    minimal: true,
    version: `arya ${ARYA_VERSION}`,
    onExit: (code) => void teardown(code),
  });

  const app = new ChatApp(remote.host);
  process.on('SIGINT', () => void app.stop().then(() => teardown(130)));
  process.on('SIGTERM', () => void app.stop().then(() => teardown(143)));
  await app.start();
}
