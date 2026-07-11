/**
 * 增量 5: 伴读 prompt 构造（纯）+ buildReadContext 编排（防剧透地拼上下文）。
 */

import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import type { FileGateway } from '../import/importBook';
import { splitBlocks } from '../reader/blocks';
import { readChapterText } from '../reader/readChapter';
import type { ChatMessage } from './client';
import { CONTEXT_BUDGET, selectContext } from './context';
import { extractQueryTerms, retrieveRelevantPassages, scoreChapterSummaries } from './retrieval';
import { ARC_SIZE, ensureSummaries, type SummarizeFn } from './summarize';

export type AiMode = 'recap' | 'ask' | 'character';

const SPOILER_RULE =
  '下面【已读内容】是读者到目前为止读过的部分（更早章节的要点小结 + 当前章已读原文）。' +
  '只能依据【已读内容】作答，绝不能透露或推测读者尚未读到的后续情节。' +
  '若【已读内容】不足以回答，就直说「目前读到的部分还没有相关内容」。用简洁中文。';

export function askBookMessages(context: string, question: string): ChatMessage[] {
  return [
    { role: 'system', content: `你是读者的「已读伴读」助手。${SPOILER_RULE}` },
    { role: 'user', content: `【已读内容】\n${context}\n\n【问题】${question}` },
  ];
}

export function storySoFarMessages(context: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是「剧情回顾」助手。请根据【已读内容】写一段到当前进度为止的「前情提要」，${SPOILER_RULE} 控制在 200–400 字。`,
    },
    { role: 'user', content: `【已读内容】\n${context}` },
  ];
}

export function characterMessages(context: string, name: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是「人物档案」助手。请介绍读者指定的人物：他是谁、目前为止做过什么、与谁是什么关系。${SPOILER_RULE} 若还没出现，就说「目前读到的部分还没出现这个人物」。`,
    },
    { role: 'user', content: `【已读内容】\n${context}\n\n【人物】${name}` },
  ];
}

export interface BuildContextParams {
  book: BookRecord;
  chapters: ChapterRecord[];
  currentChapterIndex: number;
  currentBlockIndex: number;
  model: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export async function buildReadContext(
  deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository },
  params: BuildContextParams,
): Promise<{ contextText: string; includedChapterIdx: number[] }> {
  const { chat, fs, repo } = deps;
  const { book, chapters, currentChapterIndex, currentBlockIndex, model, signal, onProgress } = params;
  const cutoff = currentChapterIndex - 1;

  // 全量按需保底但 upgradeStale=false：旧版本摘要照用、只补真缺，绝不在一次
  // 回顾/人物调用里同步重刷全书（与 buildAskContext 一致的版本容忍迁移）。
  await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff, model, signal, onProgress, upgradeStale: false });

  const chapterSummaries = await repo.listSummaries(book.id, 0, cutoff);
  const lastArc = Math.floor((cutoff + 1) / ARC_SIZE) - 1;
  const arcSummaries = await repo.listSummaries(book.id, 1, lastArc);

  let currentChapterText = '';
  if (currentChapterIndex >= 0 && currentChapterIndex < chapters.length) {
    const raw = await readChapterText(fs, book.normalizedPath, chapters[currentChapterIndex]);
    currentChapterText = splitBlocks(raw).slice(0, currentBlockIndex + 1).join('\n');
  }

  const { contextText, includedChapterIdx } = selectContext({
    arcSummaries,
    chapterSummaries,
    currentChapterText,
    cutoff,
  });
  return { contextText, includedChapterIdx };
}

/** 检索段的子预算（字符数）；从 CONTEXT_BUDGET 里先扣这部分，剩余给 selectContext。 */
const PASSAGE_BUDGET = 8000;

export interface BuildAskContextParams {
  book: BookRecord;
  chapters: ChapterRecord[];
  currentChapterIndex: number;
  currentBlockIndex: number;
  model: string;
  question: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/**
 * 增量 7 Task 6a: 问书的查询感知编排。在 buildReadContext 的防剧透基座（章/弧小结 +
 * 当前章已读原文）之上，先用 extractQueryTerms 扩词、对已缓存章小结打分选出候选章，
 * 再用 retrieveRelevantPassages 只在候选（且 idx ≤ cutoff）里抽相关原文段，拼在最前面。
 * upgradeStale=false：全量补齐缺失摘要作保底，但不因 prompt/model 变化重刷全书旧摘要。
 */
export async function buildAskContext(
  deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository },
  params: BuildAskContextParams,
): Promise<{ contextText: string; includedChapterIdx: number[] }> {
  const { chat, fs, repo } = deps;
  const { book, chapters, currentChapterIndex, currentBlockIndex, model, question, signal, onProgress } = params;
  const cutoff = currentChapterIndex - 1;

  // 1) full-scan backfill of missing chapter/arc summaries, but never re-summarize
  // an already-cached (possibly stale-version) chapter — cheap, no full-book re-spend.
  await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff, model, signal, onProgress, upgradeStale: false });

  // 2) query-aware term extraction (1 cheap LLM call, falls back to local tokens).
  const terms = await extractQueryTerms({ chat }, question, signal);

  // 3) cached summaries, hard-clamped to ≤ cutoff (defense in depth on top of the
  // repo's own uptoIdx contract).
  const chapterSummaries = (await repo.listSummaries(book.id, 0, cutoff)).filter((s) => s.idx <= cutoff);
  const lastArc = Math.floor((cutoff + 1) / ARC_SIZE) - 1;
  const arcSummaries = await repo.listSummaries(book.id, 1, lastArc);

  // 4) rank candidate chapters by keyword hits in their cached summaries, top 10.
  const ranked = scoreChapterSummaries(chapterSummaries, terms).slice(0, 10);
  const candidateIdx = ranked.map((r) => r.idx).filter((i) => i <= cutoff);

  // 5) pull relevant original-text passages from those candidates only (spoiler-safe:
  // retrieveRelevantPassages itself never reads past cutoff).
  const passages = await retrieveRelevantPassages({ fs }, { book, chapters, candidateIdx, terms, cutoff, maxBlocks: 12 });

  // 6) assemble the retrieved-passage block, capped at its own sub-budget.
  let used = 0;
  const passLines: string[] = [];
  for (const p of passages) {
    if (p.chapterIdx > cutoff) continue; // defense-in-depth, mirrors retrieveRelevantPassages' own guard
    const line = `【相关原文·第${p.chapterIdx + 1}章】${p.text}`;
    if (used + line.length + 1 > PASSAGE_BUDGET) break;
    passLines.push(line);
    used += line.length + 1;
  }

  // 7) current chapter's read-so-far text (same slicing rule as buildReadContext).
  let currentChapterText = '';
  if (currentChapterIndex >= 0 && currentChapterIndex < chapters.length) {
    const raw = await readChapterText(fs, book.normalizedPath, chapters[currentChapterIndex]);
    currentChapterText = splitBlocks(raw).slice(0, currentBlockIndex + 1).join('\n');
  }

  // 8) reuse selectContext for the summary/current-chapter backbone, with the
  // remaining budget after the retrieved passages.
  const sel = selectContext({
    arcSummaries,
    chapterSummaries,
    currentChapterText,
    cutoff,
    budgetChars: CONTEXT_BUDGET - used,
  });

  const contextText = [passLines.join('\n'), sel.contextText].filter(Boolean).join('\n\n');
  const includedChapterIdx = Array.from(
    new Set([...passages.map((p) => p.chapterIdx), ...sel.includedChapterIdx]),
  ).filter((i) => i <= cutoff);

  return { contextText, includedChapterIdx };
}
