import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

interface TypingDotsProps {
	color?: string;
}

/**
 * Three pulsing dots used inside the streaming-placeholder bubble.
 * Pure presentational — no data inputs.
 */
export default function TypingDots({ color = "#8E8E8E" }: TypingDotsProps) {
	const dot1 = useRef(new Animated.Value(0)).current;
	const dot2 = useRef(new Animated.Value(0)).current;
	const dot3 = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		const animate = (value: Animated.Value, delay: number) =>
			Animated.loop(
				Animated.sequence([
					Animated.delay(delay),
					Animated.timing(value, {
						toValue: 1,
						duration: 300,
						useNativeDriver: true,
					}),
					Animated.timing(value, {
						toValue: 0,
						duration: 300,
						useNativeDriver: true,
					}),
				]),
			);
		const a1 = animate(dot1, 0);
		const a2 = animate(dot2, 150);
		const a3 = animate(dot3, 300);
		a1.start();
		a2.start();
		a3.start();
		return () => {
			a1.stop();
			a2.stop();
			a3.stop();
		};
	}, [dot1, dot2, dot3]);

	const dotStyle = {
		width: 6,
		height: 6,
		borderRadius: 3,
		backgroundColor: color,
		marginHorizontal: 2,
	};

	return (
		<View className="flex-row items-center" style={{ height: 14 }}>
			<Animated.View
				style={[
					dotStyle,
					{
						opacity: dot1.interpolate({
							inputRange: [0, 1],
							outputRange: [0.3, 1],
						}),
					},
				]}
			/>
			<Animated.View
				style={[
					dotStyle,
					{
						opacity: dot2.interpolate({
							inputRange: [0, 1],
							outputRange: [0.3, 1],
						}),
					},
				]}
			/>
			<Animated.View
				style={[
					dotStyle,
					{
						opacity: dot3.interpolate({
							inputRange: [0, 1],
							outputRange: [0.3, 1],
						}),
					},
				]}
			/>
		</View>
	);
}
