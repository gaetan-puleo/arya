import { WebSocket, WebSocketServer } from 'ws';
import type {
  ActivityBus,
  Channel,
  ChannelResponder,
  InboundMessage,
  PluginRegistry,
  SessionManager,
} from 'mu-core';
import type { AgentDefinition, ApprovalGateway, ApprovalRequest, ApprovalChannel } from 'mu-agents';

export interface WsChannelOptions {
  port: number;
  authToken?: string;
}

interface ConnectedClient {
  ws: WebSocket;
  sessionId: string;
}

/** Build the agents list sent to the companion on connect and on request. */
function buildGetAgentsList(registry: PluginRegistry): () => Array<{ id: string; description: string; type: string }> {
  return () => {
    // The agents are managed by the mu-agents plugin. We access them via
    // the registry's getPlugin handle.
    // Note: this is called inside the connection handler, so the plugin
    // must already be registered (it is, since startMu registers all plugins
    // before the channel starts).
    const muAgentsPlugin = (registry as any).getPlugin('mu-agents');
    if (!muAgentsPlugin?.manager) return [];

    const primary = muAgentsPlugin.manager.getPrimary?.() ?? [];
    const subagents = muAgentsPlugin.manager.getSubagents?.() ?? [];
    const all: AgentDefinition[] = [...primary, ...subagents];

    return all.map((a) => ({
      id: a.name,
      description: a.description ?? '',
      type: a.type ?? 'primary',
    }));
  };
}

/**
 * WebSocket channel — implements the `Channel` interface from mu-core.
 *
 * Companion → Server:
 *   { type: "chat", text: "...", sessionId?: string }
 *   { type: "command", text: "/help", sessionId?: string }
 *   { type: "approval_response", requestId: "...", token: "...", action: "approve"|"deny" }
 *
 * Server → Companion:
 *   { type: "stream", text: "...", sessionId?: string }
 *   { type: "done", text: "...", sessionId?: string }
 *   { type: "approval_request", requestId, token, toolName, toolArgs, agentId, channelId }
 *   { type: "approval_response", requestId, token, action }
 *   { type: "activity", event: ActivityEvent }
 *   { type: "sub_agent_event", event: SubAgentEvent }
 *   { type: "commands", commands: [...] }
 *   { type: "agents", agents: [...] }
 *   { type: "error", message: "..." }
 */
export function createWebSocketChannel(
  sessions: SessionManager,
  registry: PluginRegistry,
  activity: ActivityBus,
  options: WsChannelOptions,
): Channel {
  const wss = new WebSocketServer({ port: options.port });
  const clients = new Map<WebSocket, ConnectedClient>();
  const getAgents = buildGetAgentsList(registry);

  // Create an approval channel that pushes approval requests to connected clients
  const approvalChannel: ApprovalChannel = {
    sendApprovalRequest: async (req: ApprovalRequest) => {
      // Push approval request to all connected clients
      push({
        type: 'approval_request',
        requestId: req.id,
        token: req.token,
        toolName: req.toolName,
        toolArgs: req.toolArgs,
        agentId: req.agentId,
        channelId: req.channelId,
      });
      // Return undefined to defer resolution to gateway.approve/deny calls
      return undefined;
    },
  };

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
    const muAgentsPlugin = registry.getPlugin('mu-agents') as { approvalGateway: ApprovalGateway } | undefined;
    if (muAgentsPlugin?.approvalGateway) {
      muAgentsPlugin.approvalGateway.registerChannel('websocket', approvalChannel);
    }

    // Send commands and agents on connect
    const commands = registry.getCommands() ?? [];
    const agents = getAgents();
    ws.send(JSON.stringify({ type: 'commands', commands }));
    ws.send(JSON.stringify({ type: 'agents', agents }));

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
        const commands = registry.getCommands();
        ws.send(JSON.stringify({ type: 'commands', commands }));
        return;
      }
      if (msg.type === 'agents') {
        const agents = getAgents();
        ws.send(JSON.stringify({ type: 'agents', agents }));
        return;
      }

      if (msg.type === 'chat' || msg.type === 'command') {
        const targetSessionId = (msg.sessionId as string) || sessionId;
        const session = sessions.getOrCreate(targetSessionId);

        // Subscribe to session events for streaming
        const unsubscribe = session.subscribe((event) => {
          if (event.type === 'stream_partial') {
            push({ type: 'stream', text: event.text, sessionId: targetSessionId });
          } else if (event.type === 'stream_ended') {
            push({ type: 'done', text: '', sessionId: targetSessionId });
          } else if (event.type === 'error') {
            push({ type: 'error', message: event.message, sessionId: targetSessionId });
          }
        });

        const inbound: InboundMessage = {
          kind: 'text',
          channelId: 'websocket',
          sessionId: targetSessionId,
          text: String(msg.text ?? ''),
        };

        session.submit(inbound, {
          sendText: async (text) => {
            push({ type: 'stream', text, sessionId: targetSessionId });
          },
        });

        // Unsubscribe on close
        ws.on('close', () => unsubscribe());
        ws.on('error', () => unsubscribe());
      } else if (msg.type === 'approval_response') {
        // Forward to approval gateway via the mu-agents plugin
        const gateway = registry.getPlugin('mu-agents')?.approvalGateway as
          | ApprovalGateway
          | undefined;
        if (!gateway) {
          console.warn('[ws] No approval gateway found');
          return;
        }
        const action = msg.action === 'approve' ? 'approved' : 'denied';
        const token = String(msg.token ?? msg.requestId ?? '');
        if (action === 'approved') {
          gateway.approve(token);
        } else {
          gateway.deny(token);
        }
        // Notify companion of the result
        push({
          type: 'approval_response',
          requestId: msg.requestId ?? msg.token,
          token,
          action,
        });
      }
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // Helper to push events to all clients
  function push(event: Record<string, unknown>) {
    const data = JSON.stringify(event);
    for (const [, client] of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  function pushError(message: string) {
    push({ type: 'error', message });
  }

  // Subscribe to activity bus to push events to companion
  activity.subscribe((event) => {
    push({ type: 'activity', event });
  });

  activity.subscribeSubAgent((event) => {
    push({ type: 'sub_agent_event', event });
  });

  const channel: WsChannel = {
    id: 'websocket',
    start: async () => {
      console.log(`[ws] Listening on port ${options.port}`);
    },
    stop: async () => {
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
