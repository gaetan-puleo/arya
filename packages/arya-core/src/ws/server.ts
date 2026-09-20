import type { IncomingMessage } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { Command } from 'mu-coding';
import type { AgentSessionEvent } from 'mu-coding';
import type { ChannelAdapter, ChannelAdapterContext, ChannelAdapterHandle } from '../channels';
import { probeModelCapabilities } from 'mu-coding';
import { errMsg, type ContentPart, text as textPart } from 'mu-core';
import { createSessionService } from './session-service';
import { observeSubAgent } from './sub-agent';
import { SkillLearningMonitor } from '../skills';
import { attachmentsToParts, textOf, type WireAttachment } from './wire';
import { emitSessionEvent } from './wire-events';
import {
  approvalRequestToWire,
  parseInbound,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type SessionSearchHit,
  type WireAgent,
  type WireCommand,
  type WireModel,
  type WirePanelSection,
  type WireSessionChangeKind,
  type WsInbound,
  type WsOutbound,
} from './protocol';

export interface WebSocketAdapterOptions {
  port: number;
  host?: string;
  authToken?: string;
  activeAgentId?: string;
  listModels?: () => Promise<WireModel[]>;
  /** Modalities the configured model accepts. Image/audio attachments are dropped when off. */
  capabilities?: { vision?: boolean; audio?: boolean };
  maxPayloadBytes?: number;
  /** Optional live side-panel provider. When set, each connecting client receives an
   * initial `panel:update` frame; the host pushes fresh frames as data changes. */
  panelProvider?: () => WirePanelSection[];
  /** TLS: PEM-encoded private key + certificate. When set, the WS runs over
   * https/wss instead of plain http/ws. */
  tls?: { key: string; cert: string };
  log?: (msg: string) => void;
}

export type WebSocketAdapter = ChannelAdapter & {
  push(frame: WsOutbound): void;
  /** Update the advertised model capabilities and broadcast a fresh `capabilities` frame. */
  setCapabilities(caps: { vision: boolean; audio: boolean }): void;
};

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
const WS_CLOSE_POLICY = 1008;

interface ClientSession {
  ws: WebSocket;
  sessionId: string;
}

function toWireCommands(commands: Command[]): WireCommand[] {
  return commands.map((c) => ({ command: `/${c.name}`, description: c.description }));
}

/** Build a ~120-char snippet centered on the match, with the match window preserved. */
function makeSnippet(body: string, idx: number, qLen: number): string {
  const radius = 55;
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + qLen + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  return (prefix + body.slice(start, end).replace(/\s+/g, ' ').trim() + suffix).trim();
}

