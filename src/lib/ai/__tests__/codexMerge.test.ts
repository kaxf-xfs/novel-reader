import { EMPTY_CODEX, type Character, type Term } from '../codex';
import type { CodexBlockResult } from '../codexExtract';
import { mergeCodex } from '../codexMerge';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

function term(over: Partial<Term>): Term {
  return { name: 'T', category: '其它', def: [], firstChapterIdx: 0, ...over };
}

describe('mergeCodex', () => {
  it('folds partials sorted by maxIdx ascending, so canonical name is the earliest block\'s name even out-of-order input', () => {
    // 块 B（maxIdx=10）先叫他「玄天真人」且在 aliases 里带出他的旧名「小明」；
    // 块 A（maxIdx=3，更早）叫他「小明」。runPool 产出顺序把块 B 排在数组前面。
    const blockResults: CodexBlockResult[] = [
      {
        maxIdx: 10,
        partial: {
          characters: [char({ name: '玄天真人', aliases: [{ text: '小明', idx: 10 }], firstChapterIdx: 10 })],
          terms: [],
          relations: [],
        },
      },
      {
        maxIdx: 3,
        partial: { characters: [char({ name: '小明', firstChapterIdx: 3 })], terms: [], relations: [] },
      },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    expect(merged.characters).toHaveLength(1);
    expect(merged.characters[0].name).toBe('小明'); // 最早块（maxIdx=3）的字面名，永不被后续块覆盖
    expect(merged.characters[0].firstChapterIdx).toBe(3);
    expect(merged.characters[0].aliases.map((a) => a.text)).toContain('玄天真人'); // 后续块的新称呼进别名
  });

  it('Term.category is first-write-wins across blocks in fold order', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 1, partial: { characters: [], terms: [term({ name: '青云诀', category: '功法', def: [{ text: '入门吐纳法', idx: 1 }], firstChapterIdx: 1 })], relations: [] } },
      { maxIdx: 9, partial: { characters: [], terms: [term({ name: '青云诀', category: '境界', def: [{ text: '实为仙法', idx: 9 }], firstChapterIdx: 9 })], relations: [] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    expect(merged.terms[0].category).toBe('功法'); // 不被后块的「境界」改判
    expect(merged.terms[0].def.map((d) => d.text)).toEqual(['入门吐纳法', '实为仙法']); // 版本化累加
  });

  it('Relation dedup key includes kind: an earlier relation of a different kind is not silently overwritten', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 2, partial: { characters: [], terms: [], relations: [{ from: '甲', to: '乙', kind: '结盟', idx: 2 }] } },
      { maxIdx: 8, partial: { characters: [], terms: [], relations: [{ from: '甲', to: '乙', kind: '结怨', idx: 8 }] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    expect(merged.relations).toHaveLength(2);
    expect(merged.relations.map((r) => r.kind).sort()).toEqual(['结怨', '结盟']);
  });

  it('extends an already-persisted existing Codex rather than resetting it', () => {
    const existing = mergeCodex(EMPTY_CODEX, [
      { maxIdx: 1, partial: { characters: [char({ name: '老王', firstChapterIdx: 1 })], terms: [], relations: [] } },
    ]);
    const merged = mergeCodex(existing, [
      { maxIdx: 5, partial: { characters: [char({ name: '小李', firstChapterIdx: 5 })], terms: [], relations: [] } },
    ]);
    expect(merged.characters.map((c) => c.name).sort()).toEqual(['小李', '老王']);
  });
});
