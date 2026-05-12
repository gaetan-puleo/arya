import { WebSocket, WebSocketServer } from 'ws';
import type {
  ActivityBus,
  Channel,
  ChatMessage,
  PluginRegistry,
  ProviderConfig,
  SessionManager,
  SessionStore,
} from 'mu-core';
import {
  type AgentListItem,
  getActiveAgentId,
  getMuAgents,
  listAgents,
  subscribeActiveAgent,
} from 'mu-agents';
import type { MessageBusRouter } from 'mu-core';
import { createLogger } from './lib/logger.js';
import { enrichAuthor } from './lib/enrichAuthor.js';
import { handleSessionsMessage } from './ws/sessions-handler.js';
import {
  createApprovalChannel,
  handleApprovalResponse,
} from './ws/approval.js';
import {
  createConnectionState,
  tearDownConnectionState,
} from './ws/connection-state.js';
import { makeEnsureSubscribed } from './ws/stream-subscriber.js';
import {
  attachSubAgentSnapshotBridge,
  sendSubAgentRunsListing,
} from './ws/sub-agent-snapshot.js';
import {
  attachApprovalSnapshotBridge,
  sendApprovalsListing,
} from './ws/approval-snapshot.js';
import { handleChatMessage } from './ws/chat-handler.js';
import { handleCommandMessage } from './ws/command-handler.js';

const log = createLogger('ws');

export interface WsChannelOptions {
  port: number;
  authToken?: string;
  /** Persistent on-disk session store (history, titles, list/CRUD). */
  store: SessionStore;
  /**
   * Resolved provider config. Threaded into `CommandContext` so slash
   * commands that need an LLM (none today, but reserved for future
   * `/summarize` etc.) can dispatch through the active provider.
   */
  providerConfig: ProviderConfig;
  /**
   * Per-session MessageBus router. Mounted by `bootstrap` and shared with
   * `ctx.messages` so mu-agents' `@<subagent>` dispatch can live-append
   * synthetic messages and queue relay prompts for the next turn.
   */
  messageBus: MessageBusRouter;
}

interface ConnectedClient {
  ws: WebSocket;
  sessionId: string;
}

/**
 * Map mu-core's `SlashCommand` shape (`{ name, description, execute }`)
 * to the wire shape the companion expects (`{ command, description }`).
 * `execute` is intentionally dropped — it's a non-serialisable function.
 */
function buildGetCommandsList(
  registry: PluginRegistry,
): () => Array<{ command: string; description: string }> {
  return () =>
    (registry.getCommands() ?? []).map((c) => ({
      command: c.name,
      description: c.description,
    }));
}

/**
 * WebSocket channel — implements the `Channel` interface from mu-core.
 *
 * Companion → Server:
 *   { type: "chat", text: "...", sessionId?: string }
 *   { type: "command", text: "/help", sessionId?: string }
 *   { type: "approval_response", approvalId: "...", token: "...", action: "approve"|"deny" }
 *   { type: "set_active_agent", agentId: "arya" }
 *   { type: "sessions:list" }
 *   { type: "sessions:create", sessionId?: string, title?: string }
 *   { type: "sessions:delete", sessionId: string }
 *   { type: "sessions:rename", sessionId: string, title: string }
 *   { type: "sessions:get", sessionId: string }
 *
 * Server → Companion (snapshots, not deltas):
 *   { type: "stream", text: "...", sessionId?: string }
 *   { type: "done", text: "...", sessionId?: string }
 *   { type: "approval_state", snapshot: ApprovalSnapshot }
 *   { type: "approvals:listed", approvals: ApprovalSnapshot[] }
 *   { type: "activity", event: ActivityEvent }
 *   { type: "sub_agent_run", run: SubAgentRunSnapshot }
 *   { type: "sub_agent_runs:listed", runs: SubAgentRunSnapshot[] }
 *   { type: "commands", commands: [...] }
 *   { type: "agents", agents: [...], activeAgentId: "arya" | null }
 *   { type: "active_agent", agentId: "arya" | null }
 *   { type: "sessions:listed", sessions: [...] }
 *   { type: "sessions:history", sessionId, session: {..., messages: [...]} | null }
 *   { type: "sessions:changed", sessionId, kind: "created"|"updated"|"deleted"|"renamed" }
 *   { type: "synthetic_message", sessionId, message: ChatMessage & { author? } }
 *   { type: "scheduler_event", event: SchedulerTaskEvent }
 *   { type: "error", message: "..." }
 */
