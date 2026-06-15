/**
 * Session-less voice transcription over the chat WS.
 *
 * `transcribeAudio()` sends a `voice:transcribe` frame and resolves when the
 * matching `voice:result` (or rejects on `voice:error`) comes back, correlated
 * by `requestId`. arya handles it with `harness.voice.transcribe` — the voice
 * model only, NO session (no title, no persistence, no chat-model turn). The
 * caller (useVoiceCall) feeds one audio segment at a time and concatenates the
 * results, then sends the whole transcript as a normal chat turn to the chat
 * model. wireDispatch routes the responses here via resolve/reject.
 */

import { send } from "@/services/outbound";

interface Pending {
	resolve: (text: string) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();
let seq = 0;

/** Transcribe one audio blob (base64). Resolves with the transcript text. */
export function transcribeAudio(mime: string, data: string, timeoutMs = 120_000): Promise<string> {
	const requestId = `vtr_${Date.now().toString(36)}_${seq++}`;
	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(requestId);
			reject(new Error("voice transcription timed out"));
		}, timeoutMs);
		pending.set(requestId, { resolve, reject, timer });
		if (!send({ type: "voice:transcribe", requestId, mime, data })) {
			clearTimeout(timer);
			pending.delete(requestId);
			reject(new Error("not connected"));
		}
	});
}

export function resolveTranscription(requestId: string, text: string): void {
	const p = pending.get(requestId);
	if (!p) return;
	clearTimeout(p.timer);
	pending.delete(requestId);
	p.resolve(text);
}

export function rejectTranscription(requestId: string, message: string): void {
	const p = pending.get(requestId);
	if (!p) return;
	clearTimeout(p.timer);
	pending.delete(requestId);
	p.reject(new Error(message));
}
