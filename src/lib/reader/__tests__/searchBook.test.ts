import { InMemoryBookRepository } from '../../import/repository';
import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { searchBook } from '../searchBook';

async function setup(chapters: { title: string; body: string }[]) {
  const repo = new InMemoryBookRepository();
  const fs = new FakeFileGateway();
  const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
  return { fs, normalizedPath: book.normalizedPath, chapters: await repo.getChapters('b1') };
}

describe('searchBook', () => {
  it('finds a body match with the right chapter/block and a snippet', async () => {
    const { fs, normalizedPath, chapters } = await setup([
      { title: '第一章 起', body: '风平浪静的一天。' },
      { title: '第二章 战', body: '他周身腾起一层剑气，直逼面门。' },
      { title: '第三章 终', body: '尘埃落定。' },
    ]);
    const { results, capped } = await searchBook({ fs, normalizedPath, chapters, term: '剑气' });
    expect(capped).toBe(false);
    expect(results).toHaveLength(1);
    expect(results[0].chapterIndex).toBe(1);
    expect(results[0].blockIndex).toBe(1); // body block (0 = title)
    expect(results[0].chapterTitle).toBe('第二章 战');
    expect(results[0].snippet).toContain('剑气');
  });

  it('does not match on chapter titles (only body blocks)', async () => {
    const { fs, normalizedPath, chapters } = await setup([
      { title: '第一章 剑气纵横', body: '毫无关系的一段。' },
    ]);
    const { results } = await searchBook({ fs, normalizedPath, chapters, term: '剑气' });
    expect(results).toHaveLength(0);
  });

  it('returns empty for a blank term', async () => {
    const { fs, normalizedPath, chapters } = await setup([{ title: '第一章', body: '内容' }]);
    expect(await searchBook({ fs, normalizedPath, chapters, term: '   ' })).toEqual({
      results: [],
      capped: false,
    });
  });

  it('caps results and reports capped=true', async () => {
    const chapters = Array.from({ length: 5 }, (_, i) => ({
      title: `第${i + 1}章`,
      body: '这里有剑气。',
    }));
    const { fs, normalizedPath, chapters: chs } = await setup(chapters);
    const { results, capped } = await searchBook({ fs, normalizedPath, chapters: chs, term: '剑气', cap: 3 });
    expect(results).toHaveLength(3);
    expect(capped).toBe(true);
  });
});
