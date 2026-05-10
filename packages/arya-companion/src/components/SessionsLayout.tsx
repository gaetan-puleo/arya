import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Dimensions,
	Keyboard,
	PanResponder,
	View,
} from "react-native";
import type { PanResponderInstance } from "react-native";
import Animated, {
	cancelAnimation,
	interpolateColor,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import SessionsDrawer from "@/components/SessionsDrawer";
import { useUnistyles } from "@/theme/ThemeContext";
import type { SessionSummary } from "@/lib/ws";

interface SessionsLayoutProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sessions: SessionSummary[];
	currentSessionId: string | null;
	onSelect: (sessionId: string) => void;
	onCreate: () => void;
	onDelete: (sessionId: string) => void;
	onDeleteAll: () => void;
	onRename: (sessionId: string, title: string) => void;
	children: React.ReactNode;
}

const ANIMATION_MS = 220;
// Drag thresholds. Activation DX guards against accidental gesture
// claims (small jitter from a vertical scroll), and the dominance check
// makes sure we only steal horizontal-dominant motion.
const DRAG_ACTIVATION_DX = 12;
const DRAG_DOMINANCE = 1.5;
const DRAG_VELOCITY_COMMIT = 0.3; // px/ms — fast flicks always commit
const DRAG_COMMIT_RATIO = 0.4;
// Subtle shadow attached to the chat overlay's left edge so the layered
// "card sliding off" effect reads more clearly during the drag.
const SHADOW_RADIUS = 12;
// Parallax — the panel doesn't sit at translateX=0 when closed; it's
// offset half a screen-width to the left and slides to 0 in lockstep
// with the chat. This makes the reveal feel like a layered card stack
// rather than a static background. 0.5 = panel travels half the
// distance the chat does (chat moves screenWidth, panel moves
// screenWidth * 0.5).
const PANEL_PARALLAX_RATIO = 0.5;

/**
 * Layered sessions layout — chat sits on top of a stationary full-screen
 * sessions panel and slides off to the right to reveal it.
 *
 * Layout (z-axis, back → front):
 *   1. Sessions panel: full-screen-width, stationary, always rendered.
 *   2. Chat content (children): full-screen-width, absolutely positioned,
 *      animates translateX from 0 (closed, fully covering the panel) to
 *      screenWidth (open, fully off-screen on the right).
 *
 * Gestures:
 *   - Right-swipe anywhere on the chat → reveals the panel (closed → open).
 *   - Left-swipe anywhere on the panel → brings the chat back (open → closed).
 *   - The drawer's X button also closes (via `onOpenChange(false)`).
 */
