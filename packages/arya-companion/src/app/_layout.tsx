import { ThemeProvider as ThemeProviderUI, useAppTheme } from '@/theme/ThemeContext';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import 'react-native-reanimated';

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../../assets/fonts/SpaceMono-Regular.ttf'),
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

// NOTE: For any new screen with `headerShown: false`, add
//   options={{ contentStyle: { paddingTop: insets.top } }}
// so its content sits below the system status bar.
// Screens that show a native header (e.g. `two`, `sub-agent/[runId]`)
// do NOT need this — the header already accounts for the status bar.
function StackNavigator() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useAppTheme();
  const isDark = colorScheme === 'dark';

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
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
