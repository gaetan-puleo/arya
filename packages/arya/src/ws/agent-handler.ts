/**
 * WS message handlers for the `commands` / `agents` request frames and
 * the `set_active_agent` mutation.
 *
 * `set_active_agent` is session-scoped: the client sends a `sessionId`
 * and the override applies only to that session. Without a `sessionId`,
 * the global default is changed.
 */

import type { PluginRegistry } from 'mu-core';
import type { AgentListItem } from 'mu-agents';
import { getActiveAgentId, getMuAgents } from 'mu-agents';
import type { WebSocket } from 'ws';

export interface AgentHandlerDeps {
  ws: WebSocket;
  registry: PluginRegistry;
  getCommands: () => Array<{ command: string; description: string }>;
  getAgents: () => AgentListItem[];
  pushError: (message: string) => void;
}

export function handleAgentMessage(
  msg: Record<string, unknown>,
  deps: AgentHandlerDeps,
): boolean {
  const { ws, registry, getCommands, getAgents, pushError } = deps;

  if (msg.type === 'commands') {
    ws.send(JSON.stringify({ type: 'commands', commands: getCommands() }));
    return true;
  }

  if (msg.type === 'agents') {
    const agents = getAgents();
    const activeAgentId = getActiveAgentId(registry);
    ws.send(JSON.stringify({ type: 'agents', agents, activeAgentId }));
    return true;
  }

  if (msg.type === 'set_active_agent') {
    const agentId = typeof msg.agentId === 'string' ? msg.agentId : null;
    const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : null;
    const manager = getMuAgents(registry)?.manager;
    if (!agentId || !manager) {
      pushError('Cannot switch agent: missing agentId or manager');
      return true;
    }

    const ok = manager.setActiveFor(agentId, sessionId);
    if (!ok) {
      const current = getActiveAgentId(registry, sessionId);
      ws.send(JSON.stringify({ type: 'active_agent', agentId: current }));
    }
    return true;
  }

  return false;
}
