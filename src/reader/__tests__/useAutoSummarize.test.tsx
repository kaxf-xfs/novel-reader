import { renderHook, act } from '@testing-library/react-native';

import { FakeFileGateway, seedReader } from '../../test-utils/fakes';
import { InMemoryBookRepository } from '../../lib/import/repository';
import type { BookRecord, ChapterRecord } from '../../lib/import/repository';
import { AiError, type ChatMessage } from '../../lib/ai/client';
import { useAutoSummarize } from '../useAutoSummarize';

async function setup(chapterCount: number) {
  const repo = new InMemoryBookRepository();
  const fs = new FakeFileGateway();
  const chapters = Array.from({ length: chapterCount }, (_, i) => ({
    title: `第${i + 1}章`,
    body: `正文${i + 1}`,
  }));
  const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
  const chapterRecords = await repo.getChapters('b1');
  return { repo, fs, book, chapters: chapterRecords };
}

interface HookProps {
  chat: (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;
  fs: FakeFileGateway;
  repo: InMemoryBookRepository;
  enabled: boolean;
  book: BookRecord | null;
  chapters: ChapterRecord[] | null;
  currentChapterIndex: number;
  restoring: boolean;
  model: string;
}

function renderAutoSummarize(initial: HookProps) {
  return renderHook((props: HookProps) =>
    useAutoSummarize(
      { chat: props.chat, fs: props.fs, repo: props.repo },
      {
        enabled: props.enabled,
        book: props.book,
        chapters: props.chapters,
        currentChapterIndex: props.currentChapterIndex,
        restoring: props.restoring,
        model: props.model,
      },
    ),
  { initialProps: initial });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useAutoSummarize', () => {
  it('advancing chapters while not restoring triggers ensureSummaries after the debounce', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const chat = jest.fn(async () => 'S');

    const { rerender } = renderAutoSummarize({
      chat, fs, repo, enabled: true, book, chapters, currentChapterIndex: 0, restoring: false, model: 'm',
    });

    expect(chat).not.toHaveBeenCalled();

    await act(async () => {
      rerender({
        chat, fs, repo, enabled: true, book, chapters, currentChapterIndex: 3, restoring: false, model: 'm',
      });
    });

    // Not yet — debounce hasn't elapsed.
    expect(chat).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(4000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(chat).toHaveBeenCalled();
    // cutoff = currentChapterIndex(3) - 1 = 2 → chapters 0,1,2 summarized.
    const stored = await repo.listSummaries('b1', 0, 100);
    expect(stored.map((s) => s.idx).sort()).toEqual([0, 1, 2]);
  });

  it('restoring=true never triggers a run', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const chat = jest.fn(async () => 'S');

    const { rerender } = renderAutoSummarize({
      chat, fs, repo, enabled: true, book, chapters, currentChapterIndex: 0, restoring: true, model: 'm',
    });

    await act(async () => {
      rerender({
        chat, fs, repo, enabled: true, book, chapters, currentChapterIndex: 5, restoring: true, model: 'm',
      });
    });

    await act(async () => {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(chat).not.toHaveBeenCalled();
  });

  it('enabled=false never triggers a run', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const chat = jest.fn(async () => 'S');

    const { rerender } = renderAutoSummarize({
      chat, fs, repo, enabled: false, book, chapters, currentChapterIndex: 0, restoring: false, model: 'm',
    });

    await act(async () => {
      rerender({
        chat, fs, repo, enabled: false, book, chapters, currentChapterIndex: 5, restoring: false, model: 'm',
      });
    });

    await act(async () => {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(chat).not.toHaveBeenCalled();
  });

  it('stops auto-running after N consecutive real failures, but cancelled errors do not count', async () => {
    // Exactly 2 chapters means every attempt's missing-window is deterministic
    // (both chapters, since neither ever succeeds while `mode !== 'ok'`) —
    // concurrency is 2, so each attempt issues exactly 2 chat() calls, and
    // (crucially) exactly ONE failure-budget increment per attempt, since the
    // budget counts ensureSummaries() rejections, not raw chat() calls.
    const { repo, fs, book, chapters } = await setup(2);
    let mode: 'cancel' | 'fail' | 'ok' = 'cancel';
    const chat = jest.fn(async () => {
      if (mode === 'cancel') throw new AiError('cancelled', 'aborted');
      if (mode === 'fail') throw new AiError('network', 'boom');
      return 'S';
    });

    const flush = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };

    let index = 3;
    const { rerender } = renderAutoSummarize({
      chat, fs, repo, enabled: true, book, chapters, currentChapterIndex: index, restoring: false, model: 'm',
    });

    const advance = async () => {
      index += 3;
      await act(async () => {
        rerender({
          chat, fs, repo, enabled: true, book, chapters, currentChapterIndex: index, restoring: false, model: 'm',
        });
      });
      await act(async () => {
        jest.advanceTimersByTime(4000);
        await flush();
      });
    };

    // Two cancelled attempts — must NOT count toward the failure budget.
    mode = 'cancel';
    await advance();
    await advance();
    expect(chat).toHaveBeenCalledTimes(4); // 2 attempts x 2 chapters, all cancelled

    // Three real failures hit the N=3 threshold and set stoppedRef.
    mode = 'fail';
    await advance();
    await advance();
    await advance();
    expect(chat).toHaveBeenCalledTimes(10); // +3 attempts x 2 chapters = 6 more

    // Further advances no longer trigger any run, even though chat would now
    // succeed — proves it actually stopped (not just still failing).
    mode = 'ok';
    await advance();
    await advance();
    expect(chat).toHaveBeenCalledTimes(10);
    expect(await repo.listSummaries('b1', 0, 100)).toEqual([]);
  });
});
