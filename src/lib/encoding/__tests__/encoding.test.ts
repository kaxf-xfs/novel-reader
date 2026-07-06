/* @jest-environment node */
import path from 'path';
import fs from 'fs';
import { detectEncoding, decodeToUtf8 } from '../index';
import type { SupportedEncoding } from '../index';

const NOVELS_DIR = path.resolve(__dirname, '../../../../reference/example_novels');

function readBytes(filename: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(NOVELS_DIR, filename)));
}

// ---------------------------------------------------------------------------
// detectEncoding
// ---------------------------------------------------------------------------

describe('detectEncoding', () => {
  describe('UTF-8 files (no BOM)', () => {
    const utf8Files = [
      ['《昊天传》.txt'],
      ['《风月大陆》.txt'],
      ['如影逐形.txt'],
    ] as const;

    test.each(utf8Files)('detects %s as utf-8 with confidence 1', (filename) => {
      const bytes = readBytes(filename).slice(0, 100 * 1024);
      const result = detectEncoding(bytes);
      expect(result.encoding).toBe<SupportedEncoding>('utf-8');
      expect(result.confidence).toBe(1);
    });
  });

  describe('UTF-8-BOM file', () => {
    it('detects 《春秋风华录》 .txt as utf-8-bom with confidence 1', () => {
      const bytes = readBytes('《春秋风华录》 .txt').slice(0, 100 * 1024);
      const result = detectEncoding(bytes);
      expect(result.encoding).toBe<SupportedEncoding>('utf-8-bom');
      expect(result.confidence).toBe(1);
    });
  });

  describe('GB18030 files', () => {
    const gb18030Files = [
      ['凡人修仙传.txt'],
      ['魔天记.txt'],
      ['晚明.txt'],
      ['无职转生：剑，魔法帽与恋爱系统.txt'],
      ['龙魂侠影.txt'],
    ] as const;

    test.each(gb18030Files)(
      'detects %s as gb18030 with high confidence',
      (filename) => {
        const bytes = readBytes(filename).slice(0, 100 * 1024);
        const result = detectEncoding(bytes);
        expect(result.encoding).toBe<SupportedEncoding>('gb18030');
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      },
    );
  });

  describe('edge cases', () => {
    it('returns utf-8 with confidence 1 for empty input', () => {
      const result = detectEncoding(new Uint8Array(0));
      expect(result.encoding).toBe<SupportedEncoding>('utf-8');
      expect(result.confidence).toBe(1);
    });

    it('returns utf-8-bom for a bare 3-byte BOM', () => {
      const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
      const result = detectEncoding(bom);
      expect(result.encoding).toBe<SupportedEncoding>('utf-8-bom');
      expect(result.confidence).toBe(1);
    });

    it('returns utf-8 for pure ASCII bytes', () => {
      const ascii = new Uint8Array(Buffer.from('Hello, World!\n'));
      const result = detectEncoding(ascii);
      expect(result.encoding).toBe<SupportedEncoding>('utf-8');
      expect(result.confidence).toBe(1);
    });
  });

  describe('malformed UTF-8 must NOT be classified as utf-8', () => {
    // A truncated 3-byte lead followed by an ILLEGAL continuation byte (0x40).
    // A naive truncation early-exit would wrongly accept this as utf-8.
    it('rejects [0xE0, 0x40] (truncated lead + invalid continuation)', () => {
      const result = detectEncoding(new Uint8Array([0xe0, 0x40]));
      expect(result.encoding).not.toBe<SupportedEncoding>('utf-8');
    });

    it('rejects overlong encoding [0xE0, 0x80, 0x80]', () => {
      const result = detectEncoding(new Uint8Array([0xe0, 0x80, 0x80]));
      expect(result.encoding).not.toBe<SupportedEncoding>('utf-8');
    });

    it('rejects UTF-16 surrogate range [0xED, 0xA0, 0x80]', () => {
      const result = detectEncoding(new Uint8Array([0xed, 0xa0, 0x80]));
      expect(result.encoding).not.toBe<SupportedEncoding>('utf-8');
    });

    it('rejects code points above U+10FFFF [0xF4, 0x90, 0x80, 0x80]', () => {
      const result = detectEncoding(new Uint8Array([0xf4, 0x90, 0x80, 0x80]));
      expect(result.encoding).not.toBe<SupportedEncoding>('utf-8');
    });
  });

  describe('GB18030 sample negative assertion', () => {
    it('does NOT classify 凡人修仙传 (first 100KB) as utf-8', () => {
      const bytes = readBytes('凡人修仙传.txt').slice(0, 100 * 1024);
      const result = detectEncoding(bytes);
      expect(result.encoding).not.toBe<SupportedEncoding>('utf-8');
      expect(result.encoding).toBe<SupportedEncoding>('gb18030');
    });
  });
});

