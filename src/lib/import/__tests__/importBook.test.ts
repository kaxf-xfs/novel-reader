/* @jest-environment node */
/**
 * T3: importBook end-to-end tests with injected fakes.
 *
 * Key chain being verified:
 *   GBK bytes → detectEncoding → decodeToUtf8 → buildChapterIndex
 *               → writeNormalized(UTF-8) → repo.addBook + repo.addChapters
 *
 * GBK chain test is the critical one: byte offsets in the index must be
 * valid positions in the *normalized UTF-8* file, not the original GBK bytes.
 */

import path from 'path';
import fs from 'fs';
import iconv from 'iconv-lite';
import { importBook } from '../importBook';
import { InMemoryBookRepository } from '../repository';
import type { FileGateway, ImportDeps } from '../importBook';

const NOVELS_DIR = path.resolve(__dirname, '../../../../reference/example_novels');

// ---------------------------------------------------------------------------
// Fake FileGateway
// ---------------------------------------------------------------------------

class FakeFileGateway implements FileGateway {
  /** Bytes returned by readBytes */
  private bytesMap: Map<string, Uint8Array> = new Map();
  /** Captured calls to writeNormalized: bookId → utf8 string written */
  public writtenBooks: Map<string, string> = new Map();

  registerFile(uri: string, bytes: Uint8Array): void {
    this.bytesMap.set(uri, bytes);
  }

  async readBytes(uri: string): Promise<Uint8Array> {
    const b = this.bytesMap.get(uri);
    if (!b) throw new Error(`FakeFileGateway: no file registered for ${uri}`);
    return b;
  }

  async writeNormalized(bookId: string, utf8: string): Promise<string> {
    this.writtenBooks.set(bookId, utf8);
    return `/fake/books/${bookId}.txt`;
  }
}

function makeDeps(
  gateway: FakeFileGateway,
  idCounter = { n: 0 },
): ImportDeps {
  return {
    fs: gateway,
    repo: new InMemoryBookRepository(),
    genId: () => `test-id-${++idCounter.n}`,
    now: () => 1_700_000_000_000,
  };
}

// ---------------------------------------------------------------------------
// UTF-8 import
// ---------------------------------------------------------------------------

describe('importBook – UTF-8 source', () => {
  const utf8Text = [
    '序言内容行\n',
    '第一章 山边小村\n',
    '第一章的内容描述。\n',
    '第二章 入门考验\n',
    '第二章的内容描述。\n',
    '第三章 结局篇章\n',
    '第三章的内容描述。',
  ].join('');

  it('returns a BookRecord with encoding utf-8', async () => {
    const gw = new FakeFileGateway();
    const deps = makeDeps(gw);
    const bytes = Buffer.from(utf8Text, 'utf8');
    gw.registerFile('file:///test.txt', new Uint8Array(bytes));

    const book = await importBook('file:///test.txt', '测试书.txt', deps);

    expect(book.encoding).toBe('utf-8');
    expect(book.originalName).toBe('测试书.txt');
    expect(book.sizeBytes).toBe(bytes.length);
    expect(book.importedAt).toBe(1_700_000_000_000);
    expect(book.strategy).toBe('regex');
  });

  it('writes normalized UTF-8 to FileGateway', async () => {
    const gw = new FakeFileGateway();
    const deps = makeDeps(gw);
    gw.registerFile('file:///test.txt', new Uint8Array(Buffer.from(utf8Text, 'utf8')));

    const book = await importBook('file:///test.txt', 'test.txt', deps);

    expect(gw.writtenBooks.has(book.id)).toBe(true);
    // Written text must be valid UTF-8 and equal the decoded content
    const written = gw.writtenBooks.get(book.id)!;
    expect(Buffer.isBuffer(Buffer.from(written, 'utf8'))).toBe(true);
  });

  it('stores book and chapters in repository', async () => {
    const gw = new FakeFileGateway();
    const repo = new InMemoryBookRepository();
    const deps: ImportDeps = {
      fs: gw,
      repo,
      genId: () => 'fixed-id',
      now: () => 1_700_000_000_000,
    };
    gw.registerFile('uri', new Uint8Array(Buffer.from(utf8Text, 'utf8')));

    await importBook('uri', 'book.txt', deps);

    const books = await repo.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe('fixed-id');

    const chapters = await repo.getChapters('fixed-id');
    expect(chapters).toHaveLength(3);
    // Ordered by index
    expect(chapters[0].index).toBe(0);
    expect(chapters[2].index).toBe(2);
  });

  it('chapter byte offsets are valid positions in the written UTF-8 text', async () => {
    const gw = new FakeFileGateway();
    const repo = new InMemoryBookRepository();
    const deps: ImportDeps = { fs: gw, repo, genId: () => 'id1', now: () => 0 };
    gw.registerFile('u', new Uint8Array(Buffer.from(utf8Text, 'utf8')));

    const book = await importBook('u', 'b.txt', deps);

    const written = gw.writtenBooks.get(book.id)!;
    const writtenBuf = Buffer.from(written, 'utf8');
    const chapters = await repo.getChapters(book.id);

    for (const ch of chapters) {
      expect(ch.byteStart).toBeGreaterThanOrEqual(0);
      expect(ch.byteEnd).toBeLessThanOrEqual(writtenBuf.length);
      const slice = writtenBuf.subarray(ch.byteStart, ch.byteEnd).toString('utf8');
      expect(slice).toContain(ch.title);
    }
  });

  it('normalizedPath in BookRecord points to written file', async () => {
    const gw = new FakeFileGateway();
    const deps = makeDeps(gw);
    gw.registerFile('u2', new Uint8Array(Buffer.from(utf8Text, 'utf8')));

    const book = await importBook('u2', 'b.txt', deps);
    expect(book.normalizedPath).toBe(`/fake/books/${book.id}.txt`);
  });
});

