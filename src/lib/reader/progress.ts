/**
 * T4: chapterProgressPercent — pure helper for rendering a book's reading
 * progress in LibraryScreen as a 0-100 percentage, derived from the last
 * viewed chapter index and the book's total chapter count.
 */

/**
 * Returns null when the book has no parsed chapters (totalChapters === 0),
 * since a percentage is meaningless in that case.
 *
 * A single-chapter book is always 100% once opened (there's nowhere else to
 * be). For books with 2+ chapters, chapterIndex is scaled linearly across
 * [0, totalChapters - 1] → [0, 100], clamping out-of-range indices.
 */
export function chapterProgressPercent(chapterIndex: number, totalChapters: number): number | null {
  if (totalChapters <= 0) return null;
  if (totalChapters === 1) return 100;

  const clamped = Math.min(Math.max(chapterIndex, 0), totalChapters - 1);
  return Math.round((clamped / (totalChapters - 1)) * 100);
}

/**
 * Same as chapterProgressPercent but keeps `decimals` decimal places (default
 * 1) — used by the reader's slim top bar (起点-style "…章名 · 77.8%").
 */
export function chapterProgressPercentPrecise(
  chapterIndex: number,
  totalChapters: number,
  decimals = 1,
): number | null {
  if (totalChapters <= 0) return null;
  if (totalChapters === 1) return 100;

  const clamped = Math.min(Math.max(chapterIndex, 0), totalChapters - 1);
  const raw = (clamped / (totalChapters - 1)) * 100;
  const f = 10 ** decimals;
  return Math.round(raw * f) / f;
}
