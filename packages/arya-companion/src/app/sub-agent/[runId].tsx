import { FlashList } from "@shopify/flash-list";
import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "@/theme/ThemeContext";
import type { SubAgentEvent, SubAgentEventKind } from "@/lib/ws";
import { globalSubAgentEvents } from "@/lib/subAgentStore";
import { createReconnectingSocket } from "@/lib/ws-client";
import { formatArgs, formatTime } from "@/utils/format";
import { IconButton } from "@/components/Primitives";

const WS_KEY = "arya-companion-ws";

/** Timeline entry rendered in the FlatList */
interface TimelineEntry {
	id: string;
	kind: SubAgentEventKind;
	ts: number;
	data: Record<string, unknown>;
}

export default function SubAgentDetailScreen() {
	const { runId } = useLocalSearchParams<{ runId: string }>();
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const { theme } = useUnistyles();

	const bg = theme.colors.background;
	const bgTertiary = theme.colors.backgroundTertiary;
	const bgInput = theme.colors.backgroundInput;
	const textColor = theme.colors.text;
	const textSecondary = theme.colors.textSecondary;
	const borderColor = theme.colors.border;
	const successColor = theme.colors.success;
	const dangerColor = theme.colors.danger;
	const infoColor = theme.colors.info;
	const warningColor = theme.colors.warning;

	const [agentId, setAgentId] = useState<string>("");
	const [status, setStatus] = useState<"running" | "success" | "error">("running");
	const [entries, setEntries] = useState<TimelineEntry[]>([]);
	const [streamedText, setStreamedText] = useState("");
	const streamedRef = useRef("");
	const ws = useRef<WebSocket | null>(null);
	const seenIds = useRef(new Set<string>());

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
				return;
			} else if (evt.kind === "message_end") {
				const text = (evt.data.text as string) ?? "";
				streamedRef.current = "";
				setStreamedText("");
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

	// Load events that were already collected before navigating here
	useEffect(() => {
		const stored = globalSubAgentEvents.get(runId ?? "");
		if (stored) {
			for (const evt of stored) {
				processEvent(evt);
			}
		}
	}, [runId, processEvent]);

	// Connect WebSocket to listen for new events in real-time
	useEffect(() => {
		AsyncStorage.getItem(WS_KEY).then((raw) => {
			if (!raw) return;
			const cfg = JSON.parse(raw);
			const socket = createReconnectingSocket(
				cfg.url,
				cfg.token,
				(msg) => {
					const m = msg as Record<string, unknown>;
					if (
						m.type === "sub_agent_event" &&
						(m.event as Record<string, unknown>)?.runId === runId
					) {
						processEvent(m.event as SubAgentEvent);
					}
				},
			);
			ws.current = socket;
		});
		return () => {
			ws.current?.close();
		};
	}, [runId, processEvent]);

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
		<View style={{ flex: 1, backgroundColor: bg }}>
			<Stack.Screen
				options={{
					headerShown: true,
					headerTitle: agentId ? `@${agentId}` : "Sub-Agent",
					headerTintColor: textColor,
					headerStyle: { backgroundColor: theme.colors.backgroundSecondary },
					headerLeft: () => (
						<IconButton name="arrow-back" onPress={() => router.back()} />
					),
					headerRight: () => (
						<View
							style={{
								flexDirection: "row",
								gap: 4,
								alignItems: "center",
								paddingRight: 8,
							}}
						>
							<Ionicons name={statusIcon} size={16} color={statusColor} />
							<Text style={{ fontSize: 14, fontWeight: "600", color: statusColor }}>
								{statusLabel}
							</Text>
						</View>
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
		</View>
	);
}

// ── Timeline item component ─────────────────────────────────────────

function TimelineItem({
	entry,
	textColor,
	textSecondary,
	bgTertiary,
	bgInput,
	borderColor: _borderColor,
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
				<Row gap={10} paddingH={16} paddingV={6} iconColor={infoColor} icon="play-circle" iconSize={16}>
					<View style={{ flex: 1, gap: 2 }}>
						<RowInner justifyBetween>
							<Text style={{ fontSize: 14, fontWeight: "600", color: textColor }}>
								Invocation started
							</Text>
							<Text style={{ fontSize: 10, color: textSecondary }}>
								{formatTime(entry.ts)}
							</Text>
						</RowInner>
						{prompt ? (
							<CodeBox>{prompt}</CodeBox>
						) : null}
					</View>
				</Row>
			);
		}

		case "tool_call_start": {
			const toolName = (entry.data.toolName as string) ?? "unknown";
			const args = entry.data.args;
			const argsStr = formatArgs(args);
			return (
				<Row gap={10} paddingH={16} paddingV={6} iconColor={warningColor} icon="construct" iconSize={14}>
					<View style={{ flex: 1, gap: 2 }}>
						<RowInner justifyBetween>
							<Text style={{ fontSize: 14, fontWeight: "600", color: textColor }}>
								{toolName}
							</Text>
							<Text style={{ fontSize: 10, color: textSecondary }}>
								{formatTime(entry.ts)}
							</Text>
						</RowInner>
						{argsStr ? (
							<CodeBox>{argsStr}</CodeBox>
						) : null}
					</View>
				</Row>
			);
		}

		case "tool_call_end": {
			const toolName = (entry.data.toolName as string) ?? "unknown";
			const isError = entry.data.isError === true;
			return (
				<Row
					paddingH={16}
					paddingV={4}
					alignCenter
					iconColor={isError ? dangerColor : successColor}
					icon={isError ? "close-circle" : "checkmark-circle"}
					iconSize={13}
				>
					<Text style={{ fontSize: 12, color: isError ? dangerColor : textSecondary }}>
						{toolName} — {isError ? "failed" : "done"}
					</Text>
					<View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end" }}>
						<Text style={{ fontSize: 10, color: textSecondary }}>
							{formatTime(entry.ts)}
						</Text>
					</View>
				</Row>
			);
		}

		case "message_end": {
			const text = (entry.data.text as string) ?? "";
			return (
				<MessageBubble text={text} textColor={textColor} time={formatTime(entry.ts)} />
			);
		}

		case "invocation_end": {
			const st = entry.data.status as string;
			const isError = st === "error";
			const errorMsg = entry.data.error as string | undefined;
			return (
				<Row gap={10} paddingH={16} paddingV={6} iconColor={isError ? dangerColor : successColor} icon={isError ? "close-circle" : "checkmark-circle"} iconSize={16}>
					<View style={{ flex: 1, gap: 2 }}>
						<RowInner justifyBetween>
							<Text
								style={{
									fontSize: 14,
									fontWeight: "600",
									color: isError ? dangerColor : successColor,
								}}
							>
								{isError ? "Failed" : "Completed"}
							</Text>
							<Text style={{ fontSize: 10, color: textSecondary }}>
								{formatTime(entry.ts)}
							</Text>
						</RowInner>
						{isError && errorMsg ? (
							<Text numberOfLines={3} style={{ fontSize: 12, color: dangerColor }}>
								{errorMsg}
							</Text>
						) : null}
					</View>
				</Row>
			);
		}

		default:
			return null;
	}
}

