# 增量 8.5 · 已读图鉴 深度优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Worker + reviewer both sonnet; final whole-branch review on opus. Continue on branch `feat/reading-codex` (do not create a new branch).

**Goal:** Fix three real-device-reported quality problems in the already-shipped 已读图鉴 (Reading Codex) feature: fragmented/repetitive character bios, an unreadably crowded relationship graph, and a UI with zero search/filter and several silently-hidden data fields.

**Architecture:** Add an LLM "polish" pass that consolidates accumulated fragment arrays into cohesive versioned prose (`Character.bio`, `Term.gloss`), reusing the existing `{text,idx}[]` spoiler-safe pattern. Replace the whole-cast spatial network graph with a faction-grouped tree/list view plus a small per-character ego-network diagram. Rework `CodexModal.tsx` with search, virtualized lists, and full field coverage. All pure JS/TS — no native dependency changes, ships via OTA.

**Tech Stack:** Expo SDK57, React Native 0.86, TypeScript strict, Jest 29 + jest-expo, react-native-svg (already a dependency, no version change).

## Global Constraints

- **`codexForCutoff` in `src/lib/ai/codex.ts` is the sole spoiler-safety filter.** No new module/component may hold raw (unfiltered) `Codex` data together with a `cutoff` value — only `codexForCutoff`'s output ever reaches UI/derived-view code.
- **Every idx is code-computed, never LLM-self-reported.** New idx-stamping rules introduced by this plan (see Tasks 2 and 4) must be followed exactly — they were corrected by an adversarial review that found real spoiler leaks in the naive versions.
- **Merge-time containment guard (Task 2): when keeping the longer of two overlapping fragments, the idx MUST be the longer (kept) fragment's own idx — never the minimum of the two, never the shorter fragment's idx.** Getting this backwards leaks future content.
- **Polish-time idx stamping (Task 4): every entity polished within one LLM call must be stamped with that call's batch-wide max fragment idx — never each entity's own individually-computed max idx.** Getting this backwards leaks future content via cross-entity LLM information bleed within a batch.
- **Polish only runs once ensureCodex has caught up to `cutoff` (no more chapters to extract) — never at intermediate checkpoints.** This was corrected from an original "every checkpoint" design that would have ~tripled LLM call volume.
- `ai_codex`'s `json` column is an opaque string (`CodexRecord.json` in `src/lib/import/repository.ts`) — new `Character`/`Term` fields need zero migration.
- `CODEX_PROMPT_VERSION` (currently `'v1'` in `src/lib/ai/ensureCodex.ts`) bumps to `'v2'`. Per existing convention this does NOT trigger auto-rebuild of existing codices — only `forceRebuild: true` (the "重建图鉴" button) does a from-scratch rebuild.
- UI colors: use the `Theme` type from `src/lib/settings/styles.ts` (`background/text/heading/subtle/border/accent`) via `resolveTheme(settings.themeId)` — never hardcode hex/rgba literals for anything that should adapt to the active theme.
- Reuse `runPool` (exported from `src/lib/ai/summarize.ts`) for any new bounded-concurrency LLM batching.

---

## Task 1: `codex.ts` — `bio`/`gloss` fields + generalized `latestAtIdx`

**Files:**
- Modify: `src/lib/ai/codex.ts`
- Test: `src/lib/ai/__tests__/codex.test.ts`

**Interfaces:**
- Produces: `Character.bio?: TextAtIdx[]`, `Character.bioHash?: string`, `Term.gloss?: TextAtIdx[]`, `Term.glossHash?: string` (all optional, additive). `codexForCutoff` continues to have signature `(codex: Codex, cutoff: number): Codex`; its output `Character`/`Term` objects now also carry `bio`/`gloss` (each `[]` or a single-element array), and never carry `bioHash`/`glossHash`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/__tests__/codex.test.ts` (inside the existing `describe('codexForCutoff', ...)` block, after the last `it`):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- codex.test.ts`
Expected: FAIL — `bio`/`gloss`/`bioHash`/`glossHash` do not exist on `Character`/`Term` yet (TS type errors surfacing as test failures, or `undefined` mismatches).

- [ ] **Step 3: Implement**

In `src/lib/ai/codex.ts`, add the new optional fields to `Character` and `Term`:

```ts
export interface Character {
  name: string;
  aliases: TextAtIdx[];
  identity: TextAtIdx[];
  origin?: TextAtIdx[];
  groups: NamedAtIdx[];
  firstChapterIdx: number;
  events?: TextAtIdx[];
  /** 版本化整合简介（增量 8.5）；展示取 idx<=cutoff 中最新一条。 */
  bio?: TextAtIdx[];
  /** 代码计算的碎片指纹，仅供 codexPolish 判断是否需要重新润色，绝不进入 codexForCutoff 输出。 */
  bioHash?: string;
}

export interface Term {
  name: string;
  category: TermCategory;
  def: TextAtIdx[];
  firstChapterIdx: number;
  /** 版本化整合释义（增量 8.5）；展示取 idx<=cutoff 中最新一条。 */
  gloss?: TextAtIdx[];
  glossHash?: string;
}
```

Extract the existing `Term.def` reduction into a reusable helper, and use it for `def`, `bio`, and `gloss`:

```ts
function filterAtIdx<T extends { idx: number }>(arr: T[] | undefined, cutoff: number): T[] {
  return (arr ?? []).filter((x) => x.idx <= cutoff);
}

/** 版本化字段的展示归约：过滤 ≤cutoff 后只取最新一条（不是全部，也不是第一条）。 */
function latestAtIdx<T extends { idx: number }>(arr: T[] | undefined, cutoff: number): T[] {
  const visible = filterAtIdx(arr, cutoff);
  if (!visible.length) return [];
  return [visible.reduce((best, x) => (x.idx > best.idx ? x : best))];
}
```

Update `codexForCutoff`'s character mapping to add `bio: latestAtIdx(c.bio, cutoff)` (and omit `bioHash` — simply don't list it in the returned object literal), and the term mapping to use `latestAtIdx` for both `def` and the new `gloss: latestAtIdx(t.gloss, cutoff)` (again omitting `glossHash`):

```ts
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
      bio: latestAtIdx(c.bio, cutoff),
    }));

  const visibleNames = new Set(characters.map((c) => c.name));

  const terms: Term[] = codex.terms
    .filter((t) => t.firstChapterIdx <= cutoff)
    .map((t) => ({
      name: t.name,
      category: t.category,
      def: latestAtIdx(t.def, cutoff),
      firstChapterIdx: t.firstChapterIdx,
      gloss: latestAtIdx(t.gloss, cutoff),
    }));

  const relations: Relation[] = codex.relations.filter(
    (r) => r.idx <= cutoff && visibleNames.has(r.from) && visibleNames.has(r.to),
  );

  return { characters, terms, relations };
}
```

