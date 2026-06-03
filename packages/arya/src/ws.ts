import type { IncomingMessage } from 'node:http';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import type { ApprovalManager, Command, CommandRegistry } from 'mu-harness';
import { type CompanionChannel, createCompanionChannel } from './companion-channel';
import {
  approvalRequestToWire,
  parseInbound,
  type WireAgent,
  type WireCommand,
  type WireSessionChangeKind,
  type WsInbound,
  type WsOutbound,
} from './protocol';
import type { AryaRuntime } from './runtime';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
function makeLog(scope: string, levelEnvVar: string) {
  const raw = (process.env[levelEnvVar] ?? 'info').toLowerCase();
  const level: LogLevel = (raw in LEVEL_ORDER ? raw : 'info') as LogLevel;
  const threshold = LEVEL_ORDER[level];
  const at = (lvl: LogLevel) => LEVEL_ORDER[lvl] >= threshold;
  return {
    debug: (msg: string) => at('debug') && console.log(`[${scope}] ${msg}`),
    info: (msg: string) => at('info') && console.log(`[${scope}] ${msg}`),
    warn: (msg: string) => at('warn') && console.warn(`[${scope}] ${msg}`),
    error: (msg: string) => at('error') && console.error(`[${scope}] ${msg}`),
  };
}
const log = makeLog('arya:ws', 'ARYA_LOG_LEVEL');

export interface WebSocketServerOptions {
  port: number;
  host?: string;
  authToken?: string;
  runtime: AryaRuntime;
  approvals: ApprovalManager;
  commands: CommandRegistry;
  getAgents: () => WireAgent[];
  activeAgentId?: string;
  maxPayloadBytes?: number;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
const WS_CLOSE_POLICY = 1008;

export interface WebSocketServerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  push(event: WsOutbound): void;
}

interface ClientSession {
  ws: WebSocket;
  sessionId: string;
}

function toWireCommands(commands: Command[]): WireCommand[] {
  return commands.map((c) => ({ command: `/${c.name}`, description: c.description }));
}

