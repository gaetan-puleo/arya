import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { useUnistyles } from "@/theme/ThemeContext";

interface ChatHeaderProps {
	connected: boolean;
	onNewChat: () => void;
	onMenu: () => void;
}

export default function ChatHeader({
	connected,
	onNewChat,
	onMenu,
}: ChatHeaderProps) {
	const { theme } = useUnistyles();

	const textColor = theme.colors.text;
	const textSecondary = theme.colors.textSecondary;
	const successColor = theme.colors.success;
	const dangerColor = theme.colors.danger;

	return (
		<View
			style={{
				flexDirection: "row",
				backgroundColor: theme.colors.background,
				paddingTop: 0,
				paddingBottom: 8,
				paddingHorizontal: 16,
				alignItems: "center",
				justifyContent: "space-between",
			}}
		>
			<View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
				<View
					style={{
						width: 30,
						height: 30,
						borderRadius: 15,
						backgroundColor: "#FFFFFF",
						justifyContent: "center",
						alignItems: "center",
					}}
				>
					<Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A" }}>A</Text>
				</View>
				<Text style={{ fontSize: 17, fontWeight: "600", color: textColor }}>
					Arya
				</Text>
				<View
					style={{
						width: 7,
						height: 7,
						borderRadius: 4,
						backgroundColor: connected ? successColor : dangerColor,
					}}
				/>
			</View>

			<View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
				<Pressable
					style={({ pressed }) => ({
						width: 34,
						height: 34,
						borderRadius: 17,
						backgroundColor: "transparent",
						justifyContent: "center",
						alignItems: "center",
						opacity: pressed ? 0.6 : 1,
					})}
					onPress={onNewChat}
				>
					<Ionicons name="create-outline" size={20} color={textSecondary} />
				</Pressable>
				<Pressable
					style={({ pressed }) => ({
						width: 34,
						height: 34,
						borderRadius: 17,
						backgroundColor: "transparent",
						justifyContent: "center",
						alignItems: "center",
						opacity: pressed ? 0.6 : 1,
					})}
					onPress={onMenu}
				>
					<Ionicons name="ellipsis-horizontal" size={20} color={textSecondary} />
				</Pressable>
			</View>
		</View>
	);
}
