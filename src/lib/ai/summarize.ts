/**
 * 增量 5: 章/弧小结 map-reduce。防剧透不变量：只小结 0..cutoff（读完的章），
 * 绝不读 index >= cur 的章。注入 chat/fs/repo 可测。有界并发、可中断、增量落库。
 */

import type { FileGateway } from '../import/importBook';
import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import { readChapterText } from '../reader/readChapter';
import { AiError, type ChatMessage } from './client';

export const SUMMARY_PROMPT_VERSION = 'v1';
export const ARC_SIZE = 25;

export type SummarizeFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;

export function chapterSummaryMessages(title: string, body: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是中文小说的摘要助手。请对给定章节输出"事实要点式"小结（人物、关键事件、关系变化），' +
        '不加评论、不猜测后文，控制在 200 字内。',
    },
    { role: 'user', content: `章节标题：${title}\n\n正文：\n${body}` },
  ];
}

function arcSummaryMessages(summaries: string[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是中文小说的摘要助手。请把多章的要点小结合并成一段更高层的"弧小结"，保留人物与主线，控制在 300 字内。',
    },
    { role: 'user', content: summaries.map((s, i) => `[${i + 1}] ${s}`).join('\n') },
  ];
}

export interface EnsureSummariesParams {
  book: BookRecord;
  chapters: ChapterRecord[];
  /** inclusive last fully-read chapter index (= currentChapter - 1). */
  cutoff: number;
  model: string;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

interface Deps {
  chat: SummarizeFn;
  fs: FileGateway;
  repo: BookRepository;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

export async function ensureSummaries(deps: Deps, params: EnsureSummariesParams): Promise<void> {
  const { chat, fs, repo } = deps;
  const { book, chapters, cutoff, model, concurrency = 4, signal, onProgress } = params;
  if (cutoff < 0) return;

  const throwIfCancelled = () => {
    if (signal?.aborted) throw new AiError('cancelled', 'AI 已取消');
  };

  // 1) which chapters in [0..cutoff] need a fresh summary?
  const missing: number[] = [];
  for (let i = 0; i <= cutoff && i < chapters.length; i++) {
    const cached = await repo.getSummary(book.id, 0, i);
    if (!cached || cached.model !== model || cached.promptVersion !== SUMMARY_PROMPT_VERSION) missing.push(i);
  }

  const total = missing.length;
  let done = 0;
  await runPool(missing, concurrency, async (i) => {
    throwIfCancelled();
    const text = await readChapterText(fs, book.normalizedPath, chapters[i]); // i <= cutoff < cur → spoiler-safe
    const nl = text.indexOf('\n');
    const title = nl >= 0 ? text.slice(0, nl) : text;
    const body = nl >= 0 ? text.slice(nl + 1) : '';
    const summary = await chat(chapterSummaryMessages(title, body), signal);
    throwIfCancelled();
    await repo.putSummary({
      bookId: book.id, level: 0, idx: i, model, promptVersion: SUMMARY_PROMPT_VERSION, summary, createdAt: Date.now(),
    });
    done += 1;
    onProgress?.(done, total);
  });

  // 2) merge arc summaries for every COMPLETE arc (all its chapters <= cutoff).
  const lastCompleteArc = Math.floor((cutoff + 1) / ARC_SIZE) - 1;
  for (let arc = 0; arc <= lastCompleteArc; arc++) {
    throwIfCancelled();
    const existing = await repo.getSummary(book.id, 1, arc);
    if (existing && existing.model === model && existing.promptVersion === SUMMARY_PROMPT_VERSION) continue;
    const parts: string[] = [];
    for (let c = arc * ARC_SIZE; c < (arc + 1) * ARC_SIZE; c++) {
      const s = await repo.getSummary(book.id, 0, c);
      if (s) parts.push(s.summary);
    }
    const merged = await chat(arcSummaryMessages(parts), signal);
    throwIfCancelled();
    await repo.putSummary({
      bookId: book.id, level: 1, idx: arc, model, promptVersion: SUMMARY_PROMPT_VERSION, summary: merged, createdAt: Date.now(),
    });
  }
}
