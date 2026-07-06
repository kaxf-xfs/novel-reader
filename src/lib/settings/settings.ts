/**
 * T5: reader typography settings — the pure data model + validation.
 *
 * This module has NO React / storage / native dependencies so it can be unit
 * tested in isolation. Persistence lives in ./store.ts and the derived RN
 * styles in ./styles.ts.
 *
 * `sanitizeSettings` is the single trust boundary: every settings value that
 * enters the app (loaded from disk, or produced by a UI control) is passed
 * through it, so the rest of the app can assume a fully-populated, in-range
 * `ReaderSettings`. This also makes forward/backward-compatible schema
 * changes safe — an old persisted blob missing a new field just gets the
 * default for that field.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Available reading themes (see ./styles.ts for the concrete palettes). */
export type ThemeId = 'dark' | 'black' | 'paper' | 'sepia' | 'green';

/**
 * Available fonts. `cangEr` = 仓耳今楷 (bundled TTF, loaded at runtime so it
 * can ship via OTA). `system` = 苹方 (iOS default sans). `systemSerif` =
 * 报宋/Songti (iOS serif).
 */
export type FontId = 'cangEr' | 'system' | 'systemSerif';

export const THEME_IDS: readonly ThemeId[] = ['dark', 'black', 'paper', 'sepia', 'green'];
export const FONT_IDS: readonly FontId[] = ['cangEr', 'system', 'systemSerif'];

// ---------------------------------------------------------------------------
// Settings shape
// ---------------------------------------------------------------------------

export interface ReaderSettings {
  fontId: FontId;
  /** Body font size in px. */
  fontSize: number;
  /** Line height as a multiple of fontSize (e.g. 1.8). */
  lineHeightMul: number;
  /** Gap below each paragraph in px. */
  paragraphSpacing: number;
  /** Horizontal page padding in px. */
  marginH: number;
  themeId: ThemeId;
}

// ---------------------------------------------------------------------------
// Numeric bounds (min/max/step — step is consumed by the UI stepper)
// ---------------------------------------------------------------------------

export interface NumericBounds {
  min: number;
  max: number;
  step: number;
}

export const FONT_BOUNDS: NumericBounds = { min: 14, max: 30, step: 1 };
export const LINE_HEIGHT_BOUNDS: NumericBounds = { min: 1.2, max: 2.4, step: 0.1 };
export const PARAGRAPH_SPACING_BOUNDS: NumericBounds = { min: 0, max: 32, step: 2 };
export const MARGIN_BOUNDS: NumericBounds = { min: 12, max: 40, step: 2 };

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontId: 'system',
  fontSize: 18,
  lineHeightMul: 1.8,
  paragraphSpacing: 14,
  marginH: 24,
  themeId: 'dark',
};

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

function clampNumber(value: unknown, bounds: NumericBounds, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, bounds.min), bounds.max);
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Merges a (possibly partial or untrusted) patch over the defaults, coercing
 * every field into its valid range / enum. Never throws.
 */
export function sanitizeSettings(patch: Partial<ReaderSettings>): ReaderSettings {
  return {
    fontId: pickEnum(patch.fontId, FONT_IDS, DEFAULT_SETTINGS.fontId),
    fontSize: clampNumber(patch.fontSize, FONT_BOUNDS, DEFAULT_SETTINGS.fontSize),
    lineHeightMul: clampNumber(patch.lineHeightMul, LINE_HEIGHT_BOUNDS, DEFAULT_SETTINGS.lineHeightMul),
    paragraphSpacing: clampNumber(
      patch.paragraphSpacing,
      PARAGRAPH_SPACING_BOUNDS,
      DEFAULT_SETTINGS.paragraphSpacing,
    ),
    marginH: clampNumber(patch.marginH, MARGIN_BOUNDS, DEFAULT_SETTINGS.marginH),
    themeId: pickEnum(patch.themeId, THEME_IDS, DEFAULT_SETTINGS.themeId),
  };
}
