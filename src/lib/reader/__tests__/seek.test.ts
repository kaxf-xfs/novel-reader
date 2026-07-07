// src/lib/reader/__tests__/seek.test.ts
import { fractionToChapterIndex, chapterIndexToFraction } from '../seek';

describe('fractionToChapterIndex', () => {
  it('maps 0 → first, 1 → last', () => {
    expect(fractionToChapterIndex(0, 10)).toBe(0);
    expect(fractionToChapterIndex(1, 10)).toBe(9);
  });

  it('rounds to the nearest chapter', () => {
    expect(fractionToChapterIndex(0.5, 11)).toBe(5); // 0.5 * 10 = 5
    expect(fractionToChapterIndex(0.44, 11)).toBe(4); // 4.4 → 4
  });

  it('clamps out-of-range fractions', () => {
    expect(fractionToChapterIndex(-0.2, 10)).toBe(0);
    expect(fractionToChapterIndex(1.7, 10)).toBe(9);
  });

  it('handles empty / single-chapter books', () => {
    expect(fractionToChapterIndex(0.5, 0)).toBe(0);
    expect(fractionToChapterIndex(0.5, 1)).toBe(0);
  });
});

describe('chapterIndexToFraction', () => {
  it('maps first → 0, last → 1', () => {
    expect(chapterIndexToFraction(0, 10)).toBe(0);
    expect(chapterIndexToFraction(9, 10)).toBe(1);
  });

  it('is the inverse of fractionToChapterIndex at endpoints', () => {
    const total = 20;
    expect(fractionToChapterIndex(chapterIndexToFraction(7, total), total)).toBe(7);
  });

  it('handles single-chapter / empty', () => {
    expect(chapterIndexToFraction(0, 1)).toBe(0);
    expect(chapterIndexToFraction(0, 0)).toBe(0);
  });

  it('clamps out-of-range indices', () => {
    expect(chapterIndexToFraction(-3, 10)).toBe(0);
    expect(chapterIndexToFraction(99, 10)).toBe(1);
  });
});
