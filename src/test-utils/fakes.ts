/**
 * Shared test fakes + seeding helpers for component/integration tests.
 *
 * Screens take `repo` / `fs` as props (dependency injection), so tests wire
 * in these in-memory fakes and exercise real screen logic without any native
 * modules.
 */

import { Buffer } from 'buffer';

import type { FileGateway } from '../lib/import/importBook';
import {
  InMemoryBookRepository,
  type BookRecord,
  type ChapterRecord,
} from '../lib/import/repository';

/**
 * In-memory FileGateway: `registerFile` seeds bytes for a uri; `readRange`
 * slices them (mirroring the byte-range reads the reader performs).
 * `writeNormalized` records the written UTF-8 keyed by bookId.
 */
export class FakeFileGateway implements FileGateway {
  private bytesMap = new Map<string, Uint8Array>();
  public writtenBooks = new Map<string, string>();

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

  async readRange(uri: string, byteStart: number, byteEnd: number): Promise<Uint8Array> {
    const b = this.bytesMap.get(uri);
    if (!b) throw new Error(`FakeFileGateway: no file registered for ${uri}`);
    return b.subarray(byteStart, byteEnd);
  }
}

export interface SeedChapter {
  title: string;
  /** Single paragraph of body text (rendered as a second block). */
  body: string;
}

export interface SeedReaderOptions {
  bookId?: string;
  title?: string;
  chapters: SeedChapter[];
  /** If set, saves reading progress at this chapter index. */
  progressChapterIndex?: number;
}

/**
 * Seeds a repo + FakeFileGateway with a fully-consistent book: builds the
 * normalized UTF-8 text, computes contiguous byte offsets per chapter,
 * registers the file so the reader's byte-range reads resolve, and inserts
 * the book/chapters/progress into the repo.
 */
export async function seedReader(
  repo: InMemoryBookRepository,
  fs: FakeFileGateway,
  opts: SeedReaderOptions,
): Promise<BookRecord> {
  const bookId = opts.bookId ?? 'book-1';
  const title = opts.title ?? '测试小说';
  const normalizedPath = `/fake/books/${bookId}.txt`;

  // Each chapter segment: "<title>\n<body>\n" — splitBlocks yields [title, body].
  let fullText = '';
  const chapterRecords: ChapterRecord[] = [];
  let byteCursor = 0;

  opts.chapters.forEach((ch, index) => {
    const segment = `${ch.title}\n${ch.body}\n`;
    const segBytes = Buffer.byteLength(segment, 'utf8');
    chapterRecords.push({
      bookId,
      index,
      title: ch.title,
      level: 1,
      byteStart: byteCursor,
      byteEnd: byteCursor + segBytes,
    });
    fullText += segment;
    byteCursor += segBytes;
  });

  const bytes = new Uint8Array(Buffer.from(fullText, 'utf8'));
  fs.registerFile(normalizedPath, bytes);

  const book: BookRecord = {
    id: bookId,
    title,
    originalName: `${title}.txt`,
    encoding: 'utf-8',
    sizeBytes: bytes.length,
    importedAt: 1_700_000_000_000,
    coverColor: '#8899aa',
    strategy: 'regex',
    normalizedPath,
  };

  await repo.addBook(book);
  await repo.addChapters(bookId, chapterRecords);
  if (opts.progressChapterIndex != null) {
    await repo.saveProgress({
      bookId,
      chapterIndex: opts.progressChapterIndex,
      charOffset: 0,
      updatedAt: 1_700_000_000_000,
    });
  }

  return book;
}
