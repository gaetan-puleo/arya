/**
 * Inbound-message dispatcher for the chat screen.
 *
 * Pure function: given one `WsInboundMessage` and the screen-local
 * setters/refs, mutates the transcript state appropriately. Lifted
 * out of `useChat` so the orchestrator stays under ~300 LOC and the
 * `switch` is independently readable / testable.
 */

import type React from "react";
import type {
	ChatMessageItem,
	PersistedSessionWire,
	WsInboundMessage,
} from "@/lib/ws";
import { persistedSessionFromWire } from "@/lib/ws";
import type { ApprovalData, ApprovalStatus } from "@/types/approval";

/**
 * Approval messages share the same requestId across request/response
 * pairs; we suffix with a monotonic counter so a tool emitting many
 * approvals in a row stays uniquely keyed in the React list.
 */
let approvalSeq = 0;

export interface DispatchCtx {
	currentSessionIdRef: React.MutableRefObject<string | null>;
	activeAgentIdRef: React.MutableRefObject<string | null>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessageItem[]>>;
	setApprovals: React.Dispatch<React.SetStateAction<Map<string, ApprovalData>>>;
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
	const {
		currentSessionIdRef,
		activeAgentIdRef,
		setMessages,
		setApprovals,
		setLoading,
	} = ctx;
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
		case "approval_request": {
			approvalSeq += 1;
			const requestId = String(msg.requestId ?? msg.token);
			const msgId = `approval-${requestId}-${approvalSeq}`;
			const data: ApprovalData = {
				msgId,
				requestId,
				token: String(msg.token ?? requestId),
				toolName: String(msg.toolName ?? ""),
				toolArgs: msg.toolArgs
					? JSON.stringify(msg.toolArgs, null, 2)
					: undefined,
				status: "pending",
			};
			setApprovals((prev) => new Map(prev).set(msgId, data));
			setMessages((m) =>
				insertBeforeStreaming(m, {
					id: msgId,
					role: "assistant",
					text: "",
					authorAgentId: activeAgentIdRef.current ?? undefined,
				}),
			);
			return;
		}
		case "approval_response": {
			const status: ApprovalStatus =
				msg.action === "approved" ? "approved" : "denied";
			setApprovals((prev) => {
				const next = new Map(prev);
				for (const [key, entry] of next) {
					if (
						entry.requestId === String(msg.requestId ?? msg.token) &&
						entry.status === "pending"
					) {
						next.set(key, { ...entry, status });
					}
				}
				return next;
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
					authorAgentId: m.agentId,
					toolName: m.toolName,
					toolArgs: m.toolArgs,
					toolResult: m.toolResult,
					toolError: m.toolError,
				})),
			);
			const replayed = new Map<string, ApprovalData>();
			for (const m of session.messages) {
				if (m.role !== "tool") continue;
				replayed.set(m.id, {
					msgId: m.id,
					requestId: m.id,
					token: m.id,
					toolName: m.toolName ?? "tool",
					toolArgs: m.toolArgs,
					status: m.toolError ? "denied" : "approved",
					toolResult: m.toolResult,
				});
			}
			setApprovals(replayed);
			return;
		}
		case "sub_agent_event": {
			// The store already updated the run map. We just react to
			// `invocation_start` here so a placeholder card row slots
			// into the transcript above the streaming "…" bubble.
			const evt = msg.event;
			if (evt.kind !== "invocation_start") return;
			const cardId = `sub-agent-${evt.runId}`;
			setMessages((m) =>
				insertBeforeStreaming(m, {
					id: cardId,
					role: "assistant",
					text: "",
					authorAgentId: evt.agentId,
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
