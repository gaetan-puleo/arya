/**
 * Voice-call mode — hands-free, no extra screen, no Google/device speech service
 * (works on de-Googled ROMs). EARS = our own VAD over REAL PCM + the voice model;
 * BRAIN = the chat model.
 *
 *  - We record with `@siteed/expo-audio-studio` in `float32` stream mode (samples
 *    via JSI, no base64). From each PCM frame we compute RMS (drives a homemade
 *    VAD: speak → quiet for END_OF_TURN_MS → turn ends) and a peak envelope for
 *    the live waveform, AND we accumulate the raw samples ourselves.
 *  - The audio is transcribed "petit à petit" but stays SESSION-LESS: the mic is
 *    open for the whole turn and we cut the accumulated PCM into SEGMENTS (≤
 *    SEG_MAX_MS, preferably at a pause), build a 16-bit WAV in-JS for each, and
 *    send each over the chat WS as a `voice:transcribe` request (arya runs the
 *    VOICE model only — no session, no title, no persistence, no chat-model turn).
 *    Segmenting is REQUIRED: the voice endpoint drops the connection on any audio
 *    over ~128 KB of PCM (≈3 s @16 kHz), so one big blob silently fails.
 *  - We CONCATENATE the segment transcripts in order. When the VAD detects
 *    end-of-turn (real silence) we transcribe the final segment, then send the
 *    WHOLE transcript ONCE as a normal TEXT chat turn → the CHAT model (12b)
 *    answers. So the chat model is hit exactly once per turn, never interleaved
 *    with transcription. Reply is spoken via TTS if an engine exists.
 *
 * Half-duplex around the reply: the mic is stopped while thinking/speaking, then
 * a fresh listening turn starts. During listening the mic stays open even while
 * earlier segments are still transcribing (capture never blocks on the network).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import * as Speech from "expo-speech";
import { requestRecordingPermissionsAsync } from "expo-audio";
import { useAudioRecorder, type AudioDataEvent } from "@siteed/expo-audio-studio";
import { type SharedValue, useSharedValue } from "react-native-reanimated";

import * as arya from "@/services/aryaClient";
import { newSessionId } from "@/services/optimistic";
import { transcribeAudio } from "@/services/voiceTranscribe";
import { vadFeed, vadLoad, vadReset, vadStats } from "@/services/vad";
import { useStore } from "@/state/store";

const END_OF_TURN_MS = 1100; // quiet (after speech) that ends the WHOLE turn
const SAMPLE_RATE = 16000; // STT-standard rate, sent to the voice model AS-IS. 16k (not 48k) keeps each segment WAV small: the voice endpoint drops the connection on audio over ~128KB of PCM (≈3s @16k, but only ≈1s @48k).
const CHUNK_MS = 16; // PCM emit cadence ≈ 60fps → lowest visual latency (float32 path is cheap)
const BUFFER_SEC = 0.01; // push native capture buffer to the floor → minimal capture latency
const SPEECH_RMS = 0.015; // FALLBACK-only RMS gate (used if the DSP VAD fails to init). Tuned to a quiet room: voice ≈0.02–0.05, silence ≈0.001–0.01 — but loud ambient noise also clears it, which is exactly why the DSP VAD exists.
// DSP VAD speech-score thresholds, with hysteresis so brief dips between words
// don't flip us out of speech. Score is ≈0.5 at the detection boundary (see vad.ts).
const VAD_ENTER = 0.5; // score above this STARTS counting speech
const VAD_EXIT = 0.35; // once speaking, stay voiced until score drops below this
// Segmenting (keeps every WAV well under the ~128 KB voice-endpoint limit).
const SEG_MAX_MS = 2500; // hard cap per segment (≈80 KB PCM @16k → ~107 KB base64, safely under the wall)
const SEG_SOFT_MS = 1600; // once this much is buffered, cut at the next pause (cleaner word boundaries)
const SEG_MIN_VOICED_MS = 180; // never transcribe a segment with less voiced audio than this (skip pure silence)
// Wave shaping. Voice PCM is quiet (peaks ~0.1–0.3) so a linear map stays flat:
// a perceptual power curve lifts low levels, then a gain fills the height.
const WAVE_NOISE_FLOOR = 0.04; // per-bar peak below this = silence → 0 (kills the always-full wave)
const WAVE_GAIN = 2.4; // sensitivity of the wave (higher → taller bars)
const WAVE_EXP = 0.5; // perceptual curve exponent for the wave (lower → boosts quiet sounds more)
const WAVE_DECAY = 0.82; // per-bar release: fast attack, slow decay → the live wave shape is lively, not jittery
const MIN_VOICED_MS = 280; // ignore turns shorter than this (clicks/noise)
const MAX_TURN_MS = 30000; // safety cap on a single turn
const WAVE_BARS = 28; // points across the live wave (envelope of the current chunk)
// Invisible (zero-width) marker appended to the CALL-MODE reply text so arya disables
// the chat model's reasoning for that turn only (fast spoken replies). Typed chat has no
// marker → normal reasoning. Zero-width → never visible in the bubble. Must match
// NO_THINK_MARKER in arya's voice-routing.ts.
const NO_THINK_MARKER = "\u200b\u200c\u200b";

export type CallPhase = "off" | "listening" | "thinking" | "speaking";

export interface VoiceCall {
	active: boolean;
	phase: CallPhase;
	partial: string;
	/** Scrolling amplitude history (0..1, oldest → newest) driving the wave bars. */
	waveform: SharedValue<number[]>;
	start: () => void;
	end: () => void;
}

