import type { PersistedSessionWire, SessionSummaryWire } from './runtime';
import type { WireMessage } from './wire';
import type { PendingApproval } from 'mu-harness';

export type ApprovalAction = 'approve' | 'approve_always' | 'deny';

export type WsInbound =
  | { type: 'chat'; sessionId?: string; text: string }
  | { type: 'command'; sessionId?: string; text: string }
  | { type: 'commands' }
  | { type: 'agents' }
  | { type: 'approval_response'; requestId: string; action: ApprovalAction }
  | { type: 'set_active_agent'; agentId: string; sessionId?: string }
  | { type: 'sessions:list' }
  | { type: 'sessions:create'; sessionId?: string; title?: string }
  | { type: 'sessions:delete'; sessionId: string }
  | { type: 'sessions:rename'; sessionId: string; title: string }
  | { type: 'sessions:get'; sessionId: string };

const APPROVAL_ACTIONS = new Set<ApprovalAction>(['approve', 'approve_always', 'deny']);

const optionalString = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export function parseInbound(raw: unknown): WsInbound | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const o = raw as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type : '';

  switch (type) {
    case 'chat': {
      if (typeof o.text !== 'string') return { error: 'chat requires text:string' };
      return { type: 'chat', sessionId: optionalString(o.sessionId), text: o.text };
    }
    case 'command': {
      if (typeof o.text !== 'string') return { error: 'command requires text:string' };
      return { type: 'command', sessionId: optionalString(o.sessionId), text: o.text };
    }
    case 'commands':
      return { type: 'commands' };
    case 'agents':
      return { type: 'agents' };
    case 'approval_response': {
      const requestId = typeof o.requestId === 'string' ? o.requestId : typeof o.token === 'string' ? o.token : '';
      if (!requestId) return { error: 'approval_response requires requestId or token' };
      const actionRaw = typeof o.action === 'string' ? o.action : '';
      const action: ApprovalAction = APPROVAL_ACTIONS.has(actionRaw as ApprovalAction)
        ? (actionRaw as ApprovalAction)
        : 'deny';
      return { type: 'approval_response', requestId, action };
    }
    case 'set_active_agent': {
      const agentId = typeof o.agentId === 'string' ? o.agentId : '';
      if (!agentId) return { error: 'set_active_agent requires agentId' };
      return { type: 'set_active_agent', agentId, sessionId: optionalString(o.sessionId) };
    }
    case 'sessions:list':
      return { type: 'sessions:list' };
    case 'sessions:create':
      return { type: 'sessions:create', sessionId: optionalString(o.sessionId), title: optionalString(o.title) };
    case 'sessions:delete': {
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'sessions:delete requires sessionId' };
      return { type: 'sessions:delete', sessionId: o.sessionId };
    }
    case 'sessions:rename': {
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'sessions:rename requires sessionId' };
      return { type: 'sessions:rename', sessionId: o.sessionId, title: String(o.title ?? '') };
    }
    case 'sessions:get': {
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'sessions:get requires sessionId' };
      return { type: 'sessions:get', sessionId: o.sessionId };
    }
    default:
      return { error: `unknown message type: ${type || '<empty>'}` };
  }
}

export interface WireAgent {
  name: string;
  description: string;
  color?: string;
}

export interface WireCommand {
  command: string;
  description: string;
}

export type WireSessionChangeKind = 'created' | 'updated' | 'deleted' | 'renamed';

export interface WireRule {
  tool: string;
  argsPattern?: string;
  decision: 'allow' | 'deny' | 'ask';
}

export interface WireApprovalRequest {
  type: 'approval_request';
  requestId: string;
  sessionId: string | null;
  toolName: string;
  args: string;
  matchedRule: WireRule | undefined;
}

export interface SubAgentToolCallDetail {
  name?: string;
  arguments?: string;
}

export interface SubAgentToolResultDetail {
  name?: string;
  content?: string;
  error?: boolean;
}

export type SubAgentEventWire =
  | { runId: string; parentSessionId: string; agentName: string; type: 'started'; detail?: { task?: string } }
  | { runId: string; parentSessionId: string; agentName: string; type: 'content'; detail?: string }
  | { runId: string; parentSessionId: string; agentName: string; type: 'tool_call'; detail?: SubAgentToolCallDetail }
  | {
    runId: string;
    parentSessionId: string;
    agentName: string;
    type: 'tool_result';
    detail?: SubAgentToolResultDetail;
  }
  | { runId: string; parentSessionId: string; agentName: string; type: 'completed'; detail?: { content?: string } }
  | { runId: string; parentSessionId: string; agentName: string; type: 'error'; detail?: string };

export interface SchedulerTask {
  id: string;
  cron: string;
  prompt: string;
  timezone?: string;
  channel?: string;
}

export type SchedulerEvent =
  | { type: 'task_started'; task: SchedulerTask; at: number }
  | { type: 'task_completed'; task: SchedulerTask; at: number; durationMs: number }
  | { type: 'task_failed'; task: SchedulerTask; at: number; error: string };

export type WsOutbound =
  | { type: 'commands'; commands: WireCommand[] }
  | { type: 'agents'; agents: WireAgent[]; activeAgentId?: string | null }
  | { type: 'active_agent'; agentId: string | null; sessionId?: string; reason?: string }
  | { type: 'stream'; sessionId: string; text: string }
  | { type: 'reasoning'; sessionId: string; text: string }
  | { type: 'turn_start'; sessionId: string }
  | { type: 'turn_end'; sessionId: string; reason?: 'complete' | 'aborted' | 'error' }
  | { type: 'message'; sessionId: string; message: WireMessage }
  | { type: 'sessions:listed'; sessions: SessionSummaryWire[] }
  | { type: 'sessions:changed'; sessionId: string; kind: WireSessionChangeKind }
  | { type: 'sessions:history'; sessionId: string; session: PersistedSessionWire | null }
  | WireApprovalRequest
  | { type: 'scheduler_event'; event: SchedulerEvent }
  | { type: 'sub_agent_event'; event: SubAgentEventWire }
  | { type: 'error'; sessionId?: string; message: string };

export function approvalRequestToWire(req: PendingApproval, sessionId: string | null): WireApprovalRequest {
  return {
    type: 'approval_request',
    requestId: req.id,
    sessionId,
    toolName: req.name,
    args: JSON.stringify(req.input ?? {}),
    matchedRule: undefined,
  };
}
