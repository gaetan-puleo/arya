/**
 * Subscribe to a mu-core Session and forward its lifecycle to the WS.
 *
 *  - `stream_partial` → push live `stream` events.
 *  - `stream_ended` → push `done`.
 *  - `error` → enrich and push `error`.
 *
 * Persistence is handled by the runtime's auto-persist (wired via
 * `startMu({ store })`). This subscriber only forwards events to
 * WS clients.
 */

import { enrichLLMError, type PluginRegistry, type SessionManager } from 'mu-core';
import { createLogger } from '../lib/logger.js';
import type { ConnectionState } from './connection-state.js';

const log = createLogger('ws');

export interface StreamSubscriberDeps {
  sessions: SessionManager;
  registry: PluginRegistry;
  state: ConnectionState;
  push: (event: Record<string, unknown>) => void;
  baseUrl: string;
}

export function makeEnsureSubscribed(deps: StreamSubscriberDeps) {
  const { sessions, state, push, baseUrl } = deps;
  return function ensureSubscribed(targetSessionId: string): void {
    if (state.sessionSubs.has(targetSessionId)) return;
    const session = sessions.getOrCreate(targetSessionId);
    const off = session.subscribe((event) => {
      if (event.type === 'stream_partial') {
        push({ type: 'stream', text: event.text, sessionId: targetSessionId });
        return;
      }
      if (event.type === 'stream_ended') {
        push({ type: 'done', text: '', sessionId: targetSessionId });
        return;
      }
      if (event.type === 'error') {
        const detailed = enrichLLMError(event.message, baseUrl);
        log.error(`LLM error (${targetSessionId}): ${detailed}`);
        push({ type: 'error', message: detailed, sessionId: targetSessionId });
      }
    });
    state.sessionSubs.set(targetSessionId, off);
  };
}
