/**
 * Boot-time approval channel registration.
 *
 * Lives outside `ws-channel.ts` so the per-WS-connection handler in
 * `wss.on('connection', …)` doesn't re-register the channel on every
 * client connect (the gateway stores channels in a `Set`, so repeated
 * registration leaks Set entries).
 *
 * Today the channel itself is a no-op — the actual approval *requests*
 * fan out via the snapshot bridge (`ws/approval-snapshot.ts`) and
 * inbound `approval_response` messages come back through
 * `handleApprovalResponse` in `ws/approval.ts`. We still need a channel
 * registered against the gateway so it knows there's a listener and
 * fires snapshot events.
 *
 * Returns `{ channel, unregister }` so the caller can hand `channel`
 * into the WS channel for use by the inbound-response path, and call
 * `unregister` on shutdown.
 */

import type { ApprovalChannel } from 'mu-agents';
import { getMuAgents } from 'mu-agents';
import type { PluginRegistry } from 'mu-core';

export interface SetupApprovalChannelResult {
  channel: ApprovalChannel;
  unregister: () => void;
}

export function setupApprovalChannel(
  registry: PluginRegistry,
): SetupApprovalChannelResult {
  const channel: ApprovalChannel = {
    sendApprovalRequest: async () => undefined,
  };
  const gateway = getMuAgents(registry)?.approvalGateway;
  const unregister = gateway
    ? gateway.registerChannel('websocket', channel)
    : (): void => {
        // gateway absent — nothing to unregister
      };
  return { channel, unregister };
}
