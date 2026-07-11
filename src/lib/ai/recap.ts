import type { FileGateway } from '../import/importBook';
import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import { readChapterText } from '../reader/readChapter';
import { AiError, type ChatMessage } from './client';
import { SUMMARY_PROMPT_VERSION, chapterSummaryMessages, type SummarizeFn } from './summarize';

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW = 6;

export interface IsRecapDueParams {
  lastReadAt: number | null;
  now: number;
  gapDays: number;
  currentChapterIndex: number;
}

export function isRecapDue({ lastReadAt, now, gapDays, currentChapterIndex }: IsRecapDueParams): boolean {
  if (lastReadAt == null) return false;
  if (currentChapterIndex <= 0) return false;
  return now - lastReadAt >= gapDays * DAY_MS;
}

/** Synthesizes a short (2-3 sentence) spoiler-free "previously on" recap prompt from chapter summaries. */
export function recapMessages(summaries: string[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '把下列已读章节要点合成一段简短「前情回顾」(2-3 句)，帮读者快速想起读到哪了。' +
        '只依据所给要点，不得剧透或推测后续，简洁中文。',
    },
    { role: 'user', content: summaries.map((s, i) => `[${i + 1}] ${s}`).join('\n') },
  ];
}

/** Inclusive [from, cutoff] window of recently-read chapters, strictly before currentChapterIndex (spoiler-safe). */
function recentRange(currentChapterIndex: number, windowChapters: number): { cutoff: number; from: number } {
  const cutoff = currentChapterIndex - 1;
  const from = Math.max(0, cutoff - windowChapters + 1);
  return { cutoff, from };
}

/**
 * Cache-only path: synthesizes a resume recap from already-cached chapter
 * summaries within the recent window. Never reads chapters or calls chat if
 * the cache doesn't have enough hits — returns 'needs-generation' instead.
 */
export async function buildResumeRecap(
  deps: { chat: SummarizeFn; repo: BookRepository },
  params: { bookId: string; currentChapterIndex: number; model: string; windowChapters?: number; signal?: AbortSignal },
): Promise<{ kind: 'text'; text: string } | { kind: 'needs-generation' }> {
  const window = params.windowChapters ?? DEFAULT_WINDOW;
  const { cutoff, from } = recentRange(params.currentChapterIndex, window);
  if (cutoff < 0) return { kind: 'needs-generation' };
  const all = await deps.repo.listSummaries(params.bookId, 0, cutoff); // idx ≤ cutoff（防剧透）
  const hits = all.filter(
    (s) => s.idx >= from && s.idx <= cutoff && s.model === params.model && s.promptVersion === SUMMARY_PROMPT_VERSION,
  );
  const needed = Math.min(window, cutoff + 1, 3);
  if (hits.length < needed) return { kind: 'needs-generation' };
  const text = await deps.chat(recapMessages(hits.map((s) => s.summary)), params.signal);
  return { kind: 'text', text };
}

/**
 * Bounded backfill: summarizes only the missing (or stale model/prompt-version)
 * chapters within the recent window, persists them, then synthesizes the recap.
 * Never reads or summarizes chapters at or after currentChapterIndex.
 */
export async function generateRecentRecap(
  deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository },
  params: {
    book: BookRecord;
    chapters: ChapterRecord[];
    currentChapterIndex: number;
    model: string;
    windowChapters?: number;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<string> {
  const window = params.windowChapters ?? DEFAULT_WINDOW;
  const { cutoff, from } = recentRange(params.currentChapterIndex, window);
  if (cutoff < 0) return '';
  // 找 recent 内需要回填的章（缺失或 model/pv 不匹配），全部 ≤ cutoff
  const missing: number[] = [];
  for (let i = from; i <= cutoff && i < params.chapters.length; i++) {
    const c = await deps.repo.getSummary(params.book.id, 0, i);
    if (!c || c.model !== params.model || c.promptVersion !== SUMMARY_PROMPT_VERSION) missing.push(i);
  }
  const total = missing.length;
  let done = 0;
  for (const i of missing) {
    if (params.signal?.aborted) throw new AiError('cancelled', 'AI 已取消');
    const raw = await readChapterText(deps.fs, params.book.normalizedPath, params.chapters[i]); // i ≤ cutoff → spoiler-safe
    const nl = raw.indexOf('\n');
    const title = nl >= 0 ? raw.slice(0, nl) : raw;
    const body = nl >= 0 ? raw.slice(nl + 1) : '';
    const summary = await deps.chat(chapterSummaryMessages(title, body), params.signal);
    if (params.signal?.aborted) throw new AiError('cancelled', 'AI 已取消');
    await deps.repo.putSummary({
      bookId: params.book.id,
      level: 0,
      idx: i,
      model: params.model,
      promptVersion: SUMMARY_PROMPT_VERSION,
      summary,
      createdAt: Date.now(),
    });
    done += 1;
    params.onProgress?.(done, total);
  }
  const hits = await deps.repo.listSummaries(params.book.id, 0, cutoff);
  const recent = hits.filter(
    (s) => s.idx >= from && s.idx <= cutoff && s.model === params.model && s.promptVersion === SUMMARY_PROMPT_VERSION,
  );
  return deps.chat(recapMessages(recent.map((s) => s.summary)), params.signal);
}
