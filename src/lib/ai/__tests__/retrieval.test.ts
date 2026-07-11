/**
 * 增量 7 Task 5: retrieval.ts — 关键词提取 + 章节小结打分 + 防剧透抽段。
 */

import { extractQueryTerms, scoreChapterSummaries, retrieveRelevantPassages } from '../retrieval';

describe('scoreChapterSummaries', () => {
  test('按命中降序、只含命中的条目', () => {
    const sums = [
      { idx: 0, summary: '韩立 身世 青牛镇', level: 0, bookId: 'b', model: 'm', promptVersion: 'v2', createdAt: 1 },
      { idx: 1, summary: '打斗', level: 0, bookId: 'b', model: 'm', promptVersion: 'v2', createdAt: 1 },
    ] as any;
    const r = scoreChapterSummaries(sums, ['韩立', '身世']);
    expect(r[0].idx).toBe(0);
    expect(r.some((x) => x.idx === 1)).toBe(false); // 无命中 -> 不留
    expect(r.length).toBe(1);
  });

  test('多条命中都降序排列，分数越高越靠前', () => {
    const sums = [
      { idx: 0, summary: '韩立 身世 韩立', level: 0, bookId: 'b', model: 'm', promptVersion: 'v2', createdAt: 1 },
      { idx: 1, summary: '韩立', level: 0, bookId: 'b', model: 'm', promptVersion: 'v2', createdAt: 1 },
      { idx: 2, summary: '打斗', level: 0, bookId: 'b', model: 'm', promptVersion: 'v2', createdAt: 1 },
    ] as any;
    const r = scoreChapterSummaries(sums, ['韩立', '身世']);
    expect(r.map((x) => x.idx)).toEqual([0, 1]);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });

  test('忽略非 level 0 的条目（弧小结不参与逐章检索打分）', () => {
    const sums = [
      { idx: 0, summary: '韩立', level: 1, bookId: 'b', model: 'm', promptVersion: 'v2', createdAt: 1 },
    ] as any;
    const r = scoreChapterSummaries(sums, ['韩立']);
    expect(r.length).toBe(0);
  });
});

describe('retrieveRelevantPassages', () => {
  const makeChapters = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ bookId: 'b', index: i, title: `T${i}`, level: 0, byteStart: i, byteEnd: i + 1 })) as any;
  const book = { id: 'b', normalizedPath: '/x' } as any;

  test('只读候选章、段落 idx ⊆ [0..cutoff]，含 term', async () => {
    const chapters = makeChapters(20);
    const read: number[] = [];
    const fs = {
      readRange: async (_p: string, s: number) => {
        read.push(s);
        return Buffer.from(`T\n韩立的身世在这里 seg${s}`, 'utf8');
      },
    } as any;
    const res = await retrieveRelevantPassages(
      { fs },
      { book, chapters, candidateIdx: [2, 5], terms: ['身世'], cutoff: 10, maxBlocks: 5 },
    );
    expect(res.every((p) => p.chapterIdx <= 10)).toBe(true);
    expect(res.every((p) => p.text.includes('身世'))).toBe(true);
    // 只读了候选 2、5 两章（byteStart 2、5）
    expect(read.sort((a, b) => a - b)).toEqual([2, 5]);
  });

  test('防剧透硬断言：候选含 idx=10 但 cutoff=9 -> 结果不含第 10 章、fs 未读第 10 章', async () => {
    const chapters = makeChapters(20);
    const read: number[] = [];
    const fs = {
      readRange: async (_p: string, s: number) => {
        read.push(s);
        return Buffer.from(`T\n韩立的身世在这里 seg${s}`, 'utf8');
      },
    } as any;
    const res = await retrieveRelevantPassages(
      { fs },
      { book, chapters, candidateIdx: [3, 10], terms: ['身世'], cutoff: 9, maxBlocks: 5 },
    );
    expect(res.every((p) => p.chapterIdx !== 10)).toBe(true);
    expect(read).not.toContain(10); // fs 从未被要求读第 10 章（byteStart===10）
    expect(read).toEqual([3]);
  });

  test('跳过标题块（block0），从 block1 起找命中；累计到 maxBlocks 停', async () => {
    const chapters = makeChapters(3);
    const fs = {
      readRange: async (_p: string, s: number) => {
        // 标题块含 term，但不应被当作命中段落
        return Buffer.from(`身世标题\n无关内容\n韩立身世第一段\n韩立身世第二段`, 'utf8');
      },
    } as any;
    const res = await retrieveRelevantPassages(
      { fs },
      { book, chapters, candidateIdx: [0], terms: ['身世'], cutoff: 2, maxBlocks: 1 },
    );
    expect(res.length).toBe(1);
    expect(res[0].blockIndex).toBeGreaterThanOrEqual(1);
    expect(res[0].text.includes('身世')).toBe(true);
  });
});

describe('extractQueryTerms', () => {
  test('解析逗号/顿号', async () => {
    const chat = async () => '韩立, 身世、来历';
    const terms = await extractQueryTerms({ chat }, '韩立身世');
    expect(terms).toEqual(expect.arrayContaining(['韩立', '身世', '来历']));
  });

  test('失败回退切词', async () => {
    const bad = async () => {
      throw new Error('x');
    };
    const terms = await extractQueryTerms({ chat: bad }, '韩立 身世');
    expect(terms.length).toBeGreaterThan(0);
  });

  test('去序号前缀、去重、去空白', async () => {
    const chat = async () => '1. 韩立\n2、韩立\n\n身世,  ';
    const terms = await extractQueryTerms({ chat }, 'q');
    expect(terms).toEqual(['韩立', '身世']);
  });

  test('chat 返回空串也回退到切词', async () => {
    const chat = async () => '';
    const terms = await extractQueryTerms({ chat }, '韩立 身世');
    expect(terms.length).toBeGreaterThan(0);
    expect(terms).toEqual(expect.arrayContaining(['韩立', '身世']));
  });
});
