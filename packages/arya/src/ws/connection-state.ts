/**
 * Per-WS-connection bookkeeping.
 *
 * One instance lives in each `wss.on('connection', …)` handler. After
 * persistence moved into mu-core's `attachAutoPersist` middleware (one
 * cursor per session, not per connection), this state shrinks to just
 * what's intrinsically per-WS:
 *
 *  - `runningSessions` — sessions currently mid-turn. Used to reject
 *    re-entrance gracefully (the SDK throws an unhandled rejection
 *    otherwise when two `submit`s race).
 *  - `sessionSubs` — lazy session.subscribe handles. Without this we'd
 *    re-subscribe on every chat message and replay events N times after
 *    N messages.
 *
 * Everything is per-connection; closing the WS clears the lot.
 */

export interface ConnectionState {
  runningSessions: Set<string>;
  sessionSubs: Map<string, () => void>;
}

export function createConnectionState(): ConnectionState {
  return {
    runningSessions: new Set(),
    sessionSubs: new Map(),
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
}
