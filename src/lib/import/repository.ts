/**
 * T3: BookRepository interfaces and InMemoryBookRepository.
 *
 * Dependency-inversion layer that separates pure import logic from
 * the SQLite persistence layer.  Unit tests use InMemoryBookRepository;
 * production code will use SqliteBookRepository (src/lib/import/sqliteRepository.ts).
 */

// ---------------------------------------------------------------------------
// Record types (match the data model in the spec)
// ---------------------------------------------------------------------------

export interface BookRecord {
  id: string;
  title: string;
  originalName: string;
  /** Detected encoding of the source file, e.g. 'gb18030' | 'utf-8'. */
  encoding: string;
  sizeBytes: number;
  importedAt: number; // Unix ms
  coverColor: string; // e.g. '#E8D5B7'
  strategy: string; // ParseStrategy
  /** Path to the normalized UTF-8 copy in the app sandbox. */
  normalizedPath: string;
}

export interface ChapterRecord {
  bookId: string;
  /** 0-based sequential index within the book. */
  index: number;
  title: string;
  level: 0 | 1;
  /** Byte start in the normalized UTF-8 file (inclusive). */
  byteStart: number;
  /** Byte end in the normalized UTF-8 file (exclusive). */
  byteEnd: number;
}

export interface ProgressRecord {
  bookId: string;
  /** 0-based index of the chapter the reader last had in view. */
  chapterIndex: number;
  /** Character offset within the chapter (best-effort; 0 if unknown). */
  charOffset: number;
  updatedAt: number; // Unix ms
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface BookRepository {
  addBook(b: BookRecord): Promise<void>;
  addChapters(bookId: string, chapters: ChapterRecord[]): Promise<void>;
  listBooks(): Promise<BookRecord[]>;
  /** Returns chapters sorted ascending by index. */
  getChapters(bookId: string): Promise<ChapterRecord[]>;
  /** Removes the book and all its chapters (cascade). */
  deleteBook(bookId: string): Promise<void>;
  /** Upserts the reading progress for a book. */
  saveProgress(p: ProgressRecord): Promise<void>;
  /** Returns the saved progress for a book, or null if none exists. */
  getProgress(bookId: string): Promise<ProgressRecord | null>;
}

// ---------------------------------------------------------------------------
// In-memory implementation (for unit tests and development)
// ---------------------------------------------------------------------------

export class InMemoryBookRepository implements BookRepository {
  private books = new Map<string, BookRecord>();
  private chapters = new Map<string, ChapterRecord[]>();
  private progress = new Map<string, ProgressRecord>();

  async addBook(b: BookRecord): Promise<void> {
    this.books.set(b.id, { ...b });
  }

  async addChapters(bookId: string, chapters: ChapterRecord[]): Promise<void> {
    const existing = this.chapters.get(bookId) ?? [];
    this.chapters.set(bookId, [...existing, ...chapters]);
  }

  async listBooks(): Promise<BookRecord[]> {
    return Array.from(this.books.values());
  }

  async getChapters(bookId: string): Promise<ChapterRecord[]> {
    const chs = this.chapters.get(bookId) ?? [];
    return [...chs].sort((a, b) => a.index - b.index);
  }

  async deleteBook(bookId: string): Promise<void> {
    this.books.delete(bookId);
    this.chapters.delete(bookId);
    this.progress.delete(bookId);
  }

  async saveProgress(p: ProgressRecord): Promise<void> {
    this.progress.set(p.bookId, { ...p });
  }

  async getProgress(bookId: string): Promise<ProgressRecord | null> {
    return this.progress.get(bookId) ?? null;
  }
}
