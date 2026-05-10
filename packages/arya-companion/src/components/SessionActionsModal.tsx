import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
	Dimensions,
	Modal,
	Platform,
	Pressable,
	StatusBar,
	Text,
	TextInput,
	View,
} from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";

/**
 * Returns the bottom inset to subtract from the *app window* when
 * clamping the action card. The interesting case is Android:
 *
 *   - Non-edge-to-edge: `Dimensions.get("window").height` already
 *     excludes the nav bar, so the inset to subtract is 0.
 *   - Edge-to-edge: `window.height === screen.height` and the
 *     gesture bar sits *inside* the window. We subtract the
 *     SafeArea bottom inset (captured at app boot) to lift the
 *     card above the gesture region.
 *
 * On iOS the home indicator is handled the same way: the `window`
 * frame already includes it, so we subtract the SafeArea bottom.
 */
function getBottomInsetForClamp(): number {
	if (Platform.OS === "android") {
		const screen = Dimensions.get("screen");
		const window = Dimensions.get("window");
		// Edge-to-edge ↔ window matches screen height (allow 1px
		// slack for rounding). In that case the gesture bar lives
		// inside the window and we need the safe-area metric.
		const isEdgeToEdge = Math.abs(screen.height - window.height) <= 1;
		if (isEdgeToEdge) {
			return initialWindowMetrics?.insets.bottom ?? 0;
		}
		return 0;
	}
	return initialWindowMetrics?.insets.bottom ?? 0;
}
// Width of the anchored action card. Narrower than the centered
// confirmation modals so it reads as a contextual popover rather
// than a full-width dialog — it pops near the pressed row.
const CARD_WIDTH = 220;
// Minimum gutter between the card and the device edges. Used when
// clamping both the X and Y anchors so the card never bleeds past
// any screen edge.
const CARD_HORIZONTAL_PADDING = 16;
const CARD_VERTICAL_PADDING = 16;

import { useUnistyles } from "@/theme/ThemeContext";
import type { SessionSummary } from "@/lib/ws";
// Type-only import to avoid pulling SessionsDrawer at runtime —
// SessionsDrawer itself imports this file, and a value-level cycle
// would leave one side undefined at module-eval time.
import type { RowAnchor } from "@/components/SessionsDrawer";

// ── SessionActionsModal ──────────────────────────────────────────────────

interface SessionActionsModalProps {
	/** Session being acted on. `null` keeps the modal closed. */
	session: SessionSummary | null;
	/**
	 * Window-space coordinates of the long-press. When provided, the
	 * card centers itself on the touch point (clamped to the screen).
	 * `null` falls back to a screen-centered card.
	 */
	anchor?: RowAnchor | null;
	onClose: () => void;
	onRename: () => void;
	onDelete: () => void;
}

/**
 * Small centered card that surfaces row actions (Rename / Delete) for a
 * session. Opens on long-press from the drawer; the parent controls
 * which session is active by passing it through `session` (null = closed).
 *
 * Visual: dim backdrop + a compact card with the title at the top and
 * two stacked buttons. Cancel is implicit — tap the backdrop or the
 * close X. Mirrors the minimal aesthetic of the rest of the drawer.
 */
