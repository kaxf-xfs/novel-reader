import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { InMemoryBookRepository } from '../../import/repository';
import { AiError, type ChatMessage, type ChatResult } from '../client';
import { CODEX_PROMPT_VERSION, ensureCodex, __resetCodexLocks } from '../ensureCodex';

function fakeCodexChat(): jest.Mock<Promise<ChatResult>, [ChatMessage[], AbortSignal?]> {
  return jest.fn(async (_messages: ChatMessage[], _signal?: AbortSignal) => ({
    content: JSON.stringify({ characters: [{ name: '主角', identity: ['少年'] }], terms: [], relations: [] }),
    finishReason: 'stop',
  }));
}

function defaultPolishChat(): jest.Mock<Promise<ChatResult>, [ChatMessage[], AbortSignal?]> {
  return jest.fn(async (_messages: ChatMessage[], _signal?: AbortSignal) => ({ content: '{}', finishReason: 'stop' }));
}

async function setup(chapterCount: number) {
  const repo = new InMemoryBookRepository();
  const fs = new FakeFileGateway();
  const chapters = Array.from({ length: chapterCount }, (_, i) => ({ title: `第${i + 1}章`, body: `正文${i + 1}` }));
  const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
  const chapterRecords = await repo.getChapters('b1');
  return { repo, fs, book, chapters: chapterRecords };
}

beforeEach(() => __resetCodexLocks());

