import { FlashList } from "@shopify/flash-list";
import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "@/theme/ThemeContext";
import type { SubAgentEvent, SubAgentEventKind } from "@/lib/ws";

const WS_KEY = "arya-companion-ws";

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
	const { theme } = useUnistyles();

	const bg = theme.colors.background;
	const bgSecondary = theme.colors.backgroundSecondary;
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
	}, [runId, processEvent]);

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
	}, [connectWs]);

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
		<View style={{ flex: 1, backgroundColor: bg }}>
			<Stack.Screen
				options={{
					headerShown: true,
					headerTitle: agentId ? `@${agentId}` : "Sub-Agent",
					headerTintColor: textColor,
					headerStyle: { backgroundColor: bgSecondary },
					headerLeft: () => (
						<Pressable
							onPress={() => router.back()}
							style={{
								width: 32,
								height: 32,
								borderRadius: 16,
								backgroundColor: "transparent",
								justifyContent: "center",
								alignItems: "center",
							}}
						>
							<Ionicons name="arrow-back" size={22} color={textColor} />
						</Pressable>
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
							<Text style={{ fontSize: 13, fontWeight: "600", color: statusColor }}>
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
				<View
					style={{
						flexDirection: "row",
						gap: 10,
						paddingHorizontal: 16,
						paddingVertical: 6,
						alignItems: "flex-start",
					}}
				>
					<View style={{ width: 20, alignItems: "center", paddingTop: 3 }}>
						<Ionicons name="play-circle" size={16} color={infoColor} />
					</View>
					<View style={{ flex: 1, gap: 2 }}>
						<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
							<Text style={{ fontSize: 13, fontWeight: "600", color: textColor }}>
								Invocation started
							</Text>
							<Text style={{ fontSize: 10, color: textSecondary }}>
								{formatTime(entry.ts)}
							</Text>
						</View>
						{prompt ? (
							<View
								style={{
									backgroundColor: bgInput,
									borderRadius: 8,
									paddingHorizontal: 10,
									paddingVertical: 6,
									marginTop: 4,
								}}
							>
								<Text
									numberOfLines={4}
									style={{ fontSize: 12, color: textSecondary }}
								>
									{prompt}
								</Text>
							</View>
						) : null}
					</View>
				</View>
			);
		}

		case "tool_call_start": {
			const toolName = (entry.data.toolName as string) ?? "unknown";
			const args = entry.data.args;
			const argsStr = formatArgs(args);
			return (
				<View
					style={{
						flexDirection: "row",
						gap: 10,
						paddingHorizontal: 16,
						paddingVertical: 6,
						alignItems: "flex-start",
					}}
				>
					<View style={{ width: 20, alignItems: "center", paddingTop: 3 }}>
						<Ionicons name="construct" size={14} color={warningColor} />
					</View>
					<View style={{ flex: 1, gap: 2 }}>
						<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
							<Text style={{ fontSize: 13, fontWeight: "600", color: textColor }}>
								{toolName}
							</Text>
							<Text style={{ fontSize: 10, color: textSecondary }}>
								{formatTime(entry.ts)}
							</Text>
						</View>
						{argsStr ? (
							<View
								style={{
									backgroundColor: bgInput,
									borderRadius: 8,
									paddingHorizontal: 10,
									paddingVertical: 6,
									marginTop: 2,
								}}
							>
								<Text
									numberOfLines={6}
									style={{ fontSize: 11, color: textSecondary }}
								>
									{argsStr}
								</Text>
							</View>
						) : null}
					</View>
				</View>
			);
		}

		case "tool_call_end": {
			const toolName = (entry.data.toolName as string) ?? "unknown";
			const isError = entry.data.isError === true;
			return (
				<View
					style={{
						flexDirection: "row",
						gap: 10,
						paddingHorizontal: 16,
						paddingVertical: 4,
						alignItems: "center",
					}}
				>
					<View style={{ width: 20, alignItems: "center" }}>
						<Ionicons
							name={isError ? "close-circle" : "checkmark-circle"}
							size={13}
							color={isError ? dangerColor : successColor}
						/>
					</View>
					<Text style={{ fontSize: 12, color: isError ? dangerColor : textSecondary }}>
						{toolName} — {isError ? "failed" : "done"}
					</Text>
					<View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end" }}>
						<Text style={{ fontSize: 10, color: textSecondary }}>
							{formatTime(entry.ts)}
						</Text>
					</View>
				</View>
			);
		}

		case "message_end": {
			const text = (entry.data.text as string) ?? "";
			return (
				<View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
					<View
						style={{
							backgroundColor: bgTertiary,
							borderRadius: 14,
							paddingHorizontal: 14,
							paddingVertical: 10,
						}}
					>
						<Text style={{ fontSize: 14, color: textColor, lineHeight: 20 }}>
							{text}
						</Text>
					</View>
					<View style={{ flexDirection: "row", justifyContent: "flex-end", paddingTop: 2 }}>
						<Text style={{ fontSize: 10, color: textSecondary }}>
							{formatTime(entry.ts)}
						</Text>
					</View>
				</View>
			);
		}

		case "invocation_end": {
			const st = entry.data.status as string;
			const isError = st === "error";
			const errorMsg = entry.data.error as string | undefined;
			return (
				<View
					style={{
						flexDirection: "row",
						gap: 10,
						paddingHorizontal: 16,
						paddingVertical: 6,
						alignItems: "flex-start",
					}}
				>
					<View style={{ width: 20, alignItems: "center", paddingTop: 3 }}>
						<Ionicons
							name={isError ? "close-circle" : "checkmark-circle"}
							size={16}
							color={isError ? dangerColor : successColor}
						/>
					</View>
					<View style={{ flex: 1, gap: 2 }}>
						<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
							<Text
								style={{
									fontSize: 13,
									fontWeight: "600",
									color: isError ? dangerColor : successColor,
								}}
							>
								{isError ? "Failed" : "Completed"}
							</Text>
							<Text style={{ fontSize: 10, color: textSecondary }}>
								{formatTime(entry.ts)}
							</Text>
						</View>
						{isError && errorMsg ? (
							<Text
								numberOfLines={3}
								style={{ fontSize: 12, color: dangerColor }}
							>
								{errorMsg}
							</Text>
						) : null}
					</View>
				</View>
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
		<View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
			<View
				style={{
					flexDirection: "row",
					gap: 4,
					alignItems: "center",
					paddingBottom: 4,
				}}
			>
				<Ionicons name="chatbubble-ellipses-outline" size={12} color={textSecondary} />
				<Text style={{ fontSize: 11, color: textSecondary }}>Thinking…</Text>
			</View>
			<View
				style={{
					backgroundColor: bgTertiary,
					borderRadius: 14,
					paddingHorizontal: 14,
					paddingVertical: 10,
				}}
			>
				<Text style={{ fontSize: 14, color: textColor, lineHeight: 20 }}>
					{text}
				</Text>
			</View>
		</View>
	);
}

// ── Global store for sub-agent events (populated by index.tsx) ──────

export const globalSubAgentEvents = new Map<string, SubAgentEvent[]>();
