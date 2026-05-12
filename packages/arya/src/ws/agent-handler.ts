/**
 * WS message handlers for the `commands` / `agents` request frames and
 * the `set_active_agent` mutation. Pulled out of `ws-channel.ts` so the
 * connection-level dispatch chain stays focused on routing, not on
 * each handler's body.
 *
 * Read-only frames echo the current registry state to the requester;
 * `set_active_agent` flips the primary agent via mu-agents' manager.
 * Broadcasts of "active changed" / "agents list changed" come from
 * `subscribeActiveAgent` / `subscribeAgentsList` subscriptions wired
 * in `ws-channel.ts` — these handlers do NOT push themselves.
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

/** Tells caller whether this handler consumed the message. */
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
    const manager = getMuAgents(registry)?.manager;
    if (!manager?.setActive || !agentId) {
      pushError('Cannot switch agent: missing agentId or manager');
      return true;
    }
    const ok = manager.setActive(agentId);
    // setActive returns false when the name doesn't exist or is already
    // active. The broadcast (active_agent) only fires when the active
    // name actually changes, so explicitly echo the current state to
    // the requester for unchanged cases.
    if (!ok) {
      const current = getActiveAgentId(registry);
      ws.send(JSON.stringify({ type: 'active_agent', agentId: current }));
    }
    return true;
  }

  return false;
}
