/**
 * Inbound `approval_response` handler for the WS transport.
 *
 * The approval *channel* itself is registered once at boot (see
 * `ws/approval-bootstrap.ts`); fan-out of pending/resolved transitions
 * happens via the snapshot bridge (`ws/approval-snapshot.ts`). This
 * module's only job:
 *
 *  - Route inbound `approval_response` companion → server messages
 *    into `gateway.approve(token)` / `gateway.deny(token)`. The
 *    resulting gateway state transition is what triggers the snapshot
 *    push; we do not echo the response separately.
 */

import { getMuAgents } from 'mu-agents';
import type { PluginRegistry } from 'mu-core';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:approval');

export interface ApprovalDeps {
  registry: PluginRegistry;
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
