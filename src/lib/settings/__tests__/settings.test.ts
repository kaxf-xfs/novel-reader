import {
  DEFAULT_SETTINGS,
  FONT_BOUNDS,
  LINE_HEIGHT_BOUNDS,
  MARGIN_BOUNDS,
  PARAGRAPH_SPACING_BOUNDS,
  sanitizeSettings,
} from '../settings';

describe('sanitizeSettings', () => {
  it('returns the defaults unchanged for an empty patch', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial patch over the defaults', () => {
    const result = sanitizeSettings({ fontSize: 22 });
    expect(result.fontSize).toBe(22);
    // other fields fall back to defaults
    expect(result.themeId).toBe(DEFAULT_SETTINGS.themeId);
    expect(result.fontId).toBe(DEFAULT_SETTINGS.fontId);
  });

  it('clamps fontSize below the minimum up to the minimum', () => {
    expect(sanitizeSettings({ fontSize: 2 }).fontSize).toBe(FONT_BOUNDS.min);
  });

  it('clamps fontSize above the maximum down to the maximum', () => {
    expect(sanitizeSettings({ fontSize: 999 }).fontSize).toBe(FONT_BOUNDS.max);
  });

  it('clamps lineHeightMul, paragraphSpacing and marginH into range', () => {
    const result = sanitizeSettings({
      lineHeightMul: 99,
      paragraphSpacing: -5,
      marginH: 999,
    });
    expect(result.lineHeightMul).toBe(LINE_HEIGHT_BOUNDS.max);
    expect(result.paragraphSpacing).toBe(PARAGRAPH_SPACING_BOUNDS.min);
    expect(result.marginH).toBe(MARGIN_BOUNDS.max);
  });

  it('falls back to the default themeId for an unknown theme', () => {
    expect(sanitizeSettings({ themeId: 'neon' as never }).themeId).toBe(
      DEFAULT_SETTINGS.themeId,
    );
  });

  it('falls back to the default fontId for an unknown font', () => {
    expect(sanitizeSettings({ fontId: 'comic' as never }).fontId).toBe(
      DEFAULT_SETTINGS.fontId,
    );
  });

  it('ignores non-numeric values and keeps the default', () => {
    expect(sanitizeSettings({ fontSize: NaN }).fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(
      sanitizeSettings({ fontSize: 'big' as never }).fontSize,
    ).toBe(DEFAULT_SETTINGS.fontSize);
  });
});
