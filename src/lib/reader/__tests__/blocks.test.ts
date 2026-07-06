/* @jest-environment node */
/**
 * T4: splitBlocks — splits chapter text into renderable paragraph blocks.
 *
 * Rules:
 *  - Split on blank-line / newline boundaries.
 *  - Trim each block.
 *  - Drop empty blocks (consecutive blank lines collapse to nothing).
 *  - The chapter title (first line of chapterText) is kept as the first block.
 */

import { splitBlocks } from '../blocks';

describe('splitBlocks', () => {
  it('splits a title + single paragraph into two blocks', () => {
    const text = '第一章 山边小村\n这是正文第一段。';
    expect(splitBlocks(text)).toEqual(['第一章 山边小村', '这是正文第一段。']);
  });

  it('splits multiple paragraphs separated by newlines', () => {
    const text = '第一章 标题\n第一段内容。\n第二段内容。\n第三段内容。';
    expect(splitBlocks(text)).toEqual([
      '第一章 标题',
      '第一段内容。',
      '第二段内容。',
      '第三段内容。',
    ]);
  });

  it('collapses blank lines and drops empty blocks', () => {
    const text = '第一章 标题\n\n\n第一段。\n\n第二段。\n\n\n\n';
    expect(splitBlocks(text)).toEqual(['第一章 标题', '第一段。', '第二段。']);
  });

  it('trims leading/trailing whitespace from each block', () => {
    const text = '第一章 标题  \n   缩进的段落。   \n\t制表符段落。\t';
    expect(splitBlocks(text)).toEqual(['第一章 标题', '缩进的段落。', '制表符段落。']);
  });

  it('returns an empty array for empty input', () => {
    expect(splitBlocks('')).toEqual([]);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(splitBlocks('   \n\n   \n')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const text = '第一章 标题\r\n第一段。\r\n\r\n第二段。';
    expect(splitBlocks(text)).toEqual(['第一章 标题', '第一段。', '第二段。']);
  });
});
