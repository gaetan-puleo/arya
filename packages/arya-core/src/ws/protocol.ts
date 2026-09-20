import type { PersistedSessionWire, SessionSummaryWire } from './session-service';
import type { WireAttachment, WireMessage } from './wire';
import type { ApprovalAction, PendingApproval } from 'mu-coding';
import type { Message, Usage } from 'mu-core';

export interface WireModel {
  id: string;
  ownedBy?: string;
}

/** WS wire protocol version. Bump on any breaking frame change so a stale
 * companion (installed on phones we can't update) can detect incompatibility
 * instead of failing opaquely. */
export const PROTOCOL_VERSION = 1;

/** Lowest protocol version this server accepts. A client below this is stale and
 * gets an explicit close instead of silent degradation. Raise when we drop support
 * for an old companion. */
export const MIN_PROTOCOL_VERSION = 1;

export type WsInbound =
  | { type: 'hello'; protocolVersion: number; client?: string }
  | {
    type: 'chat';
    sessionId?: string;
    text: string;
    attachments?: WireAttachment[];
    /** `'off'` = skip model reasoning for this turn (voice call mode). Replaces
     * the legacy zero-width marker; the marker is still honored for old clients. */
    thinking?: 'off';
  }
  | { type: 'command'; sessionId?: string; text: string }
  | { type: 'commands' }
  | { type: 'agents' }
  | { type: 'approval_response'; requestId: string; action: ApprovalAction }
  | { type: 'set_active_agent'; agentId: string; sessionId?: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'models:list' }
  | { type: 'models:select'; ref: string }
  | { type: 'subagent:dispatch'; requestId: string; agent: string; task: string; parentId: string }
  | { type: 'sessions:list' }
  | { type: 'sessions:create'; sessionId?: string; title?: string }
  | { type: 'sessions:delete'; sessionId: string }
  | { type: 'sessions:rename'; sessionId: string; title: string }
  | { type: 'sessions:fork'; requestId: string; sessionId: string; upToIndex: number }
  | { type: 'sessions:get'; sessionId: string }
  | { type: 'sessions:search'; requestId: string; query: string }
  | { type: 'voice:check'; requestId: string }
  | { type: 'voice:transcribe'; requestId: string; mime: string; data: string };

const APPROVAL_ACTIONS = new Set<ApprovalAction>(['approve', 'approve_always', 'deny']);

const optionalString = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function parseAttachments(v: unknown): WireAttachment[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: WireAttachment[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if ((a.kind === 'image' || a.kind === 'audio') && typeof a.mime === 'string' && typeof a.data === 'string') {
      out.push({ kind: a.kind, mime: a.mime, data: a.data });
    }
  }
  return out.length > 0 ? out : undefined;
}

