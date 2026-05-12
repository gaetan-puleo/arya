/**
 * Inbound `{ type: 'chat' }` handler.
 *
 * Uses `runtime.submitText()` — the single canonical turn entry point.
 * No manual transform / decorate / drain / runAgent. No pre-persist of
 * user messages (the exact transcript is saved by auto-persist on
 * stream_ended).
 */

import type { WebSocket } from 'ws';
import {
  enrichLLMError,
  errorMessage,
  type MuRuntime,
} from 'mu-core';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:chat');

export interface ChatHandlerDeps {
  ws: WebSocket;
  defaultSessionId: string;
  runtime: MuRuntime;
  /** Per-connection set of sessions mid-turn — used to reject re-entrance. */
  runningSessions: Set<string>;
  /** Subscribe the connection's stream listener to this session if not already. */
  ensureSubscribed: (sessionId: string) => void;
  push: (event: Record<string, unknown>) => void;
}

export function handleChatMessage(
  msg: Record<string, unknown>,
  deps: ChatHandlerDeps,
): boolean {
  if (msg.type !== 'chat') return false;

  const targetSessionId = (msg.sessionId as string) || deps.defaultSessionId;

  if (deps.runningSessions.has(targetSessionId)) {
    deps.ws.send(
      JSON.stringify({
        type: 'error',
        message:
          'A turn is already running for this session. Wait for it to finish or abort it.',
        sessionId: targetSessionId,
      }),
    );
    return true;
  }

  deps.ensureSubscribed(targetSessionId);
  const userText = String(msg.text ?? '');

  deps.runningSessions.add(targetSessionId);
  (async () => {
    try {
      await deps.runtime.submitText({
        sessionId: targetSessionId,
        text: userText,
      });
    } catch (err) {
      const message = enrichLLMError(
        errorMessage(err),
        deps.runtime.config.baseUrl,
      );
      log.error(`submitText error (${targetSessionId}):`, message);
      deps.push({
        type: 'error',
        message,
        sessionId: targetSessionId,
      });
    } finally {
      deps.runningSessions.delete(targetSessionId);
    }
  })();

  return true;
}
