/**
 * 增量 5: 章/弧小结 map-reduce。防剧透不变量：只小结 0..cutoff（读完的章），
 * 绝不读 index >= cur 的章。注入 chat/fs/repo 可测。有界并发、可中断、增量落库。
 */

import type { FileGateway } from '../import/importBook';
import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import { readChapterText } from '../reader/readChapter';
import { AiError, type ChatMessage } from './client';

export const SUMMARY_PROMPT_VERSION = 'v2';
export const ARC_SIZE = 25;

export type SummarizeFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;

export function chapterSummaryMessages(title: string, body: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是中文小说的摘要助手。请对给定章节输出"事实要点式"小结，要点式列出，逐条覆盖以下几类信息（若某类本章未涉及可跳过）：' +
        '1) 出场人物的身份，以及身世/来历线索——出身、师承、家世、过往经历等任何透露人物背景的细节，哪怕只是一句带过；' +
        '2) 本章发生的关键事件及其先后顺序；' +
        '3) 人物之间关系的建立或变化，例如结识、结怨、结盟、师徒、亲缘等；' +
        '4) 重要设定、物品、地点——功法、法宝、门派、地名、规则等首次出现或获得新信息时须记录；' +
        '5) 看似次要但可能是伏笔的事实——反常的细节、未被解释的暗示、被一带而过但日后可能有用的信息，都要单独列出，不要因为"看似不重要"而省略。' +
        '只陈述章节内已经写明、已经发生的事实，不加评论、不做价值判断、不猜测后文走向、不推断文中未写明的因果关系，全部内容控制在 450 字以内。',
    },
    { role: 'user', content: `章节标题：${title}\n\n正文：\n${body}` },
  ];
}

function arcSummaryMessages(summaries: string[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是中文小说的摘要助手。请把多章的要点小结合并成一段更高层的"弧小结"，保留人物与主线，控制在 400 字内。',
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
  /** Lower bound of the missing-chapter scan (inclusive). Default 0 (full scan). */
  fromIdx?: number;
  /**
   * When false, any cached summary — even one from a different model/promptVersion —
   * counts as "present" and is left alone (only truly-missing chapters are (re)summarized).
   * Default true (existing full-scan/arc behavior).
   */
  upgradeStale?: boolean;
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
  const { fromIdx = 0, upgradeStale = true } = params;
  if (cutoff < 0) return;

  const throwIfCancelled = () => {
    if (signal?.aborted) throw new AiError('cancelled', 'AI 已取消');
  };

  // 1) which chapters in [fromIdx..cutoff] need a fresh summary?
  const missing: number[] = [];
  for (let i = fromIdx; i <= cutoff && i < chapters.length; i++) {
    const cached = await repo.getSummary(book.id, 0, i);
    const isMissing = !cached || (upgradeStale && (cached.model !== model || cached.promptVersion !== SUMMARY_PROMPT_VERSION));
    if (isMissing) missing.push(i);
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
  // Only when scanning from the start — a windowed (fromIdx > 0) auto-backfill
  // doesn't have the full chapter range in view, so it must not build arcs.
  if (fromIdx === 0) {
    const lastCompleteArc = Math.floor((cutoff + 1) / ARC_SIZE) - 1;
    for (let arc = 0; arc <= lastCompleteArc; arc++) {
      throwIfCancelled();
      const existing = await repo.getSummary(book.id, 1, arc);
      // upgradeStale=false（全量按需保底路径）：任何已有弧小结都视为可用、不因
      // model/promptVersion 变化重合并——否则版本 bump 后深读用户首次问书会触发
      // cutoff/ARC_SIZE 次弧重合并（一次性但可观），与「版本容忍迁移」承诺相悖。
      if (existing && (!upgradeStale || (existing.model === model && existing.promptVersion === SUMMARY_PROMPT_VERSION))) continue;
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
}
