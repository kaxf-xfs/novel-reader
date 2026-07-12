# 增量 8 · 已读图鉴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已读内容组织成防剧透的结构化图鉴（人物卡 + 世界观词典 + 势力分组关系图），随阅读进度增量抽取、回退进度自动收窄。

**Architecture:** 新表 `ai_codex` 缓存一份 map-reduce 抽取出的结构化 `Codex`（人物/词条/关系，每个可展示字段都带章节 idx）；纯函数 `codexForCutoff` 是唯一展示门；`react-native-svg` 渲染按势力分组布局的关系图。

**Tech Stack:** Expo SDK57 / RN 0.86 / TS strict / Jest 29 + jest-expo；新增原生依赖 `react-native-svg`。

## Global Constraints

- 防剧透硬不变量：任何展示内容的 idx 必须 `<= cutoff`（`cutoff = currentChapterIndex - 1`）；所有 idx 由代码盖章为其所属抽取块的 `maxIdx`，**绝不采信 LLM 自报的 idx**。
- `mergeCodex` 折叠前必须把输入按块 `maxIdx` **升序排序**，使 canonical name「first-write-wins」等价于「最早块优先」。
- `Character.name` 取最早块（min `firstChapterIdx`）的字面名，永不被后续块覆盖；更晚的名字进 `aliases`。
- `Term.def` 版本化为 `{text,idx}[]`；`Term.category` first-write-wins。
- `Relation` 去重 key 必须包含 `kind`。
- 抽取输入是**章摘要**（不是弧摘要）——质量优先标准指令。
- `chatComplete` 的 `responseFormat` 是可选、best-effort 的加法式扩展，不得破坏现有调用方。
- 本增量是本项目第一个原生依赖（`react-native-svg`），**不走 EAS Update OTA**，完成后需 `build-unsigned-ipa.yml` 重出 ipa + Sideloadly 重装。
- `CodexModal` 及其子组件只接收 `codexForCutoff` 过滤后的数据，绝不同时持有裸 `codex` + `cutoff`。
- `layoutFactionGraph` 的输入必须是已过滤的 `codexForCutoff` 输出。
- `npm test` 全绿、`tsc` 干净、`expo export ios` 成功，是每个任务收尾的门禁基线（最终任务额外要求真机验证）。

---

## Task 1: 引入 react-native-svg + jest transform 冒烟测试

**Files:**
- Modify: `package.json`（新增 `react-native-svg` 依赖）
- Create: `src/reader/__tests__/svgSmoke.test.tsx`

**Interfaces:**
- Consumes: 无（本任务只验证依赖可用）
- Produces: `react-native-svg` 的 `Svg`/`Circle`/`Line`/`Text`/`G` 组件可在 jest-expo 环境下渲染，供 Task 8 使用。

- [ ] **Step 1: 安装依赖**

```bash
npx expo install react-native-svg
```

Expected: `package.json` 的 `dependencies` 里新增一行 `"react-native-svg": "..."`（Expo 会自动锁定 SDK57 兼容版本），`node_modules/react-native-svg` 存在。

- [ ] **Step 2: 写冒烟测试（先失败，确认测试文件本身能跑）**

```tsx
// src/reader/__tests__/svgSmoke.test.tsx
import { render } from '@testing-library/react-native';
import Svg, { Circle, Line, Text as SvgText, G } from 'react-native-svg';

describe('react-native-svg jest transform', () => {
  it('renders Svg primitives without throwing', () => {
    const { getByTestId } = render(
      <Svg testID="svg-root" width={100} height={100}>
        <G>
          <Circle cx={50} cy={50} r={10} fill="#000" />
          <Line x1={0} y1={0} x2={100} y2={100} stroke="#000" />
          <SvgText x={10} y={10}>标签</SvgText>
        </G>
      </Svg>,
    );
    expect(getByTestId('svg-root')).toBeTruthy();
  });
});
```

- [ ] **Step 3: 跑测试确认通过（这是确认 jest 配置的验收，不是 TDD 红灯——依赖是否装好本身就是待验证的事实）**

Run: `npm test -- svgSmoke`
Expected: PASS，1 passed。若报 `Cannot find module 'react-native-svg'`，说明 Step 1 未完成；若报 transform 相关的 SyntaxError（如 `Unexpected token 'export'`），检查 `package.json` 的 `jest.transformIgnorePatterns` 是否仍包含 `react-native-svg`（AGENTS.md 记录已预先加好，本步骤即验证这一点）。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/reader/__tests__/svgSmoke.test.tsx
git commit -m "feat(codex): add react-native-svg dep + jest transform smoke test"
```

---

## Task 2: chatComplete 加 responseFormat（JSON mode，best-effort）

**Files:**
- Modify: `src/lib/ai/client.ts`
- Test: `src/lib/ai/__tests__/client.test.ts`

**Interfaces:**
- Consumes: 无新依赖。
- Produces: `ChatOptions.responseFormat?: 'json_object'`；当传入时，请求体带 `response_format: { type: 'json_object' }`。Task 4a 的抽取调用会用到这个参数。

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 src/lib/ai/__tests__/client.test.ts
it('passes response_format when responseFormat is set', async () => {
  const fetchImpl = jest.fn(async () =>
    jsonResponse(200, { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }),
  ) as unknown as typeof fetch;
  await chatComplete({ config: cfg, messages: msgs, fetchImpl, responseFormat: 'json_object' });
  const [, init] = (fetchImpl as jest.Mock).mock.calls[0];
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.response_format).toEqual({ type: 'json_object' });
});

it('omits response_format when not set (unchanged existing behavior)', async () => {
  const fetchImpl = jest.fn(async () =>
    jsonResponse(200, { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }),
  ) as unknown as typeof fetch;
  await chatComplete({ config: cfg, messages: msgs, fetchImpl });
  const [, init] = (fetchImpl as jest.Mock).mock.calls[0];
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.response_format).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- client.test.ts`
Expected: FAIL — `expect(body.response_format).toEqual(...)` 收到 `undefined`（参数还不存在/未透传）。

- [ ] **Step 3: 实现**

在 `src/lib/ai/client.ts` 的 `ChatOptions` 里加字段，请求体透传：

```ts
export interface ChatOptions {
  config: AiConfig;
  messages: ChatMessage[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** best-effort JSON mode；部分 endpoint 不支持时静默忽略，由调用方自行做健壮 JSON 解析兜底。 */
  responseFormat?: 'json_object';
}
```

```ts
export async function chatComplete(opts: ChatOptions): Promise<ChatResult> {
  const { config, messages, signal, maxTokens, temperature, timeoutMs = 60_000, responseFormat } = opts;
  // ...(unchanged setup)...
  const res = await doFetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
      ...(temperature != null ? { temperature } : {}),
      ...(responseFormat != null ? { response_format: { type: responseFormat } } : {}),
    }),
    signal: controller.signal,
  });
  // ...(rest unchanged)...
```

（只改 `ChatOptions` 解构行、`body` 的 `JSON.stringify` 对象字面量，其余函数体不变。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- client.test.ts`
Expected: PASS，全部用例（含既有的）通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/client.ts src/lib/ai/__tests__/client.test.ts
git commit -m "feat(codex): chatComplete accepts optional responseFormat (best-effort JSON mode)"
```

---

## Task 3: Codex 类型 + codexForCutoff + ai_codex 表 + repo 方法

**Files:**
- Create: `src/lib/ai/codex.ts`
- Test: `src/lib/ai/__tests__/codex.test.ts`
- Modify: `src/lib/import/repository.ts`
- Test: `src/lib/import/__tests__/repository.codex.test.ts`
- Modify: `src/lib/import/sqliteRepository.ts`（不加单测——项目既有约定，原生 SQLite 不在 Jest 里跑，由 tsc strict 保证类型正确）

**Interfaces:**
- Consumes: 无新依赖。
- Produces:
  - `src/lib/ai/codex.ts`: `TextAtIdx { text; idx }`, `NamedAtIdx { name; idx }`, `Character { name; aliases; identity; origin?; groups; firstChapterIdx; events? }`, `TermCategory`, `Term { name; category; def; firstChapterIdx }`, `Relation { from; to; kind; idx }`, `Codex { characters; terms; relations }`, `EMPTY_CODEX`, `codexForCutoff(codex: Codex, cutoff: number): Codex`. Task 4a/4b/5/6/7/8/9 全部依赖这些类型。
  - `src/lib/import/repository.ts`: `CodexRecord { bookId; coveredUptoIdx; model; promptVersion; json; updatedAt }`；`BookRepository.getCodex(bookId): Promise<CodexRecord | null>`、`.putCodex(record: CodexRecord): Promise<void>`；`InMemoryBookRepository` 实现 + `deleteBook` 级联清除。Task 5 依赖。

### Part A — Codex 类型 + codexForCutoff（防剧透红线，本任务的核心）

- [ ] **Step 1: 写失败测试（回退收窄的核心契约）**

