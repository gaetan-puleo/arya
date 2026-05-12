/**
 * Approval channel + response handler for the WS transport.
 *
 * Post-Batch-3, the *snapshot bridge* (`ws/approval-snapshot.ts`)
 * pushes `approval_state` events whenever the gateway transitions a
 * request. This module's only job:
 *
 *  - Provide an `ApprovalChannel` implementation that mu-agents
 *    registers against the gateway. Today the channel is a no-op (it
 *    returns `undefined` to defer resolution to the snapshot/inbound
 *    response path), but having a channel registered is what tells
 *    the gateway to fire snapshot events.
 *  - Route inbound `approval_response` companion → server messages
 *    into `gateway.approve(token)` / `gateway.deny(token)`. The
 *    resulting gateway state transition is what triggers the snapshot
 *    push; we do not echo the response separately.
 */

import type { ApprovalChannel, ApprovalRequest } from 'mu-agents';
import { getMuAgents } from 'mu-agents';
import type { PluginRegistry } from 'mu-core';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:approval');

export interface ApprovalDeps {
  registry: PluginRegistry;
}

/**
 * Build the WS approval channel. The channel itself is intentionally
 * a no-op: the request push is now driven by the snapshot bridge
 * (which fires on every transition, including the initial "pending"
 * state). We only need a channel object so the gateway has someone to
 * deliver requests to — `undefined` return defers resolution.
 */
export function createApprovalChannel(): ApprovalChannel {
  return {
    sendApprovalRequest: async (_req: ApprovalRequest) => undefined,
  };
}

/**
 * Handle an `approval_response` companion → server message by routing
 * it to the mu-agents gateway. The gateway emits a snapshot on the
 * resulting state transition; clients learn of the resolution via
 * `approval_state`. Returns true when the message was consumed.
 */
export function handleApprovalResponse(
  msg: Record<string, unknown>,
  deps: ApprovalDeps,
): boolean {
  if (msg.type !== 'approval_response') return false;
  const gateway = getMuAgents(deps.registry)?.approvalGateway;
  if (!gateway) {
    log.warn('No approval gateway found');
    return true;
  }
  const action = msg.action === 'approve' ? 'approved' : 'denied';
  const token = String(msg.token ?? msg.approvalId ?? '');
  if (action === 'approved') {
    gateway.approve(token);
  } else {
    gateway.deny(token);
  }
  return true;
}
