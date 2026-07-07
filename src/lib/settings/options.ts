/**
 * T5: UI-facing option lists (labels) and the numeric stepper used by the
 * typography drawer's +/- controls. Kept pure and testable.
 */

import type { FontId, NumericBounds, ThemeId } from './settings';

export interface LabeledOption<T extends string> {
  id: T;
  label: string;
}

export const FONT_OPTIONS: readonly LabeledOption<FontId>[] = [
  { id: 'cangEr', label: '仓耳今楷' },
  { id: 'system', label: '系统黑体' },
  { id: 'systemSerif', label: '系统宋体' },
];

export const THEME_OPTIONS: readonly LabeledOption<ThemeId>[] = [
  { id: 'dark', label: '暗夜' },
  { id: 'black', label: '纯黑' },
  { id: 'paper', label: '纸白' },
  { id: 'warmWhite', label: '暖白' },
  { id: 'sepia', label: '米黄' },
  { id: 'green', label: '护眼' },
];

/**
 * Steps `current` by one `bounds.step` in `dir` (+1 / -1), clamped to
 * [min, max]. Rounds to the step's decimal precision so repeated float steps
 * (e.g. line height 1.2 → 1.3) don't accumulate binary-float drift.
 */
export function stepValue(current: number, bounds: NumericBounds, dir: 1 | -1): number {
  const next = current + dir * bounds.step;
  const clamped = Math.min(Math.max(next, bounds.min), bounds.max);
  // Round to the number of decimals implied by `step`.
  const decimals = (String(bounds.step).split('.')[1] ?? '').length;
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}
