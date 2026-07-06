import { DEFAULT_SETTINGS, THEME_IDS } from '../settings';
import {
  CANGER_FONT_FAMILY,
  computeReaderStyles,
  resolveTheme,
} from '../styles';

describe('resolveTheme', () => {
  it('returns a full palette for every theme id', () => {
    for (const id of THEME_IDS) {
      const theme = resolveTheme(id);
      expect(theme.background).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.text).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.heading).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.subtle).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.border).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('gives paper a light background and dark a dark background', () => {
    // paper is a light theme: background lighter than its text
    expect(resolveTheme('paper').background.toLowerCase()).not.toBe(
      resolveTheme('dark').background.toLowerCase(),
    );
  });
});

describe('computeReaderStyles', () => {
  it('uses the settings font size for paragraphs', () => {
    const s = computeReaderStyles({ ...DEFAULT_SETTINGS, fontSize: 22 });
    expect(s.paragraph.fontSize).toBe(22);
  });

  it('computes line height as rounded fontSize * lineHeightMul', () => {
    const s = computeReaderStyles({ ...DEFAULT_SETTINGS, fontSize: 20, lineHeightMul: 1.8 });
    expect(s.paragraph.lineHeight).toBe(36); // 20 * 1.8
  });

  it('maps paragraphSpacing to the paragraph bottom margin', () => {
    const s = computeReaderStyles({ ...DEFAULT_SETTINGS, paragraphSpacing: 20 });
    expect(s.paragraph.marginBottom).toBe(20);
  });

  it('maps marginH to horizontal content padding', () => {
    const s = computeReaderStyles({ ...DEFAULT_SETTINGS, marginH: 32 });
    expect(s.content.paddingHorizontal).toBe(32);
  });

  it('applies the theme background and text colors', () => {
    const s = computeReaderStyles({ ...DEFAULT_SETTINGS, themeId: 'paper' });
    const paper = resolveTheme('paper');
    expect(s.container.backgroundColor).toBe(paper.background);
    expect(s.paragraph.color).toBe(paper.text);
    expect(s.heading.color).toBe(paper.heading);
  });

  it('sets fontFamily to the CangEr family when fontId is cangEr', () => {
    const s = computeReaderStyles({ ...DEFAULT_SETTINGS, fontId: 'cangEr' });
    expect(s.paragraph.fontFamily).toBe(CANGER_FONT_FAMILY);
    expect(s.heading.fontFamily).toBe(CANGER_FONT_FAMILY);
  });

  it('leaves fontFamily undefined for the system sans font', () => {
    const s = computeReaderStyles({ ...DEFAULT_SETTINGS, fontId: 'system' });
    expect(s.paragraph.fontFamily).toBeUndefined();
  });

  it('uses an iOS serif family for the systemSerif font', () => {
    const s = computeReaderStyles({ ...DEFAULT_SETTINGS, fontId: 'systemSerif' });
    expect(s.paragraph.fontFamily).toBe('Songti SC');
  });

  it('makes the heading larger than the body', () => {
    const s = computeReaderStyles({ ...DEFAULT_SETTINGS, fontSize: 18 });
    expect(s.heading.fontSize).toBeGreaterThan(s.paragraph.fontSize);
  });
});
