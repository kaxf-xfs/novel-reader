/**
 * 增量 7 Task 3: background auto-summarize hook.
 *
 * As the reader advances through chapters, debounce ~4s and then backfill
 * missing/stale chapter (and completed-arc) summaries for a trailing window
 * via `ensureSummaries` — so the AI companion's map-reduce context stays warm
 * without ever blocking the reading UI. Anti-spoiler invariant is inherited
 * from `ensureSummaries`: cutoff = currentChapterIndex - 1, so only fully-read
 * chapters are ever summarized.
 *
 * Lifecycle rules:
 *  - Gated by `enabled && book && chapters && !restoring`.
 *  - Single-flight: a run in progress is never duplicated; if the chapter
 *    index advances again while a run is in flight, exactly one more run is
 *    queued for the newest cutoff once the in-flight run settles.
 *  - Failure backoff: N consecutive *real* failures stop further auto-runs
 *    for the current book. `AiError('cancelled')` (our own abort, e.g. from
 *    unmount/book-close) never counts toward the budget.
 *  - Unmount / closing the book (`book?.id` changes) / `enabled` flipping to
 *    false aborts any in-flight request and clears the pending debounce
 *    timer. Switching books also resets the failure budget and progress
 *    tracking so the new book gets a fresh start.
 */

import { useEffect, useRef } from 'react';

import type { FileGateway } from '../lib/import/importBook';
import type { BookRecord, BookRepository, ChapterRecord } from '../lib/import/repository';
import { AiError } from '../lib/ai/client';
import { ensureSummaries, type SummarizeFn } from '../lib/ai/summarize';

const DEBOUNCE_MS = 4000;
const BACKFILL_WINDOW = 30;
const MAX_CONSECUTIVE_FAILURES = 3;
const CONCURRENCY = 2;

export interface UseAutoSummarizeDeps {
  chat: SummarizeFn;
  fs: FileGateway;
  repo: BookRepository;
}

export interface UseAutoSummarizeParams {
  enabled: boolean;
  book: BookRecord | null;
  chapters: ChapterRecord[] | null;
  currentChapterIndex: number;
  restoring: boolean;
  model: string;
}

export function useAutoSummarize(deps: UseAutoSummarizeDeps, params: UseAutoSummarizeParams): void {
  const { enabled, book, chapters, currentChapterIndex, restoring } = params;

  // Always-fresh deps/model without re-subscribing effects on every render.
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const modelRef = useRef(params.model);
  modelRef.current = params.model;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const stoppedRef = useRef(false);
  const failCountRef = useRef(0);
  /** Highest cutoff a run has actually been started for (or -1). */
  const lastCutoffRef = useRef(-1);
  /** A newer cutoff that arrived while a run was in flight, to pick up once it settles. */
  const pendingCutoffRef = useRef<number | null>(null);
  const bookIdRef = useRef<string | null>(null);

  const attemptRun = (bk: BookRecord, chs: ChapterRecord[], cutoff: number): void => {
    if (stoppedRef.current) return;
    if (runningRef.current) {
      pendingCutoffRef.current = cutoff;
      return;
    }
    runningRef.current = true;
    lastCutoffRef.current = cutoff;
    const controller = new AbortController();
    abortRef.current = controller;
    const { chat, fs, repo } = depsRef.current;

    ensureSummaries(
      { chat, fs, repo },
      {
        book: bk,
        chapters: chs,
        cutoff,
        model: modelRef.current,
        fromIdx: Math.max(0, cutoff - BACKFILL_WINDOW),
        upgradeStale: true,
        concurrency: CONCURRENCY,
        signal: controller.signal,
      },
    )
      .catch((e: unknown) => {
        if (e instanceof AiError && e.kind === 'cancelled') return;
        failCountRef.current += 1;
        if (failCountRef.current >= MAX_CONSECUTIVE_FAILURES) stoppedRef.current = true;
      })
      .finally(() => {
        runningRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
        const nextCutoff = pendingCutoffRef.current;
        pendingCutoffRef.current = null;
        if (!stoppedRef.current && nextCutoff !== null && nextCutoff > lastCutoffRef.current) {
          attemptRun(bk, chs, nextCutoff);
        }
      });
  };

  // Reset the per-book failure budget / progress tracking when the book
  // changes (including the initial null → id transition).
  useEffect(() => {
    const id = book?.id ?? null;
    if (id !== bookIdRef.current) {
      bookIdRef.current = id;
      stoppedRef.current = false;
      failCountRef.current = 0;
      lastCutoffRef.current = -1;
      pendingCutoffRef.current = null;
    }
  }, [book?.id]);

  // Debounce: schedule a run when the chapter index has advanced past what
  // was already run/scheduled.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!enabled || restoring || !book || !chapters || stoppedRef.current) return;

    const cutoff = currentChapterIndex - 1;
    if (cutoff < 0) return;
    if (cutoff <= lastCutoffRef.current) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      attemptRun(book, chapters, cutoff);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, currentChapterIndex, restoring, book, chapters]);

  // Abort any in-flight request (and drop the pending timer) on unmount, on
  // closing the book, or when auto-summarize is turned off.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, book?.id]);
}
