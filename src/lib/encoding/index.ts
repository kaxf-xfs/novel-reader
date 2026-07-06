/**
 * Encoding detection and decoding module.
 *
 * Detection algorithm:
 *  1. BOM-first: EF BB BF → 'utf-8-bom' (confidence 1)
 *  2. Strict byte-level UTF-8 validation → 'utf-8' (confidence 1)
 *  3. jschardet on first 100 KB → map to 'gb18030' / 'big5'; fallback 'gb18030'
 *
 * Decoding:
 *  - utf-8 / utf-8-bom : Buffer.toString('utf-8') + strip leading U+FEFF
 *  - gb18030 / big5    : iconv-lite
 *
 * Incomplete multi-byte sequences at the end of a byte slice are silently
 * dropped so that callers may safely pass truncated windows without
 * receiving replacement characters (U+FFFD).
 *
 * No line-ending or whitespace normalisation is performed (that is T3).
 */

import iconv from 'iconv-lite';
import * as jschardet from 'jschardet';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SupportedEncoding = 'utf-8' | 'utf-8-bom' | 'gb18030' | 'big5';

export interface DetectionResult {
  /** Detected encoding. */
  encoding: SupportedEncoding;
  /** Detection confidence in range [0, 1]. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of bytes fed to jschardet; enough for reliable detection. */
const DETECT_SAMPLE_BYTES = 100 * 1024;

// ---------------------------------------------------------------------------
// Internal helpers – detection
// ---------------------------------------------------------------------------

function hasBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/**
 * Returns true if every byte sequence in `bytes` is well-formed UTF-8.
 *
 * An incomplete multibyte sequence at the very end of the buffer is treated
 * as potentially valid – the buffer may be a truncated slice of a larger file –
 * BUT only when the continuation bytes that *are* present are themselves valid
 * (each in 0x80..0xBF). A truncated sequence whose visible bytes are already
 * malformed (e.g. `[0xE0, 0x40]`) is rejected.
 *
 * NOTE: bitwise masks on `Uint8Array` reads must be applied inside their own
 * parentheses: `((bytes[i]) & 0xc0)`. In an expression like `bytes[i] as number & 0xc0`,
 * the `& 0xc0` would be parsed as part of a *type* intersection on the `as` cast,
 * swallowing the intended arithmetic mask. Value-level parentheses avoid this.
 */
function isStrictUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  const len = bytes.length;

