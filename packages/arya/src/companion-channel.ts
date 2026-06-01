import { type Channel, createChannel } from 'mu-harness';
import type { AgentSession, AgentSessionEvent } from 'mu-harness';
import { messageToWire } from './wire';
import type { WsOutbound } from './protocol';

export interface CompanionChannel {
  readonly channel: Channel;
  send(text: string): Promise<void>;
  detach(): void;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface CompanionChannelOptions {
  sessionId: string;
  getSession: () => AgentSession;
  broadcast: (frame: WsOutbound) => void;
  onTurnStart?: (sessionId: string) => void;
}

export function createCompanionChannel(options: CompanionChannelOptions): CompanionChannel {
  const { sessionId, broadcast } = options;
  const toolNames = new Map<string, string>();

  const emit = (event: AgentSessionEvent): void => {
    switch (event.type) {
      case 'turn_start': {
        options.onTurnStart?.(sessionId);
        broadcast({ type: 'turn_start', sessionId });
        for (const message of messageToWire(event.input, crypto.randomUUID(), Date.now(), toolNames)) {
          broadcast({ type: 'message', sessionId, message });
        }
        return;
      }
      case 'text':
        broadcast({ type: 'stream', sessionId, text: event.text });
        return;
      case 'reasoning':
        broadcast({ type: 'reasoning', sessionId, text: event.text });
        return;
      case 'message': {
        for (const message of messageToWire(event.message, crypto.randomUUID(), Date.now(), toolNames)) {
          broadcast({ type: 'message', sessionId, message });
        }
        return;
      }
      case 'turn_end':
        broadcast({ type: 'turn_end', sessionId, reason: 'complete' });
        return;
      case 'error':
        broadcast({ type: 'error', sessionId, message: errorMessage(event.error) });
        broadcast({ type: 'turn_end', sessionId, reason: 'error' });
        return;
      default:
        return;
    }
  };

  const channel = createChannel({
    id: `companion:${sessionId}`,
    title: sessionId,
    createSession: options.getSession,
  });
  const unsubscribe = channel.subscribe(emit);

  return {
    channel,
    send: (text) => channel.send(text),
    detach: unsubscribe,
  };
}
