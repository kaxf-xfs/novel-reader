/**
 * 增量 8 Task 4b: 结构化图鉴的确定性合并（YAGNI：先不引入 LLM 归并 pass，
 * 碎片化/重复人物列为真机验收项，观测到再补）。
 *
 * 红线 A：partials（来自 runPool 并发抽取，天然无序）折叠前必须按块 maxIdx
 * 升序排序，让「first-write-wins」等价于「最早块优先」——否则并发产出顺序
 * 可能让一个后续（更高 idx）块先被折叠，把「未来真名」错误地固化成
 * canonical name，绕开防剧透。
 */

import type { Character, Codex, NamedAtIdx, Relation, Term, TextAtIdx } from './codex';
import type { CodexBlockResult } from './codexExtract';

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

// 匹配候选取「候选名 + 候选别名」的并集：block B 可能只在 aliases 里带出旧名
// （见 Step 1 测试），若只拿 incoming.name 去比对会漏掉这个锚点，导致同一人物
// 被误判成新增角色、canonical name 红线守卫失效。
function findCharacterIndex(chars: Character[], candidates: string[]): number {
  const keys = new Set(candidates.map(normalize));
  return chars.findIndex(
    (c) => keys.has(normalize(c.name)) || c.aliases.some((a) => keys.has(normalize(a.text))),
  );
}

function candidateNames(c: Character): string[] {
  return [c.name, ...c.aliases.map((a) => a.text)];
}

// 规范化：去首尾空白 + 去掉句末标点 + 再次去首尾空白，用于判断"是否互为子串"，
// 不用于最终展示文本。二次 trim 是必须的：形如「出身贫寒 。」（标点前带空格）
// 剥掉句末标点后会留下尾部空格，若不再 trim 一次就无法归一到「出身贫寒」。
function normalizeForContainment(s: string): string {
  return s
    .trim()
    .replace(/[。！？，；、,.!?;]+$/u, '')
    .trim();
}

/**
 * 包含关系去重：新碎片的规范化文本若是已存在碎片的子串（或反之），只保留更长者。
 * 红线：保留更长者时，idx 取被保留的那条（更长的那条）自身的 idx——绝不取两者
 * 中的较小值，也绝不沿用被丢弃的较短碎片的 idx。更长的文本承载的信息就是在它
 * 自己的 idx 才被揭示的，去重不能让信息提前于其被揭示的时间点展示。
 *
 * 一条新碎片可能同时文本包含多条已存在的碎片（例如新碎片是多条旧碎片拼接后的
 * 概括），此时必须把所有被包含的旧碎片都找出来并移除，只插入一次新碎片——
 * 而不是只处理第一条匹配就 break，导致其余被包含的旧碎片沦为冗余的"未去重"条目。
 */
function dedupeTextAtIdx(base: TextAtIdx[], incoming: TextAtIdx[]): TextAtIdx[] {
  let out = [...base];
  for (const x of incoming) {
    const xNorm = normalizeForContainment(x.text);

    // 精确重复（含规范化后相同）→ 丢弃新条目，保留旧条目原样（fold 顺序中先出现的那条）
    const exactDup = out.some((e) => normalizeForContainment(e.text) === xNorm);
    if (exactDup) continue;

    // 已存在某条严格更长且包含新条目 → 新条目已被吸收，直接丢弃
    const dominatedByExisting = out.some((e) => {
      const eNorm = normalizeForContainment(e.text);
      return eNorm.length > xNorm.length && eNorm.includes(xNorm);
    });
    if (dominatedByExisting) continue;

    // 新条目严格更长且包含某些旧条目 → 找出全部（可能不止一条）被吸收的旧条目，
    // 一次性移除，只插入一次新条目（自带它自己的 idx）
    const subsumed = out.filter((e) => {
      const eNorm = normalizeForContainment(e.text);
      return xNorm.length > eNorm.length && xNorm.includes(eNorm);
    });
    if (subsumed.length > 0) {
      out = out.filter((e) => !subsumed.includes(e));
    }
    out.push(x);
  }
  return out;
}

function dedupeNamedAtIdx(base: NamedAtIdx[], incoming: NamedAtIdx[]): NamedAtIdx[] {
  const seen = new Set(base.map((x) => `${x.name} ${x.idx}`));
  const out = [...base];
  for (const x of incoming) {
    const key = `${x.name} ${x.idx}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(x);
    }
  }
  return out;
}

function mergeCharacterInto(base: Character, incoming: Character): Character {
  const incomingIsNewName =
    normalize(base.name) !== normalize(incoming.name) &&
    !base.aliases.some((a) => normalize(a.text) === normalize(incoming.name));
  const aliasesWithDedup = dedupeTextAtIdx(base.aliases, incoming.aliases);
  const aliases = incomingIsNewName
    ? dedupeTextAtIdx(aliasesWithDedup, [{ text: incoming.name, idx: incoming.firstChapterIdx }])
    : aliasesWithDedup;

  return {
    name: base.name, // A 红线：永不被后续块覆盖（partials 已按 maxIdx 升序折叠，base 恒是最早块）
    aliases,
    identity: dedupeTextAtIdx(base.identity, incoming.identity),
    origin: dedupeTextAtIdx(base.origin ?? [], incoming.origin ?? []),
    groups: dedupeNamedAtIdx(base.groups, incoming.groups),
    firstChapterIdx: Math.min(base.firstChapterIdx, incoming.firstChapterIdx),
    events: dedupeTextAtIdx(base.events ?? [], incoming.events ?? []),
  };
}

function resolveCanonicalName(characters: Character[], nameOrAlias: string): string {
  const idx = findCharacterIndex(characters, [nameOrAlias]);
  return idx === -1 ? nameOrAlias : characters[idx].name;
}

export function mergeCodex(existing: Codex, blockResults: CodexBlockResult[]): Codex {
  const sorted = [...blockResults].sort((a, b) => a.maxIdx - b.maxIdx); // 红线 A

  const characters: Character[] = existing.characters.map((c) => ({ ...c }));
  const terms: Term[] = existing.terms.map((t) => ({ ...t }));
  let relations: Relation[] = [...existing.relations];

  for (const { partial } of sorted) {
    for (const incoming of partial.characters ?? []) {
      const idx = findCharacterIndex(characters, candidateNames(incoming));
      if (idx === -1) {
        characters.push({ ...incoming });
      } else {
        characters[idx] = mergeCharacterInto(characters[idx], incoming);
      }
    }

    for (const incomingTerm of partial.terms ?? []) {
      const idx = terms.findIndex((t) => normalize(t.name) === normalize(incomingTerm.name));
      if (idx === -1) {
        terms.push({ ...incomingTerm });
      } else {
        terms[idx] = {
          name: terms[idx].name,
          category: terms[idx].category, // first-write-wins：不被后块改判
          def: dedupeTextAtIdx(terms[idx].def, incomingTerm.def),
          firstChapterIdx: Math.min(terms[idx].firstChapterIdx, incomingTerm.firstChapterIdx),
        };
      }
    }

    for (const incomingRel of partial.relations ?? []) {
      const key = `${normalize(incomingRel.from)} ${normalize(incomingRel.to)} ${normalize(incomingRel.kind)}`;
      const exists = relations.some(
        (r) => `${normalize(r.from)} ${normalize(r.to)} ${normalize(r.kind)}` === key,
      );
      if (!exists) relations.push({ ...incomingRel });
    }
  }

  relations = relations.map((r) => ({
    ...r,
    from: resolveCanonicalName(characters, r.from),
    to: resolveCanonicalName(characters, r.to),
  }));

  return { characters, terms, relations };
}
