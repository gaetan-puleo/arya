/**
 * Inbound `{ type: 'command' }` handler.
 *
 * Slash commands are intercepted host-side: we don't feed the raw
 * `/foo` text to the LLM — we look up the command and run its
 * `execute(args, ctx)`. The user-facing message is persisted as a
 * normal turn. Command OUTPUT is routed through `session.appendSynthetic`
 * with `display.llmHidden: true` so it:
 *
 *  - renders in the transcript (companion mirrors `synthetic_message`),
 *  - persists to disk via `attachAutoPersist`'s `synthetic_appended`
 *    handler in mu-core,
 *  - is stripped from the LLM payload on the next turn (slash command
 *    output should NOT enter LLM context — `/help` etc. aren't
 *    conversation).
 *
 * Broadcasts of agent-state changes (`commands` / `agents` / `active_agent`)
 * come from the `subscribeActiveAgent` + `subscribeAgentsList` wires in
 * `ws-channel.ts` — no defensive rebroadcast here.
 */

import {
  errorMessage,
  makeSyntheticMessage,
  makeUserMessage,
  type PluginRegistry,
  type ProviderConfig,
  type SessionManager,
  type SessionStore,
  type SlashCommand,
} from 'mu-core';
import { getActiveAgentId } from 'mu-agents';
import type { WebSocket } from 'ws';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:command');

export interface CommandHandlerDeps {
  ws: WebSocket;
  defaultSessionId: string;
  sessions: SessionManager;
  registry: PluginRegistry;
  store: SessionStore;
  providerConfig: ProviderConfig;
  push: (event: Record<string, unknown>) => void;
  getCommands: () => Array<{ command: string; description: string }>;
}

function findCommand(
  registry: PluginRegistry,
  name: string,
): SlashCommand | undefined {
  return (registry.getCommands() ?? []).find((c) => c.name === name);
}

/**
 * Build a synthetic assistant message for command output. Flagged
 * `llmHidden: true` so it never enters LLM context, and stamped with
 * the active agent id for attribution.
 */
function buildCommandOutput(
  text: string,
  registry: PluginRegistry,
) {
  return makeSyntheticMessage({
    role: 'assistant',
    content: text,
    display: { llmHidden: true },
    agent: getActiveAgentId(registry) ?? undefined,
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

  // Ensure the in-memory session exists so `appendSynthetic` lands in
  // the right transcript. Chat-handler does the same.
  const session = deps.sessions.getOrCreate(targetSessionId);

  // Persist the user input first (mirrors chat semantics, keeps
  // `/help` visible in history). The store's own `subscribe(...)`
  // (wired in `bootstrap.ts`) drives the `sessions:changed` +
  // `sessions:listed` broadcast.
  try {
    deps.store.appendMessage(targetSessionId, makeUserMessage(userText));
  } catch (err) {
    log.error('failed to persist user message:', err);
  }

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
  const cmd = findCommand(deps.registry, cmdName);
  if (!cmd) {
    const errText = `Unknown command: /${cmdName}. Type /help for a list.`;
    deps.push({ type: 'stream', text: errText, sessionId: targetSessionId });
    deps.push({ type: 'done', text: '', sessionId: targetSessionId });
    session.appendSynthetic(buildCommandOutput(errText, deps.registry));
    return true;
  }

  // Run async without blocking the WS message loop.
  (async () => {
    try {
      const result = await cmd.execute(cmdArgs, {
        messages: [],
        cwd: process.cwd(),
        config: deps.providerConfig,
      });

      if (result && result.trim()) {
        deps.push({
          type: 'stream',
          text: result,
          sessionId: targetSessionId,
        });
        session.appendSynthetic(buildCommandOutput(result, deps.registry));
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
