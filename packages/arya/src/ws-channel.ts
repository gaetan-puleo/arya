/**
 * WsChannel — harness Channel implementation for arya's WebSocket bridge.
 *
 * Owns the agent-bus → WS-client bridging that used to live inline in
 * `ws.ts`. The WS server layer (auth, raw socket lifecycle, sessions:*
 * RPCs, approvals, idle watch, scheduler-event push) stays in `ws.ts`;
 * only the bus → wire-frame translation lives here.
 *
 * The harness `Channel.send(ChannelOutEvent)` entry point is implemented
 * (so a future harness-driven orchestrator could push events through it
 * too) but arya wires the bus directly inside `start()` because it owns
 * its own runtime and bus lifecycle outside the channel manager.
 *
 * Wire shape MUST stay compatible with arya-companion (separate repo).
 */
import type { CoreEvent, EventBus, Unsubscribe } from 'mu-core';
import type { Channel, ChannelContext, ChannelOutEvent } from 'mu-harness';

/** Function the channel calls to broadcast a JSON frame to every connected client. */
export type WsBroadcast = (event: Record<string, unknown>) => void;

export interface WsChannelOptions {
  /** Channel id (default: 'arya-ws'). */
  id?: string;
  /** Agent runtime bus to subscribe to. */
  bus: EventBus<CoreEvent>;
  /** Broadcast a JSON frame to every connected WS client. */
  broadcast: WsBroadcast;
  /** Returns the currently-active session id, or null if none. */
  getActiveSessionId: () => string | null;
}

export interface WsChannelHandle extends Channel {
  /** Drop the current bus subscription (e.g. on session teardown). */
  detach(): void;
  /** Re-subscribe to the bus (e.g. after session swap). */
  attach(): void;
}

/**
 * Build the wire-format frame for a bus event. Exported for tests.
 * Returns `null` for bus events that have no client-facing mapping.
 */
export function busEventToWireFrame(
  event: CoreEvent,
  sessionId: string,
): Record<string, unknown> | null {
  switch (event.type) {
    case 'assistant_delta':
      return { type: 'stream', sessionId, text: event.content };
    case 'reasoning_delta':
      return { type: 'reasoning', sessionId, text: event.content };
    case 'assistant_message':
    case 'reasoning_message':
    case 'user_message':
      return { type: 'message', sessionId, message: event.message };
    case 'tool_call':
      return {
        type: 'activity',
        sessionId,
        event: {
          kind: 'tool_start',
          summary: `${event.call.tool}(${truncate(event.call.args, 120)})`,
          tool: event.call.tool,
          args: event.call.args,
        },
      };
    case 'tool_result':
      return {
        type: 'activity',
        sessionId,
        event: { kind: 'tool_end', summary: truncate(event.message.content, 200) },
      };
    case 'error':
      return { type: 'error', sessionId, message: errorMessage(event.error) };
    default:
      return null;
  }
}

export function createWsChannel(options: WsChannelOptions): WsChannelHandle {
  const id = options.id ?? 'arya-ws';
  const { bus, broadcast, getActiveSessionId } = options;
  let unsub: Unsubscribe | undefined;

  function attach(): void {
    if (unsub) return;
    unsub = bus.subscribe((event) => {
      const sessionId = getActiveSessionId();
      if (!sessionId) return;
      const frame = busEventToWireFrame(event, sessionId);
      if (frame) broadcast(frame);
    });
  }

  function detach(): void {
    unsub?.();
    unsub = undefined;
  }

  return {
    id,
    kind: 'ws',

    // Channel-manager lifecycle: attach the bus subscription when started.
    // `ChannelContext.deliver` is unused — arya parses inbound WS frames
    // inside ws.ts (RPCs, approval responses, etc.) rather than funneling
    // them through a generic ChannelInEvent vocabulary.
    start(_ctx: ChannelContext): void {
      attach();
    },

    stop(): void {
      detach();
    },

    /**
     * Render a harness-driven ChannelOutEvent to clients. Today arya wires
     * the bus subscription directly (see `start`), so this entry point is
     * unused by arya itself. Kept implemented for forward-compat — a host
     * routing events via ChannelManager.broadcast/send would work too.
     */
    send(event: ChannelOutEvent): void {
      const sessionId = getActiveSessionId();
      if (!sessionId) return;
      const frame = channelOutEventToWireFrame(event, sessionId);
      if (frame) broadcast(frame);
    },

    attach,
    detach,
  };
}

function channelOutEventToWireFrame(
  event: ChannelOutEvent,
  sessionId: string,
): Record<string, unknown> | null {
  switch (event.type) {
    case 'assistant_delta':
      return { type: 'stream', sessionId, text: event.content };
    case 'reasoning_delta':
      return { type: 'reasoning', sessionId, text: event.content };
    case 'assistant_message':
    case 'reasoning_message':
      return { type: 'message', sessionId, message: event.message };
    case 'tool_call':
      return {
        type: 'activity',
        sessionId,
        event: {
          kind: 'tool_start',
          summary: `${event.call.tool}(${truncate(event.call.args, 120)})`,
          tool: event.call.tool,
          args: event.call.args,
        },
      };
    case 'tool_result':
      return {
        type: 'activity',
        sessionId,
        event: { kind: 'tool_end', summary: truncate(event.message.content, 200) },
      };
    case 'error':
      return { type: 'error', sessionId, message: errorMessage(event.error) };
    case 'session_switched':
      return { type: 'sessions:changed', sessionId: event.sessionId, kind: 'switched' };
    default:
      return null;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
