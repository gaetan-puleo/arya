/**
 * arya WebSocket server.
 *
 * Pure transport: speaks JSON over WS, forwards to the harness AgentRuntime
 * (one runtime at a time, rebound when the client switches sessions),
 * bridges CoreEvents to outbound messages, and surfaces pending approvals.
 *
 * Inbound:
 *   chat | command | commands | agents | approval_response |
 *   sessions:{list,create,delete,rename,get}
 *
 * Outbound:
 *   stream | reasoning | message | activity | error | turn_end |
 *   approval_request | commands | agents | sessions:{listed,changed,history}
 */
import type { IncomingMessage } from 'node:http';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import type { Message, Runtime, ToolCall, Unsubscribe } from 'mu-core';
import {
  type AgentRuntime,
  type ApprovalQueue,
  type CommandRegistry,
  createLogger,
  type PersistedSessionStore,
  type SubAgent,
} from 'mu-harness';

const log = createLogger('arya:ws', { levelEnvVar: 'ARYA_LOG_LEVEL' });

export interface WebSocketServerOptions {
  port: number;
  /** Bind address. Defaults to `127.0.0.1` (loopback-only). Pass `'0.0.0.0'` to expose on LAN. */
  host?: string;
  authToken?: string;
  agent: AgentRuntime;
  approvalQueue: ApprovalQueue;
  commandRegistry: CommandRegistry;
  getSubAgents: () => SubAgent[];
  /** Max inbound WS frame size in bytes. Defaults to 1 MiB. */
  maxPayloadBytes?: number;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
/** Close code 1008 = Policy Violation (RFC 6455). */
const WS_CLOSE_POLICY = 1008;

export interface WebSocketServerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Broadcast an arbitrary event to all clients. */
  push(event: Record<string, unknown>): void;
}

function asPersistedStore(agent: AgentRuntime): PersistedSessionStore {
  // Bootstrap wires a PersistedSessionStore; this cast is safe by construction.
  return agent.store as PersistedSessionStore;
}

