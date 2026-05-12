import { WebSocket, WebSocketServer } from 'ws';
import type {
  Channel,
  ChatMessage,
  MuRuntime,
  SessionStore,
} from 'mu-core';
import {
  type AgentListItem,
  enrichMessageAuthor,
  getActiveAgentId,
  listAgents,
  subscribeActiveAgent,
  subscribeAgentsList,
} from 'mu-agents';
import type { MessageBusRouter } from 'mu-core';
import { createLogger } from './lib/logger.js';
import { handleSessionsMessage } from './ws/sessions-handler.js';
import { handleApprovalResponse } from './ws/approval.js';
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
import { handleAgentMessage } from './ws/agent-handler.js';
import { handleChatMessage } from './ws/chat-handler.js';
import { handleCommandMessage } from './ws/command-handler.js';

const log = createLogger('ws');

export interface WsChannelOptions {
  port: number;
  authToken?: string;
  store: SessionStore;
  messageBus: MessageBusRouter;
}

interface ConnectedClient {
  ws: WebSocket;
  sessionId: string;
}

function buildGetCommandsList(
  runtime: MuRuntime,
): () => Array<{ command: string; description: string }> {
  return () =>
    (runtime.registry.getCommands() ?? []).map((c) => ({
      command: c.name,
      description: c.description,
    }));
}

/**
 * WebSocket channel — implements the `Channel` interface from mu-core.
 *
 * The WebSocket server is created in `start()`, not in the constructor,
 * per the channel contract: constructors only capture options.
 */
export function createWebSocketChannel(
  runtime: MuRuntime,
  options: WsChannelOptions,
): WsChannel {
  const store = options.store;
  const { registry, sessions, activity } = runtime;
  const getAgents = (): AgentListItem[] => listAgents(registry);
  const getCommands = buildGetCommandsList(runtime);

  let wss: WebSocketServer | null = null;
  const clients = new Map<WebSocket, ConnectedClient>();
  const cleanups: Array<() => void> = [];

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
        message: enrichMessageAuthor(event.message as ChatMessage, registry),
      };
    }
    return event;
  }

  function pushError(message: string) {
    push({ type: 'error', message });
  }

  function handleConnection(ws: WebSocket, req: { url?: string; headers: { host?: string } }) {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (options.authToken && token !== options.authToken) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const sessionId = url.searchParams.get('sessionId') || 'default';
    clients.set(ws, { ws, sessionId });

    ws.send(JSON.stringify({ type: 'commands', commands: getCommands() }));
    ws.send(JSON.stringify({ type: 'agents', agents: getAgents(), activeAgentId: getActiveAgentId(registry) }));
    ws.send(JSON.stringify({ type: 'sessions:listed', sessions: store.list() }));
    sendSubAgentRunsListing(ws, registry);
    sendApprovalsListing(ws, registry);

    const connState = createConnectionState();
    const { runningSessions } = connState;

    const ensureSubscribed = makeEnsureSubscribed({
      sessions,
      registry,
      state: connState,
      push,
      baseUrl: runtime.config.baseUrl,
    });

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        pushError('Invalid JSON');
        return;
      }

      if (handleAgentMessage(msg, { ws, registry, getCommands, getAgents, pushError })) return;
      if (handleSessionsMessage(msg, { ws, store, pushError })) return;
      if (
        handleCommandMessage(msg, {
          ws,
          defaultSessionId: sessionId,
          runtime,
          store,
          push,
          getCommands,
        })
      ) return;
      if (
        handleChatMessage(msg, {
          ws,
          defaultSessionId: sessionId,
          runtime,
          runningSessions,
          ensureSubscribed,
          push,
        })
      ) return;
      if (handleApprovalResponse(msg, { registry })) return;
    });

    const cleanup = () => {
      clients.delete(ws);
      tearDownConnectionState(connState);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  }

  const channel: WsChannel = {
    id: 'websocket',
    async start() {
      wss = new WebSocketServer({ port: options.port });
      wss.on('connection', handleConnection);

      cleanups.push(activity.subscribe((event) => {
        push({ type: 'activity', event });
      }));
      cleanups.push(attachSubAgentSnapshotBridge({ registry, push }));
      cleanups.push(attachApprovalSnapshotBridge({ registry, push }));
      cleanups.push(subscribeActiveAgent(registry, (agentId, sessionId) => {
        push({ type: 'active_agent', agentId, sessionId });
        push({ type: 'commands', commands: getCommands() });
        push({ type: 'agents', agents: getAgents(), activeAgentId: agentId });
      }));
      cleanups.push(subscribeAgentsList(registry, (agents) => {
        push({ type: 'commands', commands: getCommands() });
        push({ type: 'agents', agents, activeAgentId: getActiveAgentId(registry) });
      }));

      log.info(`Listening on port ${options.port}`);
    },
    async stop() {
      for (const fn of cleanups) fn();
      cleanups.length = 0;
      for (const [, client] of clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close();
        }
      }
      if (wss) {
        wss.close();
        wss = null;
      }
    },
    push,
    pushError,
  };
  return channel;
}

export interface WsChannel extends Channel {
  push: (event: Record<string, unknown>) => void;
  pushError: (message: string) => void;
}
