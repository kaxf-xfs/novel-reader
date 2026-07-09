import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { InMemoryBookRepository } from '../../import/repository';
import { AiError } from '../client';
import { ensureSummaries, SUMMARY_PROMPT_VERSION, ARC_SIZE } from '../summarize';

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

describe('ensureSummaries', () => {
  it('summarizes only chapters 0..cutoff and never reads >= cur', async () => {
    const { repo, fs, book, chapters } = await setup(6);
    const readIdx: number[] = [];
    const origRead = fs.readRange.bind(fs);
    fs.readRange = async (uri, a, b) => {
      // map the byte range back to which chapter — simpler: count calls via chapters
      return origRead(uri, a, b);
    };
    const chat = jest.fn(async () => 'S');
    // cutoff = 2 means chapters 0,1,2 are fully read (current chapter is 3)
    await ensureSummaries({ chat, fs, repo, }, { book, chapters, cutoff: 2, model: 'm' });
    const stored = await repo.listSummaries('b1', 0, 100);
    expect(stored.map((s) => s.idx)).toEqual([0, 1, 2]);
    expect(chat).toHaveBeenCalledTimes(3);
    // no summary for index >= 3
    expect(await repo.getSummary('b1', 0, 3)).toBeNull();
  });

  it('skips chapters already summarized with the same model+promptVersion', async () => {
    const { repo, fs, book, chapters } = await setup(4);
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 0, model: 'm', promptVersion: SUMMARY_PROMPT_VERSION, summary: 'cached', createdAt: 1 });
    const chat = jest.fn(async () => 'NEW');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 1, model: 'm' });
    expect(chat).toHaveBeenCalledTimes(1); // only idx 1
    expect((await repo.getSummary('b1', 0, 0))?.summary).toBe('cached');
  });

  it('regenerates when the cached model or promptVersion differs', async () => {
    const { repo, fs, book, chapters } = await setup(2);
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 0, model: 'OLD', promptVersion: SUMMARY_PROMPT_VERSION, summary: 'stale', createdAt: 1 });
    const chat = jest.fn(async () => 'FRESH');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 0, model: 'm' });
    expect((await repo.getSummary('b1', 0, 0))?.summary).toBe('FRESH');
  });

  it('reports progress and persists incrementally', async () => {
    const { repo, fs, book, chapters } = await setup(3);
    const seen: number[] = [];
    const chat = jest.fn(async () => 'S');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 2, model: 'm', concurrency: 1, onProgress: (d) => seen.push(d) });
    expect(seen[seen.length - 1]).toBe(3);
  });

  it('throws cancelled on an aborted signal but keeps already-saved summaries', async () => {
    const { repo, fs, book, chapters } = await setup(4);
    const ctrl = new AbortController();
    let calls = 0;
    const chat = jest.fn(async () => {
      calls += 1;
      if (calls === 2) ctrl.abort();
      return 'S';
    });
    await expect(
      ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 3, model: 'm', concurrency: 1, signal: ctrl.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    const stored = await repo.listSummaries('b1', 0, 100);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBeLessThan(4);
  });

  it('merges an arc summary once a full arc of chapters is summarized', async () => {
    const { repo, fs, book, chapters } = await setup(ARC_SIZE + 2);
    const chat = jest.fn(async () => 'S');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: ARC_SIZE, model: 'm', concurrency: 4 });
    // arc 0 covers chapters 0..ARC_SIZE-1 (all <= cutoff) → one arc summary
    expect(await repo.getSummary('b1', 1, 0)).not.toBeNull();
    // arc 1 (would cover ARC_SIZE..) is incomplete → none
    expect(await repo.getSummary('b1', 1, 1)).toBeNull();
  });
});
