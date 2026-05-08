import { FlashList } from "@shopify/flash-list";
import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	Button,
	SizableText,
	Text,
	useTheme,
	XStack,
	YStack,
} from "tamagui";
import type { SubAgentEvent, SubAgentEventKind } from "@/src/lib/ws";

const WS_KEY = "arya-companion-ws";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getThemeColor = (theme: any, key: string): string => {
	const val = theme[key];
	if (val && typeof val.get === "function") return val.get();
	return typeof val === "string" ? val : "";
};

/** Timeline entry rendered in the FlatList */
interface TimelineEntry {
	id: string;
	kind: SubAgentEventKind;
	ts: number;
	data: Record<string, unknown>;
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const entries = Object.entries(args as Record<string, unknown>).slice(0, 5);
	return entries
		.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
		.join("\n");
}

export default function SubAgentDetailScreen() {
	const { runId } = useLocalSearchParams<{ runId: string }>();
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const theme = useTheme();

	const bg = getThemeColor(theme, "background");
	const bgSecondary = getThemeColor(theme, "backgroundSecondary");
	const bgTertiary = getThemeColor(theme, "backgroundTertiary");
	const bgInput = getThemeColor(theme, "backgroundInput");
	const textColor = getThemeColor(theme, "text");
	const textSecondary = getThemeColor(theme, "textSecondary");
	const borderColor = getThemeColor(theme, "border");
	const successColor = getThemeColor(theme, "success");
	const dangerColor = getThemeColor(theme, "danger");
	const infoColor = getThemeColor(theme, "info");
	const warningColor = getThemeColor(theme, "warning");

	const [agentId, setAgentId] = useState<string>("");
	const [status, setStatus] = useState<"running" | "success" | "error">(
		"running",
	);
	const [entries, setEntries] = useState<TimelineEntry[]>([]);
	const [streamedText, setStreamedText] = useState("");
	const streamedRef = useRef("");
	const ws = useRef<WebSocket | null>(null);
	const seenIds = useRef(new Set<string>());

	// Load events that were already collected before navigating here
	// They're stored on a global (set by index.tsx)
	useEffect(() => {
		const stored = globalSubAgentEvents.get(runId ?? "");
		if (stored) {
			for (const evt of stored) {
				processEvent(evt);
			}
		}
	}, [runId]);

	const processEvent = useCallback(
		(evt: SubAgentEvent) => {
			// Deduplicate
			const evtId = `${evt.kind}-${evt.ts}`;
			if (seenIds.current.has(evtId)) return;
			seenIds.current.add(evtId);

			if (evt.kind === "invocation_start") {
				setAgentId(evt.agentId);
			} else if (evt.kind === "text_delta") {
				const delta = (evt.data.delta as string) ?? "";
				streamedRef.current += delta;
				setStreamedText(streamedRef.current);
				return; // Don't add to timeline — streamed text is shown separately
			} else if (evt.kind === "message_end") {
				// Replace streamed text with final message
				const text = (evt.data.text as string) ?? "";
				streamedRef.current = "";
				setStreamedText("");
				// Add as timeline entry
				setEntries((prev) => [
					...prev,
					{ id: evtId, kind: evt.kind, ts: evt.ts, data: { text } },
				]);
				return;
			} else if (evt.kind === "invocation_end") {
				const s = evt.data.status as string;
				setStatus(s === "success" ? "success" : "error");
			}

			setEntries((prev) => [
				...prev,
				{ id: evtId, kind: evt.kind, ts: evt.ts, data: evt.data },
			]);
		},
		[],
	);

	// Connect WebSocket to listen for new events in real-time
	useEffect(() => {
		AsyncStorage.getItem(WS_KEY).then((raw) => {
			if (!raw) return;
			const cfg = JSON.parse(raw);
			connectWs(cfg.url, cfg.token);
		});
		return () => {
			ws.current?.close();
		};
	}, []);

	const connectWs = useCallback(
		(url: string, token?: string) => {
			const wsUrl = url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
			const params = token
				? `${wsUrl.includes("?") ? "&" : "?"}token=${token}`
				: "";
			const socket = new WebSocket(`${wsUrl}${params}`);
			ws.current = socket;

			socket.onclose = () => {
				setTimeout(() => {
					if (ws.current === socket) connectWs(wsUrl, token);
				}, 3000);
			};

			socket.onmessage = (e) => {
				try {
					const msg = JSON.parse(e.data);
					if (
						msg.type === "sub_agent_event" &&
						msg.event?.runId === runId
					) {
						processEvent(msg.event as SubAgentEvent);
					}
				} catch {
					// ignore
				}
			};
		},
		[runId, processEvent],
	);

	const statusIcon: keyof typeof Ionicons.glyphMap =
		status === "running"
			? "ellipsis-horizontal-circle"
			: status === "success"
				? "checkmark-circle"
				: "close-circle";

	const statusColor =
		status === "running"
			? infoColor
			: status === "success"
				? successColor
				: dangerColor;

	const statusLabel =
		status === "running"
			? "Running…"
			: status === "success"
				? "Completed"
				: "Error";

	return (
		<YStack flex={1} backgroundColor={bg}>
			<Stack.Screen
				options={{
					headerShown: true,
					headerTitle: agentId ? `@${agentId}` : "Sub-Agent",
					headerTintColor: textColor,
					headerStyle: { backgroundColor: bgSecondary },
					headerLeft: () => (
						<Button
							onPress={() => router.back()}
							width={32}
							height={32}
							borderRadius={16}
							backgroundColor="transparent"
							borderWidth={0}
							padding={0}
							justifyContent="center"
							alignItems="center"
						>
							<Ionicons name="arrow-back" size={22} color={textColor} />
						</Button>
					),
					headerRight: () => (
						<XStack gap={4} alignItems="center" paddingRight={8}>
							<Ionicons name={statusIcon} size={16} color={statusColor} />
							<Text fontSize={13} fontWeight="600" color={statusColor}>
								{statusLabel}
							</Text>
						</XStack>
					),
				}}
			/>

			<FlashList
				data={entries}
				keyExtractor={(item) => item.id}
				contentContainerStyle={{
					paddingTop: 8,
					paddingBottom: insets.bottom + 16,
				}}
				ListHeaderComponent={
					streamedText ? (
						<StreamingTextBubble
							text={streamedText}
							bgTertiary={bgTertiary}
							textColor={textColor}
							textSecondary={textSecondary}
						/>
					) : null
				}
				renderItem={({ item }) => (
					<TimelineItem
						entry={item}
						textColor={textColor}
						textSecondary={textSecondary}
						bgTertiary={bgTertiary}
						bgInput={bgInput}
						borderColor={borderColor}
						successColor={successColor}
						dangerColor={dangerColor}
						infoColor={infoColor}
						warningColor={warningColor}
					/>
				)}
			/>
		</YStack>
	);
}

