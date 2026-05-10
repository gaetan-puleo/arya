export interface CommandInfo {
  command: string;
  description: string;
}

export interface AgentInfo {
  id: string;
  description: string;
  type?: 'primary' | 'subagent';
  color?: string;
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'tool';
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

export interface ApprovalRequest {
  requestId: string;
  token: string;
  channelId: string;
  toolName: string;
  toolArgs: unknown;
  agentId: string;
  createdAt: number;
}

export type SubAgentEventKind =
  | 'invocation_start'
  | 'text_delta'
  | 'message_end'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'invocation_end';

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

export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  ts: number;
  agentId?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  toolError?: boolean;
}

export interface PersistedSession {
  version: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: PersistedMessage[];
}

export type SessionChangeKind = 'created' | 'updated' | 'deleted' | 'renamed';
