/**
 * Inbound dispatch — the single switch that translates a typed
 * `WsInboundMessage` into Zustand store mutations.
 *
 * Pure routing layer: every branch is a thin call into the store or
 * into a sibling helper module (approvals, activeAgent). No transport
 * state, no socket ownership, no outbound senders other than the
 * defensive `requestSessions()` re-fetch on `sessions:changed`.
 */

import { useStore } from "@/state/store";
import { wireSessionToRows } from "@/services/projectMessage";
import { reduceSubAgentEvent } from "@/services/snapshotReducers";
import { requestSessions } from "@/services/outbound";
import { handleApprovalRequest } from "@/services/approvals";
import {
	clearPendingActiveAgent,
	rollbackPendingActiveAgent,
} from "@/services/activeAgent";
import { SUBAGENT_ROW_PREFIX } from "@/services/optimistic";
import { resolveTranscription, rejectTranscription } from "@/services/voiceTranscribe";
import type { WsInboundMessage } from "@/types/wire";

export function dispatch(msg: WsInboundMessage): void {
	const store = useStore.getState();

	switch (msg.type) {
		case "commands":
			store.setCommands(msg.commands);
			return;

		case "agents":
			store.setAgents(
				msg.agents.map((a) => ({
					id: a.name,
					description: a.description,
					color: a.color,
					type: "primary",
				})),
				msg.activeAgentId,
			);
			return;

		case "capabilities":
			store.setCapabilities({ vision: msg.vision, audio: msg.audio });
			return;

		case "model_loading":
			store.setLoadingModel(msg.loading ? msg.model : null);
			return;

		case "active_agent": {
			// Server confirmed (or independently flipped) the active
			// agent. If we had an optimistic change pending and the
			// server's new value disagrees, clear our pending record —
			// the server is the source of truth.
			clearPendingActiveAgent();
			store.setActiveAgentId(msg.agentId);
			return;
		}

		case "sessions:listed":
			// Hide internal sessions (e.g. the `__arya_stt__` voice-transcription
			// scratch session) from the drawer — they're machinery, not conversations.
			store.setSessions(msg.sessions.filter((s) => !s.id.startsWith("__arya")));
			return;

		case "sessions:changed":
			requestSessions();
			return;

		case "sessions:history": {
			const sid = msg.sessionId;
			const wire = msg.session;
			const rows = wire
				? wireSessionToRows(wire.messages, store.activeAgentId)
				: [];
			store.replaceTranscript(sid, rows);
			return;
		}

		case "stream": {
			const sid = msg.sessionId;
			if (!sid) return;
			// `stream.text` is an incremental delta — accumulate it into the placeholder.
			store.appendStreamingPlaceholder(sid, msg.text);
			return;
		}

		case "reasoning":
			// Not surfaced in the UI today; logged for visibility.
			return;

		case "turn_start":
			return;

		case "turn_end": {
			const sid = msg.sessionId;
			if (!sid) return;
			store.clearStreamingPlaceholder(sid);
			return;
		}

		case "message": {
			const sid = msg.sessionId;
			if (!sid) return;
			const rows = wireSessionToRows([msg.message], store.activeAgentId);
			const existing = store.transcripts.get(sid) ?? [];
			for (const row of rows) {
				// `turn_start` re-broadcasts the user's own message; we already added it
				// optimistically (a `local-…` row) in sendChat, so drop the echo to
				// avoid a duplicate bubble.
				if (
					row.role === "user" &&
					existing.some(
						(r) => r.role === "user" && r.text === row.text && r.id.startsWith("local-"),
					)
				) {
					continue;
				}
				store.appendTranscriptRow(sid, row);
			}
			// Assistant message landed → drop the streaming placeholder.
			if (rows.length > 0) store.clearStreamingPlaceholder(sid);
			return;
		}

		case "sub_agent_event": {
			const event = msg.event;
			const prev = store.subAgentRuns.get(event.runId);
			const next = reduceSubAgentEvent(prev, event);
			store.upsertSubAgentRun(next);

			// Mirror the run as a transcript row so ChatMessageList can
			// render it inline (recognises the `sub-agent-` prefix and
			// renders a SubAgentCard). Only do this once per runId —
			// subsequent events update the snapshot Map, which the card
			// reads by id.
			if (!prev) {
				const sid = event.parentSessionId;
				if (sid) {
					store.appendTranscriptRow(sid, {
						id: `${SUBAGENT_ROW_PREFIX}${event.runId}`,
						role: "assistant",
						text: "",
						authorAgentId: event.agentName,
					});
				}
			}
			return;
		}

		case "approval_request": {
			handleApprovalRequest(msg);
			return;
		}

		case "scheduler_event":
			// Server's next `sessions:listed` keeps the drawer fresh.
			return;

		case "voice:result":
			resolveTranscription(msg.requestId, msg.text);
			return;

		case "voice:error":
			rejectTranscription(msg.requestId, msg.message);
			return;

		case "voice:availability":
			// Only relevant to an explicit voice:check; nothing to do for transcription.
			return;

		case "error": {
			const sid = msg.sessionId;
			if (sid) store.clearStreamingPlaceholder(sid);
			// Roll back any pending optimistic active-agent change — a
			// server `error` that arrives after `set_active_agent` is
			// our best signal that the change was rejected. (The server
			// doesn't expose a dedicated rejection type today.)
			rollbackPendingActiveAgent();
			console.error(
				`[ws] server error${sid ? ` (${sid})` : ""}: ${msg.message ?? "(no message)"}`,
			);
			return;
		}

		default: {
			const _exhaustive: never = msg;
			void _exhaustive;
		}
	}
}