export function createWebSocketServer(opts: WebSocketServerOptions): WebSocketServerHandle {
  const clients = new Set<WebSocket>();
  const store = asPersistedStore(opts.agent);
  const { bus, approvalQueue, commandRegistry } = { bus: opts.agent.bus, approvalQueue: opts.approvalQueue, commandRegistry: opts.commandRegistry };

  let wss: WebSocketServer | null = null;
  let activeSessionId: string | null = null;
  let activeRuntime: Runtime | null = null;
  let busUnsub: Unsubscribe | undefined;
  let storePersistUnsub: Unsubscribe | undefined;
  let storeWatchUnsub: Unsubscribe | undefined;
  let approvalUnsub: (() => void) | undefined;
  /**
   * Pin each approval request to the session id that was active when it was
   * issued. Used to (a) reject replays targeting a different session and (b)
   * verify the responding socket owns that session.
   */
  const approvalSessions = new Map<string, string>();
  /** Per-socket default session id, set on connect; updated by chat/sessions:get. */
  const socketSessions = new WeakMap<WebSocket, string>();
  /** Active idle-watch interval; cleared on stop / session swap / runtime stop. */
  let idleWatchTimer: ReturnType<typeof setInterval> | null = null;

  // ── Outbound helpers ──────────────────────────────────────────────────
  function push(event: Record<string, unknown>): void {
    const data = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
  function send(ws: WebSocket, event: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }

  // ── Session activation ────────────────────────────────────────────────
  function activate(sessionId: string): Runtime {
    if (activeSessionId === sessionId && activeRuntime) return activeRuntime;
    teardownActive();
    const existing = store.get(sessionId);
    if (existing) {
      activeRuntime = opts.agent.createRuntime(sessionId);
    } else {
      const created = store.create({ title: sessionId });
      activeRuntime = opts.agent.createRuntime(created.id);
      sessionId = created.id;
    }
    activeSessionId = sessionId;
    storePersistUnsub = store.persistOnBus(bus, sessionId);
    busUnsub = bus.subscribe((event) => bridgeBusEvent(event, sessionId));
    return activeRuntime;
  }

  function teardownActive(): void {
    busUnsub?.();
    storePersistUnsub?.();
    busUnsub = undefined;
    storePersistUnsub = undefined;
    if (idleWatchTimer) {
      clearInterval(idleWatchTimer);
      idleWatchTimer = null;
    }
    if (activeRuntime) {
      void activeRuntime.stop();
      activeRuntime = null;
    }
    activeSessionId = null;
  }

  // ── Bus → client bridge ───────────────────────────────────────────────
  function bridgeBusEvent(event: Parameters<Parameters<typeof bus.subscribe>[0]>[0], sessionId: string): void {
    switch (event.type) {
      case 'assistant_delta':
        push({ type: 'stream', sessionId, text: event.content });
        return;
      case 'reasoning_delta':
        push({ type: 'reasoning', sessionId, text: event.content });
        return;
      case 'assistant_message':
        push({ type: 'message', sessionId, message: event.message });
        return;
      case 'reasoning_message':
        push({ type: 'message', sessionId, message: event.message });
        return;
      case 'tool_call':
        push({ type: 'activity', sessionId, event: toolActivity('tool_start', event.call) });
        return;
      case 'tool_result':
        push({ type: 'activity', sessionId, event: { kind: 'tool_end', summary: summariseTool(event.message) } });
        return;
      case 'error':
        push({ type: 'error', sessionId, message: errorMessage(event.error) });
        return;
      case 'user_message':
        push({ type: 'message', sessionId, message: event.message });
        return;
    }
  }

  // ── Inbound dispatch ──────────────────────────────────────────────────
  async function handleMessage(ws: WebSocket, defaultSessionId: string, raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }
    const type = String(msg.type ?? '');
    const sessionId = typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : defaultSessionId;

    switch (type) {
      case 'chat': {
        const text = String(msg.text ?? '');
        const runtime = activate(sessionId);
        socketSessions.set(ws, sessionId);
        await runtime.start();
        bus.publish({ type: 'user_message', message: { role: 'user', content: text } });
        watchForIdle(runtime, sessionId);
        return;
      }

      case 'command': {
        const text = String(msg.text ?? '').trim();
        const result = await commandRegistry.run(text, { sessionId });
        if (result.ok && result.output != null) {
          push({ type: 'message', sessionId, message: { role: 'system', content: String(result.output) } });
        } else if (!result.ok) {
          send(ws, { type: 'error', sessionId, message: result.error ?? 'command failed' });
        }
        return;
      }

      case 'commands':
        send(ws, { type: 'commands', commands: commandsList() });
        return;

      case 'agents':
        send(ws, { type: 'agents', agents: agentsList() });
        return;

      case 'approval_response': {
        const requestId = String(msg.requestId ?? msg.token ?? '');
        const action = String(msg.action ?? 'deny');
        const decision = action === 'approve' || action === 'approve_always' ? 'allow' : 'deny';
        // Ownership check: an approval must be resolved by a socket that owns the
        // session under which it was issued. Without this any connected client
        // could approve any pending tool call by guessing/observing requestIds.
        const issuedFor = approvalSessions.get(requestId);
        if (!issuedFor) {
          send(ws, { type: 'error', message: `Unknown or already-resolved approval: ${requestId}` });
          return;
        }
        const callerSession = socketSessions.get(ws);
        if (callerSession !== issuedFor) {
          log.warn(
            `approval_response rejected: socket session=${callerSession ?? '<none>'} does not own approval session=${issuedFor}`,
          );
          send(ws, { type: 'error', message: 'Not authorized to respond to this approval' });
          return;
        }
        approvalSessions.delete(requestId);
        approvalQueue.resolve(requestId, decision);
        return;
      }

      case 'sessions:list':
        send(ws, { type: 'sessions:listed', sessions: store.summaries() });
        return;

      case 'sessions:create':
        store.create({ title: typeof msg.title === 'string' ? msg.title : undefined });
        return;

      case 'sessions:delete': {
        if (typeof msg.sessionId !== 'string') {
          send(ws, { type: 'error', message: 'sessions:delete missing sessionId' });
          return;
        }
        const deletedId = msg.sessionId;
        const wasActive = activeSessionId === deletedId;
        if (wasActive) teardownActive();
        store.delete(deletedId);
        // Notify ALL clients so any UI tracking this session can clear.
        // `wasActive` lets the client know its current session was wiped.
        push({ type: 'session_deleted', sessionId: deletedId, wasActive });
        return;
      }

      case 'sessions:rename':
        if (typeof msg.sessionId !== 'string') {
          send(ws, { type: 'error', message: 'sessions:rename missing sessionId' });
          return;
        }
        store.rename(msg.sessionId, String(msg.title ?? ''));
        return;

      case 'sessions:get': {
        const id = typeof msg.sessionId === 'string' ? msg.sessionId : '';
        if (!id) {
          send(ws, { type: 'error', message: 'sessions:get missing sessionId' });
          return;
        }
        send(ws, { type: 'sessions:history', sessionId: id, session: store.get(id) ?? null });
        return;
      }

      default:
        send(ws, { type: 'error', message: `Unknown message type: ${type}` });
    }
  }

  function watchForIdle(runtime: Runtime, sessionId: string): void {
    // Cancel any prior watch so we never leak overlapping intervals.
    if (idleWatchTimer) {
      clearInterval(idleWatchTimer);
      idleWatchTimer = null;
    }
    const interval = setInterval(() => {
      // Session was swapped or torn down — the runtime we were watching is gone.
      if (activeRuntime !== runtime || idleWatchTimer !== interval) {
        clearInterval(interval);
        return;
      }
      const state = runtime.state();
      if (state === 'idle' || state === 'stopped') {
        clearInterval(interval);
        idleWatchTimer = null;
        push({ type: 'turn_end', sessionId });
      }
    }, 100);
    idleWatchTimer = interval;
  }

  function commandsList(): Array<{ command: string; description: string }> {
    return commandRegistry.list().map((c) => ({ command: c.name, description: c.description }));
  }

  function agentsList(): Array<{ name: string; description: string; color?: string }> {
    return opts.getSubAgents().map((a) => ({ name: a.name, description: a.description, color: a.color }));
  }

  function onConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token') ?? undefined;
    if (opts.authToken && token !== opts.authToken) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    const defaultSessionId = url.searchParams.get('sessionId') || 'default';
    clients.add(ws);
    socketSessions.set(ws, defaultSessionId);

    send(ws, { type: 'commands', commands: commandsList() });
    send(ws, { type: 'agents', agents: agentsList() });
    send(ws, { type: 'sessions:listed', sessions: store.summaries() });
    // Re-broadcast any approvals still pending so a freshly connected client sees them.
    // Use the session id pinned at issue time (not the now-active one) so a replay
    // after a session switch doesn't mis-attribute the approval.
    for (const req of approvalQueue.pending()) {
      const issuedFor = approvalSessions.get(req.id) ?? activeSessionId;
      send(ws, {
        type: 'approval_request',
        requestId: req.id,
        sessionId: issuedFor,
        toolName: req.toolName,
        args: req.args,
        matchedRule: req.matchedRule,
      });
    }

    ws.on('message', (data: RawData) => {
      handleMessage(ws, defaultSessionId, data.toString()).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`handler crashed: ${message}`);
        send(ws, { type: 'error', message });
      });
    });
    ws.on('close', () => {
      clients.delete(ws);
      socketSessions.delete(ws);
    });
    ws.on('error', () => {
      clients.delete(ws);
      socketSessions.delete(ws);
    });
  }

  return {
    async start() {
      // Default to loopback-only. Public bind requires an explicit host.
      // Cap inbound frames to refuse oversized messages (default 100 MiB in `ws`).
      const host = opts.host ?? '127.0.0.1';
      const maxPayload = opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
      wss = new WebSocketServer({ port: opts.port, host, maxPayload });
      wss.on('connection', (ws: WebSocket, req: IncomingMessage) => onConnection(ws, req));
      // The `ws` library emits this when a frame exceeds `maxPayload`. Close the
      // socket with policy-violation so clients can distinguish from generic errors.
      wss.on('wsClientError', (err, socket) => {
        try {
          socket.destroy();
        } catch {
          /* socket already gone */
        }
        log.error(`wsClientError: ${err instanceof Error ? err.message : String(err)}`);
      });
      storeWatchUnsub = store.watch((sessionId, kind) => {
        push({ type: 'sessions:changed', sessionId, kind });
        push({ type: 'sessions:listed', sessions: store.summaries() });
      });
      approvalUnsub = approvalQueue.subscribe((req) => {
        // Pin the approval to the session active at issue time so replays after
        // a session switch can be rejected (and ownership-checked on response).
        const issuedFor = activeSessionId ?? '';
        approvalSessions.set(req.id, issuedFor);
        push({
          type: 'approval_request',
          requestId: req.id,
          sessionId: issuedFor,
          toolName: req.toolName,
          args: req.args,
          matchedRule: req.matchedRule,
        });
      });
    },
    async stop() {
      storeWatchUnsub?.();
      storeWatchUnsub = undefined;
      approvalUnsub?.();
      approvalUnsub = undefined;
      teardownActive();
      approvalSessions.clear();
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(WS_CLOSE_POLICY, 'Server shutting down');
        }
      }
      clients.clear();
      // Await wss.close so the OS releases the port before resolving.
      if (wss) {
        const server = wss;
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        wss = null;
      }
    },
    push,
  };
}

function toolActivity(kind: 'tool_start', call: ToolCall): Record<string, unknown> {
  return { kind, summary: `${call.tool}(${truncate(call.args, 120)})`, tool: call.tool, args: call.args };
}

function summariseTool(message: Message): string {
  return truncate(message.content, 200);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
