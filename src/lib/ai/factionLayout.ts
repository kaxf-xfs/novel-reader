/**
 * 增量 8 Task 6: 势力分组的关系图布局。纯几何计算，无外部依赖，确定性
 * （同输入同输出）。调用方必须传入已经过 codexForCutoff 过滤的
 * characters/relations——绝不能把未过滤的原始数据传进来，否则「哪些节点
 * 入选画布」「节点的可见 degree」会成为侧信道泄漏未来剧情。
 */

import type { Character, Relation } from './codex';

export interface GraphNode {
  name: string;
  x: number;
  y: number;
  group: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FactionGraphOptions {
  width: number;
  height: number;
  maxNodes?: number;
}

export interface FactionGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const DEFAULT_MAX_NODES = 30;
const MAX_GROUPS = 6;
const MIN_GROUPED_FRACTION = 0.3;
const UNGROUPED = '散';

function primaryGroup(c: Character): string | null {
  if (!c.groups.length) return null;
  return c.groups.reduce((best, g) => (g.idx > best.idx ? g : best)).name;
}

export function layoutFactionGraph(
  characters: Character[],
  relations: Relation[],
  opts: FactionGraphOptions,
): FactionGraphResult {
  const { width, height, maxNodes = DEFAULT_MAX_NODES } = opts;

  const degree = new Map<string, number>();
  for (const r of relations) {
    degree.set(r.from, (degree.get(r.from) ?? 0) + 1);
    degree.set(r.to, (degree.get(r.to) ?? 0) + 1);
  }

  const ranked = [...characters].sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0));
  const selected = ranked.slice(0, maxNodes);
  const selectedNames = new Set(selected.map((c) => c.name));

  let groupOf = new Map<string, string>(selected.map((c) => [c.name, primaryGroup(c) ?? UNGROUPED]));

  const groupCounts = new Map<string, number>();
  for (const g of groupOf.values()) groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
  const realGroupNames = [...groupCounts.keys()].filter((g) => g !== UNGROUPED);
  const groupedFraction = selected.length
    ? (selected.length - (groupCounts.get(UNGROUPED) ?? 0)) / selected.length
    : 0;
  const degraded = realGroupNames.length === 0 || groupedFraction < MIN_GROUPED_FRACTION;

  if (!degraded && realGroupNames.length > MAX_GROUPS) {
    const topGroups = new Set(
      realGroupNames.sort((a, b) => (groupCounts.get(b) ?? 0) - (groupCounts.get(a) ?? 0)).slice(0, MAX_GROUPS),
    );
    groupOf = new Map([...groupOf].map(([name, g]) => [name, topGroups.has(g) ? g : UNGROUPED]));
  }

  const cx = width / 2;
  const cy = height / 2;
  const nodes: GraphNode[] = [];

  if (degraded) {
    const radius = Math.min(width, height) / 2 - 24;
    selected.forEach((c, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, selected.length);
      nodes.push({ name: c.name, group: groupOf.get(c.name) ?? UNGROUPED, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
  } else {
    const groups = [...new Set(selected.map((c) => groupOf.get(c.name) ?? UNGROUPED))];
    const groupRadius = Math.min(width, height) / 2 - 48;
    groups.forEach((g, gi) => {
      const gAngle = (2 * Math.PI * gi) / groups.length;
      const gcx = cx + groupRadius * Math.cos(gAngle);
      const gcy = cy + groupRadius * Math.sin(gAngle);
      const members = selected.filter((c) => (groupOf.get(c.name) ?? UNGROUPED) === g);
      const memberRadius = 36 + members.length * 2;
      members.forEach((c, mi) => {
        const mAngle = (2 * Math.PI * mi) / Math.max(1, members.length);
        nodes.push({ name: c.name, group: g, x: gcx + memberRadius * Math.cos(mAngle), y: gcy + memberRadius * Math.sin(mAngle) });
      });
    });
  }

  const nodeByName = new Map(nodes.map((n) => [n.name, n]));
  const edges: GraphEdge[] = [];
  for (const r of relations) {
    if (!selectedNames.has(r.from) || !selectedNames.has(r.to)) continue;
    const a = nodeByName.get(r.from);
    const b = nodeByName.get(r.to);
    if (!a || !b) continue;
    edges.push({ from: r.from, to: r.to, kind: r.kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  return { nodes, edges };
}
