import { createContext, useContext } from 'react';
import type { Theme } from './themes';
import { darkTheme } from './themes';

interface ThemeContextValue {
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
});

const value: ThemeContextValue = { theme: darkTheme };

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useUnistyles() {
  const ctx = useContext(ThemeContext);
  return { theme: ctx.theme };
}
