/* @jest-environment node */
/**
 * T3: InMemoryBookRepository tests.
 *
 * Exercises all four repository methods:
 *   addBook / listBooks / addChapters / getChapters / deleteBook (cascade)
 */

import { InMemoryBookRepository } from '../repository';
import type { BookRecord, ChapterRecord, ProgressRecord } from '../repository';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBook(override: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'book-1',
    title: '凡人修仙传',
    originalName: '凡人修仙传.txt',
    encoding: 'gb18030',
    sizeBytes: 15_000_000,
    importedAt: 1_700_000_000_000,
    coverColor: '#E8D5B7',
    strategy: 'regex',
    normalizedPath: '/docs/books/book-1.txt',
    ...override,
  };
}

function makeChapters(bookId: string, count: number): ChapterRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    bookId,
    index: i,
    title: `第${i + 1}章 标题`,
    level: 1 as const,
    byteStart: i * 1000,
    byteEnd: (i + 1) * 1000,
  }));
}

// ---------------------------------------------------------------------------
// addBook + listBooks
// ---------------------------------------------------------------------------

describe('InMemoryBookRepository – addBook / listBooks', () => {
  it('lists empty when no books added', async () => {
    const repo = new InMemoryBookRepository();
    expect(await repo.listBooks()).toHaveLength(0);
  });

  it('lists book after addBook', async () => {
    const repo = new InMemoryBookRepository();
    const book = makeBook();
    await repo.addBook(book);
    const list = await repo.listBooks();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(book);
  });

  it('lists multiple books', async () => {
    const repo = new InMemoryBookRepository();
    const b1 = makeBook({ id: 'b1', title: '书一' });
    const b2 = makeBook({ id: 'b2', title: '书二' });
    await repo.addBook(b1);
    await repo.addBook(b2);
    const list = await repo.listBooks();
    expect(list).toHaveLength(2);
    const ids = list.map((b) => b.id);
    expect(ids).toContain('b1');
    expect(ids).toContain('b2');
  });

  it('overwriting same id replaces the record', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBook(makeBook({ title: 'Old Title' }));
    await repo.addBook(makeBook({ title: 'New Title' }));
    const list = await repo.listBooks();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('New Title');
  });
});

// ---------------------------------------------------------------------------
// addChapters + getChapters
// ---------------------------------------------------------------------------

