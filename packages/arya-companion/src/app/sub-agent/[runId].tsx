import Ionicons from "@expo/vector-icons/Ionicons";
import { FlashList } from "@shopify/flash-list";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";
import { useAppStore } from "@/lib/appStore";
import TimelineItem from "@/components/sub-agent/TimelineItem";

/**
 * Sub-agent run detail screen.
 *
 * Reads the run's snapshot straight from the app-level store. Snapshots
 * are server-pushed; the timeline + status + agent id are all
 * server-derived. The companion has zero reduction logic for this view.
 */
export default function SubAgentDetailScreen() {
	const { runId } = useLocalSearchParams<{ runId: string }>();
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const theme = useTheme();

	const snapshot = useAppStore((s) =>
		runId ? s.subAgentRuns.get(runId) : undefined,
	);

	const entries = snapshot?.timeline ?? [];
	const status = snapshot?.status ?? "running";
	const agentId = snapshot?.agentId ?? "";

	const statusIcon: keyof typeof Ionicons.glyphMap =
		status === "running"
			? "ellipsis-horizontal-circle"
			: status === "done"
				? "checkmark-circle"
				: "close-circle";

	const statusColor =
		status === "running"
			? theme.colors.info
			: status === "done"
				? theme.colors.success
				: theme.colors.danger;

	const statusLabel =
		status === "running"
			? "Running…"
			: status === "done"
				? "Completed"
				: status === "error"
					? "Error"
					: "Aborted";

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
				renderItem={({ item }) => <TimelineItem row={item} />}
			/>
		</View>
	);
}
