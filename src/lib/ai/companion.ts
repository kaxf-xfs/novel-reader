/**
 * 增量 5: 伴读 prompt 构造（纯）+ buildReadContext 编排（防剧透地拼上下文）。
 */

import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import type { FileGateway } from '../import/importBook';
import { splitBlocks } from '../reader/blocks';
import { readChapterText } from '../reader/readChapter';
import type { ChatMessage } from './client';
import { selectContext } from './context';
import { ARC_SIZE, ensureSummaries, type SummarizeFn } from './summarize';

export type AiMode = 'recap' | 'ask' | 'character';

const SPOILER_RULE =
  '下面【已读内容】是读者到目前为止读过的部分（更早章节的要点小结 + 当前章已读原文）。' +
  '只能依据【已读内容】作答，绝不能透露或推测读者尚未读到的后续情节。' +
  '若【已读内容】不足以回答，就直说「目前读到的部分还没有相关内容」。用简洁中文。';

export function askBookMessages(context: string, question: string): ChatMessage[] {
  return [
    { role: 'system', content: `你是读者的「已读伴读」助手。${SPOILER_RULE}` },
    { role: 'user', content: `【已读内容】\n${context}\n\n【问题】${question}` },
  ];
}

export function storySoFarMessages(context: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是「剧情回顾」助手。请根据【已读内容】写一段到当前进度为止的「前情提要」，${SPOILER_RULE} 控制在 200–400 字。`,
    },
    { role: 'user', content: `【已读内容】\n${context}` },
  ];
}

export function characterMessages(context: string, name: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是「人物档案」助手。请介绍读者指定的人物：他是谁、目前为止做过什么、与谁是什么关系。${SPOILER_RULE} 若还没出现，就说「目前读到的部分还没出现这个人物」。`,
    },
    { role: 'user', content: `【已读内容】\n${context}\n\n【人物】${name}` },
  ];
}

export interface BuildContextParams {
  book: BookRecord;
  chapters: ChapterRecord[];
  currentChapterIndex: number;
  currentBlockIndex: number;
  model: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export async function buildReadContext(
  deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository },
  params: BuildContextParams,
): Promise<{ contextText: string; includedChapterIdx: number[] }> {
  const { chat, fs, repo } = deps;
  const { book, chapters, currentChapterIndex, currentBlockIndex, model, signal, onProgress } = params;
  const cutoff = currentChapterIndex - 1;

  await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff, model, signal, onProgress });

  const chapterSummaries = await repo.listSummaries(book.id, 0, cutoff);
  const lastArc = Math.floor((cutoff + 1) / ARC_SIZE) - 1;
  const arcSummaries = await repo.listSummaries(book.id, 1, lastArc);

  let currentChapterText = '';
  if (currentChapterIndex >= 0 && currentChapterIndex < chapters.length) {
    const raw = await readChapterText(fs, book.normalizedPath, chapters[currentChapterIndex]);
    currentChapterText = splitBlocks(raw).slice(0, currentBlockIndex + 1).join('\n');
  }

  const { contextText, includedChapterIdx } = selectContext({
    arcSummaries,
    chapterSummaries,
    currentChapterText,
    cutoff,
  });
  return { contextText, includedChapterIdx };
}
