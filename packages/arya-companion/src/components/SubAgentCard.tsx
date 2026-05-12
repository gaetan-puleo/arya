import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInLeft } from "react-native-reanimated";
import { useTheme } from "@/theme/ThemeContext";
import { AryaAvatar } from "@/components/Primitives";

type SubAgentStatus = "running" | "success" | "error";

export interface SubAgentRunInfo {
	runId: string;
	agentId: string;
	status: SubAgentStatus;
	toolCount: number;
	startTs: number;
	endTs?: number;
}

function formatDuration(startTs: number, endTs?: number): string {
	const ms = (endTs ?? Date.now()) - startTs;
	if (ms < 1000) return `${ms}ms`;
	const s = Math.round(ms / 100) / 10;
	return `${s}s`;
}

export default function SubAgentCard({ run }: { run: SubAgentRunInfo }) {
	const theme = useTheme();
	const router = useRouter();

	const statusIcon: keyof typeof Ionicons.glyphMap =
		run.status === "running"
			? "ellipsis-horizontal"
			: run.status === "success"
				? "checkmark-circle"
				: "close-circle";

	const statusColor =
		run.status === "running"
			? theme.colors.info
			: run.status === "success"
				? theme.colors.success
				: theme.colors.danger;

	return (
		<Animated.View entering={FadeInLeft.duration(250).springify()}>
			<View className="items-start px-4">
				<View className="flex-row gap-2 items-end max-w-[85%]">
					<AryaAvatar size={24} />

					<Pressable
						onPress={() =>
							router.push({
								pathname: "/sub-agent/[runId]",
								params: { runId: run.runId },
							})
						}
						className="flex-1"
					>
						<View
							className="bg-bg-tertiary rounded-card border border-border px-3 py-3 gap-1.5"
							style={{ borderBottomLeftRadius: 6 }}
						>
							{/* Header row */}
							<View className="flex-row gap-1.5 items-center">
								<Ionicons
									name="git-branch-outline"
									size={13}
									color={theme.colors.textSecondary}
								/>
								<Text
									numberOfLines={1}
									className="text-sm font-semibold text-text flex-1"
								>
									@{run.agentId}
								</Text>
								<Ionicons name={statusIcon} size={14} color={statusColor} />
							</View>

							{/* Meta row */}
							<View className="flex-row gap-2 items-center">
								{run.toolCount > 0 && (
									<View className="flex-row gap-1 items-center">
										<Ionicons
											name="construct-outline"
											size={11}
											color={theme.colors.textSecondary}
										/>
										<Text className="text-xs text-text-secondary">
											{run.toolCount} tool{run.toolCount > 1 ? "s" : ""}
										</Text>
									</View>
								)}
								<View className="flex-row gap-1 items-center">
									<Ionicons
										name="time-outline"
										size={11}
										color={theme.colors.textSecondary}
									/>
									<Text className="text-xs text-text-secondary">
										{formatDuration(run.startTs, run.endTs)}
									</Text>
								</View>
								<View className="flex-1 flex-row justify-end">
									<View className="flex-row gap-0.5 items-center">
										<Text className="text-xs text-info">Details</Text>
										<Ionicons
											name="chevron-forward"
											size={11}
											color={theme.colors.info}
										/>
									</View>
								</View>
							</View>
						</View>
					</Pressable>
				</View>
			</View>
		</Animated.View>
	);
}
