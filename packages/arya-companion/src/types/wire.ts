/**
 * Wire types — exactly what the arya WebSocket server emits/accepts.
 *
 * Pure type definitions. No runtime, no defaulting, no defensive
 * coercion. The single validation gate (services/projectMessage.ts)
 * narrows unknown JSON into these shapes; downstream code trusts them.
 */

export type WireRole = "user" | "assistant" | "system" | "tool";

export interface WireToolCall {
	id: string;
	function: { name: string; arguments: string };
}

export interface WireToolResultInfo {
	name: string;
	content: string;
	error?: boolean;
}

export interface WireMessageMeta {
	source?: string;
	visibility?: "ui" | "llm" | "both";
	transient?: boolean;
}

/**
 * Mirrors mu-core's `Message`. Every field the server stamps is
 * present; optionals reflect what mu-core leaves off for non-tool /
 * non-reasoning messages.
 */
export interface WireMessage {
	id: string;
	ts: number;
	role: WireRole;
	content: string;
	reasoning?: string;
	channelId?: string;
	toolCalls?: WireToolCall[];
	toolCallId?: string;
	toolResult?: WireToolResultInfo;
	meta?: WireMessageMeta;
}

export interface PersistedSessionWire {
	version?: 1;
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: WireMessage[];
}

export interface SessionSummaryWire {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

export type SessionChangeKind = "created" | "updated" | "deleted" | "renamed";

/** Sub-agent lifecycle event emitted by mu-agents' SubAgentBus. */
export interface SubAgentEventWire {
	runId: string;
	parentSessionId: string;
	agentName: string;
	type:
		| "started"
		| "content"
		| "tool_call"
		| "tool_result"
		| "completed"
		| "error";
	detail?: unknown;
}

/** Approval prompt emitted by mu-agents' ApprovalGateway. */
export interface ApprovalRequestWire {
	requestId: string;
	sessionId: string;
	agentName: string;
	toolName: string;
	args: Record<string, unknown>;
	matchedRule: string;
}

export interface AgentWire {
	name: string;
	description: string;
	color?: string;
}

export interface CommandWire {
	command: string;
	description: string;
}

export interface SchedulerEvent {
	kind: "started" | "output" | "completed" | "failed";
	taskId: string;
	sessionId: string;
	at?: number;
	text?: string;
	error?: string;
}

/**
 * Discriminated union over `type`. The single source of truth for what
 * arrives over the WebSocket from arya's server (`packages/arya/src/ws.ts`).
 */
export type WsInboundMessage =
	| { type: "commands"; commands: CommandWire[] }
	| {
			type: "agents";
			agents: AgentWire[];
			activeAgentId?: string | null;
	  }
	| {
			type: "active_agent";
			agentId: string | null;
			sessionId?: string;
			from?: string | null;
			reason?: string;
	  }
	| { type: "stream"; sessionId?: string; text: string }
	| { type: "reasoning"; sessionId?: string; text: string }
	| { type: "turn_start"; sessionId?: string }
	| {
			type: "turn_end";
			sessionId?: string;
			reason?: "complete" | "aborted" | "error";
	  }
	| { type: "message"; sessionId?: string; message: WireMessage }
	| { type: "sessions:listed"; sessions: SessionSummaryWire[] }
	| {
			type: "sessions:changed";
			sessionId: string;
			kind: SessionChangeKind;
	  }
	| {
			type: "sessions:history";
			sessionId: string;
			session: PersistedSessionWire | null;
	  }
	| { type: "sub_agent_event"; event: SubAgentEventWire }
	| ({ type: "approval_request" } & ApprovalRequestWire)
	| { type: "scheduler_event"; event: SchedulerEvent }
	| { type: "error"; sessionId?: string; message?: string };

/**
 * Outbound message types the companion sends. Kept narrow on purpose —
 * each variant matches a handler in arya's WS dispatch.
 */
export type WsOutboundMessage =
	| { type: "commands" }
	| { type: "agents" }
	| { type: "chat"; sessionId: string; text: string }
	| { type: "command"; sessionId: string; text: string }
	| {
			type: "set_active_agent";
			agentId: string;
			sessionId?: string;
	  }
	| { type: "sessions:list" }
	| { type: "sessions:create"; sessionId: string; title?: string }
	| { type: "sessions:delete"; sessionId: string }
	| { type: "sessions:rename"; sessionId: string; title: string }
	| { type: "sessions:get"; sessionId: string }
	| {
			type: "approval_response";
			requestId: string;
			action: "approve" | "deny";
	  };
