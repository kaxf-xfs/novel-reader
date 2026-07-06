/* @jest-environment node */
/**
 * T4: windowIndices — pure function computing the set of chapter indices
 * to keep loaded around the current reading position.
 */

import { windowIndices } from '../window';

describe('windowIndices', () => {
  it('returns empty array when total is 0', () => {
    expect(windowIndices(0, 0, 2)).toEqual([]);
  });

  it('returns the single index when total is 1', () => {
    expect(windowIndices(1, 0, 2)).toEqual([0]);
  });

  it('clips to the start of the range', () => {
    expect(windowIndices(10, 0, 1)).toEqual([0, 1]);
  });

  it('clips to the end of the range', () => {
    expect(windowIndices(10, 9, 1)).toEqual([8, 9]);
  });

  it('returns current ± radius in the middle of the range', () => {
    expect(windowIndices(10, 5, 2)).toEqual([3, 4, 5, 6, 7]);
  });

  it('clips when radius exceeds total on both sides', () => {
    expect(windowIndices(3, 1, 10)).toEqual([0, 1, 2]);
  });

  it('radius 0 returns only current', () => {
    expect(windowIndices(10, 4, 0)).toEqual([4]);
  });

  it('clamps an out-of-range current into [0, total)', () => {
    expect(windowIndices(5, 99, 1)).toEqual([3, 4]);
    expect(windowIndices(5, -99, 1)).toEqual([0, 1]);
  });
});
