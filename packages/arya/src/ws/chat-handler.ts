/**
 * Inbound `{ type: 'chat' }` handler.
 *
 * Thin wrapper around mu-core's `runHostTurn`. The orchestration
 * (transformUserInput → decorateMessage → drainNext → runTurn) lives in
 * mu-core; this module owns only WS-specific concerns: re-entrance
 * guard, per-session message-bus pinning (until Batch 5 makes the bus
 * session-aware natively), user-message persistence + drawer
 * broadcast, and error enrichment.
 */

import type { WebSocket } from 'ws';
import {
  enrichLLMError,
  errorMessage,
  makeUserMessage,
  type MessageBusRouter,
  type PluginRegistry,
  type ProviderConfig,
  runHostTurn,
  type SessionManager,
  type SessionStore,
} from 'mu-core';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:chat');

export interface ChatHandlerDeps {
  ws: WebSocket;
  defaultSessionId: string;
  sessions: SessionManager;
  store: SessionStore;
  registry: PluginRegistry;
  messageBus: MessageBusRouter;
  providerConfig: ProviderConfig;
  /** Per-connection set of sessions mid-turn — used to reject re-entrance. */
  runningSessions: Set<string>;
  /** Subscribe the connection's stream listener to this session if not already. */
  ensureSubscribed: (sessionId: string) => void;
  push: (event: Record<string, unknown>) => void;
}

/**
 * Handle one `{ type: 'chat' }` message. Returns true when the
 * message was consumed (always true for chat messages).
 */
export function handleChatMessage(
  msg: Record<string, unknown>,
  deps: ChatHandlerDeps,
): boolean {
  if (msg.type !== 'chat') return false;

  const targetSessionId = (msg.sessionId as string) || deps.defaultSessionId;
  const session = deps.sessions.getOrCreate(targetSessionId);

  // Reject re-entrance: the SDK enforces single-flight per turn and a
  // second submit while a turn runs would crash the process.
  if (deps.runningSessions.has(targetSessionId)) {
    deps.ws.send(
      JSON.stringify({
        type: 'error',
        message:
          'A turn is already running for this session. Wait for it to finish or abort it.',
        sessionId: targetSessionId,
      }),
    );
    return true;
  }

  deps.ensureSubscribed(targetSessionId);
  const userText = String(msg.text ?? '');

  // Persist the user turn first. The store auto-creates the session
  // file on first message; the store's own `subscribe(...)` (wired up
  // in `bootstrap.ts`) handles the `sessions:changed` + `sessions:listed`
  // broadcast — we don't push them manually here.
  try {
    deps.store.appendMessage(targetSessionId, makeUserMessage(userText));
  } catch (err) {
    log.error('failed to persist user message:', err);
  }

  deps.runningSessions.add(targetSessionId);
  (async () => {
    try {
      // runHostTurn pins the bus to this session's buffer for the
      // duration of the hook chain (try/finally inside mu-core).
      await runHostTurn({
        session,
        registry: deps.registry,
        messageBus: deps.messageBus,
        userText,
        config: deps.providerConfig,
        model: deps.providerConfig.model,
      });
    } catch (err) {
      const message = enrichLLMError(
        errorMessage(err),
        deps.providerConfig.baseUrl,
      );
      log.error(`session.runTurn error (${targetSessionId}):`, message);
      deps.push({
        type: 'error',
        message,
        sessionId: targetSessionId,
      });
    } finally {
      deps.runningSessions.delete(targetSessionId);
    }
  })();

  return true;
}