export function webSocketAdapter(opts: WebSocketAdapterOptions): WebSocketAdapter {
  const log = opts.log ?? (() => {});
  let pushFn: (frame: WsOutbound) => void = () => {};
  const caps = { vision: opts.capabilities?.vision === true, audio: opts.capabilities?.audio === true };

  const adapter: WebSocketAdapter = {
    name: 'websocket',
    push: (frame) => pushFn(frame),
    setCapabilities: (next) => {
      caps.vision = next.vision;
      caps.audio = next.audio;
      pushFn({ type: 'capabilities', vision: caps.vision, audio: caps.audio });
    },
    start: (ctx) => start(ctx),
  };
  return adapter;

  async function start(ctx: ChannelAdapterContext): Promise<ChannelAdapterHandle> {
    const { harness, approvals, manager } = ctx;
    const service = createSessionService(harness, manager);
    const commands = harness.commands;

    const clients = new Map<WebSocket, ClientSession>();
    const toolNamesBySession = new Map<string, Map<string, string>>();
    const approvalSessions = new Map<string, string>();
    const learningBySession = new Map<string, SkillLearningMonitor>();
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
    pushFn = push;

    // Single outbound path: every channel's events flow through the shared
    // ChannelManager and are translated to wire frames here, keyed by channelId.
    const managerUnsub = manager.subscribe((event) => {
      if (event.type === 'channel_open' || event.type === 'channel_close') return;
      const sessionId = event.channelId;
      let toolNames = toolNamesBySession.get(sessionId);
      if (!toolNames) {
        toolNames = new Map();
        toolNamesBySession.set(sessionId, toolNames);
      }
      emitSessionEvent(sessionId, event as AgentSessionEvent, toolNames, push, (sid) => {
        currentApprovalSessionId = sid;
      });

      // Autonomous-skill detection: watch the turn and surface capture/improve
      // suggestions. Never writes files or triggers turns — just a wire frame.
      let learning = learningBySession.get(sessionId);
      if (!learning) {
        learning = new SkillLearningMonitor((s) => {
          push({
            type: 'skill:suggestion',
            sessionId,
            kind: s.kind,
            skill: s.kind === 'improve' ? s.skill : undefined,
            reason: s.reason,
            steps: s.steps,
          });
        });
        learningBySession.set(sessionId, learning);
      }
      learning.observe(event as { type: string; name?: string; input?: unknown });
    });

    const getAgents = (): WireAgent[] =>
      service.agents().map((a) => ({ name: a.name, description: a.description, color: a.color }));

    function agentsFrame(): WsOutbound {
      return { type: 'agents', agents: getAgents(), activeAgentId: opts.activeAgentId ?? null };
    }

    async function modelsFrame(): Promise<WsOutbound | null> {
      if (!opts.listModels) return null;
      try {
        return { type: 'models:listed', models: await opts.listModels(), selected: harness.models.selected };
      } catch (err) {
        // A provider/backend being unreachable must never break a connection.
        log(`models:list failed: ${errMsg(err)}`);
        return null;
      }
    }

    async function refreshSessions(sessionId: string, kind: WireSessionChangeKind): Promise<void> {
      push({ type: 'sessions:changed', sessionId, kind });
      push({ type: 'sessions:listed', sessions: await service.list() });
    }

    // Build the channel payload from text + attachments, dropping any modality the model lacks.
    function buildChatPayload(
      sessionId: string,
      body: string,
      attachments: WireAttachment[] | undefined,
    ): string | ContentPart[] {
      if (!attachments || attachments.length === 0) return body;
      const allowed = attachments.filter((a) => (a.kind === 'image' ? caps.vision : caps.audio));
      if (allowed.length < attachments.length) {
        const kinds = [...new Set(attachments.filter((a) => !allowed.includes(a)).map((a) => a.kind))].join('/');
        push({
          type: 'error',
          sessionId,
          message: `the active model has no ${kinds} capability — attachment(s) dropped`,
        });
      }
      if (allowed.length === 0) return body;
      const parts = attachmentsToParts(allowed);
      return body ? [textPart(body), ...parts] : parts;
    }

    async function dispatch(client: ClientSession, msg: WsInbound): Promise<void> {
      switch (msg.type) {
        case 'hello': {
          if (msg.protocolVersion > PROTOCOL_VERSION) {
            log(`client protocol ${msg.protocolVersion} > server ${PROTOCOL_VERSION}; closing`);
            client.ws.close(4002, 'protocol version too new');
            return;
          }
          if (msg.protocolVersion < MIN_PROTOCOL_VERSION) {
            log(`client protocol ${msg.protocolVersion} < min ${MIN_PROTOCOL_VERSION}; closing`);
            client.ws.close(4003, 'protocol version too old');
            return;
          }
          log(`client hello: protocol ${msg.protocolVersion} (${msg.client ?? 'unknown'})`);
          return;
        }
        case 'chat': {
          const sessionId = msg.sessionId ?? client.sessionId;
          client.sessionId = sessionId;
          currentApprovalSessionId = sessionId;
          const channel = manager.get(sessionId) ?? manager.open({ id: sessionId });
          const payload = buildChatPayload(sessionId, msg.text, msg.attachments);
          const turnOpts = msg.thinking === 'off' ? { chatTemplateKwargs: { enable_thinking: false } } : undefined;
          void channel.send(payload, turnOpts).catch((err: unknown) => {
            push({ type: 'error', sessionId, message: errMsg(err) });
          });
          return;
        }
        case 'command': {
          const sessionId = msg.sessionId ?? client.sessionId;
          const result = await commands.run(msg.text, { sessionId, session: manager.get(sessionId)?.session });
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
        case 'abort':
          manager.get(msg.sessionId)?.abort();
          push({ type: 'turn_end', sessionId: msg.sessionId, reason: 'aborted' });
          return;
        case 'models:list': {
          const frame = await modelsFrame();
          if (frame) send(client.ws, frame);
          return;
        }
        case 'models:select': {
          harness.models.select(msg.ref);
          const frame = await modelsFrame();
          if (frame) push(frame);
          // Detecting the new model's modalities loads it (a /props round-trip can be a
          // 10-30s cold start) — surface that as a loading state to every channel.
          await probeModelCapabilities(harness.models, msg.ref, {
            onLoading: (model, loading) => push({ type: 'model_loading', model, loading }),
            onCapabilities: (modalities) => {
              caps.vision = modalities.vision;
              caps.audio = modalities.audio;
              push({ type: 'capabilities', vision: caps.vision, audio: caps.audio });
            },
          });
          return;
        }
        case 'subagent:dispatch': {
          try {
            const result = await harness.dispatchSubAgent(msg.agent, msg.task, msg.parentId);
            send(client.ws, {
              type: 'subagent:result',
              requestId: msg.requestId,
              agent: result.agent,
              text: result.text,
            });
          } catch (err) {
            const message = errMsg(err);
            send(client.ws, { type: 'subagent:error', requestId: msg.requestId, message });
          }
          return;
        }
        case 'sessions:list':
          send(client.ws, { type: 'sessions:listed', sessions: await service.list() });
          return;
        case 'sessions:create': {
          const sessionId = msg.sessionId ?? crypto.randomUUID();
          await service.create(sessionId, msg.title);
          await refreshSessions(sessionId, 'created');
          return;
        }
        case 'sessions:delete': {
          manager.get(msg.sessionId)?.abort();
          manager.close(msg.sessionId);
          toolNamesBySession.delete(msg.sessionId);
          learningBySession.delete(msg.sessionId);
          await service.delete(msg.sessionId);
          await refreshSessions(msg.sessionId, 'deleted');
          return;
        }
        case 'sessions:rename':
          service.rename(msg.sessionId, msg.title);
          await refreshSessions(msg.sessionId, 'renamed');
          return;
        case 'sessions:fork': {
          const { id, messages } = await service.fork(msg.sessionId, msg.upToIndex);
          send(client.ws, { type: 'sessions:forked', requestId: msg.requestId, sessionId: id, messages });
          await refreshSessions(id, 'created');
          return;
        }
        case 'sessions:get': {
          const session = await service.history(msg.sessionId);
          send(client.ws, { type: 'sessions:history', sessionId: msg.sessionId, session });
          send(client.ws, {
            type: 'sessions:raw',
            sessionId: msg.sessionId,
            messages: await service.rawMessages(msg.sessionId),
          });
          return;
        }
        case 'sessions:search': {
          const q = msg.query.trim().toLowerCase();
          const results: SessionSearchHit[] = [];
          if (q) {
            const sessions = await service.list();
            for (const s of sessions) {
              const msgs = await service.rawMessages(s.id);
              let matches = 0;
              let snippet = '';
              for (const m of msgs) {
                if (m.role === 'system') continue;
                const body = textOf(m.content);
                const idx = body.toLowerCase().indexOf(q);
                if (idx >= 0) {
                  matches += 1;
                  if (!snippet) snippet = makeSnippet(body, idx, q.length);
                }
              }
              if (matches > 0) results.push({ id: s.id, title: s.title, snippet, matches });
            }
            results.sort((a, b) => b.matches - a.matches);
          }
          send(client.ws, { type: 'sessions:search:results', requestId: msg.requestId, query: msg.query, results });
          return;
        }
        case 'voice:check': {
          const reason = await harness.voice.unavailableReason().catch((err) =>
            errMsg(err)
          );
          send(client.ws, { type: 'voice:availability', requestId: msg.requestId, reason: reason ?? undefined });
          return;
        }
        case 'voice:transcribe': {
          try {
            const text = await harness.voice.transcribe(new Uint8Array(Buffer.from(msg.data, 'base64')), msg.mime);
            send(client.ws, { type: 'voice:result', requestId: msg.requestId, text });
          } catch (err) {
            send(client.ws, {
              type: 'voice:error',
              requestId: msg.requestId,
              message: errMsg(err),
            });
          }
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
      // `'*'` = unscoped approval (e.g. scheduler-driven, no WS session context):
      // any authenticated client may resolve it. A scoped approval may only be
      // resolved by the client owning that session — no falsy-skip.
      if (issuedFor !== '*' && client.sessionId !== issuedFor) {
        log(`approval_response rejected: socket session=${client.sessionId} != approval session=${issuedFor}`);
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

      send(ws, { type: 'server_hello', protocolVersion: PROTOCOL_VERSION });
      send(ws, { type: 'commands', commands: toWireCommands(commands.list()) });
      send(ws, { type: 'capabilities', vision: caps.vision, audio: caps.audio });
      send(ws, agentsFrame());
      void modelsFrame().then((frame) => frame && send(ws, frame));
      void service.list().then((sessions) => send(ws, { type: 'sessions:listed', sessions }));
      if (opts.panelProvider) send(ws, { type: 'panel:update', sections: opts.panelProvider() });
      for (const pending of approvals.pending()) {
        const scoped = approvalSessions.get(pending.id) ?? currentApprovalSessionId;
        send(ws, approvalRequestToWire(pending, scoped === '*' ? null : scoped));
      }

      ws.on('message', (data: { toString(): string }) => {
        handleMessage(client, data.toString()).catch((err: unknown) => {
          const message = errMsg(err);
          log(`handler crashed: ${message}`);
          send(ws, { type: 'error', message });
        });
      });
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    }

    // Stream every spawned sub-agent's lifecycle to clients (live preview).
    const subAgentUnsub = service.subAgents.subscribe((run) =>
      observeSubAgent(
        run.session,
        { runId: run.runId, agentName: run.agent, parentSessionId: run.parentId ?? '' },
        push,
      )
    );

    const host = opts.host ?? '127.0.0.1';
    const maxPayload = opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    // TLS: front the WebSocketServer with an https server so the wire (token +
    // conversations) is encrypted. Without it, plain http/ws.
    const httpServer: Server = opts.tls
      ? createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert }, (_req, res) => {
          res.writeHead(426, { 'content-type': 'text/plain' });
          res.end('Upgrade required');
        })
      : createHttpServer((_req, res) => {
          res.writeHead(426, { 'content-type': 'text/plain' });
          res.end('Upgrade required');
        });
    const server = new WebSocketServer({ server: httpServer, maxPayload });
    wss = server;
    // Heartbeat: ping every client; a socket that missed the previous pong is
    // half-open (NAT expiry, sleeping phone) — terminate it so the client can
    // reconnect instead of sitting on a dead connection.
    const HEARTBEAT_MS = 30_000;
    const alive = new WeakMap<WebSocket, boolean>();
    const heartbeat = setInterval(() => {
      for (const { ws } of clients.values()) {
        if (alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        alive.set(ws, false);
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    server.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      onConnection(ws, req);
    });
    // Resolve only once accepting connections, so an in-process loopback client
    // can connect without ECONNREFUSED. The WebSocketServer is attached to the
    // (http|https) server, so we drive listen() on that server.
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      httpServer.once('error', onError);
      httpServer.once('listening', () => {
        httpServer.off('error', onError);
        resolve();
      });
      httpServer.listen(opts.port, host);
    });
    server.on('wsClientError', (err: Error, socket: { destroy: () => void }) => {
      try {
        socket.destroy();
      } catch {
      }
      log(`wsClientError: ${err.message ?? String(err)}`);
    });
    approvalUnsub = approvals.subscribe((req) => {
      // Route by the session that actually triggered the approval (threaded from
      // the tool call), not a global that races across concurrent turns.
      const issuedFor = req.sessionId ?? '*';
      approvalSessions.set(req.id, issuedFor);
      push(approvalRequestToWire(req, issuedFor === '*' ? null : issuedFor));
    });

    return {
      stop: async () => {
        clearInterval(heartbeat);
        managerUnsub();
        subAgentUnsub();
        approvalUnsub?.();
        approvalUnsub = undefined;
        pushFn = () => {};
        toolNamesBySession.clear();
        learningBySession.clear();
        approvalSessions.clear();
        for (const { ws } of clients.values()) {
          if (ws.readyState === WebSocket.OPEN) ws.close(WS_CLOSE_POLICY, 'Server shutting down');
        }
        clients.clear();
        if (wss) {
          const s = wss;
          await new Promise<void>((resolve) => s.close(() => resolve()));
          wss = null;
        }
        // Force-kill lingering sockets (half-open clients, keep-alive) so the
        // http(s) close doesn't hang waiting on them; guard with a timeout so
        // stop() always returns even if a socket refuses to die.
        httpServer.closeAllConnections?.();
        await Promise.race([
          new Promise<void>((resolve) => httpServer.close(() => resolve())),
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 2000);
            t.unref?.();
          }),
        ]);
      },
    };
  }
}
