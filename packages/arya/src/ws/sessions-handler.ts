/**
 * WS message handlers for the `sessions:*` family.
 *
 * Each handler maps one client message to:
 *   - a direct reply on the requesting socket (`ws.send`), and/or
 *   - a broadcast to every connected client (`push`),
 *   - and a `sessions:listed` rebroadcast so every connected companion
 *     converges to the same list without polling.
 *
 * Pulled out of `ws-channel.ts` to keep the connection-level if/else
 * chain manageable. No state lives here — handlers are pure functions
 * over `(msg, deps)`.
 */

import type { WebSocket } from 'ws';
import type { SessionStore } from 'mu-core';

export interface SessionsHandlerDeps {
  ws: WebSocket;
  store: SessionStore;
  push: (event: Record<string, unknown>) => void;
  pushError: (message: string) => void;
}

/** Tells caller whether this handler consumed the message. */
export function handleSessionsMessage(
  msg: Record<string, unknown>,
  deps: SessionsHandlerDeps,
): boolean {
  const { ws, store, push, pushError } = deps;

  if (msg.type === 'sessions:list') {
    ws.send(JSON.stringify({ type: 'sessions:listed', sessions: store.list() }));
    return true;
  }

  if (msg.type === 'sessions:create') {
    // Honor a client-supplied `sessionId` when present so the
    // companion's optimistic switch (it pre-generates an id and
    // switches into it before the round-trip completes) ends up
    // pointing at the same session the server actually persisted.
    // The underlying store is idempotent on existing ids — see
    // `createJSONLSessionStore.create` in mu-core — so re-sending
    // the same id is a safe no-op.
    //
    // Without this forwarding, the server would mint its own id,
    // the client would keep talking to a phantom id, and the next
    // `chat` message would auto-create a second (duplicate) session
    // via `appendMessage`'s auto-create branch.
    const created = store.create({
      id: typeof msg.sessionId === 'string' ? msg.sessionId : undefined,
      title: typeof msg.title === 'string' ? msg.title : undefined,
    });
    push({ type: 'sessions:changed', sessionId: created.id, kind: 'created' });
    push({ type: 'sessions:listed', sessions: store.list() });
    return true;
  }

  if (msg.type === 'sessions:delete') {
    const id = String(msg.sessionId ?? '');
    if (!id) {
      pushError('sessions:delete missing sessionId');
      return true;
    }
    if (store.delete(id)) {
      push({ type: 'sessions:changed', sessionId: id, kind: 'deleted' });
      push({ type: 'sessions:listed', sessions: store.list() });
    }
    return true;
  }

  if (msg.type === 'sessions:rename') {
    const id = String(msg.sessionId ?? '');
    const title = String(msg.title ?? '');
    if (!id) {
      pushError('sessions:rename missing sessionId');
      return true;
    }
    if (store.rename(id, title)) {
      push({ type: 'sessions:changed', sessionId: id, kind: 'renamed' });
      push({ type: 'sessions:listed', sessions: store.list() });
    }
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
