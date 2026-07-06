/**
 * T6: generated book covers — pure helpers.
 *
 * Books have no real cover art (imported .txt), so the shelf renders a
 * generated cover: the book's pastel `coverColor` (from importBook) plus the
 * first couple of title characters in a contrasting text color.
 */

const DARK_TEXT = '#1a1a1a';
const LIGHT_TEXT = '#f5f3ee';

/** Leading/embedded decoration to drop before picking label characters. */
const DECORATION_RE = /[《》「」【】〈〉""''\s]/g;

/**
 * Returns a readable text color (dark or light) for text drawn on `background`,
 * chosen by perceived luminance (Rec. 601 weights).
 */
export function coverTextColor(background: string): string {
  const hex = background.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? DARK_TEXT : LIGHT_TEXT;
}

export interface CoverData {
  /** 1–2 characters shown on the cover. */
  label: string;
  background: string;
  textColor: string;
}

export function buildCover(title: string, background: string): CoverData {
  const cleaned = title.replace(DECORATION_RE, '');
  const chars = Array.from(cleaned); // code-point aware (astral-safe)
  const label = chars.length === 0 ? '书' : chars.slice(0, 2).join('');
  return { label, background, textColor: coverTextColor(background) };
}
