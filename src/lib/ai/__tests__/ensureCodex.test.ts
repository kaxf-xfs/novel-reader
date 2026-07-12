import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { InMemoryBookRepository } from '../../import/repository';
import type { ChatMessage, ChatResult } from '../client';
import { ensureCodex, __resetCodexLocks } from '../ensureCodex';

function fakeCodexChat(): jest.Mock<Promise<ChatResult>, [ChatMessage[], AbortSignal?]> {
  return jest.fn(async (_messages: ChatMessage[], _signal?: AbortSignal) => ({
    content: JSON.stringify({ characters: [{ name: '主角', identity: ['少年'] }], terms: [], relations: [] }),
    finishReason: 'stop',
  }));
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
      { chat, summarizeChat, fs, repo },
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
      { chat, summarizeChat, fs, repo },
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
      { chat, summarizeChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: false },
    );
    expect(first.coveredUptoIdx).toBe(0); // 卡在缺口前，未被 bug 跳过纳入 idx 2
    const firstCallCount = callCount;

    // 缺口被补上：idx 1 的摘要现在也缓存好了。
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 1, model: 'm', promptVersion: 'v2', summary: 's1', createdAt: 1 });

    const second = await ensureCodex(
      { chat, summarizeChat, fs, repo },
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
      { chat, summarizeChat, fs, repo },
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
      { chat, summarizeChat, fs, repo },
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
      { chat, summarizeChat, fs, repo },
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
        { chat, summarizeChat, fs, repo },
        { book, chapters, cutoff: 119, model: 'm', autoOn: true, signal: ctrl.signal },
      ),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    const stored = await repo.getCodex('b1');
    expect(stored?.coveredUptoIdx).toBeGreaterThanOrEqual(0); // 第一个检查点已经落库，没有整体回滚
    expect(stored?.coveredUptoIdx).toBeLessThan(119); // 但确实没跑完
  });

  it('per-book lock serializes concurrent calls for the same book (no duplicated character from a lost update)', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat(); // 两次调用都会产出同一个「主角」
    const [a, b] = await Promise.all([
      ensureCodex({ chat, summarizeChat, fs, repo }, { book, chapters, cutoff: 9, model: 'm', autoOn: true }),
      ensureCodex({ chat, summarizeChat, fs, repo }, { book, chapters, cutoff: 9, model: 'm', autoOn: true }),
    ]);
    expect(b.codex.characters.filter((c) => c.name === '主角')).toHaveLength(1); // 串行执行下第二次是增量 no-op，不会产生重复
    expect(a.coveredUptoIdx).toBe(9);
    expect(b.coveredUptoIdx).toBe(9);
  });
});
