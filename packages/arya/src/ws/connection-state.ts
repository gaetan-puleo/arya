/**
 * Per-WS-connection bookkeeping.
 *
 * One instance lives in each `wss.on('connection', …)` handler:
 *
 *  - `runningSessions` — sessions currently mid-turn. Used to reject
 *    re-entrance gracefully (the SDK throws an unhandled rejection
 *    otherwise when two `submit`s race).
 *  - `sessionSubs` — lazy session.subscribe handles. Without this, we
 *    would re-subscribe on every chat message and replay events N times
 *    after N messages.
 *  - `pendingAssistant` — last cumulative streamed text per session,
 *    needed to persist the final assistant turn at `stream_ended`.
 *  - `latestMessages` — last snapshot of the mu-core message graph per
 *    session. Consumed at `stream_ended` to extract tool invocations.
 *  - `persistedMessageCount` — high-water mark so successive turns only
 *    persist newly-added tools.
 *
 * Everything is per-connection; closing the WS clears the lot.
 */

import type { ChatMessage } from 'mu-core';

export interface ConnectionState {
  runningSessions: Set<string>;
  sessionSubs: Map<string, () => void>;
  pendingAssistant: Map<string, string>;
  latestMessages: Map<string, ChatMessage[]>;
  persistedMessageCount: Map<string, number>;
}

export function createConnectionState(): ConnectionState {
  return {
    runningSessions: new Set(),
    sessionSubs: new Map(),
    pendingAssistant: new Map(),
    latestMessages: new Map(),
    persistedMessageCount: new Map(),
  };
}

/** Best-effort cleanup. Safe to call multiple times. */
export function tearDownConnectionState(state: ConnectionState): void {
  for (const off of state.sessionSubs.values()) {
    try {
      off();
    } catch {
      /* listener teardown errors must not break cleanup */
    }
  }
  state.sessionSubs.clear();
  state.runningSessions.clear();
  state.latestMessages.clear();
  state.persistedMessageCount.clear();
  state.pendingAssistant.clear();
}
