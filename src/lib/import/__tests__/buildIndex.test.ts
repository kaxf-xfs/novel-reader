/* @jest-environment node */
/**
 * T3: buildChapterIndex tests.
 *
 * Core invariants verified for every scenario:
 *  1. byteLength === Buffer.byteLength(utf8Text, 'utf8')
 *  2. All entries are contiguous (entries[i].byteEnd === entries[i+1].byteStart)
 *  3. Last entry's byteEnd === byteLength
 *  4. Buffer.from(text,'utf8').subarray(byteStart,byteEnd).toString('utf8') contains the chapter title
 *
 * Character → byte conversion must be O(n) — implementation walk is verified indirectly
 * via the real-novel tests (15 MB would time-out at O(n²)).
 */

import path from 'path';
import fs from 'fs';
import { buildChapterIndex } from '../buildIndex';
import { describeCorpus } from '../../../test-utils/corpus';

const NOVELS_DIR = path.resolve(__dirname, '../../../../reference/example_novels');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Core invariant checker for any ChapterIndex result.
 *
 * Title-presence check is only asserted for 'regex' strategy because
 * 'fallback-size' entries use synthetic titles ('第N节') that are not
 * literally present in the source text.
 */
function checkByteInvariants(utf8Text: string): void {
  const { entries, byteLength, strategy } = buildChapterIndex(utf8Text);
  expect(byteLength).toBe(Buffer.byteLength(utf8Text, 'utf8'));

  if (entries.length === 0) return;

  const buf = Buffer.from(utf8Text, 'utf8');

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    // Non-negative, in range
    expect(e.byteStart).toBeGreaterThanOrEqual(0);
    expect(e.byteEnd).toBeLessThanOrEqual(byteLength);
    expect(e.byteStart).toBeLessThan(e.byteEnd);
    // Slice must decode cleanly
    const slice = buf.subarray(e.byteStart, e.byteEnd).toString('utf8');
    expect(slice.length).toBeGreaterThan(0);
    // Only regex-detected chapters have titles that appear in the text.
    if (strategy === 'regex') {
      expect(slice).toContain(e.title);
    }
    // Contiguity
    if (i + 1 < entries.length) {
      expect(e.byteEnd).toBe(entries[i + 1].byteStart);
    }
  }
  // Last entry ends at byteLength
  expect(entries[entries.length - 1].byteEnd).toBe(byteLength);
}

// ---------------------------------------------------------------------------
// Empty / trivial
// ---------------------------------------------------------------------------

