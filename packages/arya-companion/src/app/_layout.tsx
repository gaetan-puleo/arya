import { ThemeProvider as ThemeProviderUI } from "@/theme/ThemeContext";
import Ionicons from "@expo/vector-icons/Ionicons";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import * as NavigationBar from "expo-navigation-bar";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import "react-native-reanimated";
import "../../global.css";

import { useConnection } from "@/hooks/useConnection";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
	initialRouteName: "index",
};

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

	return <RootLayoutNav />;
}

function RootLayoutNav() {
	return (
		<ThemeProviderUI>
			<StackNavigator />
		</ThemeProviderUI>
	);
}

function StackNavigator() {
	const insets = useSafeAreaInsets();

	// Android edge-to-edge mode: the navigation bar is transparent and
	// the app's root view bg shows through (see `enforceContrast: false`
	// in app.json's expo-navigation-bar plugin config). We only set the
	// button (icon) style so glyphs read well on the dark background.
	useEffect(() => {
		if (Platform.OS !== "android") return;
		NavigationBar.setStyle("light");
	}, []);

	return (
		<ThemeProvider value={DarkTheme}>
			<StatusBar style="light" />
			<Stack screenOptions={{ headerShown: false }}>
				<Stack.Screen
					name="index"
					options={{ contentStyle: { paddingTop: insets.top } }}
				/>
				<Stack.Screen name="two" />
				<Stack.Screen name="sub-agent/[runId]" />
			</Stack>
		</ThemeProvider>
	);
}