// ── Streaming text bubble ──────────────────────────────────────────────

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
		<View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
			<Row gap={4} alignBottom paddingV={4}>
				<Ionicons name="chatbubble-ellipses-outline" size={12} color={textSecondary} />
				<Text style={{ fontSize: 12, color: textSecondary }}>Thinking…</Text>
			</Row>
			<Bubble bg={bgTertiary}>
				<Text style={{ fontSize: 14, color: textColor, lineHeight: 20 }}>
					{text}
				</Text>
			</Bubble>
		</View>
	);
}

// ── Shared layout helpers ──────────────────────────────────────────────

function Row({
	children,
	gap = 0,
	paddingH,
	paddingV,
	alignCenter,
	alignBottom,
	justifyBetween,
	iconColor,
	icon,
	iconSize = 14,
}: {
	children: React.ReactNode;
	gap?: number;
	paddingH?: number;
	paddingV?: number;
	alignCenter?: boolean;
	alignBottom?: boolean;
	justifyBetween?: boolean;
	iconColor?: string;
	icon?: keyof typeof Ionicons.glyphMap;
	iconSize?: number;
}) {
	return (
		<View
			style={{
				flexDirection: "row",
				gap,
				paddingHorizontal: paddingH,
				paddingVertical: paddingV,
				alignItems: alignCenter ? "center" : alignBottom ? "flex-end" : "flex-start",
				justifyContent: justifyBetween ? "space-between" : undefined,
			}}
		>
			{icon && (
				<View style={{ width: 20, alignItems: "center", paddingTop: alignCenter ? undefined : 3 }}>
					<Ionicons name={icon} size={iconSize} color={iconColor!} />
				</View>
			)}
			{children}
		</View>
	);
}

function CodeBox({ children }: { children: React.ReactNode }) {
	return (
		<View
			style={{
				backgroundColor: "rgba(255,255,255,0.06)",
				borderRadius: 8,
				paddingHorizontal: 12,
				paddingVertical: 6,
				marginTop: 4,
			}}
		>
			<Text numberOfLines={6} style={{ fontSize: 12, color: "#B4B4B4" }}>
				{children}
			</Text>
		</View>
	);
}

function Bubble({
	children,
	bg,
}: {
	children: React.ReactNode;
	bg: string;
}) {
	return (
		<View
			style={{
				backgroundColor: bg,
				borderRadius: 16,
				paddingHorizontal: 16,
				paddingVertical: 12,
			}}
		>
			{children}
		</View>
	);
}

function MessageBubble({
	text,
	textColor,
	time,
}: {
	text: string;
	textColor: string;
	time: string;
}) {
	return (
		<View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
			<Bubble bg="#2F2F2F">
				<Text style={{ fontSize: 14, color: textColor, lineHeight: 20 }}>
					{text}
				</Text>
			</Bubble>
			<RowInner justifyBetween>
				<View />
				<Text style={{ fontSize: 10, color: "#B4B4B4" }}>{time}</Text>
			</RowInner>
		</View>
	);
}

function RowInner({
	children,
	justifyBetween,
}: {
	children: React.ReactNode;
	justifyBetween?: boolean;
}) {
	return (
		<View
			style={{
				flexDirection: "row",
				justifyContent: justifyBetween ? "space-between" : undefined,
			}}
		>
			{children}
		</View>
	);
}
