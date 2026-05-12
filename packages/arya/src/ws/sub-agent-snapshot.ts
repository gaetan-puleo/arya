/**
 * Bridge mu-agents' `SubagentRunRegistry` to the WebSocket wire.
 *
 *  - On every snapshot transition (created / messages_changed / finished)
 *    push a `sub_agent_run` event to all connected clients.
 *  - Exposes a bootstrap helper that sends `sub_agent_runs:listed` to a
 *    freshly-connected client so they don't have to wait for the next
 *    transition to learn current state.
 *
 * The companion never reduces raw events into a run summary — it
 * mirrors these snapshots into its store and renders them directly.
 */

import type { WebSocket } from 'ws';
import {
  getMuAgents,
  type SubAgentRunSnapshot,
  type SubagentRunRegistry,
} from 'mu-agents';
import type { PluginRegistry } from 'mu-core';

export interface SubAgentSnapshotDeps {
  registry: PluginRegistry;
  push: (event: Record<string, unknown>) => void;
}

/**
 * Subscribe arya's WS push to mu-agents' run-registry snapshot stream.
 * Returns an unsubscribe.
 */
export function attachSubAgentSnapshotBridge(deps: SubAgentSnapshotDeps): () => void {
  const mu = getMuAgents(deps.registry);
  const runs: SubagentRunRegistry | undefined = mu?.runs;
  if (!runs) {
    return () => {
      // No mu-agents → nothing to subscribe.
    };
  }
  return runs.subscribeAllSnapshots((snapshot: SubAgentRunSnapshot) => {
    deps.push({ type: 'sub_agent_run', run: snapshot });
  });
}

/**
 * Send the current snapshot list to a single client on connect. Pure
 * directional send — does not subscribe.
 */
export function sendSubAgentRunsListing(
  ws: WebSocket,
  registry: PluginRegistry,
): void {
  const mu = getMuAgents(registry);
  const runs = mu?.runs?.listSnapshots() ?? [];
  ws.send(JSON.stringify({ type: 'sub_agent_runs:listed', runs }));
}
