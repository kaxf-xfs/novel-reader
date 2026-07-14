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

describe('mergeCodex — containment near-dup guard', () => {
  it('CRITICAL: when a longer fragment subsumes an earlier shorter one, the surviving text keeps its OWN idx — never the earlier (shorter) fragment\'s idx, never the minimum of the two', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 10, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒的少年', idx: 10 }], firstChapterIdx: 10 })], terms: [], relations: [] } },
      { maxIdx: 200, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒的少年，后来弑父夺得魔教教主之位', idx: 200 }], firstChapterIdx: 10 })], terms: [], relations: [] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    const identity = merged.characters[0].identity;
    // 只应存活一条（长文本吸收短文本），且必须带长文本自身的 idx=200，不能是 10，也不能是二者的 min。
    expect(identity).toHaveLength(1);
    expect(identity[0]).toEqual({ text: '出身贫寒的少年，后来弑父夺得魔教教主之位', idx: 200 });
  });

  it('distinct-but-similar fragments (neither is a substring of the other) both survive', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 5, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒', idx: 5 }], firstChapterIdx: 5 })], terms: [], relations: [] } },
      { maxIdx: 30, partial: { characters: [char({ name: '林某', identity: [{ text: '自幼失怙', idx: 30 }], firstChapterIdx: 5 })], terms: [], relations: [] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    expect(merged.characters[0].identity.map((i) => i.text).sort()).toEqual(['出身贫寒', '自幼失怙']);
  });

  it('a fragment identical after normalization (whitespace/trailing punctuation only) still collapses to one, keeping the longer/later idx', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 3, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒。', idx: 3 }], firstChapterIdx: 3 })], terms: [], relations: [] } },
      { maxIdx: 7, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒', idx: 7 }], firstChapterIdx: 3 })], terms: [], relations: [] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    expect(merged.characters[0].identity).toHaveLength(1);
  });

  it('an incoming fragment that subsumes TWO separate existing fragments replaces both with a single entry carrying its own idx', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 5, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒', idx: 5 }], firstChapterIdx: 5 })], terms: [], relations: [] } },
      { maxIdx: 30, partial: { characters: [char({ name: '林某', identity: [{ text: '自幼失怙', idx: 30 }], firstChapterIdx: 5 })], terms: [], relations: [] } },
      { maxIdx: 88, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒，自幼失怙，后拜入青云门', idx: 88 }], firstChapterIdx: 5 })], terms: [], relations: [] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    const identity = merged.characters[0].identity;
    // 只应存活一条：新碎片自身，带自己的 idx=88；两条被吸收的旧碎片都不应残留。
    expect(identity).toHaveLength(1);
    expect(identity[0]).toEqual({ text: '出身贫寒，自幼失怙，后拜入青云门', idx: 88 });
    expect(identity.map((i) => i.text)).not.toContain('出身贫寒');
    expect(identity.map((i) => i.text)).not.toContain('自幼失怙');
  });

  it('trailing punctuation preceded by whitespace still normalizes to match the punctuation-free form', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 3, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒 。', idx: 3 }], firstChapterIdx: 3 })], terms: [], relations: [] } },
      { maxIdx: 7, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒', idx: 7 }], firstChapterIdx: 3 })], terms: [], relations: [] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    expect(merged.characters[0].identity).toHaveLength(1);
  });
});
