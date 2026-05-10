import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "@/theme/ThemeContext";
import type { SessionSummary } from "@/lib/ws";
import SessionActionsModal, {
	SessionDeleteModal,
	SessionRenameModal,
} from "@/components/SessionActionsModal";

/**
 * Window-space coordinates of the touch that started a long-press on
 * a session row. Used by the action modal to anchor itself near the
 * press point instead of being centered.
 *
 * `touchX`/`touchY` are reported by the press event's `pageX`/`pageY`
 * (window space) — the same frame the native Modal uses, so the modal
 * can place itself directly without further conversion.
 */
export interface RowAnchor {
	touchX: number;
	touchY: number;
}

interface SessionsDrawerProps {
	sessions: SessionSummary[];
	currentSessionId: string | null;
	onSelect: (sessionId: string) => void;
	onCreate: () => void;
	onDelete: (sessionId: string) => void;
	onRename: (sessionId: string, title: string) => void;
	/** Called when the user taps the panel's X button. */
	onClose: () => void;
	/**
	 * Notifies the parent whenever a row-action modal is open. The
	 * parent uses this to suppress the layout's pan gestures so the
	 * panel can't be swiped while a modal is active.
	 */
	onModalOpenChange?: (open: boolean) => void;
}

/**
 * Session list panel — pure presentational component.
 *
 * The container is responsible for sizing, positioning, animating, and
 * gesture handling (see {@link SessionsLayout}). This component only
 * paints the panel's content: header (close + title + new), grouped
 * list with row actions, empty state.
 *
 * Row actions (rename / delete) are surfaced through a small action
 * modal opened by long-pressing a row. Rename funnels into a prompt
 * modal; delete funnels into a custom confirmation modal so the look
 * and feel stays consistent across the in-app modal stack.
 */