function speakable(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " code block ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_~#>]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function lastSentenceEnd(text: string): number {
	const m = text.match(/[\s\S]*[.!?…\n]/);
	return m ? m[0].length : 0;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		p,
		new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
	]);
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64-encode raw bytes without relying on btoa (Hermes may lack it). */
function bytesToBase64(bytes: Uint8Array): string {
	let out = "";
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
		out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
	}
	const rem = bytes.length - i;
	if (rem === 1) {
		const n = bytes[i] << 16;
		out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + "==";
	} else if (rem === 2) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
		out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + "=";
	}
	return out;
}

/** Build a 16-bit mono PCM WAV (base64) from float32 sample chunks in [-1,1]. */
function encodeWavBase64(chunks: Float32Array[], count: number, sampleRate: number): string {
	const dataBytes = count * 2;
	const buf = new ArrayBuffer(44 + dataBytes);
	const dv = new DataView(buf);
	const wStr = (off: number, s: string) => {
		for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
	};
	wStr(0, "RIFF");
	dv.setUint32(4, 36 + dataBytes, true);
	wStr(8, "WAVE");
	wStr(12, "fmt ");
	dv.setUint32(16, 16, true); // PCM fmt chunk size
	dv.setUint16(20, 1, true); // PCM
	dv.setUint16(22, 1, true); // mono
	dv.setUint32(24, sampleRate, true);
	dv.setUint32(28, sampleRate * 2, true); // byte rate (mono 16-bit)
	dv.setUint16(32, 2, true); // block align
	dv.setUint16(34, 16, true); // bits per sample
	wStr(36, "data");
	dv.setUint32(40, dataBytes, true);
	let off = 44;
	for (const c of chunks) {
		for (let i = 0; i < c.length; i++) {
			let s = c[i];
			if (s > 1) s = 1;
			else if (s < -1) s = -1;
			dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
			off += 2;
		}
	}
	return bytesToBase64(new Uint8Array(buf));
}

/** Float32 samples in [-1,1] from a float32 frame or a base64 16-bit-LE PCM string. */
function toFloat32(data: ArrayLike<number> | string): Float32Array {
	if (typeof data === "string") {
		const bin = atob(data);
		const n = (bin.length / 2) | 0;
		const out = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			let v = (bin.charCodeAt(i * 2 + 1) << 8) | bin.charCodeAt(i * 2);
			if (v >= 32768) v -= 65536;
			out[i] = v / 32768;
		}
		return out;
	}
	return data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>);
}

/** RMS (for VAD) + a WAVE_BARS-point peak envelope (the live wave shape) from a frame. */
function analyze(samples: Float32Array): { rms: number; buckets: number[] } {
	const n = samples.length;
	const buckets = new Array(WAVE_BARS).fill(0);
	if (n === 0) return { rms: 0, buckets };
	const per = Math.max(1, Math.floor(n / WAVE_BARS));
	let sumSq = 0;
	for (let i = 0; i < n; i++) {
		const f = samples[i];
		sumSq += f * f;
		const a = f < 0 ? -f : f;
		const b = Math.min(WAVE_BARS - 1, (i / per) | 0);
		if (a > buckets[b]) buckets[b] = a;
	}
	return { rms: Math.sqrt(sumSq / n), buckets };
}

