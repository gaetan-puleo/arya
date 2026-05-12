/**
 * Wire-boundary enrichment: resolve `meta.agent` → full `AgentInfo`
 * (id, color, description) and stamp it on the outbound message as
 * `author`. Saves every client from looking up agents by id.
 *
 * Used by `synthetic_message` pushes and (post-Batch-3) by any wire
 * event that carries a ChatMessage. The companion's
 * `MessageDisplayRow` and any future channel client read `.author`
 * directly — no agent registry lookup on the client.
 */

import { getMuAgents, listAgents } from 'mu-agents';
import type { ChatMessage, PluginRegistry } from 'mu-core';

export interface WireAuthor {
  id: string;
  description?: string;
  color?: string;
}

export interface AuthoredChatMessage extends ChatMessage {
  author?: WireAuthor;
}

/**
 * Lookup `meta.agent` against mu-agents' registry and stamp a flat
 * `author` field. If the agent name doesn't resolve (deleted
 * definition, etc.) we still surface the bare id so attribution
 * survives reload — color/description just go missing.
 */
export function enrichAuthor(
  msg: ChatMessage,
  registry: PluginRegistry,
): AuthoredChatMessage {
  const agentName = msg.meta?.agent;
  if (!agentName) return msg;
  const mu = getMuAgents(registry);
  if (!mu) return { ...msg, author: { id: agentName } };
  const all = listAgents(registry);
  const found = all.find((a) => a.id === agentName);
  if (!found) return { ...msg, author: { id: agentName } };
  const author: WireAuthor = { id: found.id };
  if (found.description) author.description = found.description;
  if (found.color) author.color = found.color;
  return { ...msg, author };
}