export default function SessionActionsModal({
	session,
	anchor,
	onClose,
	onRename,
	onDelete,
}: SessionActionsModalProps) {
	const { theme } = useUnistyles();
	// Bottom inset to subtract from the app window when clamping the
	// card's vertical position. See `getBottomInsetForClamp()` for the
	// platform-specific logic — short version: 0 when the OS already
	// trims the nav bar out of `Dimensions.window`, otherwise the
	// gesture-bar / home-indicator height.
	const safeBottom = getBottomInsetForClamp();
	const open = session !== null;

	// Card height is unknown until layout — start at 0 and adjust on
	// the first onLayout. Used to clamp the card's vertical position
	// inside the screen (so a press near a screen edge doesn't push
	// the card off it). The first frame uses `cardHeight = 0`, which
	// is fine because we hide the card with opacity:0 until the real
	// height arrives.
	const [cardHeight, setCardHeight] = useState(0);
	// Reset when the modal closes so the next open re-measures from
	// scratch (defensive — the row content is currently fixed).
	useEffect(() => {
		if (!open) setCardHeight(0);
	}, [open]);

	const cardPosition = (() => {
		if (!anchor) return null;
		// Clamp against the *app window* — that's the frame where
		// `pageX`/`pageY` from the row's Pressable live, and on
		// non-edge-to-edge Android the nav/gesture bar is already
		// excluded from `window.height`. So clamping inside
		// `[0, window.height]` keeps the card above the nav bar
		// without any extra inset subtraction.
		//
		// On Android edge-to-edge `window.height === screen.height`
		// and the gesture bar sits *inside* the window — there
		// `safeBottom` (read from initialWindowMetrics) is non-zero
		// and pulls the lower bound up by the gesture-bar height.
		const win = Dimensions.get("window");
		const frameW = win.width;
		const frameH = win.height;

		// Approach: use flexbox to *visually* center the card on
		// (touchX, touchY) without needing to subtract cardWidth/2
		// or cardHeight/2 ourselves. We render an absolutely-
		// positioned wrapper whose top/left point at the touch, and
		// let the wrapper's translate transform pull the card up
		// and left by half its own size — so the card's center
		// always sits exactly under the finger. To clamp, we shift
		// the wrapper's anchor point inward when the touch is near
		// a physical edge.
		const halfW = CARD_WIDTH / 2;
		const halfH = cardHeight / 2;

		// Effective center after clamping. If the centered card
		// would clip an edge, we move the anchor point so the card
		// rests against the safe gutter; otherwise the anchor stays
		// exactly on the touch.
		const minCenterX = CARD_HORIZONTAL_PADDING + halfW;
		const maxCenterX = frameW - CARD_HORIZONTAL_PADDING - halfW;
		const centerX = Math.max(
			minCenterX,
			Math.min(maxCenterX, anchor.touchX),
		);

		const minCenterY = CARD_VERTICAL_PADDING + halfH;
		const maxCenterY = frameH - safeBottom - CARD_VERTICAL_PADDING - halfH;
		const centerY = Math.max(
			minCenterY,
			Math.min(maxCenterY, anchor.touchY),
		);

		// On Android, a non-translucent Modal renders its content
		// *below* the status bar — so its `top: 0` corresponds to
		// `pageY = statusBarHeight`. Our `centerY` was computed in
		// the page (window) frame, so we need to subtract the
		// status-bar height to translate it into the Modal's frame
		// before handing it to the style. Without this the card
		// drifts down by ~status-bar-height and slides under the
		// gesture bar at the bottom edge. iOS Modals share the
		// page frame, so the offset is 0 there.
		const modalYOffset =
			Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;
		return { centerX, centerY: centerY - modalYOffset };
	})();

	return (
		<Modal
			visible={open}
			transparent
			animationType="fade"
			onRequestClose={onClose}
		>
			{/* Backdrop — tap to dismiss. When anchored, we drop the
			    flex centering so the card can be absolutely positioned
			    relative to the row's measured window rect. */}
			<Pressable
				onPress={onClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.backgroundOverlay,
					...(cardPosition
						? null
						: {
							alignItems: "center",
							justifyContent: "center",
							padding: 24,
						}),
				}}
			>
				{/* Stop propagation: tapping the card itself shouldn't close.
				    A nested Pressable with onPress={() => {}} swallows touches. */}
				{/* Card wrapper — handles absolute positioning + the
				    "center on (centerX, centerY)" translate. We don't
				    measure on this node because Yoga can report 0
				    height on an absolutely-positioned node whose
				    intrinsic size depends on its children. The
				    measurement happens on the inner View (non-absolute),
				    which Yoga lays out normally. */}
				<View
					pointerEvents="box-none"
					style={
						cardPosition
							? {
								position: "absolute",
								top: cardPosition.centerY,
								left: cardPosition.centerX,
								transform: [
									{ translateX: -CARD_WIDTH / 2 },
									{ translateY: -cardHeight / 2 },
								],
								// Hide until we know the real height,
								// otherwise the first frame paints with
								// translateY=0 (top-edge on the finger).
								opacity: cardHeight === 0 ? 0 : 1,
							}
							: {
								alignSelf: "center",
								width: "100%",
								maxWidth: CARD_WIDTH,
							}
					}
				>
					{/* Stop-propagation Pressable + the actual card
					    surface. Layout-on-this-node measures correctly
					    because the parent's transform doesn't affect
					    Yoga's intrinsic size pass. */}
					<Pressable
						onPress={() => {}}
						onLayout={(e) => {
							const h = e.nativeEvent.layout.height;
							if (h && h !== cardHeight) setCardHeight(h);
						}}
						style={{
							width: cardPosition ? CARD_WIDTH : "100%",
							maxWidth: CARD_WIDTH,
							backgroundColor: theme.colors.backgroundTertiary,
							borderRadius: 16,
							borderWidth: 1,
							borderColor: theme.colors.border,
							overflow: "hidden",
						}}
					>
						<ActionRow
							icon="pencil"
							label="Rename"
							onPress={() => {
								Haptics.selectionAsync();
								onRename();
							}}
						/>
						<ActionRow
							icon="trash-outline"
							label="Delete"
							destructive
							onPress={() => {
								Haptics.notificationAsync(
									Haptics.NotificationFeedbackType.Warning,
								);
								onDelete();
							}}
						/>
					</Pressable>
				</View>
			</Pressable>
		</Modal>
	);
}

