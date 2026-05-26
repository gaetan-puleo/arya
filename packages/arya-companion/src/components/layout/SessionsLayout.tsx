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

import { useTheme } from "@/theme/ThemeContext";

interface SessionsLayoutProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When true, pan gestures are suppressed (a modal is showing). */
	anyModalOpen: boolean;
	/** Back-layer content (sessions drawer). */
	panel: React.ReactNode;
	/** Front-layer content (chat). */
	children: React.ReactNode;
}

const ANIMATION_MS = 220;
const DRAG_ACTIVATION_DX = 12;
const DRAG_DOMINANCE = 1.5;
const DRAG_VELOCITY_COMMIT = 0.3;
const DRAG_COMMIT_RATIO = 0.4;
const SHADOW_RADIUS = 12;
const PANEL_PARALLAX_RATIO = 0.5;

/**
 * Layered sessions layout — chat content (children[1]) sits on top of
 * the sessions panel (children[0]) and slides off to the right to
 * reveal it. Gesture orchestration only — no data dependence.
 */
export default function SessionsLayout({
	open,
	onOpenChange,
	anyModalOpen,
	panel,
	children,
}: SessionsLayoutProps) {
	const theme = useTheme();
	const screenWidth = Dimensions.get("window").width;

	const translateX = useSharedValue(0);

	const openRef = useRef(open);
	useEffect(() => {
		openRef.current = open;
	}, [open]);

	const [dragging, setDragging] = useState(false);
	const draggingRef = useRef(false);
	useEffect(() => {
		draggingRef.current = dragging;
	}, [dragging]);

	const modalOpenRef = useRef(anyModalOpen);
	useEffect(() => {
		modalOpenRef.current = anyModalOpen;
	}, [anyModalOpen]);

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

	const panelClosedTint = theme.colors.backgroundTertiary;
	const panelOpenColor = "#0E0E0E";
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
					translateX.value = Math.max(
						0,
						Math.min(screenWidth, screenWidth + g.dx),
					);
				},
				onPanResponderRelease: (_evt, g) => {
					const ratio = (screenWidth + g.dx) / screenWidth;
					const shouldClose =
						g.vx < -DRAG_VELOCITY_COMMIT ||
						ratio < 1 - DRAG_COMMIT_RATIO;
					commitOrSnapBack(!shouldClose);
				},
				onPanResponderTerminate: () => commitOrSnapBack(true),
				onPanResponderTerminationRequest: () => false,
			}),
		[screenWidth, translateX, commitOrSnapBack],
	);

	return (
		<View className="flex-1 bg-bg">
			<Animated.View
				{...closePanResponder.panHandlers}
				className="flex-1"
				style={panelStyle}
			>
				{panel}
			</Animated.View>

			<Animated.View
				{...openPanResponder.panHandlers}
				className="absolute inset-0 bg-bg"
				style={[
					{
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
