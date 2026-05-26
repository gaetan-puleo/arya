/**
 * Snapshot reducers for sub-agent runs and approvals.
 *
 * The arya WS server emits primitive lifecycle events; the companion
 * reduces them into render-ready snapshots client-side. Pure
 * functions — no React, no store coupling. The store calls these
 * from its inbound dispatch and stores the result.
 *
 * The sub-agent `detail` shapes match exactly what mu-agents emits
 * in `packages/mu-agents/src/subagent.ts:60-106`:
 *   - `started`     → { task }
 *   - `content`     → raw string delta
 *   - `tool_call`   → { name, arguments }   (NOT `args`)
 *   - `tool_result` → { name, content, error }
 *   - `completed`   → { content }
 *   - `error`       → raw error string
 */

import type {
	ApprovalSnapshot,
	MessageDisplayRow,
	SubAgentRunSnapshot,
} from "@/types/domain";
import type { ApprovalRequestWire, SubAgentEventWire } from "@/types/wire";
import { prettyArgs } from "@/services/formatters";

// ─── Approvals ────────────────────────────────────────────────────────

export function snapshotFromApprovalRequest(
	req: ApprovalRequestWire,
): ApprovalSnapshot {
	return {
		approvalId: req.requestId,
		status: "pending",
		toolName: req.toolName,
		toolArgs: req.args,
		toolArgsPretty: prettyArgs(req.args),
		agentId: req.agentName,
		channelId: req.sessionId,
		createdAt: Date.now(),
	};
}

export function resolveApproval(
	prev: ApprovalSnapshot,
	action: "approve" | "deny",
): ApprovalSnapshot {
	return {
		...prev,
		status: action === "approve" ? "approved" : "denied",
		resolvedAt: Date.now(),
	};
}

// ─── Sub-agent runs ───────────────────────────────────────────────────

function snapshotFromStarted(
	event: SubAgentEventWire,
): SubAgentRunSnapshot {
	const detail = (event.detail as { task?: string } | undefined) ?? {};
	return {
		runId: event.runId,
		agentId: event.agentName,
		task: detail.task ?? "",
		status: "running",
		startTs: Date.now(),
		toolCount: 0,
		timeline: [],
	};
}

function appendTimeline(
	base: SubAgentRunSnapshot,
	row: MessageDisplayRow,
): MessageDisplayRow[] {
	return [...base.timeline, row];
}

export function reduceSubAgentEvent(
	prev: SubAgentRunSnapshot | undefined,
	event: SubAgentEventWire,
): SubAgentRunSnapshot {
	const base = prev ?? snapshotFromStarted(event);
	switch (event.type) {
		case "started":
			return base;

		case "content": {
			// detail is a raw string delta (mu-agents emits the delta directly).
			const delta =
				typeof event.detail === "string" ? event.detail : "";
			if (!delta) return base;
			return {
				...base,
				finalContent: (base.finalContent ?? "") + delta,
				timeline: appendTimeline(base, {
					id: `${base.runId}-content-${base.timeline.length}`,
					role: "assistant",
					text: delta,
					ts: Date.now(),
				}),
			};
		}

		case "tool_call": {
			// detail: { name, arguments } — field is `arguments` (not `args`).
			const detail =
				(event.detail as
					| { name?: string; arguments?: string }
					| undefined) ?? {};
			return {
				...base,
				toolCount: base.toolCount + 1,
				timeline: appendTimeline(base, {
					id: `${base.runId}-toolcall-${base.timeline.length}`,
					role: "tool",
					text: "",
					ts: Date.now(),
					toolName: detail.name,
					toolArgs: detail.arguments,
				}),
			};
		}

		case "tool_result": {
			const detail =
				(event.detail as
					| { name?: string; content?: string; error?: boolean }
					| undefined) ?? {};
			return {
				...base,
				timeline: appendTimeline(base, {
					id: `${base.runId}-toolresult-${base.timeline.length}`,
					role: "tool",
					text: "",
					ts: Date.now(),
					toolName: detail.name,
					toolResult: detail.content,
					toolError: detail.error === true,
				}),
			};
		}

		case "completed": {
			const detail =
				(event.detail as { content?: string } | undefined) ?? {};
			return {
				...base,
				status: "done",
				endTs: Date.now(),
				finalContent: detail.content ?? base.finalContent,
			};
		}

		case "error": {
			// detail is a raw error string.
			const errorMsg =
				typeof event.detail === "string" ? event.detail : undefined;
			return {
				...base,
				status: "error",
				endTs: Date.now(),
				error: errorMsg,
			};
		}

		default: {
			const _exhaustive: never = event.type;
			void _exhaustive;
			return base;
		}
	}
}
