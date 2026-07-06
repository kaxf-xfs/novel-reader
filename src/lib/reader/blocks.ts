/**
 * T4: splitBlocks — splits raw chapter text into renderable paragraph blocks.
 *
 * Chapter text (as returned by readChapterText) always starts with the
 * chapter's title line (see src/lib/parser: Chapter.startOffset points to
 * the start of the title line). This function keeps that title as the
 * natural first block, then splits the remaining lines into paragraphs.
 *
 * Rules:
 *  - Split on line boundaries (\r\n, \r, \n).
 *  - Trim each line.
 *  - Drop blocks that are empty after trimming (collapses blank-line runs
 *    used as paragraph separators in typical .txt novels).
 */
export function splitBlocks(chapterText: string): string[] {
  if (!chapterText) return [];

  return chapterText
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
