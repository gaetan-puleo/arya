/**
 * Per-WS-connection bookkeeping.
 *
 *  - `runningSessions` — sessions currently mid-turn. Rejects re-entrance.
 *  - `sessionSubs` — lazy session.subscribe handles per session id.
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
