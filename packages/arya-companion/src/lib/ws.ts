/**
 * Shared wire types exchanged between the companion and the agent's
 * WebSocket server. Pure type definitions — no runtime logic.
 *
 * Snapshot-oriented protocol: the server pushes ready-to-render
 * `sub_agent_run` and `approval_state` snapshots. The companion is a
 * pure renderer — no client-side reducers for these.
 */

import type {
  ApprovalSnapshot,
  SubAgentRunSnapshot,
} from "mu-agents/client";

export interface CommandInfo {
	command: string;
	description: string;
}

export interface AgentInfo {
	id: string;
	description: string;
	type?: "primary" | "subagent";
	color?: string;
}

export interface ChatMessageItem {
	id: string;
	role: "user" | "assistant" | "tool";
	text: string;
	/**
	 * Id of the agent that authored this assistant message. Optional to allow
	 * historical messages without tagging. When the server doesn't tag, the UI
	 * falls back to the active agent at render time.
	 */
	authorAgentId?: string;
	/** Tool invocation name (only when role === 'tool'). */
	toolName?: string;
	/** Pretty-printed JSON (or raw string) of the tool call arguments. */
	toolArgs?: string;
	/** Tool execution result text. */
	toolResult?: string;
	/** True when the tool returned an error. */
	toolError?: boolean;
}

// Re-export snapshot wire types so the companion has them under a
// single import surface.
export type { ApprovalSnapshot, SubAgentRunSnapshot };

// ── Sessions (persistent, server-managed) ─────────────────────────────

export interface SessionSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

export type { PersistedSessionWire } from "./sessionWire";
export {
	chatMessageWireToPersisted,
	persistedSessionFromWire,
} from "./sessionWire";

/**
 * Scheduler lifecycle event mirrored from `mu-scheduler`. The server
 * pushes one per cron tick. The companion currently uses these only
 * to keep the sessions list fresh (the task creates a `task:` prefixed
 * session per run); finer-grained UI is future work.
 */
interface SchedulerEvent {
	kind: "started" | "output" | "completed" | "failed";
	taskId: string;
	sessionId: string;
	at?: number;
	text?: string;
	error?: string;
}

// ── Inbound WS message discriminated union ─────────────────────────────
// Each variant matches a `type` value emitted by the agent server.
// Used by the central store's typed dispatch table — the compiler
// enforces exhaustive handling.

export type WsInboundMessage =
	| { type: "commands"; commands: CommandInfo[] }
	| {
			type: "agents";
			agents: AgentInfo[];
			activeAgentId?: string | null;
	  }
	| { type: "active_agent"; agentId: string | null }
	| { type: "stream"; sessionId?: string; text: string }
	| { type: "done"; sessionId?: string; text?: string }
	| {
			type: "sessions:listed";
			sessions: SessionSummary[];
	  }
	| {
			type: "sessions:history";
			sessionId: string;
			session: import("./sessionWire").PersistedSessionWire | null;
	  }
	/**
	 * Render-ready sub-agent run snapshot. The companion stores it
	 * verbatim and renders directly — no event reduction.
	 */
	| { type: "sub_agent_run"; run: SubAgentRunSnapshot }
	/** Bootstrap listing on connect. */
	| { type: "sub_agent_runs:listed"; runs: SubAgentRunSnapshot[] }
	/**
	 * Render-ready approval snapshot. Carries pending/approved/denied
	 * state plus pre-formatted args.
	 */
	| { type: "approval_state"; snapshot: ApprovalSnapshot }
	/** Bootstrap listing on connect. */
	| { type: "approvals:listed"; approvals: ApprovalSnapshot[] }
	/**
	 * Synthetic message published by mu-agents (via Arya's MessageBus
	 * router) when a hook live-appends a message that the LLM stream
	 * itself didn't produce — typically the `@<subagent>` dispatch
	 * path's user echo. Pre-filtered server-side: messages with
	 * `display.hidden` or `customType === 'mu-agents.subagent'` are
	 * never sent.
	 */
	| {
			type: "synthetic_message";
			sessionId: string;
			message: import("./sessionWire").ChatMessageWire;
	  }
	/**
	 * Scheduler lifecycle event. Forwarded so the companion can keep
	 * the sessions list in sync when an autonomous task runs; no
	 * per-message rendering today.
	 */
	| { type: "scheduler_event"; event: SchedulerEvent }
	| { type: "error"; sessionId?: string; message?: string };