(This replaces the old inline `visibleDefs`/`latest` block that only handled `def` — same behavior, now shared via `latestAtIdx`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- codex.test.ts`
Expected: PASS, all tests including the 4 new ones and all pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/codex.ts src/lib/ai/__tests__/codex.test.ts
git commit -m "feat(codex): add versioned bio/gloss polish fields + generalize latestAtIdx"
```

---

## Task 2: `codexMerge.ts` — containment near-duplicate guard

**Files:**
- Modify: `src/lib/ai/codexMerge.ts`
- Test: `src/lib/ai/__tests__/codexMerge.test.ts`

**Interfaces:**
- Consumes: `TextAtIdx` from `./codex` (unchanged).
- Produces: `dedupeTextAtIdx(base: TextAtIdx[], incoming: TextAtIdx[]): TextAtIdx[]` — same signature, now also collapses containment-duplicates. No other exported signature changes.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/__tests__/codexMerge.test.ts`:

```ts
describe('mergeCodex — containment near-dup guard', () => {
  it('CRITICAL: when a longer fragment subsumes an earlier shorter one, the surviving text keeps its OWN idx — never the earlier (shorter) fragment\'s idx, never the minimum of the two', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 10, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒的少年', idx: 10 }], firstChapterIdx: 10 })], terms: [], relations: [] } },
      { maxIdx: 200, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒的少年，后来弑父夺得魔教教主之位', idx: 200 }], firstChapterIdx: 10 })], terms: [], relations: [] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    const identity = merged.characters[0].identity;
    // 只应存活一条（长文本吸收短文本），且必须带长文本自身的 idx=200，不能是 10，也不能是二者的 min。
    expect(identity).toHaveLength(1);
    expect(identity[0]).toEqual({ text: '出身贫寒的少年，后来弑父夺得魔教教主之位', idx: 200 });
  });

  it('distinct-but-similar fragments (neither is a substring of the other) both survive', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 5, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒', idx: 5 }], firstChapterIdx: 5 })], terms: [], relations: [] } },
      { maxIdx: 30, partial: { characters: [char({ name: '林某', identity: [{ text: '自幼失怙', idx: 30 }], firstChapterIdx: 5 })], terms: [], relations: [] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    expect(merged.characters[0].identity.map((i) => i.text).sort()).toEqual(['出身贫寒', '自幼失怙']);
  });

  it('a fragment identical after normalization (whitespace/trailing punctuation only) still collapses to one, keeping the longer/later idx', () => {
    const blockResults: CodexBlockResult[] = [
      { maxIdx: 3, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒。', idx: 3 }], firstChapterIdx: 3 })], terms: [], relations: [] } },
      { maxIdx: 7, partial: { characters: [char({ name: '林某', identity: [{ text: '出身贫寒', idx: 7 }], firstChapterIdx: 3 })], terms: [], relations: [] } },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    expect(merged.characters[0].identity).toHaveLength(1);
  });
});
```

Add the necessary import at the top of the test file if not already present: `import type { CodexBlockResult } from '../codexExtract';` (already imported per the existing file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- codexMerge.test.ts`
Expected: FAIL — current `dedupeTextAtIdx` only does exact `${text} ${idx}` matching, so both the idx=10 and idx=200 fragments survive as two separate entries (length 2, not 1).

- [ ] **Step 3: Implement**

In `src/lib/ai/codexMerge.ts`, add a normalization helper and rewrite `dedupeTextAtIdx` to do containment collapsing before falling back to exact-key dedup:

```ts
// 规范化：去首尾空白 + 去掉句末标点，用于判断"是否互为子串"，不用于最终展示文本。
function normalizeForContainment(s: string): string {
  return s.trim().replace(/[。！？，；、,.!?;]+$/u, '');
}

/**
 * 包含关系去重：新碎片的规范化文本若是已存在碎片的子串（或反之），只保留更长者。
 * 红线：保留更长者时，idx 取被保留的那条（更长的那条）自身的 idx——绝不取两者
 * 中的较小值，也绝不沿用被丢弃的较短碎片的 idx。更长的文本承载的信息就是在它
 * 自己的 idx 才被揭示的，去重不能让信息提前于其被揭示的时间点展示。
 */
function dedupeTextAtIdx(base: TextAtIdx[], incoming: TextAtIdx[]): TextAtIdx[] {
  let out = [...base];
  for (const x of incoming) {
    const xNorm = normalizeForContainment(x.text);
    let absorbed = false;
    let subsumedIndex = -1;
    for (let i = 0; i < out.length; i++) {
      const existingNorm = normalizeForContainment(out[i].text);
      if (existingNorm === xNorm) {
        absorbed = true; // 精确重复（含规范化后相同），丢弃新条目，保留旧条目原样
        break;
      }
      if (xNorm.length > existingNorm.length && xNorm.includes(existingNorm)) {
        subsumedIndex = i; // 新的更长，吸收旧的——但沿用新条目自身的 idx（下面直接用 x）
        break;
      }
      if (existingNorm.length > xNorm.length && existingNorm.includes(xNorm)) {
        absorbed = true; // 旧的更长，已经吸收了新的，丢弃新条目
        break;
      }
    }
    if (absorbed) continue;
    if (subsumedIndex >= 0) {
      out[subsumedIndex] = x; // 用长文本（自带正确 idx）整条替换被吸收的短文本
      continue;
    }
    out.push(x);
  }
  return out;
}
```

Note: this replaces the previous exact-`Set`-based implementation entirely — the new version is O(n²) per merge call but `n` here is the fragment count for a single character/term (bounded, small), which is acceptable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- codexMerge.test.ts`
Expected: PASS, all new tests plus all pre-existing tests (the pre-existing exact-key-dedup tests must still pass — verify no regression, e.g. the "extends an already-persisted existing Codex" test and the alias/name tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/codexMerge.ts src/lib/ai/__tests__/codexMerge.test.ts
git commit -m "fix(codex): containment near-dup guard in merge, keeping the longer fragment's own idx"
```

---

## Task 3: `codexPolish.ts` — fragment hashing + dirty detection (pure)

**Files:**
- Create: `src/lib/ai/codexPolish.ts`
- Test: `src/lib/ai/__tests__/codexPolish.test.ts`

**Interfaces:**
- Consumes: `Character`, `Term`, `TextAtIdx` from `./codex`.
- Produces: `characterFragmentHash(c: Character): string`, `termFragmentHash(t: Term): string`, `isCharacterDirty(c: Character): boolean`, `isTermDirty(t: Term): boolean`. These are consumed by Task 4 (same file) and Task 5 (`ensureCodex.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ai/__tests__/codexPolish.test.ts`:

```ts
import type { Character, Term } from '../codex';
import { characterFragmentHash, isCharacterDirty, isTermDirty, termFragmentHash } from '../codexPolish';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- codexPolish.test.ts`
Expected: FAIL — `codexPolish.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement**

Create `src/lib/ai/codexPolish.ts`:

```ts
/**
 * 增量 8.5: 图鉴润色 pass。纯函数部分：碎片指纹 + 脏检测。
 *
 * 指纹覆盖的字段集合必须和喂给润色 prompt 的字段集合完全一致——人物是
 * identity+origin+events，词条是 def。若某个字段更新了但没进指纹，会造成
 * "该更新简介却没更新"的过期问题（不是泄漏，但是体验倒退）。
 */
import type { Character, TextAtIdx, Term } from './codex';

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
    .map((x) => `${x.idx}:${x.text}`)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- codexPolish.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/codexPolish.ts src/lib/ai/__tests__/codexPolish.test.ts
git commit -m "feat(codex): fragment hashing + dirty detection for the polish pass"
```

---

## Task 4: `codexPolish.ts` — `polishCodex` LLM stage

**Files:**
- Modify: `src/lib/ai/codexPolish.ts`
- Test: `src/lib/ai/__tests__/codexPolish.test.ts`

**Interfaces:**
- Consumes: `Codex`, `Character`, `Term` from `./codex`; `ChatMessage`, `ChatResult`, `AiError` from `./client`; `runPool` from `./summarize`; `isCharacterDirty`/`isTermDirty`/`characterFragmentHash`/`termFragmentHash` (Task 3, same file).
- Produces: `export type PolishChatFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<ChatResult>;` and `export async function polishCodex(deps: {chat: PolishChatFn}, params: {codex: Codex; signal?: AbortSignal; onProgress?: (done: number, total: number) => void}): Promise<Codex>`. Task 5 (`ensureCodex.ts`) calls `polishCodex` directly.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/__tests__/codexPolish.test.ts`:

```ts
import type { ChatMessage, ChatResult } from '../client';
import { EMPTY_CODEX, type Codex } from '../codex';
import { polishCodex } from '../codexPolish';

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
    const chat = jest.fn(async (): Promise<ChatResult> => ({
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
```

Add `import { characterFragmentHash } from '../codexPolish';` if not already covered by the existing top-of-file import (extend the existing `import ... from '../codexPolish'` line to include `characterFragmentHash`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- codexPolish.test.ts`
Expected: FAIL — `polishCodex` is not exported yet.

- [ ] **Step 3: Implement**

Append to `src/lib/ai/codexPolish.ts`:

```ts
import { AiError, type ChatMessage, type ChatResult } from './client';
import type { Codex } from './codex';
import { runPool } from './summarize';

export type PolishChatFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<ChatResult>;

const BATCH_SIZE = 6;
const CONCURRENCY = 3;
const MIN_DEF_FRAGMENTS_FOR_GLOSS = 2;

interface PolishCharacterTask {
  kind: 'character';
  index: number;
  name: string;
  fragments: { text: string; idx: number }[];
}
interface PolishTermTask {
  kind: 'term';
  index: number;
  name: string;
  fragments: { text: string; idx: number }[];
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
```

Note: the `characterFragmentHash`/`termFragmentHash` calls above must be computed AFTER the `bio`/`gloss` array is updated on the new object (so the hash reflects the fragments that produced it — but since the hash only covers `identity`/`origin`/`events`/`def`, which don't change here, this is really just "set hash = current fragment hash", confirming the entity is no longer dirty relative to its *current* fragment set). Double-check this reads correctly against Task 3's `isCharacterDirty` definition (hash compares against `characterFragmentHash(c)`, which only depends on fragment fields, not on `bio` itself) — it does, no circular dependency.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- codexPolish.test.ts`
Expected: PASS, all tests from Task 3 and Task 4 (16 total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/codexPolish.ts src/lib/ai/__tests__/codexPolish.test.ts
git commit -m "feat(codex): polishCodex LLM stage with batch-wide idx stamping"
```

---

## Task 5: `ensureCodex.ts` — integrate polish at catch-up only

**Files:**
- Modify: `src/lib/ai/ensureCodex.ts`
- Test: `src/lib/ai/__tests__/ensureCodex.test.ts`

**Interfaces:**
- Consumes: `polishCodex`, `isCharacterDirty`, `isTermDirty` from `./codexPolish` (Tasks 3-4).
- Produces: `EnsureCodexDeps` gains `polishChat: PolishChatFn`. `CODEX_PROMPT_VERSION` becomes `'v2'`. `EnsureCodexResult` unchanged in shape.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/__tests__/ensureCodex.test.ts`:

```ts
function fakePolishChat(): jest.Mock<Promise<ChatResult>, [ChatMessage[], AbortSignal?]> {
  return jest.fn(async () => ({ content: JSON.stringify({ bios: [{ name: '主角', bio: '整合后的简介' }] }), finishReason: 'stop' }));
}

describe('ensureCodex — polish integration', () => {
  it('runs polish once after catching up to cutoff (not per intermediate checkpoint)', async () => {
    const { repo, fs, book, chapters } = await setup(120); // 8 blocks / 5 per checkpoint → 2 checkpoints
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const polishChat = fakePolishChat();
    await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 119, model: 'm', autoOn: true },
    );
    // 主角每块都会重新被抽取出来（同名合并），但润色只应该在最终追上 cutoff 后跑一次，
    // 不是每个 checkpoint 跑一次——2 个 checkpoint 不应该产生 2 次或更多的润色调用。
    expect(polishChat).toHaveBeenCalledTimes(1);
  });

  it('a fully caught-up book with a dirty entity gets polished when re-run, without needing forceRebuild', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const polishChat = fakePolishChat();
    const first = await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: true },
    );
    expect(first.codex.characters.find((c) => c.name === '主角')?.bio?.[0].text).toBe('整合后的简介');
    expect(polishChat).toHaveBeenCalledTimes(1);

    // 重新打开（没有新章节，但没有任何新脏实体——上一次已经润色过了）：不应该再次调用。
    const second = await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: true },
    );
    expect(polishChat).toHaveBeenCalledTimes(1); // 仍是 1 次，没有额外的空转润色
    expect(second.coveredUptoIdx).toBe(9);
  });

  it('polish does not change coveredUptoIdx', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const polishChat = fakePolishChat();
    const res = await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: true },
    );
    expect(res.coveredUptoIdx).toBe(9); // 和没有润色时的行为一致，润色不推高也不压低覆盖进度
  });

  it('CODEX_PROMPT_VERSION is v2', () => {
    expect(CODEX_PROMPT_VERSION).toBe('v2');
  });

  it('version-mismatch (v1 -> v2) does not wipe existing bio-less codex; catch-up polish still runs and adds bio without a forceRebuild', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    await repo.putCodex({
      bookId: 'b1', coveredUptoIdx: 9, model: 'm', promptVersion: 'v1',
      json: JSON.stringify({
        characters: [{ name: '老角色', aliases: [], identity: [{ text: '旧碎片', idx: 3 }], groups: [], firstChapterIdx: 0 }],
        terms: [], relations: [],
      }),
      updatedAt: 1,
    });
    for (let i = 0; i <= 9; i++) {
      await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: 'v2', summary: `s${i}`, createdAt: 1 });
    }
    const summarizeChat = jest.fn(async () => 'S');
    const chat = jest.fn(async (): Promise<ChatResult> => ({ content: JSON.stringify({ characters: [], terms: [], relations: [] }), finishReason: 'stop' }));
    const polishChat = jest.fn(async () => ({ content: JSON.stringify({ bios: [{ name: '老角色', bio: '整合简介' }] }), finishReason: 'stop' }));
    const res = await ensureCodex(
      { chat, summarizeChat, polishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: false },
    );
    expect(res.versionMismatch).toBe(true);
    expect(res.codex.characters.find((c) => c.name === '老角色')?.bio?.[0].text).toBe('整合简介');
  });

  it('cancellation during polish does not partially persist (entity stays fully dirty, safe to retry)', async () => {
    const { repo, fs, book, chapters } = await setup(10);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const ctrl = new AbortController();
    const polishChat = jest.fn(async (): Promise<ChatResult> => {
      ctrl.abort();
      throw new AiError('cancelled', 'AI 已取消');
    });
    await expect(
      ensureCodex(
        { chat, summarizeChat, polishChat, fs, repo },
        { book, chapters, cutoff: 9, model: 'm', autoOn: true, signal: ctrl.signal },
      ),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    const stored = await repo.getCodex('b1');
    // 抽取阶段已经落过盘（extraction checkpoint），但润色没跑完不应该产生半更新的 bio/hash 不一致状态；
    // 重新调用应该照常重新判定为脏并重试，不应报错或卡死。
    const retryPolishChat = fakePolishChat();
    const retry = await ensureCodex(
      { chat, summarizeChat, polishChat: retryPolishChat, fs, repo },
      { book, chapters, cutoff: 9, model: 'm', autoOn: true },
    );
    expect(retry.codex.characters.find((c) => c.name === '主角')?.bio?.[0].text).toBe('整合后的简介');
  });
});
```

Add `AiError` to the existing `import type { ChatMessage, ChatResult }` line's neighbor if not already imported (the test file currently imports only types from `../client`; add `import { AiError } from '../client';` and `import { CODEX_PROMPT_VERSION, ensureCodex, __resetCodexLocks } from '../ensureCodex';` — extend the existing import line to include `CODEX_PROMPT_VERSION`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- ensureCodex.test.ts`
Expected: FAIL — `EnsureCodexDeps` has no `polishChat` field yet (TS error), `CODEX_PROMPT_VERSION` is still `'v1'`, no polish behavior exists.

- [ ] **Step 3: Implement**

In `src/lib/ai/ensureCodex.ts`:

1. Bump the version constant and add the new dependency type:

```ts
export const CODEX_PROMPT_VERSION = 'v2';
```

Add imports:

```ts
import { isCharacterDirty, isTermDirty, polishCodex, type PolishChatFn } from './codexPolish';
```

Add `polishChat: PolishChatFn;` to `EnsureCodexDeps`:

```ts
export interface EnsureCodexDeps {
  chat: CodexChatFn;
  polishChat: PolishChatFn;
  summarizeChat: SummarizeFn;
  fs: FileGateway;
  repo: BookRepository;
}
```

2. Add a helper to check if anything needs polishing, and the polish-and-persist step. Insert this right after the existing extraction-checkpoint `for` loop (after line ~171, before `const complete = ...`), replacing the tail of the function:

```ts
    const anyDirty = () => codex.characters.some(isCharacterDirty) || codex.terms.some(isTermDirty);

    // 只在追上 cutoff（没有更多章节可抽）时跑一次润色——不在每个中间 checkpoint
    // 触发。这一处逻辑同时覆盖"首次一次性追赶到底"和"已经追上、无新章节但有
    // 脏实体"两种场景。整个 pass 跑完才持久化一次；取消时不落盘半完成的部分，
    // 下次重新判定脏实体、重新跑，不会丢数据也不会不一致。
    if (anyDirty()) {
      throwIfCancelled();
      codex = await polishCodex({ chat: deps.polishChat }, { codex, signal, onProgress });
      throwIfCancelled();
      await persist(coveredUptoIdx); // coveredUptoIdx 保持不变——润色不改变"覆盖到哪一章"这个语义
    }

    const complete = autoOn ? true : await isCoverageComplete(deps.repo, book.id, cutoff);
    return { codex, coveredUptoIdx, complete, versionMismatch };
  });
}
```

This replaces the existing tail:
```ts
    const complete = autoOn ? true : await isCoverageComplete(deps.repo, book.id, cutoff);
    return { codex, coveredUptoIdx, complete, versionMismatch };
  });
}
```

3. The `availableIdx.length === 0` early-return branch (lines ~132-135) must ALSO run this same dirty-check-and-polish step before returning, since that's the "already caught up, no new chapters, but maybe dirty from a version bump" path:

```ts
    if (availableIdx.length === 0) {
      if (codex.characters.some(isCharacterDirty) || codex.terms.some(isTermDirty)) {
        throwIfCancelled();
        codex = await polishCodex({ chat: deps.polishChat }, { codex, signal, onProgress });
        throwIfCancelled();
        await persist(coveredUptoIdx);
      }
      const complete = autoOn ? true : await isCoverageComplete(deps.repo, book.id, cutoff);
      return { codex, coveredUptoIdx, complete, versionMismatch };
    }
```

(This duplicates the dirty-check-and-polish snippet in two places — the early-return branch and the main-flow tail. This is intentional: they're two different control-flow exits from the same function, and factoring them into a shared local closure is a reasonable refactor if the reviewer prefers it, but duplication here is small and clear. If refactoring, extract `const runPolishIfDirty = async () => { if (...) { ...; await persist(coveredUptoIdx); } };` once near the top of the function body and call it at both exit points.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- ensureCodex.test.ts`
Expected: PASS — all new polish-integration tests plus all pre-existing tests (pre-existing tests must be updated to pass `polishChat` in their deps object; since `fakeCodexChat`'s default JSON has no `identity` fragments beyond one string, most pre-existing tests won't have dirty entities requiring polish to actually fire, but `polishChat` must still be supplied as a dependency or TypeScript will fail to compile — add `const polishChat = jest.fn(async () => ({ content: '{}', finishReason: 'stop' }));` to each pre-existing test's setup, or add a shared `defaultPolishChat()` helper at the top of the file and reuse it in every existing `ensureCodex({ chat, summarizeChat, fs, repo }, ...)` call site, changing them to `ensureCodex({ chat, summarizeChat, polishChat: defaultPolishChat(), fs, repo }, ...)`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ensureCodex.ts src/lib/ai/__tests__/ensureCodex.test.ts
git commit -m "feat(codex): integrate polish pass at catch-up only, bump CODEX_PROMPT_VERSION to v2"
```

---

## Task 6: `factionLayout.ts` → `codexRelations.ts` — grouping + tree classification

**Files:**
- Create: `src/lib/ai/codexRelations.ts`
- Delete: `src/lib/ai/factionLayout.ts`, `src/lib/ai/__tests__/factionLayout.test.ts`
- Test: `src/lib/ai/__tests__/codexRelations.test.ts`

**Interfaces:**
- Consumes: `Character`, `Relation` from `./codex`.
- Produces: `export const UNGROUPED = '散'`, `export function primaryGroup(c: Character): string | null`, `export const TREE_KINDS: ReadonlySet<string>`, `export function isTreeKind(kind: string): boolean`, `export interface RelationChip { otherName: string; kind: string }`, `export interface RosterNode { name: string; subtitle?: string; depth: number; chips: RelationChip[] }`, `export interface GroupSection { group: string; nodes: RosterNode[] }`, `export function buildGroupedRoster(characters: Character[], relations: Relation[]): GroupSection[]`. Consumed by Task 9 (`RelationRoster.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ai/__tests__/codexRelations.test.ts`:

```ts
import type { Character, Relation } from '../codex';
import { buildGroupedRoster, isTreeKind, primaryGroup, UNGROUPED } from '../codexRelations';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- codexRelations.test.ts`
Expected: FAIL — `codexRelations.ts` does not exist yet.

- [ ] **Step 3: Implement**

Create `src/lib/ai/codexRelations.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- codexRelations.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Delete the old faction-layout module and its test**

```bash
git rm src/lib/ai/factionLayout.ts src/lib/ai/__tests__/factionLayout.test.ts
```

- [ ] **Step 6: Run the full suite to confirm nothing else references the deleted module**

Run: `npx tsc --noEmit`
Expected: errors only in `src/reader/RelationshipGraph.tsx` and `src/reader/CodexModal.tsx` (both handled in Tasks 9-11 — confirm no OTHER file errors; if any appear, that's a missed reference to track down before continuing).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/codexRelations.ts src/lib/ai/__tests__/codexRelations.test.ts
git commit -m "feat(codex): replace faction spatial layout with grouped tree/roster (codexRelations.ts)"
```

---

## Task 7: `codexRelations.ts` — `egoNetwork` geometry

**Files:**
- Modify: `src/lib/ai/codexRelations.ts`
- Test: `src/lib/ai/__tests__/codexRelations.test.ts`

**Interfaces:**
- Produces: `export interface EgoNode { name: string; x: number; y: number; focal: boolean }`, `export interface EgoEdge { kind: string; x1: number; y1: number; x2: number; y2: number }`, `export function egoNetwork(focalName: string, characters: Character[], relations: Relation[], opts: {width: number; height: number; cap?: number}): {nodes: EgoNode[]; edges: EgoEdge[]}`. Consumed by Task 10 (`EgoGraph.tsx`).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/__tests__/codexRelations.test.ts`:

```ts
import { egoNetwork } from '../codexRelations';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- codexRelations.test.ts`
Expected: FAIL — `egoNetwork` not exported yet.

- [ ] **Step 3: Implement**

Append to `src/lib/ai/codexRelations.ts`:

```ts
export interface EgoNode {
  name: string;
  x: number;
  y: number;
  focal: boolean;
}

export interface EgoEdge {
  kind: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const DEFAULT_EGO_CAP = 8;

export function egoNetwork(
  focalName: string,
  characters: Character[],
  relations: Relation[],
  opts: { width: number; height: number; cap?: number },
): { nodes: EgoNode[]; edges: EgoEdge[] } {
  const { width, height, cap = DEFAULT_EGO_CAP } = opts;
  const cx = width / 2;
  const cy = height / 2;

  const direct = relations.filter((r) => r.from === focalName || r.to === focalName);
  const neighborName = (r: Relation) => (r.from === focalName ? r.to : r.from);
  const charByName = new Map(characters.map((c) => [c.name, c]));

  const sortedDirect = [...direct].sort((a, b) => {
    const ca = charByName.get(neighborName(a));
    const cb = charByName.get(neighborName(b));
    const fa = ca?.firstChapterIdx ?? Number.MAX_SAFE_INTEGER;
    const fb = cb?.firstChapterIdx ?? Number.MAX_SAFE_INTEGER;
    if (fa !== fb) return fb - fa; // 最近登场（idx 较大）优先保留
    return neighborName(a).localeCompare(neighborName(b));
  });
  const capped = sortedDirect.slice(0, cap);

  const nodes: EgoNode[] = [{ name: focalName, x: cx, y: cy, focal: true }];
  const radius = Math.min(width, height) / 2 - 32;
  capped.forEach((r, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, capped.length);
    nodes.push({ name: neighborName(r), x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), focal: false });
  });

  const nodeByName = new Map(nodes.map((n) => [n.name, n]));
  const edges: EgoEdge[] = capped.map((r) => {
    const focal = nodeByName.get(focalName)!;
    const other = nodeByName.get(neighborName(r))!;
    return { kind: r.kind, x1: focal.x, y1: focal.y, x2: other.x, y2: other.y };
  });

  return { nodes, edges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- codexRelations.test.ts`
Expected: PASS, all tests (13 total from Tasks 6+7).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/codexRelations.ts src/lib/ai/__tests__/codexRelations.test.ts
git commit -m "feat(codex): egoNetwork geometry for per-character relation view"
```

---

## Task 8: `codexSearch.ts` — character/term filtering

**Files:**
- Create: `src/lib/ai/codexSearch.ts`
- Test: `src/lib/ai/__tests__/codexSearch.test.ts`

**Interfaces:**
- Consumes: `Character`, `Term` from `./codex`.
- Produces: `export function filterCharacters(chars: Character[], q: string): Character[]`, `export function filterTerms(terms: Term[], q: string): Term[]`. Consumed by Task 11 (`CodexModal.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ai/__tests__/codexSearch.test.ts`:

```ts
import type { Character, Term } from '../codex';
import { filterCharacters, filterTerms } from '../codexSearch';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

function term(over: Partial<Term>): Term {
  return { name: 'T', category: '其它', def: [], firstChapterIdx: 0, ...over };
}

describe('filterCharacters', () => {
  it('empty query returns all characters unchanged', () => {
    const chars = [char({ name: 'A' }), char({ name: 'B' })];
    expect(filterCharacters(chars, '')).toEqual(chars);
  });

  it('matches by name, case-insensitively', () => {
    const chars = [char({ name: '张三' }), char({ name: '李四' })];
    expect(filterCharacters(chars, '张').map((c) => c.name)).toEqual(['张三']);
  });

  it('matches by alias', () => {
    const chars = [char({ name: '张三', aliases: [{ text: '玄天真人', idx: 1 }] })];
    expect(filterCharacters(chars, '玄天')).toHaveLength(1);
  });

  it('matches by group', () => {
    const chars = [char({ name: '张三', groups: [{ name: '青云门', idx: 1 }] })];
    expect(filterCharacters(chars, '青云')).toHaveLength(1);
  });

  it('matches by bio text', () => {
    const chars = [char({ name: '张三', bio: [{ text: '出身贫寒的少年', idx: 1 }] })];
    expect(filterCharacters(chars, '贫寒')).toHaveLength(1);
  });

  it('non-matching query returns empty array', () => {
    const chars = [char({ name: '张三' })];
    expect(filterCharacters(chars, '完全不相关')).toEqual([]);
  });
});

describe('filterTerms', () => {
  it('matches by name, def, or gloss', () => {
    const terms = [
      term({ name: '青云诀', def: [{ text: '入门吐纳法', idx: 1 }] }),
      term({ name: '天魔功', gloss: [{ text: '邪派内功', idx: 1 }] }),
    ];
    expect(filterTerms(terms, '吐纳').map((t) => t.name)).toEqual(['青云诀']);
    expect(filterTerms(terms, '邪派').map((t) => t.name)).toEqual(['天魔功']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- codexSearch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/ai/codexSearch.ts`:

```ts
/** 增量 8.5: 图鉴人物/词条的搜索过滤（纯函数，仿 src/lib/reader/toc.ts 的 filterChapters）。 */
import type { Character, Term } from './codex';

export function filterCharacters(chars: Character[], q: string): Character[] {
  const query = q.trim().toLowerCase();
  if (query === '') return chars.slice();
  return chars.filter((c) => {
    if (c.name.toLowerCase().includes(query)) return true;
    if (c.aliases.some((a) => a.text.toLowerCase().includes(query))) return true;
    if (c.groups.some((g) => g.name.toLowerCase().includes(query))) return true;
    if ((c.bio ?? []).some((b) => b.text.toLowerCase().includes(query))) return true;
    if ((c.identity ?? []).some((i) => i.text.toLowerCase().includes(query))) return true;
    return false;
  });
}

export function filterTerms(terms: Term[], q: string): Term[] {
  const query = q.trim().toLowerCase();
  if (query === '') return terms.slice();
  return terms.filter((t) => {
    if (t.name.toLowerCase().includes(query)) return true;
    if ((t.def ?? []).some((d) => d.text.toLowerCase().includes(query))) return true;
    if ((t.gloss ?? []).some((g) => g.text.toLowerCase().includes(query))) return true;
    return false;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- codexSearch.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/codexSearch.ts src/lib/ai/__tests__/codexSearch.test.ts
git commit -m "feat(codex): search/filter for characters and terms"
```

---

## Task 9: `RelationRoster.tsx` component

**Files:**
- Create: `src/reader/RelationRoster.tsx`
- Test: `src/reader/__tests__/RelationRoster.test.tsx`

**Interfaces:**
- Consumes: `GroupSection`, `buildGroupedRoster` from `../lib/ai/codexRelations`; `Character`, `Relation` from `../lib/ai/codex`; `resolveTheme` from `../lib/settings/styles`; `useSettings` from `../settings/SettingsContext`.
- Produces: `export interface RelationRosterProps { characters: Character[]; relations: Relation[]; onSelectCharacter: (name: string) => void }`, `export function RelationRoster(props: RelationRosterProps): JSX.Element`. Consumed by Task 11 (`CodexModal.tsx`).

- [ ] **Step 1: Write the failing test**

Create `src/reader/__tests__/RelationRoster.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import type { Character, Relation } from '../../lib/ai/codex';
import { RelationRoster } from '../RelationRoster';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

describe('RelationRoster', () => {
  const characters = [
    char({ name: '张三', groups: [{ name: '青云门', idx: 1 }] }),
    char({ name: '李四', groups: [{ name: '青云门', idx: 1 }] }),
    char({ name: '赵六', groups: [{ name: '散修', idx: 1 }] }),
  ];
  const relations: Relation[] = [
    { from: '张三', to: '李四', kind: '师徒', idx: 2 },
    { from: '张三', to: '赵六', kind: '仇敌', idx: 3 },
  ];

  it('renders section headers for each group', () => {
    const { getByText } = render(
      <RelationRoster characters={characters} relations={relations} onSelectCharacter={jest.fn()} />,
    );
    expect(getByText('青云门')).toBeTruthy();
    expect(getByText('散修')).toBeTruthy();
  });

  it('renders each character name once', () => {
    const { getByText } = render(
      <RelationRoster characters={characters} relations={relations} onSelectCharacter={jest.fn()} />,
    );
    expect(getByText('张三')).toBeTruthy();
    expect(getByText('李四')).toBeTruthy();
    expect(getByText('赵六')).toBeTruthy();
  });

  it('renders a tappable chip for a non-tree/cross-group relation, and tapping it selects that character', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <RelationRoster characters={characters} relations={relations} onSelectCharacter={onSelect} />,
    );
    fireEvent.press(getByTestId('roster-chip-张三-赵六-仇敌'));
    expect(onSelect).toHaveBeenCalledWith('赵六');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- RelationRoster.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/reader/RelationRoster.tsx`:

```tsx
/** 增量 8.5: 关系图 tab 的新内容——按势力分组的树状/标签列表，替代整体网状图。 */
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import type { Character, Relation } from '../lib/ai/codex';
import { buildGroupedRoster, type RosterNode } from '../lib/ai/codexRelations';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

export interface RelationRosterProps {
  characters: Character[];
  relations: Relation[];
  onSelectCharacter: (name: string) => void;
}

export function RelationRoster({ characters, relations, onSelectCharacter }: RelationRosterProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const sections = buildGroupedRoster(characters, relations);

  return (
    <SectionList
      testID="relation-roster"
      sections={sections.map((s) => ({ title: s.group, data: s.nodes }))}
      keyExtractor={(node) => node.name}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: theme.subtle }]}>{section.title}</Text>
          <View style={[styles.rule, { backgroundColor: theme.border }]} />
        </View>
      )}
      renderItem={({ item }) => <RosterRow node={item} theme={theme} onSelectCharacter={onSelectCharacter} />}
    />
  );
}

function RosterRow({
  node,
  theme,
  onSelectCharacter,
}: {
  node: RosterNode;
  theme: ReturnType<typeof resolveTheme>;
  onSelectCharacter: (name: string) => void;
}) {
  return (
    <View style={{ paddingLeft: node.depth * 18 }}>
      <Pressable testID={`roster-node-${node.name}`} onPress={() => onSelectCharacter(node.name)} style={styles.row}>
        <Text style={[styles.name, { color: theme.text }]}>{node.name}</Text>
        {node.subtitle && (
          <Text numberOfLines={1} style={[styles.subtitle, { color: theme.subtle }]}>
            {node.subtitle}
          </Text>
        )}
      </Pressable>
      {node.chips.length > 0 && (
        <View style={styles.chipRow}>
          {node.chips.map((chip) => (
            <Pressable
              key={`${node.name}-${chip.otherName}-${chip.kind}`}
              testID={`roster-chip-${node.name}-${chip.otherName}-${chip.kind}`}
              onPress={() => onSelectCharacter(chip.otherName)}
              style={[styles.chip, { backgroundColor: `${theme.accent}22` }]}
            >
              <Text style={[styles.chipText, { color: theme.accent }]}>
                {chip.kind}: {chip.otherName}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  row: { paddingVertical: 8 },
  name: { fontSize: 15, fontWeight: '600' },
  subtitle: { fontSize: 12.5, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12 },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- RelationRoster.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/reader/RelationRoster.tsx src/reader/__tests__/RelationRoster.test.tsx
git commit -m "feat(codex): RelationRoster component (grouped tree/chip list)"
```

---

## Task 10: `EgoGraph.tsx` component (replaces `RelationshipGraph.tsx`)

**Files:**
- Create: `src/reader/EgoGraph.tsx`
- Delete: `src/reader/RelationshipGraph.tsx`, `src/reader/__tests__/RelationshipGraph.test.tsx`
- Test: `src/reader/__tests__/EgoGraph.test.tsx`

**Interfaces:**
- Consumes: `egoNetwork` from `../lib/ai/codexRelations`; `Character`, `Relation` from `../lib/ai/codex`.
- Produces: `export interface EgoGraphProps { focalName: string; characters: Character[]; relations: Relation[]; width: number; height: number; onSelectCharacter: (name: string) => void }`, `export function EgoGraph(props: EgoGraphProps): JSX.Element`. Consumed by Task 11 (`CodexModal.tsx`).

- [ ] **Step 1: Write the failing test**

Create `src/reader/__tests__/EgoGraph.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import type { Character, Relation } from '../../lib/ai/codex';
import { EgoGraph } from '../EgoGraph';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

describe('EgoGraph', () => {
  const characters = [char({ name: '张三' }), char({ name: '李四' })];
  const relations: Relation[] = [{ from: '张三', to: '李四', kind: '师徒', idx: 1 }];

  it('renders a node for the focal character and its direct relation', () => {
    const { getByTestId } = render(
      <EgoGraph focalName="张三" characters={characters} relations={relations} width={200} height={200} onSelectCharacter={jest.fn()} />,
    );
    expect(getByTestId('ego-node-张三')).toBeTruthy();
    expect(getByTestId('ego-node-李四')).toBeTruthy();
  });

  it('renders an edge for the relation', () => {
    const { getByTestId } = render(
      <EgoGraph focalName="张三" characters={characters} relations={relations} width={200} height={200} onSelectCharacter={jest.fn()} />,
    );
    expect(getByTestId('ego-edge-李四-师徒')).toBeTruthy();
  });

  it('tapping a node calls onSelectCharacter with that name', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <EgoGraph focalName="张三" characters={characters} relations={relations} width={200} height={200} onSelectCharacter={onSelect} />,
    );
    fireEvent.press(getByTestId('ego-node-李四'));
    expect(onSelect).toHaveBeenCalledWith('李四');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- EgoGraph.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/reader/EgoGraph.tsx`:

```tsx
/** 增量 8.5: 人物卡内嵌的小型「以我为中心」关系图，替代整体网状图组件。
 * ≤8 个直接关系节点，纯固定几何，无需碰撞检测/拖动/缩放。 */
import { useMemo } from 'react';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import type { Character, Relation } from '../lib/ai/codex';
import { egoNetwork } from '../lib/ai/codexRelations';

export interface EgoGraphProps {
  focalName: string;
  characters: Character[];
  relations: Relation[];
  width: number;
  height: number;
  onSelectCharacter: (name: string) => void;
}

const NODE_RADIUS = 12;
const FOCAL_RADIUS = 16;

export function EgoGraph({ focalName, characters, relations, width, height, onSelectCharacter }: EgoGraphProps) {
  const { nodes, edges } = useMemo(
    () => egoNetwork(focalName, characters, relations, { width, height }),
    [focalName, characters, relations, width, height],
  );

  return (
    <Svg testID="ego-graph" width={width} height={height}>
      {edges.map((e) => (
        <Line
          key={`${e.x2}-${e.y2}-${e.kind}`}
          testID={`ego-edge-${nodes.find((n) => n.x === e.x2 && n.y === e.y2)?.name ?? ''}-${e.kind}`}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          stroke="rgba(127,127,127,0.5)"
          strokeWidth={1}
        />
      ))}
      {nodes.map((n) => (
        <React.Fragment key={n.name}>
          <Circle
            testID={`ego-node-${n.name}`}
            cx={n.x}
            cy={n.y}
            r={n.focal ? FOCAL_RADIUS : NODE_RADIUS}
            fill={n.focal ? '#b0674a' : '#83a99b'}
            onPress={() => onSelectCharacter(n.name)}
          />
          <SvgText x={n.x} y={n.y + (n.focal ? FOCAL_RADIUS : NODE_RADIUS) + 12} fontSize={11} textAnchor="middle" fill="#7f838d">
            {n.name}
          </SvgText>
        </React.Fragment>
      ))}
    </Svg>
  );
}
```

Note: this needs `import React from 'react';` alongside `useMemo` for `React.Fragment` — adjust the import line to `import React, { useMemo } from 'react';`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- EgoGraph.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Delete the old component and its test**

```bash
git rm src/reader/RelationshipGraph.tsx src/reader/__tests__/RelationshipGraph.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/reader/EgoGraph.tsx src/reader/__tests__/EgoGraph.test.tsx
git commit -m "feat(codex): EgoGraph component replaces whole-cast RelationshipGraph"
```

---

## Task 11: `CodexModal.tsx` overhaul

**Files:**
- Modify: `src/reader/CodexModal.tsx`
- Test: `src/reader/__tests__/CodexModal.test.tsx`

**Interfaces:**
- Consumes: `filterCharacters`/`filterTerms` from `../lib/ai/codexSearch`; `RelationRoster` (Task 9); `EgoGraph` (Task 10); `Character`, `Codex` from `../lib/ai/codex`. `CodexModalProps` unchanged in shape (still receives already-`codexForCutoff`-filtered `codex`).

- [ ] **Step 1: Write the failing tests**

The existing `src/reader/__tests__/CodexModal.test.tsx` already covers gating/tabs/complete-button/etc. Add these new tests (append to the file, reusing whatever existing `renderModal`/default-props helper the file already has):

```tsx
describe('CodexModal — search and full field display (增量 8.5)', () => {
  it('filters the character list by typing in the search box', () => {
    const codex: Codex = {
      characters: [
        { name: '张三', aliases: [], identity: [], groups: [], firstChapterIdx: 0 },
        { name: '李四', aliases: [], identity: [], groups: [], firstChapterIdx: 0 },
      ],
      terms: [],
      relations: [],
    };
    const { getByTestId, queryByText } = render(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.changeText(getByTestId('codex-character-search'), '张');
    expect(queryByText('张三')).toBeTruthy();
    expect(queryByText('李四')).toBeFalsy();
  });

  it('character detail card shows aliases, groups, and events (previously never rendered)', () => {
    const codex: Codex = {
      characters: [{
        name: '张三',
        aliases: [{ text: '玄天真人', idx: 0 }],
        identity: [{ text: '身份描述', idx: 0 }],
        groups: [{ name: '青云门', idx: 0 }],
        firstChapterIdx: 0,
        events: [{ text: '初入宗门', idx: 0 }],
      }],
      terms: [],
      relations: [],
    };
    const { getByTestId, getByText } = render(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.press(getByTestId('codex-character-张三'));
    expect(getByText('玄天真人')).toBeTruthy();
    expect(getByText('青云门')).toBeTruthy();
    expect(getByText('初入宗门')).toBeTruthy();
  });

  it('character detail prefers bio over raw identity fragments when bio is present', () => {
    const codex: Codex = {
      characters: [{
        name: '张三', aliases: [], groups: [], firstChapterIdx: 0,
        identity: [{ text: '零散身份碎片', idx: 0 }],
        bio: [{ text: '整合后的连贯简介', idx: 0 }],
      }],
      terms: [],
      relations: [],
    };
    const { getByTestId, getByText, queryByText } = render(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.press(getByTestId('codex-character-张三'));
    expect(getByText('整合后的连贯简介')).toBeTruthy();
    expect(queryByText('零散身份碎片')).toBeFalsy();
  });

  it('terms tab groups by category with section headers', () => {
    const codex: Codex = {
      characters: [],
      terms: [
        { name: '青云诀', category: '功法', def: [{ text: 'x', idx: 0 }], firstChapterIdx: 0 },
        { name: '天南国', category: '地理', def: [{ text: 'y', idx: 0 }], firstChapterIdx: 0 },
      ],
      relations: [],
    };
    const { getByTestId, getByText } = render(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.press(getByTestId('codex-tab-terms'));
    expect(getByText('功法')).toBeTruthy();
    expect(getByText('地理')).toBeTruthy();
  });

  it('relation tab renders RelationRoster, not the old spatial graph', () => {
    const codex: Codex = {
      characters: [{ name: '张三', aliases: [], identity: [], groups: [{ name: '青云门', idx: 0 }], firstChapterIdx: 0 }],
      terms: [],
      relations: [],
    };
    const { getByTestId } = render(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.press(getByTestId('codex-tab-graph'));
    expect(getByTestId('relation-roster')).toBeTruthy();
  });
});
```

Check the existing test file's `defaultProps()` (or equivalent) helper name and adjust the calls above to match whatever the file actually calls it — read `src/reader/__tests__/CodexModal.test.tsx` in full before writing this step to confirm the exact helper name and import list.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- CodexModal.test.tsx`
Expected: FAIL — no search box, no aliases/groups/events rendering, no category grouping, old graph tab still uses `RelationshipGraph` (deleted in Task 10, so this will actually be a compile error until this task's implementation replaces the import — expected).

- [ ] **Step 3: Implement**

Rewrite `src/reader/CodexModal.tsx` body (keep `CodexModalProps` unchanged):

```tsx
/** 增量 8.5: 已读图鉴 Modal 重做——搜索、FlatList/SectionList 虚拟化、卡片式详情、
 * 分组树状关系列表。纪律不变：本组件及其子组件只接收调用方已用 codexForCutoff
 * 过滤过的 codex，永不同时持有裸 codex + cutoff。 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Character, Codex, Term } from '../lib/ai/codex';
import { filterCharacters, filterTerms } from '../lib/ai/codexSearch';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';
import { EgoGraph } from './EgoGraph';
import { RelationRoster } from './RelationRoster';

type CodexTab = 'characters' | 'terms' | 'graph';

export interface CodexModalProps {
  visible: boolean;
  onClose: () => void;
  configured: boolean;
  consented: boolean;
  onOpenSettings: () => void;
  onConsent: () => void;
  codex: Codex;
  complete: boolean;
  versionMismatch: boolean;
  currentChapterLabel: string;
  busy: boolean;
  progress: { done: number; total: number; phase?: 'extract' | 'polish' } | null;
  error: string | null;
  onComplete: () => void;
  onRebuild: () => void;
  onCancel: () => void;
}

export function CodexModal(props: CodexModalProps) {
  const {
    visible, onClose, configured, consented, onOpenSettings, onConsent,
    codex, complete, versionMismatch, currentChapterLabel, busy, progress, error,
    onComplete, onRebuild, onCancel,
  } = props;
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const [tab, setTab] = useState<CodexTab>('characters');
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [charQuery, setCharQuery] = useState('');
  const [termQuery, setTermQuery] = useState('');

  const filteredCharacters = useMemo(() => filterCharacters(codex.characters, charQuery), [codex.characters, charQuery]);
  const filteredTerms = useMemo(() => filterTerms(codex.terms, termQuery), [codex.terms, termQuery]);
  const termSections = useMemo(() => {
    const byCategory = new Map<string, Term[]>();
    for (const t of filteredTerms) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
    return [...byCategory.entries()].map(([category, terms]) => ({ title: category, data: terms }));
  }, [filteredTerms]);

  const selectByName = (name: string) => {
    const found = codex.characters.find((c) => c.name === name);
    if (found) {
      setSelectedCharacter(found);
      setTab('characters');
    }
  };

  const body = () => {
    if (!configured) {
      return (
        <View testID="codex-need-config" style={styles.center}>
          <Text style={[styles.hint, { color: theme.subtle }]}>还没配置 AI。填入 API Key 并打开「启用」开关即可开始。</Text>
          <Pressable testID="codex-open-settings" onPress={onOpenSettings} style={[styles.primary, { backgroundColor: theme.accent }]}>
            <Text style={styles.primaryText}>去设置</Text>
          </Pressable>
        </View>
      );
    }
    if (!consented) {
      return (
        <View testID="codex-consent-gate" style={styles.center}>
          <Text style={[styles.hint, { color: theme.subtle }]}>
            生成图鉴会把「已读」内容的摘要发送到你配置的服务。仅发送到当前阅读进度为止的内容。
          </Text>
          <Pressable testID="codex-consent" onPress={onConsent} style={[styles.primary, { backgroundColor: theme.accent }]}>
            <Text style={styles.primaryText}>同意并继续</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.flex}>
        <View style={styles.tabs}>
          {([['characters', '人物'], ['terms', '世界观'], ['graph', '关系图']] as const).map(([t, label]) => (
            <Pressable
              key={t}
              testID={`codex-tab-${t}`}
              onPress={() => { setTab(t); setSelectedCharacter(null); }}
              style={[styles.tab, { backgroundColor: tab === t ? theme.accent : `${theme.subtle}1f` }]}
            >
              <Text style={[styles.tabText, { color: tab === t ? '#fff' : theme.subtle }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {!complete && (
          <Pressable
            testID="codex-complete"
            onPress={onComplete}
            disabled={busy}
            style={[styles.secondary, { borderColor: theme.accent, opacity: busy ? 0.5 : 1 }]}
          >
            <Text style={[styles.secondaryText, { color: theme.accent }]}>补全到当前进度（{currentChapterLabel}）</Text>
          </Pressable>
        )}
        {versionMismatch && (
          <Pressable testID="codex-rebuild" onPress={onRebuild} disabled={busy} style={[styles.secondary, { borderColor: theme.subtle, opacity: busy ? 0.5 : 1 }]}>
            <Text style={[styles.secondaryText, { color: theme.subtle }]}>重建图鉴</Text>
          </Pressable>
        )}
        {busy && (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            {progress && (
              <Text testID="codex-progress" style={[styles.hint, { color: theme.subtle }]}>
                {progress.phase === 'polish' ? '整合润色中…' : '正在整理图鉴…'} {progress.done}/{progress.total}
              </Text>
            )}
            <Pressable testID="codex-cancel" onPress={onCancel} hitSlop={10}>
              <Text style={[styles.cancel, { color: theme.subtle }]}>取消</Text>
            </Pressable>
          </View>
        )}
        {error && <Text testID="codex-error" style={[styles.error, { color: '#d9534f' }]}>{error}</Text>}

        <View style={styles.flex}>
          {tab === 'characters' && !selectedCharacter && (
            <View style={styles.flex}>
              <TextInput
                testID="codex-character-search"
                value={charQuery}
                onChangeText={setCharQuery}
                placeholder="搜索人物 / 别名 / 势力"
                placeholderTextColor={theme.subtle}
                style={[styles.search, { color: theme.text, borderColor: theme.border }]}
              />
              <FlatList
                testID="codex-character-list"
                data={filteredCharacters}
                keyExtractor={(c) => c.name}
                renderItem={({ item: c }) => (
                  <Pressable testID={`codex-character-${c.name}`} onPress={() => setSelectedCharacter(c)} style={[styles.listItem, { borderBottomColor: theme.border }]}>
                    <Text style={[styles.listItemText, { color: theme.heading }]}>{c.name}</Text>
                    <Text numberOfLines={1} style={[styles.listItemSubtitle, { color: theme.subtle }]}>
                      {[c.groups[0]?.name, c.bio?.[0]?.text ?? c.identity[0]?.text].filter(Boolean).join(' · ')}
                    </Text>
                  </Pressable>
                )}
              />
            </View>
          )}
          {tab === 'characters' && selectedCharacter && (
            <CharacterDetail
              character={selectedCharacter}
              theme={theme}
              onBack={() => setSelectedCharacter(null)}
              allCharacters={codex.characters}
              relations={codex.relations}
              onSelectCharacter={selectByName}
            />
          )}
          {tab === 'terms' && (
            <View style={styles.flex}>
              <TextInput
                testID="codex-term-search"
                value={termQuery}
                onChangeText={setTermQuery}
                placeholder="搜索词条"
                placeholderTextColor={theme.subtle}
                style={[styles.search, { color: theme.text, borderColor: theme.border }]}
              />
              <SectionList
                testID="codex-term-list"
                sections={termSections}
                keyExtractor={(t) => t.name}
                renderSectionHeader={({ section }) => (
                  <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionLabel, { color: theme.subtle }]}>{section.title}</Text>
                    <View style={[styles.rule, { backgroundColor: theme.border }]} />
                  </View>
                )}
                renderItem={({ item: t }) => (
                  <View style={[styles.listItem, { borderBottomColor: theme.border }]}>
                    <Text style={[styles.listItemText, { color: theme.heading }]}>{t.name}</Text>
                    {(t.gloss[0] ?? t.def[0]) && (
                      <Text style={[styles.detailLine, { color: theme.subtle }]}>{(t.gloss[0] ?? t.def[0]).text}</Text>
                    )}
                  </View>
                )}
              />
            </View>
          )}
          {tab === 'graph' && (
            <View testID="codex-tab-graph-body" style={styles.flex}>
              <RelationRoster characters={codex.characters} relations={codex.relations} onSelectCharacter={selectByName} />
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View testID="codex-modal" style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.heading }]}>已读图鉴</Text>
          <Pressable testID="codex-close" onPress={onClose} hitSlop={10}>
            <Text style={[styles.closeText, { color: theme.subtle }]}>关闭</Text>
          </Pressable>
        </View>
        {body()}
      </View>
    </Modal>
  );
}

function CharacterDetail({
  character, theme, onBack, allCharacters, relations, onSelectCharacter,
}: {
  character: Character;
  theme: ReturnType<typeof resolveTheme>;
  onBack: () => void;
  allCharacters: Character[];
  relations: Codex['relations'];
  onSelectCharacter: (name: string) => void;
}) {
  return (
    <View testID="codex-character-detail" style={styles.flex}>
      <Pressable testID="codex-character-back" onPress={onBack}>
        <Text style={{ color: theme.accent }}>← 返回</Text>
      </Pressable>
      <Text style={[styles.detailTitle, { color: theme.heading }]}>{character.name}</Text>

      {character.aliases.length > 0 && (
        <ChipRow label="别名" items={character.aliases.map((a) => a.text)} theme={theme} />
      )}
      {character.groups.length > 0 && (
        <ChipRow label="势力" items={character.groups.map((g) => g.name)} theme={theme} />
      )}

      {character.bio && character.bio[0] ? (
        <Text style={[styles.detailLine, { color: theme.text }]}>{character.bio[0].text}</Text>
      ) : (
        character.identity.map((i, idx) => (
          <Text key={idx} style={[styles.detailLine, { color: theme.text }]}>{i.text}</Text>
        ))
      )}
      {(character.origin ?? []).map((o, idx) => (
        <Text key={idx} style={[styles.detailLine, { color: theme.subtle }]}>身世：{o.text}</Text>
      ))}
      {(character.events ?? []).length > 0 && (
        <View style={styles.timeline}>
          <Text style={[styles.sectionLabel, { color: theme.subtle }]}>事件线</Text>
          {(character.events ?? []).map((e, idx) => (
            <Text key={idx} style={[styles.detailLine, { color: theme.text }]}>· {e.text}</Text>
          ))}
        </View>
      )}

      <Text style={[styles.sectionLabel, { color: theme.subtle, marginTop: 16 }]}>关系</Text>
      <EgoGraph
        focalName={character.name}
        characters={allCharacters}
        relations={relations}
        width={280}
        height={200}
        onSelectCharacter={onSelectCharacter}
      />
    </View>
  );
}

function ChipRow({ label, items, theme }: { label: string; items: string[]; theme: ReturnType<typeof resolveTheme> }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={[styles.sectionLabel, { color: theme.subtle }]}>{label}</Text>
      <View style={styles.chipRow}>
        {items.map((item) => (
          <View key={item} style={[styles.chip, { backgroundColor: `${theme.accent}22` }]}>
            <Text style={[styles.chipText, { color: theme.accent }]}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 22, paddingTop: 50 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '700' },
  closeText: { fontSize: 14, fontWeight: '600' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 14 },
  hint: { fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 9 },
  tabText: { fontSize: 13.5, fontWeight: '600' },
  primary: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondary: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 10, alignItems: 'center', marginBottom: 10 },
  secondaryText: { fontSize: 13.5, fontWeight: '600' },
  cancel: { fontSize: 13, textDecorationLine: 'underline' },
  error: { fontSize: 14, marginBottom: 12, textAlign: 'center' },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10 },
  listItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  listItemText: { fontSize: 15, fontWeight: '600' },
  listItemSubtitle: { fontSize: 12.5, marginTop: 2 },
  sectionHeader: { paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  detailTitle: { fontSize: 20, fontWeight: '700', marginVertical: 12 },
  detailLine: { fontSize: 14.5, lineHeight: 22, marginBottom: 6 },
  timeline: { marginTop: 8, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12 },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- CodexModal.test.tsx`
Expected: PASS, all new tests plus all pre-existing tests (re-verify pre-existing tests that reference `codex-character-list`'s old `.map()` structure still find items via `FlatList`'s rendered output — RNTL's `render` handles `FlatList` transparently, but if any pre-existing test asserted on a specific non-virtualized DOM structure, adjust it).

- [ ] **Step 5: Commit**

```bash
git add src/reader/CodexModal.tsx src/reader/__tests__/CodexModal.test.tsx
git commit -m "feat(codex): CodexModal overhaul — search, FlatList/SectionList, full field display"
```

---

## Task 12: `ReaderScreen.tsx` — wire `polishChat`

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`
- Test: `src/screens/__tests__/ReaderScreen.test.tsx`

**Interfaces:**
- Consumes: `PolishChatFn` type shape matches `codexChat`'s existing shape (same `chatComplete` call pattern).
- Produces: `runEnsureCodex`'s call to `ensureCodex` now passes `polishChat` in its deps object.

- [ ] **Step 1: Write the failing test**

Add to `src/screens/__tests__/ReaderScreen.test.tsx` (find the existing codex-related `describe` block and add alongside it):

```tsx
it('passes a polishChat function to ensureCodex so the polish pass can run', async () => {
  // 复用文件里已有的「配置好+已同意+autoSummarize 开」的 aiConfig 种子和
  // global.fetch mock 惯例（参照 'aborts an in-flight codex extraction...' 测试）。
  // 断言：图鉴打开后，发往 AI 服务商的请求里，除了已有的抽取/摘要请求外，
  // 至少应该出现一次请求体，其 messages 内容匹配润色 prompt 的特征字样
  // （如包含"整合"或"连贯"），证明 polishChat 确实被调用并传给了 ensureCodex。
  // 具体断言方式需要参照文件里已有的 global.fetch mock 具体写法（读取
  // fetch.mock.calls 里 request body 的 messages 字段）来对齐。
});
```

Note to implementer: read the existing test file's exact `global.fetch` mocking convention (used by the already-existing `'aborts an in-flight codex extraction when the modal is closed'` test, per `.superpowers/sdd/task-9-report.md`) before writing this test's body — reuse the same mock-capture pattern rather than inventing a new one. The assertion should confirm `ensureCodex` is invoked with a `polishChat` function that, when called, hits `chatComplete` with a request distinguishable from `codexChat`'s extraction requests (e.g. by asserting on the system prompt content once `polishCodex` actually fires, using a codex/book fixture with enough content to have a dirty entity trigger polish at catch-up).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest -- ReaderScreen.test.tsx`
Expected: FAIL — `runEnsureCodex`'s deps object has no `polishChat` yet, so either a TS compile error or the assertion doesn't find the expected request.

- [ ] **Step 3: Implement**

In `src/screens/ReaderScreen.tsx`, add a `polishChat` adapter right after the existing `codexChat` definition (~line 519):

```tsx
  // 润色 pass 的独立 chat 适配器：更低的 maxTokens（简介本身要求 60-140 字，
  // 批量~6个实体一次调用，token 需求远小于抽取）；同样开 JSON mode。
  const polishChat: PolishChatFn = useCallback(
    async (messages: ChatMessage[], sig?: AbortSignal): Promise<ChatResult> =>
      chatComplete({ config: aiConfig, messages, signal: sig, maxTokens: 900, temperature: 0.3, responseFormat: 'json_object' }),
    [aiConfig],
  );
```

Add `PolishChatFn` to the existing import from `../lib/ai/codexPolish` — wait, `PolishChatFn` is exported from `codexPolish.ts` per Task 4; add an import line:

```tsx
import type { PolishChatFn } from '../lib/ai/codexPolish';
```

Update `runEnsureCodex`'s call to `ensureCodex` (~line 576-588) to include `polishChat` in the deps object and dependency array:

```tsx
        const res = await ensureCodex(
          { chat: codexChat, polishChat, summarizeChat: aiChat, fs, repo },
          {
            book,
            chapters,
            cutoff,
            model: aiConfig.model,
            autoOn: aiConfig.autoSummarize,
            forceRebuild,
            signal: ctrl.signal,
            onProgress: (done, total) => setCodexProgress({ done, total }),
          },
        );
```

And add `polishChat` to `runEnsureCodex`'s `useCallback` dependency array (~line 602):

```tsx
    [book, chapters, currentChapterIndex, codexChat, polishChat, aiChat, fs, repo, aiConfig.model, aiConfig.autoSummarize],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest -- ReaderScreen.test.tsx`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ReaderScreen.tsx src/screens/__tests__/ReaderScreen.test.tsx
git commit -m "feat(codex): wire polishChat into ReaderScreen's ensureCodex call"
```

---

## Task 13: Cleanup + full gate + final review

**Files:**
- Review: entire `feat/reading-codex` branch diff since the increment-8-to-8.5 boundary.

**Interfaces:** None new — this task verifies the whole branch is internally consistent.

- [ ] **Step 1: Grep for dead references**

Run:
```bash
grep -rn "layoutFactionGraph\|RelationshipGraph\|factionLayout" src/ --include="*.ts" --include="*.tsx"
```
Expected: zero matches (everything was renamed/deleted in Tasks 6 and 10). If any remain, fix them before proceeding.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all suites pass, 0 failures, 0 unexpected console errors/warnings.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, zero output.

- [ ] **Step 4: Export check (confirms no bundler-level breakage)**

Run: `npx expo export --platform ios`
Expected: exit 0, bundle produced successfully.

- [ ] **Step 5: Update the SDD progress ledger**

Append a new section to `.superpowers/sdd/progress.md` documenting Tasks 1-13 of 增量 8.5, mirroring the existing ledger's style (task-by-task one-liners with commit ranges and review verdicts, plus a final whole-branch review entry once done).

- [ ] **Step 6: Dispatch the final whole-branch review**

Use `superpowers:requesting-code-review`'s reviewer template, dispatched on **opus**, with `scripts/review-package` run against the merge-base of this 8.5 sub-increment (the commit at the end of Task 13 of the original 增量 8 plan, i.e. where this plan's Task 1 started) through `HEAD`. Give the reviewer the two red-line invariants from this plan's Global Constraints section explicitly as its attention lens (containment-guard idx rule; batch-wide polish idx-stamping rule; catch-up-only polish timing), since those are the two places an adversarial pre-implementation review already found real spoiler leaks in the naive design — the reviewer's job is to confirm the actual implementation (not just the plan) got them right.

- [ ] **Step 7: Fix any Critical/Important findings, re-review, then commit the ledger update**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs: update SDD progress ledger for 增量 8.5"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage check**: Tasks 1-2 cover "一、内容质量" data model + merge guard; Tasks 3-5 cover the polish pipeline + orchestration; Tasks 6-7 cover "二、关系呈现"; Task 8 + parts of Task 11 cover "三、UI/检索"; Tasks 9-10 cover the new components; Task 11 covers the full CodexModal overhaul; Task 12 wires it into ReaderScreen; Task 13 is cleanup/verification. All spec sections have a corresponding task.
- **Type consistency check**: `PolishChatFn` (Task 4) is the same shape as `CodexChatFn` used elsewhere (`(messages: ChatMessage[], signal?: AbortSignal) => Promise<ChatResult>`) — verified against `codexExtract.ts`'s existing `CodexChatFn` definition. `GroupSection`/`RosterNode`/`RelationChip` (Task 6) are consumed as-named by `RelationRoster.tsx` (Task 9) with no renaming. `EgoNode`/`EgoEdge` (Task 7) are consumed as-named by `EgoGraph.tsx` (Task 10).
- **Known follow-up, not blocking**: Task 11's `progress` prop gains an optional `phase?: 'extract' | 'polish'` field for the UI's "整合润色中…" label (per the spec's M1 minor finding); `ensureCodex.ts`'s `onProgress` callback signature in Task 5 does not yet thread a `phase` value through — the implementer should either extend `onProgress` to `(done, total, phase?) => void` while wiring Task 5, or accept that the progress label falls back to the generic "正在整理图鉴…" text during the polish phase for this iteration (non-blocking, cosmetic; flag to the reviewer if simplified this way).
