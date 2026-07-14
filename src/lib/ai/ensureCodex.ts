/**
 * 增量 8 Task 5: 已读图鉴的编排层。模块级 per-book 锁串行化 ai_codex 单行
 * blob 的读-改-写；版本容忍（不自动全书重建，旧图鉴照展示、只增量扩展）；
 * 可恢复检查点（每 N 块落库一次）；autoOn 跟随全局 autoSummarize 开关切两态。
 */

import type { FileGateway } from '../import/importBook';
import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import { AiError, type ChatMessage, type ChatResult } from './client';
import { EMPTY_CODEX, type Codex } from './codex';
import { extractCodex, type CodexBlock, type RosterEntry } from './codexExtract';
import { isCharacterDirty, isTermDirty, polishCodex, type PolishChatFn } from './codexPolish';
import { mergeCodex } from './codexMerge';
import { ensureSummaries, type SummarizeFn } from './summarize';

export const CODEX_PROMPT_VERSION = 'v2';
const BLOCK_SIZE = 15;
const CHECKPOINT_EVERY_BLOCKS = 5;

type CodexChatFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<ChatResult>;

export interface EnsureCodexDeps {
  chat: CodexChatFn;
  polishChat: PolishChatFn;
  /** 用于 autoOn 路径下的章摘要保底（复用 ensureSummaries）。 */
  summarizeChat: SummarizeFn;
  fs: FileGateway;
  repo: BookRepository;
}

