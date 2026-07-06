/* @jest-environment node */
/**
 * T4: readChapterText — reads a chapter's text from the normalized UTF-8
 * file via FileGateway.readRange, decoding the byte slice with Buffer.
 *
 * Byte offsets from ChapterRecord always land on UTF-8 character boundaries
 * (guaranteed by buildChapterIndex, T3), so Buffer.from(bytes).toString('utf8')
 * decodes cleanly without needing any cross-chunk stitching.
 */

import { readChapterText } from '../readChapter';
import type { FileGateway } from '../../import/importBook';
import type { ChapterRecord } from '../../import/repository';

// ---------------------------------------------------------------------------
// Fake FileGateway — in-memory buffer slice implementation
// ---------------------------------------------------------------------------

class FakeRangeFileGateway implements FileGateway {
  constructor(private files: Map<string, Uint8Array>) {}

  async readBytes(uri: string): Promise<Uint8Array> {
    const b = this.files.get(uri);
    if (!b) throw new Error(`no file: ${uri}`);
    return b;
  }

  async writeNormalized(): Promise<string> {
    throw new Error('not used in these tests');
  }

  async readRange(uri: string, byteStart: number, byteEnd: number): Promise<Uint8Array> {
    const b = this.files.get(uri);
    if (!b) throw new Error(`no file: ${uri}`);
    return b.subarray(byteStart, byteEnd);
  }
}

function makeChapter(override: Partial<ChapterRecord> = {}): ChapterRecord {
  return {
    bookId: 'book-1',
    index: 0,
    title: '第一章 山边小村',
    level: 1,
    byteStart: 0,
    byteEnd: 0,
    ...override,
  };
}

describe('readChapterText', () => {
  it('reads and decodes a chapter containing multi-byte CJK text', async () => {
    const text = [
      '第一章 山边小村\n',
      '这里有一段包含中文字符的正文内容。\n',
      '第二章 入门考验\n',
      '第二章的内容在这里，用于验证字节偏移不会侵入本章范围。',
    ].join('');
    const buf = Buffer.from(text, 'utf8');
    const ch1End = Buffer.byteLength('第一章 山边小村\n这里有一段包含中文字符的正文内容。\n', 'utf8');

    const uri = 'file:///book-1.txt';
    const fs = new FakeRangeFileGateway(new Map([[uri, new Uint8Array(buf)]]));

    const chapter = makeChapter({ byteStart: 0, byteEnd: ch1End });
    const result = await readChapterText(fs, uri, chapter);

    expect(result).toBe('第一章 山边小村\n这里有一段包含中文字符的正文内容。\n');
    expect(result).toContain(chapter.title);
  });

  it('reads a chapter that starts at a non-zero byte offset', async () => {
    const text = '第一章 标题一\n内容一。\n第二章 标题二\n内容二，带有更多汉字用于测试。';
    const buf = Buffer.from(text, 'utf8');
    const ch1Text = '第一章 标题一\n内容一。\n';
    const ch1End = Buffer.byteLength(ch1Text, 'utf8');
    const ch2End = buf.length;

    const uri = 'u';
    const fs = new FakeRangeFileGateway(new Map([[uri, new Uint8Array(buf)]]));

    const chapter2 = makeChapter({ index: 1, title: '第二章 标题二', byteStart: ch1End, byteEnd: ch2End });
    const result = await readChapterText(fs, uri, chapter2);

    expect(result).toBe('第二章 标题二\n内容二，带有更多汉字用于测试。');
    expect(result).toContain(chapter2.title);
  });
});
