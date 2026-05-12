/**
 * Inbound `{ type: 'command' }` handler.
 *
 * Uses `runtime.submitCommand()` — the canonical slash command path.
 * Command output is routed through `session.appendSynthetic` with
 * `display.llmHidden: true` so it renders in the transcript but
 * doesn't enter LLM context.
 */

import {
  errorMessage,
  makeSyntheticMessage,
  makeUserMessage,
  type MuRuntime,
  type SessionStore,
} from 'mu-core';
import { getActiveAgentId } from 'mu-agents';
import type { WebSocket } from 'ws';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:command');

export interface CommandHandlerDeps {
  ws: WebSocket;
  defaultSessionId: string;
  runtime: MuRuntime;
  store: SessionStore;
  push: (event: Record<string, unknown>) => void;
  getCommands: () => Array<{ command: string; description: string }>;
}

function buildCommandOutput(text: string, runtime: MuRuntime, sessionId: string | null) {
  return makeSyntheticMessage({
    role: 'assistant',
    content: text,
    display: { llmHidden: true },
    agent: getActiveAgentId(runtime.registry, sessionId) ?? undefined,
    source: 'arya.command',
  });
}

export function handleCommandMessage(
  msg: Record<string, unknown>,
  deps: CommandHandlerDeps,
): boolean {
  if (msg.type !== 'command') return false;

  const targetSessionId = (msg.sessionId as string) || deps.defaultSessionId;
  const userText = String(msg.text ?? '').trim();
  const session = deps.runtime.sessions.getOrCreate(targetSessionId);

  // Persist user input so `/help` etc. appear in history.
  session.appendSynthetic(makeUserMessage(userText));

  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(userText);
  if (!match) {
    deps.push({
      type: 'error',
      message: `Invalid command: "${userText}"`,
      sessionId: targetSessionId,
    });
    return true;
  }

  const [, cmdName, cmdArgs = ''] = match;

  (async () => {
    try {
      const result = await deps.runtime.submitCommand({
        sessionId: targetSessionId,
        commandName: cmdName!,
        args: cmdArgs,
      });

      if (result.kind === 'not_found') {
        const errText = `Unknown command: /${cmdName}. Type /help for a list.`;
        deps.push({ type: 'stream', text: errText, sessionId: targetSessionId });
        deps.push({ type: 'done', text: '', sessionId: targetSessionId });
        session.appendSynthetic(buildCommandOutput(errText, deps.runtime, targetSessionId));
        return;
      }

      if (result.output?.trim()) {
        deps.push({
          type: 'stream',
          text: result.output,
          sessionId: targetSessionId,
        });
        session.appendSynthetic(buildCommandOutput(result.output, deps.runtime, targetSessionId));
      }
      deps.push({ type: 'done', text: '', sessionId: targetSessionId });
    } catch (err) {
      const message = errorMessage(err);
      log.error(`command "${cmdName}" failed:`, message);
      deps.push({ type: 'error', message, sessionId: targetSessionId });
    }
  })();

  return true;
}
