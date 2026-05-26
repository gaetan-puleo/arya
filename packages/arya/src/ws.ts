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
  authToken?: string;
  agent: AgentRuntime;
  approvalQueue: ApprovalQueue;
  commandRegistry: CommandRegistry;
  getSubAgents: () => SubAgent[];
}

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
        approvalQueue.resolve(requestId, decision);
        return;
      }

      case 'sessions:list':
        send(ws, { type: 'sessions:listed', sessions: store.summaries() });
        return;

      case 'sessions:create':
        store.create({ title: typeof msg.title === 'string' ? msg.title : undefined });
        return;

      case 'sessions:delete':
        if (typeof msg.sessionId !== 'string') {
          send(ws, { type: 'error', message: 'sessions:delete missing sessionId' });
          return;
        }
        if (activeSessionId === msg.sessionId) teardownActive();
        store.delete(msg.sessionId);
        return;

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
    const interval = setInterval(() => {
      if (runtime.state() === 'idle') {
        clearInterval(interval);
        push({ type: 'turn_end', sessionId });
      }
    }, 100);
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

    send(ws, { type: 'commands', commands: commandsList() });
    send(ws, { type: 'agents', agents: agentsList() });
    send(ws, { type: 'sessions:listed', sessions: store.summaries() });
    // Re-broadcast any approvals still pending so a freshly connected client sees them.
    for (const req of approvalQueue.pending()) {
      send(ws, {
        type: 'approval_request',
        requestId: req.id,
        sessionId: activeSessionId,
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
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  }

  return {
    async start() {
      wss = new WebSocketServer({ port: opts.port });
      wss.on('connection', (ws: WebSocket, req: IncomingMessage) => onConnection(ws, req));
      storeWatchUnsub = store.watch((sessionId, kind) => {
        push({ type: 'sessions:changed', sessionId, kind });
        push({ type: 'sessions:listed', sessions: store.summaries() });
      });
      approvalUnsub = approvalQueue.subscribe((req) => {
        push({
          type: 'approval_request',
          requestId: req.id,
          sessionId: activeSessionId,
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
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      }
      clients.clear();
      wss?.close();
      wss = null;
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
