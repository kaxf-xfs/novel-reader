/**
 * 增量1: 在当前渲染窗口的 block 数组里定位某个 (chapterIndex, blockIndex) 锚点，
 * 用于章内滚动位置恢复与书签跳转（配合 FlatList.scrollToIndex）。
 */
export interface BlockAnchor {
  chapterIndex: number;
  blockIndex: number;
}

/** 命中返回数组下标，未命中返回 -1。 */
export function findBlockArrayIndex(
  blocks: readonly BlockAnchor[],
  chapterIndex: number,
  blockIndex: number,
): number {
  return blocks.findIndex(
    (b) => b.chapterIndex === chapterIndex && b.blockIndex === blockIndex,
  );
}
