/**
 * Chapter parsing module (T2).
 *
 * Parses a decoded UTF-8 novel text into Chapter objects with character
 * offsets, level (0 = volume/集/卷, 1 = chapter/special), and title.
 *
 * Pre-chapter content (text before the first detected title line) is NOT
 * covered by any Chapter.  The first Chapter.startOffset points to the
 * start of the first title line.  This is intentional — pre-chapter
 * preamble (table of contents, author notes at top) is simply not slotted
 * into a chapter.
 *
 * Line splitting uses /\r\n|\r|\n|/ to handle Windows CRLF, Mac CR,
 * Unix LF, and NEL (U+0085, observed in some GBK-sourced files).
 *
 * Leading whitespace (ASCII + U+3000 fullwidth space) is stripped before
 * matching so indented files (e.g. 春秋风华录) are handled transparently.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single chapter (or volume heading) with character-level offsets.
 *
 * The half-open interval [startOffset, endOffset) covers the full chapter
 * content including the title line itself.  Adjacent chapters are strictly
 * contiguous: chapters[i].endOffset === chapters[i+1].startOffset.
 * The last chapter's endOffset === text.length.
 */
export interface Chapter {
  title: string;
  /** 0 = volume/部/集/篇 heading; 1 = chapter/特殊章 */
  level: 0 | 1;
  /** Character offset of the start of this chapter's title line. */
  startOffset: number;
  /** Character offset of the start of the next chapter (or text.length). */
  endOffset: number;
}

export type ParseStrategy = 'regex' | 'fallback-size' | 'none';

export interface ParseOptions {
  /** Minimum number of regex-detected chapters before falling back.  Default 3. */
  minChapters?: number;
  /** Additional ad/spam patterns (merged with defaults in looksLikeAdLine). */
  adPatterns?: RegExp[];
  /** Maximum title length (chars) before a line is rejected.  Default 30. */
  maxTitleLen?: number;
}

export interface ParseResult {
  chapters: Chapter[];
  strategy: ParseStrategy;
}

// ---------------------------------------------------------------------------
// Regular expressions
// ---------------------------------------------------------------------------

/**
 * Matches CJK/Arabic/fullwidth number sequences used in chapter numbering.
 *
 * Intentionally broad — the separator character check below restricts what
 * qualifies as a real chapter.
 */
const NUM = '[0-9０-９零一二三四五六七八九十百千万两億]+';

/**
 * Chapter-level line: 第X章, 第X回, 第X节, 第X话
 * level = 1
 */
const CHAPTER_RE = new RegExp(`^第(${NUM})[章回节话]`);

/**
 * Volume-level line: 第X卷, 第X集, 第X部, 第X篇, 卷X
 * level = 0 (unless 卷章同行 applies — see EMBEDDED_CHAPTER_RE)
 */
const VOLUME_RE = new RegExp(`^(?:第(${NUM})[卷集部篇]|卷(${NUM}))`);

/**
 * Used for 卷章同行 detection (风月大陆 style).
 * If a volume-start line ALSO contains an inner 第X章, treat the whole
 * line as level 1.
 */
const EMBEDDED_CHAPTER_RE = new RegExp(`第${NUM}章`);

/**
 * Special one-off chapter titles (楔子, 序, 番外…, etc.).
 * Must match the ENTIRE trimmed line (anchored ^ and $).
 * 番外 and 特典 allow trailing text (they often have subtitles).
 */
const SPECIAL_RE =
  /^(楔子|序章|序言|序|引子|前言|后记|尾声|终章|番外[^\n]*|特典[^\n]*|作者的?话|作者有话说)$/;

// ---------------------------------------------------------------------------
// Sentence-like punctuation filter
// ---------------------------------------------------------------------------

/** Chinese sentence-ending period — strong prose indicator. */
const SENTENCE_PERIOD_RE = /[。]/;

/**
 * Three or more commas / enumeration marks in one line.
 * Two commas can legitimately appear in a chapter title
 * ("第7章出逃王都，前往布耶纳村的缘由是，苦"), but three or more strongly
 * suggest running prose text.
 */
