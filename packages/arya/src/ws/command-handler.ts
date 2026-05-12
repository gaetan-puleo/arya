/**
 * Inbound `{ type: 'command' }` handler.
 *
 * Slash commands are intercepted host-side: we don't feed the raw
 * `/foo` text to the LLM — we look up the command and run its
 * `execute(args, ctx)`. The user-facing message and the command output
 * (if any) are persisted as normal turns so history reads correctly.
 */

import type { WebSocket } from 'ws';
import {
  errorMessage,
  makeAssistantMessage,
  makeUserMessage,
  type PluginRegistry,
  type ProviderConfig,
  type SessionStore,
  type SlashCommand,
} from 'mu-core';
import { getActiveAgentId, listAgents } from 'mu-agents';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ws:command');

export interface CommandHandlerDeps {
  ws: WebSocket;
  defaultSessionId: string;
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

export function handleCommandMessage(
  msg: Record<string, unknown>,
  deps: CommandHandlerDeps,
): boolean {
  if (msg.type !== 'command') return false;

  const targetSessionId = (msg.sessionId as string) || deps.defaultSessionId;
  const userText = String(msg.text ?? '').trim();

  // Persist the user input first (mirrors chat semantics, keeps
  // `/help` visible in history).
  try {
    deps.store.appendMessage(targetSessionId, makeUserMessage(userText));
    deps.push({
      type: 'sessions:changed',
      sessionId: targetSessionId,
      kind: 'updated',
    });
    deps.push({ type: 'sessions:listed', sessions: deps.store.list() });
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
    try {
      deps.store.appendMessage(targetSessionId, makeAssistantMessage(errText));
    } catch (err) {
      log.error('failed to persist command error:', err);
    }
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
      // Any command may have mutated agent state (e.g. /<agent> switch).
      // Re-broadcast both lists so the UI catches dynamically added
      // commands and reflects the new active agent.
      deps.push({ type: 'commands', commands: deps.getCommands() });
      deps.push({
        type: 'agents',
        agents: listAgents(deps.registry),
        activeAgentId: getActiveAgentId(deps.registry),
      });

      if (result && result.trim()) {
        deps.push({
          type: 'stream',
          text: result,
          sessionId: targetSessionId,
        });
        try {
          deps.store.appendMessage(
            targetSessionId,
            makeAssistantMessage(result),
          );
        } catch (err) {
          log.error('failed to persist command result:', err);
        }
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
