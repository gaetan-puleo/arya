// Provider wrapper that routes a turn by its input modality, on the SAME WS/chat
// path (no separate transcription port). When the latest user message carries an
// AUDIO attachment, the turn is routed to the configured voice model (e.g. e2b)
// which TRANSCRIBES it — the streamed output is the transcript. The companion
// then sends that transcript as a normal text turn, which routes to the main
// chat model (e.g. 12b) for the reply. Both models stay resident in llama-swap
// (it routes by the request's `model`), so there's no model-swap cost between
// the two turns. Text/image turns pass straight through to the main model.
//
// If no voiceModel is configured we don't touch anything: the main model handles
// the audio itself when it has the capability (the adapter already drops audio
// for non-audio-capable models), otherwise it's a no-op.

import type { Message, Provider } from 'mu-core';

const STT_SYSTEM =
  'You are a speech-to-text transcriber. Transcribe the user\'s audio verbatim into plain text, ' +
  'in the language spoken. Output ONLY the transcript — no commentary, labels, quotes, or translation. ' +
  'If the audio contains no speech, output nothing.';

/** The most recent user message, or undefined. */
function lastUserMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i];
  }
  return undefined;
}

const hasAudio = (m: Message | undefined): boolean => !!m && m.content.some((c) => c.type === 'audio');

// Invisible (zero-width) marker the companion appends to a CALL-MODE reply to ask the
// chat model to skip reasoning for that one turn (Qwen3 `enable_thinking:false`). Kept
// out-of-band as zero-width so it never shows in the UI; stripped before the model sees
// it. Must match NO_THINK_MARKER in the companion's useVoiceCall.
const NO_THINK_MARKER = '\u200b\u200c\u200b';

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

export function withVoiceRouting(
  inner: Provider,
  opts: { voiceModel?: string; log?: (msg: string) => void },
): Provider {
  const { voiceModel } = opts;
  // Nothing to route to → leave the provider untouched.
  if (!voiceModel) return inner;
  const log = opts.log ?? (() => {});

  return {
    capabilities: inner.capabilities ? (model) => inner.capabilities!(model) : undefined,
    countTokens: inner.countTokens ? (t, model) => inner.countTokens!(t, model) : undefined,
    contextWindow: inner.contextWindow ? (model) => inner.contextWindow!(model) : undefined,
    async *stream(req) {
      const userMsg = lastUserMessage(req.messages);
      if (!hasAudio(userMsg)) {
        // Text turn. If the latest user message carries the call-mode marker, disable
        // reasoning for THIS turn only (fast spoken replies) and scrub the marker from
        // the prompt. Plain typed chat (no marker) keeps the model's default reasoning.
        if (textHasMarker(userMsg)) {
          log('voice: call-mode reply → enable_thinking:false for this turn');
          yield* inner.stream({
            ...req,
            messages: stripMarker(req.messages),
            chatTemplateKwargs: { enable_thinking: false },
          });
        } else {
          yield* inner.stream(req);
        }
        return;
      }

      // Audio turn → TRANSCRIBE with the voice model and stream the transcript as
      // the turn's output. The companion then sends that transcript as a normal
      // text turn (which routes here to the main model) for the actual reply.
      log('voice: routing audio turn to the voice model for transcription');
      yield* inner.stream({
        model: voiceModel,
        messages: [
          { role: 'system', content: [{ type: 'text', text: STT_SYSTEM }] },
          { role: 'user', content: userMsg!.content },
        ],
        tools: [],
        signal: req.signal,
      });
    },
  };
}
