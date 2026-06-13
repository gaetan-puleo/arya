/**
 * Chat screen — composes the chat-side hooks with the dumb UI tree.
 *
 * Modals (rename / delete / delete-all / row-popover) are lifted up
 * here so the SessionsDrawer stays presentational.
 */

import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native";

import { useAgents } from "@/hooks/useAgents";
import { useApprovals } from "@/hooks/useApprovals";
import { useComposer } from "@/hooks/useComposer";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useSessions } from "@/hooks/useSessions";
import { useSubAgentRuns } from "@/hooks/useSubAgentRun";
import { useTranscript } from "@/hooks/useTranscript";

import type { SessionSummary } from "@/types/domain";

import AgentChip from "@/components/chat/AgentChip";
import ChatInputBar from "@/components/chat/ChatInputBar";
import ChatMessageList from "@/components/chat/ChatMessageList";
import ModelLoadingBanner from "@/components/chat/ModelLoadingBanner";
import SessionsLayout from "@/components/layout/SessionsLayout";
import SessionsDrawer from "@/components/sessions/SessionsDrawer";
import SessionPopover, {
	type RowAnchor,
} from "@/components/sessions/SessionPopover";
import ConfirmModal from "@/components/modals/ConfirmModal";
import PromptModal from "@/components/modals/PromptModal";
import { FloatingPill } from "@/components/primitives/FloatingPill";

