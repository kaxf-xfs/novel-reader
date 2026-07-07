// src/lib/reader/seek.ts
/**
 * 增量1: 进度条拖动跳转的纯换算。fraction ∈ [0,1] ↔ 章节下标 ∈ [0,total-1]。
 * PanResponder 只负责把手势 x 转成 fraction，跳转决策交给这里。
 */
function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function fractionToChapterIndex(fraction: number, total: number): number {
  if (total <= 1) return 0;
  const f = clamp(fraction, 0, 1);
  return clamp(Math.round(f * (total - 1)), 0, total - 1);
}

export function chapterIndexToFraction(index: number, total: number): number {
  if (total <= 1) return 0;
  const i = clamp(index, 0, total - 1);
  return clamp(i / (total - 1), 0, 1);
}
