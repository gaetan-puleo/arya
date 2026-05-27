/**
 * Domain types — what the UI consumes after the wire→domain projection.
 *
 * Slimmer than the wire equivalents: tool fields live on their own
 * snapshot types (ApprovalSnapshot / SubAgentRunSnapshot), and the
 * main transcript carries only `user` and `assistant` rows.
 */

export interface AgentInfo {
	/** Canonical id. Server emits this as `name`; the dispatcher
	 *  renames so the rest of the app sees a single field name. */
	id: string;
	description: string;
	type?: "primary";
	color?: string;
}

export interface CommandInfo {
	command: string;
	description: string;
}

export interface SessionSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

/**
 * Visible transcript row. After projection there are no tool rows in
 * the main transcript — tool calls surface inside approval / sub-agent
 * cards via the dedicated snapshot types.
 */
export interface ChatMessageItem {
	id: string;
	role: "user" | "assistant";
	text: string;
	authorAgentId?: string;
}

/**
 * Flat row used by the sub-agent timeline screen. Kept distinct from
 * `ChatMessageItem` because timeline rows need tool-call detail and
 * timestamps that the main transcript doesn't carry.
 */
export interface MessageDisplayRow {
	id: string;
	role: "user" | "assistant" | "tool";
	text: string;
	ts: number;
	toolName?: string;
	toolArgs?: string;
	toolResult?: string;
	toolError?: boolean;
}

export interface ApprovalSnapshot {
	approvalId: string;
	status: "pending" | "approved" | "denied";
	toolName: string;
	toolArgs: unknown;
	toolArgsPretty: string;
	agentId: string;
	channelId: string;
	createdAt: number;
	resolvedAt?: number;
}

export type SubagentStatus = "running" | "done" | "error";

export interface SubAgentRunSnapshot {
	runId: string;
	agentId: string;
	task: string;
	status: SubagentStatus;
	startTs: number;
	endTs?: number;
	/** Tool calls observed in this run. */
	toolCount: number;
	finalContent?: string;
	error?: string;
	timeline: MessageDisplayRow[];
}

/** Sentinel id for the in-flight streaming placeholder row. Never
 *  collides with mu-core's `${role[0]}-${ts}-${rand}` id scheme. */
export const STREAMING_ROW_ID = "__streaming__";
