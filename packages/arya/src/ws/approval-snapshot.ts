/**
 * Bridge mu-agents' `ApprovalGateway` snapshots to the WebSocket wire.
 *
 * Companion mirrors `approval_state` events into its store; no
 * client-side reducer for pending → resolved transitions.
 */

import type { WebSocket } from 'ws';
import { getMuAgents, type ApprovalSnapshot } from 'mu-agents';
import type { PluginRegistry } from 'mu-core';

export interface ApprovalSnapshotDeps {
  registry: PluginRegistry;
  push: (event: Record<string, unknown>) => void;
}

/** Subscribe arya's WS push to the gateway's snapshot stream. */
export function attachApprovalSnapshotBridge(deps: ApprovalSnapshotDeps): () => void {
  const gateway = getMuAgents(deps.registry)?.approvalGateway;
  if (!gateway) {
    return () => {};
  }
  return gateway.subscribeAllSnapshots((snapshot: ApprovalSnapshot) => {
    deps.push({ type: 'approval_state', snapshot });
  });
}

/** Send the current snapshot list to a single client on connect. */
export function sendApprovalsListing(
  ws: WebSocket,
  registry: PluginRegistry,
): void {
  const snapshots =
    getMuAgents(registry)?.approvalGateway?.listSnapshots() ?? [];
  ws.send(JSON.stringify({ type: 'approvals:listed', approvals: snapshots }));
}
