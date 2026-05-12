import { FlashList } from "@shopify/flash-list";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";
import { useAppStore } from "@/lib/appStore";
import TimelineItem, {
	type TimelineEntry,
} from "@/components/sub-agent/TimelineItem";
import StreamingTextBubble from "@/components/sub-agent/StreamingTextBubble";

/**
 * Sub-agent run detail screen.
 *
 * Reads the run's timeline straight from the app-level store (no
 * second WebSocket). The store accumulates `sub_agent_event` payloads
 * per `runId`; this screen derives the timeline entries + the live
 * streaming text by folding over that array.
 */
export default function SubAgentDetailScreen() {
	const { runId } = useLocalSearchParams<{ runId: string }>();
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const theme = useTheme();

	const events = useAppStore((s) => s.subAgentEvents.get(runId ?? "") ?? []);

	const { entries, streamedText, agentId, status } = useMemo(() => {
		const out: TimelineEntry[] = [];
		let buffer = "";
		let aid = "";
		let st: "running" | "success" | "error" = "running";

		for (const evt of events) {
			const id = `${evt.kind}-${evt.ts}`;

			if (evt.kind === "invocation_start") {
				aid = evt.agentId;
				out.push({ id, kind: evt.kind, ts: evt.ts, data: evt.data });
				continue;
			}
			if (evt.kind === "text_delta") {
				buffer += (evt.data.delta as string) ?? "";
				continue;
			}
			if (evt.kind === "message_end") {
				const text = (evt.data.text as string) ?? "";
				buffer = "";
				out.push({ id, kind: evt.kind, ts: evt.ts, data: { text } });
				continue;
			}
			if (evt.kind === "invocation_end") {
				const s = evt.data.status as string;
				st = s === "success" ? "success" : "error";
			}
			out.push({ id, kind: evt.kind, ts: evt.ts, data: evt.data });
		}

		return { entries: out, streamedText: buffer, agentId: aid, status: st };
	}, [events]);

	const statusIcon: keyof typeof Ionicons.glyphMap =
		status === "running"
			? "ellipsis-horizontal-circle"
			: status === "success"
				? "checkmark-circle"
				: "close-circle";

	const statusColor =
		status === "running"
			? theme.colors.info
			: status === "success"
				? theme.colors.success
				: theme.colors.danger;

	const statusLabel =
		status === "running"
			? "Running…"
			: status === "success"
				? "Completed"
				: "Error";

	return (
		<View className="flex-1 bg-bg">
			<Stack.Screen
				options={{
					headerShown: true,
					headerTitle: agentId ? `@${agentId}` : "Sub-Agent",
					headerTintColor: theme.colors.text,
					headerStyle: { backgroundColor: theme.colors.backgroundSecondary },
					headerLeft: () => (
						<Pressable
							onPress={() => router.back()}
							className="w-[34px] h-[34px] rounded-2xl justify-center items-center active:opacity-60"
						>
							<Ionicons name="arrow-back" size={20} color={theme.colors.text} />
						</Pressable>
					),
					headerRight: () => (
						<View className="flex-row gap-1 items-center pr-2">
							<Ionicons name={statusIcon} size={16} color={statusColor} />
							<Text
								className="text-sm font-semibold"
								style={{ color: statusColor }}
							>
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
					streamedText ? <StreamingTextBubble text={streamedText} /> : null
				}
				renderItem={({ item }) => <TimelineItem entry={item} />}
			/>
		</View>
	);
}
