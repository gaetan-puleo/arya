import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Button, Text, useTheme, XStack, YStack } from "tamagui";

export type ApprovalStatus = "pending" | "approved" | "denied";

interface ApprovalMessageProps {
	toolName: string;
	args?: string;
	status: ApprovalStatus;
	onApprove: () => void;
	onDeny: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getThemeColor = (theme: any, key: string): string => {
	const val = theme[key];
	if (val && typeof val.get === "function") return val.get();
	return typeof val === "string" ? val : "";
};

const ARGS_MAX_LENGTH = 300;

function summarizeArgs(args: string | undefined): string | undefined {
	if (!args) return undefined;
	return args.length > ARGS_MAX_LENGTH
		? `${args.slice(0, ARGS_MAX_LENGTH)}…`
		: args;
}

export default function ApprovalMessage({
	toolName,
	args,
	status,
	onApprove,
	onDeny,
}: ApprovalMessageProps) {
	const theme = useTheme();
	const [expanded, setExpanded] = useState(true);

	const textColor = getThemeColor(theme, "text");
	const textSecondary = getThemeColor(theme, "textSecondary");
	const bgTertiary = getThemeColor(theme, "backgroundTertiary");
	const successColor = getThemeColor(theme, "success");
	const dangerColor = getThemeColor(theme, "danger");
	const borderColor = getThemeColor(theme, "border");

	const summary = summarizeArgs(args);

	return (
		<YStack alignItems="flex-start" paddingHorizontal={16} paddingVertical={2}>
			<XStack gap={8} alignItems="flex-end" maxWidth="85%">
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
					<Text fontSize={13} fontWeight="700" color="#1A1A1A">
						A
					</Text>
				</YStack>
				<YStack
					backgroundColor={bgTertiary}
					borderRadius={16}
					borderBottomLeftRadius={6}
					paddingHorizontal={10}
					paddingVertical={8}
					flex={1}
					gap={6}
				>
				{/* Header: shield + tool name + expand toggle */}
					<XStack
						gap={6}
						alignItems="center"
						paddingVertical={4}
						onPress={
							summary
								? () => setExpanded((v) => !v)
								: undefined
						}
						pressStyle={summary ? { opacity: 0.6 } : undefined}
						cursor={summary ? "pointer" : undefined}
					>
						<Ionicons
							name="shield-outline"
							size={12}
							color={textSecondary}
						/>
						<Text
							fontSize={12}
							fontWeight="500"
							color={textColor}
							flex={1}
							numberOfLines={1}
						>
							{toolName}
						</Text>
						{summary ? (
							<XStack gap={2} alignItems="center">
								<Text fontSize={11} color={textSecondary}>
									{expanded ? "hide" : "show more…"}
								</Text>
								<Ionicons
									name={expanded ? "chevron-up" : "chevron-down"}
									size={12}
									color={textSecondary}
								/>
							</XStack>
						) : null}
					</XStack>

					{/* Collapsible args */}
					{expanded && summary ? (
						<YStack
							backgroundColor="rgba(255,255,255,0.06)"
							borderRadius={6}
							paddingHorizontal={8}
							paddingVertical={6}
						>
							<Text fontSize={11} color={textSecondary} fontFamily="$body">
								{summary}
							</Text>
						</YStack>
					) : null}

					{/* Buttons / Status */}
					{status === "pending" ? (
						<XStack gap={6} justifyContent="flex-end">
							<Button
								onPress={onDeny}
								height={28}
								paddingHorizontal={12}
								borderRadius={14}
								backgroundColor="transparent"
								borderWidth={1}
								borderColor={borderColor}
								pressStyle={{ opacity: 0.7, scale: 0.97 }}
							>
								<XStack gap={3} alignItems="center">
									<Ionicons name="close" size={13} color={dangerColor} />
									<Text fontSize={12} fontWeight="600" color={dangerColor}>
										Deny
									</Text>
								</XStack>
							</Button>
							<Button
								onPress={onApprove}
								height={28}
								paddingHorizontal={12}
								borderRadius={14}
								backgroundColor={successColor}
								borderWidth={0}
								pressStyle={{ opacity: 0.7, scale: 0.97 }}
							>
								<XStack gap={3} alignItems="center">
									<Ionicons name="checkmark" size={13} color="#FFFFFF" />
									<Text fontSize={12} fontWeight="600" color="#FFFFFF">
										Allow
									</Text>
								</XStack>
							</Button>
						</XStack>
					) : (
						<XStack gap={4} alignItems="center" justifyContent="flex-end">
							<Ionicons
								name={
									status === "approved" ? "checkmark-circle" : "close-circle"
								}
								size={14}
								color={status === "approved" ? successColor : dangerColor}
							/>
							<Text
								fontSize={12}
								fontWeight="600"
								color={status === "approved" ? successColor : dangerColor}
							>
								{status === "approved" ? "Approved" : "Denied"}
							</Text>
						</XStack>
					)}
				</YStack>
			</XStack>
		</YStack>
	);
}
