/**
 * Approval-channel + approval-response handler for the WS transport.
 *
 * The companion is the visual approval UX: when mu-agents wants to run
 * a permission-gated tool it goes through the registered approval
 * channel, which here pushes an `approval_request` to every connected
 * client. The user's reply lands as an `approval_response` WS message;
 * we forward it to the gateway by token.
 */

import type { ApprovalChannel, ApprovalRequest } from 'mu-agents';
import type { PluginRegistry } from 'mu-core';
import { getMuAgents } from 'mu-agents';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:approval');

export interface ApprovalDeps {
  push: (event: Record<string, unknown>) => void;
  registry: PluginRegistry;
}

/** Build the approval channel — pushes requests to every connected client. */
export function createApprovalChannel(push: ApprovalDeps['push']): ApprovalChannel {
  return {
    sendApprovalRequest: async (req: ApprovalRequest) => {
      push({
        type: 'approval_request',
        requestId: req.id,
        token: req.token,
        toolName: req.toolName,
        toolArgs: req.toolArgs,
        agentId: req.agentId,
        channelId: req.channelId,
      });
      // Return undefined to defer resolution to gateway.approve/deny.
      return undefined;
    },
  };
}

/**
 * Handle an `approval_response` companion → server message by routing
 * it to the mu-agents gateway. Returns true when the message was
 * consumed (it always is for this type).
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
  const token = String(msg.token ?? msg.requestId ?? '');
  if (action === 'approved') {
    gateway.approve(token);
  } else {
    gateway.deny(token);
  }
  deps.push({
    type: 'approval_response',
    requestId: msg.requestId ?? msg.token,
    token,
    action,
  });
  return true;
}
