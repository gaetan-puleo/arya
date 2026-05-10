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

interface AryaAvatarProps {
	size?: number;
	style?: ViewStyle;
}

export function AryaAvatar({ size = 24, style }: AryaAvatarProps) {
	const { theme } = useUnistyles();
	const textColor = '#000000';

	return (
		<View
			style={[
				{
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: "#FFFFFF",
					justifyContent: "center",
					alignItems: "center",
					flexShrink: 0,
					marginBottom: size === 52 ? 4 : 2,
				},
				style,
			]}
		>
			<Text style={{ fontSize: size * 0.54, fontWeight: "700", color: textColor }}>
				A
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
				borderRadius: 17,
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
				borderRadius: 14,
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
				fontSize: 13,
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
					fontSize: 17,
					fontWeight: "700",
					color: textColor,
					marginBottom: 14,
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
					borderRadius: 10,
					paddingHorizontal: 14,
					paddingVertical: 12,
					fontSize: 15,
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
						fontSize: 15,
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
				borderRadius: 14,
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
			<Text style={{ fontSize: 15, fontWeight: "600", color: dangerColor }}>
				{label}
			</Text>
		</Pressable>
	);
}
