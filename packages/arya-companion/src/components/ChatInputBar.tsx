import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "@/theme/ThemeContext";

import type { CommandInfo, AgentInfo } from "@/lib/ws";

interface ChatInputBarProps {
	input: string;
	onInputChange: (v: string) => void;
	onSend: () => void;
	loading: boolean;
	showCommandMenu: boolean;
	filteredCommands: CommandInfo[];
	showAgentMenu: boolean;
	filteredAgents: AgentInfo[];
	inputExpanded: boolean;
	onExpandChange: (v: boolean) => void;
	textHeight: number;
	keyboardOpen: boolean;
	keyboardHeight: number;
	setTextHeight: (v: number) => void;
}

export default function ChatInputBar({
	input,
	onInputChange,
	onSend,
	loading,
	showCommandMenu,
	filteredCommands,
	showAgentMenu,
	filteredAgents,
	inputExpanded,
	onExpandChange,
	textHeight,
	keyboardOpen,
	keyboardHeight,
	setTextHeight,
}: ChatInputBarProps) {
	const insets = useSafeAreaInsets();
	const { theme } = useUnistyles();

	const bg = theme.colors.background;
	const bgSecondary = theme.colors.backgroundSecondary;
	const bgTertiary = theme.colors.backgroundTertiary;
	const bgInput = theme.colors.backgroundInput;
	const textColor = theme.colors.text;
	const textSecondary = theme.colors.textSecondary;
	const textPlaceholder = theme.colors.textPlaceholder;
	const borderColor = theme.colors.border;

	const hasText = input.trim().length > 0;

	const send = useCallback(() => {
		if (!hasText || loading) return;
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		onSend();
	}, [hasText, loading, onSend]);

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : undefined}
			keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 48 : 0}
			style={{
				flex: 0,
				paddingBottom: Platform.OS === "android" ? keyboardHeight : 0,
			}}
		>
			{/* ── Inline command menu ── */}
			{showCommandMenu && filteredCommands.length > 0 && (
				<InlineMenu
					items={filteredCommands}
					prefix="/"
					onSelect={(cmd) => {
						Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
						onInputChange(`/${cmd.command} `);
					}}
					label={(item) => `/${item.command}`}
					description={(item) => item.description}
					keyExtractor={(item) => item.command}
					bgSecondary={bgSecondary}
					bgTertiary={bgTertiary}
					borderColor={borderColor}
					textColor={textColor}
					textSecondary={textSecondary}
				/>
			)}

			{/* ── Inline agent menu ── */}
			{showAgentMenu && filteredAgents.length > 0 && (
				<InlineMenu
					items={filteredAgents}
					prefix="@"
					onSelect={(agent) => {
						Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
						onInputChange(`@${agent.id} `);
					}}
					label={(item) => `@${item.id}`}
					description={(item) => item.description}
					keyExtractor={(item) => item.id}
					bgSecondary={bgSecondary}
					bgTertiary={bgTertiary}
					borderColor={borderColor}
					textColor={textColor}
					textSecondary={textSecondary}
				/>
			)}

			<View
				style={{
					paddingHorizontal: 12,
					paddingTop: 4,
					paddingBottom: keyboardOpen ? 16 : insets.bottom + 8,
					backgroundColor: bg,
				}}
			>
				<View
					style={{
						backgroundColor: bgInput,
						borderRadius: 22,
						borderWidth: 1,
						borderColor,
						paddingHorizontal: 6,
						paddingVertical: 4,
						flexDirection: "row",
						alignItems: "flex-start",
						position: "relative",
					}}
				>
					{/* ── TextInput + expand button ── */}
					<View style={{ flex: 1, position: "relative" }}>
						<TextInput
							style={{
								paddingHorizontal: 12,
								paddingVertical: 6,
								fontSize: 16,
								color: textColor,
								maxHeight: inputExpanded ? 220 : 120,
								minHeight: 32,
							}}
							value={input}
							onChangeText={onInputChange}
							placeholder="Message…"
							placeholderTextColor={textPlaceholder}
							multiline
							onContentSizeChange={(e) => setTextHeight(e.nativeEvent.contentSize.height)}
							onSubmitEditing={send}
							returnKeyType="send"
							blurOnSubmit={false}
							textAlignVertical={inputExpanded ? "top" : "center"}
							scrollEnabled
						/>
						{textHeight >= 100 && !inputExpanded && (
							<Pressable
								onPress={() => onExpandChange(true)}
								style={{
									position: "absolute",
									top: 4,
									right: 4,
									width: 28,
									height: 28,
									justifyContent: "center",
									alignItems: "center",
									borderRadius: 14,
								}}
							>
								<Ionicons name="expand" size={18} color={textSecondary} />
							</Pressable>
						)}
					</View>

					{/* ── Send button — absolute bottom-right ── */}
					<SendButton
						hasText={hasText}
						loading={loading}
						onSend={send}
					/>
				</View>
			</View>

			{/* ── Full-screen expanded input overlay ── */}
			{inputExpanded && (
				<View
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						backgroundColor: bg,
						zIndex: 100,
					}}
				>
					<TextInput
						style={{
							flex: 1,
							paddingTop: insets.top + 20,
							paddingHorizontal: 20,
							paddingBottom: keyboardOpen ? 80 : insets.bottom + 80,
							fontSize: 18,
							color: textColor,
							textAlignVertical: "top",
							lineHeight: 26,
						}}
						value={input}
						onChangeText={onInputChange}
						placeholder="Message…"
						placeholderTextColor={textPlaceholder}
						multiline
						autoFocus
						returnKeyType="send"
						blurOnSubmit={false}
						onSubmitEditing={send}
					/>

					<Pressable
						onPress={() => onExpandChange(false)}
						style={{
							position: "absolute",
							top: insets.top + 8,
							right: 8,
							width: 44,
							height: 44,
							justifyContent: "center",
							alignItems: "center",
						}}
					>
						<Ionicons name="close" size={28} color={textColor} />
					</Pressable>

					<SendButton
						hasText={hasText}
						loading={loading}
						onSend={send}
						fullScreen
						keyboardOpen={keyboardOpen}
						insets={insets}
					/>
				</View>
			)}
		</KeyboardAvoidingView>
	);
}

