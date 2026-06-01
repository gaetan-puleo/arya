import { FlashList, type FlashListRef } from "@shopify/flash-list";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	STREAMING_ROW_ID,
	type AgentInfo,
	type ApprovalSnapshot,
	type ChatMessageItem,
	type SubAgentRunSnapshot,
} from "@/types/domain";
import { useTheme } from "@/theme/ThemeContext";
import ApprovalCard from "@/components/chat/ApprovalCard";
import ChatMessage from "@/components/chat/ChatMessage";
import SubAgentCard from "@/components/chat/SubAgentCard";
import TypingDots from "@/components/chat/TypingDots";
import { AryaAvatar } from "@/components/primitives/AryaAvatar";

// Row-id prefixes that signal an in-transcript card. Producers live in
// services/approvals.ts and services/wireDispatch.ts; ChatMessageList
// consumes the same prefixes to know "this transcript row is actually
// an inline card, not a chat bubble". Kept named so renames stay
// consistent across producer + consumer.
const APPROVAL_PREFIX = "approval-";
const SUBAGENT_PREFIX = "sub-agent-";

interface ChatMessageListProps {
	messages: ChatMessageItem[];
	approvals: Map<string, ApprovalSnapshot>;
	onRespondApproval: (rowId: string, action: "approve" | "deny") => void;
	subAgentRuns: Map<string, SubAgentRunSnapshot>;
	showScrollFab: boolean;
	onShowScrollFabChange: (show: boolean) => void;
	keyboardOpen: boolean;
	keyboardHeight: number;
	agents?: AgentInfo[];
	activeAgent?: AgentInfo | null;
	inputBarHeight?: number;
}

function approvalFromRow(
	msg: ChatMessageItem,
	approvals: Map<string, ApprovalSnapshot>,
): ApprovalSnapshot | undefined {
	if (!msg.id.startsWith(APPROVAL_PREFIX)) return undefined;
	return approvals.get(msg.id.slice(APPROVAL_PREFIX.length));
}

function subAgentFromRow(
	msg: ChatMessageItem,
	runs: Map<string, SubAgentRunSnapshot>,
): SubAgentRunSnapshot | undefined {
	if (!msg.id.startsWith(SUBAGENT_PREFIX)) return undefined;
	return runs.get(msg.id.slice(SUBAGENT_PREFIX.length));
}

