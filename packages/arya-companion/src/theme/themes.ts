import { Platform } from 'react-native';

// Only the tokens actually referenced through `theme.*` are kept here.
// Spacing/radius/font-weights live in Tailwind (NativeWind) directly.
const sharedFontSizes = {
  sm: 14,
} as const;

const monoFamily = Platform.OS === 'ios' ? 'Menlo-Regular' : 'monospace';

const sharedFonts = {
  mono: monoFamily,
} as const;

// Chrome token used to anchor floating controls above the input pill.
const sharedChrome = {
  pillHeight: 44,
} as const;

const shared = {
  fontSizes: sharedFontSizes,
  fonts: sharedFonts,
  chrome: sharedChrome,
} as const;

const black = '#000000';

const darkColors = {
  background: black,
  // Pressed-state surface — currently aliased to pure black so taps on
  // top of the page background read as a faint tint via the underlying
  // overlays. Kept distinct so future hover styling has a hook.
  backgroundHover: black,
  backgroundOverlay: 'rgba(0,0,0,0.6)',
  backgroundTranslucent: 'rgba(0,0,0,0.8)',
  backgroundSecondary: black,
  backgroundTertiary: '#1A1A1A',
  backgroundInput: black,
  text: '#ECECEC',
  textSecondary: '#B4B4B4',
  textTertiary: '#8E8E8E',
  textPlaceholder: '#6E6E6E',
  textInverse: '#171717',
  border: '#3E3E3E',
  borderFocus: '#ECECEC',
  primary: '#ECECEC',
  success: '#10A37F',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#60A5FA',
} as const;

type ThemeColors = typeof darkColors;
export type Theme = { colors: ThemeColors } & typeof shared;

export const darkTheme: Theme = { colors: darkColors, ...shared };
