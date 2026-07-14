/**
 * 增量 8.5: 图鉴润色 pass。纯函数部分：碎片指纹 + 脏检测。
 *
 * 指纹覆盖的字段集合必须和喂给润色 prompt 的字段集合完全一致——人物是
 * identity+origin+events，词条是 def。若某个字段更新了但没进指纹，会造成
 * "该更新简介却没更新"的过期问题（不是泄漏，但是体验倒退）。
 */
import { AiError, type ChatMessage, type ChatResult } from './client';
import type { Character, Codex, TextAtIdx, Term } from './codex';
import { runPool } from './summarize';

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function sortedFragmentKey(arr: TextAtIdx[] | undefined): string {
  return (arr ?? [])
    .map((x) => JSON.stringify({ idx: x.idx, text: x.text }))
    .sort()
    .join('|');
}

export function characterFragmentHash(c: Character): string {
  const key = [
    sortedFragmentKey(c.identity),
    sortedFragmentKey(c.origin),
    sortedFragmentKey(c.events),
  ].join('##');
  return fnv1a(key);
}

export function termFragmentHash(t: Term): string {
  return fnv1a(sortedFragmentKey(t.def));
}

export function isCharacterDirty(c: Character): boolean {
  return c.bioHash !== characterFragmentHash(c);
}

export function isTermDirty(t: Term): boolean {
  return t.glossHash !== termFragmentHash(t);
}

export type PolishChatFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<ChatResult>;

const BATCH_SIZE = 6;
const CONCURRENCY = 3;
const MIN_DEF_FRAGMENTS_FOR_GLOSS = 2;

interface PolishCharacterTask {
  kind: 'character';
  index: number;
  name: string;
  fragments: TextAtIdx[];
}
interface PolishTermTask {
  kind: 'term';
  index: number;
  name: string;
  fragments: TextAtIdx[];
}
type PolishTask = PolishCharacterTask | PolishTermTask;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function polishMessages(tasks: PolishTask[]): ChatMessage[] {
  const characterTasks = tasks.filter((t): t is PolishCharacterTask => t.kind === 'character');
  const termTasks = tasks.filter((t): t is PolishTermTask => t.kind === 'term');
  const lines: string[] = [];
  if (characterTasks.length) {
    lines.push('人物：');
    for (const t of characterTasks) lines.push(`- ${t.name}：${t.fragments.map((f) => f.text).join('；')}`);
  }
  if (termTasks.length) {
    lines.push('词条：');
    for (const t of termTasks) lines.push(`- ${t.name}：${t.fragments.map((f) => f.text).join('；')}`);
  }
  return [
    {
      role: 'system',
      content:
        '你是中文小说的编辑助手。下面给出若干人物/词条各自零散的事实碎片，请把同一人物/词条的碎片整合成一段连贯、通顺的' +
        '简介或释义。只使用给定信息，不得新增、推测或评论；人物简介用第三人称、60-140字；词条释义力求简洁准确。' +
        '不要出现章节序号。只输出一个 JSON 对象：{"bios":[{"name":"","bio":""}],"glosses":[{"name":"","gloss":""}]}' +
        '（没有词条就省略 glosses 或给空数组，没有人物同理）。',
    },
    { role: 'user', content: lines.join('\n') },
  ];
}

interface RawPolishResult {
  bios?: { name?: unknown; bio?: unknown }[];
  glosses?: { name?: unknown; gloss?: unknown }[];
}

function parsePolishJson(raw: string): RawPolishResult | null {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(raw) ?? /```\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced ? fenced[1] : raw).trim();
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as RawPolishResult) : null;
  } catch {
    return null;
  }
}

export async function polishCodex(
  deps: { chat: PolishChatFn },
  params: { codex: Codex; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<Codex> {
  const { codex, signal, onProgress } = params;
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new AiError('cancelled', 'AI 已取消');
  };
  throwIfCancelled();

  const characters = codex.characters.map((c) => ({ ...c }));
  const terms = codex.terms.map((t) => ({ ...t }));

  const tasks: PolishTask[] = [];
  characters.forEach((c, index) => {
    if (!isCharacterDirty(c)) return;
    const fragments = [...(c.identity ?? []), ...(c.origin ?? []), ...(c.events ?? [])];
    tasks.push({ kind: 'character', index, name: c.name, fragments });
  });
  terms.forEach((t, index) => {
    if (!isTermDirty(t)) return;
    if ((t.def ?? []).length < MIN_DEF_FRAGMENTS_FOR_GLOSS) return; // 单碎片词条不值得润色，省 token
    tasks.push({ kind: 'term', index, name: t.name, fragments: t.def });
  });

  const batches = chunk(tasks, BATCH_SIZE);
  let done = 0;
  await runPool(batches, CONCURRENCY, async (batch) => {
    throwIfCancelled();
    // 红线：批次内所有实体统一盖章为该批次输入碎片的最大 idx（复用 stampBlock 的
    // 规则），绝不逐实体各自计算自己碎片的最大 idx——否则 LLM 跨实体信息串扰会
    // 让碎片较少/较早的实体提前泄漏批内其他实体的后期剧情。
    const batchMaxIdx = Math.max(...batch.flatMap((t) => t.fragments.map((f) => f.idx)));
    const result = await deps.chat(polishMessages(batch), signal);
    throwIfCancelled();
    const parsed = parsePolishJson(result.content);
    if (!parsed) return; // 坏 JSON：这一批全部保持脏状态，下轮重试，不炸

    for (const rb of parsed.bios ?? []) {
      if (!rb || typeof rb.name !== 'string' || typeof rb.bio !== 'string' || !rb.bio.trim()) continue;
      const task = batch.find((t) => t.kind === 'character' && t.name === rb.name);
      if (!task) continue; // 名字对不上任何本批实体，跳过
      const c = characters[task.index];
      const lastBio = c.bio?.[c.bio.length - 1];
      if (lastBio?.text === rb.bio.trim()) {
        characters[task.index] = { ...c, bioHash: characterFragmentHash(c) };
        continue;
      }
      // append 然后设 hash，中间无 await——一次中断只会让实体停在"完全脏"，绝不半更新。
      const nextBio = [...(c.bio ?? []), { text: rb.bio.trim(), idx: batchMaxIdx }];
      characters[task.index] = { ...c, bio: nextBio, bioHash: characterFragmentHash(c) };
    }

    for (const rg of parsed.glosses ?? []) {
      if (!rg || typeof rg.name !== 'string' || typeof rg.gloss !== 'string' || !rg.gloss.trim()) continue;
      const task = batch.find((t) => t.kind === 'term' && t.name === rg.name);
      if (!task) continue;
      const t = terms[task.index];
      const lastGloss = t.gloss?.[t.gloss.length - 1];
      if (lastGloss?.text === rg.gloss.trim()) {
        terms[task.index] = { ...t, glossHash: termFragmentHash(t) };
        continue;
      }
      const nextGloss = [...(t.gloss ?? []), { text: rg.gloss.trim(), idx: batchMaxIdx }];
      terms[task.index] = { ...t, gloss: nextGloss, glossHash: termFragmentHash(t) };
    }

    done += 1;
    onProgress?.(done, batches.length);
  });

  return { characters, terms, relations: codex.relations };
}
