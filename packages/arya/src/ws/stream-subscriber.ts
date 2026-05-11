/**
 * Subscribe to a mu-core Session and forward its lifecycle to the WS.
 *
 *  - `stream_partial` → push live `stream` events (cumulative text).
 *  - `messages_changed` → snapshot the message graph for `stream_ended`.
 *  - `stream_ended` → persist tool invocations + final assistant turn,
 *    then push `done`.
 *  - `error` → enrich and push `error`.
 *
 * The subscription is lazy (created on first chat message for a given
 * session id) and lifetime-tied to the WS connection.
 */

import type { PluginRegistry, SessionManager } from 'mu-core';
import type { SessionStore } from 'mu-core';
import { createLogger } from '../lib/logger.js';
import { enrichLLMError } from 'mu-core';
import { getActiveAgentId } from 'mu-agents';
import { makeAssistantMessage, makeToolMessage } from '../lib/messages.js';
import type { ConnectionState } from './connection-state.js';

const log = createLogger('ws');

export interface StreamSubscriberDeps {
  sessions: SessionManager;
  registry: PluginRegistry;
  store: SessionStore;
  state: ConnectionState;
  push: (event: Record<string, unknown>) => void;
  baseUrl: string;
}

export function makeEnsureSubscribed(deps: StreamSubscriberDeps) {
  const { sessions, registry, store, state, push, baseUrl } = deps;
  return function ensureSubscribed(targetSessionId: string): void {
    if (state.sessionSubs.has(targetSessionId)) return;
    const session = sessions.getOrCreate(targetSessionId);
    const off = session.subscribe((event) => {
      if (event.type === 'stream_partial') {
        state.pendingAssistant.set(targetSessionId, event.text);
        push({ type: 'stream', text: event.text, sessionId: targetSessionId });
        return;
      }
      if (event.type === 'messages_changed') {
        // Snapshot — consumed at stream_ended to persist tool messages.
        state.latestMessages.set(targetSessionId, event.messages);
        return;
      }
      if (event.type === 'stream_ended') {
        // Persist any tool invocations that ran during this turn before
        // the assistant text, so the on-disk transcript order matches
        // what the user saw.
        try {
          const snapshot = state.latestMessages.get(targetSessionId) ?? [];
          const cursor = state.persistedMessageCount.get(targetSessionId) ?? 0;
          const tools = snapshot
            .slice(cursor)
            .filter((m) => m.role === 'tool' && m.toolResult);
          for (const t of tools) {
            store.appendMessage(
              targetSessionId,
              makeToolMessage({
                toolCallId: t.toolCallId,
                toolName: t.toolResult?.name ?? 'tool',
                toolArgs: t.toolCallArgs,
                toolResult: t.toolResult?.content ?? t.content ?? '',
                toolError: t.toolResult?.error === true,
              }),
            );
          }
          state.persistedMessageCount.set(targetSessionId, snapshot.length);
        } catch (err) {
          log.error('failed to persist tool messages:', err);
        }

        // Persist the assistant turn now that the model finished.
        const finalText = state.pendingAssistant.get(targetSessionId) ?? '';
        state.pendingAssistant.delete(targetSessionId);
        if (finalText.trim()) {
          try {
            store.appendMessage(
              targetSessionId,
              makeAssistantMessage(finalText, {
                agentId: getActiveAgentId(registry) ?? undefined,
              }),
            );
          } catch (err) {
            log.error('failed to persist assistant message:', err);
          }
        }
        push({ type: 'done', text: '', sessionId: targetSessionId });
        return;
      }
      if (event.type === 'error') {
        state.pendingAssistant.delete(targetSessionId);
        const detailed = enrichLLMError(event.message, baseUrl);
        log.error(`LLM error (${targetSessionId}): ${detailed}`);
        push({ type: 'error', message: detailed, sessionId: targetSessionId });
      }
    });
    state.sessionSubs.set(targetSessionId, off);
  };
}