export default function SessionsDrawer({
	sessions,
	currentSessionId,
	onSelect,
	onCreate,
	onDelete,
	onRename,
	onClose,
	onModalOpenChange,
}: SessionsDrawerProps) {
	const { theme, rt } = useUnistyles();
	// Lighter-than-panel gray for the selected row — picked locally
	// (rather than extending the theme palette) so the highlight is
	// guaranteed to read against SessionsLayout's panel tint, which is
	// also a hardcoded gray.
	const selectedRowBg = rt.themeName === "dark" ? "#2A2A2A" : "#E4E4E4";
	const insets = useSafeAreaInsets();

	// Two modal "targets" — non-null when the corresponding modal is
	// open. They are mutually exclusive (the actions modal closes
	// before the rename modal opens), but using two slots keeps the
	// transition animations independent.
	const [actionTarget, setActionTarget] = useState<SessionSummary | null>(
		null,
	);
	const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(
		null,
	);
	const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(
		null,
	);
	// Screen-space rect of the long-pressed row, captured the moment
	// the action modal opens. The modal uses this to anchor itself to
	// the row's location instead of centering on screen.
	const [actionAnchor, setActionAnchor] = useState<RowAnchor | null>(null);

	// Latest touch position (in window coords) captured by `onPressIn`
	// on a row. We can't read the touch from `onLongPress`, so we
	// stash it here when the press starts and consume it when the
	// long-press fires. `pageX`/`pageY` from the press event are
	// already in window space, matching the native Modal's frame.
	const lastTouchRef = useRef({ x: 0, y: 0 });

	// Bubble modal-open state up so SessionsLayout can suppress its
	// pan gestures while a row-action modal is on screen. The three
	// slots are mutually exclusive but we OR them to be safe.
	useEffect(() => {
		onModalOpenChange?.(
			actionTarget !== null ||
				renameTarget !== null ||
				deleteTarget !== null,
		);
	}, [actionTarget, renameTarget, deleteTarget, onModalOpenChange]);

	const openActions = useCallback((session: SessionSummary) => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		const { x, y } = lastTouchRef.current;
		setActionAnchor({ touchX: x, touchY: y });
		setActionTarget(session);
	}, []);

	const handleRequestRename = useCallback(() => {
		// Close the action modal first, then open the rename prompt.
		// Using the existing target so the prompt prefills correctly.
		const target = actionTarget;
		setActionTarget(null);
		if (target) setRenameTarget(target);
	}, [actionTarget]);

	const handleRequestDelete = useCallback(() => {
		// Close the action modal first, then open the delete prompt.
		// Mirrors the rename flow so the two confirmation modals share
		// the same transition pattern.
		const target = actionTarget;
		setActionTarget(null);
		if (target) setDeleteTarget(target);
	}, [actionTarget]);

	const handleDeleteConfirm = useCallback(() => {
		if (!deleteTarget) return;
		onDelete(deleteTarget.id);
		setDeleteTarget(null);
	}, [deleteTarget, onDelete]);

	const handleRenameSubmit = useCallback(
		(title: string) => {
			if (!renameTarget) return;
			onRename(renameTarget.id, title);
			setRenameTarget(null);
		},
		[renameTarget, onRename],
	);

	const handleSelect = useCallback(
		(session: SessionSummary) => {
			onSelect(session.id);
			onClose();
		},
		[onSelect, onClose],
	);

	// Group sessions by relative date for a friendlier list. We intentionally
	// keep the buckets simple — anything beyond "Older" goes into one tail.
	const groups = useMemo(() => groupByDate(sessions), [sessions]);

	return (
		<>
		<View
			style={{
				flex: 1,
				// No backgroundColor here — the parent (SessionsLayout)
				// renders an animated tint that should bleed through.
				// Adding a solid background here would mask the
				// gray→theme.background transition.
				paddingTop: 12,
				paddingBottom: insets.bottom,
			}}
		>
			{/* Header — just the title. Close is via swipe-left on the
			    panel or the FAB-adjacent gestures owned by SessionsLayout. */}
			<View
				style={{
					paddingHorizontal: 16,
					paddingTop: 4,
					paddingBottom: 8,
				}}
			>
				<Text
					style={{
						fontSize: 18,
						fontWeight: "700",
						color: theme.colors.text,
					}}
				>
					Sessions
				</Text>
			</View>

			{/* List */}
			{sessions.length === 0 ? (
				<View
					style={{
						flex: 1,
						alignItems: "center",
						justifyContent: "center",
						paddingHorizontal: 24,
					}}
				>
					<Ionicons
						name="chatbubbles-outline"
						size={32}
						color={theme.colors.textTertiary}
					/>
					<Text
						style={{
							marginTop: 12,
							fontSize: 14,
							textAlign: "center",
							color: theme.colors.textSecondary,
						}}
					>
						No sessions yet. Tap{" "}
						<Text style={{ fontWeight: "700", color: theme.colors.text }}>
							Chat
						</Text>{" "}
						to start one.
					</Text>
				</View>
			) : (
				<ScrollView
					contentContainerStyle={{
						paddingTop: 4,
						// Extra bottom padding so the FAB doesn't visually
						// occlude the last row when the list scrolls to end.
						// 56 (FAB height) + 16 (gap) + 16 (extra breathing
						// room) on top of the device's bottom safe-area inset.
						paddingBottom: insets.bottom + 88,
					}}
				>
					{groups.map((group) => (
						<View key={group.label}>
							<Text
								style={{
									paddingHorizontal: 16,
									paddingTop: 12,
									paddingBottom: 4,
									fontSize: 11,
									fontWeight: "700",
									letterSpacing: 0.6,
									textTransform: "uppercase",
									color: theme.colors.textTertiary,
								}}
							>
								{group.label}
							</Text>
							{group.items.map((session) => {
								const isActive = session.id === currentSessionId;
								return (
									<Pressable
										key={session.id}
										onPressIn={(e) => {
											// pageX/pageY are in window coordinates,
											// the same frame the native Modal uses,
											// so we can hand them to the modal as-is.
											lastTouchRef.current = {
												x: e.nativeEvent.pageX,
												y: e.nativeEvent.pageY,
											};
										}}
										onPress={() => handleSelect(session)}
										onLongPress={() => openActions(session)}
										delayLongPress={350}
										style={({ pressed }) => ({
											paddingHorizontal: 12,
											paddingVertical: 10,
											marginHorizontal: 8,
											marginVertical: 2,
											borderRadius: 10,
											backgroundColor: isActive
												? selectedRowBg
												: pressed
													? theme.colors.backgroundHover
													: "transparent",
										})}
									>
										<Text
											numberOfLines={1}
											style={{
												fontSize: 14,
												fontWeight: isActive ? "700" : "500",
												color: theme.colors.text,
											}}
										>
											{session.title}
										</Text>
										<Text
											style={{
												marginTop: 2,
												fontSize: 11,
												color: theme.colors.textTertiary,
											}}
										>
											{formatRelativeTime(session.updatedAt)} ·{" "}
											{session.messageCount} msg
											{session.messageCount === 1 ? "" : "s"}
										</Text>
									</Pressable>
								);
							})}
						</View>
					))}
				</ScrollView>
			)}

			{/* ── Compose FAB ──
			    Big floating button anchored to the bottom-right of the
			    sidebar. White background with dark icon + label so it
			    pops against the panel and reads as the primary action.
			    Positioned absolutely so it floats above the list and is
			    clear of the bottom safe-area inset. */}
			<Pressable
				onPress={() => {
					Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
					onCreate();
					onClose();
				}}
				accessibilityLabel="New chat"
				accessibilityRole="button"
				style={({ pressed }) => ({
					position: "absolute",
					right: 16,
					// Absolute positioning ignores the parent's paddingBottom,
					// so we add the inset manually here. Otherwise the FAB
					// would overlap the iOS home indicator / Android nav bar.
					bottom: insets.bottom + 16,
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingLeft: 18,
					paddingRight: 22,
					height: 56,
					borderRadius: 9999,
					backgroundColor: "#FFFFFF",
					// Subtle elevation so the FAB visually lifts off the
					// panel; matches typical Material/iOS FAB conventions.
					shadowColor: "#000",
					shadowOffset: { width: 0, height: 4 },
					shadowOpacity: 0.18,
					shadowRadius: 10,
					elevation: 6,
					opacity: pressed ? 0.9 : 1,
					transform: [{ scale: pressed ? 0.97 : 1 }],
				})}
			>
				{/* Each child is wrapped in a fixed-height centering box so
				    its glyph is justified inside an identical bounding
				    rectangle. Without this, RN's flex `alignItems:center`
				    aligns the *bounding boxes* — but Ionicons glyphs sit
				    pixel-centered while text glyphs are positioned by font
				    metrics, leading to a subtle 1–2px vertical mismatch.
				    Forcing both children into the same 22px tall box and
				    centering each glyph inside removes that ambiguity. */}
				<View
					style={{
						height: 22,
						justifyContent: "center",
						alignItems: "center",
					}}
				>
					<Ionicons name="create-outline" size={22} color="#000000" />
				</View>
				<View
					style={{
						height: 22,
						justifyContent: "center",
					}}
				>
					<Text
						style={{
							fontSize: 15,
							fontWeight: "700",
							color: "#000000",
							// Android-only quirks: includeFontPadding adds
							// extra space above/below glyphs by default, and
							// textAlignVertical needs to be set explicitly
							// for centering inside a height-constrained box.
							includeFontPadding: false,
							textAlignVertical: "center",
						}}
					>
						Chat
					</Text>
				</View>
			</Pressable>
		</View>

		{/* ── Action modals ──
		    Mounted as siblings so they portal into their own native
		    Modal windows independent of the (translating) drawer panel
		    layout. The three slots are mutually exclusive: the action
		    modal always closes before either confirmation modal (rename
		    prompt or delete confirm) opens. */}
		<SessionActionsModal
			session={actionTarget}
			anchor={actionAnchor}
			onClose={() => setActionTarget(null)}
			onRename={handleRequestRename}
			onDelete={handleRequestDelete}
		/>
		<SessionRenameModal
			session={renameTarget}
			onClose={() => setRenameTarget(null)}
			onSubmit={handleRenameSubmit}
		/>
		<SessionDeleteModal
			session={deleteTarget}
			onClose={() => setDeleteTarget(null)}
			onConfirm={handleDeleteConfirm}
		/>
		</>
	);
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface SessionGroup {
	label: string;
	items: SessionSummary[];
}

function groupByDate(sessions: SessionSummary[]): SessionGroup[] {
	const now = new Date();
	const startOfToday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
	const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;

	const today: SessionSummary[] = [];
	const yesterday: SessionSummary[] = [];
	const lastWeek: SessionSummary[] = [];
	const older: SessionSummary[] = [];

	for (const s of sessions) {
		if (s.updatedAt >= startOfToday) today.push(s);
		else if (s.updatedAt >= startOfYesterday) yesterday.push(s);
		else if (s.updatedAt >= sevenDaysAgo) lastWeek.push(s);
		else older.push(s);
	}

	const groups: SessionGroup[] = [];
	if (today.length) groups.push({ label: "Today", items: today });
	if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
	if (lastWeek.length) groups.push({ label: "Last 7 days", items: lastWeek });
	if (older.length) groups.push({ label: "Older", items: older });
	return groups;
}

function formatRelativeTime(ts: number): string {
	const diffMs = Date.now() - ts;
	const sec = Math.round(diffMs / 1000);
	if (sec < 60) return "just now";
	const min = Math.round(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.round(hr / 24);
	if (day < 7) return `${day}d ago`;
	const date = new Date(ts);
	return date.toLocaleDateString();
}
