/**
 * Optimistic active-agent state.
 *
 * When the user picks a new primary agent, we flip `activeAgentId` in
 * the store immediately (so the UI feels snappy) and record the
 * previous id here. Three confirmations can arrive:
 *
 *   - `active_agent` from the server  → clear the pending record;
 *     server is authoritative.
 *   - server `error` with no other context → assume the change was
 *     rejected, roll the store back to `previous`.
 *
 * Single mutable record at module scope — there's only ever one
 * pending change in flight (the most recent tap wins).
 */

import { useStore } from "@/state/store";

let pendingActiveAgent:
	| { previous: string | null; sessionId: string | null }
	| null = null;

export function markActiveAgentPending(
	previous: string | null,
	sessionId: string | null,
): void {
	pendingActiveAgent = { previous, sessionId };
}

export function clearPendingActiveAgent(): void {
	pendingActiveAgent = null;
}

/**
 * Roll the store back to the previous activeAgentId if a change is in
 * flight. No-op if nothing is pending.
 */
export function rollbackPendingActiveAgent(): void {
	if (!pendingActiveAgent) return;
	useStore.getState().setActiveAgentId(pendingActiveAgent.previous);
	pendingActiveAgent = null;
}
