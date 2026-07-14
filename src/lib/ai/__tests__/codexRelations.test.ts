import type { Character, Relation } from '../codex';
import { buildGroupedRoster, egoNetwork, isTreeKind, primaryGroup, UNGROUPED } from '../codexRelations';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

describe('primaryGroup', () => {
  it('returns the most-recently-revealed group (highest idx)', () => {
    const c = char({ groups: [{ name: '青云门', idx: 5 }, { name: '天魔教', idx: 20 }] });
    expect(primaryGroup(c)).toBe('天魔教');
  });
  it('returns null when a character has no groups', () => {
    expect(primaryGroup(char({}))).toBeNull();
  });
});

describe('isTreeKind', () => {
  it('classifies 师徒/父子/亲缘-style kinds as tree kinds', () => {
    expect(isTreeKind('师徒')).toBe(true);
    expect(isTreeKind('父子')).toBe(true);
    expect(isTreeKind('亲缘')).toBe(true);
  });
  it('classifies everything else (仇敌/结盟/夫妻) as non-tree (chip)', () => {
    expect(isTreeKind('仇敌')).toBe(false);
    expect(isTreeKind('结盟')).toBe(false);
    expect(isTreeKind('夫妻')).toBe(false);
  });
});

describe('buildGroupedRoster', () => {
  it('groups characters by primaryGroup, ungrouped characters fall into UNGROUPED', () => {
    const characters = [
      char({ name: '张三', groups: [{ name: '青云门', idx: 1 }] }),
      char({ name: '李四', groups: [{ name: '青云门', idx: 1 }] }),
      char({ name: '赵六', groups: [] }),
    ];
    const sections = buildGroupedRoster(characters, []);
    const qyGroup = sections.find((s) => s.group === '青云门')!;
    expect(qyGroup.nodes.map((n) => n.name).sort()).toEqual(['张三', '李四']);
    const ungrouped = sections.find((s) => s.group === UNGROUPED)!;
    expect(ungrouped.nodes.map((n) => n.name)).toEqual(['赵六']);
  });

  it('nests a tree-kind relation within the same group as parent/child indentation', () => {
    const characters = [
      char({ name: '张三', groups: [{ name: '青云门', idx: 1 }] }),
      char({ name: '李四', groups: [{ name: '青云门', idx: 1 }] }),
    ];
    const relations: Relation[] = [{ from: '张三', to: '李四', kind: '师徒', idx: 2 }];
    const sections = buildGroupedRoster(characters, relations);
    const qyGroup = sections.find((s) => s.group === '青云门')!;
    const li = qyGroup.nodes.find((n) => n.name === '李四')!;
    expect(li.depth).toBe(1); // 挂在张三下面
    const zhang = qyGroup.nodes.find((n) => n.name === '张三')!;
    expect(zhang.depth).toBe(0); // 根节点
  });

  it('cross-group or non-tree relations become chips, not tree nesting', () => {
    const characters = [
      char({ name: '张三', groups: [{ name: '青云门', idx: 1 }] }),
      char({ name: '赵六', groups: [{ name: '散修', idx: 1 }] }),
    ];
    const relations: Relation[] = [{ from: '张三', to: '赵六', kind: '仇敌', idx: 2 }];
    const sections = buildGroupedRoster(characters, relations);
    const zhang = sections.find((s) => s.group === '青云门')!.nodes.find((n) => n.name === '张三')!;
    expect(zhang.chips).toContainEqual({ otherName: '赵六', kind: '仇敌' });
  });

  it('cycle/multi-parent defense: a node is nested under only its first-assigned parent, no infinite tree', () => {
    const characters = [
      char({ name: 'A', groups: [{ name: 'G', idx: 1 }] }),
      char({ name: 'B', groups: [{ name: 'G', idx: 1 }] }),
      char({ name: 'C', groups: [{ name: 'G', idx: 1 }] }),
    ];
    // A->B->C->A 是一个环
    const relations: Relation[] = [
      { from: 'A', to: 'B', kind: '师徒', idx: 1 },
      { from: 'B', to: 'C', kind: '师徒', idx: 2 },
      { from: 'C', to: 'A', kind: '师徒', idx: 3 },
    ];
    expect(() => buildGroupedRoster(characters, relations)).not.toThrow();
    const section = buildGroupedRoster(characters, relations).find((s) => s.group === 'G')!;
    expect(section.nodes).toHaveLength(3); // 每个人恰好出现一次，没有因为环而重复或丢失
  });

  it('CRITICAL: contradictory reciprocal tree relations (A,B,师徒) + (B,A,师徒) collapse to exactly one tree edge, with no duplicate chip for the same pair', () => {
    const characters = [
      char({ name: 'A', groups: [{ name: 'G', idx: 1 }] }),
      char({ name: 'B', groups: [{ name: 'G', idx: 1 }] }),
    ];
    const relations: Relation[] = [
      { from: 'A', to: 'B', kind: '师徒', idx: 5 },
      { from: 'B', to: 'A', kind: '师徒', idx: 50 }, // 后期某块把方向判反了
    ];
    const sections = buildGroupedRoster(characters, relations);
    const section = sections.find((s) => s.group === 'G')!;
    // 只应该有一个节点是根（depth 0），另一个是它的子节点（depth 1）——不是两个都互相嵌套。
    const depths = section.nodes.map((n) => n.depth).sort();
    expect(depths).toEqual([0, 1]);
    // 且这一对不应该同时又出现在芯片里（树边与芯片互斥）。
    const allChips = section.nodes.flatMap((n) => n.chips);
    expect(allChips.find((c) => c.otherName === 'A' || c.otherName === 'B')).toBeUndefined();
  });
});

