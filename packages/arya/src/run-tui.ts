import process from 'node:process';
import { ChatApp, connectHarness, type RemoteHarness } from 'mu-harness';
import { bootstrap, type BootstrapHandle, loadConfig } from './bootstrap';

const ARYA_BANNER = [
  '    .    .--..   .  .',
  '   / \\   |   )\\ /  / \\',
  "  /___\\  |--'  :  /___\\",
  ' /     \\ |  \\  | /     \\',
  "'       `'   ` ''       `",
].join('\n');

export interface RunTuiOptions {
  /** Connect to an already-running arya server instead of booting one in-process. */
  connect?: string;
}

/**
 * The `tui` channel: an interactive terminal client of an arya server. ONE way —
 * always a WebSocket client. By default it boots a server in-process (the harness
 * is launched first) and connects over loopback; `--connect ws://…` attaches to a
 * remote `arya serve`. The autonomous host never renders a TUI directly.
 */
export async function runChannelTui(cwd: string, configPath: string | undefined, opts: RunTuiOptions): Promise<void> {
  let server: BootstrapHandle | undefined;
  let url: string;
  let token: string | undefined;

  if (opts.connect) {
    url = opts.connect;
    token = process.env.ARYA_TOKEN || undefined;
  } else {
    const config = loadConfig(cwd, configPath);
    server = await bootstrap(cwd, configPath); // server launched first
    const host = config.wsHost && config.wsHost !== '0.0.0.0' ? config.wsHost : '127.0.0.1';
    url = `ws://${host}:${config.wsPort}`;
    token = config.authToken;
  }

  let remote: RemoteHarness;
  let tearingDown = false;
  const teardown = async (code: number): Promise<void> => {
    if (tearingDown) return;
    tearingDown = true;
    try {
      await remote.close();
      if (server) await server.shutdown();
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
    onExit: (code) => void teardown(code),
  });

  const app = new ChatApp(remote.host);
  process.on('SIGINT', () => void app.stop().then(() => teardown(130)));
  process.on('SIGTERM', () => void app.stop().then(() => teardown(143)));
  await app.start();
}
