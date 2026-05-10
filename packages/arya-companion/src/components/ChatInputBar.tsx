import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
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
	keyboardOpen: boolean;
	keyboardHeight: number;
}

const MIN_INPUT_HEIGHT = 28;
const COLLAPSED_MAX_HEIGHT = 120;
const EXPAND_BUTTON_THRESHOLD = 100;

export default function ChatInputBar({
	input,
	onInputChange,
	onSend,
	loading,
	showCommandMenu,
	filteredCommands,
	showAgentMenu,
	filteredAgents,
	keyboardOpen,
	keyboardHeight,
}: ChatInputBarProps) {
	const [inputExpanded, setInputExpanded] = useState(false);
	const [textHeight, setTextHeight] = useState(MIN_INPUT_HEIGHT);
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

	const scrollEnabled = textHeight >= COLLAPSED_MAX_HEIGHT;
	const showExpandButton =
		textHeight >= EXPAND_BUTTON_THRESHOLD && !inputExpanded;

	const handleContentSizeChange = useCallback(
		(e: { nativeEvent: { contentSize: { height: number } } }) => {
			const next = Math.min(
				Math.max(Math.ceil(e.nativeEvent.contentSize.height), MIN_INPUT_HEIGHT),
				COLLAPSED_MAX_HEIGHT,
			);
			setTextHeight((prev) => (prev === next ? prev : next));
		},
		[],
	);

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
				paddingBottom:
					Platform.OS === "android"
						? keyboardOpen
							? keyboardHeight + insets.bottom
							: 0
						: 0,
			}}
		>
			{/* ── Inline command menu ── */}
			{/* {showCommandMenu && filteredCommands.length > 0 && (
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
			)} */}

			{/* ── Inline agent menu ── */}
			{/* {showAgentMenu && filteredAgents.length > 0 && (
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
			)} */}

			<View
				style={{
					paddingHorizontal: 12,
					paddingTop: 4,
					paddingBottom: keyboardOpen ? 16 : insets.bottom + 8,
					backgroundColor: bg,
				}}
			>
				<View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
					{/* ── More button ── */}
					<Pressable
						onPress={() => {}}
						style={{
							width: 44,
							height: 44,
							justifyContent: "center",
							alignItems: "center",
							borderRadius: 22,
							borderWidth: 1,
							borderColor,
							backgroundColor: bgInput,
						}}
					>
						<Ionicons name="add" size={26} color={textSecondary} />
					</Pressable>

					{/* ── Input container ── */}
					<View
						style={{
							flex: 1,
							backgroundColor: bgInput,
							borderRadius: 22,
							borderWidth: 1,
							borderColor,
							minHeight: 44,
							paddingHorizontal: 6,
							paddingVertical: 6,
							justifyContent: "center",
							position: "relative",
						}}
					>
					{/* ── TextInput + expand button ── */}
					<View
						style={{
							position: "relative",
							overflow: "hidden",
							justifyContent: "center",
							height: textHeight,
						}}
					>
						<TextInput
							style={{
								paddingLeft: 12,
								paddingRight: 40,
								paddingVertical: 0,
								fontSize: 16,
								lineHeight: 20,
								color: textColor,
								minHeight: MIN_INPUT_HEIGHT,
								maxHeight: COLLAPSED_MAX_HEIGHT,
							}}
							value={input}
							onChangeText={onInputChange}
							placeholder="Message…"
							placeholderTextColor={textPlaceholder}
							multiline
							onContentSizeChange={handleContentSizeChange}
							onSubmitEditing={send}
							returnKeyType="send"
							blurOnSubmit={false}
							textAlignVertical="center"
							scrollEnabled={scrollEnabled}
						/>
						{showExpandButton && (
							<Pressable
								onPress={() => setInputExpanded(true)}
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
						onPress={() => setInputExpanded(false)}
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
				width: 34,
				height: 34,
				justifyContent: "center",
				alignItems: "center",
				borderRadius: 17,
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
