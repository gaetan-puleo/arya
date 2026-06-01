import { Pressable, Text } from "react-native";
import type { GestureResponderEvent } from "react-native";
import type { SessionSummary } from "@/types/domain";
import { formatRelativeTime } from "@/services/formatters";

// Lighter-than-panel gray for the selected row — picked locally so
// the highlight is guaranteed to read against SessionsLayout's panel
// tint (also a hardcoded gray).
const SELECTED_ROW_BG = "#2A2A2A";

interface SessionRowProps {
	session: SessionSummary;
	isActive: boolean;
	onSelect: () => void;
	/**
	 * Captures the press's `pageX`/`pageY` (window coords) the moment
	 * touch begins. The drawer stashes the last value and reads it
	 * on long-press to anchor the popover.
	 */
	onPressIn: (e: GestureResponderEvent) => void;
	onLongPress: () => void;
}

export default function SessionRow({
	session,
	isActive,
	onSelect,
	onPressIn,
	onLongPress,
}: SessionRowProps) {
	return (
		<Pressable
			onPressIn={onPressIn}
			onPress={onSelect}
			onLongPress={onLongPress}
			delayLongPress={350}
			className={`px-3 py-3 mx-2 my-0.5 rounded-xl ${
				isActive ? "" : "active:bg-bg-hover"
			}`}
			style={isActive ? { backgroundColor: SELECTED_ROW_BG } : undefined}
		>
			<Text
				numberOfLines={1}
				className={`text-sm text-text ${isActive ? "font-bold" : "font-medium"}`}
			>
				{session.title}
			</Text>
			<Text className="mt-0.5 text-xs text-text-tertiary">
				{formatRelativeTime(session.updatedAt)} · {session.messageCount} msg
				{session.messageCount === 1 ? "" : "s"}
			</Text>
		</Pressable>
	);
}
