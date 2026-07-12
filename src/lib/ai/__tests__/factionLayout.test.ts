import type { Character, Relation } from '../codex';
import { layoutFactionGraph } from '../factionLayout';

function char(name: string, groups: { name: string; idx: number }[] = []): Character {
  return { name, aliases: [], identity: [], groups, firstChapterIdx: 0 };
}

describe('layoutFactionGraph', () => {
  it('is deterministic: same input produces structurally identical output', () => {
    const characters = [char('甲'), char('乙'), char('丙')];
    const relations: Relation[] = [{ from: '甲', to: '乙', kind: '同门', idx: 0 }];
    const a = layoutFactionGraph(characters, relations, { width: 400, height: 400 });
    const b = layoutFactionGraph(characters, relations, { width: 400, height: 400 });
    expect(a).toEqual(b);
  });

  it('caps nodes at maxNodes (default 30), keeping the highest-degree characters', () => {
    const characters = Array.from({ length: 35 }, (_, i) => char(`c${i}`));
    // 给 c0..c4 各连 5 条边（degree 高），其余 0 条
    const relations: Relation[] = [];
    for (let i = 0; i < 5; i++) relations.push({ from: `c${i}`, to: `c${(i + 1) % 5}`, kind: '同门', idx: 0 });
    const { nodes } = layoutFactionGraph(characters, relations, { width: 400, height: 400 });
    expect(nodes).toHaveLength(30);
    for (let i = 0; i < 5; i++) expect(nodes.some((n) => n.name === `c${i}`)).toBe(true);
  });

  it('degrades to a single ring when nobody has a group', () => {
    const characters = [char('甲'), char('乙'), char('丙')];
    const { nodes } = layoutFactionGraph(characters, [], { width: 300, height: 300 });
    expect(nodes.every((n) => n.group === '散')).toBe(true);
  });

  it('caps distinct real groups at 6, merging the overflow into 散', () => {
    const characters = Array.from({ length: 8 }, (_, i) => char(`c${i}`, [{ name: `门派${i}`, idx: 0 }]));
    const { nodes } = layoutFactionGraph(characters, [], { width: 300, height: 300 });
    const groups = new Set(nodes.map((n) => n.group));
    expect(groups.size).toBeLessThanOrEqual(7); // 至多 6 个真实势力 + 「散」
  });

  it('drops an edge whose endpoint was cut by the top-N selection', () => {
    const characters = [char('甲'), char('乙')];
    const relations: Relation[] = [{ from: '甲', to: '不存在的人', kind: '同门', idx: 0 }];
    const { edges } = layoutFactionGraph(characters, relations, { width: 300, height: 300 });
    expect(edges).toHaveLength(0);
  });
});