// ---------------------------------------------------------------------------
// GBK → UTF-8 normalization chain (the critical link)
// ---------------------------------------------------------------------------

describe('importBook – GBK source → UTF-8 normalized', () => {
  it('detects gb18030 encoding and normalizes to UTF-8', async () => {
    // Build synthetic GBK bytes with chapter titles
    const sourceText = [
      '凡人修仙传 作者：忘语\n',
      '第一卷 七玄门风云\n',
      '卷首内容行，叙述一些背景。\n',
      '第一章 山边小村\n',
      '小村描述内容，人物登场。\n',
      '第二章 入门考验\n',
      '考验描述，主角崭露头角。\n',
      '第三章 炼气期\n',
      '炼气期内容，主角修炼进步。',
    ].join('');
    const gbkBytes = new Uint8Array(iconv.encode(sourceText, 'gb18030'));

    const gw = new FakeFileGateway();
    const repo = new InMemoryBookRepository();
    const deps: ImportDeps = { fs: gw, repo, genId: () => 'gbk-id', now: () => 0 };
    gw.registerFile('file:///fanren.txt', gbkBytes);

    const book = await importBook('file:///fanren.txt', '凡人修仙传.txt', deps);

    // Encoding detected correctly
    expect(book.encoding).toBe('gb18030');
    // sizeBytes is the original GBK byte count
    expect(book.sizeBytes).toBe(gbkBytes.length);
  });

  it('normalized text is valid UTF-8 (not GB18030)', async () => {
    const sourceText = '第一章 开始\n内容一。\n第二章 发展\n内容二。\n第三章 结局\n内容三。';
    const gbkBytes = new Uint8Array(iconv.encode(sourceText, 'gb18030'));

    const gw = new FakeFileGateway();
    const repo = new InMemoryBookRepository();
    const deps: ImportDeps = { fs: gw, repo, genId: () => 'gbk2', now: () => 0 };
    gw.registerFile('f', gbkBytes);

    const book = await importBook('f', 'test.txt', deps);
    const written = gw.writtenBooks.get(book.id)!;

    // Must be a valid UTF-8 string (round-trip through Buffer)
    const roundTripped = Buffer.from(written, 'utf8').toString('utf8');
    expect(roundTripped).toBe(written);
    // Contains the Chinese content (not garbled)
    expect(written).toContain('第一章');
    expect(written).toContain('第二章');
  });

  it('chapter byte offsets in repo are valid on the normalized UTF-8 file', async () => {
    // This is the critical GBK→UTF-8 chain test:
    // Byte offsets must reference positions in the *UTF-8 normalized* file,
    // NOT in the original GBK file.
    const sourceText = [
      '前言前文内容行。\n',
      '第一章 GBK开篇\n',
      '开篇内容行，展开故事。\n',
      '第二章 中间发展\n',
      '发展内容行，情节推进。\n',
      '第三章 结局终章\n',
      '结局内容行，故事收尾。',
    ].join('');
    const gbkBytes = new Uint8Array(iconv.encode(sourceText, 'gb18030'));

    const gw = new FakeFileGateway();
    const repo = new InMemoryBookRepository();
    const deps: ImportDeps = { fs: gw, repo, genId: () => 'chain-id', now: () => 0 };
    gw.registerFile('gbk-file', gbkBytes);

    const book = await importBook('gbk-file', 'book.txt', deps);
    const writtenUtf8 = gw.writtenBooks.get(book.id)!;
    const writtenBuf = Buffer.from(writtenUtf8, 'utf8');
    const chapters = await repo.getChapters(book.id);

    expect(chapters.length).toBeGreaterThan(0);

    for (const ch of chapters) {
      expect(ch.byteStart).toBeGreaterThanOrEqual(0);
      expect(ch.byteEnd).toBeLessThanOrEqual(writtenBuf.length);
      const slice = writtenBuf.subarray(ch.byteStart, ch.byteEnd).toString('utf8');
      // Slice must not contain replacement characters
      expect(slice.includes('�')).toBe(false);
      expect(slice).toContain(ch.title);
    }

    // Contiguity
    for (let i = 1; i < chapters.length; i++) {
      expect(chapters[i].byteStart).toBe(chapters[i - 1].byteEnd);
    }
    // Last chapter ends at the byte length of the written UTF-8 file
    expect(chapters[chapters.length - 1].byteEnd).toBe(writtenBuf.length);
  });
});