export interface EnsureCodexParams {
  book: BookRecord;
  chapters: ChapterRecord[];
  cutoff: number;
  model: string;
  autoOn: boolean;
  /** 显式「重建图鉴」：忽略已缓存的 codex，从零重抽（仍受 cutoff/已缓存摘要约束）。 */
  forceRebuild?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface EnsureCodexResult {
  codex: Codex;
  coveredUptoIdx: number;
  complete: boolean;
  /** 已存 codex 的 model/promptVersion 与当前不一致（UI 据此显示「重建图鉴」）。 */
  versionMismatch: boolean;
}

// 模块级 per-book 锁：串行化同一本书的 read-modify-write，防止「补全」按钮与
// 任何后台预热任务并发导致丢更新。锁跨组件重挂载依然生效（不是 hook 局部 ref）。
const locks = new Map<string, Promise<unknown>>();

function withBookLock<T>(bookId: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(bookId) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  locks.set(bookId, next.catch(() => undefined));
  return next;
}

/** 测试专用：清空所有模块级锁，避免跨 it() 状态泄漏。 */
export function __resetCodexLocks(): void {
  locks.clear();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function rosterFrom(codex: Codex): RosterEntry[] {
  return codex.characters.map((c) => ({ name: c.name, aliases: c.aliases.map((a) => a.text) }));
}

async function isCoverageComplete(repo: BookRepository, bookId: string, cutoff: number): Promise<boolean> {
  const cached = await repo.listSummaries(bookId, 0, cutoff);
  return cached.length === cutoff + 1;
}

export async function ensureCodex(deps: EnsureCodexDeps, params: EnsureCodexParams): Promise<EnsureCodexResult> {
  const { book, chapters, cutoff, model, autoOn, forceRebuild = false, signal, onProgress } = params;
  if (cutoff < 0) return { codex: EMPTY_CODEX, coveredUptoIdx: -1, complete: true, versionMismatch: false };

  return withBookLock(book.id, async () => {
    const throwIfCancelled = () => {
      if (signal?.aborted) throw new AiError('cancelled', 'AI 已取消');
    };

    const existingRecord = forceRebuild ? null : await deps.repo.getCodex(book.id);
    const versionMismatch = !!existingRecord && (existingRecord.model !== model || existingRecord.promptVersion !== CODEX_PROMPT_VERSION);
    let codex: Codex = existingRecord ? (JSON.parse(existingRecord.json) as Codex) : EMPTY_CODEX;
    let coveredUptoIdx = existingRecord?.coveredUptoIdx ?? -1;

    const persist = async (uptoIdx: number) => {
      coveredUptoIdx = uptoIdx;
      await deps.repo.putCodex({
        bookId: book.id,
        coveredUptoIdx,
        model,
        promptVersion: CODEX_PROMPT_VERSION,
        json: JSON.stringify(codex),
        updatedAt: Date.now(),
      });
    };

    // Bulk-fetch summary text ONCE into an idx→text map, instead of re-fetching
    // each chapter individually inside the checkpoint loop below (that was up
    // to CHECKPOINT_EVERY_BLOCKS*BLOCK_SIZE separate native-bridge round-trips
    // per checkpoint iteration — the real-device freeze). Both autoOn branches
    // share this map: the else-branch's existing listSummaries() call already
    // covers the full [0..cutoff] range needed, so it doubles as the source of
    // both the coverage-gap scan and the checkpoint loop's summary lookups.
    const summaryTextByIdx = new Map<number, string>();
    let availableIdx: number[];
    if (autoOn) {
      await ensureSummaries(
        { chat: deps.summarizeChat, fs: deps.fs, repo: deps.repo },
        { book, chapters, cutoff, model, signal, upgradeStale: false },
      );
      availableIdx = [];
      for (let i = coveredUptoIdx + 1; i <= cutoff; i++) availableIdx.push(i);
    } else {
      const cached = await deps.repo.listSummaries(book.id, 0, cutoff);
      for (const s of cached) summaryTextByIdx.set(s.idx, s.summary);
      availableIdx = [];
      for (let i = coveredUptoIdx + 1; i <= cutoff; i++) {
        if (!summaryTextByIdx.has(i)) break; // 遇到第一个缺口就停：coveredUptoIdx 绝不跳过未覆盖的章节
        availableIdx.push(i);
      }
    }

    // 只在追上 cutoff（没有更多章节可抽）时跑一次润色——不在每个中间 checkpoint
    // 触发。这一个闭包同时覆盖两个退出点："没有新章节可抽"的早退分支，以及主
    // 循环跑完后的尾部——两者都是"刚追上 cutoff"这同一个时刻。整个 pass 跑完
    // 才持久化一次；取消时不落盘半完成的部分，下次重新判定脏实体、重新跑，不
    // 会丢数据也不会不一致。
    const runPolishIfDirty = async () => {
      if (codex.characters.some(isCharacterDirty) || codex.terms.some(isTermDirty)) {
        throwIfCancelled();
        codex = await polishCodex({ chat: deps.polishChat }, { codex, signal, onProgress });
        throwIfCancelled();
        await persist(coveredUptoIdx); // coveredUptoIdx 保持不变——润色不改变"覆盖到哪一章"这个语义
      }
    };

    if (availableIdx.length === 0) {
      await runPolishIfDirty();
      const complete = autoOn ? true : await isCoverageComplete(deps.repo, book.id, cutoff);
      return { codex, coveredUptoIdx, complete, versionMismatch };
    }

    // autoOn's ensureSummaries() call above guarantees availableIdx's summaries
    // now exist in the DB but summaryTextByIdx wasn't populated yet for that
    // branch (the else-branch already populated it above) — fetch once now.
    if (autoOn) {
      const fetched = await deps.repo.listSummaries(book.id, 0, cutoff);
      for (const s of fetched) summaryTextByIdx.set(s.idx, s.summary);
    }

    const blocks = chunk(availableIdx, BLOCK_SIZE);
    let doneBlocks = 0;

    for (let bi = 0; bi < blocks.length; bi += CHECKPOINT_EVERY_BLOCKS) {
      throwIfCancelled();
      const batch = blocks.slice(bi, bi + CHECKPOINT_EVERY_BLOCKS);
      const codexBlocks: CodexBlock[] = batch.map((idxs) => ({
        items: idxs.map((idx) => ({ idx, summary: summaryTextByIdx.get(idx) ?? '' })),
      }));

      const results = await extractCodex(
        { chat: deps.chat },
        {
          blocks: codexBlocks,
          roster: rosterFrom(codex),
          signal,
          onProgress: (d, t) => onProgress?.(doneBlocks + d, blocks.length),
        },
      );
      codex = mergeCodex(codex, results);
      doneBlocks += batch.length;
      onProgress?.(doneBlocks, blocks.length);

      const newUpto = Math.max(coveredUptoIdx, ...batch.flat());
      throwIfCancelled();
      await persist(newUpto);
    }

    await runPolishIfDirty();

    const complete = autoOn ? true : await isCoverageComplete(deps.repo, book.id, cutoff);
    return { codex, coveredUptoIdx, complete, versionMismatch };
  });
}
