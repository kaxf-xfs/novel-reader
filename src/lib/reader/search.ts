/** 增量2: 全文搜索的纯逻辑——高亮切分、结果片段、hex→rgba。 */

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into matched / non-matched segments for `term`
 * (case-insensitive, non-overlapping, left-to-right, original case kept).
 * Shared by search-result snippets AND the in-reader highlight.
 */
export function splitHighlight(text: string, term: string): HighlightSegment[] {
  if (!term) return [{ text, match: false }];
  const lowText = text.toLowerCase();
  const lowTerm = term.toLowerCase();
  const segments: HighlightSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lowText.indexOf(lowTerm, i);
    if (idx === -1) {
      segments.push({ text: text.slice(i), match: false });
      break;
    }
    if (idx > i) segments.push({ text: text.slice(i, idx), match: false });
    segments.push({ text: text.slice(idx, idx + term.length), match: true });
    i = idx + term.length;
  }
  return segments;
}

/** A window of `blockText` centered on the first match, with ellipses. */
export function makeSearchSnippet(
  blockText: string,
  term: string,
  opts: { before?: number; after?: number } = {},
): string {
  const before = opts.before ?? 12;
  const after = opts.after ?? 40;
  const idx = term ? blockText.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (idx === -1) return blockText.slice(0, before + after + (term.length || 0));
  const start = Math.max(0, idx - before);
  const end = Math.min(blockText.length, idx + term.length + after);
  let snip = blockText.slice(start, end);
  if (start > 0) snip = '…' + snip;
  if (end < blockText.length) snip = snip + '…';
  return snip;
}

/** `#rrggbb` + alpha → `rgba(r, g, b, a)` (RN styles don't take hex+alpha). */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