export default function ChatScreen() {
	const { messages, loading } = useTranscript();
	const sessions = useSessions();
	const agents = useAgents();
	const approvals = useApprovals();
	const composer = useComposer();
	const { keyboardOpen, keyboardHeight } = useKeyboard();
	const subAgentRuns = useSubAgentRuns();

	const [drawerOpen, setDrawerOpen] = useState(false);
	const [showScrollFab, setShowScrollFab] = useState(false);
	const [inputBarHeight, setInputBarHeight] = useState(0);
	const handleInputBarLayout = (e: LayoutChangeEvent) => {
		const h = Math.round(e.nativeEvent.layout.height);
		setInputBarHeight((prev) => (prev === h ? prev : h));
	};

	// ── Modal coordination (lifted from SessionsDrawer) ───────────────
	const [actionTarget, setActionTarget] = useState<SessionSummary | null>(
		null,
	);
	const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(
		null,
	);
	const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(
		null,
	);
	const [deleteAllOpen, setDeleteAllOpen] = useState(false);
	const [actionAnchor, setActionAnchor] = useState<RowAnchor | null>(null);
	const lastTouchRef = useRef({ x: 0, y: 0 });

	const anyModalOpen =
		actionTarget !== null ||
		renameTarget !== null ||
		deleteTarget !== null ||
		deleteAllOpen;

	const handleLongPress = useCallback((session: SessionSummary) => {
		const { x, y } = lastTouchRef.current;
		setActionAnchor({ touchX: x, touchY: y });
		setActionTarget(session);
	}, []);
	const handleRowPressIn = useCallback(
		(e: GestureResponderEvent) => {
			lastTouchRef.current = {
				x: e.nativeEvent.pageX,
				y: e.nativeEvent.pageY,
			};
		},
		[],
	);

	const handleSelect = useCallback(
		(sessionId: string) => {
			sessions.select(sessionId);
			setDrawerOpen(false);
		},
		[sessions],
	);
	const handleCreate = useCallback(() => {
		sessions.create();
		setDrawerOpen(false);
	}, [sessions]);

	return (
		<>
		<SessionsLayout
			open={drawerOpen}
			onOpenChange={setDrawerOpen}
			anyModalOpen={anyModalOpen}
			panel={
				<SessionsDrawer
					sessions={sessions.sessions}
					currentSessionId={sessions.currentSessionId}
					onSelect={handleSelect}
					onCreate={handleCreate}
					onLongPress={handleLongPress}
					onRowPressIn={handleRowPressIn}
					onDeleteAllPress={() => setDeleteAllOpen(true)}
				/>
			}
		>
			<View className="flex-1 bg-bg">
				<ChatMessageList
					messages={messages}
					approvals={approvals.approvals}
					onRespondApproval={(rowId, action) => {
						const approvalId = rowId.startsWith("approval-")
							? rowId.slice("approval-".length)
							: rowId;
						approvals.respond(approvalId, action);
					}}
					subAgentRuns={subAgentRuns}
					showScrollFab={showScrollFab}
					onShowScrollFabChange={setShowScrollFab}
					keyboardOpen={keyboardOpen}
					keyboardHeight={keyboardHeight}
					agents={agents.agents}
					activeAgent={agents.activeAgent}
					inputBarHeight={inputBarHeight}
				/>

				<View
					onLayout={handleInputBarLayout}
					className="absolute left-0 right-0 bottom-0 z-[15]"
				>
					<ChatInputBar
						input={composer.input}
						onInputChange={composer.setInput}
						onSend={composer.send}
						loading={loading}
						showCommandMenu={composer.showCommandMenu}
						filteredCommands={composer.filteredCommands}
						showAgentMenu={composer.showAgentMenu}
						filteredAgents={composer.filteredAgents}
						keyboardOpen={keyboardOpen}
						keyboardHeight={keyboardHeight}
						attachments={composer.attachments}
						canAttachImage={composer.canAttachImage}
						onPasteImage={composer.pasteImage}
						onRemoveAttachment={composer.removeAttachment}
					/>
				</View>

				<FloatingPill
					onPress={() => setDrawerOpen(true)}
					icon="menu"
					label={sessions.currentSession?.title}
					style={{
						position: "absolute",
						top: 8,
						left: 12,
						zIndex: 20,
						maxWidth: 200,
					}}
				/>

				<AgentChip
					activeAgent={agents.activeAgent}
					activeAgentId={agents.activeAgentId}
					primaryAgents={agents.primaryAgents}
					onSelect={agents.setActive}
				/>

				<ModelLoadingBanner />
			</View>
		</SessionsLayout>

			{/* ── Modals (lifted up; portal into native Modal windows) ── */}
			<SessionPopover
				session={actionTarget}
				anchor={actionAnchor}
				onClose={() => setActionTarget(null)}
				onRename={() => {
					const target = actionTarget;
					setActionTarget(null);
					if (target) setRenameTarget(target);
				}}
				onDelete={() => {
					const target = actionTarget;
					setActionTarget(null);
					if (target) setDeleteTarget(target);
				}}
			/>
			<PromptModal
				open={renameTarget !== null}
				title="Rename session"
				initial={renameTarget?.title ?? ""}
				placeholder="Session title"
				onClose={() => setRenameTarget(null)}
				onSubmit={(title) => {
					if (!renameTarget) return;
					sessions.rename(renameTarget.id, title);
					setRenameTarget(null);
				}}
			/>
			<ConfirmModal
				open={deleteTarget !== null}
				title="Delete session?"
				body={
					deleteTarget
						? `"${deleteTarget.title}" and its history will be permanently removed.`
						: ""
				}
				confirmLabel="Delete"
				destructive
				onClose={() => setDeleteTarget(null)}
				onConfirm={() => {
					if (!deleteTarget) return;
					sessions.delete(deleteTarget.id);
					setDeleteTarget(null);
				}}
			/>
			<ConfirmModal
				open={deleteAllOpen}
				title="Delete all sessions?"
				body={`All ${sessions.sessions.length} ${sessions.sessions.length === 1 ? "session" : "sessions"} and their history will be permanently removed. This cannot be undone.`}
				confirmLabel="Delete all"
				destructive
				onClose={() => setDeleteAllOpen(false)}
				onConfirm={() => {
					sessions.deleteAll();
					setDeleteAllOpen(false);
				}}
			/>
		</>
	);
}
