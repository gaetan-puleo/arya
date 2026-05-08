import { FlashList, type FlashListRef } from "@shopify/flash-list";
import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	Keyboard,
	Platform,
	Pressable,
	type ScrollView as RNScrollView,
	type ScrollViewProps,
	Text,
	TextInput,
	View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import {
	KeyboardAwareScrollView,
	KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	Button,
	ScrollView,
	SizableText,
	useTheme,
	XStack,
	YStack,
} from "tamagui";

import ApprovalMessage, {
  type ApprovalStatus,
} from "@/src/components/ApprovalMessage";
import ChatMessage from "@/src/components/ChatMessage";
import SubAgentCard, {
  type SubAgentRunInfo,
} from "@/src/components/SubAgentCard";
import TypingDots from "@/src/components/TypingDots";
import type { AgentInfo, CommandInfo, SubAgentEvent } from "@/src/lib/ws";
import { globalSubAgentEvents } from "@/app/sub-agent/[runId]";

const RenderScrollComponent = React.forwardRef<RNScrollView, ScrollViewProps>(
	(props, ref) => <KeyboardAwareScrollView {...props} ref={ref} />,
);
RenderScrollComponent.displayName = "RenderScrollComponent";

const WS_KEY = "arya-companion-ws";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getThemeColor = (theme: any, key: string): string => {
	const val = theme[key];
	if (val && typeof val.get === "function") return val.get();
	return typeof val === "string" ? val : "";
};

interface ApprovalData {
	msgId: string;
	requestId: string;
	token: string;
	toolName: string;
	toolArgs: string | undefined;
	status: ApprovalStatus;
}

let approvalSeq = 0;