  while (i < len) {
    const b = bytes[i];
    let extra: number;

    if (b <= 0x7f) {
      extra = 0;
    } else if (b >= 0xc2 && b <= 0xdf) {
      extra = 1;
    } else if (b >= 0xe0 && b <= 0xef) {
      extra = 2;
    } else if (b >= 0xf0 && b <= 0xf4) {
      extra = 3;
    } else {
      // 0x80–0xBF (unexpected continuation), 0xC0–0xC1 (overlong), 0xF5–0xFF
      return false;
    }

    if (extra > 0 && i + extra >= len) {
      // Truncated sequence at buffer boundary. Assume valid ONLY if every
      // continuation byte that is actually present is a legal 0x80..0xBF byte.
      for (let j = i + 1; j < len; j++) {
        if ((bytes[j] & 0xc0) !== 0x80) return false;
      }
      return true;
    }

    // Validate the (complete) continuation bytes.
    for (let j = 1; j <= extra; j++) {
      if ((bytes[i + j] & 0xc0) !== 0x80) return false;
    }

    // Overlong / surrogate range checks.
    if (b === 0xe0 && bytes[i + 1] < 0xa0) return false; // overlong 3-byte
    if (b === 0xed && bytes[i + 1] > 0x9f) return false; // UTF-16 surrogates
    if (b === 0xf0 && bytes[i + 1] < 0x90) return false; // overlong 4-byte
    if (b === 0xf4 && bytes[i + 1] > 0x8f) return false; // > U+10FFFF

    i += 1 + extra;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Internal helpers – decoding
// ---------------------------------------------------------------------------

/**
 * Walk backwards from the end of `bytes` to find where the last
 * *complete* UTF-8 character ends.  Returns the trimmed slice (or the
 * original if no trimming is needed).
 */
function trimIncompleteUtf8Tail(bytes: Uint8Array): Uint8Array {
  const len = bytes.length;
  if (len === 0) return bytes;

  // Find the last byte that starts a character (i.e., not a continuation byte).
  let i = len - 1;
  while (i > 0 && (bytes[i] & 0xc0) === 0x80) {
    i--;
  }

  const b = bytes[i];
  let expectedExtra: number;

  if (b <= 0x7f) {
    expectedExtra = 0;
  } else if (b >= 0xc2 && b <= 0xdf) {
    expectedExtra = 1;
  } else if (b >= 0xe0 && b <= 0xef) {
    expectedExtra = 2;
  } else if (b >= 0xf0 && b <= 0xf4) {
    expectedExtra = 3;
  } else {
    // Invalid leading byte; drop it.
    return bytes.slice(0, i);
  }

  const actualExtra = len - 1 - i; // continuation bytes after position i
  if (actualExtra < expectedExtra) {
    // Incomplete sequence – drop from i onwards.
    return bytes.slice(0, i);
  }

  return bytes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the encoding of a byte array.
 *
 * Pass the full file bytes or at minimum the first ~100 KB.
 * For large files the caller should pass a leading slice to avoid
 * unnecessary memory pressure.
 */
export function detectEncoding(bytes: Uint8Array): DetectionResult {
  // ── Step 1: BOM ──────────────────────────────────────────────────────────
  if (hasBom(bytes)) {
    return { encoding: 'utf-8-bom', confidence: 1 };
  }

  // ── Step 2: Strict UTF-8 ─────────────────────────────────────────────────
  const sample: Uint8Array =
    bytes.length <= DETECT_SAMPLE_BYTES ? bytes : bytes.slice(0, DETECT_SAMPLE_BYTES);

  if (isStrictUtf8(sample)) {
    return { encoding: 'utf-8', confidence: 1 };
  }

  // ── Step 3: jschardet ────────────────────────────────────────────────────
  const detected = jschardet.detect(Buffer.from(sample));
  const rawEnc = (detected.encoding ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const confidence = detected.confidence ?? 0;

  // GB family: GB2312 / GBK / GB18030 / HZ-GB-2312 all map to 'gb18030'
  if (/^(gb2312|gbk|gb18030|hzgb2312|hz|csgb2312|gb231280|gb23121980)/.test(rawEnc)) {
    return { encoding: 'gb18030', confidence };
  }

  // Big5 family
  if (/^(big5|csbig5|cnbig5|xxbig5|big5hkscs)/.test(rawEnc)) {
    return { encoding: 'big5', confidence };
  }

  // Unrecognised or very-low-confidence → assume GB18030 (most common fallback)
  return { encoding: 'gb18030', confidence: confidence > 0 ? confidence : 0 };
}

/**
 * Decode a byte array to a JavaScript Unicode string.
 *
 * @param bytes    Raw file bytes (or a leading slice).
 * @param encoding If omitted, `detectEncoding` is called automatically.
 * @returns        Decoded string with any leading BOM (U+FEFF) stripped.
 *
 * Truncated multi-byte sequences at the end of the input are silently
 * dropped rather than emitted as replacement characters.
 *
 * NOTE: The trailing-U+FFFD cleanup for GB18030/Big5 targets a *truncated
 * slice* whose final byte pair was cut mid-character. For a complete file it
 * is a safe no-op: real novel text is extremely unlikely to end on a genuine
 * U+FFFD, so no legitimate content is lost.
 */
export function decodeToUtf8(bytes: Uint8Array, encoding?: SupportedEncoding): string {
  const enc: SupportedEncoding = encoding ?? detectEncoding(bytes).encoding;

  switch (enc) {
    case 'utf-8':
    case 'utf-8-bom': {
      // Trim incomplete trailing sequence before decoding to avoid U+FFFD.
      const safe = trimIncompleteUtf8Tail(bytes);
      const text = Buffer.from(safe).toString('utf-8');
      // Strip BOM regardless of how encoding was determined.
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    }

    case 'gb18030': {
      const text = iconv.decode(Buffer.from(bytes), 'gb18030');
      // Drop a single trailing replacement char that can arise from a
      // truncated 2-byte GB18030 sequence at the slice boundary.
      return text.charCodeAt(text.length - 1) === 0xfffd ? text.slice(0, -1) : text;
    }

    case 'big5': {
      const text = iconv.decode(Buffer.from(bytes), 'big5');
      return text.charCodeAt(text.length - 1) === 0xfffd ? text.slice(0, -1) : text;
    }
  }
}
