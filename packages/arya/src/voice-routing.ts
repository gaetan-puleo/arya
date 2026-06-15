// Provider wrapper for CALL-MODE replies. The companion's voice call mode appends an
// invisible (zero-width) marker to its transcribed turn so the chat model skips
// reasoning for that one turn (fast spoken replies). This wrapper strips the marker
// before the model sees it and sets `enable_thinking:false` for that turn only. Plain
// typed chat (no marker) keeps the model's default reasoning.
//
// Transcription itself is NOT handled here: call mode records audio and transcribes it
// through the session-less `voice:transcribe` endpoint (harness.voice), then sends the
// resulting text as a normal chat turn. So this wrapper only ever sees text.

import type { Message, Provider } from 'mu-core';

// Invisible (zero-width) marker the companion appends to a CALL-MODE reply to ask the
// chat model to skip reasoning for that one turn (Qwen3 `enable_thinking:false`). Kept
// out-of-band as zero-width so it never shows in the UI; stripped before the model sees
// it. Must match NO_THINK_MARKER in the companion's useVoiceCall.
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
