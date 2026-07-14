import { codexForCutoff, EMPTY_CODEX, type Codex } from '../codex';

function baseCodex(): Codex {
  return {
    characters: [
      {
        name: '小明',
        aliases: [{ text: '真名·玄天真人', idx: 8 }],
        identity: [{ text: '一个普通少年', idx: 0 }, { text: '隐世宗门传人', idx: 8 }],
        origin: [{ text: '出身贫寒村落', idx: 2 }],
        groups: [{ name: '青云门', idx: 8 }],
        firstChapterIdx: 0,
        events: [{ text: '初入宗门', idx: 1 }],
      },
      {
        name: '未来反派',
        aliases: [],
        identity: [{ text: '尚未登场', idx: 20 }],
        groups: [],
        firstChapterIdx: 20,
      },
    ],
    terms: [
      {
        name: '青云诀',
        category: '功法',
        def: [{ text: '入门吐纳法', idx: 1 }, { text: '实为上古仙法残篇', idx: 9 }],
        firstChapterIdx: 1,
      },
    ],
    relations: [
      { from: '小明', to: '未来反派', kind: '结怨', idx: 3 },
    ],
  };
}

describe('codexForCutoff', () => {
  it('hides a character whose firstChapterIdx is beyond cutoff', () => {
    const out = codexForCutoff(baseCodex(), 5);
    expect(out.characters.map((c) => c.name)).toEqual(['小明']);
  });

  it('回退进度后收窄：只保留 idx<=cutoff 的 aliases/identity/origin/groups/events，name 恒可见', () => {
    const out = codexForCutoff(baseCodex(), 5);
    const ming = out.characters[0];
    expect(ming.name).toBe('小明'); // canonical name 恒安全
    expect(ming.aliases).toEqual([]); // idx=8 的别名未到
    expect(ming.identity.map((i) => i.text)).toEqual(['一个普通少年']); // idx=8 那条未到
    expect(ming.origin?.map((i) => i.text)).toEqual(['出身贫寒村落']);
    expect(ming.groups).toEqual([]); // idx=8 的势力归属未到
    expect(ming.events?.map((e) => e.text)).toEqual(['初入宗门']);
  });

  it('回退到 cutoff=8 后，别名/势力等随之出现', () => {
    const out = codexForCutoff(baseCodex(), 8);
    const ming = out.characters[0];
    expect(ming.aliases.map((a) => a.text)).toEqual(['真名·玄天真人']);
    expect(ming.groups.map((g) => g.name)).toEqual(['青云门']);
  });

  it('词条 def 版本化：展示 idx<=cutoff 中最新的一条，未来释义不泄漏', () => {
    const early = codexForCutoff(baseCodex(), 3);
    expect(early.terms[0].def.map((d) => d.text)).toEqual(['入门吐纳法']);
    const late = codexForCutoff(baseCodex(), 9);
    expect(late.terms[0].def.map((d) => d.text)).toEqual(['实为上古仙法残篇']);
  });

  it('relation 端点任一方不在已展示人物集合时丢弃（即便 relation.idx<=cutoff）', () => {
    const out = codexForCutoff(baseCodex(), 5); // idx=3<=5 但「未来反派」firstChapterIdx=20>5，不可见
    expect(out.relations).toEqual([]);
  });

  it('relation.idx 超过 cutoff 时丢弃，即便双方都可见', () => {
    const codex = baseCodex();
    codex.characters[1] = { ...codex.characters[1], firstChapterIdx: 0 }; // 让双方都可见
    const out = codexForCutoff(codex, 2); // relation idx=3 > cutoff=2
    expect(out.relations).toEqual([]);
  });

  it('空 Codex 回退安全', () => {
    expect(codexForCutoff(EMPTY_CODEX, 5)).toEqual(EMPTY_CODEX);
  });

  it('bio/gloss: shows the latest polished version whose idx <= cutoff, not all versions, not the first', () => {
    const codex = baseCodex();
    codex.characters[0] = {
      ...codex.characters[0],
      bio: [{ text: '早期简介', idx: 4 }, { text: '追加后的简介', idx: 12 }],
      bioHash: 'should-never-appear-in-output',
    };
    const early = codexForCutoff(codex, 6);
    expect(early.characters[0].bio).toEqual([{ text: '早期简介', idx: 4 }]);
    const late = codexForCutoff(codex, 20);
    expect(late.characters[0].bio).toEqual([{ text: '追加后的简介', idx: 12 }]);
  });

  it('bio falls back to [] when no polished version exists yet at or below cutoff (caller degrades to raw fragments)', () => {
    const codex = baseCodex();
    codex.characters[0] = { ...codex.characters[0], bio: [{ text: '晚出现的简介', idx: 50 }] };
    const out = codexForCutoff(codex, 6);
    expect(out.characters[0].bio).toEqual([]);
  });

  it('bioHash/glossHash never appear on the filtered output, even when present on the raw codex', () => {
    const codex = baseCodex();
    codex.characters[0] = { ...codex.characters[0], bio: [{ text: 'x', idx: 0 }], bioHash: 'SECRET-HASH' };
    codex.terms[0] = { ...codex.terms[0], gloss: [{ text: 'y', idx: 0 }], glossHash: 'SECRET-HASH-2' };
    const out = codexForCutoff(codex, 20);
    expect(out.characters[0]).not.toHaveProperty('bioHash');
    expect(out.terms[0]).not.toHaveProperty('glossHash');
  });

  it('gloss reuses the same latest-at-cutoff reduction as def', () => {
    const codex = baseCodex();
    codex.terms[0] = {
      ...codex.terms[0],
      gloss: [{ text: '早期释义', idx: 2 }, { text: '整合后的释义', idx: 9 }],
    };
    const out = codexForCutoff(codex, 5);
    expect(out.terms[0].gloss).toEqual([{ text: '早期释义', idx: 2 }]);
  });
});
