import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import {
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	StatusBar,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";

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
	const theme = useTheme();

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
		<>
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
				{/* Inline command menu */}
				{showCommandMenu && filteredCommands.length > 0 && (
					<InlineMenu
						items={filteredCommands}
						onSelect={(cmd) => {
							Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
							onInputChange(`/${cmd.command} `);
						}}
						label={(item) => `/${item.command}`}
						description={(item) => item.description}
						keyExtractor={(item) => item.command}
					/>
				)}

				{/* Inline agent menu */}
				{showAgentMenu && filteredAgents.length > 0 && (
					<InlineMenu
						items={filteredAgents}
						onSelect={(agent) => {
							Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
							onInputChange(`@${agent.id} `);
						}}
						label={(item) => `@${item.id}`}
						description={(item) => item.description}
						keyExtractor={(item) => item.id}
					/>
				)}

				<View
					className="px-3 pt-1 bg-bg-translucent"
					style={{ paddingBottom: keyboardOpen ? 16 : insets.bottom + 8 }}
				>
					<View className="flex-row items-end gap-2">
						{/* Input container */}
						<View className="flex-1 bg-bg-input rounded-pill border border-border min-h-[44px] px-1.5 py-1.5 justify-center relative">
							{/* TextInput + expand button */}
							<View
								className="relative overflow-hidden justify-center"
								style={{ height: textHeight }}
							>
								<TextInput
									className="pl-3 pr-10 py-0 text-base text-text"
									style={{
										lineHeight: 20,
										minHeight: MIN_INPUT_HEIGHT,
										maxHeight: COLLAPSED_MAX_HEIGHT,
									}}
									value={input}
									onChangeText={onInputChange}
									placeholder="Message…"
									placeholderTextColor={theme.colors.textPlaceholder}
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
										className="absolute top-1 right-1 w-7 h-7 justify-center items-center rounded-2xl"
									>
										<Ionicons
											name="expand"
											size={18}
											color={theme.colors.textSecondary}
										/>
									</Pressable>
								)}
							</View>

							{/* Send button — absolute bottom-right */}
							<SendButton hasText={hasText} loading={loading} onSend={send} />
						</View>
					</View>
				</View>
			</KeyboardAvoidingView>

			{/* Full-screen expanded input overlay
			    Rendered via React Native Modal so it draws into its own
			    native window — sits on top of everything (chat list, mode
			    chip, FAB, keyboard avoiding view) and extends over the
			    on-screen keyboard. */}
			<Modal
				visible={inputExpanded}
				animationType="fade"
				transparent={false}
				statusBarTranslucent
				onRequestClose={() => setInputExpanded(false)}
				presentationStyle="overFullScreen"
			>
				<StatusBar barStyle="light-content" />
				<KeyboardAvoidingView
					behavior={Platform.OS === "ios" ? "padding" : undefined}
					className="flex-1 bg-bg"
				>
					<View className="flex-1 bg-bg">
						<TextInput
							className="flex-1 w-full px-5 text-lg text-text"
							style={{
								paddingTop: insets.top + 56,
								paddingBottom: 80,
								textAlignVertical: "top",
								lineHeight: 26,
							}}
							value={input}
							onChangeText={onInputChange}
							placeholder="Message…"
							placeholderTextColor={theme.colors.textPlaceholder}
							multiline
							autoFocus
							returnKeyType="send"
							blurOnSubmit={false}
							onSubmitEditing={send}
						/>

						<Pressable
							onPress={() => setInputExpanded(false)}
							hitSlop={8}
							className="absolute right-2 w-11 h-11 justify-center items-center z-10"
							style={{ top: insets.top + 8 }}
						>
							<Ionicons name="close" size={28} color={theme.colors.text} />
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
				</KeyboardAvoidingView>
			</Modal>
		</>
	);
}

// ── Shared inline menu ─────────────────────────────────────────────────

function InlineMenu<T extends { description: string }>({
	items,
	onSelect,
	label,
	description,
	keyExtractor,
}: {
	items: T[];
	onSelect: (item: T) => void;
	label: (item: T) => string;
	description: (item: T) => string;
	keyExtractor: (item: T) => string;
}) {
	return (
		<View className="bg-bg-secondary rounded-t-card border border-b-0 border-border max-h-[220px] mx-3">
			<ScrollView
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps="always"
			>
				{items.map((item, i) => (
					<Pressable
						key={keyExtractor(item)}
						onPress={() => onSelect(item)}
						className={`flex-row gap-2 items-center px-4 py-3 active:bg-bg-tertiary ${i < items.length - 1 ? "border-b border-border" : ""}`}
					>
						<Text className="text-sm font-bold text-text shrink-0">
							{label(item)}
						</Text>
						<Text
							className="text-sm text-text-secondary flex-1"
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
			className="absolute bottom-1 right-1 justify-center items-center rounded-2xl"
			style={{
				width: 34,
				height: 34,
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
