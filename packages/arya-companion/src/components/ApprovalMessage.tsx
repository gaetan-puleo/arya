import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useUnistyles } from "@/theme/ThemeContext";
import { AryaAvatar } from "@/components/Primitives";
import type { ApprovalData } from "@/types/approval";

const ARGS_MAX_LENGTH = 300;

function summarizeArgs(args: string | undefined): string | undefined {
	if (!args) return undefined;
	return args.length > ARGS_MAX_LENGTH
		? `${args.slice(0, ARGS_MAX_LENGTH)}…`
		: args;
}

export default function ApprovalMessage({
	toolName,
	toolArgs: args,
	status,
	onApprove,
	onDeny,
}: Omit<ApprovalData, "msgId" | "requestId" | "token"> & {
	onApprove: () => void;
	onDeny: () => void;
}) {
	const [expanded, setExpanded] = useState(true);
	const { theme } = useUnistyles();

	const textColor = theme.colors.text;
	const textSecondary = theme.colors.textSecondary;
	const bgTertiary = theme.colors.backgroundTertiary;
	const successColor = theme.colors.success;
	const dangerColor = theme.colors.danger;
	const borderColor = theme.colors.border;

	const summary = summarizeArgs(args);

	return (
		<View style={{ alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 2 }}>
			<View
				style={{
					flexDirection: "row",
					gap: 8,
					alignItems: "flex-end",
					maxWidth: "85%",
				}}
			>
				<AryaAvatar size={24} />
				<View
					style={{
						backgroundColor: bgTertiary,
						borderRadius: 16,
						borderBottomLeftRadius: 6,
						paddingHorizontal: 10,
						paddingVertical: 8,
						flex: 1,
						gap: 6,
					}}
				>
					{/* Header: shield + tool name + expand toggle */}
					<Pressable
						onPress={summary ? () => setExpanded((v) => !v) : undefined}
						style={({ pressed }) => ({
							flexDirection: "row",
							gap: 6,
							alignItems: "center",
							paddingVertical: 4,
							opacity: summary && pressed ? 0.6 : 1,
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
						{summary ? (
							<View style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
								<Text style={{ fontSize: 11, color: textSecondary }}>
									{expanded ? "hide" : "show more…"}
								</Text>
								<Ionicons
									name={expanded ? "chevron-up" : "chevron-down"}
									size={12}
									color={textSecondary}
								/>
							</View>
						) : null}
					</Pressable>

					{/* Collapsible args */}
					{expanded && summary ? (
						<View
							style={{
								backgroundColor: "rgba(255,255,255,0.06)",
								borderRadius: 6,
								paddingHorizontal: 8,
								paddingVertical: 6,
							}}
						>
							<Text style={{ fontSize: 11, color: textSecondary }}>{summary}</Text>
						</View>
					) : null}

					{/* Buttons / Status */}
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
									borderRadius: 14,
									backgroundColor: "transparent",
									borderWidth: 1,
									borderColor,
									flexDirection: "row",
									gap: 3,
									alignItems: "center",
									justifyContent: "center",
									opacity: pressed ? 0.7 : 1,
									transform: [{ scale: pressed ? 0.97 : 1 }],
								})}
							>
								<Ionicons name="close" size={13} color={dangerColor} />
								<Text style={{ fontSize: 12, fontWeight: "600", color: dangerColor }}>
									Deny
								</Text>
							</Pressable>
							<Pressable
								onPress={onApprove}
								style={({ pressed }) => ({
									height: 28,
									paddingHorizontal: 12,
									borderRadius: 14,
									backgroundColor: successColor,
									flexDirection: "row",
									gap: 3,
									alignItems: "center",
									justifyContent: "center",
									opacity: pressed ? 0.7 : 1,
									transform: [{ scale: pressed ? 0.97 : 1 }],
								})}
							>
								<Ionicons name="checkmark" size={13} color="#FFFFFF" />
								<Text style={{ fontSize: 12, fontWeight: "600", color: "#FFFFFF" }}>
									Allow
								</Text>
							</Pressable>
						</View>
					) : (
						<View
							style={{
								flexDirection: "row",
								gap: 4,
								alignItems: "center",
								justifyContent: "flex-end",
							}}
						>
							<Ionicons
								name={status === "approved" ? "checkmark-circle" : "close-circle"}
								size={14}
								color={status === "approved" ? successColor : dangerColor}
							/>
							<Text
								style={{
									fontSize: 12,
									fontWeight: "600",
									color: status === "approved" ? successColor : dangerColor,
								}}
							>
								{status === "approved" ? "Approved" : "Denied"}
							</Text>
						</View>
					)}
				</View>
			</View>
		</View>
	);
}
