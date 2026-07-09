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
  /** 段落在章内的序号（blockIndex）；0 表示章首。用于章内滚动位置恢复。 */
  charOffset: number;
  updatedAt: number; // Unix ms
}

export interface Bookmark {
  id: string;
  bookId: string;
  chapterIndex: number;
  /** 段落在章内的序号（与 ProgressRecord.charOffset 同义）。 */
  blockIndex: number;
  snippet: string;
  createdAt: number; // Unix ms
}

export interface ReadingSession {
  id: string;
  bookId: string;
  /** Unix ms of when this active segment started (used to attribute the local day). */
  startedAt: number;
  /** Active reading milliseconds accrued in this segment. */
  durationMs: number;
}

export interface SummaryRecord {
  bookId: string;
  /** 0 = per-chapter summary, 1 = per-arc (merged) summary. */
  level: 0 | 1;
  /** chapter index (level 0) or arc index (level 1). */
  idx: number;
  model: string;
  promptVersion: string;
  summary: string;
  createdAt: number;
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
  /** Updates a book's display title. No-op if the book does not exist. */
  updateBookTitle(bookId: string, title: string): Promise<void>;
  /** Upserts the reading progress for a book. */
  saveProgress(p: ProgressRecord): Promise<void>;
  /** Returns the saved progress for a book, or null if none exists. */
  getProgress(bookId: string): Promise<ProgressRecord | null>;
  /** 新增一条书签。 */
  addBookmark(b: Bookmark): Promise<void>;
  /** 返回某本书的书签，按 createdAt 降序。 */
  listBookmarks(bookId: string): Promise<Bookmark[]>;
  /** 按 id 删除书签。 */
  deleteBookmark(id: string): Promise<void>;
  /** 追加一段阅读会话时长。 */
  addSession(s: ReadingSession): Promise<void>;
  /** 返回全部阅读会话（顺序不保证；调用方自行聚合）。 */
  listSessions(): Promise<ReadingSession[]>;
  /** Upserts an AI summary keyed by (bookId, level, idx). */
  putSummary(s: SummaryRecord): Promise<void>;
  /** Returns the summary for a key, or null. */
  getSummary(bookId: string, level: 0 | 1, idx: number): Promise<SummaryRecord | null>;
  /** Returns level's summaries with idx ≤ uptoIdx, ascending by idx. */
  listSummaries(bookId: string, level: 0 | 1, uptoIdx: number): Promise<SummaryRecord[]>;
}

// ---------------------------------------------------------------------------
// In-memory implementation (for unit tests and development)
// ---------------------------------------------------------------------------

export class InMemoryBookRepository implements BookRepository {
  private books = new Map<string, BookRecord>();
  private chapters = new Map<string, ChapterRecord[]>();
  private progress = new Map<string, ProgressRecord>();
  private bookmarks = new Map<string, Bookmark>();
  private sessions: ReadingSession[] = [];
  private summaries = new Map<string, SummaryRecord>();

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
    for (const [id, bm] of this.bookmarks) if (bm.bookId === bookId) this.bookmarks.delete(id);
    this.sessions = this.sessions.filter((s) => s.bookId !== bookId);
    for (const [k, s] of this.summaries) if (s.bookId === bookId) this.summaries.delete(k);
  }

  async updateBookTitle(bookId: string, title: string): Promise<void> {
    const existing = this.books.get(bookId);
    if (!existing) return;
    this.books.set(bookId, { ...existing, title });
  }

  async saveProgress(p: ProgressRecord): Promise<void> {
    this.progress.set(p.bookId, { ...p });
  }

  async getProgress(bookId: string): Promise<ProgressRecord | null> {
    return this.progress.get(bookId) ?? null;
  }

  async addBookmark(b: Bookmark): Promise<void> {
    this.bookmarks.set(b.id, { ...b });
  }

  async listBookmarks(bookId: string): Promise<Bookmark[]> {
    return Array.from(this.bookmarks.values())
      .filter((b) => b.bookId === bookId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteBookmark(id: string): Promise<void> {
    this.bookmarks.delete(id);
  }

  async addSession(s: ReadingSession): Promise<void> {
    this.sessions.push({ ...s });
  }

  async listSessions(): Promise<ReadingSession[]> {
    return this.sessions.map((s) => ({ ...s }));
  }

  async putSummary(s: SummaryRecord): Promise<void> {
    this.summaries.set(`${s.bookId}:${s.level}:${s.idx}`, { ...s });
  }

  async getSummary(bookId: string, level: 0 | 1, idx: number): Promise<SummaryRecord | null> {
    return this.summaries.get(`${bookId}:${level}:${idx}`) ?? null;
  }

  async listSummaries(bookId: string, level: 0 | 1, uptoIdx: number): Promise<SummaryRecord[]> {
    return Array.from(this.summaries.values())
      .filter((s) => s.bookId === bookId && s.level === level && s.idx <= uptoIdx)
      .sort((a, b) => a.idx - b.idx)
      .map((s) => ({ ...s }));
  }
}
