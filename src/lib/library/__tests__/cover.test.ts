import { buildCover, coverTextColor, pickCoverColor, COVER_PALETTE } from '../cover';

describe('coverTextColor', () => {
  it('returns dark text on a light (pastel) background', () => {
    expect(coverTextColor('#E8D5B7')).toBe('#1a1a1a');
  });

  it('returns light text on a dark background', () => {
    expect(coverTextColor('#2a2d35')).toBe('#f2ede1');
  });

  it('handles 6-digit hex regardless of case', () => {
    expect(coverTextColor('#ffffff')).toBe('#1a1a1a');
    expect(coverTextColor('#000000')).toBe('#f2ede1');
  });
});

describe('pickCoverColor', () => {
  it('returns a color from the palette', () => {
    expect(COVER_PALETTE).toContain(pickCoverColor('凡人修仙传'));
  });

  it('is deterministic for the same title', () => {
    expect(pickCoverColor('琥珀之剑')).toBe(pickCoverColor('琥珀之剑'));
  });

  it('every palette color is dark enough for light text', () => {
    for (const c of COVER_PALETTE) {
      expect(coverTextColor(c)).toBe('#f2ede1');
    }
  });
});

describe('buildCover', () => {
  it('uses the first two characters of the title as the label', () => {
    expect(buildCover('凡人修仙传').label).toBe('凡人');
  });

  it('strips bracket decoration before taking label chars', () => {
    expect(buildCover('《昊天传》').label).toBe('昊天');
    expect(buildCover('【测试】').label).toBe('测试');
  });

  it('falls back to 书 for an empty or decoration-only title', () => {
    expect(buildCover('').label).toBe('书');
    expect(buildCover('《》').label).toBe('书');
  });

  it('keeps a single-character title as one char', () => {
    expect(buildCover('书').label).toBe('书');
  });

  it('counts astral (surrogate-pair) characters as one', () => {
    expect(buildCover('𠀀𠀁𠀂').label).toBe('𠀀𠀁');
  });

  it('derives a palette background from the title with contrasting text', () => {
    const cover = buildCover('测试小说');
    expect(COVER_PALETTE).toContain(cover.background);
    expect(cover.textColor).toBe('#f2ede1');
    // deterministic
    expect(buildCover('测试小说').background).toBe(cover.background);
  });
});
