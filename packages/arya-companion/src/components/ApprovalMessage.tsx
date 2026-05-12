import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import type { ApprovalData } from "@/types/approval";

const ARGS_MAX_LENGTH = 600;

function prettyArgs(args: string | undefined): string | undefined {
	if (!args) return undefined;
	let out = args;
	try {
		out = JSON.stringify(JSON.parse(args), null, 2);
	} catch {
		// keep raw
	}
	return out.length > ARGS_MAX_LENGTH ? `${out.slice(0, ARGS_MAX_LENGTH)}…` : out;
}

function Widget({ children }: { children: React.ReactNode }) {
	return (
		<View className="rounded-xl border border-border bg-bg-secondary px-3 py-3 gap-2">
			{children}
		</View>
	);
}

export default function ApprovalMessage({
	toolName,
	toolArgs: args,
	toolResult,
	status,
	onApprove,
	onDeny,
}: Omit<ApprovalData, "msgId" | "requestId" | "token"> & {
	onApprove: () => void;
	onDeny: () => void;
}) {
	const summary = prettyArgs(args);
	const result = prettyArgs(toolResult);
	const [expanded, setExpanded] = useState(
		status === "pending" && (summary?.length ?? 0) <= 120,
	);
	const theme = useTheme();

	return (
		<View className="px-4">
			<Widget>
				{/* Header */}
				{(() => {
					const canExpand = !!summary || !!result;
					const statusColor =
						status === "approved"
							? theme.colors.success
							: status === "denied"
								? theme.colors.danger
								: null;
					return (
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
								{toolName}
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
					);
				})()}

				{/* Args preview */}
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
						<Text
							className="text-xs leading-4 text-text font-mono"
						>
							{summary}
						</Text>
					</ScrollView>
				) : null}

				{/* Result preview (resolved only) */}
				{status !== "pending" && expanded && result ? (
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
							{result}
						</Text>
					</ScrollView>
				) : null}

				{/* Controls (pending only) */}
				{status === "pending" ? (
					<View className="flex-row gap-1.5 justify-end">
						<Pressable
							onPress={onDeny}
							className="h-7 px-3 rounded-2xl border border-border flex-row gap-1 items-center justify-center active:opacity-70"
						>
							<Ionicons name="close" size={13} color={theme.colors.danger} />
							<Text className="text-xs font-semibold text-danger">Deny</Text>
						</Pressable>
						<Pressable
							onPress={onApprove}
							className="h-7 px-3 rounded-2xl bg-success flex-row gap-1 items-center justify-center active:opacity-70"
						>
							<Ionicons name="checkmark" size={13} color="#FFFFFF" />
							<Text className="text-xs font-semibold text-white">Allow</Text>
						</Pressable>
					</View>
				) : null}
			</Widget>
		</View>
	);
}
