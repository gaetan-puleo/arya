import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

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
	const letter = useAgentHint ? agent!.id.charAt(0).toUpperCase() : "A";

	return (
		<View
			className="justify-center items-center shrink-0"
			style={[
				{
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: bgColor,
					marginBottom: size === 52 ? 4 : 2,
				},
				style,
			]}
		>
			<Text
				className="font-bold"
				style={{ fontSize: size * 0.54, color: textColor }}
			>
				{letter}
			</Text>
		</View>
	);
}

// ── FloatingPill ────────────────────────────────────────────────────────

interface FloatingPillProps {
	onPress: () => void;
	/** Optional leading Ionicon name. */
	icon?: keyof typeof Ionicons.glyphMap;
	/** Optional leading colored dot (e.g. agent indicator). */
	leftDot?: string;
	/**
	 * Label slot — string for simple cases, `ReactNode` when the caller
	 * wants colored runs (e.g. "Agent: <bold>Name</bold>").
	 */
	label?: ReactNode;
	/** Trailing slot, e.g. a chevron icon for dropdown affordances. */
	trailing?: ReactNode;
	/** Override the border color (e.g. focus state). */
	borderColor?: string;
	/** Override the absolute placement; defaults to none (inline). */
	style?: ViewStyle;
	hitSlop?: number;
	accessibilityLabel?: string;
}

/**
 * Pill-shaped floating button used for chrome controls (burger, agent
 * chip, settings back button). Shape is fixed: height 44, radius 24,
 * translucent background, themed border, horizontal layout with gap 8.
 *
 * Renders the optional dot/icon, label, then trailing slot. Caller
 * positions the pill via `style` (typically `position: 'absolute'`).
 */
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
			{icon ? <Ionicons name={icon} size={18} color={theme.colors.text} /> : null}
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