// ── Timeline item component ─────────────────────────────────────────

function TimelineItem({
	entry,
	textColor,
	textSecondary,
	bgTertiary,
	bgInput,
	borderColor,
	successColor,
	dangerColor,
	infoColor,
	warningColor,
}: {
	entry: TimelineEntry;
	textColor: string;
	textSecondary: string;
	bgTertiary: string;
	bgInput: string;
	borderColor: string;
	successColor: string;
	dangerColor: string;
	infoColor: string;
	warningColor: string;
}) {
	switch (entry.kind) {
		case "invocation_start": {
			const prompt = entry.data.prompt as string | undefined;
			return (
				<XStack gap={10} paddingHorizontal={16} paddingVertical={6} alignItems="flex-start">
					<YStack width={20} alignItems="center" paddingTop={3}>
						<Ionicons name="play-circle" size={16} color={infoColor} />
					</YStack>
					<YStack flex={1} gap={2}>
						<XStack justifyContent="space-between">
							<Text fontSize={13} fontWeight="600" color={textColor}>
								Invocation started
							</Text>
							<Text fontSize={10} color={textSecondary}>
								{formatTime(entry.ts)}
							</Text>
						</XStack>
						{prompt ? (
							<YStack
								backgroundColor={bgInput}
								borderRadius={8}
								paddingHorizontal={10}
								paddingVertical={6}
								marginTop={4}
							>
								<Text fontSize={12} color={textSecondary} numberOfLines={4}>
									{prompt}
								</Text>
							</YStack>
						) : null}
					</YStack>
				</XStack>
			);
		}

		case "tool_call_start": {
			const toolName = (entry.data.toolName as string) ?? "unknown";
			const args = entry.data.args;
			const argsStr = formatArgs(args);
			return (
				<XStack gap={10} paddingHorizontal={16} paddingVertical={6} alignItems="flex-start">
					<YStack width={20} alignItems="center" paddingTop={3}>
						<Ionicons name="construct" size={14} color={warningColor} />
					</YStack>
					<YStack flex={1} gap={2}>
						<XStack justifyContent="space-between">
							<Text fontSize={13} fontWeight="600" color={textColor}>
								{toolName}
							</Text>
							<Text fontSize={10} color={textSecondary}>
								{formatTime(entry.ts)}
							</Text>
						</XStack>
						{argsStr ? (
							<YStack
								backgroundColor={bgInput}
								borderRadius={8}
								paddingHorizontal={10}
								paddingVertical={6}
								marginTop={2}
							>
								<Text fontSize={11} color={textSecondary} fontFamily="$body" numberOfLines={6}>
									{argsStr}
								</Text>
							</YStack>
						) : null}
					</YStack>
				</XStack>
			);
		}

		case "tool_call_end": {
			const toolName = (entry.data.toolName as string) ?? "unknown";
			const isError = entry.data.isError === true;
			return (
				<XStack gap={10} paddingHorizontal={16} paddingVertical={4} alignItems="center">
					<YStack width={20} alignItems="center">
						<Ionicons
							name={isError ? "close-circle" : "checkmark-circle"}
							size={13}
							color={isError ? dangerColor : successColor}
						/>
					</YStack>
					<Text fontSize={12} color={isError ? dangerColor : textSecondary}>
						{toolName} — {isError ? "failed" : "done"}
					</Text>
					<XStack flex={1} justifyContent="flex-end">
						<Text fontSize={10} color={textSecondary}>
							{formatTime(entry.ts)}
						</Text>
					</XStack>
				</XStack>
			);
		}

		case "message_end": {
			const text = (entry.data.text as string) ?? "";
			return (
				<YStack paddingHorizontal={16} paddingVertical={6}>
					<YStack
						backgroundColor={bgTertiary}
						borderRadius={14}
						paddingHorizontal={14}
						paddingVertical={10}
					>
						<Text fontSize={14} color={textColor} lineHeight={20}>
							{text}
						</Text>
					</YStack>
					<XStack justifyContent="flex-end" paddingTop={2}>
						<Text fontSize={10} color={textSecondary}>
							{formatTime(entry.ts)}
						</Text>
					</XStack>
				</YStack>
			);
		}

		case "invocation_end": {
			const st = entry.data.status as string;
			const isError = st === "error";
			const errorMsg = entry.data.error as string | undefined;
			return (
				<XStack gap={10} paddingHorizontal={16} paddingVertical={6} alignItems="flex-start">
					<YStack width={20} alignItems="center" paddingTop={3}>
						<Ionicons
							name={isError ? "close-circle" : "checkmark-circle"}
							size={16}
							color={isError ? dangerColor : successColor}
						/>
					</YStack>
					<YStack flex={1} gap={2}>
						<XStack justifyContent="space-between">
							<Text
								fontSize={13}
								fontWeight="600"
								color={isError ? dangerColor : successColor}
							>
								{isError ? "Failed" : "Completed"}
							</Text>
							<Text fontSize={10} color={textSecondary}>
								{formatTime(entry.ts)}
							</Text>
						</XStack>
						{isError && errorMsg ? (
							<Text fontSize={12} color={dangerColor} numberOfLines={3}>
								{errorMsg}
							</Text>
						) : null}
					</YStack>
				</XStack>
			);
		}

		default:
			return null;
	}
}

// ── Streaming text bubble (shown at top while text is streaming) ────

function StreamingTextBubble({
	text,
	bgTertiary,
	textColor,
	textSecondary,
}: {
	text: string;
	bgTertiary: string;
	textColor: string;
	textSecondary: string;
}) {
	return (
		<YStack paddingHorizontal={16} paddingVertical={6}>
			<XStack gap={4} alignItems="center" paddingBottom={4}>
				<Ionicons name="chatbubble-ellipses-outline" size={12} color={textSecondary} />
				<Text fontSize={11} color={textSecondary}>
					Thinking…
				</Text>
			</XStack>
			<YStack
				backgroundColor={bgTertiary}
				borderRadius={14}
				paddingHorizontal={14}
				paddingVertical={10}
			>
				<Text fontSize={14} color={textColor} lineHeight={20}>
					{text}
				</Text>
			</YStack>
		</YStack>
	);
}

// ── Global store for sub-agent events (populated by index.tsx) ──────

export const globalSubAgentEvents = new Map<string, SubAgentEvent[]>();
