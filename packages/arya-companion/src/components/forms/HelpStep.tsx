import { Text, View } from "react-native";

/**
 * Numbered help step — used by the settings screen's "How to connect"
 * card. Small enough to inline, but pulled out alongside the other
 * settings-form primitives for consistency.
 */
export default function HelpStep({ n, text }: { n: number; text: string }) {
	return (
		<View className="flex-row items-start">
			<View className="w-5 h-5 rounded-[10px] items-center justify-center mr-2 mt-px bg-bg-tertiary">
				<Text className="text-[11px] font-bold text-text-secondary">{n}</Text>
			</View>
			<Text className="flex-1 text-[13px] leading-5 text-text-secondary">
				{text}
			</Text>
		</View>
	);
}
