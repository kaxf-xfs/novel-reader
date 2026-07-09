import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { InMemoryBookRepository } from '../../import/repository';
import { askBookMessages, storySoFarMessages, characterMessages, buildReadContext } from '../companion';

describe('prompt builders', () => {
  it('askBookMessages embeds question + forbids spoilers', () => {
    const m = askBookMessages('CTX', '主角叫什么？');
    expect(m[0].role).toBe('system');
    expect(m[0].content).toMatch(/不.*剧透|尚未读到|已读/);
    expect(m[m.length - 1].content).toContain('主角叫什么？');
    expect(m[m.length - 1].content).toContain('CTX');
  });
  it('storySoFarMessages is a recap prompt over the context', () => {
    const m = storySoFarMessages('CTX');
    expect(m[0].content).toMatch(/回顾|前情/);
    expect(m[m.length - 1].content).toContain('CTX');
  });
  it('characterMessages embeds the name', () => {
    const m = characterMessages('CTX', '张三');
    expect(m[m.length - 1].content).toContain('张三');
  });
});

describe('buildReadContext (spoiler-safe)', () => {
  it('summarizes only 0..cur-1 and slices the current chapter to the read offset', async () => {
    const repo = new InMemoryBookRepository();
    const fs = new FakeFileGateway();
    const chapters = Array.from({ length: 5 }, (_, i) => ({ title: `第${i + 1}章`, body: `正文${i + 1}` }));
    const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
    const chapterRecords = await repo.getChapters('b1');
    const chat = jest.fn(async () => 'SUM');

    const { contextText, includedChapterIdx } = await buildReadContext(
      { chat, fs, repo },
      { book, chapters: chapterRecords, currentChapterIndex: 3, currentBlockIndex: 0, model: 'm' },
    );

    // summaries only for chapters 0,1,2
    expect((await repo.listSummaries('b1', 0, 100)).map((s) => s.idx)).toEqual([0, 1, 2]);
    expect(await repo.getSummary('b1', 0, 3)).toBeNull();
    // included chapter idx never exceeds cutoff (2)
    expect(Math.max(...includedChapterIdx, -1)).toBeLessThanOrEqual(2);
    // current chapter (index 3) title appears via the read slice
    expect(contextText).toContain('第4章');
  });

  it('handles reading the very first chapter (cutoff -1, no summaries)', async () => {
    const repo = new InMemoryBookRepository();
    const fs = new FakeFileGateway();
    const book = await seedReader(repo, fs, { bookId: 'b1', chapters: [{ title: '第1章', body: '开头' }] });
    const chapterRecords = await repo.getChapters('b1');
    const chat = jest.fn(async () => 'SUM');
    const { includedChapterIdx } = await buildReadContext(
      { chat, fs, repo },
      { book, chapters: chapterRecords, currentChapterIndex: 0, currentBlockIndex: 0, model: 'm' },
    );
    expect(chat).not.toHaveBeenCalled();
    expect(includedChapterIdx).toEqual([]);
  });
});
