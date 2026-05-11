/**
 * ChatMessage factories — host-side ergonomic wrappers around mu-core's
 * `ChatMessage`. Centralise the `meta` / `display` wiring so the WS
 * handlers stay readable.
 *
 * Arya stores `agentId`, `id`, `ts`, and tool args (as a string) in
 * `meta`. mu-core's `ChatMessage.toolResult` already carries structured
 * `{ name, content, error }` so we route tool data there.
 */

import type { ChatMessage, ToolResultInfo } from 'mu-core';
import { newMessageId, nowMs } from 'mu-core';

export function makeUserMessage(text: string): ChatMessage {
  return {
    role: 'user',
    content: text,
    meta: {
      id: newMessageId('user'),
      ts: nowMs(),
    },
  };
}

export interface AssistantMessageOpts {
  agentId?: string;
}

export function makeAssistantMessage(text: string, opts: AssistantMessageOpts = {}): ChatMessage {
  return {
    role: 'assistant',
    content: text,
    meta: {
      id: newMessageId('assistant'),
      ts: nowMs(),
      agentId: opts.agentId,
    },
  };
}

export interface ToolMessageInput {
  toolCallId?: string;
  toolName: string;
  /** JSON args object — pretty-printed for storage. */
  toolArgs?: Record<string, unknown>;
  /** Tool execution output (already a string). */
  toolResult: string;
  toolError?: boolean;
}

export function makeToolMessage(input: ToolMessageInput): ChatMessage {
  const toolResult: ToolResultInfo = {
    name: input.toolName,
    content: input.toolResult,
    error: input.toolError === true,
  };
  return {
    role: 'tool',
    content: '',
    toolCallId: input.toolCallId,
    toolResult,
    meta: {
      id: newMessageId('tool', input.toolCallId),
      ts: nowMs(),
      toolArgs: input.toolArgs ? JSON.stringify(input.toolArgs, null, 2) : undefined,
    },
  };
}
