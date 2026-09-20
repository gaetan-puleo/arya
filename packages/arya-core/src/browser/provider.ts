import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Session-metadata contract returned by a BrowserProvider. Mirrors the Hermes
 * `BrowserProvider.create_session` contract: the provider owns the browser
 * *lifecycle* and hands back a CDP endpoint; the shared CDP stack
 * (`BrowserController`) drives the page from there. The provider never browses.
 */
export interface BrowserSession {
  /** Unique agent-browser session name. */
  sessionName: string;
  /** Provider-owned session id, used for teardown (Hermes `bb_session_id`). */
  providerSessionId: string;
  /** CDP HTTP base, e.g. http://127.0.0.1:9222. Controller derives ws via /json/version. */
  cdpUrl: string;
  /** Feature flags the provider enabled (stealth, proxy, …). */
  features: Record<string, unknown>;
}

/**
 * A browser backend that owns a browser session's lifecycle. It does NOT
 * implement browsing — it creates a session, returns a CDP websocket URL, and
 * tears it down. Every provider gets the full `browser_*` toolset for free via
 * the shared CDP controller.
 */
export interface BrowserProvider {
  /** Stable lowercase id — the value users write in `browser.provider`. */
  readonly name: string;
  readonly displayName: string;
  /** Cheap check only — binary present / env set. NO network calls. */
  isAvailable(): boolean;
  /** Create a session; may raise (missing creds, spawn failure). */
  createSession(taskId: string): Promise<BrowserSession>;
  /** Terminate by provider session id. Log-and-return-false; never raise. */
  closeSession(providerSessionId: string): Promise<boolean>;
  /** Best-effort teardown from atexit/signal handlers. Must not raise. */
  emergencyCleanup(providerSessionId: string): void;
}

async function pollCdpReady(base: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`browser: CDP endpoint ${base} not ready after ${timeoutMs}ms`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function which(bin: string): string | undefined {
  const paths = (process.env.PATH ?? '').split(':');
  for (const p of paths) {
    const full = join(p, bin);
    if (existsSync(full)) return full;
  }
  return undefined;
}

/**
 * Connects to an already-running CDP endpoint (a Chrome the user launched with
 * `--remote-debugging-port`, or any CDP server). Owns nothing; teardown is a
 * no-op. This is the backward-compatible path (`cdpUrl` / `ARYA_CDP_URL`).
 */
export class RemoteCdpProvider implements BrowserProvider {
  readonly name = 'remote';
  readonly displayName = 'Remote CDP endpoint';
  constructor(private readonly cdpUrl: string) {}
  isAvailable(): boolean {
    return typeof this.cdpUrl === 'string' && this.cdpUrl.length > 0;
  }
  async createSession(taskId: string): Promise<BrowserSession> {
    await pollCdpReady(this.cdpUrl, 10_000);
    return {
      sessionName: `remote-${taskId}`,
      providerSessionId: `remote-${taskId}`,
      cdpUrl: this.cdpUrl,
      features: {},
    };
  }
  async closeSession(): Promise<boolean> {
    return true;
  }
  emergencyCleanup(): void {
    /* external server owns its lifecycle */
  }
}

const CHROME_CANDIDATES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
];

/** chrome-headless-shell: a standalone headless Chrome that speaks CDP, no
 * display server required. Auto-provisioned to the arya cache when no system
 * Chrome is present — the headless-box path (mirrors Hermes `agent-browser`). */
const HEADLESS_SHELL_VERSION = '153.0.8010.47';
const HEADLESS_SHELL_DIR = join(homedir(), '.cache', 'arya', 'browsers');
const HEADLESS_SHELL_BIN = join(
  HEADLESS_SHELL_DIR,
  'chrome-headless-shell-linux64',
  'chrome-headless-shell',
);
const HEADLESS_SHELL_URL =
  `https://storage.googleapis.com/chrome-for-testing-public/${HEADLESS_SHELL_VERSION}/linux64/chrome-headless-shell-linux64.zip`;
/** sha256 of the pinned zip above. TLS authenticates the host; this guards against
 * a tampered CDN response or a corrupted cache. Update both together on a bump. */
const HEADLESS_SHELL_SHA256 = '7728775cf4a35464cd81c8eea2d44d6d32ccc0bd1edfa75aea7f32d146963d63';