```ts
// src/lib/ai/__tests__/codex.test.ts
import { codexForCutoff, EMPTY_CODEX, type Codex } from '../codex';

function baseCodex(): Codex {
  return {
    characters: [
      {
        name: '小明',
        aliases: [{ text: '真名·玄天真人', idx: 8 }],
        identity: [{ text: '一个普通少年', idx: 0 }, { text: '隐世宗门传人', idx: 8 }],
        origin: [{ text: '出身贫寒村落', idx: 2 }],
        groups: [{ name: '青云门', idx: 8 }],
        firstChapterIdx: 0,
        events: [{ text: '初入宗门', idx: 1 }],
      },
      {
        name: '未来反派',
        aliases: [],
        identity: [{ text: '尚未登场', idx: 20 }],
        groups: [],
        firstChapterIdx: 20,
      },
    ],
    terms: [
      {
        name: '青云诀',
        category: '功法',
        def: [{ text: '入门吐纳法', idx: 1 }, { text: '实为上古仙法残篇', idx: 9 }],
        firstChapterIdx: 1,
      },
    ],
    relations: [
      { from: '小明', to: '未来反派', kind: '结怨', idx: 3 },
    ],
  };
}

describe('codexForCutoff', () => {
  it('hides a character whose firstChapterIdx is beyond cutoff', () => {
    const out = codexForCutoff(baseCodex(), 5);
    expect(out.characters.map((c) => c.name)).toEqual(['小明']);
  });

  it('回退进度后收窄：只保留 idx<=cutoff 的 aliases/identity/origin/groups/events，name 恒可见', () => {
    const out = codexForCutoff(baseCodex(), 5);
    const ming = out.characters[0];
    expect(ming.name).toBe('小明'); // canonical name 恒安全
    expect(ming.aliases).toEqual([]); // idx=8 的别名未到
    expect(ming.identity.map((i) => i.text)).toEqual(['一个普通少年']); // idx=8 那条未到
    expect(ming.origin?.map((i) => i.text)).toEqual(['出身贫寒村落']);
    expect(ming.groups).toEqual([]); // idx=8 的势力归属未到
    expect(ming.events?.map((e) => e.text)).toEqual(['初入宗门']);
  });

  it('回退到 cutoff=8 后，别名/势力等随之出现', () => {
    const out = codexForCutoff(baseCodex(), 8);
    const ming = out.characters[0];
    expect(ming.aliases.map((a) => a.text)).toEqual(['真名·玄天真人']);
    expect(ming.groups.map((g) => g.name)).toEqual(['青云门']);
  });

  it('词条 def 版本化：展示 idx<=cutoff 中最新的一条，未来释义不泄漏', () => {
    const early = codexForCutoff(baseCodex(), 3);
    expect(early.terms[0].def.map((d) => d.text)).toEqual(['入门吐纳法']);
    const late = codexForCutoff(baseCodex(), 9);
    expect(late.terms[0].def.map((d) => d.text)).toEqual(['实为上古仙法残篇']);
  });

  it('relation 端点任一方不在已展示人物集合时丢弃（即便 relation.idx<=cutoff）', () => {
    const out = codexForCutoff(baseCodex(), 5); // idx=3<=5 但「未来反派」firstChapterIdx=20>5，不可见
    expect(out.relations).toEqual([]);
  });

  it('relation.idx 超过 cutoff 时丢弃，即便双方都可见', () => {
    const codex = baseCodex();
    codex.characters[1] = { ...codex.characters[1], firstChapterIdx: 0 }; // 让双方都可见
    const out = codexForCutoff(codex, 2); // relation idx=3 > cutoff=2
    expect(out.relations).toEqual([]);
  });

  it('空 Codex 回退安全', () => {
    expect(codexForCutoff(EMPTY_CODEX, 5)).toEqual(EMPTY_CODEX);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- codex.test.ts`
Expected: FAIL — `Cannot find module '../codex'`。

- [ ] **Step 3: 实现**

```ts
// src/lib/ai/codex.ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- codex.test.ts`
Expected: PASS，7 passed。

### Part B — ai_codex 表 + repo 方法

- [ ] **Step 5: 写失败测试**

```ts
// src/lib/import/__tests__/repository.codex.test.ts
import { InMemoryBookRepository, type CodexRecord } from '../repository';

function rec(over: Partial<CodexRecord> = {}): CodexRecord {
  return {
    bookId: 'b1',
    coveredUptoIdx: 9,
    model: 'deepseek-chat',
    promptVersion: 'v1',
    json: JSON.stringify({ characters: [], terms: [], relations: [] }),
    updatedAt: 1,
    ...over,
  };
}

function seedBook(repo: InMemoryBookRepository, id: string) {
  return repo.addBook({
    id, title: id, originalName: `${id}.txt`, encoding: 'utf-8', sizeBytes: 1,
    importedAt: 1, coverColor: '#000', strategy: 'regex', normalizedPath: `/p/${id}`,
  });
}

describe('InMemoryBookRepository ai_codex', () => {
  it('putCodex + getCodex round-trip', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putCodex(rec());
    expect(await repo.getCodex('b1')).toMatchObject({ bookId: 'b1', coveredUptoIdx: 9 });
  });

  it('getCodex returns null when absent', async () => {
    const repo = new InMemoryBookRepository();
    expect(await repo.getCodex('missing')).toBeNull();
  });

  it('putCodex upserts (one row per book)', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putCodex(rec({ coveredUptoIdx: 9 }));
    await repo.putCodex(rec({ coveredUptoIdx: 20 }));
    const got = await repo.getCodex('b1');
    expect(got?.coveredUptoIdx).toBe(20);
  });

  it('cascades codex deletion when the book is deleted', async () => {
    const repo = new InMemoryBookRepository();
    await seedBook(repo, 'b1');
    await seedBook(repo, 'b2');
    await repo.putCodex(rec({ bookId: 'b1' }));
    await repo.putCodex(rec({ bookId: 'b2' }));
    await repo.deleteBook('b1');
    expect(await repo.getCodex('b1')).toBeNull();
    expect(await repo.getCodex('b2')).not.toBeNull();
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npm test -- repository.codex.test.ts`
Expected: FAIL — `repo.putCodex is not a function`。

- [ ] **Step 7: 实现（repository.ts）**

在 `src/lib/import/repository.ts` 的 record types 区块加：

```ts
export interface CodexRecord {
  bookId: string;
  /** 已纳入抽取的最大章节 idx（-1 = 尚未抽取任何内容）。 */
  coveredUptoIdx: number;
  model: string;
  promptVersion: string;
  /** 序列化后的 Codex（见 codex.ts）。 */
  json: string;
  updatedAt: number;
}
```

在 `BookRepository` 接口里加（跟 `putSummary`/`getSummary` 挨着）：

```ts
  /** Upserts the one codex row for a book. */
  putCodex(record: CodexRecord): Promise<void>;
  /** Returns the codex row for a book, or null if none exists. */
  getCodex(bookId: string): Promise<CodexRecord | null>;
```

在 `InMemoryBookRepository` 类里加字段和方法：

```ts
  private codices = new Map<string, CodexRecord>();
```

```ts
  async putCodex(record: CodexRecord): Promise<void> {
    this.codices.set(record.bookId, { ...record });
  }

  async getCodex(bookId: string): Promise<CodexRecord | null> {
    return this.codices.get(bookId) ?? null;
  }
```

在 `deleteBook` 方法体里加一行级联清理（跟 `this.summaries` 那行的风格一致）：

```ts
    this.codices.delete(bookId);
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npm test -- repository.codex.test.ts`
Expected: PASS，4 passed。

- [ ] **Step 9: 实现（sqliteRepository.ts，无单测——项目既有约定）**

在 DDL 区块加（`CREATE_SUMMARIES_TABLE` 后面）：

```ts
const CREATE_CODEX_TABLE = `
  CREATE TABLE IF NOT EXISTS ai_codex (
    bookId         TEXT PRIMARY KEY,
    coveredUptoIdx INTEGER NOT NULL,
    model          TEXT NOT NULL,
    promptVersion  TEXT NOT NULL,
    json           TEXT NOT NULL,
    updatedAt      INTEGER NOT NULL,
    FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
  );
`;
```

在 `open()` 里的 `execAsync` 拼接串末尾加上 `+ CREATE_CODEX_TABLE`：

```ts
    await db.execAsync(
      CREATE_BOOKS_TABLE +
        CREATE_CHAPTERS_TABLE +
        CREATE_CHAPTERS_INDEX +
        CREATE_PROGRESS_TABLE +
        CREATE_BOOKMARKS_TABLE +
        CREATE_SESSIONS_TABLE +
        CREATE_SESSIONS_INDEX +
        CREATE_SUMMARIES_TABLE +
        CREATE_CODEX_TABLE,
    );
```

在 `SqliteBookRepository` 类里（`listSummaries` 方法后面）加：

```ts
  async putCodex(record: CodexRecord): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync(
      `INSERT OR REPLACE INTO ai_codex (bookId, coveredUptoIdx, model, promptVersion, json, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      record.bookId, record.coveredUptoIdx, record.model, record.promptVersion, record.json, record.updatedAt,
    );
  }

  async getCodex(bookId: string): Promise<CodexRecord | null> {
    const db = await this.dbPromise;
    type Row = { bookId: string; coveredUptoIdx: number; model: string; promptVersion: string; json: string; updatedAt: number };
    const row = await db.getFirstAsync<Row>('SELECT * FROM ai_codex WHERE bookId = ?', bookId);
    return row ? { ...row } : null;
  }
```

别忘了在文件顶部的 import 里把 `CodexRecord` 加进 `from './repository'` 的类型导入列表。同时更新文件顶部注释块（`Schema` 段落）新增 `ai_codex` 表的说明，跟着 `ai_summaries` 那段的格式写一份。

- [ ] **Step 10: tsc 确认无类型错误（sqliteRepository.ts 不跑单测，靠这个把关）**

Run: `npx tsc --noEmit`
Expected: 无输出（无错误）。

- [ ] **Step 11: Commit**

```bash
git add src/lib/ai/codex.ts src/lib/ai/__tests__/codex.test.ts src/lib/import/repository.ts src/lib/import/__tests__/repository.codex.test.ts src/lib/import/sqliteRepository.ts
git commit -m "feat(codex): Codex types + codexForCutoff spoiler gate + ai_codex table/repo"
```

---

## Task 4a: extractCodex（单块抽取，idx 代码盖章 + 截断二分重试）

**Files:**
- Modify: `src/lib/ai/summarize.ts`（导出 `runPool`）
- Create: `src/lib/ai/codexExtract.ts`
- Test: `src/lib/ai/__tests__/codexExtract.test.ts`

**Interfaces:**
- Consumes: `runPool<T>(items, concurrency, worker)`（从 `summarize.ts` 导出）；`ChatMessage`, `ChatResult`, `AiError` from `./client`；`Character`, `Term`, `Relation`, `Codex`, `TermCategory` from `./codex`。
- Produces:
  - `CodexSummaryItem { idx: number; summary: string }`
  - `CodexBlock { items: CodexSummaryItem[] }`
  - `RosterEntry { name: string; aliases: string[] }`
  - `CodexBlockResult { maxIdx: number; partial: Partial<Codex> }`
  - `extractCodex(deps: { chat: (messages: ChatMessage[], signal?: AbortSignal) => Promise<ChatResult> }, params: { blocks: CodexBlock[]; roster: RosterEntry[]; signal?: AbortSignal; onProgress?: (done: number, total: number) => void; concurrency?: number }): Promise<CodexBlockResult[]>`

  Task 4b（`mergeCodex`）消费 `CodexBlockResult[]`；Task 5（`ensureCodex`）消费 `extractCodex` 本身、`CodexBlock`、`RosterEntry`。

- [ ] **Step 1: 导出 runPool**

在 `src/lib/ai/summarize.ts` 里把：

```ts
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
```

改成：

```ts
export async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
```

Run: `npm test -- summarize.test.ts` — Expected: PASS（纯加 `export` 关键字，不改行为，既有测试应保持全绿）。

- [ ] **Step 2: 写失败测试（idx 代码盖章，不采信 LLM 自报）**

```ts
// src/lib/ai/__tests__/codexExtract.test.ts
import type { ChatMessage, ChatResult } from '../client';
import { extractCodex, type CodexBlock, type RosterEntry } from '../codexExtract';

