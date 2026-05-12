import { useState } from "react";
import { View } from "react-native";
import type { LayoutChangeEvent } from "react-native";

import { useChat } from "@/hooks/useChat";
import AgentSwitcher from "@/components/AgentSwitcher";
import ChatMessageList from "@/components/ChatMessageList";
import ChatInputBar from "@/components/ChatInputBar";
import SessionsLayout from "@/components/SessionsLayout";
import { FloatingPill } from "@/components/Primitives";

export default function ChatScreen() {
	const chat = useChat();
	const [drawerOpen, setDrawerOpen] = useState(false);
	// Measured live so the scroll-to-bottom FAB and list bottom padding
	// stay above the input bar even when it grows (multi-line text).
	const [inputBarHeight, setInputBarHeight] = useState(0);
	const handleInputBarLayout = (e: LayoutChangeEvent) => {
		const h = Math.round(e.nativeEvent.layout.height);
		setInputBarHeight((prev) => (prev === h ? prev : h));
	};

	return (
		<SessionsLayout
			open={drawerOpen}
			onOpenChange={setDrawerOpen}
			sessions={chat.sessions}
			currentSessionId={chat.currentSessionId}
			onSelect={chat.selectSession}
			onCreate={chat.createSession}
			onDelete={chat.deleteSession}
			onDeleteAll={chat.deleteAllSessions}
			onRename={chat.renameSession}
		>
			<View className="flex-1 bg-bg">
				<ChatMessageList
					messages={chat.messages}
					approvals={chat.approvals}
					onRespondApproval={chat.respondApproval}
					subAgentRuns={chat.subAgentRuns}
					showScrollFab={chat.showScrollFab}
					onShowScrollFabChange={chat.setShowScrollFab}
					keyboardOpen={chat.keyboardOpen}
					keyboardHeight={chat.keyboardHeight}
					agents={chat.agents}
					activeAgent={chat.activeAgent}
					inputBarHeight={inputBarHeight}
				/>

				{/* Input bar absolutely positioned so messages scroll BEHIND
				    it with the translucent background revealing them faintly. */}
				<View
					onLayout={handleInputBarLayout}
					className="absolute left-0 right-0 bottom-0 z-[15]"
				>
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

				{/* Floating burger button (opens the sessions drawer) */}
				<FloatingPill
					onPress={() => setDrawerOpen(true)}
					icon="menu"
					label={chat.currentSession?.title}
					style={{
						position: "absolute",
						top: 8,
						left: 12,
						zIndex: 20,
						maxWidth: 200,
					}}
				/>

				{/* Agent chip + dropdown */}
				<AgentSwitcher
					activeAgent={chat.activeAgent}
					activeAgentId={chat.activeAgentId}
					primaryAgents={chat.primaryAgents}
					onSelect={chat.setActiveAgent}
				/>
			</View>
		</SessionsLayout>
	);
}
