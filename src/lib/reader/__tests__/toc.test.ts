import { filterChapters } from '../toc';

const chapters = [
  { index: 0, title: '第一章 山边小村' },
  { index: 1, title: '第二章 入门考验' },
  { index: 2, title: '楔子' },
  { index: 3, title: 'Chapter Three' },
];

describe('filterChapters', () => {
  it('returns all chapters for an empty or whitespace query', () => {
    expect(filterChapters(chapters, '')).toHaveLength(4);
    expect(filterChapters(chapters, '   ')).toHaveLength(4);
  });

  it('matches by substring of the title', () => {
    const r = filterChapters(chapters, '入门');
    expect(r).toHaveLength(1);
    expect(r[0].index).toBe(1);
  });

  it('is case-insensitive for latin text', () => {
    expect(filterChapters(chapters, 'chapter')).toHaveLength(1);
    expect(filterChapters(chapters, 'THREE')[0].index).toBe(3);
  });

  it('trims the query before matching', () => {
    expect(filterChapters(chapters, '  楔子  ')).toHaveLength(1);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterChapters(chapters, '不存在')).toHaveLength(0);
  });

  it('does not mutate the input', () => {
    const copy = [...chapters];
    filterChapters(chapters, '第');
    expect(chapters).toEqual(copy);
  });
});