// ── Shared inline menu ─────────────────────────────────────────────────

function InlineMenu<T extends { description: string }>({
	items,
	prefix,
	onSelect,
	label,
	description,
	keyExtractor,
	bgSecondary,
	bgTertiary,
	borderColor,
	textColor,
	textSecondary,
}: {
	items: T[];
	prefix: string;
	onSelect: (item: T) => void;
	label: (item: T) => string;
	description: (item: T) => string;
	keyExtractor: (item: T) => string;
	bgSecondary: string;
	bgTertiary: string;
	borderColor: string;
	textColor: string;
	textSecondary: string;
}) {
	return (
		<View
			style={{
				backgroundColor: bgSecondary,
				borderTopLeftRadius: 16,
				borderTopRightRadius: 16,
				borderWidth: 1,
				borderBottomWidth: 0,
				borderColor,
				maxHeight: 220,
				marginHorizontal: 12,
			}}
		>
			<ScrollView
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps="always"
			>
				{items.map((item, i) => (
					<Pressable
						key={keyExtractor(item)}
						onPress={() => onSelect(item)}
						style={({ pressed }) => ({
							flexDirection: "row",
							gap: 10,
							alignItems: "center",
							paddingHorizontal: 16,
							paddingVertical: 12,
							borderBottomWidth: i < items.length - 1 ? 1 : 0,
							borderBottomColor: borderColor,
							backgroundColor: pressed ? bgTertiary : "transparent",
						})}
					>
						<Text
							style={{
								fontSize: 14,
								fontWeight: "700",
								color: textColor,
								flexShrink: 0,
							}}
						>
							{label(item)}
						</Text>
						<Text
							style={{
								fontSize: 13,
								color: textSecondary,
								flex: 1,
							}}
							numberOfLines={1}
						>
							{description(item)}
						</Text>
					</Pressable>
				))}
			</ScrollView>
		</View>
	);
}

// ── Send button ────────────────────────────────────────────────────────

function SendButton({
	hasText,
	loading,
	onSend,
	fullScreen = false,
	keyboardOpen,
	insets,
}: {
	hasText: boolean;
	loading: boolean;
	onSend: () => void;
	fullScreen?: boolean;
	keyboardOpen?: boolean;
	insets?: ReturnType<typeof useSafeAreaInsets>;
}) {
	return (
		<Pressable
			onPress={onSend}
			disabled={!hasText || loading}
			style={{
				position: "absolute",
				bottom: 4,
				right: 4,
				width: 32,
				height: 32,
				justifyContent: "center",
				alignItems: "center",
				borderRadius: 16,
				backgroundColor: hasText ? "#ECECEC" : "#4A4A4A",
				opacity: !hasText || loading ? 0.4 : 1,
				...(fullScreen
					? {
							bottom: keyboardOpen ? 16 : (insets?.bottom ?? 0) + 16,
							width: 40,
							height: 40,
							borderRadius: 20,
							right: 16,
						}
					: {}),
			}}
		>
			<Ionicons
				name="arrow-up"
				size={fullScreen ? 22 : 18}
				color={hasText ? "#1A1A1A" : "#8E8E8E"}
			/>
		</Pressable>
	);
}
