/**
 * T3: SqliteBookRepository — production BookRepository backed by expo-sqlite.
 *
 * Schema
 * ──────
 *   books (
 *     id           TEXT PRIMARY KEY,
 *     title        TEXT NOT NULL,
 *     originalName TEXT NOT NULL,
 *     encoding     TEXT NOT NULL,
 *     sizeBytes    INTEGER NOT NULL,
 *     importedAt   INTEGER NOT NULL,
 *     coverColor   TEXT NOT NULL,
 *     strategy     TEXT NOT NULL,
 *     normalizedPath TEXT NOT NULL
 *   )
 *
 *   chapters (
 *     bookId     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
 *     idx        INTEGER NOT NULL,          -- 'index' is a reserved word in SQLite
 *     title      TEXT NOT NULL,
 *     level      INTEGER NOT NULL,
 *     byteStart  INTEGER NOT NULL,
 *     byteEnd    INTEGER NOT NULL,
 *     PRIMARY KEY (bookId, idx)
 *   )
 *
 *   progress (
 *     bookId       TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
 *     chapterIndex INTEGER NOT NULL,
 *     charOffset   INTEGER NOT NULL,
 *     updatedAt    INTEGER NOT NULL
 *   )
 *
 *   bookmarks (
 *     id           TEXT PRIMARY KEY,
 *     bookId       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
 *     chapterIndex INTEGER NOT NULL,
 *     blockIndex   INTEGER NOT NULL,
 *     snippet      TEXT NOT NULL,
 *     createdAt    INTEGER NOT NULL
 *   )
 *
 * NOT unit-tested (native SQLite doesn't run in the Jest/Node environment).
 * Type correctness is guaranteed by tsc strict mode.
 *
 * NOTE: On React Native, Buffer is available via the 'buffer' polyfill (T1).
 * expo-sqlite v15 (Expo SDK 57) uses an async API — openDatabaseAsync / execAsync /
 * runAsync / getAllAsync.
 */

import { openDatabaseAsync } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  BookRecord,
  ChapterRecord,
  BookRepository,
  ProgressRecord,
  Bookmark,
} from './repository';

const DB_NAME = 'novel-reader.db';

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const CREATE_BOOKS_TABLE = `
  CREATE TABLE IF NOT EXISTS books (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    originalName  TEXT NOT NULL,
    encoding      TEXT NOT NULL,
    sizeBytes     INTEGER NOT NULL,
    importedAt    INTEGER NOT NULL,
    coverColor    TEXT NOT NULL,
    strategy      TEXT NOT NULL,
    normalizedPath TEXT NOT NULL
  );
`;

const CREATE_CHAPTERS_TABLE = `
  CREATE TABLE IF NOT EXISTS chapters (
    bookId     TEXT NOT NULL,
    idx        INTEGER NOT NULL,
    title      TEXT NOT NULL,
    level      INTEGER NOT NULL,
    byteStart  INTEGER NOT NULL,
    byteEnd    INTEGER NOT NULL,
    PRIMARY KEY (bookId, idx),
    FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
  );
`;

const CREATE_CHAPTERS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_chapters_bookId_idx
    ON chapters (bookId, idx);
`;

const CREATE_PROGRESS_TABLE = `
  CREATE TABLE IF NOT EXISTS progress (
    bookId       TEXT PRIMARY KEY,
    chapterIndex INTEGER NOT NULL,
    charOffset   INTEGER NOT NULL,
    updatedAt    INTEGER NOT NULL,
    FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
  );
`;

const CREATE_BOOKMARKS_TABLE = `
  CREATE TABLE IF NOT EXISTS bookmarks (
    id           TEXT PRIMARY KEY,
    bookId       TEXT NOT NULL,
    chapterIndex INTEGER NOT NULL,
    blockIndex   INTEGER NOT NULL,
    snippet      TEXT NOT NULL,
    createdAt    INTEGER NOT NULL,
    FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
  );
