import { findBlockArrayIndex } from '../restore';

const win = [
  { chapterIndex: 4, blockIndex: 0 },
  { chapterIndex: 4, blockIndex: 1 },
  { chapterIndex: 5, blockIndex: 0 }, // target chapter starts here
  { chapterIndex: 5, blockIndex: 1 },
  { chapterIndex: 5, blockIndex: 2 },
  { chapterIndex: 6, blockIndex: 0 },
];

describe('findBlockArrayIndex', () => {
  it('finds the array index of a (chapter, block) anchor across a multi-chapter window', () => {
    expect(findBlockArrayIndex(win, 5, 2)).toBe(4);
  });

  it('finds the first block of the target chapter', () => {
    expect(findBlockArrayIndex(win, 5, 0)).toBe(2);
  });

  it('returns -1 when the anchor is not present', () => {
    expect(findBlockArrayIndex(win, 5, 9)).toBe(-1);
    expect(findBlockArrayIndex(win, 9, 0)).toBe(-1);
  });

  it('returns -1 for an empty window', () => {
    expect(findBlockArrayIndex([], 0, 0)).toBe(-1);
  });
});
