/**
 * Inbound-message dispatcher for the chat screen.
 *
 * Pure function: given one `WsInboundMessage` and the screen-local
 * setters/refs, mutates the transcript state appropriately. Lifted
 * out of `useChat` so the orchestrator stays under ~300 LOC and the
 * `switch` is independently readable / testable.
 *
 * Snapshot-oriented protocol (Batch 3): `sub_agent_run` and
 * `approval_state` events update the store's snapshot Maps, and this
 * dispatcher only inserts placeholder rows into the transcript on
 * first appearance.
 */

import type React from "react";
import type {
	ChatMessageItem,
	PersistedSessionWire,
	WsInboundMessage,
} from "@/lib/ws";
import { chatMessageWireToPersisted, persistedSessionFromWire } from "@/lib/ws";

/** Module-local counter to key synthetic message ids when meta.id is missing. */
let syntheticSeq = 0;

export interface DispatchCtx {
	currentSessionIdRef: React.MutableRefObject<string | null>;
	activeAgentIdRef: React.MutableRefObject<string | null>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessageItem[]>>;
	setLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

function isForCurrentSession(
	msg: WsInboundMessage,
	currentSessionId: string | null,
): boolean {
	const evtSessionId =
		"sessionId" in msg && typeof msg.sessionId === "string"
			? msg.sessionId
			: null;
	return !evtSessionId || evtSessionId === currentSessionId;
}

export function handleSessionMessage(
	msg: WsInboundMessage,
	ctx: DispatchCtx,
): void {
	const { currentSessionIdRef, activeAgentIdRef, setMessages, setLoading } =
		ctx;
	const sid = currentSessionIdRef.current;
	const forCurrent = isForCurrentSession(msg, sid);

	switch (msg.type) {
		case "stream": {
			if (!forCurrent) return;
			setMessages((m) =>
				m.map((x) =>
					x.id === "streaming" ? { ...x, text: msg.text } : x,
				),
			);
			return;
		}
		case "done": {
			if (!forCurrent) return;
			setMessages((m) =>
				m.map((x) =>
					x.id === "streaming"
						? {
							...x,
							text:
								msg.text && String(msg.text).length > 0
									? msg.text
									: x.text,
							id: Date.now().toString(),
						}
						: x,
				),
			);
			setLoading(false);
			return;
		}
		case "approval_state": {
			// Insert a card row on first sighting of a pending approval; for
			// subsequent transitions the store update is enough (the row
			// reads the current snapshot live from the store).
			const snap = msg.snapshot;
			if (snap.status !== "pending") return;
			const id = `approval-${snap.approvalId}`;
			setMessages((m) => {
				if (m.some((x) => x.id === id)) return m;
				return insertBeforeStreaming(m, {
					id,
					role: "assistant",
					text: "",
					authorAgentId:
						snap.agentId ?? activeAgentIdRef.current ?? undefined,
				});
			});
			return;
		}
		case "sessions:history": {
			if (msg.sessionId !== sid) return;
			const wire = msg.session as PersistedSessionWire | null;
			if (!wire) {
				setMessages([]);
				return;
			}
			const session = persistedSessionFromWire(wire);
			setMessages(
				session.messages.map((m) => ({
					id: m.id,
					role: m.role,
					text: m.text,
					authorAgentId: m.agent,
					toolName: m.toolName,
					toolArgs: m.toolArgs,
					toolResult: m.toolResult,
					toolError: m.toolError,
				})),
			);
			return;
		}
		case "sub_agent_run": {
			// Insert a card row on first sighting of a run; subsequent
			// snapshots update the store, and the card reads from there.
			const cardId = `sub-agent-${msg.run.runId}`;
			setMessages((m) => {
				if (m.some((x) => x.id === cardId)) return m;
				return insertBeforeStreaming(m, {
					id: cardId,
					role: "assistant",
					text: "",
					authorAgentId: msg.run.agentId,
				});
			});
			return;
		}
		case "synthetic_message": {
			if (msg.sessionId !== sid) return;
			// Server pre-filters: messages with display.hidden /
			// customType === 'mu-agents.subagent' / role === 'tool' never
			// reach us. Convert + insert verbatim.
			syntheticSeq += 1;
			const row = chatMessageWireToPersisted(msg.message, syntheticSeq);
			setMessages((m) =>
				insertBeforeStreaming(m, {
					id: row.id || `synth-${syntheticSeq}`,
					role: row.role === "tool" ? "assistant" : row.role,
					text: row.text,
					authorAgentId:
						row.agent ?? activeAgentIdRef.current ?? undefined,
				}),
			);
			return;
		}
		case "error": {
			if (!forCurrent) {
				setLoading(false);
				return;
			}
			const errText =
				typeof msg.message === "string" && msg.message.trim()
					? `⚠️ ${msg.message}`
					: "⚠️ The agent failed to respond. Check the server logs.";
			console.error("[ws] server error:", msg.message);
			setMessages((m) => {
				const idx = m.findIndex((x) => x.id === "streaming");
				if (idx === -1) {
					return [
						...m,
						{
							id: `err-${Date.now()}`,
							role: "assistant",
							text: errText,
							authorAgentId: activeAgentIdRef.current ?? undefined,
						},
					];
				}
				const next = [...m];
				next[idx] = {
					...next[idx]!,
					text: errText,
					id: `err-${Date.now()}`,
				};
				return next;
			});
			setLoading(false);
			return;
		}
		default:
			// Variants fully handled inside the store; no-op here.
			return;
	}
}

/**
 * Insert `entry` immediately before the streaming placeholder row, or
 * append when there's no placeholder. Used for approval cards and
 * sub-agent cards so they slot above the "…" assistant bubble.
 */
function insertBeforeStreaming(
	messages: ChatMessageItem[],
	entry: ChatMessageItem,
): ChatMessageItem[] {
	const idx = messages.findIndex((x) => x.id === "streaming");
	if (idx === -1) return [...messages, entry];
	const next = [...messages];
	next.splice(idx, 0, entry);
	return next;
}
