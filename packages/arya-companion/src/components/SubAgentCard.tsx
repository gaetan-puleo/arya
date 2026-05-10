import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInLeft } from "react-native-reanimated";
import { useUnistyles } from "@/theme/ThemeContext";
import { AryaAvatar } from "@/components/Primitives";

export type SubAgentStatus = "running" | "success" | "error";

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
	const { theme } = useUnistyles();
	const router = useRouter();

	const textColor = theme.colors.text;
	const textSecondary = theme.colors.textSecondary;
	const bgTertiary = theme.colors.backgroundTertiary;
	const borderColor = theme.colors.border;
	const successColor = theme.colors.success;
	const dangerColor = theme.colors.danger;
	const infoColor = theme.colors.info;

	const statusIcon: keyof typeof Ionicons.glyphMap =
		run.status === "running"
			? "ellipsis-horizontal"
			: run.status === "success"
				? "checkmark-circle"
				: "close-circle";

	const statusColor =
		run.status === "running"
			? infoColor
			: run.status === "success"
				? successColor
				: dangerColor;

	return (
		<Animated.View entering={FadeInLeft.duration(250).springify()}>
			<View
				style={{
					alignItems: "flex-start",
					paddingHorizontal: 16,
				}}
			>
				<View
					style={{
						flexDirection: "row",
						gap: 8,
						alignItems: "flex-end",
						maxWidth: "85%",
					}}
				>
					<AryaAvatar size={24} />

					<Pressable
						onPress={() =>
							router.push({
								pathname: "/sub-agent/[runId]",
								params: { runId: run.runId },
							})
						}
						style={{ flex: 1 }}
					>
						<View
							style={{
								backgroundColor: bgTertiary,
								borderRadius: 16,
								borderBottomLeftRadius: 6,
								borderWidth: 1,
								borderColor,
								paddingHorizontal: 12,
								paddingVertical: 12,
								gap: 6,
							}}
						>
							{/* Header row */}
							<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
								<Ionicons name="git-branch-outline" size={13} color={textSecondary} />
								<Text
									numberOfLines={1}
									style={{
										fontSize: 14,
										fontWeight: "600",
										color: textColor,
										flex: 1,
									}}
								>
									@{run.agentId}
								</Text>
								<Ionicons name={statusIcon} size={14} color={statusColor} />
							</View>

							{/* Meta row */}
							<View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
								{run.toolCount > 0 && (
									<View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
										<Ionicons name="construct-outline" size={11} color={textSecondary} />
										<Text style={{ fontSize: 12, color: textSecondary }}>
											{run.toolCount} tool{run.toolCount > 1 ? "s" : ""}
										</Text>
									</View>
								)}
								<View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
									<Ionicons name="time-outline" size={11} color={textSecondary} />
									<Text style={{ fontSize: 12, color: textSecondary }}>
										{formatDuration(run.startTs, run.endTs)}
									</Text>
								</View>
								<View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end" }}>
									<View style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
										<Text style={{ fontSize: 12, color: infoColor }}>Details</Text>
										<Ionicons name="chevron-forward" size={11} color={infoColor} />
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