const MANY_COMMAS_RE = /[，、]{3,}|(?:[，、].*){3}/;

// ---------------------------------------------------------------------------
// Default ad / spam patterns
// ---------------------------------------------------------------------------

const DEFAULT_AD_PATTERNS: ReadonlyArray<RegExp> = [
  /本书由.{0,20}整理/,
  /更多.{0,10}(?:请)?(?:访问|登陆|登录)/,
  /www\./i,
  /https?:\/\//i,
  /最新章节/,
  /txt.{0,10}下载/i,
  /手机.{0,10}(?:阅读|访问)/,
];

// ---------------------------------------------------------------------------
// looksLikeAdLine
// ---------------------------------------------------------------------------

/**
 * Returns true when the line matches a known ad / spam pattern.
 *
 * The parser itself does NOT call this function — ad lines never match the
 * chapter-title regex (wrong separator characters or too long), so they are
 * naturally excluded.  This function is exported as a standalone utility for
 * callers that want to pre-clean text or highlight suspicious lines.
 */
export function looksLikeAdLine(line: string, extra?: ReadonlyArray<RegExp>): boolean {
  const patterns: ReadonlyArray<RegExp> = extra
    ? [...DEFAULT_AD_PATTERNS, ...extra]
    : DEFAULT_AD_PATTERNS;
  return patterns.some((re) => re.test(line));
}

// ---------------------------------------------------------------------------
// Internal: line extraction with character offsets
// ---------------------------------------------------------------------------

interface LineInfo {
  /** Offset of the first character of the line in the original text. */
  lineStart: number;
  /** Offset of the first character of the NEXT line (i.e. after the line ending). */
  lineEnd: number;
  /** Raw content of the line (no line-ending characters). */
  content: string;
}

/**
 * Splits `text` into lines, recording precise character offsets for each.
 *
 * Handles \r\n (CRLF, 2 chars), \r (CR), \n (LF), and  (NEL) as
 * line separators.  The offset arithmetic accounts for CRLF being 2 chars.
 */
