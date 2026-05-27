import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { ApprovalSnapshot } from "@/types/domain";
import { useTheme } from "@/theme/ThemeContext";

interface ApprovalCardProps {
	snapshot: ApprovalSnapshot;
	onApprove: () => void;
	onDeny: () => void;
}

/**
 * Approval card rendered inside the chat transcript. Pure — reads
 * everything from the snapshot prop.
 */
export default function ApprovalCard({
	snapshot,
	onApprove,
	onDeny,
}: ApprovalCardProps) {
	const summary = snapshot.toolArgsPretty || undefined;
	const status = snapshot.status;
	const [expanded, setExpanded] = useState(
		status === "pending" && (summary?.length ?? 0) <= 120,
	);
	const theme = useTheme();

	const statusColor =
		status === "approved"
			? theme.colors.success
			: status === "denied"
				? theme.colors.danger
				: null;
	const canExpand = !!summary;

	return (
		<View className="px-4">
			<View className="rounded-xl border border-border bg-bg-secondary px-3 py-3 gap-2">
				<Pressable
					onPress={canExpand ? () => setExpanded((v) => !v) : undefined}
					className={`flex-row gap-1.5 items-center ${canExpand ? "active:opacity-60" : ""}`}
				>
					<Ionicons
						name="shield-outline"
						size={12}
						color={theme.colors.textSecondary}
					/>
					<Text
						numberOfLines={1}
						className="text-xs font-medium text-text flex-1"
					>
						{snapshot.toolName}
					</Text>
					{statusColor ? (
						<View className="flex-row gap-1 items-center">
							<Ionicons
								name={
									status === "approved"
										? "checkmark-circle"
										: "close-circle"
								}
								size={13}
								color={statusColor}
							/>
							<Text
								className="text-xs font-semibold"
								style={{ color: statusColor }}
							>
								{status === "approved" ? "Approved" : "Denied"}
							</Text>
						</View>
					) : null}
					{canExpand ? (
						<Ionicons
							name={expanded ? "chevron-up" : "chevron-down"}
							size={12}
							color={theme.colors.textSecondary}
						/>
					) : null}
				</Pressable>

				{expanded && summary ? (
					<ScrollView
						horizontal
						showsHorizontalScrollIndicator={false}
						className="self-stretch bg-bg-tertiary rounded-lg"
						contentContainerStyle={{
							paddingHorizontal: 12,
							paddingVertical: 8,
						}}
					>
						<Text className="text-xs leading-4 text-text font-mono">
							{summary}
						</Text>
					</ScrollView>
				) : null}

				{status === "pending" ? (
					<View className="flex-row gap-1.5 justify-end">
						<Pressable
							onPress={onDeny}
							className="h-7 px-3 rounded-2xl border border-border flex-row gap-1 items-center justify-center active:opacity-70"
						>
							<Ionicons
								name="close"
								size={13}
								color={theme.colors.danger}
							/>
							<Text className="text-xs font-semibold text-danger">
								Deny
							</Text>
						</Pressable>
						<Pressable
							onPress={onApprove}
							className="h-7 px-3 rounded-2xl bg-success flex-row gap-1 items-center justify-center active:opacity-70"
						>
							<Ionicons name="checkmark" size={13} color="#FFFFFF" />
							<Text className="text-xs font-semibold text-white">
								Allow
							</Text>
						</Pressable>
					</View>
				) : null}
			</View>
		</View>
	);
}
