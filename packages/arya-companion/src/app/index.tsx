import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useUnistyles } from "@/theme/ThemeContext";

import { useChat } from "@/hooks/useChat";
import type { AgentInfo } from "@/lib/ws";
import ChatMessageList from "@/components/ChatMessageList";
import ChatInputBar from "@/components/ChatInputBar";
import SessionsLayout from "@/components/SessionsLayout";

function capitalize(s: string): string {
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export default function ChatScreen() {
	const { theme } = useUnistyles();
	const chat = useChat();
	const [agentMenuOpen, setAgentMenuOpen] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	// Measured live so the scroll-to-bottom FAB and list bottom padding
	// stay above the input bar even when it grows (multi-line text).
	const [inputBarHeight, setInputBarHeight] = useState(0);
	const handleInputBarLayout = (e: LayoutChangeEvent) => {
		const h = Math.round(e.nativeEvent.layout.height);
		setInputBarHeight((prev) => (prev === h ? prev : h));
	};

	const rawAgentId = chat.activeAgent?.id ?? "";
	const agentLabel = rawAgentId ? capitalize(rawAgentId) : "—";
	const dotColor =
		chat.activeAgent?.color ??
		(chat.activeAgent
			? theme.colors.success
			: theme.colors.textPlaceholder);
	const canSwitch = chat.primaryAgents.length > 1;

	const handleSelect = (agent: AgentInfo) => {
		chat.setActiveAgent(agent.id);
		setAgentMenuOpen(false);
	};

	return (
		<SessionsLayout
			open={drawerOpen}
			onOpenChange={setDrawerOpen}
			sessions={chat.sessions}
			currentSessionId={chat.currentSessionId}
			onSelect={chat.selectSession}
			onCreate={chat.createSession}
			onDelete={chat.deleteSession}
			onDeleteAll={chat.deleteAllSessions}
			onRename={chat.renameSession}
		>
			<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
				<ChatMessageList
				messages={chat.messages}
				approvals={chat.approvals}
				onRespondApproval={chat.respondApproval}
				subAgentRuns={chat.subAgentRuns}
				showScrollFab={chat.showScrollFab}
				onShowScrollFabChange={chat.setShowScrollFab}
				keyboardOpen={chat.keyboardOpen}
				keyboardHeight={chat.keyboardHeight}
				agents={chat.agents}
				activeAgent={chat.activeAgent}
				inputBarHeight={inputBarHeight}
			/>

			{/* Input bar absolutely positioned so messages scroll BEHIND it
			    with the translucent background revealing them faintly. */}
			<View
				onLayout={handleInputBarLayout}
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					bottom: 0,
					zIndex: 15,
				}}
			>
				<ChatInputBar
					input={chat.input}
					onInputChange={chat.setInput}
					onSend={chat.send}
					loading={chat.loading}
					showCommandMenu={chat.showCommandMenu}
					filteredCommands={chat.filteredCommands}
					showAgentMenu={chat.showAgentMenu}
					filteredAgents={chat.filteredAgents}
					keyboardOpen={chat.keyboardOpen}
					keyboardHeight={chat.keyboardHeight}
				/>
			</View>

			{/* ── Floating burger button (opens the sessions drawer) ── */}
			<Pressable
				onPress={() => setDrawerOpen(true)}
				hitSlop={6}
				style={({ pressed }) => ({
					position: "absolute",
					top: 8,
					left: 12,
					height: 44,
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingHorizontal: 12,
					borderRadius: 24,
					backgroundColor: theme.colors.backgroundTranslucent,
					borderWidth: 1,
					borderColor: theme.colors.border,
					zIndex: 20,
					opacity: pressed ? 0.7 : 1,
					maxWidth: 200,
				})}
			>
				<Ionicons name="menu" size={18} color={theme.colors.text} />
				{chat.currentSession ? (
					<Text
						numberOfLines={1}
						style={{
							flexShrink: 1,
							fontSize: 14,
							color: theme.colors.text,
							fontWeight: "600",
						}}
					>
						{chat.currentSession.title}
					</Text>
				) : null}
			</Pressable>

			{/* ── Backdrop (closes the dropdown on outside tap) ── */}
			{agentMenuOpen ? (
				<Pressable
					onPress={() => setAgentMenuOpen(false)}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						zIndex: 19,
					}}
				/>
			) : null}

			{/* ── Floating agent chip (tappable to open dropdown) ── */}
			<Pressable
				onPress={() => {
					if (canSwitch) setAgentMenuOpen((v) => !v);
				}}
				style={({ pressed }) => ({
					position: "absolute",
					top: 8,
					right: 12,
					height: 44,
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingHorizontal: 16,
					borderRadius: 24,
					backgroundColor: theme.colors.backgroundTranslucent,
					borderWidth: 1,
					borderColor: agentMenuOpen
						? theme.colors.borderFocus
						: theme.colors.border,
					zIndex: 20,
					opacity: pressed ? 0.7 : 1,
				})}
			>
				<View
					style={{
						width: 8,
						height: 8,
						borderRadius: 4,
						backgroundColor: dotColor,
					}}
				/>
				<Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
					Agent:{" "}
					<Text style={{ color: theme.colors.text, fontWeight: "600" }}>
						{agentLabel}
					</Text>
				</Text>
				{canSwitch ? (
					<Ionicons
						name={agentMenuOpen ? "chevron-up" : "chevron-down"}
						size={14}
						color={theme.colors.textSecondary}
						style={{ marginLeft: 2 }}
					/>
				) : null}
			</Pressable>

			{/* ── Dropdown menu ── */}
			{agentMenuOpen && canSwitch ? (
				<Animated.View
					entering={FadeIn.duration(120)}
					exiting={FadeOut.duration(100)}
					style={{
						position: "absolute",
						top: 8 + 44 + 6,
						right: 12,
						minWidth: 200,
						maxWidth: 280,
						backgroundColor: theme.colors.backgroundTranslucent,
						borderWidth: 1,
						borderColor: theme.colors.border,
						borderRadius: 16,
						paddingVertical: 4,
						zIndex: 21,
						shadowColor: "#000",
						shadowOffset: { width: 0, height: 4 },
						shadowOpacity: 0.25,
						shadowRadius: 8,
						elevation: 6,
					}}
				>
					{chat.primaryAgents.map((agent) => {
						const isActive = agent.id === chat.activeAgentId;
						return (
							<Pressable
								key={agent.id}
								onPress={() => handleSelect(agent)}
								style={({ pressed }) => ({
									flexDirection: "row",
									alignItems: "center",
									gap: 8,
									paddingHorizontal: 12,
									paddingVertical: 12,
									backgroundColor: pressed
										? theme.colors.backgroundHover
										: "transparent",
								})}
							>
								<View
									style={{
										width: 8,
										height: 8,
										borderRadius: 4,
										backgroundColor:
											agent.color ?? theme.colors.textPlaceholder,
									}}
								/>
								<View style={{ flex: 1 }}>
									<Text
										style={{
											fontSize: 14,
											fontWeight: isActive ? "700" : "500",
											color: theme.colors.text,
										}}
									>
										{capitalize(agent.id)}
									</Text>
									{agent.description ? (
										<Text
											numberOfLines={1}
											style={{
												fontSize: 12,
												color: theme.colors.textSecondary,
												marginTop: 1,
											}}
										>
											{agent.description}
										</Text>
									) : null}
								</View>
								{isActive ? (
									<Ionicons
										name="checkmark"
										size={16}
										color={theme.colors.text}
									/>
								) : null}
							</Pressable>
						);
					})}
				</Animated.View>
			) : null}
			</View>
		</SessionsLayout>
	);
}
