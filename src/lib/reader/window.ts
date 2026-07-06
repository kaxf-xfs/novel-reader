/**
 * T4: windowIndices — pure function computing which chapter indices should
 * be kept loaded around the reader's current position.
 *
 * Used by ReaderScreen to decide the initial "sliding window" of chapters
 * (current ± radius) to fetch and render, so the whole book is never
 * loaded into memory at once.
 */

/**
 * Returns the chapter indices in [current-radius, current+radius], clipped
 * to the valid range [0, total).
 *
 * - `total <= 0` → returns [].
 * - `current` is clamped into [0, total-1] before applying the radius, so an
 *   out-of-range current still produces a sensible window at the nearest edge.
 */
export function windowIndices(total: number, current: number, radius: number): number[] {
  if (total <= 0) return [];

  const clampedCurrent = Math.min(Math.max(current, 0), total - 1);
  const lo = Math.max(0, clampedCurrent - radius);
  const hi = Math.min(total - 1, clampedCurrent + radius);

  const result: number[] = [];
  for (let i = lo; i <= hi; i++) {
    result.push(i);
  }
  return result;
}