export default function ChatMessageList({
	messages,
	approvals,
	onRespondApproval,
	subAgentRuns,
	showScrollFab,
	onShowScrollFabChange,
	keyboardOpen,
	agents,
	activeAgent,
	inputBarHeight,
}: ChatMessageListProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();

	const resolveAuthorAgent = (m: ChatMessageItem): AgentInfo | null => {
		if (m.authorAgentId && agents) {
			const found = agents.find((a) => a.id === m.authorAgentId);
			if (found) return found;
			return { id: m.authorAgentId, description: "" };
		}
		if (m.authorAgentId) {
			return { id: m.authorAgentId, description: "" };
		}
		return activeAgent ?? null;
	};

	const TOP_OVERLAY_PAD = 60;
	const FALLBACK_INPUT_BAR_HEIGHT =
		44 + 4 + (keyboardOpen ? 16 : insets.bottom + 8);
	const effectiveInputBarHeight =
		inputBarHeight && inputBarHeight > 0
			? inputBarHeight
			: FALLBACK_INPUT_BAR_HEIGHT;
	const FAB_GAP_ABOVE_INPUT = 16;
	const BOTTOM_OVERLAY_PAD = effectiveInputBarHeight + FAB_GAP_ABOVE_INPUT;
	const fabBottom = effectiveInputBarHeight + FAB_GAP_ABOVE_INPUT;

	const listRef = useRef<FlashListRef<ChatMessageItem>>(null);
	const AUTO_SCROLL_THRESHOLD = 80;
	const isPinnedToBottom = useRef(true);
	const isUserScrolling = useRef(false);

	// Stable signature for streaming-delta autoscroll. Memoised so
	// the reduce only re-runs when `messages` actually changes —
	// `useTranscript` returns a new array on every streaming delta,
	// and unrelated re-renders should not re-walk the transcript.
	const contentSignature = useMemo(
		() =>
			messages.reduce(
				(acc, m) => acc + m.text.length,
				messages.length,
			),
		[messages],
	);

	useEffect(() => {
		if (!isPinnedToBottom.current || isUserScrolling.current) return;
		if (messages.length === 0) return;
		const id = requestAnimationFrame(() => {
			listRef.current?.scrollToEnd({ animated: true });
		});
		return () => cancelAnimationFrame(id);
	}, [contentSignature, messages.length]);

	return (
		<View className="flex-1">
			<FlashList
				ref={listRef}
				data={messages}
				keyExtractor={(item) => item.id}
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="interactive"
				contentContainerStyle={{
					paddingTop: TOP_OVERLAY_PAD,
					paddingBottom: BOTTOM_OVERLAY_PAD,
				}}
				maintainVisibleContentPosition={{
					autoscrollToBottomThreshold: AUTO_SCROLL_THRESHOLD,
					animateAutoScrollToBottom: true,
				}}
				onScroll={(e) => {
					const { contentOffset, contentSize, layoutMeasurement } =
						e.nativeEvent;
					const distFromBottom =
						contentSize.height -
						layoutMeasurement.height -
						contentOffset.y;
					isPinnedToBottom.current =
						distFromBottom <= AUTO_SCROLL_THRESHOLD;
					onShowScrollFabChange(distFromBottom > 150);
				}}
				onScrollBeginDrag={() => {
					isUserScrolling.current = true;
				}}
				onScrollEndDrag={() => {
					isUserScrolling.current = false;
				}}
				onMomentumScrollEnd={() => {
					isUserScrolling.current = false;
				}}
				scrollEventThrottle={32}
				ListEmptyComponent={
					<View className="flex-1 items-center justify-center px-10 py-32 gap-3">
						<AryaAvatar size={52} agent={activeAgent} />
						<Text className="text-xl font-semibold text-text text-center">
							Comment puis-je vous aider ?
						</Text>
						<Text className="text-sm text-text-secondary text-center leading-5">
							Posez une question ou envoyez un message pour démarrer.
						</Text>
					</View>
				}
				renderItem={({ item: msg, index: i }) => {
					const kindOf = (m: ChatMessageItem): string => {
						if (m.role === "user") return "user";
						if (m.id.startsWith(APPROVAL_PREFIX)) return "approval";
						if (m.id.startsWith(SUBAGENT_PREFIX)) return "subagent";
						if (m.id === STREAMING_ROW_ID && m.text === "")
							return "streaming";
						return "assistant";
					};
					const prevMsg = messages[i - 1];
					const isFirst = i === 0;
					const sameGroupAsPrev =
						!isFirst && prevMsg && kindOf(prevMsg) === kindOf(msg);
					const INTRA_GROUP = 4;
					const INTER_GROUP = 32;
					const topGap = isFirst
						? 0
						: sameGroupAsPrev
							? INTRA_GROUP
							: INTER_GROUP;

					const approval = approvalFromRow(msg, approvals);
					if (approval) {
						return (
							<View style={{ paddingTop: topGap }}>
								<ApprovalCard
									snapshot={approval}
									onApprove={() =>
										onRespondApproval(msg.id, "approve")
									}
									onDeny={() => onRespondApproval(msg.id, "deny")}
								/>
							</View>
						);
					}

					const subAgentRun = subAgentFromRow(msg, subAgentRuns);
					if (subAgentRun) {
						return (
							<View style={{ paddingTop: topGap }}>
								<SubAgentCard run={subAgentRun} />
							</View>
						);
					}

					// Streaming placeholder: typing dots while content is empty,
					// markdown bubble once content arrives.
					if (msg.id === STREAMING_ROW_ID && msg.text === "") {
						const streamingAuthor = resolveAuthorAgent(msg);
						return (
							<View
								className="items-start px-4"
								style={{ paddingTop: topGap }}
							>
								<View className="flex-row gap-2 items-end">
									<AryaAvatar size={24} agent={streamingAuthor} />
									<View
										className="bg-bg-tertiary px-4 py-3"
										style={{
											borderRadius: 20,
											borderBottomLeftRadius: 6,
										}}
									>
										<TypingDots color={theme.colors.textPlaceholder} />
									</View>
								</View>
							</View>
						);
					}

					return (
						<View style={{ paddingTop: topGap }}>
							<ChatMessage
								role={msg.role}
								text={msg.text}
								isFirstInGroup
								isLastInGroup
								animate={msg.role === "user"}
								authorAgent={resolveAuthorAgent(msg)}
							/>
						</View>
					);
				}}
			/>

			{showScrollFab && (
				<Animated.View
					entering={FadeIn.duration(200)}
					exiting={FadeOut.duration(200)}
					className="absolute right-4 z-10"
					style={{ bottom: fabBottom }}
				>
					<Pressable
						onPress={() => {
							listRef.current?.scrollToEnd({ animated: true });
						}}
						className="w-9 h-9 rounded-[20px] bg-bg-tertiary border border-border justify-center items-center"
						style={{
							shadowColor: "#000",
							shadowOffset: { width: 0, height: 2 },
							shadowOpacity: 0.15,
							shadowRadius: 4,
							elevation: 4,
						}}
					>
						<Ionicons
							name="chevron-down"
							size={18}
							color={theme.colors.textSecondary}
						/>
					</Pressable>
				</Animated.View>
			)}
		</View>
	);
}
