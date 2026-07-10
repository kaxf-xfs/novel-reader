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

  // Reserve headroom so recent chapter summaries can't devour the whole budget and
  // starve the arc backbone. Without it, at deep positions (hundreds of read
  // chapters) recent chapters fill every byte and the earliest chapters end up
  // represented by nothing — a content hole. Bounded to what the arcs could
  // actually need (~350 chars each), capped at 40% of budget.
  const arcReserve = Math.min(Math.floor(budget * 0.4), arcs.length * 350);

  // 1) current chapter read-so-far text (highest priority, always try first)
  const cur = p.currentChapterText.trim();
  if (cur) {
    const avail = Math.max(0, room());
    const slice = cur.length > avail ? cur.slice(cur.length - avail) : cur;
    if (slice) {
      parts.push(`【当前章·已读】\n${slice}`);
      used += slice.length + 9; // 标签「【当前章·已读】\n」= 9 字符
    }
  }

  // 2) recent chapter summaries, newest→oldest, leaving arcReserve for the backbone
  const recentKept: string[] = [];
  let oldestKeptChapterIdx = p.cutoff + 1;
  for (let i = chapters.length - 1; i >= 0; i--) {
    const c = chapters[i];
    const piece = `第${c.idx + 1}章：${c.summary}`;
    if (used + piece.length + 1 > budget - arcReserve) break;
    recentKept.unshift(piece);
    includedChapterIdx.unshift(c.idx);
    oldestKeptChapterIdx = c.idx;
    used += piece.length + 1;
  }

  // 3) arc backbone for chapters older than the oldest kept chapter, EARLIEST first
  // (earliest history is the most likely to be otherwise lost), filling up to the
  // full budget.
  const arcKept: string[] = [];
  for (let a = 0; a < arcs.length; a++) {
    const arc = arcs[a];
    const arcFirstChapter = arc.idx * arcSize;
    const arcLastChapter = (arc.idx + 1) * arcSize - 1;
    if (arcFirstChapter >= oldestKeptChapterIdx) continue; // 整弧已被章级细节覆盖；部分重叠则保留该弧，不留空洞
    const piece = `【第${arc.idx * arcSize + 1}-${arcLastChapter + 1}章·概要】${arc.summary}`;
    if (used + piece.length + 1 > budget) break;
    arcKept.push(piece);
    usedArcs.push(arc.idx);
    used += piece.length + 1;
  }

  const body = [...arcKept, ...recentKept];
  const contextText = [parts[0], body.join('\n')].filter(Boolean).join('\n\n');
  return { contextText, includedChapterIdx, usedArcs };
}
