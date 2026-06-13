import { ActivityIndicator, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";

import { useStore } from "@/state/store";
import { useTheme } from "@/theme/ThemeContext";

/**
 * Top-centered pill shown while the host is cold-loading a model (e.g. after a
 * model switch, which probes /props and can take 10-30s). Driven by the WS
 * `model_loading` frame via the store's `loadingModel`.
 */
export default function ModelLoadingBanner() {
	const loadingModel = useStore((s) => s.loadingModel);
	const theme = useTheme();

	if (!loadingModel) return null;

	return (
		<Animated.View
			entering={FadeInUp.duration(200)}
			exiting={FadeOutUp.duration(200)}
			pointerEvents="none"
			className="absolute left-0 right-0 top-0 items-center z-30"
			style={{ paddingTop: 8 }}
		>
			<View
				className="flex-row items-center gap-2 px-3 py-1.5 rounded-pill border border-border"
				style={{ backgroundColor: theme.colors.backgroundTertiary }}
			>
				<ActivityIndicator size="small" color={theme.colors.textSecondary} />
				<Text className="text-sm text-text-secondary" numberOfLines={1}>
					Loading {loadingModel.split("/").pop()}…
				</Text>
			</View>
		</Animated.View>
	);
}
