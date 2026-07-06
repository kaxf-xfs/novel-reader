/**
 * T7: table-of-contents search filter (pure).
 */

export interface TocEntry {
  index: number;
  title: string;
}

/**
 * Filters chapters whose title contains `query` (case-insensitive, trimmed).
 * An empty / whitespace query returns all chapters. Never mutates the input.
 */
export function filterChapters<T extends TocEntry>(chapters: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return chapters.slice();
  return chapters.filter((c) => c.title.toLowerCase().includes(q));
}
