import Ionicons from "@expo/vector-icons/Ionicons";
import {
	Pressable,
	Text,
	TextInput,
	type TextStyle,
	type ViewStyle,
	View,
} from "react-native";
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

// ── Card ────────────────────────────────────────────────────────────────

interface CardProps {
	children: React.ReactNode;
	style?: ViewStyle;
	onPress?: () => void;
}

export function Card({ children, style, onPress }: CardProps) {
	const { theme } = useUnistyles();
	const bgSecondary = theme.colors.backgroundSecondary;
	const borderColor = theme.colors.border;

	const inner = (
		<View
			style={{
				backgroundColor: bgSecondary,
				borderRadius: 16,
				padding: 16,
				borderWidth: 1,
				borderColor,
				...style,
			}}
		>
			{children}
		</View>
	);

	return onPress ? <Pressable onPress={onPress}>{inner}</Pressable> : inner;
}

// ── SectionLabel ────────────────────────────────────────────────────────

interface SectionLabelProps {
	children: React.ReactNode;
	style?: TextStyle;
}

export function SectionLabel({ children, style }: SectionLabelProps) {
	const { theme } = useUnistyles();
	const textSecondary = theme.colors.textSecondary;

	return (
		<Text
			style={{
				fontSize: 14,
				fontWeight: "600",
				color: textSecondary,
				marginBottom: 8,
				textTransform: "uppercase",
				letterSpacing: 0.5,
				...style,
			}}
		>
			{children}
		</Text>
	);
}

// ── HelpSection ─────────────────────────────────────────────────────────

interface HelpSectionProps {
	title: string;
	children: React.ReactNode;
}

export function HelpSection({ title, children }: HelpSectionProps) {
	const { theme } = useUnistyles();
	const textColor = theme.colors.text;

	return (
		<Card style={{ marginTop: 24 }}>
			<Text
				style={{
					fontSize: 18,
					fontWeight: "700",
					color: textColor,
					marginBottom: 16,
				}}
			>
				{title}
			</Text>
			{children}
		</Card>
	);
}

// ── InputField ──────────────────────────────────────────────────────────

interface InputFieldProps {
	value: string;
	onChangeText: (v: string) => void;
	placeholder?: string;
	secureTextEntry?: boolean;
	helperText?: string;
}

export function InputField({
	value,
	onChangeText,
	placeholder,
	secureTextEntry,
	helperText,
}: InputFieldProps) {
	const { theme } = useUnistyles();
	const bgInput = theme.colors.backgroundInput;
	const textColor = theme.colors.text;
	const textPlaceholder = theme.colors.textPlaceholder;
	const borderColor = theme.colors.border;

	return (
		<View>
			<Pressable
				style={({ pressed }) => ({
					backgroundColor: bgInput,
					borderRadius: 12,
					paddingHorizontal: 16,
					paddingVertical: 12,
					fontSize: 16,
					color: textColor,
					borderWidth: 1,
					borderColor,
					opacity: pressed ? 0.8 : 1,
				})}
			>
				<TextInput
					value={value}
					onChangeText={onChangeText}
					placeholder={placeholder}
					placeholderTextColor={textPlaceholder}
					secureTextEntry={secureTextEntry}
					style={{
						fontSize: 16,
						color: textColor,
					}}
				/>
			</Pressable>
			{helperText && (
				<Text style={{ fontSize: 12, color: textPlaceholder, marginTop: 8 }}>
					{helperText}
				</Text>
			)}
		</View>
	);
}

// ── SaveButton ──────────────────────────────────────────────────────────

interface SaveButtonProps {
	label: string;
	loading?: boolean;
	onPress?: () => void;
}

export function SaveButton({ label, loading, onPress }: SaveButtonProps) {
	const { theme } = useUnistyles();
	const bgTertiary = theme.colors.backgroundTertiary;

	return (
		<Pressable
			onPress={onPress}
			disabled={loading}
			style={({ pressed }) => ({
				backgroundColor: loading ? bgTertiary : "#10A37F",
				borderRadius: 16,
				height: 50,
				alignItems: "center",
				justifyContent: "center",
				marginBottom: 16,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>
				{loading ? "Sauvegarde..." : label}
			</Text>
		</Pressable>
	);
}

// ── ResetButton ─────────────────────────────────────────────────────────

interface ResetButtonProps {
	label?: string;
	onPress?: () => void;
}

export function ResetButton({ label = "Réinitialiser", onPress }: ResetButtonProps) {
	const { theme } = useUnistyles();
	const dangerColor = theme.colors.danger;

	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => ({
				backgroundColor: "transparent",
				height: 44,
				marginBottom: 32,
				alignItems: "center",
				justifyContent: "center",
				opacity: pressed ? 0.6 : 1,
			})}
		>
			<Text style={{ fontSize: 16, fontWeight: "600", color: dangerColor }}>
				{label}
			</Text>
		</Pressable>
	);
}