export function createWebSocketServer(opts: WebSocketServerOptions): WebSocketServerHandle {
  const { runtime, approvals, commands } = opts;
  const clients = new Map<WebSocket, ClientSession>();
  const channels = new Map<string, CompanionChannel>();
  const approvalSessions = new Map<string, string>();
  let currentApprovalSessionId: string | null = null;

  let wss: WebSocketServer | null = null;
  let approvalUnsub: (() => void) | undefined;

  function push(event: WsOutbound): void {
    const data = JSON.stringify(event);
    for (const { ws } of clients.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
  function send(ws: WebSocket, event: WsOutbound): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }

  function agentsFrame(): WsOutbound {
    return { type: 'agents', agents: opts.getAgents(), activeAgentId: opts.activeAgentId ?? null };
  }

  async function activate(sessionId: string): Promise<CompanionChannel> {
    const existing = channels.get(sessionId);
    if (existing) return existing;
    const session = await runtime.session(sessionId);
    const channel = createCompanionChannel({
      sessionId,
      getSession: () => session,
      broadcast: push,
      onTurnStart: (sid) => {
        currentApprovalSessionId = sid;
      },
    });
    channels.set(sessionId, channel);
    return channel;
  }

  async function refreshSessions(sessionId: string, kind: WireSessionChangeKind): Promise<void> {
    push({ type: 'sessions:changed', sessionId, kind });
    push({ type: 'sessions:listed', sessions: await runtime.list() });
  }

  async function dispatch(client: ClientSession, msg: WsInbound): Promise<void> {
    switch (msg.type) {
      case 'chat': {
        const sessionId = msg.sessionId ?? client.sessionId;
        client.sessionId = sessionId;
        currentApprovalSessionId = sessionId;
        const channel = await activate(sessionId);
        void channel.send(msg.text).catch((err: unknown) => {
          push({ type: 'error', sessionId, message: err instanceof Error ? err.message : String(err) });
        });
        return;
      }
      case 'command': {
        const sessionId = msg.sessionId ?? client.sessionId;
        const result = await commands.run(msg.text, { sessionId });
        if (result.ok) {
          if (result.output != null) {
            push({
              type: 'message',
              sessionId,
              message: {
                id: crypto.randomUUID(),
                ts: Date.now(),
                role: 'system',
                content: String(result.output),
                meta: { visibility: 'ui' },
              },
            });
          }
        } else {
          send(client.ws, { type: 'error', sessionId, message: result.error ?? 'command failed' });
        }
        return;
      }
      case 'commands':
        send(client.ws, { type: 'commands', commands: toWireCommands(commands.list()) });
        return;
      case 'agents':
        send(client.ws, agentsFrame());
        return;
      case 'approval_response':
        handleApprovalResponse(client, msg.requestId, msg.action);
        return;
      case 'set_active_agent':
        push({
          type: 'active_agent',
          agentId: msg.agentId,
          sessionId: msg.sessionId,
          reason: 'echo-only (server uses a single configured primary agent)',
        });
        return;
      case 'sessions:list':
        send(client.ws, { type: 'sessions:listed', sessions: await runtime.list() });
        return;
      case 'sessions:create': {
        const sessionId = msg.sessionId ?? crypto.randomUUID();
        await runtime.create(sessionId, msg.title);
        await refreshSessions(sessionId, 'created');
        return;
      }
      case 'sessions:delete': {
        channels.get(msg.sessionId)?.detach();
        channels.delete(msg.sessionId);
        await runtime.delete(msg.sessionId);
        await refreshSessions(msg.sessionId, 'deleted');
        return;
      }
      case 'sessions:rename':
        runtime.rename(msg.sessionId, msg.title);
        await refreshSessions(msg.sessionId, 'renamed');
        return;
      case 'sessions:get': {
        const session = await runtime.history(msg.sessionId);
        send(client.ws, { type: 'sessions:history', sessionId: msg.sessionId, session });
        return;
      }
    }
  }

  function handleApprovalResponse(
    client: ClientSession,
    requestId: string,
    action: 'approve' | 'approve_always' | 'deny',
  ): void {
    const issuedFor = approvalSessions.get(requestId);
    if (issuedFor === undefined) {
      send(client.ws, { type: 'error', message: `Unknown or already-resolved approval: ${requestId}` });
      return;
    }
    if (issuedFor && client.sessionId !== issuedFor) {
      log.warn(
        `approval_response rejected: socket session=${client.sessionId} does not own approval session=${issuedFor}`,
      );
      send(client.ws, { type: 'error', message: 'Not authorized to respond to this approval' });
      return;
    }
    approvalSessions.delete(requestId);
    approvals.resolve(requestId, action);
  }

  async function handleMessage(client: ClientSession, raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      send(client.ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }
    const result = parseInbound(parsed);
    if ('error' in result) {
      send(client.ws, { type: 'error', message: result.error });
      return;
    }
    await dispatch(client, result);
  }

  function onConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token') ?? undefined;
    if (opts.authToken && token !== opts.authToken) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    const sessionId = url.searchParams.get('sessionId') || 'default';
    const client: ClientSession = { ws, sessionId };
    clients.set(ws, client);

    send(ws, { type: 'commands', commands: toWireCommands(commands.list()) });
    send(ws, agentsFrame());
    void runtime.list().then((sessions) => send(ws, { type: 'sessions:listed', sessions }));
    for (const req of approvals.pending()) {
      send(ws, approvalRequestToWire(req, approvalSessions.get(req.id) ?? currentApprovalSessionId));
    }

    ws.on('message', (data: RawData) => {
      handleMessage(client, data.toString()).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`handler crashed: ${message}`);
        send(ws, { type: 'error', message });
      });
    });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  }

  return {
    async start() {
      const host = opts.host ?? '127.0.0.1';
      const maxPayload = opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
      wss = new WebSocketServer({ port: opts.port, host, maxPayload });
      wss.on('connection', (ws: WebSocket, req: IncomingMessage) => onConnection(ws, req));
      wss.on('wsClientError', (err: Error, socket: { destroy: () => void }) => {
        try {
          socket.destroy();
        } catch {
        }
        log.error(`wsClientError: ${err.message ?? String(err)}`);
      });
      approvalUnsub = approvals.subscribe((req) => {
        const issuedFor = currentApprovalSessionId ?? '';
        approvalSessions.set(req.id, issuedFor);
        push(approvalRequestToWire(req, issuedFor));
      });
    },
    async stop() {
      approvalUnsub?.();
      approvalUnsub = undefined;
      for (const channel of channels.values()) channel.detach();
      channels.clear();
      approvalSessions.clear();
      for (const { ws } of clients.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.close(WS_CLOSE_POLICY, 'Server shutting down');
      }
      clients.clear();
      if (wss) {
        const server = wss;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        wss = null;
      }
    },
    push,
  };
}
