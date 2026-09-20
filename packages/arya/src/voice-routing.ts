// Provider wrapper for CALL-MODE replies — RETROCOMPAT path only.
//
// Current companions signal call mode with the `thinking:'off'` field on the chat
// frame, handled natively in arya-core (ws/server.ts → enable_thinking:false).
// Older companion builds (pre-`thinking` field) instead appended an invisible
// zero-width marker to the transcribed turn. This wrapper keeps those old clients
// working: it strips the marker before the model sees it and sets
// `enable_thinking:false` for that turn only. Plain typed chat (no marker, no
// `thinking` field) keeps the model's default reasoning.
//
// Transcription itself is NOT handled here: call mode records audio and transcribes it
// through the session-less `voice:transcribe` endpoint (harness.voice), then sends the
// resulting text as a normal chat turn. So this wrapper only ever sees text.

import type { Message, Provider } from 'mu-core';

// Legacy zero-width marker appended by OLD companion builds to request a no-reasoning
// turn (Qwen3 `enable_thinking:false`). Kept out-of-band as zero-width so it never
// shows in the UI; stripped before the model sees it. New clients use the
// `thinking:'off'` frame field instead — this path exists only for phones we can't
// force-update. Safe to drop once no such build remains in the wild.
const NO_THINK_MARKER = '\u200b\u200c\u200b';

/** The most recent user message, or undefined. */
function lastUserMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i];
  }
  return undefined;
}

const textHasMarker = (m: Message | undefined): boolean =>
  !!m && m.content.some((c) => c.type === 'text' && c.text.includes(NO_THINK_MARKER));

/** Remove the marker from every text part so the model never receives it. */
const stripMarker = (messages: Message[]): Message[] =>
  messages.map((m) => ({
    ...m,
    content: m.content.map((c) =>
      c.type === 'text' && c.text.includes(NO_THINK_MARKER)
        ? { ...c, text: c.text.split(NO_THINK_MARKER).join('').trim() }
        : c
    ),
  }));

export function withCallModeReasoning(
  inner: Provider,
  opts: { log?: (msg: string) => void } = {},
): Provider {
  const log = opts.log ?? (() => {});
  return {
    ...inner,
    async *stream(req) {
      // Call-mode turn (carries the zero-width marker): disable reasoning for THIS turn
      // only and scrub the marker from the prompt. Everything else passes straight through.
      if (textHasMarker(lastUserMessage(req.messages))) {
        log('voice: call-mode reply → enable_thinking:false for this turn');
        yield* inner.stream({
          ...req,
          messages: stripMarker(req.messages),
          chatTemplateKwargs: { enable_thinking: false },
        });
        return;
      }
      yield* inner.stream(req);
    },
  };
}
