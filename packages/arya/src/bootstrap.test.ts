import { expect } from '@std/expect';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './bootstrap';

describe('loadConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arya-config-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (obj: Record<string, unknown>): string => {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify(obj));
    return path;
  };

  it('rejects missing required fields with a list of fields', () => {
    const path = write({ baseUrl: 'http://x' });
    expect(() => loadConfig(dir, path)).toThrow(/Missing required config field\(s\): model, wsPort/);
  });

  it('rejects a port out of range', () => {
    const path = write({ baseUrl: 'http://x', model: 'm', wsPort: 70000 });
    expect(() => loadConfig(dir, path)).toThrow(/Invalid wsPort/);
  });

  it('refuses a public bind without an auth token', () => {
    const path = write({ baseUrl: 'http://x', model: 'm', wsPort: 9000, wsHost: '0.0.0.0' });
    expect(() => loadConfig(dir, path)).toThrow(/authToken is empty/);
  });

  it('accepts a loopback bind without an auth token', () => {
    const path = write({ baseUrl: 'http://x', model: 'm', wsPort: 9000, wsHost: '127.0.0.1' });
    const config = loadConfig(dir, path);
    expect(config.wsHost).toBe('127.0.0.1');
    expect(config.authToken).toBeUndefined();
  });

  it('defaults wsHost to 127.0.0.1 and authToken to undefined', () => {
    const path = write({ baseUrl: 'http://x', model: 'm', wsPort: 9000 });
    const config = loadConfig(dir, path);
    expect(config.wsHost).toBe('127.0.0.1');
    expect(config.authToken).toBeUndefined();
    expect(config.baseUrl).toBe('http://x');
    expect(config.model).toBe('m');
    expect(config.wsPort).toBe(9000);
  });

  it('accepts a public bind when an auth token is set', () => {
    const path = write({
      baseUrl: 'http://x',
      model: 'm',
      wsPort: 9000,
      wsHost: '0.0.0.0',
      authToken: 't1',
    });
    const config = loadConfig(dir, path);
    expect(config.wsHost).toBe('0.0.0.0');
    expect(config.authToken).toBe('t1');
  });

  it('defaults agentsDir and tasksDir to definitions/<...> when omitted', () => {
    const path = write({ baseUrl: 'http://x', model: 'm', wsPort: 9000 });
    const config = loadConfig('/some/cwd', path);
    expect(config.agentsDir).toBe('/some/cwd/definitions/agents');
    expect(config.tasksDir).toBe('/some/cwd/definitions/tasks');
  });
});