describe('InMemoryBookRepository – addChapters / getChapters', () => {
  it('returns empty array for unknown bookId', async () => {
    const repo = new InMemoryBookRepository();
    expect(await repo.getChapters('unknown')).toHaveLength(0);
  });

  it('retrieves chapters after addChapters', async () => {
    const repo = new InMemoryBookRepository();
    const book = makeBook();
    await repo.addBook(book);
    const chapters = makeChapters(book.id, 5);
    await repo.addChapters(book.id, chapters);
    const retrieved = await repo.getChapters(book.id);
    expect(retrieved).toHaveLength(5);
  });

  it('chapters are returned sorted by index', async () => {
    const repo = new InMemoryBookRepository();
    const book = makeBook();
    await repo.addBook(book);
    // Add in reverse order
    const chapters = makeChapters(book.id, 5).reverse();
    await repo.addChapters(book.id, chapters);
    const retrieved = await repo.getChapters(book.id);
    for (let i = 0; i < retrieved.length; i++) {
      expect(retrieved[i].index).toBe(i);
    }
  });

  it('multiple addChapters calls accumulate', async () => {
    const repo = new InMemoryBookRepository();
    const book = makeBook();
    await repo.addBook(book);
    await repo.addChapters(book.id, makeChapters(book.id, 3));
    await repo.addChapters(book.id, [
      { bookId: book.id, index: 3, title: '第4章', level: 1, byteStart: 3000, byteEnd: 4000 },
    ]);
    const retrieved = await repo.getChapters(book.id);
    expect(retrieved).toHaveLength(4);
    expect(retrieved[3].index).toBe(3);
  });

  it('chapters from different books are isolated', async () => {
    const repo = new InMemoryBookRepository();
    const b1 = makeBook({ id: 'b1' });
    const b2 = makeBook({ id: 'b2' });
    await repo.addBook(b1);
    await repo.addBook(b2);
    await repo.addChapters('b1', makeChapters('b1', 3));
    await repo.addChapters('b2', makeChapters('b2', 7));
    expect(await repo.getChapters('b1')).toHaveLength(3);
    expect(await repo.getChapters('b2')).toHaveLength(7);
  });

  it('getChapters returns correct bookId on each record', async () => {
    const repo = new InMemoryBookRepository();
    const book = makeBook({ id: 'my-book' });
    await repo.addBook(book);
    await repo.addChapters(book.id, makeChapters(book.id, 2));
    const retrieved = await repo.getChapters(book.id);
    expect(retrieved.every((c) => c.bookId === 'my-book')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteBook – cascade
// ---------------------------------------------------------------------------

describe('InMemoryBookRepository – deleteBook', () => {
  it('removes book from listBooks', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBook(makeBook({ id: 'del' }));
    await repo.deleteBook('del');
    const list = await repo.listBooks();
    expect(list.find((b) => b.id === 'del')).toBeUndefined();
  });

  it('cascades: getChapters returns empty after deleteBook', async () => {
    const repo = new InMemoryBookRepository();
    const book = makeBook({ id: 'del' });
    await repo.addBook(book);
    await repo.addChapters(book.id, makeChapters(book.id, 5));
    await repo.deleteBook(book.id);
    expect(await repo.getChapters(book.id)).toHaveLength(0);
  });

  it('does not affect other books when deleting one', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBook(makeBook({ id: 'keep' }));
    await repo.addBook(makeBook({ id: 'del' }));
    await repo.addChapters('keep', makeChapters('keep', 3));
    await repo.addChapters('del', makeChapters('del', 3));
    await repo.deleteBook('del');
    expect(await repo.listBooks()).toHaveLength(1);
    expect(await repo.getChapters('keep')).toHaveLength(3);
  });

  it('deleting non-existent book is a no-op', async () => {
    const repo = new InMemoryBookRepository();
    await expect(repo.deleteBook('ghost')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// saveProgress / getProgress
// ---------------------------------------------------------------------------

function makeProgress(override: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    bookId: 'book-1',
    chapterIndex: 3,
    charOffset: 120,
    updatedAt: 1_700_000_000_000,
    ...override,
  };
}

describe('InMemoryBookRepository – saveProgress / getProgress', () => {
  it('returns null when no progress has been saved', async () => {
    const repo = new InMemoryBookRepository();
    expect(await repo.getProgress('unknown')).toBeNull();
  });

  it('retrieves progress after saveProgress', async () => {
    const repo = new InMemoryBookRepository();
    const p = makeProgress();
    await repo.saveProgress(p);
    expect(await repo.getProgress('book-1')).toEqual(p);
  });

  it('saveProgress overwrites the previous record for the same book', async () => {
    const repo = new InMemoryBookRepository();
    await repo.saveProgress(makeProgress({ chapterIndex: 1, charOffset: 0 }));
    await repo.saveProgress(makeProgress({ chapterIndex: 5, charOffset: 42 }));
    const p = await repo.getProgress('book-1');
    expect(p?.chapterIndex).toBe(5);
    expect(p?.charOffset).toBe(42);
  });

  it('progress for different books is isolated', async () => {
    const repo = new InMemoryBookRepository();
    await repo.saveProgress(makeProgress({ bookId: 'b1', chapterIndex: 1 }));
    await repo.saveProgress(makeProgress({ bookId: 'b2', chapterIndex: 9 }));
    expect((await repo.getProgress('b1'))?.chapterIndex).toBe(1);
    expect((await repo.getProgress('b2'))?.chapterIndex).toBe(9);
  });

  it('deleteBook clears the saved progress for that book', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBook(makeBook({ id: 'del' }));
    await repo.saveProgress(makeProgress({ bookId: 'del' }));
    await repo.deleteBook('del');
    expect(await repo.getProgress('del')).toBeNull();
  });

  it('deleteBook does not affect progress of other books', async () => {
    const repo = new InMemoryBookRepository();
    await repo.saveProgress(makeProgress({ bookId: 'keep' }));
    await repo.saveProgress(makeProgress({ bookId: 'del' }));
    await repo.deleteBook('del');
    expect(await repo.getProgress('keep')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bookmarks
// ---------------------------------------------------------------------------

import { type Bookmark } from '../repository';

function makeBookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm1',
    bookId: 'book-1',
    chapterIndex: 3,
    blockIndex: 5,
    snippet: '他推开门。',
    createdAt: 1000,
    ...over,
  };
}

describe('InMemoryBookRepository – bookmarks', () => {
  it('returns an empty list when there are no bookmarks', async () => {
    const repo = new InMemoryBookRepository();
    expect(await repo.listBookmarks('book-1')).toEqual([]);
  });

  it('adds and lists bookmarks for a book, newest first', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBookmark(makeBookmark({ id: 'a', createdAt: 100 }));
    await repo.addBookmark(makeBookmark({ id: 'b', createdAt: 300 }));
    await repo.addBookmark(makeBookmark({ id: 'c', createdAt: 200 }));
    const list = await repo.listBookmarks('book-1');
    expect(list.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('scopes bookmarks by book', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBookmark(makeBookmark({ id: 'a', bookId: 'b1' }));
    await repo.addBookmark(makeBookmark({ id: 'b', bookId: 'b2' }));
    expect((await repo.listBookmarks('b1')).map((b) => b.id)).toEqual(['a']);
  });

  it('deletes a bookmark by id', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBookmark(makeBookmark({ id: 'a' }));
    await repo.deleteBookmark('a');
    expect(await repo.listBookmarks('book-1')).toEqual([]);
  });

  it('removes a book\'s bookmarks when the book is deleted', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBookmark(makeBookmark({ id: 'a', bookId: 'book-1' }));
    await repo.deleteBook('book-1');
    expect(await repo.listBookmarks('book-1')).toEqual([]);
  });
});
