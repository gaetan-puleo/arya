import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SessionSummary } from "@/lib/ws";
import SessionPopover, { type RowAnchor } from "@/components/SessionPopover";
import ConfirmModal from "@/components/modals/ConfirmModal";
import PromptModal from "@/components/modals/PromptModal";
import NewChatFab from "@/components/sessions/NewChatFab";
import SessionList from "@/components/sessions/SessionList";
import SessionsHeader from "@/components/sessions/SessionsHeader";

// Re-export so existing consumers (SessionsLayout) keep their import path.
export type { RowAnchor } from "@/components/SessionPopover";

interface SessionsDrawerProps {
	sessions: SessionSummary[];
	currentSessionId: string | null;
	onSelect: (sessionId: string) => void;
	onCreate: () => void;
	onDelete: (sessionId: string) => void;
	onDeleteAll: () => void;
	onRename: (sessionId: string, title: string) => void;
	/** Called when the drawer should close (X tap / row tap / new chat). */
	onClose: () => void;
	/**
	 * Bubbled up so SessionsLayout can suppress pan gestures while a
	 * row-action modal is on screen.
	 */
	onModalOpenChange?: (open: boolean) => void;
}

/**
 * Session list panel — coordinator for the drawer.
 *
 * The container handles sizing/positioning/animation (see
 * {@link SessionsLayout}). This file owns the four modal targets
 * (popover / rename / delete / delete-all) and the row anchor
 * captured on long-press. Pure presentational sub-components live
 * under `components/sessions/`.
 */
export default function SessionsDrawer({
	sessions,
	currentSessionId,
	onSelect,
	onCreate,
	onDelete,
	onDeleteAll,
	onRename,
	onClose,
	onModalOpenChange,
}: SessionsDrawerProps) {
	const insets = useSafeAreaInsets();

	// Four mutually-exclusive modal slots. Two slots keep the
	// transitions independent so the popover can fade out *before*
	// the rename/delete prompt fades in.
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

	// Latest touch position (window coords) captured by `onPressIn` on
	// a row. `onLongPress` can't read the touch directly, so we stash
	// it on press start and consume it when the long-press fires.
	const lastTouchRef = useRef({ x: 0, y: 0 });

	// Bubble modal-open state up.
	useEffect(() => {
		onModalOpenChange?.(
			actionTarget !== null ||
				renameTarget !== null ||
				deleteTarget !== null ||
				deleteAllOpen,
		);
	}, [actionTarget, renameTarget, deleteTarget, deleteAllOpen, onModalOpenChange]);

	const handleSelect = useCallback(
		(session: SessionSummary) => {
			onSelect(session.id);
			onClose();
		},
		[onSelect, onClose],
	);

	const handleLongPress = useCallback((session: SessionSummary) => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		const { x, y } = lastTouchRef.current;
		setActionAnchor({ touchX: x, touchY: y });
		setActionTarget(session);
	}, []);

	const handleRowPressIn = useCallback(
		(e: { nativeEvent: { pageX: number; pageY: number } }) => {
			lastTouchRef.current = {
				x: e.nativeEvent.pageX,
				y: e.nativeEvent.pageY,
			};
		},
		[],
	);

	return (
		<>
			<View
				className="flex-1 pt-3"
				// No backgroundColor here — the parent (SessionsLayout)
				// renders an animated tint that should bleed through.
				// Adding a solid background here would mask the
				// gray→theme.background transition.
				style={{ paddingBottom: insets.bottom }}
			>
				<SessionsHeader
					hasSessions={sessions.length > 0}
					onDeleteAll={() => setDeleteAllOpen(true)}
				/>

				<SessionList
					sessions={sessions}
					currentSessionId={currentSessionId}
					onSelect={handleSelect}
					onLongPress={handleLongPress}
					onRowPressIn={handleRowPressIn}
				/>

				<NewChatFab
					onPress={() => {
						onCreate();
						onClose();
					}}
				/>
			</View>

			{/* ── Action modals ──
			    Mounted as siblings so they portal into their own native
			    Modal windows independent of the (translating) drawer
			    panel. Slots are mutually exclusive: the popover always
			    closes before either confirmation modal opens. */}
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
					onRename(renameTarget.id, title);
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
					onDelete(deleteTarget.id);
					setDeleteTarget(null);
				}}
			/>
			<ConfirmModal
				open={deleteAllOpen}
				title="Delete all sessions?"
				body={`All ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} and their history will be permanently removed. This cannot be undone.`}
				confirmLabel="Delete all"
				destructive
				onClose={() => setDeleteAllOpen(false)}
				onConfirm={() => {
					onDeleteAll();
					setDeleteAllOpen(false);
				}}
			/>
		</>
	);
}
