import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

interface FloatingPillProps {
	onPress: () => void;
	icon?: keyof typeof Ionicons.glyphMap;
	leftDot?: string;
	label?: ReactNode;
	trailing?: ReactNode;
	borderColor?: string;
	style?: ViewStyle;
	hitSlop?: number;
	accessibilityLabel?: string;
}

export function FloatingPill({
	onPress,
	icon,
	leftDot,
	label,
	trailing,
	borderColor,
	style,
	hitSlop = 6,
	accessibilityLabel,
}: FloatingPillProps) {
	const theme = useTheme();
	return (
		<Pressable
			onPress={onPress}
			hitSlop={hitSlop}
			accessibilityLabel={accessibilityLabel}
			accessibilityRole="button"
			className="h-pill flex-row items-center gap-2 px-3 rounded-pill bg-bg-translucent border active:opacity-70"
			style={[{ borderColor: borderColor ?? theme.colors.border }, style]}
		>
			{leftDot ? (
				<View
					className="w-2 h-2 rounded-full"
					style={{ backgroundColor: leftDot }}
				/>
			) : null}
			{icon ? (
				<Ionicons name={icon} size={18} color={theme.colors.text} />
			) : null}
			{typeof label === "string" ? (
				<Text
					numberOfLines={1}
					className="shrink text-sm text-text font-semibold"
				>
					{label}
				</Text>
			) : (
				label
			)}
			{trailing}
		</Pressable>
	);
}
