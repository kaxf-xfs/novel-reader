/**
 * T3: buildChapterIndex — converts parser char offsets to UTF-8 byte offsets.
 *
 * Character → byte conversion algorithm (O(n) single-pass):
 *
 *   1. Collect all unique char boundaries from the Chapter array (startOffset +
 *      endOffset of each chapter, plus 0 and text.length).
 *   2. Sort them — there are at most 2k+2 boundaries for k chapters.
 *   3. Walk the sorted list, accumulating byte lengths of non-overlapping
 *      text segments via Buffer.byteLength(text.slice(prev, cur), 'utf8').
 *      Since the segments are non-overlapping and their union is [0, n),
 *      total work across all iterations is O(n) character operations.
 *
 * NOTE: Buffer is available in Node.js tests and in React Native (via the
 * 'buffer' polyfill installed in T1).  On RN, if Buffer is not globally
 * patched, callers should ensure the polyfill is imported first.
 */

import { parseChapters } from '../parser';
import type { ParseOptions, ParseStrategy } from '../parser';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IndexEntry {
  title: string;
  /** 0 = volume/卷/集; 1 = chapter/special */
  level: 0 | 1;
  /** Byte offset of the first byte of this entry in the normalized UTF-8 file. */
  byteStart: number;
  /** Byte offset one past the last byte of this entry (half-open interval). */
  byteEnd: number;
}

export interface ChapterIndex {
  entries: IndexEntry[];
  strategy: ParseStrategy;
  /** Total byte length of the UTF-8 text (=== Buffer.byteLength(utf8Text,'utf8')). */
  byteLength: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a ChapterIndex from a normalized UTF-8 string.
 *
 * Combines parseChapters() (char offsets) with an O(n) single-pass
 * char→byte conversion so that every IndexEntry.byteStart/byteEnd is a
 * valid position in the UTF-8 byte sequence of the same string.
 */
export function buildChapterIndex(utf8Text: string, options?: ParseOptions): ChapterIndex {
  const byteLength = Buffer.byteLength(utf8Text, 'utf8');

  if (!utf8Text) {
    return { entries: [], strategy: 'none', byteLength: 0 };
  }

  const { chapters, strategy } = parseChapters(utf8Text, options);

  if (chapters.length === 0) {
    return { entries: [], strategy, byteLength };
  }

  // ── Collect all unique char boundaries ────────────────────────────────────
  const boundarySet = new Set<number>([0, utf8Text.length]);
  for (const ch of chapters) {
    boundarySet.add(ch.startOffset);
    boundarySet.add(ch.endOffset);
  }

  // Sort ascending
  const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

  // ── O(n) walk: compute byte offset for each boundary ─────────────────────
  // charToByteMap[charOffset] = cumulative byte offset from start of text
  const charToByteMap = new Map<number, number>();
  charToByteMap.set(0, 0);

  let prevChar = 0;
  let accBytes = 0;

  for (const charOff of boundaries) {
    if (charOff === 0) continue; // already set above

    // Byte length of the segment [prevChar, charOff)
    // text.slice() is O(k) for k chars, but segments are non-overlapping,
    // so total across all iterations is O(n).
    accBytes += Buffer.byteLength(utf8Text.slice(prevChar, charOff), 'utf8');
    charToByteMap.set(charOff, accBytes);
    prevChar = charOff;
  }

  // ── Build IndexEntry array ────────────────────────────────────────────────
  const entries: IndexEntry[] = chapters.map((ch) => ({
    title: ch.title,
    level: ch.level,
    byteStart: charToByteMap.get(ch.startOffset)!,
    byteEnd: charToByteMap.get(ch.endOffset)!,
  }));

  return { entries, strategy, byteLength };
}
