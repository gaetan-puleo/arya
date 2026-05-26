import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import {
	Dimensions,
	Modal,
	Platform,
	Pressable,
	StatusBar,
	Text,
	View,
} from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";
import type { SessionSummary } from "@/types/domain";

/**
 * Window-space coordinates of the touch that started a long-press on
 * a session row. Used by the popover to anchor itself near the press
 * point instead of being centered.
 *
 * `touchX`/`touchY` come from a press event's `pageX`/`pageY` (window
 * space), the same frame the native Modal uses — no conversion needed.
 */
export interface RowAnchor {
	touchX: number;
	touchY: number;
}

interface SessionPopoverProps {
	/** Session being acted on. `null` keeps the popover closed. */
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

// Width of the anchored action card. Narrower than the centered
// confirmation modals so it reads as a contextual popover rather
// than a full-width dialog — it pops near the pressed row.
const CARD_WIDTH = 220;
// Minimum gutter between the card and the device edges. Used when
// clamping both the X and Y anchors so the card never bleeds past
// any screen edge.
const CARD_HORIZONTAL_PADDING = 16;
const CARD_VERTICAL_PADDING = 16;

/**
 * Anchored popover surfacing row actions (Rename / Delete) for a
 * session. Opens on long-press from the sessions drawer.
 *
 * Visual: dim backdrop + a compact card positioned to center on the
 * touch point (clamped to screen edges). See `getBottomInsetForClamp`
 * for the platform-specific gesture-bar handling.
 */
export default function SessionPopover({
	session,
	anchor,
	onClose,
	onRename,
	onDelete,
}: SessionPopoverProps) {
	const safeBottom = getBottomInsetForClamp();
	const open = session !== null;

	// Card height is unknown until layout — start at 0 and adjust on
	// the first onLayout. Used to clamp the card's vertical position
	// inside the screen (so a press near a screen edge doesn't push
	// the card off it). The first frame uses `cardHeight = 0`, which
	// is fine because we hide the card with opacity:0 until the real
	// height arrives.
	const [cardHeight, setCardHeight] = useState(0);
	useEffect(() => {
		if (!open) setCardHeight(0);
	}, [open]);

	const cardPosition = computeCardPosition(anchor, cardHeight, safeBottom);

	return (
		<Modal
			visible={open}
			transparent
			animationType="fade"
			onRequestClose={onClose}
		>
			{/* Backdrop — tap to dismiss. When anchored, we drop the flex
			    centering so the card can be absolutely positioned
			    relative to the row's measured window rect. */}
			<Pressable
				onPress={onClose}
				className={
					cardPosition
						? "flex-1 bg-bg-overlay"
						: "flex-1 bg-bg-overlay items-center justify-center p-6"
				}
			>
				{/* Card wrapper — handles absolute positioning + the
				    "center on (centerX, centerY)" translate. We don't
				    measure on this node because Yoga can report 0 height
				    on an absolutely-positioned node whose intrinsic size
				    depends on its children. The measurement happens on
				    the inner View (non-absolute), which Yoga lays out
				    normally. */}
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
					<Pressable
						onPress={() => {}}
						onLayout={(e) => {
							const h = e.nativeEvent.layout.height;
							if (h && h !== cardHeight) setCardHeight(h);
						}}
						className="bg-bg-tertiary rounded-card border border-border overflow-hidden"
						style={{
							width: cardPosition ? CARD_WIDTH : "100%",
							maxWidth: CARD_WIDTH,
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

/**
 * Returns the bottom inset to subtract from the *app window* when
 * clamping the action card. Platform-specific:
 *
 *   - Android non-edge-to-edge: `Dimensions.get("window").height`
 *     already excludes the nav bar — inset is 0.
 *   - Android edge-to-edge: `window.height === screen.height` and the
 *     gesture bar sits *inside* the window. Subtract the SafeArea
 *     bottom inset (captured at app boot) to lift the card above the
 *     gesture region.
 *   - iOS: the `window` frame includes the home indicator, so we
 *     subtract the SafeArea bottom inset there too.
 */
function getBottomInsetForClamp(): number {
	if (Platform.OS === "android") {
		const screen = Dimensions.get("screen");
		const window = Dimensions.get("window");
		const isEdgeToEdge = Math.abs(screen.height - window.height) <= 1;
		if (isEdgeToEdge) {
			return initialWindowMetrics?.insets.bottom ?? 0;
		}
		return 0;
	}
	return initialWindowMetrics?.insets.bottom ?? 0;
}

/**
 * Compute the (centerX, centerY) point the card should center on,
 * clamped so it stays inside the safe screen area. Returns null when
 * there's no anchor (fallback to screen-centered).
 *
 * We use flexbox to *visually* center the card on (touchX, touchY)
 * without needing to subtract cardWidth/2 or cardHeight/2 ourselves —
 * an absolutely-positioned wrapper points top/left at the touch and a
 * translate transform pulls the card up and left by half its own size.
 * When the touch is near a physical edge we shift the anchor point
 * inward so the card rests against the safe gutter.
 *
 * On Android, a non-translucent Modal renders below the status bar, so
 * `centerY` needs to be offset by `StatusBar.currentHeight` to bring
 * it back into the Modal's frame.
 */
function computeCardPosition(
	anchor: RowAnchor | null | undefined,
	cardHeight: number,
	safeBottom: number,
): { centerX: number; centerY: number } | null {
	if (!anchor) return null;

	const win = Dimensions.get("window");
	const frameW = win.width;
	const frameH = win.height;

	const halfW = CARD_WIDTH / 2;
	const halfH = cardHeight / 2;

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

	const modalYOffset =
		Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;
	return { centerX, centerY: centerY - modalYOffset };
}

interface ActionRowProps {
	icon: React.ComponentProps<typeof Ionicons>["name"];
	label: string;
	destructive?: boolean;
	onPress: () => void;
}

function ActionRow({ icon, label, destructive, onPress }: ActionRowProps) {
	const theme = useTheme();
	const color = destructive ? theme.colors.danger : theme.colors.text;
	return (
		<Pressable
			onPress={onPress}
			className="flex-row items-center gap-2 px-4 py-4 active:bg-bg-hover"
		>
			<Ionicons name={icon} size={18} color={color} />
			<Text className="text-base font-medium" style={{ color }}>
				{label}
			</Text>
		</Pressable>
	);
}