function extractLines(text: string): LineInfo[] {
  const result: LineInfo[] = [];
  const len = text.length;
  let i = 0;
  let lineStart = 0;

  while (i < len) {
    const ch = text[i];

    if (ch === '\r') {
      const isCRLF = i + 1 < len && text[i + 1] === '\n';
      result.push({ lineStart, lineEnd: i + (isCRLF ? 2 : 1), content: text.slice(lineStart, i) });
      i += isCRLF ? 2 : 1;
      lineStart = i;
    } else if (ch === '\n' || ch === '') {
      result.push({ lineStart, lineEnd: i + 1, content: text.slice(lineStart, i) });
      i++;
      lineStart = i;
    } else {
      i++;
    }
  }

  // Final line (may have no trailing newline)
  if (lineStart <= len) {
    result.push({ lineStart, lineEnd: len, content: text.slice(lineStart) });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal: strip leading whitespace (ASCII + U+3000 fullwidth space)
// ---------------------------------------------------------------------------

function trimLeading(s: string): string {
  // \s covers ASCII whitespace; 　 is the fullwidth ideographic space
  return s.replace(/^[\s　]+/, '');
}

// ---------------------------------------------------------------------------
// Internal: classify a trimmed line
// ---------------------------------------------------------------------------

type TitleMatch =
  | { kind: 'chapter'; title: string }
  | { kind: 'volume'; title: string }
  | null;

function classifyLine(trimmed: string, maxTitleLen: number): TitleMatch {
  if (!trimmed) return null;
  if (trimmed.length > maxTitleLen) return null;

  // Sentence-period → prose text
  if (SENTENCE_PERIOD_RE.test(trimmed)) return null;
  // Too many commas → prose text
  if (MANY_COMMAS_RE.test(trimmed)) return null;

  const isChap = CHAPTER_RE.test(trimmed);
  const isVol = VOLUME_RE.test(trimmed);
  const isSpc = SPECIAL_RE.test(trimmed);

  if (isChap) {
    return { kind: 'chapter', title: trimmed };
  }

  if (isSpc) {
    return { kind: 'chapter', title: trimmed };
  }

  if (isVol) {
    // 卷章同行: line starts with a volume marker but also contains an inner 第X章
    if (EMBEDDED_CHAPTER_RE.test(trimmed)) {
      return { kind: 'chapter', title: trimmed };
    }
    return { kind: 'volume', title: trimmed };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal: regex-based chapter detection
// ---------------------------------------------------------------------------

function detectChapters(text: string, maxTitleLen: number): Chapter[] {
  const lines = extractLines(text);
  const titleLines: Array<{ lineStart: number; title: string; level: 0 | 1 }> = [];

  for (const { lineStart, content } of lines) {
    const trimmed = trimLeading(content).trimEnd();
    const match = classifyLine(trimmed, maxTitleLen);
    if (!match) continue;

    titleLines.push({
      lineStart,
      title: match.title,
      level: match.kind === 'volume' ? 0 : 1,
    });
  }

  if (titleLines.length === 0) return [];

  // Build Chapter objects: each chapter's endOffset = next chapter's startOffset
  const chapters: Chapter[] = [];
  for (let i = 0; i < titleLines.length; i++) {
    const start = titleLines[i].lineStart;
    const end = i + 1 < titleLines.length ? titleLines[i + 1].lineStart : text.length;
    chapters.push({
      title: titleLines[i].title,
      level: titleLines[i].level,
      startOffset: start,
      endOffset: end,
    });
  }

  return chapters;
}

// ---------------------------------------------------------------------------
// Internal: fallback size-based chunking (~4000 chars near paragraph breaks)
// ---------------------------------------------------------------------------

const FALLBACK_CHUNK_SIZE = 4000;
const FALLBACK_SEARCH_WINDOW = 300;

/**
 * Find the nearest newline to `target` within ±FALLBACK_SEARCH_WINDOW chars.
 * Returns the offset just AFTER the newline (i.e. the start of the next line).
 * Returns `text.length` if nothing found.
 */
function nearestParagraphBoundary(text: string, target: number): number {
  if (target >= text.length) return text.length;

  const lo = Math.max(0, target - FALLBACK_SEARCH_WINDOW);
  const hi = Math.min(text.length, target + FALLBACK_SEARCH_WINDOW);

  let bestPos = -1;
  let bestDist = Infinity;

  for (let i = lo; i < hi; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r' || ch === '') {
      const after = (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') ? i + 2 : i + 1;
      const dist = Math.abs(i - target);
      if (dist < bestDist) {
        bestDist = dist;
        bestPos = after;
      }
    }
  }

  return bestPos >= 0 ? bestPos : text.length;
}

function buildFallbackChapters(text: string): Chapter[] {
  const chapters: Chapter[] = [];
  let pos = 0;
  let index = 1;

  while (pos < text.length) {
    const rawEnd = pos + FALLBACK_CHUNK_SIZE;
    const end = rawEnd >= text.length ? text.length : nearestParagraphBoundary(text, rawEnd);
    chapters.push({
      title: `第${index}节`,
      level: 1,
      startOffset: pos,
      endOffset: end,
    });
    pos = end;
    index++;
  }

  return chapters;
}

// ---------------------------------------------------------------------------
// Public API: parseChapters
// ---------------------------------------------------------------------------

export function parseChapters(text: string, options?: ParseOptions): ParseResult {
  const minChapters = options?.minChapters ?? 3;
  const maxTitleLen = options?.maxTitleLen ?? 30;

  // Empty / whitespace-only
  if (!text || !text.trim()) {
    return { chapters: [], strategy: 'none' };
  }

  const chapters = detectChapters(text, maxTitleLen);

  if (chapters.length < minChapters) {
    return { chapters: buildFallbackChapters(text), strategy: 'fallback-size' };
  }

  return { chapters, strategy: 'regex' };
}
