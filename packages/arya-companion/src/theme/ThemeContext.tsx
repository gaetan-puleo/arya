import { useColorScheme } from 'react-native';
import { createContext, useContext, useMemo } from 'react';
import type { AppThemeName, Theme } from './themes';
import { appThemes } from './themes';

interface ThemeContextValue {
  theme: Theme;
  colorScheme: 'light' | 'dark';
  themeName: AppThemeName;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: appThemes.dark,
  colorScheme: 'dark',
  themeName: 'dark',
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme() as 'light' | 'dark';
  const themeName = useMemo<AppThemeName>(() => colorScheme ?? 'dark', [colorScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: appThemes[themeName],
      colorScheme,
      themeName,
    }),
    [themeName, colorScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useUnistyles() {
  const ctx = useContext(ThemeContext);
  return { theme: ctx.theme, rt: { themeName: ctx.themeName } };
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  return { theme: ctx.theme, colorScheme: ctx.colorScheme, rt: { themeName: ctx.themeName } };
}
