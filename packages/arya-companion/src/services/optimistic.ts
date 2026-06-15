/**
 * Optimistic state helpers — id generation + transcript row
 * insertion/rollback bookkeeping.
 *
 * All functions are thin wrappers over the Zustand store. Kept here so
 * the orchestrator (aryaClient) and the inbound dispatcher
 * (wireDispatch) share one implementation for "stamp a client-side id"
 * and "drop a row we previously appended".
 */

import { useStore } from "@/state/store";

// Approval row id prefix — must match ChatMessageList.APPROVAL_PREFIX.
export const APPROVAL_ROW_PREFIX = "approval-";
// Sub-agent row id prefix — must match ChatMessageList.SUBAGENT_PREFIX.
export const SUBAGENT_ROW_PREFIX = "sub-agent-";

/**
 * Monotonic counter combined with `Math.random()` for client-side
 * optimistic ids. `Date.now()` alone can collide when two sends land
 * in the same millisecond (rapid taps); FlashList warns about
 * duplicate keys and behaviour around the second row degrades.
 */
let optimisticCounter = 0;

export function nextOptimisticId(kind: "msg" | "cmd"): string {
	optimisticCounter += 1;
	const rand = Math.random().toString(36).slice(2, 8);
	return `local-${kind}-${Date.now()}-${optimisticCounter}-${rand}`;
}

/**
 * Drop a single optimistic row from a session transcript. Used on
 * rollback when the underlying send fails.
 */
export function removeTranscriptRow(sessionId: string, rowId: string): void {
	const store = useStore.getState();
	const rows = store.transcripts.get(sessionId);
	if (!rows) return;
	const next = rows.filter((r) => r.id !== rowId);
	if (next.length !== rows.length) {
		store.replaceTranscript(sessionId, next);
	}
}

/**
 * Client-side session id — lets a chat start instantly without a server
 * round-trip. Shared by the composer, the sessions drawer, and voice call mode.
 */
export function newSessionId(): string {
	return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
