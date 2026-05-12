import { FlashList, type FlashListRef } from "@shopify/flash-list";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";
import ApprovalMessage from "@/components/ApprovalMessage";
import ChatMessage from "@/components/ChatMessage";
import SubAgentCard from "@/components/SubAgentCard";
import TypingDots from "@/components/TypingDots";
import { AryaAvatar } from "@/components/Primitives";
import type { ApprovalData } from "@/types/approval";
import type { SubAgentRunInfo } from "@/components/SubAgentCard";
import type { AgentInfo, ChatMessageItem } from "@/lib/ws";

interface ChatMessageListProps {
	messages: ChatMessageItem[];
	approvals: Map<string, ApprovalData>;
	onRespondApproval: (msgId: string, action: "approve" | "deny") => void;
	subAgentRuns: Map<string, SubAgentRunInfo>;
	showScrollFab: boolean;
	onShowScrollFabChange: (show: boolean) => void;
	keyboardOpen: boolean;
	keyboardHeight: number;
	/** All known agents — used to resolve each message's author by id. */
	agents?: AgentInfo[];
	/** Active primary agent — fallback for untagged assistant messages. */
	activeAgent?: AgentInfo | null;
	/**
	 * Live-measured height of the input bar (including its inner padding
	 * + safe-area / keyboard offsets). Used to keep the scroll-to-bottom
	 * FAB above the bar regardless of how tall the input grows.
	 */
	inputBarHeight?: number;
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

	// Resolve a message's author agent: prefer the message's own
	// authorAgentId, fall back to the active primary agent.
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

	// Reserve space at top (chip ~60) and bottom (input bar height). The
	// measured `inputBarHeight` already includes the input bar's own
	// padding AND the Android KeyboardAvoidingView padding when the
	// keyboard is open — do NOT add `keyboardHeight` again here.
	const TOP_OVERLAY_PAD = 60;
	// Static fallback used until the first onLayout measurement arrives.
	// 44 (button row) + 4 (paddingTop) + bottom inset + 8.
	const FALLBACK_INPUT_BAR_HEIGHT =
		44 + 4 + (keyboardOpen ? 16 : insets.bottom + 8);
	const effectiveInputBarHeight =
		inputBarHeight && inputBarHeight > 0
			? inputBarHeight
			: FALLBACK_INPUT_BAR_HEIGHT;
	// Gap kept between the input bar's top edge and either the FAB or
	// the last message. Tweak in one place.
	const FAB_GAP_ABOVE_INPUT = 16;
	const BOTTOM_OVERLAY_PAD = effectiveInputBarHeight + FAB_GAP_ABOVE_INPUT;
	// FAB sits FAB_GAP_ABOVE_INPUT above the top of the input bar.
	const fabBottom = effectiveInputBarHeight + FAB_GAP_ABOVE_INPUT;

	const listRef = useRef<FlashListRef<ChatMessageItem>>(null);

	// Auto-scroll behaviour:
	// - `isPinnedToBottom` tracks whether the user is "at the bottom" (within
	//   AUTO_SCROLL_THRESHOLD px). It's updated on every onScroll.
	// - `isUserScrolling` is true between drag-start and the end of momentum,
	//   so we never preempt a manual scroll with a programmatic one.
	// - We auto-scroll on message changes (count or content/streaming) ONLY
	//   when pinned and not currently scrolling.
	// - FlashList's built-in `maintainVisibleContentPosition.autoscrollToBottomThreshold`
	//   handles the "new item appended" case natively. Our manual effect is
	//   the safety net for streaming text deltas to the same item.
	const AUTO_SCROLL_THRESHOLD = 80;
	const isPinnedToBottom = useRef(true);
	const isUserScrolling = useRef(false);

	// Total text length across messages — changes on every streaming delta.
	const contentSignature = messages.reduce(
		(acc, m) => acc + m.text.length,
		messages.length,
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
					isPinnedToBottom.current = distFromBottom <= AUTO_SCROLL_THRESHOLD;
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
					// Fine-grained "kind" of a row. Identical kind in a row
					// → small intra-group gap. Any change → big inter-group
					// gap (user ↔ assistant *and* assistant text ↔ widget).
					const kindOf = (m: ChatMessageItem): string => {
						if (m.role === "user") return "user";
						if (approvals.get(m.id)) return "approval";
						if (subAgentRuns.get(m.id)) return "subagent";
						if (m.id === "streaming" && m.text === "…") return "streaming";
						return "assistant";
					};
					const prevMsg = messages[i - 1];
					const isFirst = i === 0;
					const sameGroupAsPrev =
						!isFirst && prevMsg && kindOf(prevMsg) === kindOf(msg);
					// Spacing tokens. Uniform across every row type.
					const INTRA_GROUP = 4; // same kind, consecutive rows
					const INTER_GROUP = 32; // any kind change
					const topGap = isFirst ? 0 : sameGroupAsPrev ? INTRA_GROUP : INTER_GROUP;

					const approval = approvals.get(msg.id);
					if (approval) {
						return (
							<View style={{ paddingTop: topGap }}>
								<ApprovalMessage
									toolName={approval.toolName}
									toolArgs={approval.toolArgs}
									toolResult={approval.toolResult}
									status={approval.status}
									onApprove={() => onRespondApproval(msg.id, "approve")}
									onDeny={() => onRespondApproval(msg.id, "deny")}
								/>
							</View>
						);
					}
					const subAgentRun = subAgentRuns.get(msg.id);
					if (subAgentRun) {
						return (
							<View style={{ paddingTop: topGap }}>
								<SubAgentCard run={subAgentRun} />
							</View>
						);
					}
					if (msg.id === "streaming" && msg.text === "…") {
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

					// Tool entries always render via the approvals branch above.
					// Defensive: if a tool message slipped through without an
					// approval entry, skip it rather than crashing ChatMessage.
					if (msg.role === "tool") return null;

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

			{/* Scroll-to-bottom FAB */}
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
