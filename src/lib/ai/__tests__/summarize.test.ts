import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { InMemoryBookRepository } from '../../import/repository';
import { AiError, type ChatMessage } from '../client';
import { ensureSummaries, chapterSummaryMessages, SUMMARY_PROMPT_VERSION, ARC_SIZE } from '../summarize';

describe('chapterSummaryMessages prompt v2', () => {
  it('章摘要 prompt v2 覆盖身世/伏笔且版本为 v2', () => {
    expect(SUMMARY_PROMPT_VERSION).toBe('v2');
    const sys = chapterSummaryMessages('标题', '正文')[0].content;
    expect(sys).toContain('身世');
    expect(sys).toContain('伏笔');
  });
});

/** Wraps a fake chat fn to record which chapter idx (0-based, from the "第N章"
 * title embedded in the user message) each call summarized. */
function recordingChat(): { chat: jest.Mock<Promise<string>, [ChatMessage[], AbortSignal?]>; chapterIdx: number[] } {
  const chapterIdx: number[] = [];
  const chat = jest.fn(async (messages: ChatMessage[]) => {
    const userContent = typeof messages[1]?.content === 'string' ? messages[1].content : '';
    const m = /章节标题：第(\d+)章/.exec(userContent);
    if (m) chapterIdx.push(Number(m[1]) - 1);
    return 'S';
  });
  return { chat, chapterIdx };
}

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

  it('fromIdx>0 only backfills the window and never builds an arc', async () => {
    const { repo, fs, book, chapters } = await setup(40);
    const { chat, chapterIdx } = recordingChat();
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 39, fromIdx: 35, model: 'm' });
    expect(chapterIdx.slice().sort((a, b) => a - b)).toEqual([35, 36, 37, 38, 39]);
    expect(await repo.listSummaries('b1', 1, 999)).toEqual([]); // no arc merged
  });

  it('upgradeStale=false leaves stale-version summaries alone and only fills true gaps', async () => {
    const { repo, fs, book, chapters } = await setup(5);
    for (let i = 0; i <= 3; i++) {
      await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: 'v0', summary: 'old', createdAt: 1 });
    }
    const { chat, chapterIdx } = recordingChat();
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 4, model: 'm', upgradeStale: false });
    expect(chapterIdx).toEqual([4]); // only the truly-missing chapter 4; 0..3 (stale) untouched
    for (let i = 0; i <= 3; i++) {
      expect((await repo.getSummary('b1', 0, i))?.summary).toBe('old');
    }
  });

  it('default fromIdx=0 + upgradeStale=true keeps the full-scan + arc behavior unchanged', async () => {
    const { repo, fs, book, chapters } = await setup(30); // ARC_SIZE=25 → arc 0 is complete
    const chat = jest.fn(async () => 'S');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 29, model: 'm' });
    expect((await repo.listSummaries('b1', 0, 999)).length).toBe(30);
    expect((await repo.listSummaries('b1', 1, 999)).map((s) => s.idx)).toEqual([0]); // arc 0 built
  });

  // 弧级也受 upgradeStale 门控——否则版本 bump 后深读用户首次问书会触发大量弧重合并。
  async function seedFullArc(repo: InMemoryBookRepository, arcModel: string) {
    for (let i = 0; i <= ARC_SIZE; i++) {
      await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: SUMMARY_PROMPT_VERSION, summary: `c${i}`, createdAt: 1 });
    }
    await repo.putSummary({ bookId: 'b1', level: 1, idx: 0, model: arcModel, promptVersion: SUMMARY_PROMPT_VERSION, summary: 'OLD_ARC', createdAt: 1 });
  }

  it('upgradeStale=false leaves a stale-version arc summary un-remerged', async () => {
    const { repo, fs, book, chapters } = await setup(ARC_SIZE + 2);
    await seedFullArc(repo, 'OLD'); // arc 0 from an old model
    const chat = jest.fn(async () => 'REMERGED');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: ARC_SIZE, model: 'm', upgradeStale: false });
    expect(chat).not.toHaveBeenCalled(); // no chapter re-summary AND no arc re-merge
    expect((await repo.getSummary('b1', 1, 0))?.summary).toBe('OLD_ARC');
  });

  it('upgradeStale=true (default) does re-merge a stale-version arc summary', async () => {
    const { repo, fs, book, chapters } = await setup(ARC_SIZE + 2);
    await seedFullArc(repo, 'OLD');
    const chat = jest.fn(async () => 'REMERGED');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: ARC_SIZE, model: 'm' });
    expect(chat).toHaveBeenCalledTimes(1); // chapters all cached → only the arc re-merge
    expect((await repo.getSummary('b1', 1, 0))?.summary).toBe('REMERGED');
  });

  // Real-device freeze fix: the missing-chapter scan used to issue one
  // repo.getSummary() native-bridge round-trip PER CHAPTER (sequential,
  // unbounded by count) before doing any real work. It must now do a single
  // bulk repo.listSummaries() call instead. This test seeds a large,
  // fully-cached book (chapters + complete arcs, all matching model/version)
  // and asserts repo.getSummary() is never called at all — both phase 1
  // (missing-chapter scan) and phase 2 (arc-merge existence check + per-
  // chapter arc-part lookup) now go through bulk listSummaries() + Map
  // lookups instead.
  it('scans missing chapters via one bulk listSummaries() call, not one getSummary() per chapter', async () => {
    const CHAPTER_COUNT = 200;
    const { repo, fs, book, chapters } = await setup(CHAPTER_COUNT);
    for (let i = 0; i < CHAPTER_COUNT; i++) {
      await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: SUMMARY_PROMPT_VERSION, summary: `s${i}`, createdAt: 1 });
    }
    const arcCount = Math.floor(CHAPTER_COUNT / ARC_SIZE);
    for (let arc = 0; arc < arcCount; arc++) {
      await repo.putSummary({ bookId: 'b1', level: 1, idx: arc, model: 'm', promptVersion: SUMMARY_PROMPT_VERSION, summary: `arc${arc}`, createdAt: 1 });
    }
    const listSummariesSpy = jest.spyOn(repo, 'listSummaries');
    const getSummarySpy = jest.spyOn(repo, 'getSummary');
    const chat = jest.fn(async () => 'S');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: CHAPTER_COUNT - 1, model: 'm' });
    expect(chat).not.toHaveBeenCalled(); // everything already cached with matching model/version — no work to do
    // 1 for phase 1's bulk chapter scan + 2 for phase 2 (bulk arc-existence
    // scan + bulk chapter-summary scan for building arc parts).
    expect(listSummariesSpy).toHaveBeenCalledTimes(3);
    // getSummary() (per-item native-bridge round trip) is no longer used by
    // either phase — everything goes through the bulk-fetched Maps.
    expect(getSummarySpy).not.toHaveBeenCalled();
  });

  // This is the test that would have caught Bug A before it shipped: a
  // first-ever run where NO arc summaries exist yet AND enough chapters span
  // multiple complete arcs. The old code did one getSummary(level 1, arc)
  // existence check per arc PLUS up to ARC_SIZE getSummary(level 0, c) calls
  // per arc needing a merge — for 3 complete arcs that's 3 + 3*ARC_SIZE
  // sequential native-bridge round trips. The fix replaces all of that with
  // two bulk listSummaries() calls + Map lookups, so getSummary() should
  // never be called by the arc-merge phase regardless of arc/chapter count.
  it('first run with multiple complete arcs and no prior arc summaries never calls getSummary()', async () => {
    const CHAPTER_COUNT = ARC_SIZE * 3 + 2;
    const { repo, fs, book, chapters } = await setup(CHAPTER_COUNT);
    // Pre-seed chapter-level summaries so phase 1 has nothing to do and only
    // phase 2 (arc merge) is exercised; no arc-level (level 1) summaries exist.
    for (let i = 0; i < CHAPTER_COUNT; i++) {
      await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: SUMMARY_PROMPT_VERSION, summary: `s${i}`, createdAt: 1 });
    }
    const getSummarySpy = jest.spyOn(repo, 'getSummary');
    const chat = jest.fn(async () => 'MERGED');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: CHAPTER_COUNT - 1, model: 'm' });
    expect(getSummarySpy).not.toHaveBeenCalled();
    // Sanity: the 3 complete arcs (0, 1, 2) did get merged.
    expect((await repo.listSummaries('b1', 1, 999)).map((s) => s.idx)).toEqual([0, 1, 2]);
    expect(chat).toHaveBeenCalledTimes(3);
  });
});
