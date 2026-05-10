import { View } from "react-native";
import { useUnistyles } from "@/theme/ThemeContext";

import { useChat } from "@/hooks/useChat";
import ChatMessageList from "@/components/ChatMessageList";
import ChatInputBar from "@/components/ChatInputBar";

export default function ChatScreen() {
	const { theme } = useUnistyles();
	const chat = useChat();

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<View style={{ height: 1, backgroundColor: theme.colors.border, opacity: 0.4 }} />

			<ChatMessageList
				messages={chat.messages}
				approvals={chat.approvals}
				onRespondApproval={chat.respondApproval}
				subAgentRuns={chat.subAgentRuns}
				showScrollFab={chat.showScrollFab}
				onScrollToEnd={() => {}}
				onShowScrollFabChange={chat.setShowScrollFab}
			/>

			<ChatInputBar
				input={chat.input}
				onInputChange={chat.setInput}
				onSend={chat.send}
				loading={chat.loading}
				showCommandMenu={chat.showCommandMenu}
				filteredCommands={chat.filteredCommands}
				showAgentMenu={chat.showAgentMenu}
				filteredAgents={chat.filteredAgents}
				keyboardOpen={chat.keyboardOpen}
				keyboardHeight={chat.keyboardHeight}
			/>
		</View>
	);
}
