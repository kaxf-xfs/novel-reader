/**
 * 增量 5: 把"已读小结"聚合成一段防剧透上下文，卡在字符预算内。
 * 策略：当前章已读原文（最高优先）+ 最近章小结（次高）+ 更早用弧小结；
 * 超预算就丢最早的（弧优先保留，章优先保留近的）。纯函数可测。
 */

import type { SummaryRecord } from '../import/repository';
import { ARC_SIZE } from './summarize';

export const CONTEXT_BUDGET = 24_000;

export interface SelectedContext {
  contextText: string;
  includedChapterIdx: number[];
  usedArcs: number[];
}

export function selectContext(p: {
  arcSummaries: SummaryRecord[];
  chapterSummaries: SummaryRecord[];
  currentChapterText: string;
  cutoff: number;
  budgetChars?: number;
  arcSize?: number;
}): SelectedContext {
  const budget = p.budgetChars ?? CONTEXT_BUDGET;
  const arcSize = p.arcSize ?? ARC_SIZE;

  // Defense in depth: never let a chapter/arc past the cutoff leak in.
  const chapters = p.chapterSummaries.filter((s) => s.idx <= p.cutoff).sort((a, b) => a.idx - b.idx);
  const arcs = p.arcSummaries.filter((a) => (a.idx + 1) * arcSize - 1 <= p.cutoff).sort((a, b) => a.idx - b.idx);

  const parts: string[] = [];
  const includedChapterIdx: number[] = [];
  const usedArcs: number[] = [];
  let used = 0;
  const room = () => budget - used;

  // 1) current chapter read-so-far text (highest priority, always try first)
  const cur = p.currentChapterText.trim();
  if (cur) {
    const slice = cur.slice(0, Math.max(0, room()));
    if (slice) {
      parts.push(`【当前章·已读】\n${slice}`);
      used += slice.length + 8;
    }
  }

  // 2) recent chapter summaries, newest→oldest, until budget runs low
  const recentKept: string[] = [];
  let oldestKeptChapterIdx = p.cutoff + 1;
  for (let i = chapters.length - 1; i >= 0; i--) {
    const c = chapters[i];
    const piece = `第${c.idx + 1}章：${c.summary}`;
    if (piece.length + 1 > room()) break;
    recentKept.unshift(piece);
    includedChapterIdx.unshift(c.idx);
    oldestKeptChapterIdx = c.idx;
    used += piece.length + 1;
  }

  // 3) arc summaries for chapters older than the oldest kept chapter, newest→oldest
  const arcKept: string[] = [];
  for (let a = arcs.length - 1; a >= 0; a--) {
    const arc = arcs[a];
    const arcLastChapter = (arc.idx + 1) * arcSize - 1;
    if (arcLastChapter >= oldestKeptChapterIdx) continue; // already covered by chapter detail
    const piece = `【第${arc.idx * arcSize + 1}-${arcLastChapter + 1}章·概要】${arc.summary}`;
    if (piece.length + 1 > room()) break;
    arcKept.unshift(piece);
    usedArcs.unshift(arc.idx);
    used += piece.length + 1;
  }

  const body = [...arcKept, ...recentKept];
  const contextText = [parts[0], body.join('\n')].filter(Boolean).join('\n\n');
  return { contextText, includedChapterIdx, usedArcs };
}
