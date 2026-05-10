import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useUnistyles } from "@/theme/ThemeContext";
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
	const { theme } = useUnistyles();
	return (
		<View
			style={{
				borderRadius: 12,
				borderWidth: 1,
				borderColor: theme.colors.border,
				backgroundColor: theme.colors.backgroundSecondary,
				paddingHorizontal: 12,
				paddingVertical: 12,
				gap: 8,
			}}
		>
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
	const { theme } = useUnistyles();

	const textColor = theme.colors.text;
	const textSecondary = theme.colors.textSecondary;
	const bgTertiary = theme.colors.backgroundTertiary;
	const successColor = theme.colors.success;
	const dangerColor = theme.colors.danger;
	const borderColor = theme.colors.border;

	const monoFamily = Platform.OS === "ios" ? "Menlo-Regular" : "monospace";

	return (
		<View
			style={{
				paddingHorizontal: 16,
			}}
		>
			<Widget>
				{/* Header */}
				{(() => {
					const canExpand = !!summary || !!result;
					const statusColor =
						status === "approved"
							? successColor
							: status === "denied"
								? dangerColor
								: null;
					return (
						<Pressable
							onPress={canExpand ? () => setExpanded((v) => !v) : undefined}
							style={({ pressed }) => ({
								flexDirection: "row",
								gap: 6,
								alignItems: "center",
								opacity: canExpand && pressed ? 0.6 : 1,
							})}
						>
							<Ionicons name="shield-outline" size={12} color={textSecondary} />
							<Text
								numberOfLines={1}
								style={{
									fontSize: 12,
									fontWeight: "500",
									color: textColor,
									flex: 1,
								}}
							>
								{toolName}
							</Text>
							{statusColor ? (
								<View
									style={{
										flexDirection: "row",
										gap: 4,
										alignItems: "center",
									}}
								>
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
										style={{
											fontSize: 12,
											fontWeight: "600",
											color: statusColor,
										}}
									>
										{status === "approved" ? "Approved" : "Denied"}
									</Text>
								</View>
							) : null}
							{canExpand ? (
								<Ionicons
									name={expanded ? "chevron-up" : "chevron-down"}
									size={12}
									color={textSecondary}
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
						style={{
							alignSelf: "stretch",
							backgroundColor: bgTertiary,
							borderRadius: 8,
						}}
						contentContainerStyle={{
							paddingHorizontal: 12,
							paddingVertical: 8,
						}}
					>
						<Text
							style={{
								fontFamily: monoFamily,
								fontSize: 12,
								lineHeight: 16,
								color: textColor,
							}}
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
						style={{
							alignSelf: "stretch",
							backgroundColor: bgTertiary,
							borderRadius: 8,
						}}
						contentContainerStyle={{
							paddingHorizontal: 12,
							paddingVertical: 8,
						}}
					>
						<Text
							style={{
								fontFamily: monoFamily,
								fontSize: 12,
								lineHeight: 16,
								color: textColor,
							}}
						>
							{result}
						</Text>
					</ScrollView>
				) : null}

				{/* Controls (pending only) */}
				{status === "pending" ? (
					<View
						style={{
							flexDirection: "row",
							gap: 6,
							justifyContent: "flex-end",
						}}
					>
						<Pressable
							onPress={onDeny}
							style={({ pressed }) => ({
								height: 28,
								paddingHorizontal: 12,
								borderRadius: 16,
								backgroundColor: "transparent",
								borderWidth: 1,
								borderColor,
								flexDirection: "row",
								gap: 4,
								alignItems: "center",
								justifyContent: "center",
								opacity: pressed ? 0.7 : 1,
								transform: [{ scale: pressed ? 0.97 : 1 }],
							})}
						>
							<Ionicons name="close" size={13} color={dangerColor} />
							<Text
								style={{ fontSize: 12, fontWeight: "600", color: dangerColor }}
							>
								Deny
							</Text>
						</Pressable>
						<Pressable
							onPress={onApprove}
							style={({ pressed }) => ({
								height: 28,
								paddingHorizontal: 12,
								borderRadius: 16,
								backgroundColor: successColor,
								flexDirection: "row",
								gap: 4,
								alignItems: "center",
								justifyContent: "center",
								opacity: pressed ? 0.7 : 1,
								transform: [{ scale: pressed ? 0.97 : 1 }],
							})}
						>
							<Ionicons name="checkmark" size={13} color="#FFFFFF" />
							<Text
								style={{ fontSize: 12, fontWeight: "600", color: "#FFFFFF" }}
							>
								Allow
							</Text>
						</Pressable>
					</View>
				) : null}
			</Widget>
		</View>
	);
}
