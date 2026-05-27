import type { Theme } from './themes';
import { darkTheme } from './themes';

/**
 * The theme is currently static (dark only). `useTheme` exists so call sites
 * can still read the active theme without binding to a specific constant —
 * leaving the door open to dynamic theming later without rippling changes.
 */
export function useTheme(): Theme {
  return darkTheme;
}
