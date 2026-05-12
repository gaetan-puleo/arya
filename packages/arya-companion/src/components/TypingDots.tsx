import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';

interface TypingDotsProps {
  color: string;
}

function Dot({ color, delay }: { color: string; delay: number }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 400 }),
          withTiming(0.3, { duration: 400 }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      className="w-1.5 h-1.5 rounded-full"
      style={[{ backgroundColor: color }, style]}
    />
  );
}

export default function TypingDots({ color }: TypingDotsProps) {
  return (
    <View className="flex-row items-center gap-1 pt-0.5">
      <Dot color={color} delay={0} />
      <Dot color={color} delay={200} />
      <Dot color={color} delay={400} />
    </View>
  );
}