describe('ensureCodex', () => {
  it('autoOn=true: backfills summaries then extracts to cutoff, complete=true, persists a codex row', async () => {
    const { repo, fs, book, chapters } = await setup(20);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const res = await ensureCodex(
      { chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo },
      { book, chapters, cutoff: 19, model: 'm', autoOn: true },
    );
    expect(res.coveredUptoIdx).toBe(19);
    expect(res.complete).toBe(true);
    expect(res.codex.characters.map((c) => c.name)).toContain('主角');
    const stored = await repo.getCodex('b1');
    expect(stored?.coveredUptoIdx).toBe(19);
  });

  it('autoOn=false: stops at the first summary gap (contiguous frontier only), complete=false when cutoff has a missing summary', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 0, model: 'm', promptVersion: 'v2', summary: 's0', createdAt: 1 });
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 2, model: 'm', promptVersion: 'v2', summary: 's2', createdAt: 1 });
    // idx 1,3..9 缺失（cutoff=9）
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const res = await ensureCodex(
      { chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: false },
    );
    expect(res.complete).toBe(false);
    // idx 1 缺失，扫描在 coveredUptoIdx+1=0 之后的 1 处遇到缺口即停，idx 2 不会被跳跃纳入，
    // 避免 coveredUptoIdx 越过缺口造成 idx 1 数据永久被跳过（且日后 complete 误报 true）。
    expect(res.coveredUptoIdx).toBe(0);
    expect(summarizeChat).not.toHaveBeenCalled(); // autoOn=false 不做章摘要保底
  });

  it('regression: a later-filled gap is picked up (no permanent stranding) once the call is repeated', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 0, model: 'm', promptVersion: 'v2', summary: 's0', createdAt: 1 });
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 2, model: 'm', promptVersion: 'v2', summary: 's2', createdAt: 1 });
    // idx 1 缺失（cutoff=9），其余 3..9 也缺失
    const summarizeChat = jest.fn(async () => 'S');
    let callCount = 0;
    const chat = jest.fn(async (_messages: ChatMessage[], _signal?: AbortSignal): Promise<ChatResult> => {
      callCount += 1;
      return {
        content: JSON.stringify({ characters: [{ name: `角色${callCount}`, identity: ['少年'] }], terms: [], relations: [] }),
        finishReason: 'stop',
      };
    });

    const first = await ensureCodex(
      { chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: false },
    );
    expect(first.coveredUptoIdx).toBe(0); // 卡在缺口前，未被 bug 跳过纳入 idx 2
    const firstCallCount = callCount;

    // 缺口被补上：idx 1 的摘要现在也缓存好了。
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 1, model: 'm', promptVersion: 'v2', summary: 's1', createdAt: 1 });

    const second = await ensureCodex(
      { chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: false },
    );
    // 缺口补上后，第二次调用应从 coveredUptoIdx+1=1 起连续纳入 1、2，越过原先卡住的位置。
    expect(second.coveredUptoIdx).toBeGreaterThanOrEqual(2);
    expect(callCount).toBeGreaterThan(firstCallCount); // 确实发起了新的抽取调用，而不是被误判为已覆盖
    // 合并后的图鉴应包含跨越缺口后新抽取出的角色，证明缺口章节的数据被真正抽取纳入，而非被静默跳过。
    const names = second.codex.characters.map((c) => c.name);
    expect(names.length).toBeGreaterThan(first.codex.characters.length);
  });

  it('version tolerance: a model/promptVersion mismatch does not wipe the existing codex, only extends it', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    await repo.putCodex({
      bookId: 'b1', coveredUptoIdx: 4, model: 'OLD', promptVersion: 'v0',
      json: JSON.stringify({ characters: [{ name: '老角色', aliases: [], identity: [], groups: [], firstChapterIdx: 0 }], terms: [], relations: [] }),
      updatedAt: 1,
    });
    for (let i = 5; i <= 9; i++) {
      await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: 'v2', summary: `s${i}`, createdAt: 1 });
    }
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat(); // 会产出「主角」
    const res = await ensureCodex(
      { chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo },
      { book, chapters, cutoff: 9, model: 'NEW', autoOn: false },
    );
    expect(res.versionMismatch).toBe(true);
    expect(res.codex.characters.map((c) => c.name).sort()).toEqual(['主角', '老角色']); // 旧数据保留，新数据追加
    expect(res.coveredUptoIdx).toBe(9);
  });

  it('forceRebuild=true starts fresh, ignoring the previously persisted codex', async () => {
    const { repo, fs, book, chapters } = await setup(5);
    await repo.putCodex({
      bookId: 'b1', coveredUptoIdx: 4, model: 'OLD', promptVersion: 'v0',
      json: JSON.stringify({ characters: [{ name: '老角色', aliases: [], identity: [], groups: [], firstChapterIdx: 0 }], terms: [], relations: [] }),
      updatedAt: 1,
    });
    for (let i = 0; i <= 4; i++) {
      await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: 'v2', summary: `s${i}`, createdAt: 1 });
    }
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const res = await ensureCodex(
      { chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo },
      { book, chapters, cutoff: 4, model: 'NEW', autoOn: false, forceRebuild: true },
    );
    expect(res.versionMismatch).toBe(false); // forceRebuild 视作从零开始，无「已存版本」可比
    expect(res.codex.characters.map((c) => c.name)).toEqual(['主角']); // 「老角色」不再是「已缓存」输入，未被重新纳入
  });

  it('checkpoints: persists incrementally (more than once) across multiple batches, not only at the end', async () => {
    const { repo, fs, book, chapters } = await setup(120); // 120 章 / 15 每块 = 8 块 / 5 块每检查点 → 2 次落库
    const putSpy = jest.spyOn(repo, 'putCodex');
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    await ensureCodex(
      { chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo },
      { book, chapters, cutoff: 119, model: 'm', autoOn: true },
    );
    expect(putSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('cancellation: an aborted signal rejects with AiError(cancelled) but keeps checkpoints already persisted', async () => {
    const { repo, fs, book, chapters } = await setup(120);
    const ctrl = new AbortController();
    const summarizeChat = jest.fn(async () => 'S');
    let batchCount = 0;
    const chat = jest.fn(async (): Promise<ChatResult> => {
      batchCount += 1;
      if (batchCount === 6) ctrl.abort(); // 第一个检查点（5 块）刚提交完，第 6 块请求时取消
      return { content: JSON.stringify({ characters: [], terms: [], relations: [] }), finishReason: 'stop' };
    });
    await expect(
      ensureCodex(
        { chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo },
        { book, chapters, cutoff: 119, model: 'm', autoOn: true, signal: ctrl.signal },
      ),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    const stored = await repo.getCodex('b1');
    expect(stored?.coveredUptoIdx).toBeGreaterThanOrEqual(0); // 第一个检查点已经落库，没有整体回滚
    expect(stored?.coveredUptoIdx).toBeLessThan(119); // 但确实没跑完
  });

  // Real-device freeze fix: the checkpoint loop used to re-fetch EACH chapter's
  // summary individually via repo.getSummary() (up to CHECKPOINT_EVERY_BLOCKS *
  // BLOCK_SIZE = 75 separate native-bridge round-trips per checkpoint), even
  // though a single bulk repo.listSummaries() call already had every needed
  // summary in memory. It must now build the codex blocks from that in-memory
  // map instead, issuing zero repo.getSummary() calls.
  it('builds checkpoint blocks from one bulk-fetched summary map, never calling getSummary() per chapter', async () => {
    const CHAPTER_COUNT = 200; // 200 / 15 per block = 14 blocks / 5 per checkpoint → multiple checkpoints
    const { repo, fs, book, chapters } = await setup(CHAPTER_COUNT);
    for (let i = 0; i < CHAPTER_COUNT; i++) {
      await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: 'v2', summary: `s${i}`, createdAt: 1 });
    }
    const getSummarySpy = jest.spyOn(repo, 'getSummary');
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const res = await ensureCodex(
      { chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo },
      { book, chapters, cutoff: CHAPTER_COUNT - 1, model: 'm', autoOn: false },
    );
    expect(res.coveredUptoIdx).toBe(CHAPTER_COUNT - 1);
    expect(res.complete).toBe(true);
    expect(getSummarySpy).not.toHaveBeenCalled(); // was up to 200 calls before the fix, now 0
  });

  it('per-book lock serializes concurrent calls for the same book (no duplicated character from a lost update)', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat(); // 两次调用都会产出同一个「主角」
    const [a, b] = await Promise.all([
      ensureCodex({ chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo }, { book, chapters, cutoff: 9, model: 'm', autoOn: true }),
      ensureCodex({ chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo }, { book, chapters, cutoff: 9, model: 'm', autoOn: true }),
    ]);
    expect(b.codex.characters.filter((c) => c.name === '主角')).toHaveLength(1); // 串行执行下第二次是增量 no-op，不会产生重复
    expect(a.coveredUptoIdx).toBe(9);
    expect(b.coveredUptoIdx).toBe(9);
  });
});