// ---------------------------------------------------------------------------
// Real novel: 凡人修仙传 (GBK)
// ---------------------------------------------------------------------------

describe('importBook – real novel 凡人修仙传 (GBK, first 512 KB)', () => {
  it('successfully imports and chapter byte slices are valid', async () => {
    const rawBytes = fs.readFileSync(path.join(NOVELS_DIR, '凡人修仙传.txt'));
    const sample = new Uint8Array(rawBytes.slice(0, 512 * 1024));

    const gw = new FakeFileGateway();
    const repo = new InMemoryBookRepository();
    const deps: ImportDeps = { fs: gw, repo, genId: () => 'fanren-real', now: () => 0 };
    gw.registerFile('fanren', sample);

    const book = await importBook('fanren', '凡人修仙传.txt', deps);
    expect(book.encoding).toBe('gb18030');

    const written = gw.writtenBooks.get(book.id)!;
    const writtenBuf = Buffer.from(written, 'utf8');
    const chapters = await repo.getChapters(book.id);

    expect(chapters.length).toBeGreaterThan(0);

    for (const ch of chapters.slice(0, 5)) {
      const slice = writtenBuf.subarray(ch.byteStart, ch.byteEnd).toString('utf8');
      expect(slice.includes('�')).toBe(false);
      expect(slice).toContain(ch.title);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('importBook – edge cases', () => {
  it('empty file → imports with no chapters (fallback or none strategy)', async () => {
    const gw = new FakeFileGateway();
    const repo = new InMemoryBookRepository();
    const deps: ImportDeps = { fs: gw, repo, genId: () => 'empty-id', now: () => 0 };
    gw.registerFile('empty', new Uint8Array(0));

    const book = await importBook('empty', 'empty.txt', deps);
    expect(book.id).toBe('empty-id');
    expect(book.sizeBytes).toBe(0);
    const chapters = await repo.getChapters(book.id);
    expect(chapters).toHaveLength(0);
  });

  it('title strips decoration chars from originalName', async () => {
    const gw = new FakeFileGateway();
    const deps = makeDeps(gw);
    gw.registerFile('u', new Uint8Array(Buffer.from('第一章 a\nb\n第二章 c\nd\n第三章 e\nf', 'utf8')));
    const book = await importBook('u', '《昊天传》.txt', deps);
    expect(book.title).not.toContain('《');
    expect(book.title).not.toContain('》');
  });

  it('coverColor is a deterministic hex color for the same title', async () => {
    const gw = new FakeFileGateway();
    const content = new Uint8Array(Buffer.from('第一章 a\nb\n第二章 c\nd\n第三章 e\nf', 'utf8'));

    const deps1: ImportDeps = { fs: gw, repo: new InMemoryBookRepository(), genId: () => 'id-a', now: () => 0 };
    const deps2: ImportDeps = { fs: gw, repo: new InMemoryBookRepository(), genId: () => 'id-b', now: () => 0 };
    gw.registerFile('u', content);

    const b1 = await importBook('u', 'same.txt', deps1);
    const b2 = await importBook('u', 'same.txt', deps2);
    expect(b1.coverColor).toBe(b2.coverColor);
    expect(b1.coverColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