// ---------------------------------------------------------------------------
// decodeToUtf8
// ---------------------------------------------------------------------------

describe('decodeToUtf8', () => {
  it('decodes 昊天传 (utf-8, auto-detect) and contains chapter heading', () => {
    const bytes = readBytes('《昊天传》.txt').slice(0, 256 * 1024);
    const text = decodeToUtf8(bytes);
    expect(text).toContain('第一章 荒唐梦境');
    expect(text).not.toContain('�');
  });

  it('decodes 春秋风华录 (utf-8-bom, auto-detect), strips BOM, contains headings', () => {
    const bytes = readBytes('《春秋风华录》 .txt').slice(0, 256 * 1024);
    const text = decodeToUtf8(bytes);
    expect(text).toContain('楔子');
    expect(text).toContain('第1章 北奴宫');
    // Must NOT start with BOM character
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).not.toContain('�');
  });

  it('decodes 凡人修仙传 (gb18030, auto-detect) and contains headings', () => {
    const bytes = readBytes('凡人修仙传.txt').slice(0, 256 * 1024);
    const text = decodeToUtf8(bytes);
    expect(text).toContain('第一卷 七玄门风云');
    expect(text).toContain('第一章 山边小村');
    expect(text).not.toContain('�');
  });

  it('decodes 晚明 (gb18030, auto-detect) and contains headings', () => {
    const bytes = readBytes('晚明.txt').slice(0, 256 * 1024);
    const text = decodeToUtf8(bytes);
    expect(text).toContain('第一卷 沧海横流');
    expect(text).toContain('第一章 抢衣服的劫犯');
    expect(text).not.toContain('�');
  });

  it('decodes 龙魂侠影 (gb18030, auto-detect) and contains 第一回', () => {
    const bytes = readBytes('龙魂侠影.txt').slice(0, 256 * 1024);
    const text = decodeToUtf8(bytes);
    expect(text).toContain('第一回');
    expect(text).not.toContain('�');
  });

  it('returns empty string for empty input', () => {
    const text = decodeToUtf8(new Uint8Array(0));
    expect(text).toBe('');
  });

  it('uses explicit gb18030 encoding when provided, skipping auto-detect', () => {
    const bytes = readBytes('凡人修仙传.txt').slice(0, 256 * 1024);
    const text = decodeToUtf8(bytes, 'gb18030');
    expect(text).toContain('第一卷 七玄门风云');
    expect(text).not.toContain('�');
  });

  it('strips BOM when utf-8-bom is passed explicitly', () => {
    const bytes = readBytes('《春秋风华录》 .txt').slice(0, 256 * 1024);
    const text = decodeToUtf8(bytes, 'utf-8-bom');
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).toContain('楔子');
  });

  it('decodes utf-8 explicitly without stripping a non-existent BOM', () => {
    const bytes = readBytes('《昊天传》.txt').slice(0, 256 * 1024);
    const text = decodeToUtf8(bytes, 'utf-8');
    expect(text).toContain('第一章 荒唐梦境');
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });
});
