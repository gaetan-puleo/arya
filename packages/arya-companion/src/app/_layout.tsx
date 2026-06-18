import Ionicons from "@expo/vector-icons/Ionicons";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import * as NavigationBar from "expo-navigation-bar";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { LogBox, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import "react-native-reanimated";
import "../../global.css";

import { useConnection } from "@/hooks/useConnection";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
	initialRouteName: "index",
};

// In dev, the [ws] reconnect retries spam LogBox toasts that cover the chat input
// (incl. the call button) when no arya server is reachable. Silence just that noise
// — real errors still surface. (Only affects the dev LogBox overlay.)
if (__DEV__) LogBox.ignoreLogs([/\[ws\]/]);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
	const [loaded, error] = useFonts({
		SpaceMono: require("../../assets/fonts/SpaceMono-Regular.ttf"),
		...Ionicons.font,
	});

	useEffect(() => {
		if (error) throw error;
	}, [error]);

	useEffect(() => {
		if (loaded) {
			SplashScreen.hideAsync();
		}
	}, [loaded]);

	// Mounts the WS transport once at app root. Reconnects are
	// triggered by the settings screen via `reconnect()` (services/aryaClient).
	useConnection();

	if (!loaded) {
		return null;
	}

	return <StackNavigator />;
}

function StackNavigator() {
	const insets = useSafeAreaInsets();

	// Android edge-to-edge: the nav bar is transparent and shows the window
	// background behind it (expo-navigation-bar's setBackgroundColorAsync is a
	// no-op under edge-to-edge). Paint that window bg black via expo-system-ui so
	// the bar reads black instead of the light splash default, and use light
	// buttons so the glyphs stay visible.
	useEffect(() => {
		if (Platform.OS !== "android") return;
		SystemUI.setBackgroundColorAsync("#000000").catch(() => {});
		NavigationBar.setButtonStyleAsync("light").catch(() => {});
	}, []);

	return (
		<ThemeProvider value={DarkTheme}>
			<StatusBar style="light" />
			<Stack screenOptions={{ headerShown: false }}>
				<Stack.Screen
					name="index"
					options={{ contentStyle: { flex: 1, paddingTop: insets.top } }}
				/>
				<Stack.Screen name="settings" />
				<Stack.Screen name="sub-agent/[runId]" />
			</Stack>
		</ThemeProvider>
	);
}