export default function ChatScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const [messages, setMessages] = useState<
		{ id: string; role: "user" | "assistant"; text: string }[]
	>([]);
	const [approvals, setApprovals] = useState<Map<string, ApprovalData>>(
		new Map(),
	);
	const [subAgentRuns, setSubAgentRuns] = useState<
		Map<string, SubAgentRunInfo>
	>(new Map());
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const [connected, setConnected] = useState(false);
	const [keyboardOpen, setKeyboardOpen] = useState(false);
	const [commands, setCommands] = useState<CommandInfo[]>([]);
	const [agents, setAgents] = useState<AgentInfo[]>([]);
	const [showScrollFab, setShowScrollFab] = useState(false);
	const ws = useRef<WebSocket | null>(null);
	const listRef = useRef<FlashListRef<{ id: string; role: "user" | "assistant"; text: string }>>(null);
	const theme = useTheme();

	useEffect(() => {
		const show = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
			() => setKeyboardOpen(true),
		);
		const hide = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
			() => setKeyboardOpen(false),
		);
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);

	const bg = getThemeColor(theme, "background");
	const bgSecondary = getThemeColor(theme, "backgroundSecondary");
	const bgTertiary = getThemeColor(theme, "backgroundTertiary");
	const bgInput = getThemeColor(theme, "backgroundInput");
	const textColor = getThemeColor(theme, "text");
	const textSecondary = getThemeColor(theme, "textSecondary");
	const textPlaceholder = getThemeColor(theme, "textPlaceholder");
	const borderColor = getThemeColor(theme, "border");
	const successColor = getThemeColor(theme, "success");
	const dangerColor = getThemeColor(theme, "danger");

	/* ── WebSocket ── */

	useEffect(() => {
		AsyncStorage.getItem(WS_KEY).then((raw) => {
			if (!raw) return;
			const cfg = JSON.parse(raw);
			connect(cfg.url, cfg.token);
		});
	}, []);

	const connect = useCallback((url: string, token?: string) => {
		if (!url.trim()) return;
		const wsUrl = url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
		const params = token ? `${wsUrl.includes("?") ? "&" : "?"}token=${token}` : "";
		const socket = new WebSocket(`${wsUrl}${params}`);
		ws.current = socket;

		socket.onopen = () => {
			setConnected(true);
			socket.send(JSON.stringify({ type: "commands" }));
			socket.send(JSON.stringify({ type: "agents" }));
		};
		socket.onerror = (err) => {
			console.error("[ws] error", err);
		};
		socket.onclose = () => {
			setConnected(false);
			setTimeout(() => {
				if (ws.current === socket) {
					connect(wsUrl, token);
				}
			}, 3000);
		};

		socket.onmessage = (e) => {
			const msg = JSON.parse(e.data);
			if (msg.type === "stream") {
				setMessages((m) =>
					m.map((x) => (x.id === "streaming" ? { ...x, text: msg.text } : x)),
				);
			} else if (msg.type === "done") {
				setMessages((m) =>
					m.map((x) =>
						x.id === "streaming"
							? { ...x, text: msg.text, id: Date.now().toString() }
							: x,
					),
				);
				setLoading(false);
			} else if (msg.type === "approval_request") {
				approvalSeq += 1;
				const requestId = String(msg.requestId ?? msg.token);
				const msgId = `approval-${requestId}-${approvalSeq}`;
				const data: ApprovalData = {
					msgId,
					requestId,
					token: String(msg.token ?? requestId),
					toolName: String(msg.toolName ?? ''),
					toolArgs: msg.toolArgs
						? JSON.stringify(msg.toolArgs, null, 2)
						: undefined,
					status: "pending",
				};
				setApprovals((prev) => new Map(prev).set(msgId, data));
				setMessages((m) => {
					const streamIdx = m.findIndex((x) => x.id === "streaming");
					const entry = { id: msgId, role: "assistant" as const, text: "" };
					if (streamIdx === -1) return [...m, entry];
					const next = [...m];
					next.splice(streamIdx, 0, entry);
					return next;
				});
			} else if (msg.type === "approval_response") {
				const status: ApprovalStatus =
					msg.action === "approved" ? "approved" : "denied";
				setApprovals((prev) => {
					const next = new Map(prev);
					for (const [key, entry] of next) {
						if (
							entry.requestId === String(msg.requestId ?? msg.token) &&
							entry.status === "pending"
						) {
							next.set(key, { ...entry, status });
						}
					}
					return next;
				});
			} else if (msg.type === "commands") {
				setCommands(msg.commands || []);
			} else if (msg.type === "agents") {
				setAgents(msg.agents || []);
			} else if (msg.type === "sub_agent_event" && msg.event) {
				const evt = msg.event as SubAgentEvent;
				const { runId: saRunId } = evt;

				// Store event for the detail screen
				const stored = globalSubAgentEvents.get(saRunId) ?? [];
				stored.push(evt);
				globalSubAgentEvents.set(saRunId, stored);

				if (evt.kind === "invocation_start") {
					// Insert a SubAgentCard into the chat
					const cardId = `sub-agent-${saRunId}`;
					const runInfo: SubAgentRunInfo = {
						runId: saRunId,
						agentId: evt.agentId,
						status: "running",
						toolCount: 0,
						startTs: evt.ts,
					};
					setSubAgentRuns((prev) => new Map(prev).set(cardId, runInfo));
					setMessages((m) => {
						const streamIdx = m.findIndex((x) => x.id === "streaming");
						const entry = {
							id: cardId,
							role: "assistant" as const,
							text: "",
						};
						if (streamIdx === -1) return [...m, entry];
						const next = [...m];
						next.splice(streamIdx, 0, entry);
						return next;
					});
				} else if (evt.kind === "tool_call_start") {
					const cardId = `sub-agent-${saRunId}`;
					setSubAgentRuns((prev) => {
						const run = prev.get(cardId);
						if (!run) return prev;
						const next = new Map(prev);
						next.set(cardId, {
							...run,
							toolCount: run.toolCount + 1,
						});
						return next;
					});
				} else if (evt.kind === "invocation_end") {
					const cardId = `sub-agent-${saRunId}`;
					const st = evt.data.status as string;
					setSubAgentRuns((prev) => {
						const run = prev.get(cardId);
						if (!run) return prev;
						const next = new Map(prev);
						next.set(cardId, {
							...run,
							status: st === "success" ? "success" : "error",
							endTs: evt.ts,
						});
						return next;
					});
				}
			} else if (msg.type === "error") {
				setLoading(false);
				console.error("[ws]", msg.message);
			}
		};
	}, []);

	/* ── Auto-scroll ── */

	const scrollToBottom = useCallback(() => {
		requestAnimationFrame(() => {
			if (listRef.current && messages.length > 0) {
				listRef.current.scrollToEnd({ animated: true });
			}
		});
	}, [messages.length]);

	useEffect(scrollToBottom, [messages, scrollToBottom]);

	/* ── Approval ── */

	const respondApproval = useCallback(
		(msgId: string, action: "approve" | "deny") => {
			const data = approvals.get(msgId);
			if (!data || data.status !== "pending") return;
			if (ws.current?.readyState !== WebSocket.OPEN) return;

			Haptics.notificationAsync(
				action === "approve"
					? Haptics.NotificationFeedbackType.Success
					: Haptics.NotificationFeedbackType.Warning,
			);

			ws.current.send(
				JSON.stringify({
					type: "approval_response",
					requestId: data.requestId,
					token: data.token,
					action,
					// Also include channelId for clarity
					channelId: "websocket",
				}),
			);

			setApprovals((prev) => {
				const next = new Map(prev);
				next.set(msgId, {
					...data,
					status: action === "approve" ? "approved" : "denied",
				});
				return next;
			});
		},
		[approvals],
	);

	/* ── Send ── */

	const send = useCallback(() => {
		const txt = input.trim();
		if (!txt || loading || ws.current?.readyState !== WebSocket.OPEN) return;

		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

		const isCommand = txt.startsWith("/");

		setMessages((m) => [
			...m,
			{ id: Date.now().toString(), role: "user", text: txt },
		]);
		setInput("");
		setLoading(true);
		setMessages((m) => [
			...m,
			{ id: "streaming", role: "assistant", text: "…" },
		]);

		if (isCommand) {
			ws.current.send(JSON.stringify({ type: "command", text: txt }));
		} else {
			ws.current.send(JSON.stringify({ type: "chat", text: txt }));
		}
	}, [input, loading]);

	const hasText = input.trim().length > 0;

	// Show command menu when input starts with "/" and has no space yet (typing command name)
	const showCommandMenu = input.startsWith("/") && !input.includes(" ");
	const commandQuery = input.slice(1).toLowerCase();

	const filteredCommands = showCommandMenu
		? commands.filter((c) => {
				if (!commandQuery) return true;
				return (
					c.command.toLowerCase().includes(commandQuery) ||
					c.description.toLowerCase().includes(commandQuery)
				);
			})
		: [];

	// Show agent menu when input starts with "@" and has no space yet
	const showAgentMenu = input.startsWith("@") && !input.includes(" ");
	const agentQuery = input.slice(1).toLowerCase();

	const filteredAgents = showAgentMenu
		? agents.filter((a) => {
				if (!agentQuery) return true;
				return (
					a.id.toLowerCase().includes(agentQuery) ||
					a.description.toLowerCase().includes(agentQuery)
				);
			})
		: [];

	return (
		<View style={{ flex: 1, backgroundColor: bg }}>
			{/* ── Header ── */}
			<XStack
				backgroundColor={bg}
				paddingTop={insets.top}
				paddingBottom={8}
				paddingHorizontal={16}
				alignItems="center"
				justifyContent="space-between"
			>
				<XStack gap={10} alignItems="center">
					<YStack
						width={30}
						height={30}
						borderRadius={15}
						backgroundColor="#FFFFFF"
						justifyContent="center"
						alignItems="center"
					>
						<SizableText fontSize={16} fontWeight="700" color="#1A1A1A">
							A
						</SizableText>
					</YStack>
					<SizableText fontSize={17} fontWeight="600" color={textColor}>
						Arya
					</SizableText>
					<YStack
						width={7}
						height={7}
						borderRadius={4}
						backgroundColor={connected ? successColor : dangerColor}
					/>
				</XStack>

				<XStack gap={6} alignItems="center">
					<Button
						width={34}
						height={34}
						borderRadius={17}
						backgroundColor="transparent"
						justifyContent="center"
						alignItems="center"
						padding={0}
						borderWidth={0}
						pressStyle={{ opacity: 0.6 }}
						onPress={() => {
							setMessages([]);
							setApprovals(new Map());
							setSubAgentRuns(new Map());
							globalSubAgentEvents.clear();
						}}
					>
						<Ionicons name="create-outline" size={20} color={textSecondary} />
					</Button>
					<Button
						width={34}
						height={34}
						borderRadius={17}
						backgroundColor="transparent"
						justifyContent="center"
						alignItems="center"
						padding={0}
						borderWidth={0}
						pressStyle={{ opacity: 0.6 }}
						onPress={() => router.navigate("/two")}
					>
						<Ionicons
							name="ellipsis-horizontal"
							size={20}
							color={textSecondary}
						/>
					</Button>
				</XStack>
			</XStack>

			{/* ── Thin separator ── */}
			<YStack height={1} backgroundColor={borderColor} opacity={0.4} />

			{/* ── Messages ── */}
			<FlashList
				ref={listRef}
				data={messages}
				keyExtractor={(item) => item.id}
				renderScrollComponent={RenderScrollComponent}
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
					setShowScrollFab(distFromBottom > 150);
				}}
				scrollEventThrottle={100}
				ListEmptyComponent={
					<YStack
						flex={1}
						alignItems="center"
						justifyContent="center"
						paddingHorizontal={40}
						paddingVertical={120}
						gap={12}
					>
						<YStack
							width={52}
							height={52}
							borderRadius={26}
							backgroundColor="#FFFFFF"
							justifyContent="center"
							alignItems="center"
							marginBottom={4}
						>
							<SizableText fontSize={28} fontWeight="700" color="#1A1A1A">
								A
							</SizableText>
						</YStack>
						<SizableText
							fontSize={20}
							fontWeight="600"
							color={textColor}
							textAlign="center"
						>
							Comment puis-je vous aider ?
						</SizableText>
						<SizableText
							fontSize={14}
							color={textSecondary}
							textAlign="center"
							lineHeight={20}
						>
							Posez une question ou envoyez un message pour démarrer.
						</SizableText>
					</YStack>
				}
				renderItem={({ item: msg, index: i }) => {
					const approval = approvals.get(msg.id);
					if (approval) {
						return (
							<ApprovalMessage
								toolName={approval.toolName}
								args={approval.toolArgs}
								status={approval.status}
								onApprove={() => respondApproval(msg.id, "approve")}
								onDeny={() => respondApproval(msg.id, "deny")}
							/>
						);
					}
					const subAgentRun = subAgentRuns.get(msg.id);
					if (subAgentRun) {
						return <SubAgentCard run={subAgentRun} />;
					}
					if (msg.id === "streaming" && msg.text === "…") {
						return (
							<YStack
								alignItems="flex-start"
								paddingHorizontal={16}
								paddingVertical={4}
							>
								<XStack gap={8} alignItems="flex-end">
									<YStack
										width={24}
										height={24}
										borderRadius={12}
										backgroundColor="#FFFFFF"
										justifyContent="center"
										alignItems="center"
										flexShrink={0}
										marginBottom={2}
									>
										<SizableText
											fontSize={13}
											fontWeight="700"
											color="#1A1A1A"
										>
											A
										</SizableText>
									</YStack>
									<YStack
										backgroundColor={bgTertiary}
										borderRadius={20}
										borderBottomLeftRadius={6}
										paddingHorizontal={16}
										paddingVertical={12}
									>
										<TypingDots color={textPlaceholder} />
									</YStack>
								</XStack>
							</YStack>
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
							setShowScrollFab(false);
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

			{/* ── Input Bar — sticks above keyboard ── */}
			<KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
				{/* ── Inline command menu ── */}
				{showCommandMenu && filteredCommands.length > 0 && (
					<YStack
						backgroundColor={bgSecondary}
						borderTopLeftRadius={16}
						borderTopRightRadius={16}
						borderWidth={1}
						borderBottomWidth={0}
						borderColor={borderColor}
						maxHeight={220}
						marginHorizontal={12}
					>
						<ScrollView
							showsVerticalScrollIndicator={false}
							keyboardShouldPersistTaps="always"
						>
							{filteredCommands.map((cmd, i) => (
								<XStack
									key={cmd.command}
									gap={10}
									alignItems="center"
									paddingHorizontal={16}
									paddingVertical={12}
									borderBottomWidth={i < filteredCommands.length - 1 ? 1 : 0}
									borderBottomColor={borderColor}
									pressStyle={{ backgroundColor: bgTertiary }}
									onPress={() => {
										Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
										setInput(`/${cmd.command} `);
									}}
								>
									<Text
										style={{
											fontSize: 14,
											fontWeight: "700",
											color: textColor,
											flexShrink: 0,
										}}
									>
										/{cmd.command}
									</Text>
									<Text
										style={{
											fontSize: 13,
											color: textSecondary,
											flex: 1,
										}}
										numberOfLines={1}
									>
										{cmd.description}
									</Text>
								</XStack>
							))}
						</ScrollView>
					</YStack>
				)}

				{/* ── Inline agent menu ── */}
				{showAgentMenu && filteredAgents.length > 0 && (
					<YStack
						backgroundColor={bgSecondary}
						borderTopLeftRadius={16}
						borderTopRightRadius={16}
						borderWidth={1}
						borderBottomWidth={0}
						borderColor={borderColor}
						maxHeight={220}
						marginHorizontal={12}
					>
						<ScrollView
							showsVerticalScrollIndicator={false}
							keyboardShouldPersistTaps="always"
						>
							{filteredAgents.map((agent, i) => (
								<XStack
									key={agent.id}
									gap={10}
									alignItems="center"
									paddingHorizontal={16}
									paddingVertical={12}
									borderBottomWidth={i < filteredAgents.length - 1 ? 1 : 0}
									borderBottomColor={borderColor}
									pressStyle={{ backgroundColor: bgTertiary }}
									onPress={() => {
										Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
										setInput(`@${agent.id} `);
									}}
								>
									<Text
										style={{
											fontSize: 14,
											fontWeight: "700",
											color: textColor,
											flexShrink: 0,
										}}
									>
										@{agent.id}
									</Text>
									<Text
										style={{
											fontSize: 13,
											color: textSecondary,
											flex: 1,
										}}
										numberOfLines={1}
									>
										{agent.description}
									</Text>
								</XStack>
							))}
						</ScrollView>
					</YStack>
				)}
				<YStack
					paddingHorizontal={12}
					paddingTop={4}
					paddingBottom={keyboardOpen ? 8 : insets.bottom + 8}
					backgroundColor={bg}
				>
					<YStack
						backgroundColor={bgInput}
						borderRadius={22}
						borderWidth={1}
						borderColor={borderColor}
						paddingHorizontal={6}
						paddingVertical={4}
					>
						<TextInput
							style={{
								paddingHorizontal: 12,
								paddingVertical: 6,
								fontSize: 16,
								color: textColor,
								maxHeight: 120,
								minHeight: 32,
							}}
							value={input}
							onChangeText={setInput}
							placeholder="Message…"
							placeholderTextColor={textPlaceholder}
							multiline
							onSubmitEditing={send}
							returnKeyType="send"
							blurOnSubmit={false}
							textAlignVertical="center"
							scrollEnabled
						/>

						<XStack
							justifyContent="flex-end"
							alignItems="center"
							gap={4}
							paddingHorizontal={6}
							paddingTop={2}
						>
							<Button
								onPress={send}
								disabled={!hasText || loading}
								width={32}
								height={32}
								borderRadius={16}
								backgroundColor={hasText ? "#ECECEC" : "#4A4A4A"}
								opacity={!hasText || loading ? 0.4 : 1}
								justifyContent="center"
								alignItems="center"
								padding={0}
								borderWidth={0}
								pressStyle={{ opacity: 0.7, scale: 0.95 }}
							>
								<Ionicons
									name="arrow-up"
									size={18}
									color={hasText ? "#1A1A1A" : "#8E8E8E"}
								/>
							</Button>
						</XStack>
					</YStack>
				</YStack>
			</KeyboardStickyView>
		</View>
	);
}
