/**
 * Approval-snapshot lifecycle.
 *
 *   issue  — `handleApprovalRequest` on an inbound `approval_request`
 *            creates the snapshot, appends a transcript row that
 *            ChatMessageList renders as an ApprovalCard, and remembers
 *            the request id so server retries can't reset a resolved
 *            approval back to `pending`.
 *
 *   respond — `respondApproval` validates the snapshot is still
 *             pending, fires `approval_response` on the wire, and
 *             marks the local snapshot resolved.
 *
 * `seenApprovalIds` is the single-use token guard — once an id is in
 * the set, duplicate inbound requests for it are dropped.
 */

import { useStore } from "@/state/store";
import { send } from "@/services/outbound";
import { APPROVAL_ROW_PREFIX } from "@/services/optimistic";
import {
	resolveApproval,
	snapshotFromApprovalRequest,
} from "@/services/snapshotReducers";
import type { ApprovalRequestWire } from "@/types/wire";

// Tracks approval ids whose tokens have been consumed (either resolved
// or already known to the UI). Duplicate `approval_request` payloads
// for an id already in this set are dropped — server retries can't
// reset a resolved approval back to pending.
const seenApprovalIds = new Set<string>();

/**
 * Handle an inbound `approval_request`. Idempotent — duplicate ids are
 * silently dropped. The wire shape is `ApprovalRequestWire` flattened
 * with `type: "approval_request"`; we accept either.
 */
export function handleApprovalRequest(msg: ApprovalRequestWire): void {
	if (seenApprovalIds.has(msg.requestId)) return;
	seenApprovalIds.add(msg.requestId);

	const store = useStore.getState();
	store.upsertApproval(snapshotFromApprovalRequest(msg));
	// Append a transcript row so ChatMessageList renders an
	// ApprovalCard inline (recognises the `approval-` prefix).
	// `sessionId` may be null when the approval was raised outside any
	// session — in that case there's no transcript to surface it in, so
	// the snapshot is the only client-side trace.
	const sid = msg.sessionId;
	if (sid) {
		store.appendTranscriptRow(sid, {
			id: `${APPROVAL_ROW_PREFIX}${msg.requestId}`,
			role: "assistant",
			text: "",
			authorAgentId: msg.agentName,
		});
	}
}

/**
 * Send an approval response. Validates the snapshot is still pending
 * (defends against re-tap on a duplicate approval row), fires the
 * wire message, then marks the snapshot resolved. If the send fails
 * the snapshot stays `pending` so the UI keeps offering the buttons.
 */
export function respondApproval(
	approvalId: string,
	action: "approve" | "deny",
): void {
	const store = useStore.getState();
	const snap = store.approvals.get(approvalId);
	if (!snap || snap.status !== "pending") {
		console.warn(
			`[ws] respondApproval ignored — ${approvalId} is not pending`,
		);
		return;
	}
	const ok = send({
		type: "approval_response",
		requestId: approvalId,
		action,
	});
	if (!ok) {
		// Fail-fast with a clear log; the snapshot stays `pending` so the
		// UI still offers the buttons. Surfacing a richer error in the
		// store would require a new slice — keep the change minimal here.
		console.error(
			`[ws] approval_response dropped (not connected): ${approvalId}`,
		);
		return;
	}
	store.upsertApproval(resolveApproval(snap, action));
}
