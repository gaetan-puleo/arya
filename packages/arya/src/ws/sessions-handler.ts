/**
 * WS message handlers for the `sessions:*` family.
 *
 * Each handler maps one client message to:
 *   - a direct reply on the requesting socket (`ws.send`), and/or
 *   - a mutation on the persistent `SessionStore`. The store has its
 *     own `subscribe(...)` listener wired in `bootstrap.ts` that fans
 *     out `sessions:changed` + `sessions:listed` events for every
 *     mutation. Handlers here no longer push those events manually —
 *     they'd duplicate what the store-subscription path produces.
 *
 * Pulled out of `ws-channel.ts` to keep the connection-level if/else
 * chain manageable. No state lives here — handlers are pure functions
 * over `(msg, deps)`.
 */

import type { SessionStore } from 'mu-core';
import type { WebSocket } from 'ws';

export interface SessionsHandlerDeps {
  ws: WebSocket;
  store: SessionStore;
  pushError: (message: string) => void;
}

/** Tells caller whether this handler consumed the message. */
export function handleSessionsMessage(
  msg: Record<string, unknown>,
  deps: SessionsHandlerDeps,
): boolean {
  const { ws, store, pushError } = deps;

  if (msg.type === 'sessions:list') {
    ws.send(JSON.stringify({ type: 'sessions:listed', sessions: store.list() }));
    return true;
  }

  if (msg.type === 'sessions:create') {
    // Honor client-supplied id so the companion's optimistic switch
    // points at the same session the server persists. The store's
    // `create` is idempotent on existing ids.
    store.create({
      id: typeof msg.sessionId === 'string' ? msg.sessionId : undefined,
      title: typeof msg.title === 'string' ? msg.title : undefined,
    });
    return true;
  }

  if (msg.type === 'sessions:delete') {
    const id = String(msg.sessionId ?? '');
    if (!id) {
      pushError('sessions:delete missing sessionId');
      return true;
    }
    store.delete(id);
    return true;
  }

  if (msg.type === 'sessions:rename') {
    const id = String(msg.sessionId ?? '');
    const title = String(msg.title ?? '');
    if (!id) {
      pushError('sessions:rename missing sessionId');
      return true;
    }
    store.rename(id, title);
    return true;
  }

  if (msg.type === 'sessions:get') {
    const id = String(msg.sessionId ?? '');
    if (!id) {
      pushError('sessions:get missing sessionId');
      return true;
    }
    const session = store.get(id);
    ws.send(JSON.stringify({ type: 'sessions:history', sessionId: id, session }));
    return true;
  }

  return false;
}
