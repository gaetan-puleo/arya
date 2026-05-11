/**
 * Per-session MessageBus router for Arya's WS host.
 *
 * mu-agents' `@<subagent>` dispatch path (`transformUserInput` hook) relies
 * on `ctx.messages` to:
 *   - `append(msg)` — live-show a synthetic message (e.g. the user's own
 *     `@review …` echo and the `↳ subagent (running…)` header).
 *   - `injectNext(msg)` — queue a hidden relay prompt for the upcoming turn
 *     so the parent LLM sees the subagent's output.
 *   - `drainNext()` — host pulls queued messages right before `runTurn`
 *     so they're spliced into the transcript.
 *   - `subscribe` / `get` — observe the synthetic transcript (used by some
 *     plugins; we keep a per-session buffer for parity).
 *
 * mu-core's `MessageBus` is registry-scoped (one instance shared across
 * all sessions). We multiplex by tracking the *currently-handled* session
 * — set by the host immediately before invoking the hook chain — and
 * routing all bus calls to the right session's buffer / queue / WS push.
 */

import type { ChatMessage, MessageBus, Session } from 'mu-core';

/** Outbound transport — the WS channel passes its own `push` here. */
type PushFn = (event: Record<string, unknown>) => void;

/** Resolve a session by id (host owns the session manager). */
type SessionResolver = (sessionId: string) => Session | undefined;

export interface AryaMessageBusHandle {
  bus: MessageBus;
  /**
   * Set before each hook invocation. mu-agents calls `append`/`injectNext`
   * synchronously while `transformUserInput` runs, so a single mutable
   * pointer is sufficient — no concurrency hazard between turns.
   */
  setCurrentSession: (sessionId: string | null) => void;
  /** Pop everything `injectNext`'d for a session. Host calls before runTurn. */
  drainFor: (sessionId: string) => ChatMessage[];
  /** Per-session synthetic transcript (for `bus.get()` parity). */
  snapshot: (sessionId: string) => ChatMessage[];
}

interface PerSession {
  /** Live-appended synthetic messages (for `bus.get`/`bus.subscribe`). */
  appended: ChatMessage[];
  /** Pending messages to splice into the next runTurn. */
  injected: ChatMessage[];
  /** Subscribers to `bus.subscribe` (rare; mu-agents reads only). */
  subscribers: Set<(msgs: ChatMessage[]) => void>;
}

function emptyPerSession(): PerSession {
  return { appended: [], injected: [], subscribers: new Set() };
}

export function createAryaMessageBus(
  resolveSession: SessionResolver,
  push: PushFn,
): AryaMessageBusHandle {
  const bySession = new Map<string, PerSession>();
  let currentSessionId: string | null = null;

  function getOrInit(sessionId: string): PerSession {
    let entry = bySession.get(sessionId);
    if (!entry) {
      entry = emptyPerSession();
      bySession.set(sessionId, entry);
    }
    return entry;
  }

  function fireSubscribers(entry: PerSession): void {
    const snapshot = entry.appended.slice();
    for (const fn of entry.subscribers) {
      try {
        fn(snapshot);
      } catch {
        // ignore listener errors — they must not break the bus
      }
    }
  }

  const bus: MessageBus = {
    append(message) {
      if (!currentSessionId) {
        // No session in scope — degrade gracefully. mu-agents only calls
        // this from `transformUserInput`, which the host always wraps in
        // `setCurrentSession`, so hitting this branch indicates a bug.
        console.warn('[arya-message-bus] append() called without current session');
        return;
      }
      const entry = getOrInit(currentSessionId);
      entry.appended.push(message);
      fireSubscribers(entry);
      // Mirror the synthetic message into the session transcript so the
      // mu-core agent loop persists it across turns (matters for the
      // `↳ subagent` header staying visible after the turn ends).
      const session = resolveSession(currentSessionId);
      session?.appendSynthetic(message);
      // Surface to the connected companion so the live header / user
      // echo appears immediately. We piggy-back on the existing
      // `messages_changed` channel by sending a session-scoped event.
      push({
        type: 'synthetic_message',
        sessionId: currentSessionId,
        message,
      });
    },

    injectNext(message) {
      if (!currentSessionId) {
        console.warn('[arya-message-bus] injectNext() called without current session');
        return;
      }
      getOrInit(currentSessionId).injected.push(message);
    },

    drainNext() {
      if (!currentSessionId) return [];
      const entry = bySession.get(currentSessionId);
      if (!entry) return [];
      const out = entry.injected.slice();
      entry.injected.length = 0;
      return out;
    },

    subscribe(listener) {
      if (!currentSessionId) {
        // Fall back to a no-op subscriber when no session is in scope.
        return () => undefined;
      }
      const entry = getOrInit(currentSessionId);
      entry.subscribers.add(listener);
      listener(entry.appended.slice());
      return () => entry.subscribers.delete(listener);
    },

    get() {
      if (!currentSessionId) return [];
      return bySession.get(currentSessionId)?.appended.slice() ?? [];
    },
  };

  return {
    bus,
    setCurrentSession(sessionId) {
      currentSessionId = sessionId;
    },
    drainFor(sessionId) {
      const entry = bySession.get(sessionId);
      if (!entry) return [];
      const out = entry.injected.slice();
      entry.injected.length = 0;
      return out;
    },
    snapshot(sessionId) {
      return bySession.get(sessionId)?.appended.slice() ?? [];
    },
  };
}
