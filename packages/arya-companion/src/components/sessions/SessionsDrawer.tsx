/**
 * Sessions drawer panel — presentational.
 *
 * Modals (rename / delete / delete-all / row-popover) are owned by the
 * parent screen and lifted out. This component is purely declarative:
 * receive sessions + callbacks, render rows + chrome.
 */

import { View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SessionSummary } from "@/types/domain";
import NewChatFab from "@/components/sessions/NewChatFab";
import SessionList from "@/components/sessions/SessionList";
import SessionsHeader from "@/components/sessions/SessionsHeader";

interface SessionsDrawerProps {
	sessions: SessionSummary[];
	currentSessionId: string | null;
	onSelect: (sessionId: string) => void;
	onCreate: () => void;
	onLongPress: (session: SessionSummary) => void;
	onRowPressIn: (e: GestureResponderEvent) => void;
	onDeleteAllPress: () => void;
}

export default function SessionsDrawer({
	sessions,
	currentSessionId,
	onSelect,
	onCreate,
	onLongPress,
	onRowPressIn,
	onDeleteAllPress,
}: SessionsDrawerProps) {
	const insets = useSafeAreaInsets();

	return (
		<View
			className="flex-1 pt-3"
			// No backgroundColor — SessionsLayout renders an animated tint
			// underneath that should bleed through.
			style={{ paddingBottom: insets.bottom }}
		>
			<SessionsHeader
				hasSessions={sessions.length > 0}
				onDeleteAll={onDeleteAllPress}
			/>

			<SessionList
				sessions={sessions}
				currentSessionId={currentSessionId}
				onSelect={(session) => onSelect(session.id)}
				onLongPress={onLongPress}
				onRowPressIn={onRowPressIn}
			/>

			<NewChatFab onPress={onCreate} />
		</View>
	);
}
