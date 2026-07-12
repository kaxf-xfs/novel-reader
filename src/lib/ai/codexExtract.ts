/**
 * 增量 8 Task 4a: 已读图鉴的单块抽取。红线：所有 idx 由本文件盖章为块的
 * maxIdx，绝不采信 LLM 自报的 idx 字段（下面的 Raw* 类型干脆不声明 idx 字段，
 * 就算 LLM 塞进 JSON 也读不到）。finishReason==='length' 触发二分重试。
 */

import { AiError, type ChatMessage, type ChatResult } from './client';
import type { Character, Codex, Relation, Term, TermCategory } from './codex';
import { runPool } from './summarize';

export interface CodexSummaryItem {
  idx: number;
  summary: string;
}

export interface CodexBlock {
  items: CodexSummaryItem[];
}

export interface RosterEntry {
  name: string;
  aliases: string[];
}

export interface CodexBlockResult {
  maxIdx: number;
  partial: Partial<Codex>;
}

type CodexChatFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<ChatResult>;

const VALID_CATEGORIES: ReadonlySet<string> = new Set(['境界', '势力', '功法', '地理', '物品', '其它']);
const MAX_SPLIT_DEPTH = 4;

interface RawCharacter {
  name?: unknown;
  aliases?: unknown;
  identity?: unknown;
  origin?: unknown;
  groups?: unknown;
  events?: unknown;
}
interface RawTerm {
  name?: unknown;
  category?: unknown;
  def?: unknown;
}
interface RawRelation {
  from?: unknown;
  to?: unknown;
  kind?: unknown;
}
interface RawExtraction {
  characters?: RawCharacter[];
  terms?: RawTerm[];
  relations?: RawRelation[];
}

function extractMessages(block: CodexBlock, roster: RosterEntry[]): ChatMessage[] {
  const rosterText = roster.length
    ? `已知人物名册（请把新信息对齐到这些人物，或明确判断为新增人物；已知人物的新称呼/别名要归并到已知条目，不要当成新人物）：\n${roster
        .map((r) => `- ${r.name}${r.aliases.length ? '（别名：' + r.aliases.join('、') + '）' : ''}`)
        .join('\n')}`
    : '暂无已知人物名册（这是第一批抽取，出现的人物均视为新增）。';
  const summariesText = block.items.map((it, i) => `[${i + 1}] ${it.summary}`).join('\n');
  return [
    {
      role: 'system',
      content:
        '你是中文小说的信息抽取助手。请从给定的一批章节小结中抽取人物、世界观词条、人物关系，只输出一个 JSON 对象，' +
        '格式：{"characters":[{"name":"","aliases":[""],"identity":[""],"origin":[""],"groups":[""],"events":[""]}],' +
        '"terms":[{"name":"","category":"境界|势力|功法|地理|物品|其它","def":""}],' +
        '"relations":[{"from":"","to":"","kind":""}]}。' +
        '人物的 name 用其在这批小结中首次出现时的称呼；如果小结里透露了该人物的其他称呼、真实姓名，把新称呼放进 aliases，不要修改 name。' +
        'relations 的 from/to 必须是本次输出的 characters 中的 name，或已知名册中的人物，否则不要输出这条关系。' +
        '只依据给定文本抽取，不要编造信息；输出的 JSON 不需要、也不应该包含任何章节序号或 idx 字段。\n\n' +
        rosterText,
    },
    { role: 'user', content: summariesText },
  ];
}

function parseJsonBlock(raw: string): RawExtraction | null {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(raw) ?? /```\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced ? fenced[1] : raw).trim();
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as RawExtraction) : null;
  } catch {
    return null;
  }
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}

function stampBlock(raw: RawExtraction, maxIdx: number): Partial<Codex> {
  const characters: Character[] = [];
  for (const rc of raw.characters ?? []) {
    if (!rc || typeof rc.name !== 'string' || !rc.name.trim()) continue; // 坏实体跳过，不影响其余
    characters.push({
      name: rc.name.trim(),
      aliases: stringArray(rc.aliases).map((text) => ({ text, idx: maxIdx })),
      identity: stringArray(rc.identity).map((text) => ({ text, idx: maxIdx })),
      origin: stringArray(rc.origin).map((text) => ({ text, idx: maxIdx })),
      groups: stringArray(rc.groups).map((name) => ({ name, idx: maxIdx })),
      firstChapterIdx: maxIdx,
      events: stringArray(rc.events).map((text) => ({ text, idx: maxIdx })),
    });
  }

  const terms: Term[] = [];
  for (const rt of raw.terms ?? []) {
    if (!rt || typeof rt.name !== 'string' || !rt.name.trim()) continue;
    if (typeof rt.def !== 'string' || !rt.def.trim()) continue;
    const category: TermCategory = VALID_CATEGORIES.has(rt.category as string)
      ? (rt.category as TermCategory)
      : '其它';
    terms.push({ name: rt.name.trim(), category, def: [{ text: rt.def.trim(), idx: maxIdx }], firstChapterIdx: maxIdx });
  }

  const relations: Relation[] = [];
  for (const rr of raw.relations ?? []) {
    if (!rr || typeof rr.from !== 'string' || typeof rr.to !== 'string' || typeof rr.kind !== 'string') continue;
    if (!rr.from.trim() || !rr.to.trim() || !rr.kind.trim()) continue;
    relations.push({ from: rr.from.trim(), to: rr.to.trim(), kind: rr.kind.trim(), idx: maxIdx });
  }

  return { characters, terms, relations };
}

async function extractOneBlock(
  chat: CodexChatFn,
  block: CodexBlock,
  roster: RosterEntry[],
  signal: AbortSignal | undefined,
  depth: number,
): Promise<Partial<Codex>> {
  const maxIdx = Math.max(...block.items.map((it) => it.idx));
  const result = await chat(extractMessages(block, roster), signal);
  const truncated = result.finishReason === 'length';

  if (truncated && block.items.length > 1 && depth < MAX_SPLIT_DEPTH) {
    const mid = Math.ceil(block.items.length / 2);
    const left = await extractOneBlock(chat, { items: block.items.slice(0, mid) }, roster, signal, depth + 1);
    const right = await extractOneBlock(chat, { items: block.items.slice(mid) }, roster, signal, depth + 1);
    return {
      characters: [...(left.characters ?? []), ...(right.characters ?? [])],
      terms: [...(left.terms ?? []), ...(right.terms ?? [])],
      relations: [...(left.relations ?? []), ...(right.relations ?? [])],
    };
  }

  const parsed = parseJsonBlock(result.content);
  if (!parsed) return { characters: [], terms: [], relations: [] }; // 坏 JSON：整块跳过，不炸
  return stampBlock(parsed, maxIdx);
}

export async function extractCodex(
  deps: { chat: CodexChatFn },
  params: {
    blocks: CodexBlock[];
    roster: RosterEntry[];
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    concurrency?: number;
  },
): Promise<CodexBlockResult[]> {
  const { blocks, roster, signal, onProgress, concurrency = 3 } = params;
  const results: CodexBlockResult[] = new Array(blocks.length);
  let done = 0;
  await runPool(
    blocks.map((b, i) => ({ b, i })),
    concurrency,
    async ({ b, i }) => {
      if (signal?.aborted) throw new AiError('cancelled', 'AI 已取消');
      const maxIdx = Math.max(...b.items.map((it) => it.idx));
      const partial = await extractOneBlock(deps.chat, b, roster, signal, 0);
      results[i] = { maxIdx, partial };
      done += 1;
      onProgress?.(done, blocks.length);
    },
  );
  return results;
}
