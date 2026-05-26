import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import type { AgentInfo } from "@/types/domain";
import { capitalizeAgentName } from "@/services/formatters";
import { useTheme } from "@/theme/ThemeContext";
import { FloatingPill } from "@/components/primitives/FloatingPill";

interface AgentChipProps {
	activeAgent: AgentInfo | null;
	activeAgentId: string | null;
	primaryAgents: AgentInfo[];
	onSelect: (agentId: string) => void;
}

/**
 * Floating "agent chip" + dropdown. Dumb — owns only local open-state.
 * All data + selection callback come via props.
 */
export default function AgentChip({
	activeAgent,
	activeAgentId,
	primaryAgents,
	onSelect,
}: AgentChipProps) {
	const theme = useTheme();
	const [open, setOpen] = useState(false);
	const canSwitch = primaryAgents.length > 1;

	const rawAgentId = activeAgent?.id ?? "";
	const agentLabel = rawAgentId ? capitalizeAgentName(rawAgentId) : "—";
	const dotColor =
		activeAgent?.color ??
		(activeAgent ? theme.colors.success : theme.colors.textPlaceholder);

	return (
		<>
			{open ? (
				<Pressable
					onPress={() => setOpen(false)}
					className="absolute inset-0 z-[19]"
				/>
			) : null}

			<FloatingPill
				onPress={() => {
					if (canSwitch) setOpen((v) => !v);
				}}
				leftDot={dotColor}
				borderColor={
					open ? theme.colors.borderFocus : theme.colors.border
				}
				label={
					<Text className="text-sm text-text-secondary">
						Agent:{" "}
						<Text className="text-text font-semibold">
							{agentLabel}
						</Text>
					</Text>
				}
				trailing={
					canSwitch ? (
						<Ionicons
							name={open ? "chevron-up" : "chevron-down"}
							size={14}
							color={theme.colors.textSecondary}
							style={{ marginLeft: 2 }}
						/>
					) : null
				}
				style={{
					position: "absolute",
					top: 8,
					right: 12,
					paddingHorizontal: 16,
					zIndex: 20,
				}}
			/>

			{open && canSwitch ? (
				<Animated.View
					entering={FadeIn.duration(120)}
					exiting={FadeOut.duration(100)}
					className="absolute right-3 min-w-[200px] max-w-[280px] bg-bg-translucent border border-border rounded-card py-1 z-[21]"
					style={{
						top: 8 + theme.chrome.pillHeight + 6,
						shadowColor: "#000",
						shadowOffset: { width: 0, height: 4 },
						shadowOpacity: 0.25,
						shadowRadius: 8,
						elevation: 6,
					}}
				>
					{primaryAgents.map((agent) => {
						const isActive = agent.id === activeAgentId;
						return (
							<Pressable
								key={agent.id}
								onPress={() => {
									onSelect(agent.id);
									setOpen(false);
								}}
								className="flex-row items-center gap-2 px-3 py-3 active:bg-bg-hover"
							>
								<View
									className="w-2 h-2 rounded-full"
									style={{
										backgroundColor:
											agent.color ?? theme.colors.textPlaceholder,
									}}
								/>
								<View className="flex-1">
									<Text
										className={`text-sm text-text ${isActive ? "font-bold" : "font-medium"}`}
									>
										{capitalizeAgentName(agent.id)}
									</Text>
									{agent.description ? (
										<Text
											numberOfLines={1}
											className="text-xs text-text-secondary mt-px"
										>
											{agent.description}
										</Text>
									) : null}
								</View>
								{isActive ? (
									<Ionicons
										name="checkmark"
										size={16}
										color={theme.colors.text}
									/>
								) : null}
							</Pressable>
						);
					})}
				</Animated.View>
			) : null}
		</>
	);
}
