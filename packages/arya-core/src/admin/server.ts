import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocketServer, type WebSocket } from 'ws';
import { TaskStore } from '../tasks/store';
import { toWireTask, toWireTaskEvent, type TaskStatus, type TaskPriority } from '../tasks';
import { writeAgentFile, listAgentFiles, deleteAgentFile, type AdminAgentInput } from './agents';
import { AdminAuth } from './auth';
import { DASHBOARD_HTML, LOGIN_HTML } from './dashboard';
import { errMsg } from 'mu-core';

export interface AdminServerOptions {
  port: number;
  host?: string;
  auth: AdminAuth;
  taskStore: TaskStore;
  agentsDir: string;
  /** Main chat WS port + token, so the dashboard's Sessions tab can reach arya directly. */
  chatPort?: number;
  chatToken?: string;
  /** TLS: PEM-encoded private key + certificate. When set, the dashboard serves https. */
  tls?: { key: string; cert: string };
  log?: (msg: string) => void;
}

const COOKIE = 'arya_admin';
const COOKIE_MAX_AGE = 60 * 60 * 12; // matches AdminAuth SESSION_TTL

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const asObj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(asObj(JSON.parse(data || '{}')));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * A self-contained admin surface for arya: serves the dashboard over HTTP and a
 * dedicated `/admin` WebSocket for kanban + sub-agent CRUD. Auth is a login /
 * password backed by SQLite (`AdminAuth`); a successful login sets an HttpOnly
 * session cookie that gates both the page and the WebSocket upgrade.
 */
export function createAdminServer(opts: AdminServerOptions): {
  listen: () => Promise<void>;
  close: () => Promise<void>;
} {
  const log = opts.log ?? (() => {});
  const host = opts.host ?? '127.0.0.1';
  const sessionOf = (req: IncomingMessage) => opts.auth.validateSession(parseCookies(req)[COOKIE]);

  // Login throttle: per-IP sliding window, so a brute-force against the default
  // admin/admin seed can't run at line rate.
  const LOGIN_WINDOW_MS = 60_000;
  const LOGIN_MAX = 8;
  const loginAttempts = new Map<string, number[]>();
  const throttled = (ip: string): boolean => {
    const now = Date.now();
    // Bound memory: prune IPs whose window has fully expired so forged-source
    // IPs can't grow the map without limit.
    if (loginAttempts.size > 32) {
      for (const [key, times] of loginAttempts) {
        const alive = times.filter((t) => now - t < LOGIN_WINDOW_MS);
        if (alive.length === 0) loginAttempts.delete(key);
        else if (alive.length !== times.length) loginAttempts.set(key, alive);
      }
    }
    const recent = (loginAttempts.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    recent.push(now);
    loginAttempts.set(ip, recent);
    return recent.length > LOGIN_MAX;
  };
  const clientIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';
  const secureCookie = Boolean(opts.tls);

  const requestHandler = (req: IncomingMessage, res: import('node:http').ServerResponse): void => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/admin/chat-config') {
      if (!sessionOf(req)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ port: opts.chatPort ?? null, token: opts.chatToken ?? null }));
      return;
    }

    if (method === 'POST' && url.pathname === '/login') {
      void (async () => {
        const ip = clientIp(req);
        if (throttled(ip)) {
          res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
          res.end(JSON.stringify({ ok: false, error: 'Too many login attempts; retry later' }));
          log(`admin: login throttled for ${ip}`);
          return;
        }
        const body = await readJsonBody(req);
        const token = opts.auth.login(str(body.username), str(body.password));
        if (!token) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid username or password' }));
          return;
        }
        loginAttempts.delete(ip);
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${secureCookie ? '; Secure' : ''}`,
        });
        res.end(JSON.stringify({ ok: true }));
        log(`admin: login "${str(body.username)}"`);
      })();
      return;
    }

    if (method === 'POST' && url.pathname === '/logout') {
      opts.auth.logout(parseCookies(req)[COOKIE]);
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie ? '; Secure' : ''}` });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/login') {
      if (sessionOf(req)) {
        res.writeHead(302, { location: '/' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(LOGIN_HTML);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!sessionOf(req)) {
        res.writeHead(302, { location: '/login' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(DASHBOARD_HTML);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  };

  const http: Server = opts.tls
    ? createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert }, requestHandler)
    : createHttpServer(requestHandler);

  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/admin') {
      socket.destroy();
      return;
    }
    if (!sessionOf(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const send = (frame: unknown): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };
    const off = opts.taskStore.onEvent((e) => send({ type: 'task_event', event: toWireTaskEvent(e) }));
    ws.on('close', off);

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = str(msg.type);
      try {
        switch (type) {
          case 'tasks:list':
            send({ type: 'tasks:list', tasks: opts.taskStore.list().map(toWireTask) });
            break;
          case 'task:create':
            opts.taskStore.create({
              title: str(msg.title),
              status: (str(msg.status) || undefined) as TaskStatus | undefined,
              assignee: str(msg.assignee) || undefined,
              priority: (str(msg.priority) || undefined) as TaskPriority | undefined,
              notes: str(msg.notes) || undefined,
            });
            break;
          case 'task:move':
            opts.taskStore.move(str(msg.id), str(msg.status) as TaskStatus);
            break;
          case 'task:update':
            opts.taskStore.update(str(msg.id), {
              title: typeof msg.title === 'string' ? msg.title : undefined,
              assignee: typeof msg.assignee === 'string' ? msg.assignee : undefined,
              priority: (typeof msg.priority === 'string' ? msg.priority : undefined) as TaskPriority | undefined,
              notes: typeof msg.notes === 'string' ? msg.notes : undefined,
            });
            break;
          case 'task:remove':
            opts.taskStore.remove(str(msg.id));
            break;
          case 'agents:list':
            send({ type: 'agents:list', agents: listAgentFiles(opts.agentsDir) });
            break;
          case 'agent:create': {
            const input: AdminAgentInput = {
              name: str(msg.name),
              description: str(msg.description) || undefined,
              color: str(msg.color) || undefined,
              prompt: str(msg.prompt),
              tools: asObj(msg.tools),
            };
            const file = writeAgentFile(opts.agentsDir, input);
            send({ type: 'agent:created', file, name: input.name });
            log(`admin: created agent "${input.name}" → ${file}`);
            break;
          }
          case 'agent:delete':
            if (deleteAgentFile(opts.agentsDir, str(msg.file))) {
              send({ type: 'agent:deleted', file: str(msg.file) });
            }
            break;
          default:
            break;
        }
      } catch (err) {
        send({ type: 'error', message: errMsg(err) });
      }
    });
  });

  return {
    listen: () =>
      new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(opts.port, host, () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
