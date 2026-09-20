import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  RemoteCdpProvider,
  LocalHeadlessProvider,
  ObscuraProvider,
  registerDefaultBrowserProviders,
  selectBrowserProvider,
  type BrowserProvider,
} from './provider';

let fake: Server;
let fakeBase: string;

beforeAll(async () => {
  fake = createServer((req, res) => {
    if (req.url === '/json/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ Browser: 'Fake/1', webSocketDebuggerUrl: 'ws://127.0.0.1:0/devtools/browser/fake' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  fakeBase = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => fake.close(() => r())));

describe('RemoteCdpProvider', () => {
  it('is available only with a non-empty cdpUrl', () => {
    expect(new RemoteCdpProvider('').isAvailable()).toBe(false);
    expect(new RemoteCdpProvider('http://x:1').isAvailable()).toBe(true);
  });

  it('createSession polls the endpoint and returns the contract', async () => {
    const p = new RemoteCdpProvider(fakeBase);
    const s = await p.createSession('t1');
    expect(s.cdpUrl).toBe(fakeBase);
    expect(s.sessionName).toBe('remote-t1');
    expect(s.providerSessionId).toBe('remote-t1');
    expect(s.features).toEqual({});
  });

  it('closeSession is a no-op that returns true and never raises', async () => {
    const p = new RemoteCdpProvider(fakeBase);
    await expect(p.closeSession('whatever')).resolves.toBe(true);
    expect(() => p.emergencyCleanup('whatever')).not.toThrow();
  });
});

describe('provider registry + selection', () => {
  beforeAll(() => registerDefaultBrowserProviders());

  it('selects remote when a cdpUrl is given', () => {
    const p = selectBrowserProvider({ cdpUrl: fakeBase });
    expect(p?.name).toBe('remote');
  });

  it('honours an explicit provider name', () => {
    expect(selectBrowserProvider({ provider: 'obscura' })?.name).toBe('obscura');
    expect(selectBrowserProvider({ provider: 'local' })?.name).toBe('local');
    expect(selectBrowserProvider({ provider: 'nope' })).toBeUndefined();
  });

  it('explicit remote without cdpUrl resolves to nothing', () => {
    expect(selectBrowserProvider({ provider: 'remote' })).toBeUndefined();
  });

  it('auto-selects an available backend when none configured', () => {
    const p = selectBrowserProvider({});
    // On a bare CI box neither obscura nor chrome may exist → undefined is valid;
    // if one exists it must be one of the two registered backends.
    if (p) expect(['obscura', 'local']).toContain(p.name);
  });
});

describe('LocalHeadlessProvider availability', () => {
  const saved = process.env.ARYA_CHROME_BIN;
  afterAll(() => {
    if (saved === undefined) delete process.env.ARYA_CHROME_BIN;
    else process.env.ARYA_CHROME_BIN = saved;
  });

  it('is available when ARYA_CHROME_BIN points at an existing file', () => {
    process.env.ARYA_CHROME_BIN = process.execPath;
    expect(new LocalHeadlessProvider().isAvailable()).toBe(true);
  });

  it('is still available with a missing override — it can provision a headless-shell', () => {
    // New headless-box contract: a missing system Chrome doesn't disable the
    // provider; it auto-provisions chrome-headless-shell into the cache.
    process.env.ARYA_CHROME_BIN = '/nonexistent/chrome-xyz';
    expect(new LocalHeadlessProvider().isAvailable()).toBe(true);
  });
});

describe('ObscuraProvider availability', () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env.OBSCURA_CDP_URL = saved.OBSCURA_CDP_URL;
    process.env.OBSCURA_BIN = saved.OBSCURA_BIN;
  });

  it('is available via OBSCURA_CDP_URL (remote mode)', () => {
    process.env.OBSCURA_CDP_URL = fakeBase;
    delete process.env.OBSCURA_BIN;
    expect(new ObscuraProvider().isAvailable()).toBe(true);
  });

  it('remote-mode createSession returns the configured URL', async () => {
    process.env.OBSCURA_CDP_URL = fakeBase;
    const s = await new ObscuraProvider().createSession('t2');
    expect(s.cdpUrl).toBe(fakeBase);
    expect(s.providerSessionId).toBe('obscura-remote-t2');
  });
});

// Type-level guard: every provider satisfies the BrowserProvider contract.
const _providers: BrowserProvider[] = [
  new RemoteCdpProvider('http://x:1'),
  new LocalHeadlessProvider(),
  new ObscuraProvider(),
];
void _providers;
