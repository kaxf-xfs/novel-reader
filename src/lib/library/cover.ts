/**
 * T6/T8: generated book covers — pure helpers.
 *
 * Books have no cover art (imported .txt), so the shelf renders a generated
 * cover: a deep jewel-toned card (chosen deterministically from the title)
 * with the first title characters set in a light, book-like face.
 *
 * The cover color is derived from the title here rather than read from the
 * stored `coverColor`, so restyling the palette instantly re-skins every
 * already-imported book (no re-import needed).
 */

const DARK_TEXT = '#1a1a1a';
const LIGHT_TEXT = '#f2ede1';

/**
 * Deep, desaturated jewel tones — all dark enough that light title text sits
 * on them with comfortable contrast. Kept intentionally muted ("高级灰") so a
 * shelf of them reads as a calm set rather than a rainbow.
 */
export const COVER_PALETTE: readonly string[] = [
  '#1f3b3a', // teal
  '#2a3550', // indigo
  '#3d3326', // umber
  '#3a2b33', // wine
  '#25353f', // steel blue
  '#2f3a2a', // forest
  '#3a3140', // plum
  '#34302a', // taupe
];

/** Deterministic djb2 hash → palette index. */
export function pickCoverColor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
  }
  return COVER_PALETTE[Math.abs(hash) % COVER_PALETTE.length];
}

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

export function buildCover(title: string): CoverData {
  const cleaned = title.replace(DECORATION_RE, '');
  const chars = Array.from(cleaned); // code-point aware (astral-safe)
  const label = chars.length === 0 ? '书' : chars.slice(0, 2).join('');
  const background = pickCoverColor(title);
  return { label, background, textColor: coverTextColor(background) };
}
