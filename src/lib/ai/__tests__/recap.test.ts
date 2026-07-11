import { isRecapDue, buildResumeRecap, generateRecentRecap, recapMessages } from '../recap';
import { SUMMARY_PROMPT_VERSION } from '../summarize';
import { InMemoryBookRepository, type BookRecord, type ChapterRecord } from '../../import/repository';
import type { ChatMessage } from '../client';

const DAY = 86_400_000;
describe('isRecapDue', () => {
  const now = 10_000 * DAY;
  test('间隔 ≥ gapDays 且有进度 → true', () => {
    expect(isRecapDue({ lastReadAt: now - 8 * DAY, now, gapDays: 7, currentChapterIndex: 5 })).toBe(true);
  });
  test('间隔不足 → false', () => {
    expect(isRecapDue({ lastReadAt: now - 3 * DAY, now, gapDays: 7, currentChapterIndex: 5 })).toBe(false);
  });
  test('currentChapterIndex=0（无前情）→ false', () => {
    expect(isRecapDue({ lastReadAt: now - 30 * DAY, now, gapDays: 7, currentChapterIndex: 0 })).toBe(false);
  });
  test('lastReadAt=null → false', () => {
    expect(isRecapDue({ lastReadAt: null, now, gapDays: 7, currentChapterIndex: 5 })).toBe(false);
  });
  test('gapDays=0 → 只要有进度即 true', () => {
    expect(isRecapDue({ lastReadAt: now, now, gapDays: 0, currentChapterIndex: 5 })).toBe(true);
    expect(isRecapDue({ lastReadAt: now, now, gapDays: 0, currentChapterIndex: 0 })).toBe(false);
  });
});

const MODEL = 'deepseek-chat';
function cachedSummary(repo: InMemoryBookRepository, bookId: string, idx: number, model = MODEL, pv = SUMMARY_PROMPT_VERSION) {
  return repo.putSummary({ bookId, level: 0, idx, model, promptVersion: pv, summary: `第${idx}章要点`, createdAt: 1 });
}

describe('recapMessages', () => {
  test('system 提示含防剧透与 2-3 句约束', () => {
    const m = recapMessages(['a', 'b']);
    expect(m[0].role).toBe('system');
    expect(m[0].content).toContain('不得剧透');
    expect(m[1].content).toContain('a');
  });
});

describe('buildResumeRecap（缓存路径）', () => {
  test('近窗命中≥阈值 → 合成 text，且只发 idx≤cutoff 的摘要', async () => {
    const repo = new InMemoryBookRepository();
    // cur=10 → cutoff=9；缓存 5..9（含）+ 一个越界 10 用来验证不外发
    for (let i = 5; i <= 10; i++) await cachedSummary(repo, 'b1', i);
    let sent: ChatMessage[] = [];
    const chat = async (msgs: ChatMessage[]) => { sent = msgs; return '合成回顾'; };
    const r = await buildResumeRecap({ chat, repo }, { bookId: 'b1', currentChapterIndex: 10, model: MODEL });
    expect(r).toEqual({ kind: 'text', text: '合成回顾' });
    // 断言：user 消息里不含「第10章」（越界），含「第9章」
    expect(sent[1].content).toContain('第9章要点');
    expect(sent[1].content).not.toContain('第10章要点');
  });

  test('近窗命中不足 → needs-generation（不调用 chat）', async () => {
    const repo = new InMemoryBookRepository();
    await cachedSummary(repo, 'b1', 0); // 远处 1 条，近窗 0 命中
    const chat = jest.fn(async () => 'x');
    const r = await buildResumeRecap({ chat, repo }, { bookId: 'b1', currentChapterIndex: 30, model: MODEL });
    expect(r).toEqual({ kind: 'needs-generation' });
    expect(chat).not.toHaveBeenCalled();
  });

  test('model/promptVersion 不匹配算未命中', async () => {
    const repo = new InMemoryBookRepository();
    for (let i = 5; i <= 9; i++) await cachedSummary(repo, 'b1', i, 'old-model');
    const chat = jest.fn(async () => 'x');
    const r = await buildResumeRecap({ chat, repo }, { bookId: 'b1', currentChapterIndex: 10, model: MODEL });
    expect(r).toEqual({ kind: 'needs-generation' });
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('generateRecentRecap（有界回填）', () => {
  const book = { id: 'b1', normalizedPath: '/x' } as BookRecord;
  const chapters: ChapterRecord[] = Array.from({ length: 40 }, (_, i) => ({
    bookId: 'b1', index: i, title: `T${i}`, level: 0 as const, byteStart: i, byteEnd: i + 1,
  }));
  // readChapterText 用 fs.readRange(path, start, end) → bytes → utf8；首行为标题
  const fs = { readRange: async (_p: string, s: number, _e: number) => Buffer.from(`T\n正文${s}`, 'utf8') } as any;

  test('只回填 recent 内缺失章、报进度、合成 → 不碰 ≥cutoff', async () => {
    const repo = new InMemoryBookRepository();
    const chat = async (msgs: ChatMessage[]) =>
      msgs[0].content.includes('前情回顾') ? '最终回顾' : '章摘要';
    const progress: Array<[number, number]> = [];
    const text = await generateRecentRecap(
      { chat, fs, repo },
      { book, chapters, currentChapterIndex: 30, model: MODEL, windowChapters: 6,
        onProgress: (d, t) => progress.push([d, t]) },
    );
    expect(text).toBe('最终回顾');
    // cutoff=29，window=6 → recent=[24..29]，全缺失 → 落库这 6 条
    const cached = await repo.listSummaries('b1', 0, 100);
    expect(cached.map((s) => s.idx).sort((a, b) => a - b)).toEqual([24, 25, 26, 27, 28, 29]);
    expect(cached.every((s) => s.idx <= 29)).toBe(true);
    expect(progress[progress.length - 1]).toEqual([6, 6]);
  });

  test('已缓存的 recent 章不重复回填', async () => {
    const repo = new InMemoryBookRepository();
    for (let i = 24; i <= 27; i++) await cachedSummary(repo, 'b1', i);
    let chapterCalls = 0;
    const chat = async (msgs: ChatMessage[]) => {
      if (msgs[0].content.includes('前情回顾')) return '最终回顾';
      chapterCalls++; return '章摘要';
    };
    await generateRecentRecap({ chat, fs, repo }, { book, chapters, currentChapterIndex: 30, model: MODEL, windowChapters: 6 });
    expect(chapterCalls).toBe(2); // 只有 28、29 需要回填
  });
});
