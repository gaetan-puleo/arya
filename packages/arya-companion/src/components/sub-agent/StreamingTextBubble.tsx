import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

/**
 * Live-streamed "Thinking…" bubble for the sub-agent detail screen.
 * Sits at the top of the timeline list while text deltas accumulate;
 * disappears once the matching `message_end` event arrives.
 */
export default function StreamingTextBubble({ text }: { text: string }) {
	const theme = useTheme();
	return (
		<View className="px-4 py-1.5">
			<View className="flex-row gap-1 items-end py-1">
				<Ionicons
					name="chatbubble-ellipses-outline"
					size={12}
					color={theme.colors.textSecondary}
				/>
				<Text className="text-xs text-text-secondary">Thinking…</Text>
			</View>
			<View className="bg-bg-tertiary rounded-card px-4 py-3">
				<Text className="text-sm text-text leading-5">{text}</Text>
			</View>
		</View>
	);
}