function fakePolishChat(): jest.Mock<Promise<ChatResult>, [ChatMessage[], AbortSignal?]> {
  return jest.fn(async (_messages: ChatMessage[], _signal?: AbortSignal) => ({
    content: JSON.stringify({ bios: [{ name: '主角', bio: '整合后的简介' }] }),
    finishReason: 'stop',
  }));
}

describe('ensureCodex — polish integration', () => {
  it('runs polish once after catching up to cutoff (not per intermediate checkpoint)', async () => {
    const { repo, fs, book, chapters } = await setup(120); // 8 blocks / 5 per checkpoint → 2 checkpoints
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const polishChat = fakePolishChat();
    await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 119, model: 'm', autoOn: true },
    );
    // 主角每块都会重新被抽取出来（同名合并），但润色只应该在最终追上 cutoff 后跑一次，
    // 不是每个 checkpoint 跑一次——2 个 checkpoint 不应该产生 2 次或更多的润色调用。
    expect(polishChat).toHaveBeenCalledTimes(1);
  });

  it('a fully caught-up book with a dirty entity gets polished when re-run, without needing forceRebuild', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const polishChat = fakePolishChat();
    const first = await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: true },
    );
    expect(first.codex.characters.find((c) => c.name === '主角')?.bio?.[0].text).toBe('整合后的简介');
    expect(polishChat).toHaveBeenCalledTimes(1);

    // 重新打开（没有新章节，但没有任何新脏实体——上一次已经润色过了）：不应该再次调用。
    const second = await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: true },
    );
    expect(polishChat).toHaveBeenCalledTimes(1); // 仍是 1 次，没有额外的空转润色
    expect(second.coveredUptoIdx).toBe(9);
  });

  it('polish does not change coveredUptoIdx', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const polishChat = fakePolishChat();
    const res = await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: true },
    );
    expect(res.coveredUptoIdx).toBe(9); // 和没有润色时的行为一致，润色不推高也不压低覆盖进度
  });

  it('CODEX_PROMPT_VERSION is v2', () => {
    expect(CODEX_PROMPT_VERSION).toBe('v2');
  });

  it('version-mismatch (v1 -> v2) does not wipe existing bio-less codex; catch-up polish still runs and adds bio without a forceRebuild', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    await repo.putCodex({
      bookId: 'b1', coveredUptoIdx: 9, model: 'm', promptVersion: 'v1',
      json: JSON.stringify({
        characters: [{ name: '老角色', aliases: [], identity: [{ text: '旧碎片', idx: 3 }], groups: [], firstChapterIdx: 0 }],
        terms: [], relations: [],
      }),
      updatedAt: 1,
    });
    for (let i = 0; i <= 9; i++) {
      await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: 'v2', summary: `s${i}`, createdAt: 1 });
    }
    const summarizeChat = jest.fn(async () => 'S');
    const chat = jest.fn(async (): Promise<ChatResult> => ({ content: JSON.stringify({ characters: [], terms: [], relations: [] }), finishReason: 'stop' }));
    const polishChat = jest.fn(async () => ({ content: JSON.stringify({ bios: [{ name: '老角色', bio: '整合简介' }] }), finishReason: 'stop' }));
    const res = await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: false },
    );
    expect(res.versionMismatch).toBe(true);
    expect(res.codex.characters.find((c) => c.name === '老角色')?.bio?.[0].text).toBe('整合简介');
  });

  it('cancellation during polish does not partially persist (entity stays fully dirty, safe to retry)', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const ctrl = new AbortController();
    const polishChat = jest.fn(async (): Promise<ChatResult> => {
      ctrl.abort();
      throw new AiError('cancelled', 'AI 已取消');
    });
    await expect(
      ensureCodex(
        { chat, summarizeChat, polishChat, fs, repo },
        { book, chapters, cutoff: 9, model: 'm', autoOn: true, signal: ctrl.signal },
      ),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    const stored = await repo.getCodex('b1');
    // 抽取阶段已经落过盘（extraction checkpoint），但润色没跑完不应该产生半更新的 bio/hash 不一致状态；
    // 重新调用应该照常重新判定为脏并重试，不应报错或卡死。
    const retryPolishChat = fakePolishChat();
    const retry = await ensureCodex(
      { chat, summarizeChat, polishChat: retryPolishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: true },
    );
    expect(retry.codex.characters.find((c) => c.name === '主角')?.bio?.[0].text).toBe('整合后的简介');
  });
});