export function useVoiceCall(): VoiceCall {
	const [active, setActive] = useState(false);
	const [phase, setPhaseState] = useState<CallPhase>("off");
	const [partial, setPartial] = useState("");
	// Live wave: the peak envelope of the CURRENT chunk (the real sound shape).
	const waveform = useSharedValue<number[]>(new Array(WAVE_BARS).fill(0));
	const waveDecayRef = useRef<number[]>(new Array(WAVE_BARS).fill(0));
	const dbgRef = useRef(0); // throttle counter for debug logging

	const { startRecording, stopRecording } = useAudioRecorder();

	const activeRef = useRef(false);
	const phaseRef = useRef<CallPhase>("off");
	const sidRef = useRef<string | null>(null);
	const recordingRef = useRef(false);

	// VAD state (per turn).
	const turnStartRef = useRef(0);
	const lastVoiceAtRef = useRef(0);
	const voicedMsRef = useRef(0);
	// DSP VAD: whether it initialised, the latest frame's speech score, and the
	// hysteresis latch (are we currently inside a speech run?).
	const vadReadyRef = useRef(false);
	const vadProbRef = useRef(0);
	const vadSpeakingRef = useRef(false);
	const prevVoicedRef = useRef(false); // for edge-logging voiced transitions

	// Current (unsent) segment accumulator.
	const segChunksRef = useRef<Float32Array[]>([]);
	const segCountRef = useRef(0); // samples accumulated
	const segVoicedMsRef = useRef(0); // voiced ms in the current accumulator

	// Segment transcription pipeline (serialized: one voice:transcribe in flight).
	const segQueueRef = useRef<{ chunks: Float32Array[]; count: number }[]>([]);
	const transcribingRef = useRef(false); // a voice:transcribe request is in flight
	const turnEndedRef = useRef(false); // VAD ended this turn → drain queue then reply
	const transcriptRef = useRef(""); // accumulated transcript across this turn's segments

	// Reply (chat-model turn) + TTS tracking.
	const replyingRef = useRef(false); // the chat reply turn is in flight
	const ttsAvailableRef = useRef(false);
	const spokenLenRef = useRef(0);
	const replyTextRef = useRef("");
	const replyDoneRef = useRef(false);
	const pendingTtsRef = useRef(0);

	const setPhase = useCallback((p: CallPhase) => {
		phaseRef.current = p;
		setPhaseState(p);
	}, []);

	const ensureSession = useCallback((): string => {
		let sid = useStore.getState().currentSessionId;
		if (!sid) {
			sid = newSessionId();
			arya.createSession(sid);
			arya.selectSession(sid);
		}
		sidRef.current = sid;
		return sid;
	}, []);

	const resetWaveform = useCallback(() => {
		waveDecayRef.current = new Array(WAVE_BARS).fill(0);
		waveform.value = new Array(WAVE_BARS).fill(0);
	}, [waveform]);

	// Move the current accumulator into the transcription queue (if it holds enough voice).
	const cutSegment = useCallback(() => {
		if (segVoicedMsRef.current < SEG_MIN_VOICED_MS || segCountRef.current === 0) {
			segChunksRef.current = [];
			segCountRef.current = 0;
			segVoicedMsRef.current = 0;
			return;
		}
		segQueueRef.current.push({ chunks: segChunksRef.current, count: segCountRef.current });
		segChunksRef.current = [];
		segCountRef.current = 0;
		segVoicedMsRef.current = 0;
	}, []);

	const finalizeTurnRef = useRef<() => void>(() => {});

	// Transcribe the next queued segment (session-less), or finalize the turn when
	// the queue drains. Serialized so transcripts concatenate in spoken order.
	const pumpSegments = useCallback(() => {
		if (!activeRef.current || transcribingRef.current) return;
		const next = segQueueRef.current.shift();
		if (!next) {
			if (turnEndedRef.current) finalizeTurnRef.current();
			return;
		}
		transcribingRef.current = true;
		const data = encodeWavBase64(next.chunks, next.count, SAMPLE_RATE);
		console.log(`[voice] transcribe segment samples=${next.count} (~${(next.count / SAMPLE_RATE).toFixed(1)}s)`);
		transcribeAudio("audio/wav", data)
			.then((text) => {
				const t = text.trim();
				if (t) transcriptRef.current = transcriptRef.current ? `${transcriptRef.current} ${t}` : t;
				console.log(`[voice] segment → ${JSON.stringify(t)} | total=${JSON.stringify(transcriptRef.current)}`);
				if (transcriptRef.current) setPartial(transcriptRef.current);
			})
			.catch((err) => {
				console.warn("[voice] transcribe failed:", err?.message ?? err);
			})
			.finally(() => {
				transcribingRef.current = false;
				if (activeRef.current) pumpSegmentsRef.current();
			});
	}, [setPartial]);
	const pumpSegmentsRef = useRef(pumpSegments);
	pumpSegmentsRef.current = pumpSegments;

	const stopMic = useCallback(async () => {
		if (recordingRef.current) {
			recordingRef.current = false;
			await stopRecording().catch(() => {});
		}
	}, [stopRecording]);

	// VAD said the turn is over: flush the last segment and start draining → reply.
	const endTurn = useCallback(() => {
		if (turnEndedRef.current) return;
		turnEndedRef.current = true;
		setPhase("thinking");
		resetWaveform();
		void stopMic();
		cutSegment(); // queue whatever speech is left in the accumulator
		pumpSegmentsRef.current();
	}, [cutSegment, resetWaveform, setPhase, stopMic]);
	const endTurnRef = useRef(endTurn);
	endTurnRef.current = endTurn;

	// Stable PCM handler (reads refs/shared values so it never goes stale).
	const onChunk = useCallback(
		async (event: AudioDataEvent): Promise<void> => {
			if (!activeRef.current || phaseRef.current !== "listening") return;
			const raw = event.data;
			if (!raw) return;
			const samples = toFloat32(raw as ArrayLike<number> | string);
			if (samples.length === 0) return;
			const { rms, buckets } = analyze(samples);

			// Feed the JS VAD (synchronous): band-pass + adaptive noise floor + ZCR → score.
			if (vadReadyRef.current) {
				vadProbRef.current = vadFeed(samples);
			}

			// Voice decision — drives BOTH turn-taking and the wave. DSP VAD score with
			// hysteresis when it's up; legacy RMS gate only as a fallback.
			let voiced: boolean;
			if (vadReadyRef.current) {
				const p = vadProbRef.current;
				voiced = vadSpeakingRef.current ? p > VAD_EXIT : p > VAD_ENTER;
				vadSpeakingRef.current = voiced;
			} else {
				voiced = rms > SPEECH_RMS;
			}
			// Edge-log every voiced transition (not throttled) — makes speech on/offset
			// unambiguous regardless of the periodic debug line's sampling.
			if (voiced !== prevVoicedRef.current) {
				prevVoicedRef.current = voiced;
				console.log(
					`[voice] ${voiced ? "VOICED↑" : "silence↓"} vad=${vadProbRef.current.toFixed(2)} band=${vadStats.bandRms.toFixed(4)} thr=${vadStats.threshold.toFixed(4)} zcr=${vadStats.zcr.toFixed(2)}`,
				);
			}

			// Live wave: shape each bar + per-bar peak-decay (fast attack / slow release).
			// Gated by `voiced`, so loud ambient noise no longer fills the wave outdoors —
			// with no detected voice the bars just decay to silence.
			const decay = waveDecayRef.current;
			const shape = new Array(WAVE_BARS);
			for (let i = 0; i < WAVE_BARS; i++) {
				const lvl = voiced ? Math.max(0, buckets[i] - WAVE_NOISE_FLOOR) : 0;
				const v = lvl > 0 ? Math.min(1, Math.pow(lvl, WAVE_EXP) * WAVE_GAIN) : 0;
				decay[i] = Math.max(v, decay[i] * WAVE_DECAY);
				shape[i] = decay[i];
			}
			waveform.value = shape;

			// Accumulate the raw PCM (copy — the native frame buffer may be reused).
			segChunksRef.current.push(new Float32Array(samples));
			segCountRef.current += samples.length;

			const chunkMs = (samples.length / SAMPLE_RATE) * 1000;
			const now = Date.now();
			if (voiced) {
				voicedMsRef.current += chunkMs;
				segVoicedMsRef.current += chunkMs;
				lastVoiceAtRef.current = now;
			}

			const segMs = (segCountRef.current / SAMPLE_RATE) * 1000;
			const hasSpoken = voicedMsRef.current >= MIN_VOICED_MS;
			const silence = lastVoiceAtRef.current ? now - lastVoiceAtRef.current : 0;
			dbgRef.current = (dbgRef.current + 1) % 25;
			if (dbgRef.current === 0) {
				console.log(
					`[voice] vad=${vadProbRef.current.toFixed(2)} band=${vadStats.bandRms.toFixed(4)} floor=${vadStats.floor.toFixed(4)} thr=${vadStats.threshold.toFixed(4)} zcr=${vadStats.zcr.toFixed(2)} rms=${rms.toFixed(3)} voiced=${voiced} voicedMs=${voicedMsRef.current | 0} silence=${silence | 0}`,
				);
			}
			// Segment cut: hard cap on length, or at a pause once the soft size is reached.
			if (segMs >= SEG_MAX_MS || (segMs >= SEG_SOFT_MS && !voiced)) {
				cutSegment();
				pumpSegmentsRef.current();
			}

			// End-of-turn: real silence after enough speech (or the safety cap).
			if (hasSpoken && (silence > END_OF_TURN_MS || now - turnStartRef.current > MAX_TURN_MS)) {
				console.log(`[voice] END OF TURN voicedMs=${voicedMsRef.current | 0} silence=${silence | 0}`);
				endTurnRef.current();
			}
		},
		[cutSegment, waveform],
	);

	// Begin a fresh listening turn: reset VAD/segment/TTS state, open the mic.
	const beginListeningTurn = useCallback(() => {
		if (!activeRef.current) return;
		voicedMsRef.current = 0;
		lastVoiceAtRef.current = 0;
		turnStartRef.current = Date.now();
		if (vadReadyRef.current) vadReset(); // clear the DSP filter state for the new turn
		vadProbRef.current = 0;
		vadSpeakingRef.current = false;
		prevVoicedRef.current = false;
		segChunksRef.current = [];
		segCountRef.current = 0;
		segVoicedMsRef.current = 0;
		segQueueRef.current = [];
		transcribingRef.current = false;
		turnEndedRef.current = false;
		transcriptRef.current = "";
		replyingRef.current = false;
		spokenLenRef.current = 0;
		replyTextRef.current = "";
		replyDoneRef.current = false;
		pendingTtsRef.current = 0;
		setPartial("");
		setPhase("listening");
		resetWaveform();

		void (async () => {
			try {
				if (recordingRef.current) {
					await stopRecording().catch(() => {});
					recordingRef.current = false;
				}
				await startRecording({
					sampleRate: SAMPLE_RATE,
					channels: 1,
					encoding: "pcm_16bit",
					streamFormat: "float32", // samples via JSI → no base64 on the JS thread
					bufferDurationSeconds: BUFFER_SEC,
					interval: CHUNK_MS,
					onAudioStream: onChunk,
				});
				recordingRef.current = true;
				console.log(`[voice] listening turn started @${SAMPLE_RATE}Hz`);
			} catch (err) {
				console.warn("[voice] startRecording failed:", err);
			}
		})();
	}, [onChunk, resetWaveform, setPhase, startRecording, stopRecording]);
	const beginListeningTurnRef = useRef(beginListeningTurn);
	beginListeningTurnRef.current = beginListeningTurn;

	const maybeResume = useCallback(() => {
		if (
			activeRef.current &&
			replyDoneRef.current &&
			pendingTtsRef.current === 0 &&
			!transcribingRef.current &&
			segQueueRef.current.length === 0
		) {
			beginListeningTurnRef.current();
		}
	}, []);
	const maybeResumeRef = useRef(maybeResume);
	maybeResumeRef.current = maybeResume;

	const enqueueSpeech = useCallback((chunk: string) => {
		if (phaseRef.current === "thinking") setPhase("speaking");
		if (!ttsAvailableRef.current) return;
		const text = speakable(chunk);
		if (!text) return;
		pendingTtsRef.current += 1;
		const settle = () => {
			pendingTtsRef.current = Math.max(0, pendingTtsRef.current - 1);
			maybeResumeRef.current();
		};
		Speech.speak(text, { onDone: settle, onStopped: settle, onError: settle });
	}, [setPhase]);

	// End-of-turn reached and all segments transcribed → send the whole message ONCE.
	const finalizeTurn = useCallback(() => {
		// Consume the end-of-turn signal so a stray pump can't finalize twice. We only
		// reach here once every queued segment has been transcribed (pumpSegments calls
		// us only when the queue is empty AND nothing is in flight), so the transcript
		// is complete — the whole message is sent in one shot.
		turnEndedRef.current = false;
		const transcript = transcriptRef.current.trim();
		setPartial(transcript);
		console.log(`[voice] FINALIZE transcript=${JSON.stringify(transcript)}`);
		if (!transcript) {
			beginListeningTurnRef.current(); // nothing heard → listen again
			return;
		}
		const sid = sidRef.current ?? ensureSession();
		replyingRef.current = true;
		replyDoneRef.current = false;
		spokenLenRef.current = 0;
		replyTextRef.current = "";
		setPhase("thinking");
		// Append the (invisible) call-mode marker → arya disables reasoning for this turn
		// only, so the spoken reply comes fast. The marker is zero-width (not shown).
		arya.sendChat(sid, transcript + NO_THINK_MARKER); // normal, visible chat turn → chat model replies
	}, [ensureSession, setPhase]);
	finalizeTurnRef.current = finalizeTurn;

	// Speak + caption the streamed reply (the only thing that streams over the session).
	const placeholders = useStore((s) => s.streamingPlaceholders);
	useEffect(() => {
		if (!activeRef.current || !replyingRef.current) return;
		const sid = sidRef.current;
		if (!sid) return;
		const text = placeholders.get(sid);
		if (typeof text === "string") {
			replyTextRef.current = text;
			setPartial(text);
			const end = lastSentenceEnd(text);
			if (end > spokenLenRef.current) {
				enqueueSpeech(text.slice(spokenLenRef.current, end));
				spokenLenRef.current = end;
			}
		} else {
			// Placeholder cleared → reply turn ended. Speak the tail, then resume.
			replyingRef.current = false;
			const full = replyTextRef.current;
			if (full.length > spokenLenRef.current) {
				enqueueSpeech(full.slice(spokenLenRef.current));
				spokenLenRef.current = full.length;
			}
			replyDoneRef.current = true;
			maybeResumeRef.current();
		}
	}, [placeholders, enqueueSpeech]);

	const start = useCallback(() => {
		void (async () => {
			const perm = await requestRecordingPermissionsAsync().catch(() => ({ granted: false }));
			if (!perm.granted) {
				Alert.alert("Microphone needed", "Allow microphone access to use voice calls.");
				return;
			}
			ensureSession();
			// Load the neural VAD model (once). On failure vadReadyRef stays false and
			// onChunk transparently falls back to the RMS gate.
			vadReadyRef.current = await vadLoad();
			ttsAvailableRef.current = false;
			void withTimeout(Speech.getAvailableVoicesAsync(), 1200)
				.then((v) => {
					ttsAvailableRef.current = Array.isArray(v) && v.length > 0;
				})
				.catch(() => {
					ttsAvailableRef.current = false;
				});

			activeRef.current = true;
			setActive(true);
			beginListeningTurnRef.current();
		})();
	}, [ensureSession]);

	const end = useCallback(() => {
		activeRef.current = false;
		setActive(false);
		setPhase("off");
		setPartial("");
		resetWaveform();
		segChunksRef.current = [];
		segCountRef.current = 0;
		segQueueRef.current = [];
		transcribingRef.current = false;
		turnEndedRef.current = false;
		transcriptRef.current = "";
		replyingRef.current = false;
		pendingTtsRef.current = 0;
		if (recordingRef.current) {
			recordingRef.current = false;
			stopRecording().catch(() => {});
		}
		Speech.stop();
	}, [resetWaveform, setPhase, stopRecording]);

	useEffect(() => {
		return () => {
			if (activeRef.current) {
				activeRef.current = false;
				if (recordingRef.current) stopRecording().catch(() => {});
				Speech.stop();
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return { active, phase, partial, waveform, start, end };
}