export function parseInbound(raw: unknown): WsInbound | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const o = raw as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type : '';

  switch (type) {
    case 'hello': {
      const v = o.protocolVersion;
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
        return { error: 'hello requires a positive integer protocolVersion' };
      }
      return { type: 'hello', protocolVersion: v, client: optionalString(o.client) };
    }
    case 'chat': {
      if (typeof o.text !== 'string') return { error: 'chat requires text:string' };
      const attachments = parseAttachments(o.attachments);
      return {
        type: 'chat',
        sessionId: optionalString(o.sessionId),
        text: o.text,
        ...(attachments ? { attachments } : {}),
        ...(o.thinking === 'off' ? { thinking: 'off' as const } : {}),
      };
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
    case 'abort': {
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'abort requires sessionId' };
      return { type: 'abort', sessionId: o.sessionId };
    }
    case 'models:list':
      return { type: 'models:list' };
    case 'models:select': {
      if (typeof o.ref !== 'string' || !o.ref) return { error: 'models:select requires ref:string' };
      return { type: 'models:select', ref: o.ref };
    }
    case 'subagent:dispatch': {
      const requestId = typeof o.requestId === 'string' ? o.requestId : '';
      const agent = typeof o.agent === 'string' ? o.agent : '';
      const task = typeof o.task === 'string' ? o.task : '';
      if (!requestId || !agent || !task) {
        return { error: 'subagent:dispatch requires requestId, agent, task' };
      }
      return { type: 'subagent:dispatch', requestId, agent, task, parentId: optionalString(o.parentId) ?? '' };
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
    case 'sessions:fork': {
      const requestId = typeof o.requestId === 'string' ? o.requestId : '';
      if (!requestId) return { error: 'sessions:fork requires requestId' };
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'sessions:fork requires sessionId' };
      const upToIndex = typeof o.upToIndex === 'number' && Number.isInteger(o.upToIndex) ? o.upToIndex : -1;
      if (upToIndex < 0) return { error: 'sessions:fork requires upToIndex:int>=0' };
      return { type: 'sessions:fork', requestId, sessionId: o.sessionId, upToIndex };
    }
    case 'sessions:get': {
      if (typeof o.sessionId !== 'string' || !o.sessionId) return { error: 'sessions:get requires sessionId' };
      return { type: 'sessions:get', sessionId: o.sessionId };
    }
    case 'sessions:search': {
      const requestId = typeof o.requestId === 'string' ? o.requestId : '';
      if (!requestId) return { error: 'sessions:search requires requestId' };
      if (typeof o.query !== 'string') return { error: 'sessions:search requires query:string' };
      return { type: 'sessions:search', requestId, query: o.query };
    }
    case 'voice:check': {
      const requestId = typeof o.requestId === 'string' ? o.requestId : '';
      if (!requestId) return { error: 'voice:check requires requestId' };
      return { type: 'voice:check', requestId };
    }
    case 'voice:transcribe': {
      const requestId = typeof o.requestId === 'string' ? o.requestId : '';
      if (!requestId) return { error: 'voice:transcribe requires requestId' };
      if (typeof o.mime !== 'string' || !o.mime) return { error: 'voice:transcribe requires mime:string' };
      if (typeof o.data !== 'string' || !o.data) return { error: 'voice:transcribe requires data:string (base64)' };
      return { type: 'voice:transcribe', requestId, mime: o.mime, data: o.data };
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

/** A single row in a host-pushed side-panel section. Mirrors mu's `PanelItem`. */
export interface WirePanelItem {
  label: string;
  value?: string;
  status?: 'running' | 'done' | 'error';
  marker?: string;
}

/** A titled section pushed to the client's side panel. Mirrors mu's `PanelSection`. */
export interface WirePanelSection {
  title: string;
  items: WirePanelItem[];
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
  /** The agent that triggered the approval, when known — lets the client show
   * "agent X wants to run tool Y" instead of a bare tool name. */
  agentName?: string;
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

export interface WireSchedulerTask {
  id: string;
  cron: string;
  prompt: string;
  timezone?: string;
  /** When set, the task runs this shell command directly (no agent / no LLM). */
  command?: string;
}

export type WireSchedulerEvent =
  | { type: 'task_started'; task: WireSchedulerTask; at: number }
  | { type: 'task_completed'; task: WireSchedulerTask; at: number; durationMs: number; silent?: boolean; output?: string }
  | { type: 'task_failed'; task: WireSchedulerTask; at: number; error: string };

export interface WireTask {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  priority: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type WireTaskEvent =
  | { type: 'created'; task: WireTask; at: string }
  | { type: 'updated'; task: WireTask; previous: WireTask; at: string }
  | { type: 'moved'; task: WireTask; previous: WireTask; at: string }
  | { type: 'removed'; task: WireTask; at: string };

export interface SessionSearchHit {
  id: string;
  title: string;
  snippet: string;
  matches: number;
}

export type WsOutbound =
  | { type: 'server_hello'; protocolVersion: number }
  | { type: 'commands'; commands: WireCommand[] }
  | { type: 'capabilities'; vision: boolean; audio: boolean }
  | { type: 'model_loading'; model: string; loading: boolean }
  | { type: 'panel:update'; sections: WirePanelSection[] }
  | { type: 'agents'; agents: WireAgent[]; activeAgentId?: string | null }
  | { type: 'active_agent'; agentId: string | null; sessionId?: string; reason?: string }
  | { type: 'stream'; sessionId: string; text: string }
  | { type: 'reasoning'; sessionId: string; text: string }
  | { type: 'turn_start'; sessionId: string }
  | { type: 'turn_end'; sessionId: string; reason?: 'complete' | 'aborted' | 'error' }
  | { type: 'usage'; sessionId: string; usage: Usage }
  | { type: 'message'; sessionId: string; message: WireMessage }
  | { type: 'models:listed'; models: WireModel[]; selected: string }
  | { type: 'subagent:result'; requestId: string; agent: string; text: string }
  | { type: 'subagent:error'; requestId: string; message: string }
  | { type: 'voice:availability'; requestId: string; reason?: string }
  | { type: 'voice:result'; requestId: string; text: string }
  | { type: 'voice:error'; requestId: string; message: string }
  | { type: 'sessions:listed'; sessions: SessionSummaryWire[] }
  | { type: 'sessions:changed'; sessionId: string; kind: WireSessionChangeKind }
  | { type: 'sessions:history'; sessionId: string; session: PersistedSessionWire | null }
  | { type: 'sessions:raw'; sessionId: string; messages: Message[] }
  | { type: 'sessions:forked'; requestId: string; sessionId: string; messages: Message[] }
  | { type: 'sessions:search:results'; requestId: string; query: string; results: SessionSearchHit[] }
  | { type: 'skill:suggestion'; sessionId: string; kind: 'capture' | 'improve'; skill?: string; reason: string; steps: number }
  | WireApprovalRequest
  | { type: 'scheduler_event'; event: WireSchedulerEvent }
  | { type: 'task_event'; event: WireTaskEvent }
  | { type: 'sub_agent_event'; event: SubAgentEventWire }
  | { type: 'error'; sessionId?: string; message: string };

export function approvalRequestToWire(req: PendingApproval, sessionId: string | null): WireApprovalRequest {
  return {
    type: 'approval_request',
    requestId: req.id,
    sessionId,
    agentName: req.agent,
    toolName: req.name,
    args: JSON.stringify(req.input ?? {}),
    matchedRule: undefined,
  };
}
