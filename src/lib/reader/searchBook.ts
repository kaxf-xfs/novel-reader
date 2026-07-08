/** 增量2: 逐章流式全文搜索。一次只驻留一章文本 + 结果数组（≤cap）。 */
import { readChapterText } from './readChapter';
import { splitBlocks } from './blocks';
import { makeSearchSnippet } from './search';
import type { FileGateway } from '../import/importBook';
import type { ChapterRecord } from '../import/repository';

export interface SearchResult {
  chapterIndex: number;
  chapterTitle: string;
  blockIndex: number;
  snippet: string;
}

export interface SearchOutcome {
  results: SearchResult[];
  capped: boolean;
}

export interface SearchBookDeps {
  fs: FileGateway;
  normalizedPath: string;
  chapters: ChapterRecord[];
  term: string;
  cap?: number;
}

export async function searchBook({
  fs,
  normalizedPath,
  chapters,
  term,
  cap = 300,
}: SearchBookDeps): Promise<SearchOutcome> {
  const needle = term.trim();
  if (!needle) return { results: [], capped: false };
  const low = needle.toLowerCase();
  const results: SearchResult[] = [];

  for (const chapter of chapters) {
    const text = await readChapterText(fs, normalizedPath, chapter);
    const blocks = splitBlocks(text);
    // Skip the title block (index 0); chapter titles are covered by the 章节 tab.
    for (let bi = 1; bi < blocks.length; bi++) {
      if (blocks[bi].toLowerCase().includes(low)) {
        results.push({
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          blockIndex: bi,
          snippet: makeSearchSnippet(blocks[bi], needle),
        });
        if (results.length >= cap) return { results, capped: true };
      }
    }
  }
  return { results, capped: false };
}
