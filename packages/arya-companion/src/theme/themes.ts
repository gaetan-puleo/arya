export const sharedSpacing = {
  0: 0,
  0.25: 2,
  0.5: 4,
  0.75: 8,
  1: 12,
  1.5: 14,
  2: 16,
  2.5: 18,
  3: 20,
  3.5: 22,
  4: 24,
  4.5: 26,
  5: 28,
  5.5: 30,
  6: 32,
  6.5: 36,
  7: 40,
  7.5: 44,
  8: 48,
  8.5: 52,
  9: 56,
  9.5: 60,
  10: 64,
  11: 72,
  12: 80,
  13: 88,
  14: 96,
  15: 104,
  16: 112,
  17: 120,
  18: 128,
  19: 136,
  20: 144,
} as const;

export const sharedRadius = {
  0: 0,
  1: 3,
  2: 5,
  3: 7,
  4: 9,
  5: 10,
  6: 16,
  7: 19,
  8: 22,
  9: 26,
  10: 34,
  11: 42,
  12: 50,
  full: 9999,
} as const;

export const sharedFontSizes = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const sharedFontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
} as const;

const darkColors = {
  background: '#212121',
  backgroundHover: '#2A2A2A',
  backgroundFocus: '#303030',
  backgroundAccent: '#303030',
  backgroundOverlay: 'rgba(0,0,0,0.6)',
  backgroundSecondary: '#171717',
  backgroundTertiary: '#2F2F2F',
  backgroundInput: '#303030',
  text: '#ECECEC',
  textSecondary: '#B4B4B4',
  textTertiary: '#8E8E8E',
  textPlaceholder: '#6E6E6E',
  textInverse: '#171717',
  border: '#3E3E3E',
  borderFocus: '#ECECEC',
  borderTransparent: 'transparent',
  primary: '#ECECEC',
  primaryFocus: '#FFFFFF',
  primaryHover: '#D1D1D1',
  success: '#10A37F',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#60A5FA',
  tint: '#ECECEC',
  tabIconDefault: '#6E6E6E',
  tabIconSelected: '#ECECEC',
  shadow: 'rgba(0,0,0,0.4)',
  divider: '#3E3E3E',
} as const;

const lightColors = {
  background: '#FFFFFF',
  backgroundHover: '#F7F7F8',
  backgroundFocus: '#FFFFFF',
  backgroundAccent: '#FFFFFF',
  backgroundOverlay: 'rgba(0,0,0,0.1)',
  backgroundSecondary: '#F7F7F8',
  backgroundTertiary: '#ECECEC',
  backgroundInput: '#F4F4F4',
  text: '#1A1A1A',
  textSecondary: '#6E6E6E',
  textTertiary: '#8E8E8E',
  textPlaceholder: '#B4B4B4',
  textInverse: '#FFFFFF',
  border: '#E5E5E5',
  borderFocus: '#1A1A1A',
  borderTransparent: 'transparent',
  primary: '#1A1A1A',
  primaryFocus: '#000000',
  primaryHover: '#333333',
  success: '#10A37F',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#60A5FA',
  tint: '#1A1A1A',
  tabIconDefault: '#B4B4B4',
  tabIconSelected: '#1A1A1A',
  shadow: 'rgba(0,0,0,0.06)',
  divider: '#E5E5E5',
} as const;

export type ThemeColors = {
  [K in keyof typeof darkColors]: string;
};
export type Theme = {
  colors: ThemeColors;
  spacing: typeof sharedSpacing;
  radius: typeof sharedRadius;
  fontSizes: typeof sharedFontSizes;
  fontWeights: typeof sharedFontWeights;
};

export const darkTheme: Theme = {
  colors: darkColors,
  spacing: sharedSpacing,
  radius: sharedRadius,
  fontSizes: sharedFontSizes,
  fontWeights: sharedFontWeights,
};

export const lightTheme: Theme = {
  colors: lightColors,
  spacing: sharedSpacing,
  radius: sharedRadius,
  fontSizes: sharedFontSizes,
  fontWeights: sharedFontWeights,
};

export const appThemes = {
  dark: darkTheme,
  light: lightTheme,
} as const;

export type AppThemeName = keyof typeof appThemes;
