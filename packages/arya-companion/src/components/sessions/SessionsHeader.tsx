import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { type Href, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

/**
 * Top-of-drawer chrome: a settings shortcut row followed by the
 * "Sessions" title row with an optional bulk-delete glyph.
 */
export default function SessionsHeader({
	hasSessions,
	onDeleteAll,
}: {
	hasSessions: boolean;
	onDeleteAll: () => void;
}) {
	const theme = useTheme();
	const router = useRouter();
	return (
		<>
			{/* Settings shortcut row */}
			<View className="flex-row items-center justify-end px-4 pt-1 pb-2">
				<Pressable
					onPress={() => {
						Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
						// Intentionally don't close the drawer here — the
						// chat screen stays mounted under /settings, so the
						// drawer's open state is preserved. When the user
						// taps "back" on the settings screen, they return
						// to the still-open sessions sidebar.
						// Cast: typed-routes regenerates on `expo start`; until
						// then `/settings` isn't in the static `Href` union.
						router.push("/settings" as Href);
					}}
					hitSlop={6}
					accessibilityLabel="Settings"
					accessibilityRole="button"
					className="flex-row items-center gap-2 h-pill px-3 rounded-pill border border-border bg-bg-translucent active:bg-bg-hover"
				>
					<Ionicons name="settings-outline" size={18} color={theme.colors.text} />
					<Text
						className="text-sm font-semibold text-text"
						style={{ includeFontPadding: false }}
					>
						Settings
					</Text>
				</Pressable>
			</View>

			{/* "Sessions" title row */}
			<View className="flex-row items-center px-4 pt-1 pb-2 gap-2">
				<Text className="flex-1 text-lg font-bold text-text">Sessions</Text>
				{hasSessions ? (
					<Pressable
						onPress={() => {
							Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
							onDeleteAll();
						}}
						hitSlop={8}
						accessibilityLabel="Delete all sessions"
						accessibilityRole="button"
						className="w-8 h-8 items-center justify-center rounded-full active:bg-bg-hover"
					>
						<Ionicons
							name="trash-outline"
							size={18}
							// Subtle by default — the destructive color only
							// kicks in inside the confirmation modal, so the
							// header glyph stays calm.
							color={theme.colors.textSecondary}
						/>
					</Pressable>
				) : null}
			</View>
		</>
	);
}
