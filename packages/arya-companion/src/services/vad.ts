/**
 * Pure-JS voice-activity detection over the live PCM stream — no native module.
 *
 * Replaces the old fixed-RMS gate (`rms > 0.015`), which read any loud ambient
 * noise as speech, so outdoors the turn never ended and the wave stayed full.
 * (The neural Silero/ONNX route is blocked: onnxruntime-react-native doesn't work
 * under the New Architecture the companion is locked into — see memory
 * companion-onnx-newarch-blocker.) This DSP approach instead distinguishes a
 * *voice* from loud noise with three cheap, FFT-free signals:
 *
 *  1. Band-pass 300–3500 Hz (telephone speech band) via one-pole high-pass +
 *     low-pass IIR. Kills wind / handling / AC rumble (<300 Hz) and hiss
 *     (>3500 Hz) — the stuff a raw-loudness gate can't tell from a voice.
 *  2. Adaptive noise floor: track the band-passed level of the *background* and
 *     require speech to exceed floor × MARGIN. Adapts to a quiet room or a noisy
 *     street instead of a single hard-coded threshold.
 *  3. Zero-crossing reject: drop frames whose band-passed ZCR is near Nyquist
 *     (pure hiss), which can sneak through on level alone.
 *
 * vadFeed() is synchronous and returns a 0..1 score; the caller applies its own
 * enter/exit hysteresis (VAD_ENTER / VAD_EXIT). vadLoad()/vadReset() are kept for
 * interface parity with the old neural module (vadLoad is now a no-op that always
 * succeeds). Filter state is continuous across frames; vadReset() clears it at the
 * start of each listening turn but keeps the learned noise floor between turns.
 */

// One-pole IIR coefficients @16 kHz. HP ~300 Hz, LP ~3500 Hz (see derivations in
// the module doc): band-pass ≈ the 300–3500 Hz speech band.
const HP_ALPHA = 0.89; // high-pass: y = α·(y_prev + x − x_prev)
const LP_BETA = 0.58; // low-pass:  y = y_prev + β·(x − y_prev)

const MARGIN = 2.5; // speech must exceed noiseFloor × MARGIN
const MIN_FLOOR = 0.005; // absolute floor for the (band-passed) threshold in a dead-silent room
const ALPHA_UP = 0.02; // noise-floor rise rate (slow — don't let speech inflate it)
const ALPHA_DOWN = 0.1; // noise-floor fall rate (faster — recover quickly when noise drops)
const ZCR_REJECT = 0.45; // band-passed zero-crossing rate above this ⇒ hiss, not voice

// Continuous filter state (carried across frames).
let xPrev = 0;
let yHp = 0;
let yLp = 0;
// Learned background level + a latch used only to gate floor updates.
let noiseFloor = MIN_FLOOR;
let floorVoiced = false;

/** Last-frame internals, for on-device tuning via the [voice] debug log. */
export const vadStats = { bandRms: 0, floor: MIN_FLOOR, threshold: MIN_FLOOR, zcr: 0, score: 0 };

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** No-op load (kept for parity with the old neural module). Always ready. */
export async function vadLoad(): Promise<boolean> {
	vadReset();
	return true;
}

/** Clear per-turn filter state; keep the learned noise floor between turns. */
export function vadReset(): void {
	xPrev = 0;
	yHp = 0;
	yLp = 0;
	floorVoiced = false;
}

/**
 * Feed a PCM frame (float32 [-1,1] @16 kHz) and return a 0..1 speech score
 * (≈0.5 at the detection boundary, ≥1 well above it). Band-passes the frame,
 * compares its level to the adaptive noise floor, and rejects hiss via ZCR.
 */
export function vadFeed(samples: Float32Array): number {
	const n = samples.length;
	if (n === 0) return 0;

	let bandSumSq = 0;
	let crossings = 0;
	let prevBand = yLp;
	for (let i = 0; i < n; i++) {
		const x = samples[i];
		// High-pass (removes DC / sub-300 Hz rumble), then low-pass (removes >3.5 kHz).
		yHp = HP_ALPHA * (yHp + x - xPrev);
		xPrev = x;
		yLp = yLp + LP_BETA * (yHp - yLp);
		const b = yLp;
		bandSumSq += b * b;
		if ((b >= 0) !== (prevBand >= 0)) crossings++;
		prevBand = b;
	}
	const bandRms = Math.sqrt(bandSumSq / n);
	const zcr = crossings / n;

	const threshold = Math.max(MIN_FLOOR, noiseFloor * MARGIN);
	const ratio = bandRms / threshold;

	// Hysteresis latch (internal) — only to decide whether this frame is background
	// we should learn from. Don't adapt the floor toward speech.
	floorVoiced = floorVoiced ? ratio > 0.7 : ratio > 1.0;
	if (!floorVoiced) {
		const rate = bandRms > noiseFloor ? ALPHA_UP : ALPHA_DOWN;
		noiseFloor += rate * (bandRms - noiseFloor);
	}

	// Map ratio→score so ratio 1.0 ⇒ 0.5 (VAD_ENTER), 0.7 ⇒ 0.35 (VAD_EXIT), ≥2 ⇒ 1.
	const score = zcr > ZCR_REJECT ? 0 : clamp01(ratio * 0.5); // near-Nyquist hiss ⇒ not a voice
	vadStats.bandRms = bandRms;
	vadStats.floor = noiseFloor;
	vadStats.threshold = threshold;
	vadStats.zcr = zcr;
	vadStats.score = score;
	return score;
}
