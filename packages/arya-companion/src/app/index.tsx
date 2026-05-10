import { useEffect } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "@/theme/ThemeContext";

import { useChat } from "@/hooks/useChat";
import ChatMessageList from "@/components/ChatMessageList";
import ChatInputBar from "@/components/ChatInputBar";

export default function ChatScreen() {
	const insets = useSafeAreaInsets();
	const { theme } = useUnistyles();
	const chat = useChat();

	// Auto-scroll when messages change
	useEffect(() => {
		requestAnimationFrame(() => {
			// scrollToEnd is handled internally by ChatMessageList
		});
	}, [chat.messages.length]);

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>

			<View style={{ height: 1, backgroundColor: theme.colors.border, opacity: 0.4 }} />

			<KeyboardAvoidingView
				behavior={Platform.OS === "ios" ? "padding" : undefined}
				keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 48 : 0}
				style={{ flex: 1 }}
			>
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
					inputExpanded={chat.inputExpanded}
					onExpandChange={chat.setInputExpanded}
					textHeight={chat.textHeight}
					keyboardOpen={chat.keyboardOpen}
					keyboardHeight={chat.keyboardHeight}
					setTextHeight={chat.setTextHeight}
				/>
			</KeyboardAvoidingView>
		</View>
	);
}
