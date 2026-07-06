/**
 * T3: importBook — orchestrates the full import pipeline.
 *
 * Pipeline:
 *   readBytes(uri)
 *     → detectEncoding(bytes)
 *     → decodeToUtf8(bytes, encoding)          // GBK/Big5/UTF-8 → JS string
 *     → buildChapterIndex(utf8Text)             // char offsets → byte offsets
 *     → writeNormalized(bookId, utf8Text)       // persist UTF-8 copy to sandbox
 *     → repo.addBook + repo.addChapters         // persist metadata + chapter index
 *
 * All dependencies are injected (FileGateway + BookRepository) so the
 * function is fully unit-testable without a real filesystem or SQLite.
 *
 * NOTE: Buffer polyfill — this module uses Buffer.byteLength indirectly
 * via buildChapterIndex.  In React Native the 'buffer' package (T1) must
 * be imported/polyfilled globally before calling importBook.
 */

import { detectEncoding, decodeToUtf8 } from '../encoding';
import { buildChapterIndex } from './buildIndex';
import type { BookRecord, ChapterRecord, BookRepository } from './repository';

// ---------------------------------------------------------------------------
// Public interfaces (injected dependencies)
// ---------------------------------------------------------------------------

export interface FileGateway {
  /** Read all raw bytes of the source file at the given URI. */
  readBytes(uri: string): Promise<Uint8Array>;
  /**
   * Write the normalized UTF-8 string as a file in the app sandbox.
   *
   * @param bookId  Unique book id (used to derive the destination path).
   * @param utf8    The decoded, normalized text content.
   * @returns       The file:// URI of the written file.
   */
  writeNormalized(bookId: string, utf8: string): Promise<string>;
  /**
   * Read a byte range [byteStart, byteEnd) from the file at `uri` without
   * loading the whole file into memory.  Used by the reader (T4) to stream
   * individual chapters from the normalized UTF-8 copy.
   *
   * `byteStart`/`byteEnd` are expected to land on UTF-8 character boundaries
   * (guaranteed for offsets coming from ChapterRecord, see buildChapterIndex).
   */
  readRange(uri: string, byteStart: number, byteEnd: number): Promise<Uint8Array>;
}

export interface ImportDeps {
  fs: FileGateway;
  repo: BookRepository;
  /** Override the id generator (useful for deterministic tests). */
  genId?: () => string;
  /** Override the timestamp source (useful for deterministic tests). */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic cover color from the book title via a simple
 * djb2-style hash.  Returns one of 10 warm/cool muted hex colors.
 * The mapping is stable: same title → same color across app restarts.
 */
function coverColorFromTitle(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
  }
  const palette = [
    '#E8D5B7', // warm sand
    '#B7D5E8', // sky blue
    '#D5E8B7', // leaf green
    '#E8B7D5', // rose
    '#D5B7E8', // lavender
    '#E8C9B7', // peach
    '#B7E8D5', // mint
    '#C9B7E8', // lilac
    '#B7E8C9', // seafoam
    '#E8E8B7', // cream
  ];
  return palette[Math.abs(hash) % palette.length];
}

function defaultGenId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Strip common decoration characters from a file name to produce a display title.
 * Removes extension, then book-bracket chars like 《》「」【】.
 */
function titleFromFilename(originalName: string): string {
  const withoutExt = originalName.replace(/\.txt$/i, '');
  const stripped = withoutExt.replace(/[《》「」【】]/g, '').trim();
  return stripped || originalName;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Import a novel file from `fileUri` into the app's book database.
 *
 * Detects encoding, decodes to UTF-8, builds a chapter index with byte
 * offsets, writes a normalized UTF-8 copy to the sandbox, and persists
 * the book + chapter records to the repository.
 *
 * @returns The persisted BookRecord.
 */
export async function importBook(
  fileUri: string,
  originalName: string,
  deps: ImportDeps,
): Promise<BookRecord> {
  const { fs, repo, genId = defaultGenId, now = Date.now } = deps;

  // ── 1. Read raw bytes ─────────────────────────────────────────────────────
  const bytes = await fs.readBytes(fileUri);

  // ── 2. Detect encoding + decode to UTF-8 ─────────────────────────────────
  const { encoding } = detectEncoding(bytes);
  const utf8Text = decodeToUtf8(bytes, encoding);

  // ── 3. Build chapter index (char offsets → byte offsets) ──────────────────
  const index = buildChapterIndex(utf8Text);

  // ── 4. Generate id ────────────────────────────────────────────────────────
  const id = genId();

  // ── 5. Write normalized UTF-8 copy to sandbox ─────────────────────────────
  const normalizedPath = await fs.writeNormalized(id, utf8Text);

  // ── 6. Build BookRecord ───────────────────────────────────────────────────
  const title = titleFromFilename(originalName);
  const book: BookRecord = {
    id,
    title,
    originalName,
    encoding,
    sizeBytes: bytes.length,
    importedAt: now(),
    coverColor: coverColorFromTitle(title),
    strategy: index.strategy,
    normalizedPath,
  };

  // ── 7. Persist to repository ──────────────────────────────────────────────
  await repo.addBook(book);

  const chapterRecords: ChapterRecord[] = index.entries.map((entry, i) => ({
    bookId: id,
    index: i,
    title: entry.title,
    level: entry.level,
    byteStart: entry.byteStart,
    byteEnd: entry.byteEnd,
  }));

  await repo.addChapters(id, chapterRecords);

  return book;
}
