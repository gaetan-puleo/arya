/**
 * In-chat voice-call bar. Renders in place of the text composer row while a
 * call is active — same container, same padding, so the call lives "inside the
 * conversation" with no extra screen.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  ·status·                              ( × )  │
 *   │  ▁▂▃▅▇▅▃▂▁  real-time waveform                │
 *   │  the live transcript fills in here…▏          │
 *   └─────────────────────────────────────────────┘
 *
 * The waveform tracks mic loudness in real time while listening, and breathes
 * while thinking/speaking. The transcript fills in progressively as STT commits
 * each segment of the turn (with a blinking caret while listening), and the turn
 * is sent behind the scenes once you fall silent.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
	type SharedValue,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/theme/ThemeContext";
import type { CallPhase } from "@/hooks/useVoiceCall";
import Waveform from "@/components/chat/Waveform";

interface CallBarProps {
	phase: CallPhase;
	partial: string;
	waveform: SharedValue<number[]>;
	onEnd: () => void;
}

export default function CallBar({ phase, partial, waveform, onEnd }: CallBarProps) {
	const theme = useTheme();
	const listening = phase === "listening";

	const accent =
		phase === "listening"
			? theme.colors.success
			: phase === "speaking"
				? theme.colors.info
				: theme.colors.warning;

	// Blinking caret shown at the end of the transcript while listening.
	const caret = useSharedValue(1);
	useEffect(() => {
		caret.value = withRepeat(withTiming(0, { duration: 520 }), -1, true);
	}, [caret]);
	const caretStyle = useAnimatedStyle(() => ({ opacity: caret.value }));

	const status =
		phase === "thinking"
			? "Thinking…"
			: phase === "speaking"
				? "Speaking…"
				: "Listening…";

	const hasText = partial.trim().length > 0;

	return (
		<View className="gap-2 px-1 py-2">
			{/* status + end call */}
			<View className="flex-row items-center justify-between">
				<View className="flex-row items-center gap-1.5">
					<View
						className="w-2 h-2 rounded-full"
						style={{ backgroundColor: accent }}
					/>
					<Text
						className="text-xs font-semibold uppercase tracking-wide"
						style={{ color: accent }}
					>
						{status}
					</Text>
				</View>
				<Pressable
					onPress={onEnd}
					hitSlop={8}
					className="w-9 h-9 rounded-full items-center justify-center"
					style={{ backgroundColor: theme.colors.danger }}
				>
					<Ionicons name="close" size={20} color="#fff" />
				</Pressable>
			</View>

			{/* real-time waveform */}
			<Waveform waveform={waveform} color={accent} />

			{/* live transcript filling in (with blinking caret while listening) */}
			<View className="flex-row items-end min-h-[20px]">
				<Text
					className={`flex-shrink text-[15px] leading-5 ${hasText ? "text-text" : "text-text-secondary"}`}
					numberOfLines={2}
				>
					{hasText ? partial : "Speak — I'm listening"}
				</Text>
				{listening && hasText && (
					<Animated.View
						style={[
							{
								width: 2,
								height: 16,
								marginLeft: 2,
								marginBottom: 1,
								borderRadius: 1,
								backgroundColor: accent,
							},
							caretStyle,
						]}
					/>
				)}
			</View>
		</View>
	);
}
