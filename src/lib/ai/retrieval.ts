/**
 * 增量 7 Task 5: 问书的查询感知检索。扩词（LLM）+ 章小结关键词打分（纯）+
 * 防剧透抽段（只读候选章、只碰 ≤cutoff）。不复用 searchBook（它扫全书含未读章）。
 */

import type { FileGateway } from '../import/importBook';
import type { BookRecord, ChapterRecord, SummaryRecord } from '../import/repository';
import { splitBlocks } from '../reader/blocks';
import { readChapterText } from '../reader/readChapter';
import { makeSearchSnippet } from '../reader/search';
import type { ChatMessage } from './client';
import type { SummarizeFn } from './summarize';

const EXTRACT_SYS =
  '从问题中提取用于检索的关键词与人名/别名，只输出词，用逗号分隔，不要解释。';

/** 宽松解析 LLM 扩词输出：去序号前缀、去纯数字、去空、去重、cap。 */
function parseTerms(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawPiece of raw.split(/[，,、\n]+/)) {
    const piece = rawPiece.trim().replace(/^\d+[.、)．）]+\s*/, '').trim();
    if (!piece || /^\d+$/.test(piece)) continue;
    if (!seen.has(piece)) {
      seen.add(piece);
      out.push(piece);
    }
  }
  return out.slice(0, 12);
}

/** 本地粗切（扩词失败/空时的回退）。 */
function localTokens(question: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of question.split(/[\s，。？、,?.!]+/)) {
    const w = t.trim();
    if (w && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out.slice(0, 12);
}

/** 1 次廉价调用把问题扩成关键词+人名/别名；失败/空则回退本地切词。 */
export async function extractQueryTerms(
  deps: { chat: SummarizeFn },
  question: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: EXTRACT_SYS },
    { role: 'user', content: question },
  ];
  try {
    const raw = await deps.chat(messages, signal);
    const parsed = parseTerms(raw ?? '');
    return parsed.length > 0 ? parsed : localTokens(question);
  } catch {
    return localTokens(question);
  }
}

/** 对已缓存章小结（level 0）按关键词命中次数打分，降序，只留命中的。 */
export function scoreChapterSummaries(
  summaries: SummaryRecord[],
  terms: string[],
): { idx: number; score: number }[] {
  return summaries
    .filter((s) => s.level === 0)
    .map((s) => {
      let score = 0;
      for (const t of terms) {
        if (!t) continue;
        let from = 0;
        for (;;) {
          const at = s.summary.indexOf(t, from);
          if (at === -1) break;
          score += 1;
          from = at + t.length;
        }
      }
      return { idx: s.idx, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * 只对候选章（先过滤到 idx ≤ cutoff，防剧透）读原文、抽含任一 term 的正文段，
 * 用 makeSearchSnippet 大窗口裁剪。绝不读 idx > cutoff 的章。I/O 有界（≤ 候选数）。
 */
export async function retrieveRelevantPassages(
  deps: { fs: FileGateway },
  params: {
    book: BookRecord;
    chapters: ChapterRecord[];
    candidateIdx: number[];
    terms: string[];
    cutoff: number;
    maxBlocks?: number;
  },
): Promise<{ chapterIdx: number; blockIndex: number; text: string }[]> {
  const { fs } = deps;
  const { book, chapters, candidateIdx, terms, cutoff, maxBlocks = 12 } = params;
  const safe = candidateIdx.filter((i) => i <= cutoff); // 防剧透硬边界
  const out: { chapterIdx: number; blockIndex: number; text: string }[] = [];

  for (const i of safe) {
    if (out.length >= maxBlocks) break;
    const chapter = chapters.find((c) => c.index === i);
    if (!chapter) continue;
    const raw = await readChapterText(fs, book.normalizedPath, chapter); // i ≤ cutoff → spoiler-safe
    const blocks = splitBlocks(raw);
    // 从 block1 起（跳过标题块 0）
    for (let bi = 1; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const hit = terms.find((t) => t && block.includes(t));
      if (!hit) continue;
      out.push({ chapterIdx: i, blockIndex: bi, text: makeSearchSnippet(block, hit, { before: 80, after: 200 }) });
      if (out.length >= maxBlocks) break;
    }
  }
  return out;
}
