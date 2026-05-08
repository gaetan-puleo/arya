import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable } from "react-native";
import Animated, { FadeInLeft } from "react-native-reanimated";
import { SizableText, Text, useTheme, XStack, YStack } from "tamagui";

export type SubAgentStatus = "running" | "success" | "error";

export interface SubAgentRunInfo {
	runId: string;
	agentId: string;
	status: SubAgentStatus;
	toolCount: number;
	startTs: number;
	endTs?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getThemeColor = (theme: any, key: string): string => {
	const val = theme[key];
	if (val && typeof val.get === "function") return val.get();
	return typeof val === "string" ? val : "";
};

function formatDuration(startTs: number, endTs?: number): string {
	const ms = (endTs ?? Date.now()) - startTs;
	if (ms < 1000) return `${ms}ms`;
	const s = Math.round(ms / 100) / 10;
	return `${s}s`;
}

export default function SubAgentCard({ run }: { run: SubAgentRunInfo }) {
	const theme = useTheme();
	const router = useRouter();

	const textColor = getThemeColor(theme, "text");
	const textSecondary = getThemeColor(theme, "textSecondary");
	const bgTertiary = getThemeColor(theme, "backgroundTertiary");
	const borderColor = getThemeColor(theme, "border");
	const successColor = getThemeColor(theme, "success");
	const dangerColor = getThemeColor(theme, "danger");
	const infoColor = getThemeColor(theme, "info");

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
			<YStack
				alignItems="flex-start"
				paddingHorizontal={16}
				paddingVertical={4}
			>
				<XStack gap={8} alignItems="flex-end" maxWidth="85%">
					{/* Avatar */}
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
						<SizableText fontSize={13} fontWeight="700" color="#1A1A1A">
							A
						</SizableText>
					</YStack>

					{/* Card */}
					<Pressable
						onPress={() =>
							router.push({
								pathname: "/sub-agent/[runId]",
								params: { runId: run.runId },
							})
						}
						style={{ flex: 1 }}
					>
						<YStack
							backgroundColor={bgTertiary}
							borderRadius={16}
							borderBottomLeftRadius={6}
							borderWidth={1}
							borderColor={borderColor}
							paddingHorizontal={12}
							paddingVertical={10}
							gap={6}
						>
							{/* Header row */}
							<XStack gap={6} alignItems="center">
								<Ionicons name="git-branch-outline" size={13} color={textSecondary} />
								<Text
									fontSize={13}
									fontWeight="600"
									color={textColor}
									flex={1}
									numberOfLines={1}
								>
									@{run.agentId}
								</Text>
								<Ionicons name={statusIcon} size={14} color={statusColor} />
							</XStack>

							{/* Meta row */}
							<XStack gap={10} alignItems="center">
								{run.toolCount > 0 && (
									<XStack gap={3} alignItems="center">
										<Ionicons name="construct-outline" size={11} color={textSecondary} />
										<Text fontSize={11} color={textSecondary}>
											{run.toolCount} tool{run.toolCount > 1 ? "s" : ""}
										</Text>
									</XStack>
								)}
								<XStack gap={3} alignItems="center">
									<Ionicons name="time-outline" size={11} color={textSecondary} />
									<Text fontSize={11} color={textSecondary}>
										{formatDuration(run.startTs, run.endTs)}
									</Text>
								</XStack>
								<XStack flex={1} justifyContent="flex-end">
									<XStack gap={2} alignItems="center">
										<Text fontSize={11} color={infoColor}>
											Details
										</Text>
										<Ionicons name="chevron-forward" size={11} color={infoColor} />
									</XStack>
								</XStack>
							</XStack>
						</YStack>
					</Pressable>
				</XStack>
			</YStack>
		</Animated.View>
	);
}