export function createWebSocketChannel(
  sessions: SessionManager,
  registry: PluginRegistry,
  activity: ActivityBus,
  options: WsChannelOptions,
): WsChannel {
  const store = options.store;
  const wss = new WebSocketServer({ port: options.port });
  const clients = new Map<WebSocket, ConnectedClient>();
  const getAgents = (): AgentListItem[] => listAgents(registry);
  const getCommands = buildGetCommandsList(registry);

  // Approval channel — pushes requests to every connected client.
  const approvalChannel = createApprovalChannel();

  wss.on('connection', (ws, req) => {
    // Auth check
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (options.authToken && token !== options.authToken) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const sessionId = url.searchParams.get('sessionId') || 'default';
    clients.set(ws, { ws, sessionId });

    // Register approval channel with mu-agents plugin
    const muAgentsPlugin = getMuAgents(registry);
    if (muAgentsPlugin?.approvalGateway) {
      muAgentsPlugin.approvalGateway.registerChannel('websocket', approvalChannel);
    }

    // Send commands, agents and the persisted sessions list on connect
    const commands = getCommands();
    const agents = getAgents();
    const activeAgentId = getActiveAgentId(registry);
    ws.send(JSON.stringify({ type: 'commands', commands }));
    ws.send(JSON.stringify({ type: 'agents', agents, activeAgentId }));
    ws.send(JSON.stringify({ type: 'sessions:listed', sessions: store.list() }));
    // Bootstrap the new snapshot wire types so a fresh client doesn't
    // have to wait for the next transition.
    sendSubAgentRunsListing(ws, registry);
    sendApprovalsListing(ws, registry);

    // Per-connection bookkeeping (running turns, lazy subscriptions,
    // stream-state caches). See `connection-state.ts` for field docs.
    const connState = createConnectionState();
    const { runningSessions } = connState;

    const ensureSubscribed = makeEnsureSubscribed({
      sessions,
      registry,
      state: connState,
      push,
      baseUrl: options.providerConfig.baseUrl,
    });

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        pushError('Invalid JSON');
        return;
      }

      // Companion can request commands/agents list
      if (msg.type === 'commands') {
        ws.send(JSON.stringify({ type: 'commands', commands: getCommands() }));
        return;
      }
      if (msg.type === 'agents') {
        const agents = getAgents();
        const activeAgentId = getActiveAgentId(registry);
        ws.send(JSON.stringify({ type: 'agents', agents, activeAgentId }));
        return;
      }

      // ── Sessions management ────────────────────────────────────────
      if (handleSessionsMessage(msg, { ws, store, push, pushError })) return;

      // Companion can request a primary-agent switch.
      if (msg.type === 'set_active_agent') {
        const agentId = typeof msg.agentId === 'string' ? msg.agentId : null;
        const manager = getMuAgents(registry)?.manager;
        if (!manager?.setActive || !agentId) {
          pushError('Cannot switch agent: missing agentId or manager');
          return;
        }
        const ok = manager.setActive(agentId);
        // setActive returns false when the name doesn't exist or is already active.
        // The broadcast (active_agent) only fires when the active name actually changes,
        // so explicitly echo the current state to the requester for unchanged cases.
        if (!ok) {
          const current = getActiveAgentId(registry);
          ws.send(JSON.stringify({ type: 'active_agent', agentId: current }));
        }
        return;
      }

      if (
        handleCommandMessage(msg, {
          ws,
          defaultSessionId: sessionId,
          registry,
          store,
          providerConfig: options.providerConfig,
          push,
          getCommands,
        })
      )
        return;

      if (
        handleChatMessage(msg, {
          ws,
          defaultSessionId: sessionId,
          sessions,
          store,
          registry,
          messageBus: options.messageBus,
          providerConfig: options.providerConfig,
          runningSessions,
          ensureSubscribed,
          push,
        })
      )
        return;

      if (handleApprovalResponse(msg, { registry })) return;
    });

    const cleanup = () => {
      clients.delete(ws);
      tearDownConnectionState(connState);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  // Helper to push events to all clients. We enrich message payloads
  // with the resolved `author` info at this wire boundary so clients
  // never have to look agents up themselves.
  function push(event: Record<string, unknown>) {
    const enriched = enrichOutboundEvent(event);
    const data = JSON.stringify(enriched);
    for (const [, client] of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  function enrichOutboundEvent(event: Record<string, unknown>): Record<string, unknown> {
    if (event.type === 'synthetic_message' && event.message) {
      return {
        ...event,
        message: enrichAuthor(event.message as ChatMessage, registry),
      };
    }
    return event;
  }

  function pushError(message: string) {
    push({ type: 'error', message });
  }

  // Subscribe to activity bus to push events to companion
  activity.subscribe((event) => {
    push({ type: 'activity', event });
  });

  // Snapshot bridges — push render-ready sub-agent + approval state to
  // every client. Clients are pure renderers; no client-side reducer.
  const unsubscribeSubAgentSnapshots = attachSubAgentSnapshotBridge({ registry, push });
  const unsubscribeApprovalSnapshots = attachApprovalSnapshotBridge({ registry, push });

  // Broadcast active-agent changes (mode switch, hot-reload fallback, etc.).
  // We also rebroadcast the full commands + agents list because the
  // arya-commands plugin rebuilds its slash-command set on manager change
  // (one `/<agent>` per primary agent), so connected companions need to
  // refresh their inline menu.
  const unsubscribeActiveAgent = subscribeActiveAgent(registry, (agentId) => {
    push({ type: 'active_agent', agentId });
    push({ type: 'commands', commands: getCommands() });
    push({
      type: 'agents',
      agents: getAgents(),
      activeAgentId: agentId,
    });
  });

  const channel: WsChannel = {
    id: 'websocket',
    start: async () => {
      log.info(`Listening on port ${options.port}`);
    },
    stop: async () => {
      unsubscribeActiveAgent();
      unsubscribeSubAgentSnapshots();
      unsubscribeApprovalSnapshots();
      for (const [, client] of clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close();
        }
      }
      wss.close();
    },
    // Expose push for internal use (e.g. approval/activity events)
    push,
    pushError,
  };
  return channel;
}

// Extend Channel type to include push helpers
export interface WsChannel extends Channel {
  push: (event: Record<string, unknown>) => void;
  pushError: (message: string) => void;
}
