/**
 * Shared wire types exchanged between the companion and the agent's
 * WebSocket server. Pure type definitions — no runtime logic.
 *
 * Session history conversion lives in `./sessionWire.ts`.
 */

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

export type SubAgentEventKind =
	| "invocation_start"
	| "text_delta"
	| "message_end"
	| "tool_call_start"
	| "tool_call_end"
	| "invocation_end";

export interface SubAgentEvent {
	runId: string;
	parentRunId?: string;
	agentId: string;
	kind: SubAgentEventKind;
	ts: number;
	data: Record<string, unknown>;
}

// ── Sessions (persistent, server-managed) ─────────────────────────────

export interface SessionSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

export type { PersistedSessionWire } from "./sessionWire";
export { persistedSessionFromWire } from "./sessionWire";

// ── Inbound WS message discriminated union ─────────────────────────────
// Each variant matches a `type` value emitted by the agent server.
// Used by the central store's typed dispatch table — the compiler
// enforces exhaustive handling, replacing the previous "if (...) return"
// chain with a `switch` over `msg.type`.

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
			type: "approval_request";
			sessionId?: string;
			requestId?: string | number;
			token?: string | number;
			toolName?: string;
			toolArgs?: unknown;
	  }
	| {
			type: "approval_response";
			sessionId?: string;
			requestId?: string | number;
			token?: string | number;
			action: "approved" | "denied";
	  }
	| {
			type: "sessions:listed";
			sessions: SessionSummary[];
	  }
	| {
			type: "sessions:history";
			sessionId: string;
			session: import("./sessionWire").PersistedSessionWire | null;
	  }
	| { type: "sub_agent_event"; event: SubAgentEvent }
	| { type: "error"; sessionId?: string; message?: string };
