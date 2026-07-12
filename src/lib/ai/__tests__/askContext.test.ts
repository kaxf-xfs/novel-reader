/**
 * 增量 7 Task 6a: buildAskContext — 查询感知编排（纯逻辑）。
 * 防剧透红线：所有拼进 contextText / includedChapterIdx 的内容 idx 必须 ≤ cutoff。
 */

import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { InMemoryBookRepository } from '../../import/repository';
import type { ChatMessage } from '../client';
import { buildAskContext } from '../companion';

describe('buildAskContext (query-aware, spoiler-safe)', () => {
  test('检索段拼在最前且不越子预算；组装内容全 ≤cutoff', async () => {
    const repo = new InMemoryBookRepository();
    const fs = new FakeFileGateway();
    const chapters = Array.from({ length: 12 }, (_, i) => ({
      title: `第${i + 1}章`,
      body: i === 2 ? '这里藏着一把宝剑，寒光凛冽，非常锋利' : `平平无奇的正文内容第${i + 1}段`,
    }));
    const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
    const chapterRecords = await repo.getChapters('b1');

    const chat = jest.fn(async (messages: ChatMessage[]) => {
      const sys = messages[0]?.content ?? '';
      if (sys.includes('提取用于检索的关键词')) return '宝剑';
      if (sys.includes('摘要助手')) {
        // echo the body back into the summary so scoreChapterSummaries can find the term
        const user = messages[1]?.content ?? '';
        return `摘要：${user}`;
      }
      return '';
    });

    const { contextText, includedChapterIdx } = await buildAskContext(
      { chat, fs, repo },
      {
        book,
        chapters: chapterRecords,
        currentChapterIndex: 5, // cutoff = 4
        currentBlockIndex: 0,
        model: 'm',
        question: '宝剑是什么？',
      },
    );

    expect(contextText.startsWith('【相关原文')).toBe(true);
    expect(includedChapterIdx.every((i) => i <= 4)).toBe(true);
    // the retrieved passage should reference chapter 3 (idx 2), where the term actually lives
    expect(contextText).toContain('宝剑');
  });

  test('候选含当前章红线：绝不把 idx>cutoff 的段/摘要混入 contextText/includedChapterIdx', async () => {
    const repo = new InMemoryBookRepository();
    const fs = new FakeFileGateway();
    // chapter 10 (last, = currentChapterIndex) body carries a marker that must never leak.
    const chapters = Array.from({ length: 11 }, (_, i) => ({
      title: `第${i + 1}章`,
      body: i === 10 ? 'SPOILER_MARKER_TEN 剧透彩蛋' : `正文${i + 1}`,
    }));
    const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
    const chapterRecords = await repo.getChapters('b1');

    // Simulate a corrupted/pre-existing summary at idx=10 (past cutoff) that a buggy
    // pipeline might otherwise pick up — repo.listSummaries(..., cutoff) must exclude it.
    await repo.putSummary({
      bookId: 'b1',
      level: 0,
      idx: 10,
      model: 'm',
      promptVersion: 'v2',
      summary: 'SPOILER_MARKER_TEN 剧透彩蛋摘要',
      createdAt: Date.now(),
    });

    const chat = jest.fn(async (messages: ChatMessage[]) => {
      const sys = messages[0]?.content ?? '';
      if (sys.includes('提取用于检索的关键词')) return '剧透彩蛋';
      if (sys.includes('摘要助手')) return `摘要：${messages[1]?.content ?? ''}`;
      return '';
    });

    const { contextText, includedChapterIdx } = await buildAskContext(
      { chat, fs, repo },
      {
        book,
        chapters: chapterRecords,
        currentChapterIndex: 10, // cutoff = 9
        currentBlockIndex: 0, // only the title block of chapter 10 is "read"
        model: 'm',
        question: '剧透彩蛋是什么？',
      },
    );

    expect(includedChapterIdx.every((i) => i <= 9)).toBe(true);
    expect(includedChapterIdx).not.toContain(10);
    expect(contextText).not.toContain('SPOILER_MARKER_TEN');
  });

  test('upgradeStale=false 保底：已有旧版本摘要的章不被重摘', async () => {
    const repo = new InMemoryBookRepository();
    const fs = new FakeFileGateway();
    const chapters = Array.from({ length: 5 }, (_, i) => ({
      title: `第${i + 1}章`,
      body: i === 0 ? 'UNIQUE_CH0_BODY_MARKER' : `正文${i + 1}`,
    }));
    const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
    const chapterRecords = await repo.getChapters('b1');

    // Pre-seed a stale summary (old model/promptVersion) for chapter 0.
    await repo.putSummary({
      bookId: 'b1',
      level: 0,
      idx: 0,
      model: 'old-model',
      promptVersion: 'old-v1',
      summary: 'OLD_SUMMARY_0',
      createdAt: 1,
    });

    const calls: ChatMessage[][] = [];
    const chat = jest.fn(async (messages: ChatMessage[]) => {
      calls.push(messages);
      const sys = messages[0]?.content ?? '';
      if (sys.includes('提取用于检索的关键词')) return '正文';
      if (sys.includes('摘要助手')) return `摘要：${messages[1]?.content ?? ''}`;
      return '';
    });

    await buildAskContext(
      { chat, fs, repo },
      {
        book,
        chapters: chapterRecords,
        currentChapterIndex: 4, // cutoff = 3
        currentBlockIndex: 0,
        model: 'new-model',
        question: '正文讲了什么？',
      },
    );

    // chapter 0's stale summary must remain untouched (still old-model).
    const ch0Summary = await repo.getSummary('b1', 0, 0);
    expect(ch0Summary?.model).toBe('old-model');
    expect(ch0Summary?.summary).toBe('OLD_SUMMARY_0');

    // chat must never have been asked to summarize chapter 0's body.
    expect(calls.some((m) => m.some((msg) => msg.content.includes('UNIQUE_CH0_BODY_MARKER')))).toBe(false);

    // sanity: chapters 1..3 (genuinely missing) DID get summarized with the new model.
    const ch1Summary = await repo.getSummary('b1', 0, 1);
    expect(ch1Summary?.model).toBe('new-model');
  });
});
