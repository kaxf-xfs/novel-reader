/* @jest-environment node */
/**
 * T4: chapterProgressPercent — pure helper used by LibraryScreen to render
 * a book's reading progress (chapterIndex / totalChapters) as a percentage.
 */

import { chapterProgressPercent } from '../progress';

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
