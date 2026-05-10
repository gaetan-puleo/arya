import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { useUnistyles } from "@/theme/ThemeContext";

// ── AryaAvatar ──────────────────────────────────────────────────────────

interface AgentHint {
	id: string;
	color?: string;
}

interface AryaAvatarProps {
	size?: number;
	style?: ViewStyle;
	/**
	 * Optional agent hint. When provided, the avatar uses the agent's first
	 * letter and color (with luminance-based text contrast). When omitted,
	 * falls back to the default "A" on white background.
	 */
	agent?: AgentHint | null;
}

/** Pick a readable text color (black or white) for a given hex background. */
function readableTextOn(bgHex: string | undefined): string {
	if (!bgHex || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(bgHex)) return "#000000";
	let hex = bgHex.slice(1);
	if (hex.length === 3) {
		hex = hex
			.split("")
			.map((c) => c + c)
			.join("");
	}
	const r = parseInt(hex.slice(0, 2), 16) / 255;
	const g = parseInt(hex.slice(2, 4), 16) / 255;
	const b = parseInt(hex.slice(4, 6), 16) / 255;
	// Relative luminance (sRGB)
	const lin = (c: number) =>
		c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
	return L > 0.5 ? "#000000" : "#FFFFFF";
}

export function AryaAvatar({ size = 24, style, agent }: AryaAvatarProps) {
	const useAgentHint = !!agent && !!agent.id;
	const bgColor = useAgentHint ? agent!.color ?? "#FFFFFF" : "#FFFFFF";
	const textColor = useAgentHint ? readableTextOn(bgColor) : "#000000";
	const letter = useAgentHint
		? agent!.id.charAt(0).toUpperCase()
		: "A";

	return (
		<View
			style={[
				{
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: bgColor,
					justifyContent: "center",
					alignItems: "center",
					flexShrink: 0,
					marginBottom: size === 52 ? 4 : 2,
				},
				style,
			]}
		>
			<Text style={{ fontSize: size * 0.54, fontWeight: "700", color: textColor }}>
				{letter}
			</Text>
		</View>
	);
}

// ── IconButton ──────────────────────────────────────────────────────────

interface IconButtonProps {
	name: keyof typeof Ionicons.glyphMap;
	size?: number;
	onPress?: () => void;
	style?: ViewStyle;
}

export function IconButton({ name, size = 20, onPress, style }: IconButtonProps) {
	const { theme } = useUnistyles();
	const textColor = theme.colors.text;

	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => ({
				width: 34,
				height: 34,
				borderRadius: 16,
				backgroundColor: "transparent",
				justifyContent: "center",
				alignItems: "center",
				opacity: pressed ? 0.6 : 1,
				...style,
			})}
		>
			<Ionicons name={name} size={size} color={textColor} />
		</Pressable>
	);
}
