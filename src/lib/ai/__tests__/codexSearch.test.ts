import type { Character, Term } from '../codex';
import { filterCharacters, filterTerms } from '../codexSearch';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

function term(over: Partial<Term>): Term {
  return { name: 'T', category: '其它', def: [], firstChapterIdx: 0, ...over };
}

describe('filterCharacters', () => {
  it('empty query returns all characters unchanged', () => {
    const chars = [char({ name: 'A' }), char({ name: 'B' })];
    expect(filterCharacters(chars, '')).toEqual(chars);
  });

  it('matches by name, case-insensitively', () => {
    const chars = [char({ name: '张三' }), char({ name: '李四' })];
    expect(filterCharacters(chars, '张').map((c) => c.name)).toEqual(['张三']);
  });

  it('matches by alias', () => {
    const chars = [char({ name: '张三', aliases: [{ text: '玄天真人', idx: 1 }] })];
    expect(filterCharacters(chars, '玄天')).toHaveLength(1);
  });

  it('matches by group', () => {
    const chars = [char({ name: '张三', groups: [{ name: '青云门', idx: 1 }] })];
    expect(filterCharacters(chars, '青云')).toHaveLength(1);
  });

  it('matches by bio text', () => {
    const chars = [char({ name: '张三', bio: [{ text: '出身贫寒的少年', idx: 1 }] })];
    expect(filterCharacters(chars, '贫寒')).toHaveLength(1);
  });

  it('non-matching query returns empty array', () => {
    const chars = [char({ name: '张三' })];
    expect(filterCharacters(chars, '完全不相关')).toEqual([]);
  });
});

describe('filterTerms', () => {
  it('matches by name, def, or gloss', () => {
    const terms = [
      term({ name: '青云诀', def: [{ text: '入门吐纳法', idx: 1 }] }),
      term({ name: '天魔功', gloss: [{ text: '邪派内功', idx: 1 }] }),
    ];
    expect(filterTerms(terms, '吐纳').map((t) => t.name)).toEqual(['青云诀']);
    expect(filterTerms(terms, '邪派').map((t) => t.name)).toEqual(['天魔功']);
  });
});
