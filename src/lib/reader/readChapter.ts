/**
 * T4: readChapterText — reads a single chapter's text from the normalized
 * UTF-8 file, without loading the whole book into memory.
 *
 * ChapterRecord.byteStart/byteEnd are guaranteed (by buildChapterIndex, T3)
 * to land on UTF-8 character boundaries, so decoding the raw byte slice
 * with Buffer.from(bytes).toString('utf8') is always clean — no partial
 * multi-byte sequences to stitch across chunk boundaries.
 */

import type { FileGateway } from '../import/importBook';
import type { ChapterRecord } from '../import/repository';

export async function readChapterText(
  fs: FileGateway,
  normalizedPath: string,
  chapter: ChapterRecord,
): Promise<string> {
  const bytes = await fs.readRange(normalizedPath, chapter.byteStart, chapter.byteEnd);
  return Buffer.from(bytes).toString('utf8');
}
