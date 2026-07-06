import { buildCover, coverTextColor } from '../cover';

describe('coverTextColor', () => {
  it('returns dark text on a light (pastel) background', () => {
    expect(coverTextColor('#E8D5B7')).toBe('#1a1a1a');
  });

  it('returns light text on a dark background', () => {
    expect(coverTextColor('#2a2d35')).toBe('#f5f3ee');
  });

  it('handles shorthand-less 6-digit hex regardless of case', () => {
    expect(coverTextColor('#ffffff')).toBe('#1a1a1a');
    expect(coverTextColor('#000000')).toBe('#f5f3ee');
  });
});

describe('buildCover', () => {
  it('uses the first two characters of the title as the label', () => {
    const cover = buildCover('凡人修仙传', '#3a5f9a');
    expect(cover.label).toBe('凡人');
    expect(cover.background).toBe('#3a5f9a');
  });

  it('strips bracket decoration before taking label chars', () => {
    expect(buildCover('《昊天传》', '#E8D5B7').label).toBe('昊天');
    expect(buildCover('【测试】', '#E8D5B7').label).toBe('测试');
  });

  it('falls back to 书 for an empty or decoration-only title', () => {
    expect(buildCover('', '#E8D5B7').label).toBe('书');
    expect(buildCover('《》', '#E8D5B7').label).toBe('书');
  });

  it('keeps a single-character title as one char', () => {
    expect(buildCover('书', '#E8D5B7').label).toBe('书');
  });

  it('counts astral (surrogate-pair) characters as one', () => {
    // '𠀀' is a single code point spanning two UTF-16 units
    expect(buildCover('𠀀𠀁𠀂', '#E8D5B7').label).toBe('𠀀𠀁');
  });

  it('sets a contrasting text color from the background', () => {
    expect(buildCover('测试', '#E8D5B7').textColor).toBe('#1a1a1a');
    expect(buildCover('测试', '#222222').textColor).toBe('#f5f3ee');
  });
});