interface ActionRowProps {
	icon: React.ComponentProps<typeof Ionicons>["name"];
	label: string;
	destructive?: boolean;
	onPress: () => void;
}

function ActionRow({
	icon,
	label,
	destructive,
	onPress,
}: ActionRowProps) {
	const { theme } = useUnistyles();
	const color = destructive ? theme.colors.danger : theme.colors.text;
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 16,
				paddingVertical: 16,
				backgroundColor: pressed
					? theme.colors.backgroundHover
					: "transparent",
			})}
		>
			<Ionicons name={icon} size={18} color={color} />
			<Text
				style={{
					fontSize: 16,
					fontWeight: "500",
					color,
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

// ── SessionRenameModal ───────────────────────────────────────────────────

interface SessionRenameModalProps {
	session: SessionSummary | null;
	onClose: () => void;
	onSubmit: (title: string) => void;
}

/**
 * Prompt-style modal with a single TextInput, prefilled with the
 * current session title. Save commits via `onSubmit`, Cancel dismisses
 * without changes. Submit-on-return is supported.
 */
export function SessionRenameModal({
	session,
	onClose,
	onSubmit,
}: SessionRenameModalProps) {
	const { theme } = useUnistyles();
	const open = session !== null;
	const [draft, setDraft] = useState("");
	const inputRef = useRef<TextInput | null>(null);

	// Reset the draft each time the modal opens for a (potentially new)
	// session. Refocus + select the existing text so users can quickly
	// retype or extend.
	useEffect(() => {
		if (open && session) {
			setDraft(session.title);
			// Wait one frame so the TextInput is mounted before we focus.
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open, session]);

	const submit = () => {
		const title = draft.trim();
		if (!title || !session) {
			onClose();
			return;
		}
		onSubmit(title);
	};

	return (
		<Modal
			visible={open}
			transparent
			animationType="fade"
			onRequestClose={onClose}
		>
			<Pressable
				onPress={onClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.backgroundOverlay,
					alignItems: "center",
					justifyContent: "center",
					padding: 24,
				}}
			>
				<Pressable
					onPress={() => {}}
					style={{
						width: "100%",
						maxWidth: 340,
						// Same gray as the action and delete modals so
						// the in-app modal stack stays visually
						// consistent. No border — the overlay backdrop
						// already gives the card enough contrast.
						backgroundColor: theme.colors.backgroundTertiary,
						borderRadius: 16,
						padding: 16,
						gap: 12,
					}}
				>
					<Text
						style={{
							fontSize: 16,
							fontWeight: "700",
							color: theme.colors.text,
						}}
					>
						Rename session
					</Text>

					<TextInput
						ref={inputRef}
						value={draft}
						onChangeText={setDraft}
						onSubmitEditing={submit}
						returnKeyType="done"
						selectTextOnFocus
						placeholder="Session title"
						placeholderTextColor={theme.colors.textPlaceholder}
						style={{
							fontSize: 14,
							color: theme.colors.text,
							borderWidth: 1,
							borderColor: theme.colors.border,
							borderRadius: 8,
							paddingHorizontal: 12,
							paddingVertical: 8,
							backgroundColor: theme.colors.backgroundInput,
						}}
					/>

					<View
						style={{
							flexDirection: "row",
							justifyContent: "flex-end",
							gap: 8,
						}}
					>
						<Pressable
							onPress={onClose}
							style={({ pressed }) => ({
								paddingHorizontal: 16,
								paddingVertical: 8,
								borderRadius: 9999,
								backgroundColor: pressed
									? theme.colors.backgroundHover
									: "transparent",
							})}
						>
							<Text
								style={{
									fontSize: 14,
									fontWeight: "600",
									color: theme.colors.textSecondary,
								}}
							>
								Cancel
							</Text>
						</Pressable>
						<Pressable
							onPress={submit}
							style={({ pressed }) => ({
								paddingHorizontal: 16,
								paddingVertical: 8,
								borderRadius: 9999,
								borderWidth: 1,
								borderColor: theme.colors.border,
								backgroundColor: pressed
									? theme.colors.backgroundHover
									: theme.colors.backgroundSecondary,
							})}
						>
							<Text
								style={{
									fontSize: 14,
									fontWeight: "700",
									color: theme.colors.text,
								}}
							>
								Save
							</Text>
						</Pressable>
					</View>
				</Pressable>
			</Pressable>
		</Modal>
	);
}

// ── ConfirmDeleteModal (shared) ─────────────────────────────────────────

interface ConfirmDeleteModalProps {
	open: boolean;
	title: string;
	body: string;
	confirmLabel?: string;
	onClose: () => void;
	onConfirm: () => void;
}

/**
 * Generic destructive-confirmation modal: centered card with a title,
 * a short body and Cancel + (danger-styled) confirm buttons.
 *
 * Used by both the single-session delete prompt and the "delete all
 * sessions" bulk prompt — extracting the visual shell here keeps the
 * two callsites in lockstep (any future styling tweak applies to
 * both at once) without growing the SessionDeleteModal API.
 */
function ConfirmDeleteModal({
	open,
	title,
	body,
	confirmLabel = "Delete",
	onClose,
	onConfirm,
}: ConfirmDeleteModalProps) {
	const { theme } = useUnistyles();
	return (
		<Modal
			visible={open}
			transparent
			animationType="fade"
			onRequestClose={onClose}
		>
			<Pressable
				onPress={onClose}
				style={{
					flex: 1,
					backgroundColor: theme.colors.backgroundOverlay,
					alignItems: "center",
					justifyContent: "center",
					padding: 24,
				}}
			>
				<Pressable
					onPress={() => {}}
					style={{
						width: "100%",
						maxWidth: 340,
						// Same gray as the other in-app modals so the
						// confirmation surface stays visually consistent.
						// No border — the overlay backdrop already gives
						// the card enough contrast against the panel.
						backgroundColor: theme.colors.backgroundTertiary,
						borderRadius: 16,
						padding: 16,
						gap: 12,
					}}
				>
					<Text
						style={{
							fontSize: 16,
							fontWeight: "700",
							color: theme.colors.text,
						}}
					>
						{title}
					</Text>

					<Text
						style={{
							fontSize: 14,
							lineHeight: 18,
							color: theme.colors.textSecondary,
						}}
					>
						{body}
					</Text>

					<View
						style={{
							flexDirection: "row",
							justifyContent: "flex-end",
							gap: 8,
						}}
					>
						<Pressable
							onPress={onClose}
							style={({ pressed }) => ({
								paddingHorizontal: 16,
								paddingVertical: 8,
								borderRadius: 9999,
								backgroundColor: pressed
									? theme.colors.backgroundHover
									: "transparent",
							})}
						>
							<Text
								style={{
									fontSize: 14,
									fontWeight: "600",
									color: theme.colors.textSecondary,
								}}
							>
								Cancel
							</Text>
						</Pressable>
						<Pressable
							onPress={() => {
								Haptics.notificationAsync(
									Haptics.NotificationFeedbackType.Warning,
								);
								onConfirm();
							}}
							style={({ pressed }) => ({
								paddingHorizontal: 16,
								paddingVertical: 8,
								borderRadius: 9999,
								backgroundColor: pressed
									? theme.colors.backgroundHover
									: theme.colors.danger,
							})}
						>
							<Text
								style={{
									fontSize: 14,
									fontWeight: "700",
									// White on the danger background reads
									// reliably across both themes; using
									// theme.colors.text would invert badly
									// on a saturated red.
									color: "#FFFFFF",
								}}
							>
								{confirmLabel}
							</Text>
						</Pressable>
					</View>
				</Pressable>
			</Pressable>
		</Modal>
	);
}

// ── SessionDeleteModal ───────────────────────────────────────────────────

interface SessionDeleteModalProps {
	/** Session to delete. `null` keeps the modal closed. */
	session: SessionSummary | null;
	onClose: () => void;
	onConfirm: () => void;
}

/**
 * Single-session delete confirmation. Thin wrapper around
 * {@link ConfirmDeleteModal} that fills in the "Delete session?"
 * title and the per-session body copy.
 */
export function SessionDeleteModal({
	session,
	onClose,
	onConfirm,
}: SessionDeleteModalProps) {
	return (
		<ConfirmDeleteModal
			open={session !== null}
			title="Delete session?"
			body={
				session
					? `"${session.title}" and its history will be permanently removed.`
					: ""
			}
			onClose={onClose}
			onConfirm={onConfirm}
		/>
	);
}

// ── SessionDeleteAllModal ────────────────────────────────────────────────

interface SessionDeleteAllModalProps {
	/** Whether the bulk-delete confirmation is visible. */
	open: boolean;
	/** Number of sessions that would be removed — surfaced in the body. */
	sessionCount: number;
	onClose: () => void;
	onConfirm: () => void;
}

/**
 * Bulk "delete every session" confirmation modal. Same visual shell
 * as {@link SessionDeleteModal}; the body explicitly mentions the
 * count so users have a sanity check before committing.
 */
export function SessionDeleteAllModal({
	open,
	sessionCount,
	onClose,
	onConfirm,
}: SessionDeleteAllModalProps) {
	const plural = sessionCount === 1 ? "session" : "sessions";
	return (
		<ConfirmDeleteModal
			open={open}
			title="Delete all sessions?"
			body={`All ${sessionCount} ${plural} and their history will be permanently removed. This cannot be undone.`}
			confirmLabel="Delete all"
			onClose={onClose}
			onConfirm={onConfirm}
		/>
	);
}
