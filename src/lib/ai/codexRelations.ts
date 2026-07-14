/**
 * 增量 8.5: 关系呈现从整体网状图改为按势力分组的树状/标签列表。空间布局算法
 * （原 factionLayout.ts 的 layoutFactionGraph）已删除；分组逻辑（primaryGroup/
 * UNGROUPED）本身没问题，保留并导出。
 *
 * 关键红线：Relation.kind 的方向是 LLM 逐块独立推断的自由文本，没有跨块一致性
 * 校验，codexMerge.ts 的去重 key 含 kind 但不含方向无关性，会让 (A,B,师徒) 和
 * (B,A,师徒) 同时保留。buildGroupedRoster 在建树前必须把树类关系按无序对+kind
 * 归一化，合并互为反向的重复关系，且已经挂树的这对关系不能再落进芯片。
 */
import type { Character, Relation } from './codex';

export const UNGROUPED = '散';

export function primaryGroup(c: Character): string | null {
  if (!c.groups.length) return null;
  return c.groups.reduce((best, g) => (g.idx > best.idx ? g : best)).name;
}

export const TREE_KINDS: ReadonlySet<string> = new Set([
  '师徒', '师父', '师傅', '徒弟', '父子', '母子', '父女', '母女', '亲缘', '血缘', '家族', '主仆', '上下级',
]);

export function isTreeKind(kind: string): boolean {
  return TREE_KINDS.has(kind.trim());
}

export interface RelationChip {
  otherName: string;
  kind: string;
}

export interface RosterNode {
  name: string;
  subtitle?: string;
  depth: number;
  chips: RelationChip[];
}

export interface GroupSection {
  group: string;
  nodes: RosterNode[];
}

function sortedPairKey(a: string, b: string, kind: string): string {
  const [x, y] = [a, b].sort();
  return `${x}|${y}|${kind}`;
}

export function buildGroupedRoster(characters: Character[], relations: Relation[]): GroupSection[] {
  const groupOf = new Map<string, string>(characters.map((c) => [c.name, primaryGroup(c) ?? UNGROUPED]));

  // 1) 归一化树类关系：互为反向的同一对+kind 合并成一条，方向按较小 idx 的那次
  //    揭示为准（更早出现的判断更值得信任；平局按 from 字符序，保证确定性）。
  const treeRelBySortedKey = new Map<string, Relation>();
  const nonTreeRelations: Relation[] = [];
  for (const r of relations) {
    if (!isTreeKind(r.kind)) {
      nonTreeRelations.push(r);
      continue;
    }
    const key = sortedPairKey(r.from, r.to, r.kind);
    const existing = treeRelBySortedKey.get(key);
    if (!existing) {
      treeRelBySortedKey.set(key, r);
    } else if (r.idx < existing.idx || (r.idx === existing.idx && r.from < existing.from)) {
      treeRelBySortedKey.set(key, r); // 更早揭示（或确定性平局）的方向胜出
    }
  }
  const canonicalTreeRelations = [...treeRelBySortedKey.values()];

  // 2) 组内建树：只在同组内的树类关系里建父子关系；跨组的树类关系降级为芯片。
  const parentOf = new Map<string, string>(); // child -> parent，先到者赢（防环/多父）
  const childrenOf = new Map<string, string[]>();
  const treePairsRendered = new Set<string>(); // "A|B" 双向 key，标记这对已经是树边，芯片阶段要跳过
  for (const r of canonicalTreeRelations) {
    const gf = groupOf.get(r.from);
    const gt = groupOf.get(r.to);
    if (gf === undefined || gt === undefined || gf !== gt) {
      nonTreeRelations.push(r); // 跨组的树类关系当芯片处理
      continue;
    }
    if (parentOf.has(r.to)) continue; // 已经有父节点了（先到者赢，防止多父/环）
    if (isAncestor(parentOf, r.from, r.to)) continue; // 会成环，跳过，保留为孤儿（不建这条边）
    parentOf.set(r.to, r.from);
    childrenOf.set(r.from, [...(childrenOf.get(r.from) ?? []), r.to]);
    const [x, y] = [r.from, r.to].sort();
    treePairsRendered.add(`${x}|${y}`);
  }

  // 3) 非树关系（含跨组树类关系降级）→ 芯片，排除已经渲染为树边的那一对。
  const chipsByName = new Map<string, RelationChip[]>();
  for (const r of nonTreeRelations) {
    const [x, y] = [r.from, r.to].sort();
    if (treePairsRendered.has(`${x}|${y}`)) continue; // 树边与芯片互斥
    chipsByName.set(r.from, [...(chipsByName.get(r.from) ?? []), { otherName: r.to, kind: r.kind }]);
    chipsByName.set(r.to, [...(chipsByName.get(r.to) ?? []), { otherName: r.from, kind: r.kind }]);
  }

  // 4) 按组分桶，组内先放根节点（无父）再深度优先展开子树。
  const sections = new Map<string, RosterNode[]>();
  for (const c of characters) {
    const g = groupOf.get(c.name) ?? UNGROUPED;
    if (!sections.has(g)) sections.set(g, []);
  }
  const visited = new Set<string>();
  function emit(name: string, depth: number, group: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const subtitle = characterSubtitle(characters.find((c) => c.name === name));
    sections.get(group)!.push({ name, subtitle, depth, chips: chipsByName.get(name) ?? [] });
    for (const child of childrenOf.get(name) ?? []) emit(child, depth + 1, group);
  }
  for (const c of characters) {
    const g = groupOf.get(c.name) ?? UNGROUPED;
    if (!parentOf.has(c.name)) emit(c.name, 0, g); // 根节点（没有父）先展开
  }
  for (const c of characters) emit(c.name, 0, groupOf.get(c.name) ?? UNGROUPED); // 兜底：理论上不会再有遗漏

  return [...sections.entries()].map(([group, nodes]) => ({ group, nodes }));
}

function isAncestor(parentOf: Map<string, string>, candidateAncestor: string, node: string): boolean {
  let cur: string | undefined = candidateAncestor;
  const guard = new Set<string>();
  while (cur !== undefined) {
    if (cur === node) return true;
    if (guard.has(cur)) return false; // 已经检测到环，安全退出
    guard.add(cur);
    cur = parentOf.get(cur);
  }
  return false;
}

function characterSubtitle(c: Character | undefined): string | undefined {
  if (!c) return undefined;
  return c.bio?.[0]?.text ?? c.identity?.[0]?.text;
}
