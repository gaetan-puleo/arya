import Ionicons from "@expo/vector-icons/Ionicons";
import { ScrollView, Text, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";
import type { SessionSummary } from "@/types/domain";
import { groupByDate } from "@/services/formatters";
import SessionRow from "./SessionRow";

interface SessionListProps {
	sessions: SessionSummary[];
	currentSessionId: string | null;
	onSelect: (session: SessionSummary) => void;
	onLongPress: (session: SessionSummary) => void;
	onRowPressIn: (e: GestureResponderEvent) => void;
}

/**
 * Scrollable session list with date-bucket headers + empty state.
 * Purely presentational — the parent owns CRUD callbacks and modal
 * coordination.
 */
export default function SessionList({
	sessions,
	currentSessionId,
	onSelect,
	onLongPress,
	onRowPressIn,
}: SessionListProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();

	if (sessions.length === 0) {
		return (
			<View className="flex-1 items-center justify-center px-6">
				<Ionicons
					name="chatbubbles-outline"
					size={32}
					color={theme.colors.textTertiary}
				/>
				<Text className="mt-3 text-sm text-center text-text-secondary">
					No sessions yet. Tap{" "}
					<Text className="font-bold text-text">Chat</Text> to start one.
				</Text>
			</View>
		);
	}

	const groups = groupByDate(sessions);

	return (
		<ScrollView
			contentContainerStyle={{
				paddingTop: 4,
				// Extra bottom padding so the FAB doesn't visually occlude
				// the last row. 56 (FAB) + 16 (gap) + 16 (breathing room).
				paddingBottom: insets.bottom + 88,
			}}
		>
			{groups.map((group) => (
				<View key={group.label}>
					<Text className="px-4 pt-3 pb-1 text-xs font-bold tracking-[0.6px] uppercase text-text-tertiary">
						{group.label}
					</Text>
					{group.items.map((session) => (
						<SessionRow
							key={session.id}
							session={session}
							isActive={session.id === currentSessionId}
							onPressIn={onRowPressIn}
							onSelect={() => onSelect(session)}
							onLongPress={() => onLongPress(session)}
						/>
					))}
				</View>
			))}
		</ScrollView>
	);
}
