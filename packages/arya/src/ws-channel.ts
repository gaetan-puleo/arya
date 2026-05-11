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
import type { AgentDefinition, ApprovalGateway, ApprovalRequest, ApprovalChannel } from 'mu-agents';
import type { AryaMessageBusHandle } from './message-bus.js';
import type { SessionStore } from './session-store.js';

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

/** Build the agents list sent to the companion on connect and on request. */
function buildGetAgentsList(
  registry: PluginRegistry,
): () => Array<{ id: string; description: string; type: string; color?: string }> {
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
      color: a.color,
    }));
  };
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

/** Resolve the currently active primary agent's id, or null if none. */
function getActiveAgentId(registry: PluginRegistry): string | null {
  const muAgentsPlugin = (registry as any).getPlugin('mu-agents');
  const active = muAgentsPlugin?.manager?.getActive?.() as AgentDefinition | undefined;
  return active?.name ?? null;
}

/**
 * Subscribe to mu-agents' active-agent changes. The returned unsubscribe
 * is a no-op when the plugin or onChange isn't available.
 */
function subscribeActiveAgent(
  registry: PluginRegistry,
  onChange: (agentId: string | null) => void,
): () => void {
  const muAgentsPlugin = (registry as any).getPlugin('mu-agents');
  const subscribe = muAgentsPlugin?.manager?.onChange;
  if (typeof subscribe !== 'function') return () => {};
  return subscribe.call(muAgentsPlugin.manager, (active: AgentDefinition | undefined) => {
    onChange(active?.name ?? null);
  });
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
 *   { type: "sessions:create", title?: string }
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
  const getAgents = buildGetAgentsList(registry);
  const getCommands = buildGetCommandsList(registry);

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

    // Send commands, agents and the persisted sessions list on connect
    const commands = getCommands();
    const agents = getAgents();
    const activeAgentId = getActiveAgentId(registry);
    ws.send(JSON.stringify({ type: 'commands', commands }));
    ws.send(JSON.stringify({ type: 'agents', agents, activeAgentId }));
    ws.send(JSON.stringify({ type: 'sessions:listed', sessions: store.list() }));

    // Track running turns per session to reject re-entrance gracefully and
    // avoid the SDK's unhandled-rejection crash. Keyed by sessionId.
    const runningSessions = new Set<string>();

    // Subscribe once per WS connection per session id (lazy). Without this,
    // re-subscribing on every chat message would leak listeners and replay
    // each event N times after N messages.
    const sessionSubs = new Map<string, () => void>();
    // Track the latest streamed assistant text per session so we can
    // persist it once the turn finishes. The mu-core stream emits
    // *cumulative* text in `event.text`, so we just keep the last value.
    const pendingAssistant = new Map<string, string>();
    // Latest mu-core message graph snapshot per session. Used at
    // stream_ended to extract any tool invocations that ran during the
    // turn so we can persist them as visible chat history.
    const latestMessages = new Map<string, ChatMessage[]>();
    // High-water mark of how many messages we've already scanned for a
    // session, so successive turns only persist newly-added tools.
    const persistedMessageCount = new Map<string, number>();

    function ensureSubscribed(targetSessionId: string) {
      if (sessionSubs.has(targetSessionId)) return;
      const session = sessions.getOrCreate(targetSessionId);
      const off = session.subscribe((event) => {
        if (event.type === 'stream_partial') {
          pendingAssistant.set(targetSessionId, event.text);
          push({ type: 'stream', text: event.text, sessionId: targetSessionId });
        } else if (event.type === 'messages_changed') {
          // Snapshot — we'll consume it at stream_ended to persist tool messages.
          latestMessages.set(targetSessionId, event.messages);
        } else if (event.type === 'stream_ended') {
          // Persist any tool invocations that ran during this turn before
          // the assistant text, so the on-disk transcript order matches
          // what the user saw.
          try {
            const snapshot = latestMessages.get(targetSessionId) ?? [];
            const cursor = persistedMessageCount.get(targetSessionId) ?? 0;
            const tools = snapshot
              .slice(cursor)
              .filter((m) => m.role === 'tool' && m.toolResult);
            for (const t of tools) {
              const toolName = t.toolResult?.name ?? 'tool';
              const argsObj = t.toolCallArgs;
              const argsStr = argsObj
                ? JSON.stringify(argsObj, null, 2)
                : undefined;
              store.appendMessage(targetSessionId, {
                id: `${Date.now()}-t-${t.toolCallId ?? Math.random().toString(36).slice(2, 8)}`,
                role: 'tool',
                text: '',
                ts: Date.now(),
                toolName,
                toolArgs: argsStr,
                toolResult: t.toolResult?.content ?? t.content ?? '',
                toolError: t.toolResult?.error === true,
              });
            }
            persistedMessageCount.set(targetSessionId, snapshot.length);
          } catch (err) {
            console.error('[ws] failed to persist tool messages:', err);
          }

          // Persist the assistant turn now that the model finished.
          const finalText = pendingAssistant.get(targetSessionId) ?? '';
          pendingAssistant.delete(targetSessionId);
          if (finalText.trim()) {
            try {
              store.appendMessage(targetSessionId, {
                id: `${Date.now()}-a`,
                role: 'assistant',
                text: finalText,
                ts: Date.now(),
                agentId: getActiveAgentId(registry) ?? undefined,
              });
            } catch (err) {
              console.error('[ws] failed to persist assistant message:', err);
            }
          }
          push({ type: 'done', text: '', sessionId: targetSessionId });
        } else if (event.type === 'error') {
          pendingAssistant.delete(targetSessionId);
          // The OpenAI SDK surfaces network failures as a bare
          // "Connection error." — useless without context. Tack the
          // configured baseUrl on so the user immediately sees which
          // endpoint is unreachable.
          const isBareConn = event.message === 'Connection error.';
          const detailed = isBareConn
            ? `Connection error: cannot reach the LLM endpoint at ${options.providerConfig.baseUrl}. Check that the server is running and the URL is reachable.`
            : event.message;
          console.error(`[ws] LLM error (${targetSessionId}): ${detailed}`);
          push({ type: 'error', message: detailed, sessionId: targetSessionId });
        }
      });
      sessionSubs.set(targetSessionId, off);
    }

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
      if (msg.type === 'sessions:list') {
        ws.send(JSON.stringify({ type: 'sessions:listed', sessions: store.list() }));
        return;
      }
      if (msg.type === 'sessions:create') {
        const created = store.create({
          title: typeof msg.title === 'string' ? msg.title : undefined,
        });
        // Push to all clients so other connected companions stay in sync.
        push({ type: 'sessions:changed', sessionId: created.id, kind: 'created' });
        push({ type: 'sessions:listed', sessions: store.list() });
        return;
      }
      if (msg.type === 'sessions:delete') {
        const id = String(msg.sessionId ?? '');
        if (!id) {
          pushError('sessions:delete missing sessionId');
          return;
        }
        const ok = store.delete(id);
        if (ok) {
          push({ type: 'sessions:changed', sessionId: id, kind: 'deleted' });
          push({ type: 'sessions:listed', sessions: store.list() });
        }
        return;
      }
      if (msg.type === 'sessions:rename') {
        const id = String(msg.sessionId ?? '');
        const title = String(msg.title ?? '');
        if (!id) {
          pushError('sessions:rename missing sessionId');
          return;
        }
        const renamed = store.rename(id, title);
        if (renamed) {
          push({ type: 'sessions:changed', sessionId: id, kind: 'renamed' });
          push({ type: 'sessions:listed', sessions: store.list() });
        }
        return;
      }
      if (msg.type === 'sessions:get') {
        const id = String(msg.sessionId ?? '');
        if (!id) {
          pushError('sessions:get missing sessionId');
          return;
        }
        const session = store.get(id);
        ws.send(JSON.stringify({ type: 'sessions:history', sessionId: id, session }));
        return;
      }

      // Companion can request a primary-agent switch.
      if (msg.type === 'set_active_agent') {
        const agentId = typeof msg.agentId === 'string' ? msg.agentId : null;
        const muAgents = (registry as any).getPlugin('mu-agents');
        const manager = muAgents?.manager;
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
          store.appendMessage(targetSessionId, {
            id: `${Date.now()}-u`,
            role: 'user',
            text: userText,
            ts: Date.now(),
          });
          push({ type: 'sessions:changed', sessionId: targetSessionId, kind: 'updated' });
          push({ type: 'sessions:listed', sessions: store.list() });
        } catch (err) {
          console.error('[ws] failed to persist user message:', err);
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
            store.appendMessage(targetSessionId, {
              id: `${Date.now()}-a`,
              role: 'assistant',
              text: errText,
              ts: Date.now(),
            });
          } catch (err) {
            console.error('[ws] failed to persist command error:', err);
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
                store.appendMessage(targetSessionId, {
                  id: `${Date.now()}-a`,
                  role: 'assistant',
                  text: result,
                  ts: Date.now(),
                });
              } catch (err) {
                console.error('[ws] failed to persist command result:', err);
              }
            }
            push({ type: 'done', text: '', sessionId: targetSessionId });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[ws] command "${cmdName}" failed:`, message);
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
          store.appendMessage(targetSessionId, {
            id: `${Date.now()}-u`,
            role: 'user',
            text: userText,
            ts: Date.now(),
          });
          // Notify all clients so the drawer reflects the new
          // updatedAt/title without polling.
          push({ type: 'sessions:changed', sessionId: targetSessionId, kind: 'updated' });
          push({ type: 'sessions:listed', sessions: store.list() });
        } catch (err) {
          console.error('[ws] failed to persist user message:', err);
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
            const raw = err instanceof Error ? err.message : String(err);
            // Same enrichment as in the stream subscriber: a bare
            // "Connection error." from the OpenAI SDK is useless without
            // pointing at the offending endpoint.
            const message =
              raw === 'Connection error.'
                ? `Connection error: cannot reach the LLM endpoint at ${options.providerConfig.baseUrl}. Check that the server is running and the URL is reachable.`
                : raw;
            console.error(`[ws] session.runTurn error (${targetSessionId}):`, message);
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

    const cleanup = () => {
      clients.delete(ws);
      for (const off of sessionSubs.values()) {
        try {
          off();
        } catch {
          // ignore
        }
      }
      sessionSubs.clear();
      runningSessions.clear();
      latestMessages.clear();
      persistedMessageCount.clear();
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
      console.log(`[ws] Listening on port ${options.port}`);
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