function cachedHeadlessShell(): string | undefined {
  return existsSync(HEADLESS_SHELL_BIN) ? HEADLESS_SHELL_BIN : undefined;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function extractZip(zip: string, dest: string): Promise<void> {
  if (which('unzip')) return run('unzip', ['-q', '-o', zip, '-d', dest]);
  if (which('python3')) return run('python3', ['-m', 'zipfile', '-e', zip, dest]);
  throw new Error('provision: need `unzip` or `python3` to extract chrome-headless-shell');
}

/** Downloads + extracts chrome-headless-shell into the arya cache. Idempotent. */
export async function provisionHeadlessShell(log?: (msg: string) => void): Promise<string> {
  const cached = cachedHeadlessShell();
  if (cached) return cached;
  mkdirSync(HEADLESS_SHELL_DIR, { recursive: true });
  const zip = join(HEADLESS_SHELL_DIR, 'chrome-headless-shell.zip');
  log?.(`provision: downloading chrome-headless-shell ${HEADLESS_SHELL_VERSION} (~120MB)…`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  try {
    const res = await fetch(HEADLESS_SHELL_URL, { signal: ac.signal });
    if (!res.ok) throw new Error(`provision: download failed ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== HEADLESS_SHELL_SHA256) {
      throw new Error(`provision: sha256 mismatch (expected ${HEADLESS_SHELL_SHA256}, got ${got}) — refusing to install`);
    }
    writeFileSync(zip, buf);
  } finally {
    clearTimeout(timer);
  }
  log?.('provision: extracting…');
  await extractZip(zip, HEADLESS_SHELL_DIR);
  rmSync(zip, { force: true });
  if (!existsSync(HEADLESS_SHELL_BIN)) throw new Error('provision: extraction produced no binary');
  try {
    chmodSync(HEADLESS_SHELL_BIN, 0o755);
  } catch {
    /* best effort */
  }
  log?.(`provision: ready → ${HEADLESS_SHELL_BIN}`);
  return HEADLESS_SHELL_BIN;
}

/**
 * Spawns a local headless browser per session and owns its lifecycle. Resolves
 * the binary as: `ARYA_CHROME_BIN` → system Chrome → cached headless-shell →
 * auto-provisioned headless-shell. Headless needs no display server, so this is
 * the path that works on a bare headless box.
 */
export class LocalHeadlessProvider implements BrowserProvider {
  readonly name = 'local';
  readonly displayName = 'Local headless Chrome';
  private readonly sessions = new Map<string, { proc: ChildProcess; profileDir: string }>();

  /** Cheap, no-network resolution: override → system → cache. */
  private resolveBinSync(): string | undefined {
    const override = process.env.ARYA_CHROME_BIN;
    if (override) return existsSync(override) ? override : undefined;
    const sys = CHROME_CANDIDATES.map(which).find(Boolean);
    if (sys) return sys;
    return cachedHeadlessShell();
  }

  isAvailable(): boolean {
    // Cheap: a binary is present, or we can provision one into a writable cache.
    if (this.resolveBinSync()) return true;
    try {
      mkdirSync(HEADLESS_SHELL_DIR, { recursive: true });
      return existsSync(HEADLESS_SHELL_DIR);
    } catch {
      return false;
    }
  }

  /** Full resolution: sync path, else download the headless-shell. */
  private async resolveBin(): Promise<string> {
    const sync = this.resolveBinSync();
    if (sync) return sync;
    return provisionHeadlessShell();
  }

  async createSession(taskId: string): Promise<BrowserSession> {
    const bin = await this.resolveBin();
    const port = await freePort();
    const profileDir = mkdtempSync(join(tmpdir(), `arya-chrome-${taskId}-`));
    const args = [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ];
    const proc = spawn(bin, args, { stdio: 'ignore' });
    const providerSessionId = `local-${taskId}-${port}`;
    this.sessions.set(providerSessionId, { proc, profileDir });
    try {
      await pollCdpReady(`http://127.0.0.1:${port}`, 15_000);
    } catch (err) {
      this.kill(proc, profileDir);
      this.sessions.delete(providerSessionId);
      throw err;
    }
    return {
      sessionName: `local-${taskId}`,
      providerSessionId,
      cdpUrl: `http://127.0.0.1:${port}`,
      features: { headless: true },
    };
  }

  private kill(proc: ChildProcess, profileDir: string): void {
    try {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }, 3000).unref();
    } catch {
      /* already dead */
    }
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  async closeSession(providerSessionId: string): Promise<boolean> {
    const s = this.sessions.get(providerSessionId);
    if (!s) return false;
    this.kill(s.proc, s.profileDir);
    this.sessions.delete(providerSessionId);
    return true;
  }

  emergencyCleanup(providerSessionId: string): void {
    const s = this.sessions.get(providerSessionId);
    if (s) {
      try {
        s.proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Runs browser tasks on Obscura — a Rust headless browser that speaks CDP
 * without Chrome. Local mode spawns `obscura serve`; remote mode connects to a
 * running `obscura serve` via `OBSCURA_CDP_URL`. Mirrors
 * hermes-plugin-obscura.
 */
export class ObscuraProvider implements BrowserProvider {
  readonly name = 'obscura';
  readonly displayName = 'Obscura (Rust headless CDP)';
  private readonly sessions = new Map<string, { proc: ChildProcess }>();

  private obscuraBin(): string | undefined {
    return process.env.OBSCURA_BIN || which('obscura');
  }

  isAvailable(): boolean {
    return Boolean(process.env.OBSCURA_CDP_URL || this.obscuraBin());
  }

  async createSession(taskId: string): Promise<BrowserSession> {
    const remote = process.env.OBSCURA_CDP_URL;
    if (remote) {
      await pollCdpReady(remote, 10_000);
      return {
        sessionName: `obscura-${taskId}`,
        providerSessionId: `obscura-remote-${taskId}`,
        cdpUrl: remote,
        features: { stealth: process.env.OBSCURA_STEALTH === 'true' },
      };
    }
    const bin = this.obscuraBin();
    if (!bin) throw new Error('browser: obscura binary not found (set OBSCURA_BIN)');
    const port = process.env.OBSCURA_PORT
      ? Number(process.env.OBSCURA_PORT)
      : await freePort();
    const args = ['serve', `--port=${port}`];
    if (process.env.OBSCURA_STEALTH === 'true') args.push('--stealth');
    const proc = spawn(bin, args, { stdio: 'ignore' });
    const providerSessionId = `obscura-${taskId}-${port}`;
    this.sessions.set(providerSessionId, { proc });
    try {
      await pollCdpReady(`http://127.0.0.1:${port}`, Number(process.env.OBSCURA_STARTUP_TIMEOUT ?? 15) * 1000);
    } catch (err) {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      this.sessions.delete(providerSessionId);
      throw err;
    }
    return {
      sessionName: `obscura-${taskId}`,
      providerSessionId,
      cdpUrl: `http://127.0.0.1:${port}`,
      features: { stealth: process.env.OBSCURA_STEALTH === 'true' },
    };
  }

  async closeSession(providerSessionId: string): Promise<boolean> {
    const s = this.sessions.get(providerSessionId);
    if (!s) return false;
    try {
      s.proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          s.proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 3000).unref();
    } catch {
      /* ignore */
    }
    this.sessions.delete(providerSessionId);
    return true;
  }

  emergencyCleanup(providerSessionId: string): void {
    const s = this.sessions.get(providerSessionId);
    if (s) {
      try {
        s.proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

const registry = new Map<string, BrowserProvider>();

export function registerBrowserProvider(provider: BrowserProvider): void {
  registry.set(provider.name, provider);
}

export function getBrowserProvider(name: string): BrowserProvider | undefined {
  return registry.get(name);
}

export function listBrowserProviders(): BrowserProvider[] {
  return [...registry.values()];
}

/** Registers the built-in providers (local + obscura). Idempotent. */
export function registerDefaultBrowserProviders(): void {
  if (!registry.has('local')) registry.set('local', new LocalHeadlessProvider());
  if (!registry.has('obscura')) registry.set('obscura', new ObscuraProvider());
}

/**
 * Selects the active browser provider. Mirrors Hermes' `browser.cloud_provider`
 * dispatcher: a pure registry lookup with no per-provider conditionals. The
 * `remote` provider is built on demand from a configured `cdpUrl`. When no
 * explicit provider is set, auto-selects: cdpUrl → remote, else first available
 * of [obscura, local].
 */
export function selectBrowserProvider(opts: {
  provider?: string;
  cdpUrl?: string;
}): BrowserProvider | undefined {
  if (opts.provider) {
    if (opts.provider === 'remote') return opts.cdpUrl ? new RemoteCdpProvider(opts.cdpUrl) : undefined;
    return registry.get(opts.provider);
  }
  if (opts.cdpUrl) return new RemoteCdpProvider(opts.cdpUrl);
  for (const name of ['obscura', 'local']) {
    const p = registry.get(name);
    if (p?.isAvailable()) return p;
  }
  return undefined;
}