export default function SessionsLayout({
	open,
	onOpenChange,
	sessions,
	currentSessionId,
	onSelect,
	onCreate,
	onDelete,
	onDeleteAll,
	onRename,
	children,
}: SessionsLayoutProps) {
	const { theme, rt } = useUnistyles();
	const screenWidth = Dimensions.get("window").width;

	// Single source of truth for the slide. 0 → closed (chat covers
	// panel). screenWidth → fully open (chat off-screen right).
	const translateX = useSharedValue(0);

	// Mirror `open` and dragging state in refs so PanResponder
	// callbacks (created on first render) read the latest values.
	const openRef = useRef(open);
	useEffect(() => {
		openRef.current = open;
	}, [open]);

	const [dragging, setDragging] = useState(false);
	const draggingRef = useRef(false);
	useEffect(() => {
		draggingRef.current = dragging;
	}, [dragging]);

	// Tracks whether a child modal (row actions / rename) is open.
	// While true, both pan responders bail out so the user can't drag
	// the panel/chat behind a focused modal — that would feel broken
	// (modal stays put while the layer it belongs to slides away).
	const modalOpenRef = useRef(false);
	const handleModalOpenChange = useCallback((open: boolean) => {
		modalOpenRef.current = open;
	}, []);

	// Imperative open/close animation. Skipped while the user is
	// actively dragging — the finger fully owns translateX in that case.
	useEffect(() => {
		if (draggingRef.current) return;
		cancelAnimation(translateX);
		translateX.value = withTiming(open ? screenWidth : 0, {
			duration: ANIMATION_MS,
		});
	}, [open, screenWidth, translateX]);

	const chatStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: translateX.value }],
	}));

	// Parallax + tint for the panel.
	//
	// translateX: sits offset half a screen-width to the left when the
	// chat is closed and slides to 0 as the chat travels right.
	//
	// backgroundColor: interpolates between two grays — slightly more
	// pronounced when closed (the panel reads as a backdrop), softer
	// but still tinted when fully revealed (so the panel doesn't
	// flatten into pure background). The "open" color sits between
	// theme.colors.background and theme.colors.backgroundTertiary so
	// the transition is smooth without ever fully losing the gray feel.
	// interpolateColor runs on the UI thread so the tint stays in
	// lockstep with the slide regardless of drag speed.
	const panelClosedTint = theme.colors.backgroundTertiary;
	// Hardcoded mid-grays — picked once for each theme so we don't
	// have to extend the theme palette just for this transition.
	const panelOpenColor = rt.themeName === "dark" ? "#0E0E0E" : "#F4F4F4";
	const panelStyle = useAnimatedStyle(() => {
		const progress = translateX.value / screenWidth;
		const offset = -screenWidth * PANEL_PARALLAX_RATIO * (1 - progress);
		const backgroundColor = interpolateColor(
			progress,
			[0, 1],
			[panelClosedTint, panelOpenColor],
		);
		return {
			transform: [{ translateX: offset }],
			backgroundColor,
		};
	});

	// ── Pan gestures ───────────────────────────────────────────────────

	const commitOrSnapBack = useCallback(
		(targetOpen: boolean) => {
			setDragging(false);
			draggingRef.current = false;
			translateX.value = withTiming(targetOpen ? screenWidth : 0, {
				duration: ANIMATION_MS,
			});
			if (targetOpen !== openRef.current) {
				Haptics.selectionAsync();
				onOpenChange(targetOpen);
			}
		},
		[screenWidth, translateX, onOpenChange],
	);

	const openPanResponder = useMemo<PanResponderInstance>(
		() =>
			PanResponder.create({
				onStartShouldSetPanResponder: () => false,
				onMoveShouldSetPanResponder: (_evt, g) => {
					if (openRef.current) return false;
					if (modalOpenRef.current) return false;
					return (
						g.dx > DRAG_ACTIVATION_DX &&
						Math.abs(g.dx) > Math.abs(g.dy) * DRAG_DOMINANCE
					);
				},
				onPanResponderGrant: () => {
					setDragging(true);
					draggingRef.current = true;
					cancelAnimation(translateX);
					// Drop the keyboard the moment the open-drag is claimed,
					// otherwise the chat would slide away over a still-open
					// keyboard, leaving the input layout in a weird state.
					Keyboard.dismiss();
				},
				onPanResponderMove: (_evt, g) => {
					translateX.value = Math.max(0, Math.min(screenWidth, g.dx));
				},
				onPanResponderRelease: (_evt, g) => {
					const ratio = g.dx / screenWidth;
					const shouldOpen =
						g.vx > DRAG_VELOCITY_COMMIT || ratio > DRAG_COMMIT_RATIO;
					commitOrSnapBack(shouldOpen);
				},
				onPanResponderTerminate: () => commitOrSnapBack(false),
				onPanResponderTerminationRequest: () => false,
			}),
		[screenWidth, translateX, commitOrSnapBack],
	);

	const closePanResponder = useMemo<PanResponderInstance>(
		() =>
			PanResponder.create({
				onStartShouldSetPanResponder: () => false,
				onMoveShouldSetPanResponder: (_evt, g) => {
					if (!openRef.current) return false;
					if (modalOpenRef.current) return false;
					return (
						g.dx < -DRAG_ACTIVATION_DX &&
						Math.abs(g.dx) > Math.abs(g.dy) * DRAG_DOMINANCE
					);
				},
				onPanResponderGrant: () => {
					setDragging(true);
					draggingRef.current = true;
					cancelAnimation(translateX);
					Keyboard.dismiss();
				},
				onPanResponderMove: (_evt, g) => {
					// Started fully open (translateX = screenWidth); follow
					// the finger leftward, clamped to [0, screenWidth].
					translateX.value = Math.max(
						0,
						Math.min(screenWidth, screenWidth + g.dx),
					);
				},
				onPanResponderRelease: (_evt, g) => {
					const ratio = (screenWidth + g.dx) / screenWidth;
					const shouldClose =
						g.vx < -DRAG_VELOCITY_COMMIT || ratio < 1 - DRAG_COMMIT_RATIO;
					commitOrSnapBack(!shouldClose);
				},
				onPanResponderTerminate: () => commitOrSnapBack(true),
				onPanResponderTerminationRequest: () => false,
			}),
		[screenWidth, translateX, commitOrSnapBack],
	);

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			{/* ── Sessions panel (back layer) ──
			    Always rendered, full screen width. Sits parallax-offset
			    to the left when the chat is closed and slides to 0 in
			    sync with the chat to feel like a layered reveal. The
			    close pan responder is attached here so the user can
			    swipe-left anywhere on the panel to bring the chat back. */}
			<Animated.View
				{...closePanResponder.panHandlers}
				// backgroundColor lives in panelStyle (animated tint), so
				// it intentionally isn't set here — the inline value
				// would otherwise override the interpolated one.
				style={[{ flex: 1 }, panelStyle]}
			>
				<SessionsDrawer
					sessions={sessions}
					currentSessionId={currentSessionId}
					onSelect={onSelect}
					onCreate={onCreate}
					onDelete={onDelete}
					onDeleteAll={onDeleteAll}
					onRename={onRename}
					onClose={() => onOpenChange(false)}
					onModalOpenChange={handleModalOpenChange}
				/>
			</Animated.View>

			{/* ── Chat overlay (front layer) ──
			    Absolutely positioned, full screen width, slides off to
			    the right when the drawer opens. The open pan responder
			    is attached here so a right-swipe anywhere on the chat
			    reveals the panel underneath.
			    onStartShouldSetPanResponder=false lets taps fall through
			    to chat buttons; the dominance check on move keeps
			    vertical scrolls in the message list working. */}
			<Animated.View
				{...openPanResponder.panHandlers}
				style={[
					{
						position: "absolute",
						top: 0,
						bottom: 0,
						left: 0,
						right: 0,
						backgroundColor: theme.colors.background,
						// Soft shadow on the left edge so during the drag
						// the chat feels like a card hovering above the
						// panel. iOS uses shadow*; Android uses elevation.
						shadowColor: "#000",
						shadowOffset: { width: -4, height: 0 },
						shadowOpacity: 0.18,
						shadowRadius: SHADOW_RADIUS,
						elevation: 8,
					},
					chatStyle,
				]}
			>
				{children}
			</Animated.View>
		</View>
	);
}