`;

// ---------------------------------------------------------------------------
// SqliteBookRepository
// ---------------------------------------------------------------------------

export class SqliteBookRepository implements BookRepository {
  private dbPromise: Promise<SQLiteDatabase>;

  constructor() {
    this.dbPromise = this.open();
  }

  private async open(): Promise<SQLiteDatabase> {
    const db = await openDatabaseAsync(DB_NAME);
    // WAL mode for better concurrent read performance.
    await db.execAsync('PRAGMA journal_mode = WAL;');
    // Enable foreign-key enforcement.
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await db.execAsync(
      CREATE_BOOKS_TABLE +
        CREATE_CHAPTERS_TABLE +
        CREATE_CHAPTERS_INDEX +
        CREATE_PROGRESS_TABLE +
        CREATE_BOOKMARKS_TABLE,
    );
    return db;
  }

  async addBook(b: BookRecord): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync(
      `INSERT OR REPLACE INTO books
         (id, title, originalName, encoding, sizeBytes, importedAt, coverColor, strategy, normalizedPath)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.id,
      b.title,
      b.originalName,
      b.encoding,
      b.sizeBytes,
      b.importedAt,
      b.coverColor,
      b.strategy,
      b.normalizedPath,
    );
  }

  async addChapters(bookId: string, chapters: ChapterRecord[]): Promise<void> {
    if (chapters.length === 0) return;
    const db = await this.dbPromise;
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const ch of chapters) {
        await txn.runAsync(
          `INSERT OR REPLACE INTO chapters (bookId, idx, title, level, byteStart, byteEnd)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ch.bookId,
          ch.index,
          ch.title,
          ch.level,
          ch.byteStart,
          ch.byteEnd,
        );
      }
    });
  }

  async listBooks(): Promise<BookRecord[]> {
    const db = await this.dbPromise;
    type Row = {
      id: string;
      title: string;
      originalName: string;
      encoding: string;
      sizeBytes: number;
      importedAt: number;
      coverColor: string;
      strategy: string;
      normalizedPath: string;
    };
    const rows = await db.getAllAsync<Row>('SELECT * FROM books ORDER BY importedAt DESC');
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      originalName: r.originalName,
      encoding: r.encoding,
      sizeBytes: r.sizeBytes,
      importedAt: r.importedAt,
      coverColor: r.coverColor,
      strategy: r.strategy,
      normalizedPath: r.normalizedPath,
    }));
  }

  async getChapters(bookId: string): Promise<ChapterRecord[]> {
    const db = await this.dbPromise;
    type Row = {
      bookId: string;
      idx: number;
      title: string;
      level: number;
      byteStart: number;
      byteEnd: number;
    };
    const rows = await db.getAllAsync<Row>(
      'SELECT * FROM chapters WHERE bookId = ? ORDER BY idx ASC',
      bookId,
    );
    return rows.map((r) => ({
      bookId: r.bookId,
      index: r.idx,
      title: r.title,
      level: r.level as 0 | 1,
      byteStart: r.byteStart,
      byteEnd: r.byteEnd,
    }));
  }

  async deleteBook(bookId: string): Promise<void> {
    const db = await this.dbPromise;
    // Cascade is handled by the FOREIGN KEY constraint (PRAGMA foreign_keys=ON).
    await db.runAsync('DELETE FROM books WHERE id = ?', bookId);
  }

  async updateBookTitle(bookId: string, title: string): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync('UPDATE books SET title = ? WHERE id = ?', title, bookId);
  }

  async saveProgress(p: ProgressRecord): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync(
      `INSERT OR REPLACE INTO progress (bookId, chapterIndex, charOffset, updatedAt)
       VALUES (?, ?, ?, ?)`,
      p.bookId,
      p.chapterIndex,
      p.charOffset,
      p.updatedAt,
    );
  }

  async getProgress(bookId: string): Promise<ProgressRecord | null> {
    const db = await this.dbPromise;
    type Row = { bookId: string; chapterIndex: number; charOffset: number; updatedAt: number };
    const row = await db.getFirstAsync<Row>('SELECT * FROM progress WHERE bookId = ?', bookId);
    if (!row) return null;
    return {
      bookId: row.bookId,
      chapterIndex: row.chapterIndex,
      charOffset: row.charOffset,
      updatedAt: row.updatedAt,
    };
  }

  async addBookmark(b: Bookmark): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync(
      `INSERT OR REPLACE INTO bookmarks (id, bookId, chapterIndex, blockIndex, snippet, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      b.id,
      b.bookId,
      b.chapterIndex,
      b.blockIndex,
      b.snippet,
      b.createdAt,
    );
  }

  async listBookmarks(bookId: string): Promise<Bookmark[]> {
    const db = await this.dbPromise;
    type Row = {
      id: string;
      bookId: string;
      chapterIndex: number;
      blockIndex: number;
      snippet: string;
      createdAt: number;
    };
    const rows = await db.getAllAsync<Row>(
      'SELECT * FROM bookmarks WHERE bookId = ? ORDER BY createdAt DESC',
      bookId,
    );
    return rows.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      chapterIndex: r.chapterIndex,
      blockIndex: r.blockIndex,
      snippet: r.snippet,
      createdAt: r.createdAt,
    }));
  }

  async deleteBookmark(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync('DELETE FROM bookmarks WHERE id = ?', id);
  }
}
