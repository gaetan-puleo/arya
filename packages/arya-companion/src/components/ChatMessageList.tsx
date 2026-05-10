import { FlashList, type FlashListRef } from "@shopify/flash-list";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useUnistyles } from "@/theme/ThemeContext";
import ApprovalMessage from "@/components/ApprovalMessage";
import ChatMessage from "@/components/ChatMessage";
import SubAgentCard from "@/components/SubAgentCard";
import TypingDots from "@/components/TypingDots";
import { AryaAvatar } from "@/components/Primitives";
import type { ApprovalData } from "@/types/approval";
import type { SubAgentRunInfo } from "@/components/SubAgentCard";

interface ChatMessageListProps {
	messages: { id: string; role: "user" | "assistant"; text: string }[];
	approvals: Map<string, ApprovalData>;
	onRespondApproval: (msgId: string, action: "approve" | "deny") => void;
	subAgentRuns: Map<string, SubAgentRunInfo>;
	showScrollFab: boolean;
	onScrollToEnd: () => void;
	onShowScrollFabChange: (show: boolean) => void;
}

export default function ChatMessageList({
	messages,
	approvals,
	onRespondApproval,
	subAgentRuns,
	showScrollFab,
	onScrollToEnd,
	onShowScrollFabChange,
}: ChatMessageListProps) {
	const { theme } = useUnistyles();

	const bgTertiary = theme.colors.backgroundTertiary;
	const textColor = theme.colors.text;
	const textSecondary = theme.colors.textSecondary;
	const textPlaceholder = theme.colors.textPlaceholder;
	const borderColor = theme.colors.border;

	const listRef = useRef<FlashListRef<{ id: string; role: "user" | "assistant"; text: string }>>(null);

	// Auto-scroll to bottom when messages change
	useEffect(() => {
		requestAnimationFrame(() => {
			if (listRef.current && messages.length > 0) {
				listRef.current.scrollToEnd({ animated: true });
			}
		});
	}, [messages.length]);

	return (
		<View style={{ flex: 1 }}>
			<FlashList
				ref={listRef}
				data={messages}
				keyExtractor={(item) => item.id}
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="interactive"
				contentContainerStyle={{
					paddingTop: 8,
					paddingBottom: 16,
				}}
				onScroll={(e) => {
					const { contentOffset, contentSize, layoutMeasurement } =
						e.nativeEvent;
					const distFromBottom =
						contentSize.height -
						layoutMeasurement.height -
						contentOffset.y;
					onShowScrollFabChange(distFromBottom > 150);
				}}
				scrollEventThrottle={100}
				ListEmptyComponent={
					<View
						style={{
							flex: 1,
							alignItems: "center",
							justifyContent: "center",
							paddingHorizontal: 40,
							paddingVertical: 120,
							gap: 12,
						}}
					>
						<AryaAvatar size={52} />
						<Text
							style={{
								fontSize: 20,
								fontWeight: "600",
								color: textColor,
								textAlign: "center",
							}}
						>
							Comment puis-je vous aider ?
						</Text>
						<Text
							style={{
								fontSize: 14,
								color: textSecondary,
								textAlign: "center",
								lineHeight: 20,
							}}
						>
							Posez une question ou envoyez un message pour démarrer.
						</Text>
					</View>
				}
				renderItem={({ item: msg, index: i }) => {
					const approval = approvals.get(msg.id);
					if (approval) {
						return (
							<ApprovalMessage
								toolName={approval.toolName}
								toolArgs={approval.toolArgs}
								status={approval.status}
								onApprove={() => onRespondApproval(msg.id, "approve")}
								onDeny={() => onRespondApproval(msg.id, "deny")}
							/>
						);
					}
					const subAgentRun = subAgentRuns.get(msg.id);
					if (subAgentRun) {
						return <SubAgentCard run={subAgentRun} />;
					}
					if (msg.id === "streaming" && msg.text === "…") {
						return (
							<View
								style={{
									alignItems: "flex-start",
									paddingHorizontal: 16,
									paddingVertical: 4,
								}}
							>
								<View
									style={{
										flexDirection: "row",
										gap: 8,
										alignItems: "flex-end",
									}}
								>
									<AryaAvatar size={24} />
									<View
										style={{
											backgroundColor: bgTertiary,
											borderRadius: 20,
											borderBottomLeftRadius: 6,
											paddingHorizontal: 16,
											paddingVertical: 12,
										}}
									>
										<TypingDots color={textPlaceholder} />
									</View>
								</View>
							</View>
						);
					}

					const prevMsg = messages[i - 1];
					const nextMsg = messages[i + 1];
					const isFirstInGroup =
						!prevMsg ||
						prevMsg.role !== msg.role ||
						!!approvals.get(prevMsg.id) ||
						!!subAgentRuns.get(prevMsg.id);
					const isLastInGroup =
						!nextMsg ||
						nextMsg.role !== msg.role ||
						!!approvals.get(nextMsg.id) ||
						!!subAgentRuns.get(nextMsg.id) ||
						(nextMsg.id === "streaming" && nextMsg.text === "…");

					return (
						<ChatMessage
							role={msg.role}
							text={msg.text}
							isFirstInGroup={isFirstInGroup}
							isLastInGroup={isLastInGroup}
							animate={msg.role === "user"}
						/>
					);
				}}
			/>

			{/* ── Scroll-to-bottom FAB ── */}
			{showScrollFab && (
				<Animated.View
					entering={FadeIn.duration(200)}
					exiting={FadeOut.duration(200)}
					style={{
						position: "absolute",
						right: 16,
						bottom: 90,
						zIndex: 10,
					}}
				>
					<Pressable
						onPress={() => {
							listRef.current?.scrollToEnd({ animated: true });
							onScrollToEnd();
						}}
						style={{
							width: 36,
							height: 36,
							borderRadius: 18,
							backgroundColor: bgTertiary,
							borderWidth: 1,
							borderColor,
							justifyContent: "center",
							alignItems: "center",
							shadowColor: "#000",
							shadowOffset: { width: 0, height: 2 },
							shadowOpacity: 0.15,
							shadowRadius: 4,
							elevation: 4,
						}}
					>
						<Ionicons name="chevron-down" size={18} color={textSecondary} />
					</Pressable>
				</Animated.View>
			)}
		</View>
	);
}
