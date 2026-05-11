import { WebSocket, WebSocketServer } from 'ws';
import {
  runDecorateMessageHooks,
  runTransformUserInputHooks,
  type ActivityBus,
  type ChatMessage,
  type Channel,
  type PluginRegistry,
  type ProviderConfig,
  type SessionManager,
  type SlashCommand,
} from 'mu-core';
import type { AryaMessageBusHandle } from './message-bus.js';
import type { SessionStore } from 'mu-core';
import { createLogger } from './lib/logger.js';
import {
  makeAssistantMessage,
  makeUserMessage,
} from './lib/messages.js';
import { enrichLLMError, errorMessage } from 'mu-core';
import {
  type AgentListItem,
  getActiveAgentId,
  getMuAgents,
  listAgents,
  subscribeActiveAgent,
} from 'mu-agents';
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
  messageBus: AryaMessageBusHandle;
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

/** Look up a registered command by its short name (no leading slash). */
function findCommand(registry: PluginRegistry, name: string): SlashCommand | undefined {
  return (registry.getCommands() ?? []).find((c) => c.name === name);
}

/**
 * WebSocket channel — implements the `Channel` interface from mu-core.
 *
 * Companion → Server:
 *   { type: "chat", text: "...", sessionId?: string }
 *   { type: "command", text: "/help", sessionId?: string }
 *   { type: "approval_response", requestId: "...", token: "...", action: "approve"|"deny" }
 *   { type: "set_active_agent", agentId: "arya" }
 *   { type: "sessions:list" }
 *   { type: "sessions:create", sessionId?: string, title?: string }
 *   { type: "sessions:delete", sessionId: string }
 *   { type: "sessions:rename", sessionId: string, title: string }
 *   { type: "sessions:get", sessionId: string }
 *
 * Server → Companion:
 *   { type: "stream", text: "...", sessionId?: string }
 *   { type: "done", text: "...", sessionId?: string }
 *   { type: "approval_request", requestId, token, toolName, toolArgs, agentId, channelId }
 *   { type: "approval_response", requestId, token, action }
 *   { type: "activity", event: ActivityEvent }
 *   { type: "sub_agent_event", event: SubAgentEvent }
 *   { type: "commands", commands: [...] }
 *   { type: "agents", agents: [...], activeAgentId: "arya" | null }
 *   { type: "active_agent", agentId: "arya" | null }
 *   { type: "sessions:listed", sessions: [...] }
 *   { type: "sessions:history", sessionId, session: {..., messages: [...]} | null }
 *   { type: "sessions:changed", sessionId, kind: "created"|"updated"|"deleted"|"renamed" }
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
  const approvalChannel = createApprovalChannel((event) => push(event));

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

    // Per-connection bookkeeping (running turns, lazy subscriptions,
    // stream-state caches). See `connection-state.ts` for field docs.
    const connState = createConnectionState();
    const { runningSessions } = connState;

    const ensureSubscribed = makeEnsureSubscribed({
      sessions,
      registry,
      store,
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

      if (msg.type === 'command') {
        // Slash commands are intercepted by the host. We don't feed the
        // raw `/foo` text to the LLM — instead we look up the command
        // and run its `execute(args, ctx)`. The user-facing message and
        // the command output (if any) are persisted as normal turns so
        // history reads correctly.
        const targetSessionId = (msg.sessionId as string) || sessionId;
        const userText = String(msg.text ?? '').trim();

        // Persist the user input first (mirrors chat semantics, keeps
        // `/help` visible in history).
        try {
          store.appendMessage(targetSessionId, makeUserMessage(userText));
          push({ type: 'sessions:changed', sessionId: targetSessionId, kind: 'updated' });
          push({ type: 'sessions:listed', sessions: store.list() });
        } catch (err) {
          log.error('failed to persist user message:', err);
        }

        const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(userText);
        if (!match) {
          push({
            type: 'error',
            message: `Invalid command: "${userText}"`,
            sessionId: targetSessionId,
          });
          return;
        }
        const [, cmdName, cmdArgs = ''] = match;
        const cmd = findCommand(registry, cmdName);
        if (!cmd) {
          const errText = `Unknown command: /${cmdName}. Type /help for a list.`;
          push({ type: 'stream', text: errText, sessionId: targetSessionId });
          push({ type: 'done', text: '', sessionId: targetSessionId });
          try {
            store.appendMessage(targetSessionId, makeAssistantMessage(errText));
          } catch (err) {
            log.error('failed to persist command error:', err);
          }
          return;
        }

        // Run async without blocking the WS message loop.
        (async () => {
          try {
            const result = await cmd.execute(cmdArgs, {
              messages: [],
              cwd: process.cwd(),
              config: options.providerConfig,
            });
            // Any command may have mutated agent state (e.g. /<agent>
            // switches active). Re-broadcast both lists so the UI catches
            // dynamically added commands and reflects the new active agent.
            push({ type: 'commands', commands: getCommands() });
            push({
              type: 'agents',
              agents: getAgents(),
              activeAgentId: getActiveAgentId(registry),
            });

            if (result && result.trim()) {
              push({ type: 'stream', text: result, sessionId: targetSessionId });
              try {
                store.appendMessage(targetSessionId, makeAssistantMessage(result));
              } catch (err) {
                log.error('failed to persist command result:', err);
              }
            }
            push({ type: 'done', text: '', sessionId: targetSessionId });
          } catch (err) {
            const message = errorMessage(err);
            log.error(`command "${cmdName}" failed:`, message);
            push({ type: 'error', message, sessionId: targetSessionId });
          }
        })();
        return;
      }

      if (msg.type === 'chat') {
        const targetSessionId = (msg.sessionId as string) || sessionId;
        const session = sessions.getOrCreate(targetSessionId);

        // Reject re-entrance gracefully. The session SDK enforces single-flight
        // per turn; firing another submit while a turn runs throws and would
        // crash the process via unhandled rejection.
        if (runningSessions.has(targetSessionId)) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message:
                'A turn is already running for this session. Wait for it to finish or abort it.',
              sessionId: targetSessionId,
            }),
          );
          return;
        }

        ensureSubscribed(targetSessionId);

        const userText = String(msg.text ?? '');

        // Persist the user turn first. appendMessage auto-creates the
        // session file if this is the first message.
        try {
          store.appendMessage(targetSessionId, makeUserMessage(userText));
          // Notify all clients so the drawer reflects the new
          // updatedAt/title without polling.
          push({ type: 'sessions:changed', sessionId: targetSessionId, kind: 'updated' });
          push({ type: 'sessions:listed', sessions: store.list() });
        } catch (err) {
          log.error('failed to persist user message:', err);
        }

        runningSessions.add(targetSessionId);
        // Off-thread the full chat pipeline. We can't use session.submit
        // because that skips the host-side hook composition; we need to
        // run `transformUserInput` (where mu-agents' @-mention dispatch
        // lives) ourselves, then call session.runTurn directly.
        (async () => {
          try {
            // Pin the session for the bus router so mu-agents' synchronous
            // bus.append / bus.injectNext calls route to the right buffer.
            options.messageBus.setCurrentSession(targetSessionId);

            const hooks = registry.getHooks();
            const transform = await runTransformUserInputHooks(hooks, userText);

            if (transform.kind === 'intercept') {
              // Plugin claimed the input fully — no turn to run.
              options.messageBus.setCurrentSession(null);
              push({ type: 'done', text: '', sessionId: targetSessionId });
              return;
            }

            // `continue` means the hook handled the user message itself
            // (mu-agents' @-mention path live-appends + injects relay).
            // `transform` rewrites the user text; `pass` leaves it.
            const isContinue = transform.kind === 'continue';
            const finalText =
              transform.kind === 'transform' ? transform.text : userText;

            const userMsg: ChatMessage | undefined = isContinue
              ? undefined
              : await runDecorateMessageHooks(hooks, {
                  role: 'user',
                  content: finalText,
                });

            // Drain anything the hooks queued via bus.injectNext for the
            // upcoming turn (e.g. mu-agents' hidden relay prompt).
            for (const inj of options.messageBus.drainFor(targetSessionId)) {
              session.queueForNextTurn(inj);
            }

            await session.runTurn({
              userMessage: userMsg,
              config: options.providerConfig,
              model: options.providerConfig.model,
              registry,
            });
          } catch (err) {
            const message = enrichLLMError(errorMessage(err), options.providerConfig.baseUrl);
            log.error(`session.runTurn error (${targetSessionId}):`, message);
            push({
              type: 'error',
              message,
              sessionId: targetSessionId,
            });
          } finally {
            options.messageBus.setCurrentSession(null);
            runningSessions.delete(targetSessionId);
          }
        })();
      } else if (handleApprovalResponse(msg, { push, registry })) {
        return;
      }
    });

    const cleanup = () => {
      clients.delete(ws);
      tearDownConnectionState(connState);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
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
