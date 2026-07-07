/* @jest-environment node */
/**
 * T4: chapterProgressPercent — pure helper used by LibraryScreen to render
 * a book's reading progress (chapterIndex / totalChapters) as a percentage.
 */

import { chapterProgressPercent, chapterProgressPercentPrecise } from '../progress';

describe('chapterProgressPercent', () => {
  it('returns null when totalChapters is 0 (no chapters parsed)', () => {
    expect(chapterProgressPercent(0, 0)).toBeNull();
  });

  it('returns 0 for chapterIndex 0', () => {
    expect(chapterProgressPercent(0, 10)).toBe(0);
  });

  it('computes a rounded percentage mid-book', () => {
    // 9 chapters (indices 0-8); index 4 is exactly halfway → 50%
    expect(chapterProgressPercent(4, 9)).toBe(50);
  });

  it('returns 100 for the last chapter', () => {
    expect(chapterProgressPercent(9, 10)).toBe(100);
  });

  it('clamps out-of-range chapterIndex into [0, totalChapters-1]', () => {
    expect(chapterProgressPercent(99, 10)).toBe(100);
    expect(chapterProgressPercent(-5, 10)).toBe(0);
  });

  it('single-chapter book: any index is 100%', () => {
    expect(chapterProgressPercent(0, 1)).toBe(100);
  });
});

describe('chapterProgressPercentPrecise', () => {
  it('keeps one decimal place by default', () => {
    // index 60 of 547 chapters (indices 0-546) → 60/546*100 = 10.989… → 11.0
    expect(chapterProgressPercentPrecise(60, 547)).toBe(11);
    // index 200 of 546 → 200/545*100 = 36.697 → 36.7
    expect(chapterProgressPercentPrecise(200, 546)).toBe(36.7);
  });

  it('returns null for no chapters and 100 for the last / single chapter', () => {
    expect(chapterProgressPercentPrecise(0, 0)).toBeNull();
    expect(chapterProgressPercentPrecise(0, 1)).toBe(100);
    expect(chapterProgressPercentPrecise(9, 10)).toBe(100);
  });

  it('respects a custom decimals argument', () => {
    expect(chapterProgressPercentPrecise(200, 546, 2)).toBe(36.7);
    expect(chapterProgressPercentPrecise(1, 3, 2)).toBe(50);
  });
});