describe('buildChapterIndex – empty / whitespace-only', () => {
  it('empty string → 0 entries, byteLength 0', () => {
    const { entries, byteLength, strategy } = buildChapterIndex('');
    expect(entries).toHaveLength(0);
    expect(byteLength).toBe(0);
    expect(strategy).toBe('none');
  });

  it('whitespace-only → 0 entries', () => {
    const { entries } = buildChapterIndex('   \n\n  ');
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ASCII-only (1 byte per char → byte offset === char offset)
// ---------------------------------------------------------------------------

describe('buildChapterIndex – ASCII-only text', () => {
  it('byte offsets match char offsets for text with 3 chapters', () => {
    // 3 chapters → regex strategy; chapter titles contain CJK but body is ASCII.
    const text = [
      'prologue content\n',
      '第一章 Start\n',
      'chapter 1 body\n',
      '第二章 Middle\n',
      'chapter 2 body\n',
      '第三章 End\n',
      'chapter 3 body',
    ].join('');

    checkByteInvariants(text);

    const { entries } = buildChapterIndex(text);
    expect(entries).toHaveLength(3);
    expect(entries[0].title).toBe('第一章 Start');
    expect(entries[1].title).toBe('第二章 Middle');
    expect(entries[2].title).toBe('第三章 End');
  });

  it('pure ASCII preamble: byteStart of first chapter > 0', () => {
    const text = 'header\n第一章 One\nbody\n第二章 Two\nbody2\n第三章 Three\nbody3';
    const { entries } = buildChapterIndex(text);
    expect(entries[0].byteStart).toBe(7); // 'header\n' = 7 bytes
  });
});

// ---------------------------------------------------------------------------
// 3-byte CJK characters
// ---------------------------------------------------------------------------

describe('buildChapterIndex – 3-byte Chinese characters', () => {
  it('byte offsets correctly account for 3-byte CJK encoding', () => {
    // Each Chinese char = 3 bytes in UTF-8
    // '\n' = 1 byte
    const text = [
      '序章前文内容\n', // 6 CJK × 3 + 1 = 19 bytes
      '第一章 山边小村\n',
      '第一章内容行一。\n',
      '第二章 入门考验\n',
      '第二章内容行二。\n',
      '第三章 结尾篇章\n',
      '终章内容。',
    ].join('');

    checkByteInvariants(text);

    const { entries } = buildChapterIndex(text);
    expect(entries).toHaveLength(3);
    // First chapter starts after preamble
    const preambleBytes = Buffer.byteLength('序章前文内容\n', 'utf8');
    expect(entries[0].byteStart).toBe(preambleBytes);
  });

  it('subarray of chapter text is valid UTF-8 (no broken CJK sequences)', () => {
    const text = '第一章 中文开篇\n内容如下：万物起源。\n第二章 继续\n后续内容。\n第三章 终局\n终结。';
    const { entries } = buildChapterIndex(text);
    const buf = Buffer.from(text, 'utf8');
    for (const e of entries) {
      // Must not throw and must not contain replacement chars
      const decoded = buf.subarray(e.byteStart, e.byteEnd).toString('utf8');
      expect(decoded.includes('�')).toBe(false);
      expect(decoded).toContain(e.title);
    }
  });
});

// ---------------------------------------------------------------------------
// 4-byte emoji characters (surrogate pairs in JS string)
// ---------------------------------------------------------------------------

describe('buildChapterIndex – 4-byte emoji characters', () => {
  it('emoji in preamble: first chapter byteStart accounts for 4-byte chars', () => {
    const emoji = '😀'; // 2 JS code units, 4 UTF-8 bytes
    const preamble = `${emoji}前言内容\n`; // 4 + 3*3 + 1 = 14 bytes
    // 3 chapters → regex strategy
    const text =
      preamble +
      '第一章 起点\n' +
      `正文含${emoji}表情\n` +
      '第二章 中段\n' +
      '中段内容。\n' +
      '第三章 终章\n' +
      '结尾';

    checkByteInvariants(text);

    const { entries } = buildChapterIndex(text);
    expect(entries).toHaveLength(3);
    // preamble byte length
    const premBytes = Buffer.byteLength(preamble, 'utf8');
    expect(entries[0].byteStart).toBe(premBytes);
  });

  it('emoji in chapter title is preserved in byte slice', () => {
    // Parser maxTitleLen defaults to 30 chars
    const text =
      '第一章 😀标题\n章节内容。\n第二章 结局😂\n结尾内容。\n第三章 尾声\n最后。';
    checkByteInvariants(text);
    const { entries } = buildChapterIndex(text);
    expect(entries).toHaveLength(3);
  });

  it('4-byte code points in chapter body do not break byte contiguity', () => {
    const text =
      '第一章 开始\n包含emoji😂😭🎉内容。\n第二章 中间\n更多😀content。\n第三章 结束\n最终内容。';
    checkByteInvariants(text);
  });
});

// ---------------------------------------------------------------------------
// Fallback-size strategy
// ---------------------------------------------------------------------------

describe('buildChapterIndex – fallback-size strategy', () => {
  it('text with no chapter titles → fallback strategy', () => {
    const text = '这是正文内容没有章节标题。\n'.repeat(500);
    const { strategy, entries, byteLength } = buildChapterIndex(text);
    expect(strategy).toBe('fallback-size');
    expect(byteLength).toBe(Buffer.byteLength(text, 'utf8'));
    expect(entries.length).toBeGreaterThan(0);
  });

  it('fallback entries are contiguous and cover the full text', () => {
    const text = '无标题内容行。\n'.repeat(600);
    const { entries, byteLength } = buildChapterIndex(text);
    expect(entries[0].byteStart).toBe(0); // fallback always starts at 0
    expect(entries[entries.length - 1].byteEnd).toBe(byteLength);
    // All contiguous
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].byteStart).toBe(entries[i - 1].byteEnd);
    }
  });

  it('fallback byte slices decode as valid UTF-8 without replacement chars', () => {
    const text = '无标题中文内容行，包含各种文字。\n'.repeat(400);
    const { entries } = buildChapterIndex(text);
    const buf = Buffer.from(text, 'utf8');
    for (const e of entries) {
      const decoded = buf.subarray(e.byteStart, e.byteEnd).toString('utf8');
      expect(decoded.includes('�')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// byteLength correctness
// ---------------------------------------------------------------------------

describe('buildChapterIndex – byteLength', () => {
  it('byteLength matches Buffer.byteLength for mixed-char text', () => {
    const texts = [
      'pure ASCII text',
      '中文三字节字符',
      '😀4字节emoji',
      '混合Mixed中文English😂',
      '第一章 开始\n内容\n第二章 结束\n更多内容',
    ];
    for (const t of texts) {
      const { byteLength } = buildChapterIndex(t);
      expect(byteLength).toBe(Buffer.byteLength(t, 'utf8'));
    }
  });
});

// ---------------------------------------------------------------------------
// Level field preserved
// ---------------------------------------------------------------------------

describe('buildChapterIndex – level preservation', () => {
  it('volume (level 0) and chapter (level 1) entries have correct levels', () => {
    const text = [
      '第一卷 七玄门风云\n',
      '卷一内容。\n',
      '第一章 山边小村\n',
      '第一章内容。\n',
      '第二章 入门\n',
      '第二章内容。',
    ].join('');

    const { entries } = buildChapterIndex(text);
    const vol = entries.find((e) => e.title === '第一卷 七玄门风云');
    const ch1 = entries.find((e) => e.title === '第一章 山边小村');
    expect(vol).toBeDefined();
    expect(vol!.level).toBe(0);
    expect(ch1).toBeDefined();
    expect(ch1!.level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Real novel samples
// ---------------------------------------------------------------------------

describeCorpus('buildChapterIndex – real novel: 凡人修仙传 (GBK → UTF-8)', () => {
  it('byte slices of first 5 chapters contain their titles', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const iconv = require('iconv-lite') as { decode(buf: Buffer, enc: string): string };
    const rawBytes = fs.readFileSync(path.join(NOVELS_DIR, '凡人修仙传.txt'));
    // Use only first 2 MB to keep test fast
    const utf8Text = iconv.decode(Buffer.from(rawBytes.slice(0, 2 * 1024 * 1024)), 'gb18030');

    const { entries, strategy, byteLength } = buildChapterIndex(utf8Text);

    expect(strategy).toBe('regex');
    expect(entries.length).toBeGreaterThan(10);
    expect(byteLength).toBe(Buffer.byteLength(utf8Text, 'utf8'));

    const buf = Buffer.from(utf8Text, 'utf8');
    for (const e of entries.slice(0, 5)) {
      const slice = buf.subarray(e.byteStart, e.byteEnd).toString('utf8');
      expect(slice).toContain(e.title);
    }
    // Full contiguity
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].byteStart).toBe(entries[i - 1].byteEnd);
    }
    expect(entries[entries.length - 1].byteEnd).toBe(byteLength);
  });
});

describeCorpus('buildChapterIndex – real novel: 如影逐形 (UTF-8 fallback)', () => {
  it('byte slices are valid UTF-8 and cover the entire text', () => {
    const rawBytes = fs.readFileSync(path.join(NOVELS_DIR, '如影逐形.txt'));
    const utf8Text = Buffer.from(rawBytes.slice(0, 512 * 1024)).toString('utf8');

    const { entries, byteLength } = buildChapterIndex(utf8Text);
    expect(byteLength).toBe(Buffer.byteLength(utf8Text, 'utf8'));

    const buf = Buffer.from(utf8Text, 'utf8');
    for (const e of entries.slice(0, 5)) {
      const decoded = buf.subarray(e.byteStart, e.byteEnd).toString('utf8');
      expect(decoded.length).toBeGreaterThan(0);
      expect(decoded.includes('�')).toBe(false);
    }
    if (entries.length > 0) {
      expect(entries[0].byteStart).toBe(0); // fallback starts at 0
      expect(entries[entries.length - 1].byteEnd).toBe(byteLength);
    }
  });
});
