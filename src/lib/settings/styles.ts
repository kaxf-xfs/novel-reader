/**
 * T5: derive concrete React Native styles + theme palette from ReaderSettings.
 *
 * Kept dependency-free (no `react-native` import) so it stays unit-testable —
 * we return plain style objects, which RN's `style` prop accepts directly.
 */

import type { FontId, ReaderSettings, ThemeId } from './settings';

// ---------------------------------------------------------------------------
// Theme palettes
// ---------------------------------------------------------------------------

export interface Theme {
  /** Page background. */
  background: string;
  /** Body text. */
  text: string;
  /** Chapter heading text (usually a touch brighter/darker than body). */
  heading: string;
  /** Secondary UI text (top/bottom bars, hints). */
  subtle: string;
  /** Hairline separators. */
  border: string;
  /** Restrained accent for progress + primary controls. */
  accent: string;
}

const THEMES: Record<ThemeId, Theme> = {
  // 墨隐 — deep blue-black ink with an ivory read and a celadon accent.
  dark: {
    background: '#14161b',
    text: '#d8d3c6',
    heading: '#ece7db',
    subtle: '#7f838d',
    border: '#24272f',
    accent: '#83a99b',
  },
  // True OLED black.
  black: {
    background: '#000000',
    text: '#c9c7c0',
    heading: '#efece5',
    subtle: '#7a7e88',
    border: '#1b1b1d',
    accent: '#8fb8a8',
  },
  // Clean white paper.
  paper: {
    background: '#faf9f6',
    text: '#2b2b2b',
    heading: '#111111',
    subtle: '#8a8a8a',
    border: '#e5e3dd',
    accent: '#4b6b88',
  },
  // 起点-style warm eye-care paper — a soft yellow-warm off-white (the tone
  // 起点 shows after enabling 护眼), lighter than 米黄 but clearly warmer than paper.
  warmWhite: {
    background: '#f5eed9',
    text: '#35312b',
    heading: '#22201b',
    subtle: '#9e9075',
    border: '#e8dfc8',
    accent: '#b0674a',
  },
  // Warm sepia (paper yellow).
  sepia: {
    background: '#f3e9d6',
    text: '#4a3f30',
    heading: '#2e2619',
    subtle: '#9b8b6f',
    border: '#e0d4bd',
    accent: '#a4552f',
  },
  // Eye-care green.
  green: {
    background: '#c8e0c6',
    text: '#33422f',
    heading: '#1f2b1c',
    subtle: '#6b7d66',
    border: '#b2cfae',
    accent: '#3f7a52',
  },
};

export function resolveTheme(id: ThemeId): Theme {
  return THEMES[id] ?? THEMES.dark;
}

// ---------------------------------------------------------------------------
// Font family mapping
// ---------------------------------------------------------------------------

/**
 * The key we register 仓耳今楷 under via expo-font's `useFonts`. The style
 * `fontFamily` string must match this exactly.
 */
export const CANGER_FONT_FAMILY = 'CangErJinKai04';

/** iOS bundled serif (报宋/宋体). */
const IOS_SERIF_FAMILY = 'Songti SC';

/**
 * Returns the RN `fontFamily` for a font id, or `undefined` to use the system
 * default sans (苹方 on iOS).
 */
function fontFamilyFor(fontId: FontId): string | undefined {
  switch (fontId) {
    case 'cangEr':
      return CANGER_FONT_FAMILY;
    case 'systemSerif':
      return IOS_SERIF_FAMILY;
    case 'system':
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Derived styles
// ---------------------------------------------------------------------------

export interface ReaderStyles {
  theme: Theme;
  container: { backgroundColor: string };
  content: { paddingHorizontal: number };
  paragraph: {
    color: string;
    fontSize: number;
    lineHeight: number;
    marginBottom: number;
    fontFamily: string | undefined;
  };
  heading: {
    color: string;
    fontSize: number;
    lineHeight: number;
    fontFamily: string | undefined;
  };
}

/** Chapter heading is 1.2x the body size. */
const HEADING_SCALE = 1.2;

export function computeReaderStyles(settings: ReaderSettings): ReaderStyles {
  const theme = resolveTheme(settings.themeId);
  const fontFamily = fontFamilyFor(settings.fontId);

  const headingSize = Math.round(settings.fontSize * HEADING_SCALE);

  return {
    theme,
    container: { backgroundColor: theme.background },
    content: { paddingHorizontal: settings.marginH },
    paragraph: {
      color: theme.text,
      fontSize: settings.fontSize,
      lineHeight: Math.round(settings.fontSize * settings.lineHeightMul),
      marginBottom: settings.paragraphSpacing,
      fontFamily,
    },
    heading: {
      color: theme.heading,
      fontSize: headingSize,
      lineHeight: Math.round(headingSize * settings.lineHeightMul),
      fontFamily,
    },
  };
}
