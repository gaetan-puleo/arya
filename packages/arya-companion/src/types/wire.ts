/**
 * Wire types — exactly what the arya WebSocket server emits/accepts.
 *
 * Pure type definitions. No runtime, no defaulting, no defensive
 * coercion. The single validation gate (services/projectMessage.ts)
 * narrows unknown JSON into these shapes; downstream code trusts them.
 */

export type WireRole = "user" | "assistant" | "system" | "tool";

/** A non-text content part (image/audio) carried over the wire as base64. Mirrors mu-harness's WireAttachment. */
export interface WireAttachment {
	kind: "image" | "audio";
	mime: string;
	data: string;
}

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
	attachments?: WireAttachment[];
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

/**
 * Sub-agent lifecycle event emitted by mu-agents' SubAgentBus.
 *
 * Discriminated by `type`; the `detail` payload's shape varies per variant.
 * Reducers can switch on `type` and the compiler will narrow `detail` for
 * them — no per-case `as` casts needed.
 */
export interface SubAgentToolCallDetail {
	name?: string;
	/** Stringified args — field name `arguments`, NOT `args`. */
	arguments?: string;
}

export interface SubAgentToolResultDetail {
	name?: string;
	content?: string;
	error?: boolean;
}

export type SubAgentEventWire =
	| {
			runId: string;
			parentSessionId: string;
			agentName: string;
			type: "started";
			detail?: { task?: string };
	  }
	| {
			runId: string;
			parentSessionId: string;
			agentName: string;
			type: "content";
			detail?: string;
	  }
	| {
			runId: string;
			parentSessionId: string;
			agentName: string;
			type: "tool_call";
			detail?: SubAgentToolCallDetail;
	  }
	| {
			runId: string;
			parentSessionId: string;
			agentName: string;
			type: "tool_result";
			detail?: SubAgentToolResultDetail;
	  }
	| {
			runId: string;
			parentSessionId: string;
			agentName: string;
			type: "completed";
			detail?: { content?: string };
	  }
	| {
			runId: string;
			parentSessionId: string;
			agentName: string;
			type: "error";
			detail?: string;
	  };

/**
 * Permission rule shape emitted with `approval_request`. Mirrors
 * `arya/src/protocol.ts:WireRule`, which mirrors mu-harness's
 * `PermissionRule`. The server stamps it verbatim from the runtime; the
 * companion only reads it to display the matched policy.
 */
export interface WireRule {
	tool: string;
	argsPattern?: string;
	decision: "allow" | "deny" | "ask";
}

/**
 * Approval prompt emitted by the server's `ApprovalQueue`.
 *
 * NOTE: matches the actual server emission (`arya/src/protocol.ts:
 * WireApprovalRequest`):
 *   - `args` is a STRING (the LLM's raw stringified tool arguments).
 *   - `matchedRule` is a `WireRule | undefined` (object, not string).
 *   - `agentName` is NOT emitted by the current server; older builds may.
 *   - `sessionId` may be null (no session pinned at issue time).
 */
export interface ApprovalRequestWire {
	requestId: string;
	sessionId: string | null;
	/** Server doesn't always include this — keep optional for older builds. */
	agentName?: string;
	toolName: string;
	args: string;
	matchedRule: WireRule | undefined;
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

/**
 * Scheduler event mirrors mu-harness's `SchedulerEvent` union (verbatim,
 * forwarded by the server inside `scheduler_event` frames). The companion
 * unwraps `frame.event` and pattern-matches on `type`.
 */
export type SchedulerEvent =
	| { type: "task_started"; task: SchedulerTask; at: number }
	| {
			type: "task_completed";
			task: SchedulerTask;
			at: number;
			durationMs: number;
	  }
	| {
			type: "task_failed";
			task: SchedulerTask;
			at: number;
			error: string;
	  };

export interface SchedulerTask {
	id: string;
	cron: string;
	prompt: string;
	timezone?: string;
	channel?: string;
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
	| { type: "capabilities"; vision: boolean; audio: boolean }
	| { type: "model_loading"; model: string; loading: boolean }
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
	// Session-less voice transcription (request/response, correlated by requestId).
	| { type: "voice:result"; requestId: string; text: string }
	| { type: "voice:error"; requestId: string; message: string }
	| { type: "voice:availability"; requestId: string; reason?: string }
	| { type: "error"; sessionId?: string; message?: string };

/**
 * Discriminator values for every inbound frame. Used by `isWsInboundMessage`
 * to filter out everything that isn't a recognised server message before any
 * downstream code reads its fields. Keeping it next to the union makes the
 * "new variant? add it here too" requirement obvious.
 */
const INBOUND_TYPES = new Set<WsInboundMessage["type"]>([
	"commands",
	"agents",
	"active_agent",
	"stream",
	"reasoning",
	"capabilities",
	"model_loading",
	"turn_start",
	"turn_end",
	"message",
	"sessions:listed",
	"sessions:changed",
	"sessions:history",
	"sub_agent_event",
	"approval_request",
	"scheduler_event",
	"voice:result",
	"voice:error",
	"voice:availability",
	"error",
]);

/**
 * Top-level guard: the value is a plain object whose `type` is one of the
 * recognised inbound discriminators. Field-level validation lives in the
 * downstream dispatch path (`projectMessage`, `snapshotReducers`) so this
 * guard stays cheap on every WS frame.
 */
export function isWsInboundMessage(value: unknown): value is WsInboundMessage {
	if (!value || typeof value !== "object") return false;
	const v = value as { type?: unknown };
	return typeof v.type === "string" && INBOUND_TYPES.has(v.type as WsInboundMessage["type"]);
}

/**
 * Outbound message types the companion sends. Kept narrow on purpose —
 * each variant matches a handler in arya's WS dispatch.
 */
export type WsOutboundMessage =
	| { type: "commands" }
	| { type: "agents" }
	| { type: "chat"; sessionId: string; text: string; attachments?: WireAttachment[] }
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
	| { type: "voice:transcribe"; requestId: string; mime: string; data: string }
	| {
			type: "approval_response";
			requestId: string;
			action: "approve" | "deny";
	  };