function block(items: { idx: number; summary: string }[]): CodexBlock {
  return { items };
}

describe('extractCodex', () => {
  it('stamps every idx to the block maxIdx, ignoring any self-reported idx in the LLM JSON', async () => {
    const chat = jest.fn(
      async (): Promise<ChatResult> => ({
        content: JSON.stringify({
          characters: [{ name: '张三', idx: 9999, aliases: [], identity: ['少年侠客'], groups: ['无名派'] }],
          terms: [{ name: '无名剑', category: '物品', def: '一把普通铁剑', idx: 9999 }],
          relations: [{ from: '张三', to: '李四', kind: '同门' }],
        }),
        finishReason: 'stop',
      }),
    );
    const blocks = [block([{ idx: 3, summary: 's3' }, { idx: 5, summary: 's5' }])];
    const [result] = await extractCodex({ chat }, { blocks, roster: [] });
    expect(result.maxIdx).toBe(5);
    expect(result.partial.characters?.[0]).toMatchObject({ name: '张三', firstChapterIdx: 5 });
    expect(result.partial.characters?.[0].identity).toEqual([{ text: '少年侠客', idx: 5 }]);
    expect(result.partial.terms?.[0].def).toEqual([{ text: '一把普通铁剑', idx: 5 }]);
    expect(result.partial.relations?.[0]).toEqual({ from: '张三', to: '李四', kind: '同门', idx: 5 });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- codexExtract.test.ts`
Expected: FAIL — `Cannot find module '../codexExtract'`。

- [ ] **Step 4: 实现（第一版：单块、无二分、健壮 JSON 解析）**

```ts
// src/lib/ai/codexExtract.ts
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- codexExtract.test.ts`
Expected: PASS，1 passed。

- [ ] **Step 6: 写失败测试（坏 JSON 整块跳过，不炸；坏实体单条跳过）**

```ts
// 追加到 src/lib/ai/__tests__/codexExtract.test.ts
it('a whole block with unparseable JSON degrades to empty, never throws', async () => {
  const chat = jest.fn(async (): Promise<ChatResult> => ({ content: '不是 JSON，抱歉', finishReason: 'stop' }));
  const blocks = [block([{ idx: 1, summary: 's1' }])];
  const [result] = await extractCodex({ chat }, { blocks, roster: [] });
  expect(result.partial).toEqual({ characters: [], terms: [], relations: [] });
});

it('drops a single bad entity (missing name) but keeps the rest of the same block', async () => {
  const chat = jest.fn(
    async (): Promise<ChatResult> => ({
      content: JSON.stringify({
        characters: [{ aliases: [] }, { name: '王五', identity: ['配角'] }],
        terms: [],
        relations: [],
      }),
      finishReason: 'stop',
    }),
  );
  const blocks = [block([{ idx: 2, summary: 's2' }])];
  const [result] = await extractCodex({ chat }, { blocks, roster: [] });
  expect(result.partial.characters?.map((c) => c.name)).toEqual(['王五']);
});
```

- [ ] **Step 7: 跑测试确认通过（应已由 Step 4 的实现覆盖，无需再改代码）**

Run: `npm test -- codexExtract.test.ts`
Expected: PASS，3 passed。

- [ ] **Step 8: 写失败测试（截断二分重试 + 深度上限防死递归）**

```ts
// 追加到 src/lib/ai/__tests__/codexExtract.test.ts
it('bisects a truncated block into two sub-blocks with their own recomputed maxIdx', async () => {
  const calls: number[] = [];
  const chat = jest.fn(async (messages: ChatMessage[]): Promise<ChatResult> => {
    const userText = messages[1].content;
    calls.push(userText.split('\n').length); // 记录每次调用喂了几条摘要
    if (userText.includes('[2]')) {
      // 父块（两条摘要）永远截断，逼迫二分
      return { content: 'x', finishReason: 'length' };
    }
    return { content: JSON.stringify({ characters: [{ name: 'X' }], terms: [], relations: [] }), finishReason: 'stop' };
  });
  const blocks = [block([{ idx: 3, summary: 's3' }, { idx: 7, summary: 's7' }])];
  const [result] = await extractCodex({ chat }, { blocks, roster: [] });
  expect(calls.length).toBe(3); // 1 次父块（截断）+ 2 次子块
  expect(result.maxIdx).toBe(7); // 顶层结果的 maxIdx 仍是整块的 maxIdx
  expect(result.partial.characters?.length).toBe(2); // 两个子块各贡献一个 X
});

it('caps bisection recursion depth so an always-truncated block terminates', async () => {
  const chat = jest.fn(async (): Promise<ChatResult> => ({ content: 'never valid', finishReason: 'length' }));
  const items = Array.from({ length: 20 }, (_, i) => ({ idx: i, summary: `s${i}` }));
  const blocks = [block(items)];
  await expect(extractCodex({ chat }, { blocks, roster: [] })).resolves.toBeDefined();
  // 20 条摘要每次对半分：20→10→5→3→2(depth4 停止细分，直接按当前子块尝试解析)
  // 深度封顶保证了这里不会无限递归/调用数不会失控增长。
  expect(chat.mock.calls.length).toBeLessThan(50);
});
```

- [ ] **Step 9: 跑测试确认通过**

Run: `npm test -- codexExtract.test.ts`
Expected: PASS，5 passed。

- [ ] **Step 10: 写失败测试（roster 锚定文案 + 空 roster 回退文案）**

```ts
// 追加到 src/lib/ai/__tests__/codexExtract.test.ts
it('injects the roster into the prompt when provided, and a fallback note when empty', async () => {
  const chat = jest.fn(async (): Promise<ChatResult> => ({ content: '{}', finishReason: 'stop' }));
  const roster: RosterEntry[] = [{ name: '张三', aliases: ['三公子'] }];
  const blocks = [block([{ idx: 0, summary: 's0' }])];

  await extractCodex({ chat }, { blocks, roster });
  const withRoster = (chat.mock.calls[0][0] as ChatMessage[])[0].content;
  expect(withRoster).toContain('张三');
  expect(withRoster).toContain('三公子');

  await extractCodex({ chat }, { blocks, roster: [] });
  const withoutRoster = (chat.mock.calls[1][0] as ChatMessage[])[0].content;
  expect(withoutRoster).toContain('暂无已知人物名册');
});
```

- [ ] **Step 11: 跑测试确认通过**

Run: `npm test -- codexExtract.test.ts`
Expected: PASS，6 passed。

- [ ] **Step 12: Commit**

```bash
git add src/lib/ai/summarize.ts src/lib/ai/codexExtract.ts src/lib/ai/__tests__/codexExtract.test.ts
git commit -m "feat(codex): extractCodex — idx code-stamped from block maxIdx, bisection on truncation"
```

---

## Task 4b: mergeCodex（确定性合并，折叠顺序红线守卫）

**Files:**
- Create: `src/lib/ai/codexMerge.ts`
- Test: `src/lib/ai/__tests__/codexMerge.test.ts`

**Interfaces:**
- Consumes: `Character`, `Term`, `Relation`, `Codex`, `EMPTY_CODEX` from `./codex`；`CodexBlockResult` from `./codexExtract`。
- Produces: `mergeCodex(existing: Codex, blockResults: CodexBlockResult[]): Codex`。Task 5（`ensureCodex`）依赖。

- [ ] **Step 1: 写失败测试（红线 A：折叠顺序守卫——canonical name 不因 partials 到达顺序而被未来块夺走）**

同一人物在不同块里出现时，靠 name/alias 字符串匹配来判定「是不是同一人物」——所以测试场景是：**块 A（低 idx）先叫出人物「小明」，块 B（高 idx）在 aliases 字段里明确写出「小明」这个曾用名、同时把 name 换成了新称呼**，两者之间才有字符串锚点可以归并。`runPool` 的并发产出顺序无法保证块 A 先到，所以测试把高 idx 的块 B 排在数组前面，验证排序折叠仍能让最早块的名字胜出：

```ts
// src/lib/ai/__tests__/codexMerge.test.ts
import { EMPTY_CODEX, type Character } from '../codex';
import type { CodexBlockResult } from '../codexExtract';
import { mergeCodex } from '../codexMerge';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

describe('mergeCodex', () => {
  it('folds partials sorted by maxIdx ascending, so canonical name is the earliest block\'s name even out-of-order input', () => {
    // 块 B（maxIdx=10）先叫他「玄天真人」且在 aliases 里带出他的旧名「小明」；
    // 块 A（maxIdx=3，更早）叫他「小明」。runPool 产出顺序把块 B 排在数组前面。
    const blockResults: CodexBlockResult[] = [
      {
        maxIdx: 10,
        partial: {
          characters: [char({ name: '玄天真人', aliases: [{ text: '小明', idx: 10 }], firstChapterIdx: 10 })],
          terms: [],
          relations: [],
        },
      },
      {
        maxIdx: 3,
        partial: { characters: [char({ name: '小明', firstChapterIdx: 3 })], terms: [], relations: [] },
      },
    ];
    const merged = mergeCodex(EMPTY_CODEX, blockResults);
    expect(merged.characters).toHaveLength(1);
    expect(merged.characters[0].name).toBe('小明'); // 最早块（maxIdx=3）的字面名，永不被后续块覆盖
    expect(merged.characters[0].firstChapterIdx).toBe(3);
    expect(merged.characters[0].aliases.map((a) => a.text)).toContain('玄天真人'); // 后续块的新称呼进别名
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- codexMerge.test.ts`
Expected: FAIL — `Cannot find module '../codexMerge'`。

- [ ] **Step 3: 实现**

```ts
// src/lib/ai/codexMerge.ts
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

function findCharacterIndex(chars: Character[], name: string): number {
  const key = normalize(name);
  return chars.findIndex((c) => normalize(c.name) === key || c.aliases.some((a) => normalize(a.text) === key));
}

function dedupeTextAtIdx(base: TextAtIdx[], incoming: TextAtIdx[]): TextAtIdx[] {
  const seen = new Set(base.map((x) => `${x.text} ${x.idx}`));
  const out = [...base];
  for (const x of incoming) {
    const key = `${x.text} ${x.idx}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(x);
    }
  }
  return out;
}

function dedupeNamedAtIdx(base: NamedAtIdx[], incoming: NamedAtIdx[]): NamedAtIdx[] {
  const seen = new Set(base.map((x) => `${x.name} ${x.idx}`));
  const out = [...base];
  for (const x of incoming) {
    const key = `${x.name} ${x.idx}`;
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
  const idx = findCharacterIndex(characters, nameOrAlias);
  return idx === -1 ? nameOrAlias : characters[idx].name;
}

export function mergeCodex(existing: Codex, blockResults: CodexBlockResult[]): Codex {
  const sorted = [...blockResults].sort((a, b) => a.maxIdx - b.maxIdx); // 红线 A

  const characters: Character[] = existing.characters.map((c) => ({ ...c }));
  const terms: Term[] = existing.terms.map((t) => ({ ...t }));
  let relations: Relation[] = [...existing.relations];

  for (const { partial } of sorted) {
    for (const incoming of partial.characters ?? []) {
      const idx = findCharacterIndex(characters, incoming.name);
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
      const key = `${normalize(incomingRel.from)} ${normalize(incomingRel.to)} ${normalize(incomingRel.kind)}`;
      const exists = relations.some(
        (r) => `${normalize(r.from)} ${normalize(r.to)} ${normalize(r.kind)}` === key,
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- codexMerge.test.ts`
Expected: PASS，1 passed。

- [ ] **Step 5: 写失败测试（Term.category first-write-wins；Relation dedup key 含 kind；def 版本化去重追加）**

```ts
// 追加到 src/lib/ai/__tests__/codexMerge.test.ts
import type { Term } from '../codex';

function term(over: Partial<Term>): Term {
  return { name: 'T', category: '其它', def: [], firstChapterIdx: 0, ...over };
}

it('Term.category is first-write-wins across blocks in fold order', () => {
  const blockResults: CodexBlockResult[] = [
    { maxIdx: 1, partial: { characters: [], terms: [term({ name: '青云诀', category: '功法', def: [{ text: '入门吐纳法', idx: 1 }], firstChapterIdx: 1 })], relations: [] } },
    { maxIdx: 9, partial: { characters: [], terms: [term({ name: '青云诀', category: '境界', def: [{ text: '实为仙法', idx: 9 }], firstChapterIdx: 9 })], relations: [] } },
  ];
  const merged = mergeCodex(EMPTY_CODEX, blockResults);
  expect(merged.terms[0].category).toBe('功法'); // 不被后块的「境界」改判
  expect(merged.terms[0].def.map((d) => d.text)).toEqual(['入门吐纳法', '实为仙法']); // 版本化累加
});

it('Relation dedup key includes kind: an earlier relation of a different kind is not silently overwritten', () => {
  const blockResults: CodexBlockResult[] = [
    { maxIdx: 2, partial: { characters: [], terms: [], relations: [{ from: '甲', to: '乙', kind: '结盟', idx: 2 }] } },
    { maxIdx: 8, partial: { characters: [], terms: [], relations: [{ from: '甲', to: '乙', kind: '结怨', idx: 8 }] } },
  ];
  const merged = mergeCodex(EMPTY_CODEX, blockResults);
  expect(merged.relations).toHaveLength(2);
  expect(merged.relations.map((r) => r.kind).sort()).toEqual(['结怨', '结盟']);
});

it('extends an already-persisted existing Codex rather than resetting it', () => {
  const existing = mergeCodex(EMPTY_CODEX, [
    { maxIdx: 1, partial: { characters: [char({ name: '老王', firstChapterIdx: 1 })], terms: [], relations: [] } },
  ]);
  const merged = mergeCodex(existing, [
    { maxIdx: 5, partial: { characters: [char({ name: '小李', firstChapterIdx: 5 })], terms: [], relations: [] } },
  ]);
  expect(merged.characters.map((c) => c.name).sort()).toEqual(['小李', '老王']);
});
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test -- codexMerge.test.ts`
Expected: PASS，4 passed。

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/codexMerge.ts src/lib/ai/__tests__/codexMerge.test.ts
git commit -m "feat(codex): mergeCodex — sorted-fold canonical name guard, term/relation dedup rules"
```

---

## Task 5: ensureCodex（编排：模块锁 + 检查点 + 版本容忍 + autoOn 两态）

**Files:**
- Create: `src/lib/ai/ensureCodex.ts`
- Test: `src/lib/ai/__tests__/ensureCodex.test.ts`

**Interfaces:**
- Consumes: `ensureSummaries`, `type SummarizeFn` from `./summarize`；`extractCodex`, `type CodexBlock`, `type RosterEntry` from `./codexExtract`；`mergeCodex` from `./codexMerge`；`EMPTY_CODEX`, `type Codex` from `./codex`；`AiError`, `type ChatMessage`, `type ChatResult` from `./client`；`type BookRecord`, `type BookRepository`, `type ChapterRecord`, `type CodexRecord` from `../import/repository`；`type FileGateway` from `../import/importBook`。
- Produces: `CODEX_PROMPT_VERSION`；`ensureCodex(deps, params): Promise<{ codex: Codex; coveredUptoIdx: number; complete: boolean; versionMismatch: boolean }>`；`__resetCodexLocks()`（测试专用，清空模块级锁）。Task 9（ReaderScreen 接线）依赖。

- [ ] **Step 1: 写失败测试（autoOn=true：抽到 cutoff，complete=true，落库）**

```ts
// src/lib/ai/__tests__/ensureCodex.test.ts
import { FakeFileGateway, seedReader } from '../../test-utils/fakes';
import { InMemoryBookRepository } from '../../import/repository';
import type { ChatMessage, ChatResult } from '../client';
import { ensureCodex, __resetCodexLocks } from '../ensureCodex';

function fakeCodexChat(): jest.Mock<Promise<ChatResult>, [ChatMessage[], AbortSignal?]> {
  return jest.fn(async () => ({
    content: JSON.stringify({ characters: [{ name: '主角', identity: ['少年'] }], terms: [], relations: [] }),
    finishReason: 'stop',
  }));
}

async function setup(chapterCount: number) {
  const repo = new InMemoryBookRepository();
  const fs = new FakeFileGateway();
  const chapters = Array.from({ length: chapterCount }, (_, i) => ({ title: `第${i + 1}章`, body: `正文${i + 1}` }));
  const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
  const chapterRecords = await repo.getChapters('b1');
  return { repo, fs, book, chapters: chapterRecords };
}

beforeEach(() => __resetCodexLocks());

describe('ensureCodex', () => {
  it('autoOn=true: backfills summaries then extracts to cutoff, complete=true, persists a codex row', async () => {
    const { repo, fs, book, chapters } = await setup(20);
    const summarizeChat = jest.fn(async () => 'S');
    const chat = fakeCodexChat();
    const res = await ensureCodex(
      { chat, summarizeChat, fs, repo },
      { book, chapters, cutoff: 19, model: 'm', autoOn: true },
    );
    expect(res.coveredUptoIdx).toBe(19);
    expect(res.complete).toBe(true);
    expect(res.codex.characters.map((c) => c.name)).toContain('主角');
    const stored = await repo.getCodex('b1');
    expect(stored?.coveredUptoIdx).toBe(19);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- ensureCodex.test.ts`
Expected: FAIL — `Cannot find module '../ensureCodex'`。

- [ ] **Step 3: 实现（第一版：跑通 autoOn=true 主路径）**

```ts
// src/lib/ai/ensureCodex.ts
/**
 * 增量 8 Task 5: 已读图鉴的编排层。模块级 per-book 锁串行化 ai_codex 单行
 * blob 的读-改-写；版本容忍（不自动全书重建，旧图鉴照展示、只增量扩展）；
 * 可恢复检查点（每 N 块落库一次）；autoOn 跟随全局 autoSummarize 开关切两态。
 */

import type { FileGateway } from '../import/importBook';
import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import { AiError, type ChatMessage, type ChatResult } from './client';
import { EMPTY_CODEX, type Codex } from './codex';
import { extractCodex, type CodexBlock, type RosterEntry } from './codexExtract';
import { mergeCodex } from './codexMerge';
import { ensureSummaries, type SummarizeFn } from './summarize';

export const CODEX_PROMPT_VERSION = 'v1';
const BLOCK_SIZE = 15;
const CHECKPOINT_EVERY_BLOCKS = 5;

type CodexChatFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<ChatResult>;

export interface EnsureCodexDeps {
  chat: CodexChatFn;
  /** 用于 autoOn 路径下的章摘要保底（复用 ensureSummaries）。 */
  summarizeChat: SummarizeFn;
  fs: FileGateway;
  repo: BookRepository;
}

export interface EnsureCodexParams {
  book: BookRecord;
  chapters: ChapterRecord[];
  cutoff: number;
  model: string;
  autoOn: boolean;
  /** 显式「重建图鉴」：忽略已缓存的 codex，从零重抽（仍受 cutoff/已缓存摘要约束）。 */
  forceRebuild?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface EnsureCodexResult {
  codex: Codex;
  coveredUptoIdx: number;
  complete: boolean;
  /** 已存 codex 的 model/promptVersion 与当前不一致（UI 据此显示「重建图鉴」）。 */
  versionMismatch: boolean;
}

// 模块级 per-book 锁：串行化同一本书的 read-modify-write，防止「补全」按钮与
// 任何后台预热任务并发导致丢更新。锁跨组件重挂载依然生效（不是 hook 局部 ref）。
const locks = new Map<string, Promise<unknown>>();

function withBookLock<T>(bookId: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(bookId) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  locks.set(bookId, next.catch(() => undefined));
  return next;
}

/** 测试专用：清空所有模块级锁，避免跨 it() 状态泄漏。 */
export function __resetCodexLocks(): void {
  locks.clear();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function rosterFrom(codex: Codex): RosterEntry[] {
  return codex.characters.map((c) => ({ name: c.name, aliases: c.aliases.map((a) => a.text) }));
}

async function isCoverageComplete(repo: BookRepository, bookId: string, cutoff: number): Promise<boolean> {
  const cached = await repo.listSummaries(bookId, 0, cutoff);
  return cached.length === cutoff + 1;
}

export async function ensureCodex(deps: EnsureCodexDeps, params: EnsureCodexParams): Promise<EnsureCodexResult> {
  const { book, chapters, cutoff, model, autoOn, forceRebuild = false, signal, onProgress } = params;
  if (cutoff < 0) return { codex: EMPTY_CODEX, coveredUptoIdx: -1, complete: true, versionMismatch: false };

  return withBookLock(book.id, async () => {
    const throwIfCancelled = () => {
      if (signal?.aborted) throw new AiError('cancelled', 'AI 已取消');
    };

    const existingRecord = forceRebuild ? null : await deps.repo.getCodex(book.id);
    const versionMismatch = !!existingRecord && (existingRecord.model !== model || existingRecord.promptVersion !== CODEX_PROMPT_VERSION);
    let codex: Codex = existingRecord ? (JSON.parse(existingRecord.json) as Codex) : EMPTY_CODEX;
    let coveredUptoIdx = existingRecord?.coveredUptoIdx ?? -1;

    const persist = async (uptoIdx: number) => {
      coveredUptoIdx = uptoIdx;
      await deps.repo.putCodex({
        bookId: book.id,
        coveredUptoIdx,
        model,
        promptVersion: CODEX_PROMPT_VERSION,
        json: JSON.stringify(codex),
        updatedAt: Date.now(),
      });
    };

    let availableIdx: number[];
    if (autoOn) {
      await ensureSummaries(
        { chat: deps.summarizeChat, fs: deps.fs, repo: deps.repo },
        { book, chapters, cutoff, model, signal, upgradeStale: false },
      );
      availableIdx = [];
      for (let i = coveredUptoIdx + 1; i <= cutoff; i++) availableIdx.push(i);
    } else {
      const cached = await deps.repo.listSummaries(book.id, 0, cutoff);
      availableIdx = cached.map((s) => s.idx).filter((i) => i > coveredUptoIdx);
    }

    if (availableIdx.length === 0) {
      const complete = autoOn ? true : await isCoverageComplete(deps.repo, book.id, cutoff);
      return { codex, coveredUptoIdx, complete, versionMismatch };
    }

    const blocks = chunk(availableIdx, BLOCK_SIZE);
    let doneBlocks = 0;

    for (let bi = 0; bi < blocks.length; bi += CHECKPOINT_EVERY_BLOCKS) {
      throwIfCancelled();
      const batch = blocks.slice(bi, bi + CHECKPOINT_EVERY_BLOCKS);
      const codexBlocks: CodexBlock[] = await Promise.all(
        batch.map(async (idxs) => ({
          items: await Promise.all(
            idxs.map(async (idx) => {
              const s = await deps.repo.getSummary(book.id, 0, idx);
              return { idx, summary: s?.summary ?? '' };
            }),
          ),
        })),
      );

      const results = await extractCodex(
        { chat: deps.chat },
        {
          blocks: codexBlocks,
          roster: rosterFrom(codex),
          signal,
          onProgress: (d, t) => onProgress?.(doneBlocks + d, blocks.length),
        },
      );
      codex = mergeCodex(codex, results);
      doneBlocks += batch.length;
      onProgress?.(doneBlocks, blocks.length);

      const newUpto = Math.max(coveredUptoIdx, ...batch.flat());
      throwIfCancelled();
      await persist(newUpto);
    }

    const complete = autoOn ? true : await isCoverageComplete(deps.repo, book.id, cutoff);
    return { codex, coveredUptoIdx, complete, versionMismatch };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- ensureCodex.test.ts`
Expected: PASS，1 passed。

- [ ] **Step 5: 写失败测试（autoOn=false：只用已缓存摘要，允许有缺口，complete 标志正确）**

```ts
// 追加到 src/lib/ai/__tests__/ensureCodex.test.ts
it('autoOn=false: uses only cached summaries (gaps allowed), complete=false when cutoff has a missing summary', async () => {
  const { repo, fs, book, chapters } = await setup(10);
  await repo.putSummary({ bookId: 'b1', level: 0, idx: 0, model: 'm', promptVersion: 'v2', summary: 's0', createdAt: 1 });
  await repo.putSummary({ bookId: 'b1', level: 0, idx: 2, model: 'm', promptVersion: 'v2', summary: 's2', createdAt: 1 });
  // idx 1,3..9 缺失（cutoff=9）
  const summarizeChat = jest.fn(async () => 'S');
  const chat = fakeCodexChat();
  const res = await ensureCodex(
    { chat, summarizeChat, fs, repo },
    { book, chapters, cutoff: 9, model: 'm', autoOn: false },
  );
  expect(res.complete).toBe(false);
  expect(res.coveredUptoIdx).toBe(2); // 只纳入了已缓存的 0、2
  expect(summarizeChat).not.toHaveBeenCalled(); // autoOn=false 不做章摘要保底
});
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test -- ensureCodex.test.ts`
Expected: PASS，2 passed。

- [ ] **Step 7: 写失败测试（版本容忍：不自动重建，旧图鉴保留并增量扩展）**

```ts
// 追加到 src/lib/ai/__tests__/ensureCodex.test.ts
it('version tolerance: a model/promptVersion mismatch does not wipe the existing codex, only extends it', async () => {
  const { repo, fs, book, chapters } = await setup(10);
  await repo.putCodex({
    bookId: 'b1', coveredUptoIdx: 4, model: 'OLD', promptVersion: 'v0',
    json: JSON.stringify({ characters: [{ name: '老角色', aliases: [], identity: [], groups: [], firstChapterIdx: 0 }], terms: [], relations: [] }),
    updatedAt: 1,
  });
  for (let i = 5; i <= 9; i++) {
    await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: 'v2', summary: `s${i}`, createdAt: 1 });
  }
  const summarizeChat = jest.fn(async () => 'S');
  const chat = fakeCodexChat(); // 会产出「主角」
  const res = await ensureCodex(
    { chat, summarizeChat, fs, repo },
    { book, chapters, cutoff: 9, model: 'NEW', autoOn: false },
  );
  expect(res.versionMismatch).toBe(true);
  expect(res.codex.characters.map((c) => c.name).sort()).toEqual(['主角', '老角色']); // 旧数据保留，新数据追加
  expect(res.coveredUptoIdx).toBe(9);
});

it('forceRebuild=true starts fresh, ignoring the previously persisted codex', async () => {
  const { repo, fs, book, chapters } = await setup(5);
  await repo.putCodex({
    bookId: 'b1', coveredUptoIdx: 4, model: 'OLD', promptVersion: 'v0',
    json: JSON.stringify({ characters: [{ name: '老角色', aliases: [], identity: [], groups: [], firstChapterIdx: 0 }], terms: [], relations: [] }),
    updatedAt: 1,
  });
  for (let i = 0; i <= 4; i++) {
    await repo.putSummary({ bookId: 'b1', level: 0, idx: i, model: 'm', promptVersion: 'v2', summary: `s${i}`, createdAt: 1 });
  }
  const summarizeChat = jest.fn(async () => 'S');
  const chat = fakeCodexChat();
  const res = await ensureCodex(
    { chat, summarizeChat, fs, repo },
    { book, chapters, cutoff: 4, model: 'NEW', autoOn: false, forceRebuild: true },
  );
  expect(res.versionMismatch).toBe(false); // forceRebuild 视作从零开始，无「已存版本」可比
  expect(res.codex.characters.map((c) => c.name)).toEqual(['主角']); // 「老角色」不再是「已缓存」输入，未被重新纳入
});
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npm test -- ensureCodex.test.ts`
Expected: PASS，4 passed。

- [ ] **Step 9: 写失败测试（检查点：多批次会多次落库，而不是等全部完成才落一次）**

```ts
// 追加到 src/lib/ai/__tests__/ensureCodex.test.ts
it('checkpoints: persists incrementally (more than once) across multiple batches, not only at the end', async () => {
  const { repo, fs, book, chapters } = await setup(120); // 120 章 / 15 每块 = 8 块 / 5 块每检查点 → 2 次落库
  const putSpy = jest.spyOn(repo, 'putCodex');
  const summarizeChat = jest.fn(async () => 'S');
  const chat = fakeCodexChat();
  await ensureCodex(
    { chat, summarizeChat, fs, repo },
    { book, chapters, cutoff: 119, model: 'm', autoOn: true },
  );
  expect(putSpy.mock.calls.length).toBeGreaterThan(1);
});
```

- [ ] **Step 10: 跑测试确认通过**

Run: `npm test -- ensureCodex.test.ts`
Expected: PASS，5 passed。

- [ ] **Step 11: 写失败测试（取消：中断时已落的检查点保留，不整体回滚）**

```ts
// 追加到 src/lib/ai/__tests__/ensureCodex.test.ts
it('cancellation: an aborted signal rejects with AiError(cancelled) but keeps checkpoints already persisted', async () => {
  const { repo, fs, book, chapters } = await setup(120);
  const ctrl = new AbortController();
  const summarizeChat = jest.fn(async () => 'S');
  let batchCount = 0;
  const chat = jest.fn(async (): Promise<ChatResult> => {
    batchCount += 1;
    if (batchCount === 6) ctrl.abort(); // 第一个检查点（5 块）刚提交完，第 6 块请求时取消
    return { content: JSON.stringify({ characters: [], terms: [], relations: [] }), finishReason: 'stop' };
  });
  await expect(
    ensureCodex(
      { chat, summarizeChat, fs, repo },
      { book, chapters, cutoff: 119, model: 'm', autoOn: true, signal: ctrl.signal },
    ),
  ).rejects.toMatchObject({ kind: 'cancelled' });
  const stored = await repo.getCodex('b1');
  expect(stored?.coveredUptoIdx).toBeGreaterThanOrEqual(0); // 第一个检查点已经落库，没有整体回滚
  expect(stored?.coveredUptoIdx).toBeLessThan(119); // 但确实没跑完
});
```

- [ ] **Step 12: 跑测试确认通过**

Run: `npm test -- ensureCodex.test.ts`
Expected: PASS，6 passed。

- [ ] **Step 13: 写失败测试（单飞锁：同一本书两次并发调用不会产生数据竞争/重复人物）**

```ts
// 追加到 src/lib/ai/__tests__/ensureCodex.test.ts
it('per-book lock serializes concurrent calls for the same book (no duplicated character from a lost update)', async () => {
  const { repo, fs, book, chapters } = await setup(10);
  const summarizeChat = jest.fn(async () => 'S');
  const chat = fakeCodexChat(); // 两次调用都会产出同一个「主角」
  const [a, b] = await Promise.all([
    ensureCodex({ chat, summarizeChat, fs, repo }, { book, chapters, cutoff: 9, model: 'm', autoOn: true }),
    ensureCodex({ chat, summarizeChat, fs, repo }, { book, chapters, cutoff: 9, model: 'm', autoOn: true }),
  ]);
  expect(b.codex.characters.filter((c) => c.name === '主角')).toHaveLength(1); // 串行执行下第二次是增量 no-op，不会产生重复
  expect(a.coveredUptoIdx).toBe(9);
  expect(b.coveredUptoIdx).toBe(9);
});
```

- [ ] **Step 14: 跑测试确认通过**

Run: `npm test -- ensureCodex.test.ts`
Expected: PASS，7 passed。

- [ ] **Step 15: Commit**

```bash
git add src/lib/ai/ensureCodex.ts src/lib/ai/__tests__/ensureCodex.test.ts
git commit -m "feat(codex): ensureCodex orchestration — per-book lock, checkpoints, version tolerance, autoOn"
```

---

## Task 6: layoutFactionGraph（纯函数，势力分组布局 + 退化路径）

**Files:**
- Create: `src/lib/ai/factionLayout.ts`
- Test: `src/lib/ai/__tests__/factionLayout.test.ts`

**Interfaces:**
- Consumes: `Character`, `Relation` from `./codex`。
- Produces: `GraphNode { name; x; y; group }`, `GraphEdge { from; to; kind; x1; y1; x2; y2 }`, `FactionGraphOptions { width; height; maxNodes? }`, `layoutFactionGraph(characters: Character[], relations: Relation[], opts: FactionGraphOptions): { nodes: GraphNode[]; edges: GraphEdge[] }`。Task 8（`RelationshipGraph`）依赖；调用方（Task 9）必须只传入 `codexForCutoff` 过滤后的 `characters`/`relations`。

- [ ] **Step 1: 写失败测试（确定性 + top-N by 可见 degree）**

```ts
// src/lib/ai/__tests__/factionLayout.test.ts
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
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- factionLayout.test.ts`
Expected: FAIL — `Cannot find module '../factionLayout'`。

- [ ] **Step 3: 实现**

```ts
// src/lib/ai/factionLayout.ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- factionLayout.test.ts`
Expected: PASS，2 passed。

- [ ] **Step 5: 写失败测试（三种退化路径 + 边只保留两端都入选的关系）**

```ts
// 追加到 src/lib/ai/__tests__/factionLayout.test.ts
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
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test -- factionLayout.test.ts`
Expected: PASS，5 passed。

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/factionLayout.ts src/lib/ai/__tests__/factionLayout.test.ts
git commit -m "feat(codex): layoutFactionGraph — deterministic faction-clustered layout with degradation paths"
```

---

## Task 7: CodexModal（人物 tab + 人物卡 + 世界观 tab）

**Files:**
- Create: `src/reader/CodexModal.tsx`
- Test: `src/reader/__tests__/CodexModal.test.tsx`

**Interfaces:**
- Consumes: `Character`, `type Codex` from `../lib/ai/codex`；`resolveTheme` from `../lib/settings/styles`；`useSettings` from `../settings/SettingsContext`。
- Produces: `CodexModalProps { visible; onClose; configured; consented; onOpenSettings; onConsent; codex: Codex; complete; versionMismatch; currentChapterNumber; busy; progress; error; onComplete; onRebuild; onCancel }`，组件 `CodexModal`。Task 9（ReaderScreen 接线）依赖，且 ReaderScreen 传入的 `codex` 必须已经过 `codexForCutoff` 过滤（本任务的组件本身不做过滤，只负责展示——过滤纪律由调用方在边界处保证）。关系图 tab 留给 Task 8 接入，本任务先占位一个 `codex-tab-graph` 空态。

- [ ] **Step 1: 写失败测试（门控态：复用 AiPanel 的配置/同意门）**

```tsx
// src/reader/__tests__/CodexModal.test.tsx
import { fireEvent } from '@testing-library/react-native';
import { renderWithSettings } from '../../test-utils/render';
import { EMPTY_CODEX } from '../../lib/ai/codex';
import { CodexModal } from '../CodexModal';

const base = {
  visible: true,
  onClose: jest.fn(),
  configured: true,
  consented: true,
  onOpenSettings: jest.fn(),
  onConsent: jest.fn(),
  codex: EMPTY_CODEX,
  complete: true,
  versionMismatch: false,
  currentChapterNumber: 10,
  busy: false,
  progress: null,
  error: null,
  onComplete: jest.fn(),
  onRebuild: jest.fn(),
  onCancel: jest.fn(),
};

describe('CodexModal', () => {
  it('shows the config gate when not configured', async () => {
    const onOpenSettings = jest.fn();
    const { findByTestId } = renderWithSettings(<CodexModal {...base} configured={false} onOpenSettings={onOpenSettings} />);
    fireEvent.press(await findByTestId('codex-open-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('shows the consent gate when configured but not consented', async () => {
    const onConsent = jest.fn();
    const { findByTestId } = renderWithSettings(<CodexModal {...base} consented={false} onConsent={onConsent} />);
    fireEvent.press(await findByTestId('codex-consent'));
    expect(onConsent).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- CodexModal.test.tsx`
Expected: FAIL — `Cannot find module '../CodexModal'`。

- [ ] **Step 3: 实现（第一版：门控 + tab 骨架，人物/世界观内容留待后续 step 补全）**

```tsx
// src/reader/CodexModal.tsx
/** 增量 8: 已读图鉴 Modal（人物/世界观/关系图三 tab）。仿 AiPanel 的全屏 Modal + 门控。
 * 纪律：本组件及其子组件只接收调用方已用 codexForCutoff 过滤过的 codex，
 * 永不同时持有裸 codex + cutoff——过滤只在 ReaderScreen 的边界处发生一次。 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Character, Codex } from '../lib/ai/codex';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

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
  currentChapterNumber: number;
  busy: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  onComplete: () => void;
  onRebuild: () => void;
  onCancel: () => void;
}

export function CodexModal(props: CodexModalProps) {
  const {
    visible, onClose, configured, consented, onOpenSettings, onConsent,
    codex, complete, versionMismatch, currentChapterNumber, busy, progress, error,
    onComplete, onRebuild, onCancel,
  } = props;
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const [tab, setTab] = useState<CodexTab>('characters');
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);

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
              style={[styles.tab, tab === t && { backgroundColor: theme.accent }]}
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
            <Text style={[styles.secondaryText, { color: theme.accent }]}>补全到当前进度（第{currentChapterNumber}章）</Text>
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
                正在整理图鉴… {progress.done}/{progress.total}
              </Text>
            )}
            <Pressable testID="codex-cancel" onPress={onCancel} hitSlop={10}>
              <Text style={[styles.cancel, { color: theme.subtle }]}>取消</Text>
            </Pressable>
          </View>
        )}
        {error && <Text testID="codex-error" style={[styles.error, { color: '#d9534f' }]}>{error}</Text>}

        <ScrollView style={styles.flex}>
          {tab === 'characters' && !selectedCharacter && (
            <View testID="codex-character-list">
              {codex.characters.map((c) => (
                <Pressable key={c.name} testID={`codex-character-${c.name}`} onPress={() => setSelectedCharacter(c)} style={styles.listItem}>
                  <Text style={[styles.listItemText, { color: theme.text }]}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {tab === 'characters' && selectedCharacter && (
            <View testID="codex-character-detail">
              <Pressable testID="codex-character-back" onPress={() => setSelectedCharacter(null)}>
                <Text style={{ color: theme.accent }}>← 返回</Text>
              </Pressable>
              <Text style={[styles.detailTitle, { color: theme.heading }]}>{selectedCharacter.name}</Text>
              {selectedCharacter.identity.map((i, idx) => (
                <Text key={idx} style={[styles.detailLine, { color: theme.text }]}>{i.text}</Text>
              ))}
              {(selectedCharacter.origin ?? []).map((o, idx) => (
                <Text key={idx} style={[styles.detailLine, { color: theme.subtle }]}>身世：{o.text}</Text>
              ))}
            </View>
          )}
          {tab === 'terms' && (
            <View testID="codex-term-list">
              {codex.terms.map((t) => (
                <View key={t.name} style={styles.listItem}>
                  <Text style={[styles.listItemText, { color: theme.text }]}>【{t.category}】{t.name}</Text>
                  {t.def[0] && <Text style={[styles.detailLine, { color: theme.subtle }]}>{t.def[0].text}</Text>}
                </View>
              ))}
            </View>
          )}
          {tab === 'graph' && <View testID="codex-tab-graph-body" />}
        </ScrollView>
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
  listItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
  listItemText: { fontSize: 15, fontWeight: '600' },
  detailTitle: { fontSize: 20, fontWeight: '700', marginVertical: 12 },
  detailLine: { fontSize: 14.5, lineHeight: 22, marginBottom: 6 },
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- CodexModal.test.tsx`
Expected: PASS，2 passed。

- [ ] **Step 5: 写失败测试（人物列表 → 人物卡，Modal 内 state 而非嵌套 Modal；世界观列表；补全/重建按钮）**

```tsx
// 追加到 src/reader/__tests__/CodexModal.test.tsx
import { EMPTY_CODEX, type Codex } from '../../lib/ai/codex';

function codexWith(over: Partial<Codex>): Codex {
  return { ...EMPTY_CODEX, ...over };
}

it('opens a character detail in-place (no nested Modal) and can go back to the list', async () => {
  const codex = codexWith({
    characters: [{ name: '张三', aliases: [], identity: [{ text: '少年侠客', idx: 0 }], groups: [], firstChapterIdx: 0 }],
  });
  const { findByTestId, getByTestId, queryByTestId } = renderWithSettings(<CodexModal {...base} codex={codex} />);
  fireEvent.press(await findByTestId('codex-character-张三'));
  expect(await findByTestId('codex-character-detail')).toHaveTextContent('少年侠客');
  expect(queryByTestId('codex-character-list')).toBeNull(); // 同一个 Modal 内切换，不是叠加的新 Modal
  fireEvent.press(getByTestId('codex-character-back'));
  expect(await findByTestId('codex-character-list')).toBeTruthy();
});

it('renders the terms tab grouped list', async () => {
  const codex = codexWith({
    terms: [{ name: '青云诀', category: '功法', def: [{ text: '入门吐纳法', idx: 0 }], firstChapterIdx: 0 }],
  });
  const { findByTestId, getByTestId } = renderWithSettings(<CodexModal {...base} codex={codex} />);
  fireEvent.press(await findByTestId('codex-tab-terms'));
  expect(await findByTestId('codex-term-list')).toHaveTextContent('青云诀');
  expect(getByTestId('codex-term-list')).toHaveTextContent('入门吐纳法');
});

it('shows the complete-to-progress button when complete=false, and triggers onComplete', async () => {
  const onComplete = jest.fn();
  const { findByTestId } = renderWithSettings(<CodexModal {...base} complete={false} currentChapterNumber={42} onComplete={onComplete} />);
  const btn = await findByTestId('codex-complete');
  expect(btn).toHaveTextContent('第42章');
  fireEvent.press(btn);
  expect(onComplete).toHaveBeenCalled();
});

it('shows the rebuild button only on version mismatch, and triggers onRebuild', async () => {
  const onRebuild = jest.fn();
  const { findByTestId, queryByTestId } = renderWithSettings(<CodexModal {...base} versionMismatch onRebuild={onRebuild} />);
  fireEvent.press(await findByTestId('codex-rebuild'));
  expect(onRebuild).toHaveBeenCalled();

  const { queryByTestId: queryNoMismatch } = renderWithSettings(<CodexModal {...base} versionMismatch={false} />);
  expect(queryNoMismatch('codex-rebuild')).toBeNull();
});

it('shows busy/progress/cancel, and a dedicated-red error', async () => {
  const onCancel = jest.fn();
  const { findByTestId } = renderWithSettings(
    <CodexModal {...base} busy progress={{ done: 3, total: 10 }} error="AI 请求失败，请重试。" onCancel={onCancel} />,
  );
  expect(await findByTestId('codex-progress')).toHaveTextContent('3/10');
  fireEvent.press(await findByTestId('codex-cancel'));
  expect(onCancel).toHaveBeenCalled();
  expect(await findByTestId('codex-error')).toHaveStyle({ color: '#d9534f' });
});
```

- [ ] **Step 6: 跑测试确认通过（应已由 Step 3 的实现覆盖）**

Run: `npm test -- CodexModal.test.tsx`
Expected: PASS，7 passed。

- [ ] **Step 7: Commit**

```bash
git add src/reader/CodexModal.tsx src/reader/__tests__/CodexModal.test.tsx
git commit -m "feat(codex): CodexModal — gated 人物/世界观 tabs + in-place character detail"
```

---

## Task 8: RelationshipGraph（svg 组件，接入关系图 tab）

**Files:**
- Create: `src/reader/RelationshipGraph.tsx`
- Test: `src/reader/__tests__/RelationshipGraph.test.tsx`
- Modify: `src/reader/CodexModal.tsx`（把 `graph` tab 的占位换成真正的 `RelationshipGraph`）
- Modify: `src/reader/__tests__/CodexModal.test.tsx`（补一条关系图 tab 渲染 + 点节点切人物 tab 的集成测试）

**Interfaces:**
- Consumes: `layoutFactionGraph`, `type FactionGraphResult` from `../lib/ai/factionLayout`；`Character`, `Relation` from `../lib/ai/codex`；`Svg`, `Circle`, `Line`, `Text as SvgText`, `G` from `react-native-svg`。
- Produces: `RelationshipGraphProps { characters: Character[]; relations: Relation[]; width: number; height: number; onSelectCharacter: (name: string) => void }`，组件 `RelationshipGraph`。Task 9 通过 `CodexModal` 间接渲染，无直接消费方。

- [ ] **Step 1: 写失败测试（渲染节点/边 + 点节点回调）**

```tsx
// src/reader/__tests__/RelationshipGraph.test.tsx
import { fireEvent, render } from '@testing-library/react-native';
import { RelationshipGraph } from '../RelationshipGraph';

const characters = [
  { name: '甲', aliases: [], identity: [], groups: [{ name: '青云门', idx: 0 }], firstChapterIdx: 0 },
  { name: '乙', aliases: [], identity: [], groups: [{ name: '青云门', idx: 0 }], firstChapterIdx: 0 },
];
const relations = [{ from: '甲', to: '乙', kind: '同门', idx: 0 }];

describe('RelationshipGraph', () => {
  it('renders one node per character and calls onSelectCharacter when tapped', () => {
    const onSelectCharacter = jest.fn();
    const { getByTestId } = render(
      <RelationshipGraph characters={characters} relations={relations} width={300} height={300} onSelectCharacter={onSelectCharacter} />,
    );
    fireEvent.press(getByTestId('graph-node-甲'));
    expect(onSelectCharacter).toHaveBeenCalledWith('甲');
  });

  it('renders an edge for each relation between two rendered nodes', () => {
    const { getByTestId } = render(
      <RelationshipGraph characters={characters} relations={relations} width={300} height={300} onSelectCharacter={jest.fn()} />,
    );
    expect(getByTestId('graph-edge-甲-乙-同门')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- RelationshipGraph.test.tsx`
Expected: FAIL — `Cannot find module '../RelationshipGraph'`。

- [ ] **Step 3: 实现**

```tsx
// src/reader/RelationshipGraph.tsx
/** 增量 8 Task 8: 关系图 svg 组件。坐标完全来自 layoutFactionGraph 的纯函数
 * 输出。拖动只更新外层 <G transform>，不对每个节点单独 setState，避免大
 * cast 场景下逐节点重渲染。 */
import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import type { Character, Relation } from '../lib/ai/codex';
import { layoutFactionGraph } from '../lib/ai/factionLayout';

export interface RelationshipGraphProps {
  characters: Character[];
  relations: Relation[];
  width: number;
  height: number;
  onSelectCharacter: (name: string) => void;
}

const NODE_RADIUS = 14;

export function RelationshipGraph({ characters, relations, width, height, onSelectCharacter }: RelationshipGraphProps) {
  const { nodes, edges } = useMemo(
    () => layoutFactionGraph(characters, relations, { width, height }),
    [characters, relations, width, height],
  );

  const pan = useRef({ x: 0, y: 0 });
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_evt, gesture) => {
        pan.current = { x: pan.current.x + gesture.dx, y: pan.current.y + gesture.dy };
      },
    }),
  ).current;

  // react-native-svg 的图形组件自带触摸事件（onPress），点击热区直接放在
  // Circle 上即可，不需要额外的 Pressable 包裹。
  return (
    <Svg testID="relationship-graph" width={width} height={height} {...panResponder.panHandlers}>
      <G translateX={pan.current.x} translateY={pan.current.y}>
        {edges.map((e) => (
          <Line
            key={`${e.from}-${e.to}-${e.kind}`}
            testID={`graph-edge-${e.from}-${e.to}-${e.kind}`}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke="rgba(127,127,127,0.5)"
            strokeWidth={1}
          />
        ))}
        {nodes.map((n) => (
          <G key={n.name} testID={`graph-node-${n.name}`} onPress={() => onSelectCharacter(n.name)}>
            <Circle cx={n.x} cy={n.y} r={NODE_RADIUS} fill="#83a99b" />
            <SvgText x={n.x} y={n.y + NODE_RADIUS + 12} fontSize={11} textAnchor="middle" fill="#7f838d">
              {n.name}
            </SvgText>
          </G>
        ))}
      </G>
    </Svg>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- RelationshipGraph.test.tsx`
Expected: PASS，2 passed。若 `fireEvent.press` 派发到 `G` 上不生效（testing-library 对 svg 容器元素的事件派发可能与普通 RN 组件不同），改为把 `testID`/`onPress` 放在 `Circle` 本身而非外层 `G` 上重试。

- [ ] **Step 5: 接入 CodexModal 的关系图 tab**

在 `src/reader/CodexModal.tsx` 里：

```tsx
import { RelationshipGraph } from './RelationshipGraph';
```

把：

```tsx
{tab === 'graph' && <View testID="codex-tab-graph-body" />}
```

替换成：

```tsx
{tab === 'graph' && (
  <View testID="codex-tab-graph-body">
    <RelationshipGraph
      characters={codex.characters}
      relations={codex.relations}
      width={320}
      height={420}
      onSelectCharacter={(name) => {
        const found = codex.characters.find((c) => c.name === name);
        if (found) {
          setSelectedCharacter(found);
          setTab('characters');
        }
      }}
    />
  </View>
)}
```

- [ ] **Step 6: 写失败测试（CodexModal 集成：点关系图节点切到人物 tab 并选中）**

```tsx
// 追加到 src/reader/__tests__/CodexModal.test.tsx
it('tapping a node in the graph tab switches to the characters tab with that character selected', async () => {
  const codex = codexWith({
    characters: [
      { name: '甲', aliases: [], identity: [{ text: '主角', idx: 0 }], groups: [], firstChapterIdx: 0 },
      { name: '乙', aliases: [], identity: [], groups: [], firstChapterIdx: 0 },
    ],
    relations: [{ from: '甲', to: '乙', kind: '同门', idx: 0 }],
  });
  const { findByTestId } = renderWithSettings(<CodexModal {...base} codex={codex} />);
  fireEvent.press(await findByTestId('codex-tab-graph'));
  fireEvent.press(await findByTestId('graph-node-甲'));
  expect(await findByTestId('codex-character-detail')).toHaveTextContent('主角');
});
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npm test -- CodexModal.test.tsx RelationshipGraph.test.tsx`
Expected: PASS，全部通过（`CodexModal.test.tsx` 8 passed，`RelationshipGraph.test.tsx` 2 passed）。

- [ ] **Step 8: Commit**

```bash
git add src/reader/RelationshipGraph.tsx src/reader/__tests__/RelationshipGraph.test.tsx src/reader/CodexModal.tsx src/reader/__tests__/CodexModal.test.tsx
git commit -m "feat(codex): RelationshipGraph svg component wired into CodexModal's graph tab"
```

---

## Task 9: ReaderScreen 接线 + 门禁 + 原生重出 ipa + 真机验证

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`
- Test: `src/screens/__tests__/ReaderScreen.test.tsx`

**Interfaces:**
- Consumes: `CodexModal` from `../reader/CodexModal`；`ensureCodex`, `type EnsureCodexResult` from `../lib/ai/ensureCodex`；`codexForCutoff`, `EMPTY_CODEX`, `type Codex` from `../lib/ai/codex`；`type ChatResult` from `../lib/ai/client`（已有 `chatComplete`/`AiError` import）。
- Produces: 底栏「图鉴」入口 + 门控 + 状态管理，接线完成后即为本增量的终态。无后续任务消费。

- [ ] **Step 1: 写失败测试（图鉴入口按钮 + 门控与 AI 面板一致）**

```tsx
// 追加到 src/screens/__tests__/ReaderScreen.test.tsx
it('shows the 图鉴 bottom-bar button after tapping to reveal chrome', async () => {
  const { repo, fs } = setup();
  await seedReader(repo, fs, { bookId: 'bcodex', chapters: CHAPTERS, progressChapterIndex: 0 });
  const { findByText, getByTestId } = renderReader(repo, fs, 'bcodex');
  tapSurface(await waitFor(() => getByTestId('reader-surface')));
  expect(await findByText('图鉴')).toBeTruthy();
});

it('opens CodexModal with the same config/consent gates as AiPanel', async () => {
  const { repo, fs } = setup();
  await seedReader(repo, fs, { bookId: 'bcodex2', chapters: CHAPTERS, progressChapterIndex: 0 });
  const { findByText, findByTestId, getByTestId } = renderReader(repo, fs, 'bcodex2');
  tapSurface(await waitFor(() => getByTestId('reader-surface')));
  fireEvent.press(await findByText('图鉴'));
  expect(await findByTestId('codex-need-config')).toBeTruthy(); // 默认未配置 AI
});
```

（若既有测试文件里没有 `reader-surface` 这个 testID 或用了别的方式定位滚动容器，改用文件里「shows the AI bottom-bar button」那条既有测试的同款定位方式，保持一致，不要引入新的定位手法。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- ReaderScreen.test.tsx`
Expected: FAIL — 找不到文本「图鉴」。

- [ ] **Step 3: 实现——imports**

`ReaderScreen.tsx` 现有第 60 行只导入了 `chatComplete`：`import { chatComplete } from '../lib/ai/client';`。`codexChat`/`errorTextFor` 还需要 `AiError`、`ChatMessage`、`ChatResult`，把这一行改成：

```ts
import { chatComplete, AiError, type ChatMessage, type ChatResult } from '../lib/ai/client';
```

再新增三行（挨着其余 AI 相关 import）：

```ts
import { CodexModal } from '../reader/CodexModal';
import { ensureCodex } from '../lib/ai/ensureCodex';
import { codexForCutoff, EMPTY_CODEX, type Codex } from '../lib/ai/codex';
```

- [ ] **Step 4: 实现——state（挨着 `showAi`/`showAiSettings` 那一组加）**

```ts
  const [showCodex, setShowCodex] = useState(false);
  const [codex, setCodex] = useState<Codex>(EMPTY_CODEX);
  const [codexComplete, setCodexComplete] = useState(false);
  const [codexVersionMismatch, setCodexVersionMismatch] = useState(false);
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexProgress, setCodexProgress] = useState<{ done: number; total: number } | null>(null);
  const [codexError, setCodexError] = useState<string | null>(null);
  const codexAbortRef = useRef<AbortController | null>(null);
```

- [ ] **Step 5: 实现——codexChat 适配器（挨着现有 `aiChat`/`cachedChat` 那一组加）**

```ts
  // 抽取要 finishReason 做截断二分判断，所以不能复用只返回 content 字符串的
  // SummarizeFn；直接透传 chatComplete 的完整 ChatResult。
  const codexChat = useCallback(
    async (messages: ChatMessage[], sig?: AbortSignal): Promise<ChatResult> =>
      chatComplete({ config: aiConfig, messages, signal: sig, maxTokens: 1600, temperature: 0.2, responseFormat: 'json_object' }),
    [aiConfig],
  );
```

- [ ] **Step 6: 实现——编排回调**

```ts
  const runEnsureCodex = useCallback(
    async (forceRebuild: boolean) => {
      if (!book || !chapters) return;
      const cutoff = currentChapterIndex - 1;
      if (cutoff < 0) return;
      setCodexBusy(true);
      setCodexError(null);
      setCodexProgress(null);
      const ctrl = new AbortController();
      codexAbortRef.current = ctrl;
      try {
        const res = await ensureCodex(
          { chat: codexChat, summarizeChat: aiChat, fs, repo },
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
        if (ctrl.signal.aborted) return;
        setCodex(res.codex);
        setCodexComplete(res.complete);
        setCodexVersionMismatch(res.versionMismatch);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setCodexError(e instanceof AiError ? errorTextFor(e) : 'AI 请求失败，请重试。');
      } finally {
        setCodexBusy(false);
        setCodexProgress(null);
        codexAbortRef.current = null;
      }
    },
    [book, chapters, currentChapterIndex, codexChat, aiChat, fs, repo, aiConfig.model, aiConfig.autoSummarize],
  );

  // 首次打开图鉴时自动加载一次（等价于按一次「补全到当前进度」）。
  useEffect(() => {
    if (showCodex) runEnsureCodex(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCodex]);

  const cutoff = currentChapterIndex - 1;
  const displayCodex = useMemo(() => codexForCutoff(codex, cutoff), [codex, cutoff]);
```

`errorTextFor` 若文件里还没有一个通用的 AiError → 文案映射函数，就地加一个极小的辅助（复用 `AiPanel.tsx` 里 `errorText` 的判断分支，只是换个名字避免和该文件内潜在的同名导入冲突）：

```ts
function errorTextFor(e: AiError): string {
  switch (e.kind) {
    case 'no-key': return '还没配置 API Key，请先到 AI 设置填写。';
    case 'cancelled': return '已取消。';
    case 'timeout': return '请求超时，请重试。';
    case 'insufficient-balance': return 'API 余额不足。';
    case 'rate-limited': return '请求过于频繁，请稍后再试。';
    case 'network': return '网络错误，请检查连接。';
    default: return 'AI 请求失败，请重试。';
  }
}
```

（放在 `ReaderScreen` 组件函数外部，作为模块级私有函数。）

- [ ] **Step 7: 实现——底栏按钮 + 渲染 CodexModal**

在底栏 `<BarButton label="AI" .../>` 后面加：

```tsx
          <BarButton label="图鉴" color={rs.theme.accent} onPress={() => setShowCodex(true)} />
```

在 `<AiSettingsModal .../>` 附近加：

```tsx
      <CodexModal
        visible={showCodex}
        onClose={() => setShowCodex(false)}
        configured={aiConfig.enabled && aiConfig.apiKey.length > 0}
        consented={aiConfig.consentAt !== null}
        onOpenSettings={() => setShowAiSettings(true)}
        onConsent={() => updateAiConfig({ consentAt: Date.now() })}
        codex={displayCodex}
        complete={codexComplete}
        versionMismatch={codexVersionMismatch}
        currentChapterNumber={currentChapterIndex + 1}
        busy={codexBusy}
        progress={codexProgress}
        error={codexError}
        onComplete={() => runEnsureCodex(false)}
        onRebuild={() => runEnsureCodex(true)}
        onCancel={() => codexAbortRef.current?.abort()}
      />
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npm test -- ReaderScreen.test.tsx`
Expected: PASS，全部通过（含新增 2 条）。

- [ ] **Step 9: 全量门禁**

```bash
npm test
npx tsc --noEmit
npx expo export --platform ios
```

Expected: `npm test` 全绿、`tsc` 无输出、`expo export` 成功退出（无报错）。

- [ ] **Step 10: Commit**

```bash
git add src/screens/ReaderScreen.tsx src/screens/__tests__/ReaderScreen.test.tsx
git commit -m "feat(codex): wire 已读图鉴 entry into ReaderScreen (autoOn-gated, complete/rebuild, cutoff filter)"
```

- [ ] **Step 11: 原生重出 ipa（本增量含原生依赖，必须）**

在 GitHub 上手动触发 `build-unsigned-ipa.yml`（`docs/ios_sideload_route.md` 记录的唯一装机路径）。等 CI 跑完，下载未签名 `.ipa` 产物。

- [ ] **Step 12: 用户 Sideloadly 重装 + 真机验证**

请用户执行并反馈以下清单（全部由用户在真机上手动验证，非自动化范围）：

1. 图鉴三个 tab（人物/世界观/关系图）均可正常打开和浏览。
2. 关系图按势力分组正确渲染、点击节点能跳转到对应人物卡、画布可拖动。
3. `autoSummarize` 开启时图鉴覆盖全部已读内容；关闭时「补全到当前进度」按钮可用且行为符合预期。
4. 删除书籍后，对应的 `ai_codex` 记录被级联清除（可通过重新导入同 id 书籍或检查行为间接验证）。
5. **防剧透终极验证**：图鉴和人物卡中不出现任何未读内容涉及的人物/设定；把阅读进度手动回退到更早的章节后，图鉴内容自动收窄（无需手动刷新或重建）。
6. 切换 AI 模型后，旧图鉴内容仍正常展示（不触发自动重建），只有点击「重建图鉴」按钮才会全量重抽。

全部通过后，本增量完成，可合并到 main。

---

## Verify（跨任务汇总，供最终整支分支 review 核对）

- `chatComplete` 的 `responseFormat` 透传（Task 2）。
- `codexForCutoff`：回退收窄、`firstChapterIdx>cutoff` 人物隐藏、事件/关系/别名/身份/势力各自按 idx 过滤、词条 def 取最新可见版本、relation 端点必须双双可见（Task 3）。
- `ai_codex` InMemory 实现 + 级联删除（Task 3）；Sqlite 实现靠 tsc 把关（项目既有约定，不单测）。
- `extractCodex`：idx 恒等于块 maxIdx（不采信 LLM 自报）、坏 JSON/坏实体跳过不炸、截断二分重试 + 深度上限、roster 锚定（Task 4a）。
- `mergeCodex`：折叠前按 maxIdx 升序排序（红线 A）、canonical name 永不被覆盖、`Term.category` first-write-wins、`Relation` dedup 含 kind、`def` 版本化累加、扩展已有 Codex 而非重置（Task 4b）。
- `ensureCodex`：模块级 per-book 锁（单飞/无数据竞争）、可恢复检查点、版本容忍不自动重建（`forceRebuild` 才重来）、`autoOn=true` 抽到 cutoff 且 complete、`autoOn=false` 只用已缓存 + 正确的 complete 标志、取消保留已落检查点（Task 5）。
- `layoutFactionGraph`：确定性、top-N by 可见 degree、三种退化路径、边只保留两端都入选的关系（Task 6）。
- `CodexModal`：门控、tab 切换、人物卡 in-place 详情、世界观列表、补全/重建按钮、busy/progress/cancel/error 态（Task 7）。
- `RelationshipGraph`：节点/边渲染、点节点回调、与 `CodexModal` 的 tab 联动（Task 8）。
- `ReaderScreen`：入口按钮 + 门控一致性、`codexForCutoff` 在边界处应用一次（Task 9）。
- 全部通过：`npm test` 全绿、`npx tsc --noEmit` 干净、`npx expo export --platform ios` 成功、0 act 警告。
- **真机（必须）**：Task 9 Step 11–12 的六项清单全部通过。
