import type { Character, Term } from '../codex';
import { characterFragmentHash, isCharacterDirty, isTermDirty, termFragmentHash } from '../codexPolish';
import type { ChatMessage, ChatResult } from '../client';
import { EMPTY_CODEX, type Codex } from '../codex';
import { polishCodex } from '../codexPolish';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

function term(over: Partial<Term>): Term {
  return { name: 'T', category: '其它', def: [], firstChapterIdx: 0, ...over };
}

describe('characterFragmentHash', () => {
  it('is order-independent: same fragments in a different array order produce the same hash', () => {
    const a = char({
      identity: [{ text: 'A', idx: 1 }, { text: 'B', idx: 2 }],
      origin: [{ text: 'C', idx: 3 }],
      events: [{ text: 'D', idx: 4 }],
    });
    const b = char({
      identity: [{ text: 'B', idx: 2 }, { text: 'A', idx: 1 }],
      origin: [{ text: 'C', idx: 3 }],
      events: [{ text: 'D', idx: 4 }],
    });
    expect(characterFragmentHash(a)).toBe(characterFragmentHash(b));
  });

  it('changes when any fed field (identity/origin/events) changes', () => {
    const base = char({ identity: [{ text: 'A', idx: 1 }] });
    const changed = char({ identity: [{ text: 'A', idx: 1 }, { text: 'NEW', idx: 5 }] });
    expect(characterFragmentHash(base)).not.toBe(characterFragmentHash(changed));
    const changedOrigin = char({ identity: [{ text: 'A', idx: 1 }], origin: [{ text: 'NEW-ORIGIN', idx: 5 }] });
    expect(characterFragmentHash(base)).not.toBe(characterFragmentHash(changedOrigin));
    const changedEvents = char({ identity: [{ text: 'A', idx: 1 }], events: [{ text: 'NEW-EVENT', idx: 5 }] });
    expect(characterFragmentHash(base)).not.toBe(characterFragmentHash(changedEvents));
  });

  it('does not collide when fragment text contains delimiter-like characters that could fake-merge across boundaries', () => {
    // Before the fix, `${idx}:${text}` joined by '|' let a single fragment
    // {idx:1, text:"a|2:b"} and two fragments {idx:1,text:"a"},{idx:2,text:"b"}
    // both serialize to "1:a|2:b" — a genuine hash collision on different content.
    const oneFragment = char({ identity: [{ text: 'a|2:b', idx: 1 }] });
    const twoFragments = char({ identity: [{ text: 'a', idx: 1 }, { text: 'b', idx: 2 }] });
    expect(characterFragmentHash(oneFragment)).not.toBe(characterFragmentHash(twoFragments));
  });
});

describe('termFragmentHash', () => {
  it('is order-independent and changes when def changes', () => {
    const a = term({ def: [{ text: 'A', idx: 1 }, { text: 'B', idx: 2 }] });
    const b = term({ def: [{ text: 'B', idx: 2 }, { text: 'A', idx: 1 }] });
    expect(termFragmentHash(a)).toBe(termFragmentHash(b));
    const changed = term({ def: [{ text: 'A', idx: 1 }, { text: 'C', idx: 3 }] });
    expect(termFragmentHash(a)).not.toBe(termFragmentHash(changed));
  });
});

describe('isCharacterDirty / isTermDirty', () => {
  it('a character with no bioHash yet is dirty by definition', () => {
    const c = char({ identity: [{ text: 'A', idx: 1 }] });
    expect(isCharacterDirty(c)).toBe(true);
  });

  it('a character whose bioHash matches its current fragment hash is clean', () => {
    const c = char({ identity: [{ text: 'A', idx: 1 }] });
    const withHash: Character = { ...c, bioHash: characterFragmentHash(c) };
    expect(isCharacterDirty(withHash)).toBe(false);
  });

  it('a character whose fragments changed after bioHash was set becomes dirty again', () => {
    const c = char({ identity: [{ text: 'A', idx: 1 }] });
    const withHash: Character = { ...c, bioHash: characterFragmentHash(c) };
    const mutated: Character = { ...withHash, identity: [...withHash.identity, { text: 'NEW', idx: 9 }] };
    expect(isCharacterDirty(mutated)).toBe(true);
  });

  it('a term with no glossHash yet is dirty; matching glossHash is clean; changed def is dirty again', () => {
    const t = term({ def: [{ text: 'A', idx: 1 }] });
    expect(isTermDirty(t)).toBe(true);
    const withHash: Term = { ...t, glossHash: termFragmentHash(t) };
    expect(isTermDirty(withHash)).toBe(false);
    const mutated: Term = { ...withHash, def: [...withHash.def, { text: 'NEW', idx: 9 }] };
    expect(isTermDirty(mutated)).toBe(true);
  });
});

