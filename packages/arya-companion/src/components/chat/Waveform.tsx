/**
 * Siri-style voice waveform on a Skia GPU canvas. Three thin COLOURED sine lines
 * (cyan / pink / green) flow around the centre at opposite speeds and swell with
 * your voice, and a white REAL-audio wave (the live PCM envelope) sits on top,
 * mirrored about the centre axis for symmetry.
 *
 * Everything is drawn in ONE GPU canvas: each line/path is rebuilt in a
 * reanimated worklet (the colour lines flow off a looping `clock`; the white
 * wave reacts to the `waveform` shared value). Skia draws it on the UI/GPU
 * thread, so the flowing animation that used to jank under react-native-svg is
 * now cheap.
 */

import { useEffect } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Canvas, Path, Skia, type SkPath } from "@shopify/react-native-skia";
import {
	Easing,
	type SharedValue,
	useDerivedValue,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";

const PILL_H = 56;
const CY = PILL_H / 2;
const MAX_AMP = 18; // peak excursion (px) at full level
const LINE_PTS = 48; // points per colour line (smoothness)
const IDLE_FLOOR = 0.18; // colour-line amplitude kept when silent
const TWO_PI = Math.PI * 2;

interface LineCfg {
	color: string;
	opacity: number;
	amp: number;
	freq: number;
	speed: number;
	stroke: number;
}

/** Thin coloured Siri lines around the white wave (opposite speeds/freqs). */
const LINES: LineCfg[] = [
	{ color: "#5AC8FA", opacity: 0.85, amp: 1.0, freq: 1.8, speed: -1.25, stroke: 2 },
	{ color: "#FF375F", opacity: 0.8, amp: 0.8, freq: 2.3, speed: 0.85, stroke: 2 },
	{ color: "#30D158", opacity: 0.75, amp: 0.62, freq: 2.8, speed: -0.6, stroke: 1.8 },
];

const WAVE_MIN = 0.8; // min half-thickness so the white wave is a thin line in silence
const WAVE_MAX = 24; // peak half-height (px) of the white wave at full level

function SiriLine({
	cfg,
	width,
	clock,
	level,
}: {
	cfg: LineCfg;
	width: SharedValue<number>;
	clock: SharedValue<number>;
	level: SharedValue<number>;
}) {
	const path = useDerivedValue<SkPath>(() => {
		const w = width.value;
		const p = Skia.Path.Make();
		if (w <= 0) return p;
		const energy = level.value * (1 - IDLE_FLOOR) + IDLE_FLOOR;
		const A = MAX_AMP * cfg.amp * energy;
		const ph = clock.value * cfg.speed;
		p.moveTo(0, CY);
		for (let i = 1; i <= LINE_PTS; i++) {
			const t = i / LINE_PTS;
			// sin(π·t) tapers the ends to the centre → symmetric, anchored line.
			const y = CY + A * Math.sin(Math.PI * t) * Math.sin(ph + t * cfg.freq * TWO_PI);
			p.lineTo(t * w, y);
		}
		return p;
	});

	return (
		<Path
			path={path}
			style="stroke"
			strokeWidth={cfg.stroke}
			strokeCap="round"
			strokeJoin="round"
			color={cfg.color}
			opacity={cfg.opacity}
		/>
	);
}

/** White live wave: a smooth mirrored area from the current sound's peak envelope. */
function WhiteWave({ width, waveform }: { width: SharedValue<number>; waveform: SharedValue<number[]> }) {
	const path = useDerivedValue<SkPath>(() => {
		const w = width.value;
		const arr = waveform.value;
		const n = arr.length;
		const p = Skia.Path.Make();
		if (w <= 0 || n < 2) return p;
		const dx = w / (n - 1);
		const half = (i: number) => Math.max(WAVE_MIN, arr[i] * WAVE_MAX);
		// Mirrored ribbon: top edge left→right, bottom edge right→left, closed.
		p.moveTo(0, CY - half(0));
		for (let i = 1; i < n; i++) p.lineTo(i * dx, CY - half(i));
		for (let i = n - 1; i >= 0; i--) p.lineTo(i * dx, CY + half(i));
		p.close();
		return p;
	});

	return <Path path={path} style="fill" color="#ffffff" opacity={0.95} />;
}

export default function Waveform({
	waveform,
}: {
	waveform: SharedValue<number[]>;
	/** Accent colour unused — fixed Siri palette + white wave. */
	color?: string;
}) {
	const width = useSharedValue(0);
	const clock = useSharedValue(0);

	useEffect(() => {
		clock.value = withRepeat(withTiming(TWO_PI, { duration: 3000, easing: Easing.linear }), -1, false);
	}, [clock]);

	// Voice level driving the colour-line swell = current peak across the wave (0..1).
	const level = useDerivedValue(() => {
		const arr = waveform.value;
		let m = 0;
		for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
		return m;
	});

	const onLayout = (e: LayoutChangeEvent) => {
		width.value = e.nativeEvent.layout.width;
	};

	return (
		<View
			onLayout={onLayout}
			className="rounded-pill overflow-hidden"
			style={{ height: PILL_H, backgroundColor: "#000" }}
		>
			<Canvas style={{ flex: 1 }}>
				{LINES.map((cfg, i) => (
					<SiriLine key={i} cfg={cfg} width={width} clock={clock} level={level} />
				))}
				<WhiteWave width={width} waveform={waveform} />
			</Canvas>
		</View>
	);
}
