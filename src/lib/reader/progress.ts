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
