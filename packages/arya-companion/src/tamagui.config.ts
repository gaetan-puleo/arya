import { createTamagui } from '@tamagui/core';
import { createAnimations } from '@tamagui/animations-react-native';
import { shorthands } from '@tamagui/shorthands';
import { createFont, createTokens } from '@tamagui/web';

// Size tokens (in px)
const size = {
  0: 0,
  0.25: 2,
  0.5: 4,
  0.75: 8,
  1: 12,
  1.5: 14,
  true: 16,
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
};

// Space tokens (derived from size)
const space = Object.fromEntries(
  Object.entries(size).map(([k, v]) => [k, Math.max(0, v <= 16 ? Math.round(v * 0.333) : Math.floor(v * 0.7 - 12))])
);

// Negative space
const spaceNegative = Object.fromEntries(
  Object.entries(space).slice(1).map(([k, v]) => [`-${k}`, -v])
);

// Radius tokens
const radius = {
  0: 0,
  1: 3,
  2: 5,
  3: 7,
  true: 9,
  4: 9,
  5: 10,
  6: 16,
  7: 19,
  8: 22,
  9: 26,
  10: 34,
  11: 42,
  12: 50,
};

// Z-index tokens
const zIndex = {
  0: 0,
  1: 100,
  true: 200,
  2: 200,
  3: 300,
  4: 400,
  5: 500,
};

// Create tokens
const tokens = createTokens({
  color: {
    white: '#fff',
    black: '#000',
  },
  size,
  space: { ...space, ...spaceNegative },
  radius,
  zIndex,
});

// Create animations (React Native driver)
const animations = createAnimations({
  fast: { type: 'timing', duration: 100 },
  normal: { type: 'timing', duration: 200 },
  slow: { type: 'timing', duration: 400 },
  slower: { type: 'timing', duration: 600 },
  bouncy: { type: 'spring', damping: 12, stiffness: 200, mass: 0.9 },
  lazy: { type: 'spring', damping: 20, stiffness: 120, mass: 0.9 },
  quick: { type: 'spring', damping: 30, stiffness: 300, mass: 0.9 },
});

// Create font size objects with string keys
const sizeObject: Record<string, number> = {};
const lineHeightObject: Record<string, number> = {};
for (const [key, value] of Object.entries(size)) {
  sizeObject[key] = value;
  lineHeightObject[key] = value;
}
// Ensure true key is set for font defaults
sizeObject['true'] = 16;
lineHeightObject['true'] = 16;

// Create fonts
const bodyFont = createFont({
  family: 'System',
  size: sizeObject,
  lineHeight: lineHeightObject as Record<string, number>,
  transform: {},
  weight: {
    true: '400',
    1: '400',
    2: '500',
    3: '600',
    4: '700',
    5: '800',
    6: '900',
  },
  color: {
    true: '$color',
    1: '$color',
  },
  letterSpacing: {
    true: 0,
    1: 0,
  },
});

const headingFont = createFont({
  family: 'Heading',
  size: sizeObject,
  lineHeight: lineHeightObject as Record<string, number>,
  transform: {},
  weight: {
    true: '700',
    1: '400',
    2: '500',
    3: '600',
    4: '700',
    5: '800',
    6: '900',
  },
  color: {
    true: '$color',
    1: '$color',
  },
  letterSpacing: {
    true: 0,
    1: 0,
  },
});

// ChatGPT-inspired dark color palette — gray & black, no purple
const colors = {
  // Backgrounds
  background: '#212121',
  backgroundHover: '#2A2A2A',
  backgroundFocus: '#303030',
  backgroundAccent: '#303030',
  backgroundOverlay: 'rgba(0,0,0,0.6)',

  // Surface / card backgrounds
  backgroundSecondary: '#171717',
  backgroundTertiary: '#2F2F2F',
  backgroundInput: '#303030',

  // Text
  text: '#ECECEC',
  textSecondary: '#B4B4B4',
  textTertiary: '#8E8E8E',
  textPlaceholder: '#6E6E6E',
  textInverse: '#171717',

  // Borders
  border: '#3E3E3E',
  borderFocus: '#ECECEC',
  borderTransparent: 'transparent',

  // Semantic
  primary: '#ECECEC',
  primaryFocus: '#FFFFFF',
  primaryHover: '#D1D1D1',
  success: '#10A37F',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#60A5FA',

  // Shadows
  shadowColor: 'rgba(0,0,0,0.4)',

  // Divider
  divider: '#3E3E3E',
};

// Light theme overrides — clean white/gray
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
  primary: '#1A1A1A',
  primaryFocus: '#000000',
  primaryHover: '#333333',
  success: '#10A37F',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#60A5FA',
  shadowColor: 'rgba(0,0,0,0.06)',
  divider: '#E5E5E5',
};

const config = createTamagui({
  animations,
  shorthands,
  fonts: {
    body: bodyFont,
    heading: headingFont,
  },
  themes: {
    dark: colors,
    light: lightColors,
  },
  tokens,
  media: {
    sm: { maxWidth: 375 },
    md: { maxWidth: 768 },
    lg: { maxWidth: 1024 },
    xl: { maxWidth: 1280 },
    xxl: { maxWidth: 1536 },
  },
  settings: {
    shouldAddPrefersColorThemes: true,
    defaultFont: 'body',
  },
});

export default config;

import type { TamaguiConfig } from '@tamagui/web';

declare module '@tamagui/web' {
  interface TamaguiCustomConfig extends TamaguiConfig {}
}
