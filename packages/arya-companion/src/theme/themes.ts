import { Platform } from 'react-native';

const sharedSpacing = {
  0: 0,
  0.25: 1,
  0.5: 2,
  0.75: 3,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  4.5: 18,
  5: 20,
  5.5: 22,
  6: 24,
  6.5: 26,
  7: 28,
  7.5: 30,
  8: 32,
  8.5: 34,
  9: 36,
  9.5: 38,
  10: 40,
  11: 44,
  12: 48,
  13: 52,
  14: 56,
  15: 60,
  16: 64,
  17: 68,
  18: 72,
  19: 76,
  20: 80,
} as const;

const sharedRadius = {
  0: 0,
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 12,
  6: 16,
  7: 20,
  8: 24,
  9: 28,
  10: 32,
  11: 40,
  12: 48,
  full: 9999,
} as const;

const sharedFontSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 30,
} as const;

const sharedFontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
} as const;

const monoFamily = Platform.OS === 'ios' ? 'Menlo-Regular' : 'monospace';

const sharedFonts = {
  mono: monoFamily,
} as const;

// Chrome tokens — shared pill/card geometry used by floating controls
// and modal cards. Kept here so adjustments stay in one place.
const sharedChrome = {
  pillHeight: 44,
  pillRadius: 24,
  cardRadius: 16,
} as const;

const shared = {
  spacing: sharedSpacing,
  radius: sharedRadius,
  fontSizes: sharedFontSizes,
  fontWeights: sharedFontWeights,
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
