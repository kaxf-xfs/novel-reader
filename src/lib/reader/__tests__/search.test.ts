import { splitHighlight, makeSearchSnippet, hexToRgba } from '../search';

describe('splitHighlight', () => {
  it('splits around a match, preserving original case', () => {
    expect(splitHighlight('x剑气y剑', '剑')).toEqual([
      { text: 'x', match: false },
      { text: '剑', match: true },
      { text: '气y', match: false },
      { text: '剑', match: true },
    ]);
  });

  it('is case-insensitive but keeps original text', () => {
    expect(splitHighlight('abcABC', 'abc')).toEqual([
      { text: 'abc', match: true },
      { text: 'ABC', match: true },
    ]);
  });

  it('returns a single non-match segment when the term is absent or empty', () => {
    expect(splitHighlight('abc', 'z')).toEqual([{ text: 'abc', match: false }]);
    expect(splitHighlight('abc', '')).toEqual([{ text: 'abc', match: false }]);
  });
});

describe('makeSearchSnippet', () => {
  it('returns the whole block when it fits the window', () => {
    expect(makeSearchSnippet('他推开门看见剑气逼来', '剑气')).toBe('他推开门看见剑气逼来');
  });

  it('windows around the first match with ellipses when truncated', () => {
    const text = '甲'.repeat(30) + '剑气' + '乙'.repeat(60);
    const snip = makeSearchSnippet(text, '剑气', { before: 12, after: 40 });
    expect(snip.startsWith('…')).toBe(true);
    expect(snip.endsWith('…')).toBe(true);
    expect(snip).toContain('剑气');
    expect(snip).toContain('甲'.repeat(12));
    expect(snip).toContain('乙'.repeat(40));
  });

  it('falls back to the head when the term is absent', () => {
    expect(makeSearchSnippet('abc', 'z')).toBe('abc');
  });
});

describe('hexToRgba', () => {
  it('converts #rrggbb + alpha to an rgba() string', () => {
    expect(hexToRgba('#83a99b', 0.22)).toBe('rgba(131, 169, 155, 0.22)');
    expect(hexToRgba('#b0674a', 0.22)).toBe('rgba(176, 103, 74, 0.22)');
  });
});