describe('egoNetwork', () => {
  it('places the focal node at the exact center', () => {
    const characters = [char({ name: 'A' }), char({ name: 'B' })];
    const relations: Relation[] = [{ from: 'A', to: 'B', kind: '师徒', idx: 1 }];
    const { nodes } = egoNetwork('A', characters, relations, { width: 200, height: 200 });
    const focal = nodes.find((n) => n.focal)!;
    expect(focal.x).toBe(100);
    expect(focal.y).toBe(100);
    expect(focal.name).toBe('A');
  });

  it('caps direct neighbors at the given cap (default 8), never renders more', () => {
    const characters = [char({ name: 'Focal' }), ...Array.from({ length: 12 }, (_, i) => char({ name: `N${i}` }))];
    const relations: Relation[] = Array.from({ length: 12 }, (_, i) => ({ from: 'Focal', to: `N${i}`, kind: '结盟', idx: i }));
    const { nodes } = egoNetwork('Focal', characters, relations, { width: 300, height: 300 });
    expect(nodes.length).toBeLessThanOrEqual(9); // 焦点 1 + 最多 8 个邻居
  });

  it('deterministic: identical input produces identical output', () => {
    const characters = [char({ name: 'A' }), char({ name: 'B' }), char({ name: 'C' })];
    const relations: Relation[] = [
      { from: 'A', to: 'B', kind: '师徒', idx: 1 },
      { from: 'A', to: 'C', kind: '结盟', idx: 2 },
    ];
    const first = egoNetwork('A', characters, relations, { width: 200, height: 200 });
    const second = egoNetwork('A', characters, relations, { width: 200, height: 200 });
    expect(first).toEqual(second);
  });

  it('edges connect the focal node to each visible neighbor', () => {
    const characters = [char({ name: 'A' }), char({ name: 'B' })];
    const relations: Relation[] = [{ from: 'A', to: 'B', kind: '师徒', idx: 1 }];
    const { edges } = egoNetwork('A', characters, relations, { width: 200, height: 200 });
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe('师徒');
  });
});
