export interface CommandInfo {
  command: string;
  description: string;
}

export interface AgentInfo {
  id: string;
  description: string;
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
