/**
 * 增量 8: 已读图鉴的数据类型 + 防剧透展示门。
 *
 * 红线不变量：每个可展示字段都带 idx；idx 一律由抽取代码盖章为其所属块的
 * maxIdx（见 codexExtract.ts），绝不采信 LLM 自报的 idx。codexForCutoff 是
 * 唯一允许把裸 Codex 转成可展示数据的入口——UI 层永不直接读未过滤的字段。
 */

export interface TextAtIdx {
  text: string;
  idx: number;
}

export interface NamedAtIdx {
  name: string;
  idx: number;
}

export interface Character {
  /** canonical 显示名：最早出现该人物的块（min firstChapterIdx）的字面名，永不被后续块覆盖。 */
  name: string;
  aliases: TextAtIdx[];
  identity: TextAtIdx[];
  origin?: TextAtIdx[];
  groups: NamedAtIdx[];
  firstChapterIdx: number;
  events?: TextAtIdx[];
}

export type TermCategory = '境界' | '势力' | '功法' | '地理' | '物品' | '其它';

export interface Term {
  name: string;
  category: TermCategory;
  /** 版本化释义；展示取 idx<=cutoff 中最新一条。 */
  def: TextAtIdx[];
  firstChapterIdx: number;
}

export interface Relation {
  /** 存 canonical name（Character.name）。 */
  from: string;
  to: string;
  kind: string;
  idx: number;
}

export interface Codex {
  characters: Character[];
  terms: Term[];
  relations: Relation[];
}

export const EMPTY_CODEX: Codex = { characters: [], terms: [], relations: [] };

function filterAtIdx<T extends { idx: number }>(arr: T[] | undefined, cutoff: number): T[] {
  return (arr ?? []).filter((x) => x.idx <= cutoff);
}

/** 唯一的展示门：把裸 Codex（可能含未来数据）过滤成可安全展示的 Codex。 */
export function codexForCutoff(codex: Codex, cutoff: number): Codex {
  const characters: Character[] = codex.characters
    .filter((c) => c.firstChapterIdx <= cutoff)
    .map((c) => ({
      name: c.name,
      aliases: filterAtIdx(c.aliases, cutoff),
      identity: filterAtIdx(c.identity, cutoff),
      origin: filterAtIdx(c.origin, cutoff),
      groups: filterAtIdx(c.groups, cutoff),
      firstChapterIdx: c.firstChapterIdx,
      events: filterAtIdx(c.events, cutoff),
    }));

  const visibleNames = new Set(characters.map((c) => c.name));

  const terms: Term[] = codex.terms
    .filter((t) => t.firstChapterIdx <= cutoff)
    .map((t) => {
      const visibleDefs = filterAtIdx(t.def, cutoff);
      const latest = visibleDefs.length
        ? visibleDefs.reduce((best, d) => (d.idx > best.idx ? d : best))
        : undefined;
      return { name: t.name, category: t.category, def: latest ? [latest] : [], firstChapterIdx: t.firstChapterIdx };
    });

  const relations: Relation[] = codex.relations.filter(
    (r) => r.idx <= cutoff && visibleNames.has(r.from) && visibleNames.has(r.to),
  );

  return { characters, terms, relations };
}