function codexWithDirtyCharacter(fragments: { text: string; idx: number }[]): Codex {
  return {
    ...EMPTY_CODEX,
    characters: [char({ name: '林某', identity: fragments, firstChapterIdx: fragments[0]?.idx ?? 0 })],
  };
}

describe('polishCodex', () => {
  it('CRITICAL: all entities polished within ONE call are stamped with that call\'s batch-wide max fragment idx, never each entity\'s own individually-computed max idx', async () => {
    // 一批里两个人物：主角碎片追到 idx=1900，次要人物碎片只到 idx=30。
    const codex: Codex = {
      ...EMPTY_CODEX,
      characters: [
        char({ name: '主角', identity: [{ text: '早年经历', idx: 100 }, { text: '晚期黑化', idx: 1900 }], firstChapterIdx: 100 }),
        char({ name: '次要人物', identity: [{ text: '出场描写', idx: 30 }], firstChapterIdx: 30 }),
      ],
    };
    const chat = jest.fn(async (): Promise<ChatResult> => ({
      content: JSON.stringify({ bios: [{ name: '主角', bio: '主角简介' }, { name: '次要人物', bio: '次要人物简介' }] }),
      finishReason: 'stop',
    }));
    const result = await polishCodex({ chat }, { codex });
    const zhuJue = result.characters.find((c) => c.name === '主角')!;
    const ciYao = result.characters.find((c) => c.name === '次要人物')!;
    // 两者必须是同一个 idx（该次调用输入碎片的全局最大值 1900），而不是次要人物自己的 30。
    expect(zhuJue.bio?.[0].idx).toBe(1900);
    expect(ciYao.bio?.[0].idx).toBe(1900); // 红线：绝不是 30
  });

  it('only polishes dirty entities (bioHash mismatch); clean entities are left untouched', async () => {
    const clean = char({ name: '干净', identity: [{ text: 'A', idx: 1 }], firstChapterIdx: 1 });
    const cleanWithHash: typeof clean = { ...clean, bioHash: characterFragmentHash(clean), bio: [{ text: '已有简介', idx: 1 }] };
    const dirty = char({ name: '脏', identity: [{ text: 'B', idx: 2 }], firstChapterIdx: 2 });
    const codex: Codex = { ...EMPTY_CODEX, characters: [cleanWithHash, dirty] };
    // 显式声明参数类型（而非省略参数）：否则 TS 会把 chat.mock.calls 推断成 []
    // 的元组数组，下面 chat.mock.calls[0][0] 的下标访问会报 tsc 严格模式错误。
    const chat = jest.fn(async (_messages: ChatMessage[]): Promise<ChatResult> => ({
      content: JSON.stringify({ bios: [{ name: '脏', bio: '脏的新简介' }] }),
      finishReason: 'stop',
    }));
    const result = await polishCodex({ chat }, { codex });
    expect(chat).toHaveBeenCalledTimes(1);
    const sentBody = JSON.stringify(chat.mock.calls[0][0]);
    expect(sentBody).not.toContain('干净'); // 干净的实体不应出现在发给 LLM 的输入里
    expect(result.characters.find((c) => c.name === '干净')?.bio).toEqual([{ text: '已有简介', idx: 1 }]); // 原样保留
    expect(result.characters.find((c) => c.name === '脏')?.bio?.[0].text).toBe('脏的新简介');
  });

  it('batches dirty entities (~6 per call) rather than one call per entity', async () => {
    const characters = Array.from({ length: 13 }, (_, i) =>
      char({ name: `角色${i}`, identity: [{ text: `碎片${i}`, idx: i }], firstChapterIdx: i }),
    );
    const codex: Codex = { ...EMPTY_CODEX, characters };
    const chat = jest.fn(async (messages: ChatMessage[]): Promise<ChatResult> => {
      const userMsg = messages.find((m) => m.role === 'user')!.content;
      const names = [...userMsg.matchAll(/角色\d+/g)].map((m) => m[0]);
      return { content: JSON.stringify({ bios: names.map((name) => ({ name, bio: `${name}的简介` })) }), finishReason: 'stop' };
    });
    await polishCodex({ chat }, { codex });
    expect(chat.mock.calls.length).toBeGreaterThanOrEqual(3); // 13 个实体 / ~6 每批 → 至少 3 批
    expect(chat.mock.calls.length).toBeLessThan(13); // 明显少于「一人一次调用」
  });

  it('does not append a new bio version when the polished text is identical to the last version', async () => {
    const c = char({ name: '林某', identity: [{ text: 'A', idx: 1 }], firstChapterIdx: 1 });
    const withBio: typeof c = { ...c, bio: [{ text: '不变的简介', idx: 1 }] }; // bioHash 缺失 → 仍是脏的，会被重新润色
    const codex: Codex = { ...EMPTY_CODEX, characters: [withBio] };
    const chat = jest.fn(async (): Promise<ChatResult> => ({
      content: JSON.stringify({ bios: [{ name: '林某', bio: '不变的简介' }] }),
      finishReason: 'stop',
    }));
    const result = await polishCodex({ chat }, { codex });
    expect(result.characters[0].bio).toHaveLength(1); // 没有因为文本相同而多追加一条
  });

  it('bad JSON from the LLM leaves the entity dirty (bioHash unset) and does not throw', async () => {
    const codex = codexWithDirtyCharacter([{ text: 'A', idx: 1 }]);
    const chat = jest.fn(async (): Promise<ChatResult> => ({ content: 'not json at all', finishReason: 'stop' }));
    const result = await polishCodex({ chat }, { codex });
    expect(result.characters[0].bio ?? []).toEqual([]);
    expect(result.characters[0].bioHash).toBeUndefined();
  });

  it('a missing/unmatched name in the response is skipped, not crashing the whole batch', async () => {
    const codex = codexWithDirtyCharacter([{ text: 'A', idx: 1 }]);
    const chat = jest.fn(async (): Promise<ChatResult> => ({
      content: JSON.stringify({ bios: [{ name: '完全不相关的名字', bio: 'x' }] }),
      finishReason: 'stop',
    }));
    const result = await polishCodex({ chat }, { codex });
    expect(result.characters[0].bio ?? []).toEqual([]); // 林某没有被匹配到，仍是空
  });

  it('propagates cancellation via AiError(cancelled) when signal is already aborted', async () => {
    const codex = codexWithDirtyCharacter([{ text: 'A', idx: 1 }]);
    const ctrl = new AbortController();
    ctrl.abort();
    const chat = jest.fn(async (): Promise<ChatResult> => ({ content: '{}', finishReason: 'stop' }));
    await expect(polishCodex({ chat }, { codex, signal: ctrl.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('only polishes terms with >= 2 def fragments', async () => {
    const singleDefTerm = term({ name: '单条词条', def: [{ text: 'A', idx: 1 }], firstChapterIdx: 1 });
    const multiDefTerm = term({ name: '多条词条', def: [{ text: 'B', idx: 1 }, { text: 'C', idx: 5 }], firstChapterIdx: 1 });
    const codex: Codex = { ...EMPTY_CODEX, terms: [singleDefTerm, multiDefTerm] };
    const chat = jest.fn(async (messages: ChatMessage[]): Promise<ChatResult> => {
      const userMsg = messages.find((m) => m.role === 'user')!.content;
      expect(userMsg).not.toContain('单条词条');
      return { content: JSON.stringify({ glosses: [{ name: '多条词条', gloss: '整合释义' }] }), finishReason: 'stop' };
    });
    const result = await polishCodex({ chat }, { codex });
    expect(result.terms.find((t) => t.name === '单条词条')?.gloss ?? []).toEqual([]);
    expect(result.terms.find((t) => t.name === '多条词条')?.gloss?.[0].text).toBe('整合释义');
  });
});
