import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { TaskStore } from '../tasks/store';
import { writeAgentFile, listAgentFiles, deleteAgentFile, splitFrontmatter } from './agents';
import { AdminAuth } from './auth';
import { createAdminServer } from './server';

describe('admin agent writer', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'arya-admin-agents-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a valid agent .md with frontmatter + prompt body', () => {
    const file = writeAgentFile(dir, {
      name: 'researcher',
      description: 'Deep web research',
      color: '#8B5CF6',
      prompt: 'You research topics and return sources.',
      tools: { webfetch: 'allow', read: 'allow' },
    });
    expect(file).toBe('researcher.md');
    const { fields, body } = splitFrontmatter(readFileSync(join(dir, file), 'utf-8'));
    expect(fields.name).toBe('researcher');
    expect((fields.tools as Record<string, string>).webfetch).toBe('allow');
    expect(body).toContain('You research topics');
  });

  it('lists and deletes agent files', () => {
    writeAgentFile(dir, { name: 'a', prompt: 'p' });
    writeAgentFile(dir, { name: 'b', prompt: 'q' });
    expect(listAgentFiles(dir).map((a) => a.name).sort()).toEqual(['a', 'b']);
    expect(deleteAgentFile(dir, 'a.md')).toBe(true);
    expect(listAgentFiles(dir).map((a) => a.name)).toEqual(['b']);
  });

  it('rejects bad names / empty prompt / path traversal', () => {
    expect(() => writeAgentFile(dir, { name: 'has space', prompt: 'x' })).toThrow();
    expect(() => writeAgentFile(dir, { name: 'ok', prompt: '  ' })).toThrow();
    expect(() => deleteAgentFile(dir, '../evil.md')).toThrow();
  });
});

describe('AdminAuth (sqlite)', () => {
  let dir: string;
  let auth: AdminAuth;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arya-auth-'));
    auth = new AdminAuth(join(dir, 'admin.db'));
  });
  afterEach(() => { auth.close(); rmSync(dir, { recursive: true, force: true }); });

  it('seeds a user once and verifies login', () => {
    expect(auth.hasUsers()).toBe(false);
    expect(auth.ensureUser('admin', 's3cret')).toBe(true);
    expect(auth.ensureUser('admin', 'other')).toBe(false); // already exists
    const token = auth.login('admin', 's3cret');
    expect(token).toBeTruthy();
    expect(auth.login('admin', 'wrong')).toBeNull();
    expect(auth.login('nobody', 's3cret')).toBeNull();
  });

  it('validates a session and rejects a bad token', () => {
    auth.ensureUser('admin', 'pw');
    const token = auth.login('admin', 'pw')!;
    const s = auth.validateSession(token);
    expect(s?.username).toBe('admin');
    expect(auth.validateSession('bogus')).toBeNull();
    auth.logout(token);
    expect(auth.validateSession(token)).toBeNull();
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

describe('admin server login + protocol', () => {
  let dir: string;
  let store: TaskStore;
  let auth: AdminAuth;
  let port: number;
  let srv: { listen: () => Promise<void>; close: () => Promise<void> };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arya-admin-srv-'));
    store = new TaskStore(dir);
    auth = new AdminAuth(join(dir, 'admin.db'));
    auth.ensureUser('admin', 'letmein');
    port = await freePort();
    srv = createAdminServer({ port, host: '127.0.0.1', auth, taskStore: store, agentsDir: dir });
    await srv.listen();
  });
  afterEach(async () => {
    await srv.close();
    auth.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function login(user: string, pass: string): Promise<string | null> {
    const res = await fetch(`http://127.0.0.1:${port}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!res.ok) return null;
    const setCookie = res.headers.get('set-cookie') ?? '';
    const m = /arya_admin=([0-9a-f]+)/.exec(setCookie);
    return m ? m[1] : null;
  }

  it('redirects unauthenticated / to /login', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('rejects bad credentials', async () => {
    expect(await login('admin', 'nope')).toBeNull();
  });

  it('issues a session cookie on valid login and serves the dashboard', async () => {
    const token = await login('admin', 'letmein');
    expect(token).toBeTruthy();
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { cookie: `arya_admin=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Arya · Admin');
  });

  it('rejects a WS connection without a session cookie', async () => {
    await expect(
      new Promise((_r, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/admin`);
        ws.on('open', () => { ws.close(); rej(new Error('should not open')); });
        ws.on('error', () => rej(new Error('rejected')));
        ws.on('close', () => rej(new Error('rejected')));
      }),
    ).rejects.toBeTruthy();
  });

  it('creates a task over an authenticated WS and receives the event', async () => {
    const token = (await login('admin', 'letmein'))!;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/admin`, {
      headers: { cookie: `arya_admin=${token}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'task:create', title: 'via login', status: 'todo' })));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === 'task_event' && m.event.task.title === 'via login') resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
    expect(store.list().some((t) => t.title === 'via login')).toBe(true);
    ws.close();
  });

  it('removes a task over WS and receives the removed event', async () => {
    const token = (await login('admin', 'letmein'))!;
    const created = store.create({ title: 'to be removed', status: 'todo' });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/admin`, {
      headers: { cookie: `arya_admin=${token}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'task:remove', id: created.id })));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === 'task_event' && m.event.type === 'removed' && m.event.task.id === created.id) resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
    expect(store.get(created.id)).toBeUndefined();
    ws.close();
  });

  it('creates a sub-agent over WS and writes the .md file', async () => {
    const token = (await login('admin', 'letmein'))!;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/admin`, {
      headers: { cookie: `arya_admin=${token}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'agent:create', name: 'curator', prompt: 'You curate.' })));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === 'agent:created') resolve();
        if (m.type === 'error') reject(new Error(m.message));
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
    expect(existsSync(join(dir, 'curator.md'))).toBe(true);
    ws.close();
  });
});
