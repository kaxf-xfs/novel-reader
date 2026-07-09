# AI 伴读 · 基建（Part A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭好「AI 伴读」的纯逻辑 + 数据基建（配置、OpenAI 兼容客户端、章/弧小结缓存、防剧透 map-reduce、上下文预算选择），全部严格单测；UI 与三功能在 Part B。

**Architecture:** 纯逻辑模块（`src/lib/ai/*`）不 import react/react-native，全部注入 `fetchImpl`/`chat`/fake repo 依赖可测；小结缓存进 SQLite（复用现有 repo 双实现 + FK CASCADE）；防剧透靠"缓存只覆盖读完的章 + 当前章按段切原文"的不变量。

**Tech Stack:** Expo SDK 57 · RN 0.86 · React 19.2 · TypeScript strict · Jest 29 + jest-expo · `fetch`（内置）· expo-sqlite（已用）。

## Global Constraints

- **无新原生依赖 / 不改 package.json**（走 OTA）。`fetch` 内置调 OpenAI 兼容 API。
- 纯逻辑模块不得 import react/react-native；注入依赖可单测。
- **防剧透不变量（S1）**：缓存的章小结只覆盖 `0..cur-1`（完全读完的章）；当前章 `cur` 绝不缓存、绝不整章入模型；`ensureSummaries` cutoff = `cur-1`，绝不对 index ≥ cur 调 `readChapterText`。
- **规模（S2）**：聚合前按 `CONTEXT_BUDGET`（字符近似 token）预算；每 `ARC_SIZE=25` 章归并弧小结；早期用弧、近期用章、当前章用已读原文。
- 缓存键 `(bookId, level, idx)` + 记录 `model`/`promptVersion`；命中但不匹配＝miss 重生成。
- SQLite DDL 加法式（`CREATE TABLE IF NOT EXISTS`）；SQLite 生产实现不单测，逻辑覆盖走 `InMemoryBookRepository`。
- 命令：`npx jest <path>`、`npx tsc --noEmit`。仓库根 `D:\Games\novel-reader`。

---

### Task 1: AiConfig 模型 + 持久化 + 网关 filename 参数

**Files:**
- Create: `src/lib/ai/config.ts`
- Modify: `src/lib/settings/expoSettingsGateway.ts`（构造器加 `filename`）
- Test: `src/lib/ai/__tests__/config.test.ts`

**Interfaces:**
- Consumes: `SettingsGateway`（`src/lib/settings/store.ts`：`read(): Promise<string|null>`、`write(json): Promise<void>`）；`InMemorySettingsGateway`（同文件）。
- Produces:
  - `interface AiConfig { baseUrl: string; apiKey: string; model: string; enabled: boolean; consentAt: number | null }`
  - `DEFAULT_AI_CONFIG`
  - `sanitizeAiConfig(patch: Partial<AiConfig>): AiConfig`
  - `loadAiConfig(gateway): Promise<AiConfig>` / `saveAiConfig(gateway, config): Promise<void>`
  - `ExpoSettingsGateway` 构造器签名 `constructor(filename?: string)`（默认 `'settings.json'`）

- [ ] **Step 1: 写失败测试**

Create `src/lib/ai/__tests__/config.test.ts`:

```ts
import { InMemorySettingsGateway } from '../../settings/store';
import {
  DEFAULT_AI_CONFIG, sanitizeAiConfig, loadAiConfig, saveAiConfig, type AiConfig,
} from '../config';

describe('sanitizeAiConfig', () => {
  it('fills defaults from an empty patch', () => {
    expect(sanitizeAiConfig({})).toEqual(DEFAULT_AI_CONFIG);
  });
  it('trims a trailing slash on baseUrl', () => {
    expect(sanitizeAiConfig({ baseUrl: 'https://api.deepseek.com/' }).baseUrl).toBe(
      'https://api.deepseek.com',
    );
  });
  it('rejects a non-https baseUrl by falling back to the default', () => {
    expect(sanitizeAiConfig({ baseUrl: 'http://evil.test' }).baseUrl).toBe(DEFAULT_AI_CONFIG.baseUrl);
    expect(sanitizeAiConfig({ baseUrl: 42 as unknown as string }).baseUrl).toBe(DEFAULT_AI_CONFIG.baseUrl);
  });
  it('trims apiKey and keeps a non-empty model, else default model', () => {
    const c = sanitizeAiConfig({ apiKey: '  sk-x  ', model: '  ' });
    expect(c.apiKey).toBe('sk-x');
    expect(c.model).toBe(DEFAULT_AI_CONFIG.model);
  });
  it('coerces enabled to boolean and consentAt to number|null', () => {
    expect(sanitizeAiConfig({ enabled: 1 as unknown as boolean }).enabled).toBe(true);
    expect(sanitizeAiConfig({ consentAt: 'x' as unknown as number }).consentAt).toBeNull();
    expect(sanitizeAiConfig({ consentAt: 123 }).consentAt).toBe(123);
  });
  it('never throws on garbage', () => {
    expect(() => sanitizeAiConfig(null as unknown as Partial<AiConfig>)).not.toThrow();
  });
});

describe('persistence', () => {
  it('round-trips through a gateway', async () => {
    const gw = new InMemorySettingsGateway();
    await saveAiConfig(gw, sanitizeAiConfig({ apiKey: 'k', enabled: true, consentAt: 5 }));
    const loaded = await loadAiConfig(gw);
    expect(loaded.apiKey).toBe('k');
    expect(loaded.enabled).toBe(true);
    expect(loaded.consentAt).toBe(5);
  });
  it('returns defaults for empty / corrupt / throwing gateway', async () => {
    const empty = new InMemorySettingsGateway();
    expect(await loadAiConfig(empty)).toEqual(DEFAULT_AI_CONFIG);
    const corrupt = new InMemorySettingsGateway();
    await corrupt.write('not json');
    expect(await loadAiConfig(corrupt)).toEqual(DEFAULT_AI_CONFIG);
  });
});
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/lib/ai/__tests__/config.test.ts`
Expected: FAIL — `../config` not found.

- [ ] **Step 3: 实现 `src/lib/ai/config.ts`**

```ts
/**
 * 增量 5: AI 伴读配置（OpenAI 兼容）。纯逻辑 + 通过 SettingsGateway 持久化，
 * 存在与阅读设置分开的 ai-config.json。sanitizeAiConfig 是唯一信任边界，永不抛。
 */

import { DEFAULT_SETTINGS } from '../settings/settings'; // (unused placeholder-free import guard) 
import type { SettingsGateway } from '../settings/store';

export interface AiConfig {
  /** OpenAI-compatible base URL, e.g. https://api.deepseek.com (no trailing slash). */
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  /** Unix ms when the user consented to sending book text; null = not consented. */
  consentAt: number | null;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  enabled: false,
  consentAt: null,
};

function cleanBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_AI_CONFIG.baseUrl;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https:\/\/.+/i.test(trimmed)) return DEFAULT_AI_CONFIG.baseUrl;
  return trimmed;
}

export function sanitizeAiConfig(patch: Partial<AiConfig> | null | undefined): AiConfig {
  const p = patch ?? {};
  const model = typeof p.model === 'string' && p.model.trim() ? p.model.trim() : DEFAULT_AI_CONFIG.model;
  return {
    baseUrl: cleanBaseUrl(p.baseUrl),
    apiKey: typeof p.apiKey === 'string' ? p.apiKey.trim() : DEFAULT_AI_CONFIG.apiKey,
    model,
    enabled: Boolean(p.enabled),
    consentAt: typeof p.consentAt === 'number' && Number.isFinite(p.consentAt) ? p.consentAt : null,
  };
}

export async function loadAiConfig(gateway: SettingsGateway): Promise<AiConfig> {
  let raw: string | null;
  try {
    raw = await gateway.read();
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
  if (!raw) return { ...DEFAULT_AI_CONFIG };
  try {
    return sanitizeAiConfig(JSON.parse(raw) as Partial<AiConfig>);
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export async function saveAiConfig(gateway: SettingsGateway, config: AiConfig): Promise<void> {
  await gateway.write(JSON.stringify(sanitizeAiConfig(config)));
}
```

> Remove the placeholder import line — do NOT keep `import { DEFAULT_SETTINGS } ...` (it exists only to flag that config.ts must not depend on reader settings). The final file imports only `type { SettingsGateway }`.

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/lib/ai/__tests__/config.test.ts`
Expected: PASS.

- [ ] **Step 5: 给 `ExpoSettingsGateway` 加 filename 参数**

Modify `src/lib/settings/expoSettingsGateway.ts`:

```ts
export class ExpoSettingsGateway implements SettingsGateway {
  constructor(private readonly filename: string = 'settings.json') {}

  private file(): File {
    return new File(Paths.document, this.filename);
  }

  async read(): Promise<string | null> {
    const file = this.file();
    if (!file.exists) return null;
    return file.text();
  }

  async write(json: string): Promise<void> {
    this.file().write(json);
  }
}
```

(Remove the top-level `const SETTINGS_FILENAME = 'settings.json';`.) Existing `new ExpoSettingsGateway()` calls stay valid (default arg).

- [ ] **Step 6: 校验类型 + 提交**

Run: `npx tsc --noEmit` → no errors.
Run: `npx jest src/lib/ai src/lib/settings` → PASS.

```bash
git add src/lib/ai/config.ts src/lib/ai/__tests__/config.test.ts src/lib/settings/expoSettingsGateway.ts
git commit -m "feat(ai): AiConfig model + persistence + gateway filename param"
```

---

### Task 2: OpenAI 兼容客户端 `chatComplete`

**Files:**
- Create: `src/lib/ai/client.ts`
- Test: `src/lib/ai/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `AiConfig`（Task 1）。
- Produces:
  - `interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }`
  - `type AiErrorKind = 'no-key' | 'cancelled' | 'timeout' | 'insufficient-balance' | 'rate-limited' | 'http' | 'bad-response' | 'network'`
  - `class AiError extends Error { kind: AiErrorKind; status?: number }`
  - `interface ChatResult { content: string; finishReason: string | null }`
  - `interface ChatOptions { config: AiConfig; messages: ChatMessage[]; fetchImpl?: typeof fetch; signal?: AbortSignal; maxTokens?: number; temperature?: number; timeoutMs?: number }`
  - `chatComplete(opts: ChatOptions): Promise<ChatResult>`（默认 `timeoutMs=60000`）

- [ ] **Step 1: 写失败测试**

Create `src/lib/ai/__tests__/client.test.ts`:

```ts
import { DEFAULT_AI_CONFIG, type AiConfig } from '../config';
import { AiError, chatComplete, type ChatMessage } from '../client';

const cfg: AiConfig = { ...DEFAULT_AI_CONFIG, apiKey: 'sk-test' };
const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('chatComplete', () => {
  it('throws no-key when apiKey is empty', async () => {
    await expect(
      chatComplete({ config: DEFAULT_AI_CONFIG, messages: msgs, fetchImpl: jest.fn() }),
    ).rejects.toMatchObject({ kind: 'no-key' });
  });

  it('returns content + finishReason on success', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: '你好' }, finish_reason: 'stop' }] }),
    ) as unknown as typeof fetch;
    const r = await chatComplete({ config: cfg, messages: msgs, fetchImpl });
    expect(r).toEqual({ content: '你好', finishReason: 'stop' });
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('maps 402 to insufficient-balance and 429 to rate-limited', async () => {
    const f402 = jest.fn(async () => jsonResponse(402, { error: { message: 'no balance' } })) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f402 })).rejects.toMatchObject({
      kind: 'insufficient-balance', status: 402,
    });
    const f429 = jest.fn(async () => jsonResponse(429, { error: { message: 'slow down' } })) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f429 })).rejects.toMatchObject({
      kind: 'rate-limited', status: 429,
    });
  });

  it('maps other non-2xx to http', async () => {
    const f = jest.fn(async () => jsonResponse(500, { error: { message: 'boom' } })) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f })).rejects.toMatchObject({ kind: 'http', status: 500 });
  });

  it('maps missing content to bad-response', async () => {
    const f = jest.fn(async () => jsonResponse(200, { choices: [] })) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f })).rejects.toMatchObject({ kind: 'bad-response' });
  });

  it('passes through finish_reason=length (degrade signal)', async () => {
    const f = jest.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }),
    ) as unknown as typeof fetch;
    const r = await chatComplete({ config: cfg, messages: msgs, fetchImpl: f });
    expect(r.finishReason).toBe('length');
  });

  it('classifies an external abort as cancelled', async () => {
    const ctrl = new AbortController();
    const fetchImpl = jest.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    }) as unknown as typeof fetch;
    const p = chatComplete({ config: cfg, messages: msgs, fetchImpl, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('classifies a timeout when the request outlives timeoutMs', async () => {
    const fetchImpl = jest.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    }) as unknown as typeof fetch;
    await expect(
      chatComplete({ config: cfg, messages: msgs, fetchImpl, timeoutMs: 10 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('maps a fetch rejection (not abort) to network', async () => {
    const f = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f })).rejects.toMatchObject({ kind: 'network' });
  });

  it('never leaks the api key in the error message', async () => {
    const f = jest.fn(async () => jsonResponse(500, { error: { message: 'server sk-test leak' } })) as unknown as typeof fetch;
    const err = await chatComplete({ config: cfg, messages: msgs, fetchImpl: f }).catch((e) => e as AiError);
    expect(err.message).not.toContain('sk-test');
  });
});
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/lib/ai/__tests__/client.test.ts`
Expected: FAIL — `../client` not found.

- [ ] **Step 3: 实现 `src/lib/ai/client.ts`**

```ts
/**
 * 增量 5: OpenAI 兼容 chat completions 客户端。注入 fetchImpl 可测；
 * AbortController + 超时；错误分类；日志/错误信息脱敏 api key。非流式。
 */

import type { AiConfig } from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AiErrorKind =
  | 'no-key'
  | 'cancelled'
  | 'timeout'
  | 'insufficient-balance'
  | 'rate-limited'
  | 'http'
  | 'bad-response'
  | 'network';

export class AiError extends Error {
  kind: AiErrorKind;
  status?: number;
  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
  }
}

export interface ChatResult {
  content: string;
  finishReason: string | null;
}

export interface ChatOptions {
  config: AiConfig;
  messages: ChatMessage[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

function redact(text: string, key: string): string {
  return key ? text.split(key).join('***') : text;
}

export async function chatComplete(opts: ChatOptions): Promise<ChatResult> {
  const { config, messages, signal, maxTokens, temperature, timeoutMs = 60_000 } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  if (!config.apiKey) throw new AiError('no-key', 'AI 未配置 API key');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }

  try {
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
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        detail = body?.error?.message ?? '';
      } catch {
        detail = '';
      }
      const msg = redact(`AI 请求失败 (${res.status})${detail ? ': ' + detail : ''}`, config.apiKey);
      if (res.status === 402) throw new AiError('insufficient-balance', msg, 402);
      if (res.status === 429) throw new AiError('rate-limited', msg, 429);
      throw new AiError('http', msg, res.status);
    }

    let body: { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new AiError('bad-response', 'AI 返回无法解析');
    }
    const choice = body.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string') throw new AiError('bad-response', 'AI 返回缺少内容');
    return { content, finishReason: choice?.finish_reason ?? null };
  } catch (e) {
    if (e instanceof AiError) throw e;
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') {
      throw timedOut
        ? new AiError('timeout', 'AI 请求超时')
        : new AiError('cancelled', 'AI 请求已取消');
    }
    const raw = e instanceof Error ? e.message : String(e);
    throw new AiError('network', redact(`网络错误: ${raw}`, config.apiKey));
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
```

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/lib/ai/__tests__/client.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: 校验 + 提交**

Run: `npx tsc --noEmit` → no errors.

```bash
git add src/lib/ai/client.ts src/lib/ai/__tests__/client.test.ts
git commit -m "feat(ai): OpenAI-compatible chatComplete with timeout/cancel/error classification"
```

---

### Task 3: `ai_summaries` 表 + repo 方法

**Files:**
- Modify: `src/lib/import/repository.ts`
- Modify: `src/lib/import/sqliteRepository.ts`
- Test: `src/lib/import/__tests__/repository.aiSummaries.test.ts`

**Interfaces:**
- Produces:
  - `interface SummaryRecord { bookId: string; level: 0 | 1; idx: number; model: string; promptVersion: string; summary: string; createdAt: number }`
  - `BookRepository.putSummary(s: SummaryRecord): Promise<void>`
  - `BookRepository.getSummary(bookId, level, idx): Promise<SummaryRecord | null>`
  - `BookRepository.listSummaries(bookId, level, uptoIdx): Promise<SummaryRecord[]>`（idx 升序，`idx ≤ uptoIdx`）
- Consumes: 现有 repo 双实现模式（books/chapters/... + FK CASCADE）。

- [ ] **Step 1: 写失败测试**

Create `src/lib/import/__tests__/repository.aiSummaries.test.ts`:

```ts
import { InMemoryBookRepository, type SummaryRecord } from '../repository';

function rec(over: Partial<SummaryRecord> = {}): SummaryRecord {
  return { bookId: 'b1', level: 0, idx: 0, model: 'deepseek-chat', promptVersion: 'v1', summary: 's', createdAt: 1, ...over };
}
function seedBook(repo: InMemoryBookRepository, id: string) {
  return repo.addBook({
    id, title: id, originalName: `${id}.txt`, encoding: 'utf-8', sizeBytes: 1,
    importedAt: 1, coverColor: '#000', strategy: 'regex', normalizedPath: `/p/${id}`,
  });
}

describe('InMemoryBookRepository ai summaries', () => {
  it('puts and gets a summary by (bookId, level, idx)', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putSummary(rec({ idx: 3, summary: 'chapter 3' }));
    expect(await repo.getSummary('b1', 0, 3)).toMatchObject({ idx: 3, summary: 'chapter 3' });
    expect(await repo.getSummary('b1', 0, 4)).toBeNull();
  });

  it('putSummary upserts on the same key', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putSummary(rec({ idx: 1, summary: 'old' }));
    await repo.putSummary(rec({ idx: 1, summary: 'new', model: 'other' }));
    const got = await repo.getSummary('b1', 0, 1);
    expect(got?.summary).toBe('new');
    expect(got?.model).toBe('other');
  });

  it('lists level-0 summaries up to uptoIdx in ascending order', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putSummary(rec({ idx: 2 }));
    await repo.putSummary(rec({ idx: 0 }));
    await repo.putSummary(rec({ idx: 5 }));
    await repo.putSummary(rec({ level: 1, idx: 0 })); // arc, excluded by level filter
    const list = await repo.listSummaries('b1', 0, 2);
    expect(list.map((s) => s.idx)).toEqual([0, 2]);
  });

  it('cascades summary deletion when the book is deleted', async () => {
    const repo = new InMemoryBookRepository();
    await seedBook(repo, 'b1');
    await repo.putSummary(rec({ bookId: 'b1', idx: 0 }));
    await repo.putSummary(rec({ bookId: 'b2', idx: 0 }));
    await repo.deleteBook('b1');
    expect(await repo.getSummary('b1', 0, 0)).toBeNull();
    expect(await repo.getSummary('b2', 0, 0)).not.toBeNull();
  });
});
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/lib/import/__tests__/repository.aiSummaries.test.ts`
Expected: FAIL — `SummaryRecord` / methods missing.

- [ ] **Step 3: 在 `repository.ts` 加类型 + 接口 + InMemory 实现**

After the `ReadingSession` interface add:

```ts
export interface SummaryRecord {
  bookId: string;
  /** 0 = per-chapter summary, 1 = per-arc (merged) summary. */
  level: 0 | 1;
  /** chapter index (level 0) or arc index (level 1). */
  idx: number;
  model: string;
  promptVersion: string;
  summary: string;
  createdAt: number;
}
```

In `BookRepository` interface add:

```ts
  /** Upserts an AI summary keyed by (bookId, level, idx). */
  putSummary(s: SummaryRecord): Promise<void>;
  /** Returns the summary for a key, or null. */
  getSummary(bookId: string, level: 0 | 1, idx: number): Promise<SummaryRecord | null>;
  /** Returns level's summaries with idx ≤ uptoIdx, ascending by idx. */
  listSummaries(bookId: string, level: 0 | 1, uptoIdx: number): Promise<SummaryRecord[]>;
```

In `InMemoryBookRepository` add a field + methods and extend `deleteBook`:

```ts
  private summaries = new Map<string, SummaryRecord>();
```

```ts
  async putSummary(s: SummaryRecord): Promise<void> {
    this.summaries.set(`${s.bookId}:${s.level}:${s.idx}`, { ...s });
  }

  async getSummary(bookId: string, level: 0 | 1, idx: number): Promise<SummaryRecord | null> {
    return this.summaries.get(`${bookId}:${level}:${idx}`) ?? null;
  }

  async listSummaries(bookId: string, level: 0 | 1, uptoIdx: number): Promise<SummaryRecord[]> {
    return Array.from(this.summaries.values())
      .filter((s) => s.bookId === bookId && s.level === level && s.idx <= uptoIdx)
      .sort((a, b) => a.idx - b.idx)
      .map((s) => ({ ...s }));
  }
```

In `deleteBook(bookId)` body add:

```ts
    for (const [k, s] of this.summaries) if (s.bookId === bookId) this.summaries.delete(k);
```

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/lib/import/__tests__/repository.aiSummaries.test.ts`
Expected: PASS.

- [ ] **Step 5: SQLite 侧（不单测）**

In `src/lib/import/sqliteRepository.ts`: add `SummaryRecord` to the `import type` list; add DDL and methods.

DDL after the sessions table:

```ts
const CREATE_SUMMARIES_TABLE = `
  CREATE TABLE IF NOT EXISTS ai_summaries (
    bookId        TEXT NOT NULL,
    level         INTEGER NOT NULL,
    idx           INTEGER NOT NULL,
    model         TEXT NOT NULL,
    promptVersion TEXT NOT NULL,
    summary       TEXT NOT NULL,
    createdAt     INTEGER NOT NULL,
    PRIMARY KEY (bookId, level, idx),
    FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
  );
`;
```

Append `CREATE_SUMMARIES_TABLE` to the `execAsync(...)` concatenation in `open()`.

Methods (after `listSessions`):

```ts
  async putSummary(s: SummaryRecord): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync(
      `INSERT OR REPLACE INTO ai_summaries (bookId, level, idx, model, promptVersion, summary, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      s.bookId, s.level, s.idx, s.model, s.promptVersion, s.summary, s.createdAt,
    );
  }

  async getSummary(bookId: string, level: 0 | 1, idx: number): Promise<SummaryRecord | null> {
    const db = await this.dbPromise;
    type Row = { bookId: string; level: number; idx: number; model: string; promptVersion: string; summary: string; createdAt: number };
    const row = await db.getFirstAsync<Row>(
      'SELECT * FROM ai_summaries WHERE bookId = ? AND level = ? AND idx = ?',
      bookId, level, idx,
    );
    return row ? { ...row, level: row.level as 0 | 1 } : null;
  }

  async listSummaries(bookId: string, level: 0 | 1, uptoIdx: number): Promise<SummaryRecord[]> {
    const db = await this.dbPromise;
    type Row = { bookId: string; level: number; idx: number; model: string; promptVersion: string; summary: string; createdAt: number };
    const rows = await db.getAllAsync<Row>(
      'SELECT * FROM ai_summaries WHERE bookId = ? AND level = ? AND idx <= ? ORDER BY idx ASC',
      bookId, level, uptoIdx,
    );
    return rows.map((r) => ({ ...r, level: r.level as 0 | 1 }));
  }
```

- [ ] **Step 6: 校验 + 提交**

Run: `npx tsc --noEmit` → no errors.
Run: `npx jest src/lib/import` → PASS.

```bash
git add src/lib/import/repository.ts src/lib/import/sqliteRepository.ts src/lib/import/__tests__/repository.aiSummaries.test.ts
git commit -m "feat(ai): ai_summaries table + repo put/get/list (chapter & arc levels)"
```

---

### Task 4: `ensureSummaries`（防剧透 map-reduce + 弧归并）

**Files:**
- Create: `src/lib/ai/summarize.ts`
- Test: `src/lib/ai/__tests__/summarize.test.ts`

**Interfaces:**
- Consumes: `readChapterText`（`src/lib/reader/readChapter.ts`）；`FileGateway`（`src/lib/import/importBook.ts`）；`BookRepository`、`BookRecord`、`ChapterRecord`、`SummaryRecord`（Task 3）；`ChatMessage`（Task 2）；`AiError`（Task 2）。
- Produces:
  - `SUMMARY_PROMPT_VERSION = 'v1'`、`ARC_SIZE = 25`
  - `type SummarizeFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>`
  - `chapterSummaryMessages(title: string, body: string): ChatMessage[]`
  - `interface EnsureSummariesParams { book; chapters; cutoff; model; concurrency?; signal?; onProgress? }`
  - `ensureSummaries(deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository }, params: EnsureSummariesParams): Promise<void>`

- [ ] **Step 1: 写失败测试**

Create `src/lib/ai/__tests__/summarize.test.ts`:

```ts
import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { InMemoryBookRepository } from '../../import/repository';
import { AiError } from '../client';
import { ensureSummaries, SUMMARY_PROMPT_VERSION, ARC_SIZE } from '../summarize';

async function setup(chapterCount: number) {
  const repo = new InMemoryBookRepository();
  const fs = new FakeFileGateway();
  const chapters = Array.from({ length: chapterCount }, (_, i) => ({
    title: `第${i + 1}章`,
    body: `正文${i + 1}`,
  }));
  const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
  const chapterRecords = await repo.getChapters('b1');
  return { repo, fs, book, chapters: chapterRecords };
}

describe('ensureSummaries', () => {
  it('summarizes only chapters 0..cutoff and never reads >= cur', async () => {
    const { repo, fs, book, chapters } = await setup(6);
    const readIdx: number[] = [];
    const origRead = fs.readRange.bind(fs);
    fs.readRange = async (uri, a, b) => {
      // map the byte range back to which chapter — simpler: count calls via chapters
      return origRead(uri, a, b);
    };
    const chat = jest.fn(async () => 'S');
    // cutoff = 2 means chapters 0,1,2 are fully read (current chapter is 3)
    await ensureSummaries({ chat, fs, repo, }, { book, chapters, cutoff: 2, model: 'm' });
    const stored = await repo.listSummaries('b1', 0, 100);
    expect(stored.map((s) => s.idx)).toEqual([0, 1, 2]);
    expect(chat).toHaveBeenCalledTimes(3);
    // no summary for index >= 3
    expect(await repo.getSummary('b1', 0, 3)).toBeNull();
  });

  it('skips chapters already summarized with the same model+promptVersion', async () => {
    const { repo, fs, book, chapters } = await setup(4);
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 0, model: 'm', promptVersion: SUMMARY_PROMPT_VERSION, summary: 'cached', createdAt: 1 });
    const chat = jest.fn(async () => 'NEW');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 1, model: 'm' });
    expect(chat).toHaveBeenCalledTimes(1); // only idx 1
    expect((await repo.getSummary('b1', 0, 0))?.summary).toBe('cached');
  });

  it('regenerates when the cached model or promptVersion differs', async () => {
    const { repo, fs, book, chapters } = await setup(2);
    await repo.putSummary({ bookId: 'b1', level: 0, idx: 0, model: 'OLD', promptVersion: SUMMARY_PROMPT_VERSION, summary: 'stale', createdAt: 1 });
    const chat = jest.fn(async () => 'FRESH');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 0, model: 'm' });
    expect((await repo.getSummary('b1', 0, 0))?.summary).toBe('FRESH');
  });

  it('reports progress and persists incrementally', async () => {
    const { repo, fs, book, chapters } = await setup(3);
    const seen: number[] = [];
    const chat = jest.fn(async () => 'S');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 2, model: 'm', concurrency: 1, onProgress: (d) => seen.push(d) });
    expect(seen[seen.length - 1]).toBe(3);
  });

  it('throws cancelled on an aborted signal but keeps already-saved summaries', async () => {
    const { repo, fs, book, chapters } = await setup(4);
    const ctrl = new AbortController();
    let calls = 0;
    const chat = jest.fn(async () => {
      calls += 1;
      if (calls === 2) ctrl.abort();
      return 'S';
    });
    await expect(
      ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 3, model: 'm', concurrency: 1, signal: ctrl.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    const stored = await repo.listSummaries('b1', 0, 100);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBeLessThan(4);
  });

  it('merges an arc summary once a full arc of chapters is summarized', async () => {
    const { repo, fs, book, chapters } = await setup(ARC_SIZE + 2);
    const chat = jest.fn(async () => 'S');
    await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: ARC_SIZE, model: 'm', concurrency: 4 });
    // arc 0 covers chapters 0..ARC_SIZE-1 (all <= cutoff) → one arc summary
    expect(await repo.getSummary('b1', 1, 0)).not.toBeNull();
    // arc 1 (would cover ARC_SIZE..) is incomplete → none
    expect(await repo.getSummary('b1', 1, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/lib/ai/__tests__/summarize.test.ts`
Expected: FAIL — `../summarize` not found.

- [ ] **Step 3: 实现 `src/lib/ai/summarize.ts`**

```ts
/**
 * 增量 5: 章/弧小结 map-reduce。防剧透不变量：只小结 0..cutoff（读完的章），
 * 绝不读 index >= cur 的章。注入 chat/fs/repo 可测。有界并发、可中断、增量落库。
 */

import type { FileGateway } from '../import/importBook';
import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import { readChapterText } from '../reader/readChapter';
import { AiError, type ChatMessage } from './client';

export const SUMMARY_PROMPT_VERSION = 'v1';
export const ARC_SIZE = 25;

export type SummarizeFn = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;

export function chapterSummaryMessages(title: string, body: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是中文小说的摘要助手。请对给定章节输出"事实要点式"小结（人物、关键事件、关系变化），' +
        '不加评论、不猜测后文，控制在 200 字内。',
    },
    { role: 'user', content: `章节标题：${title}\n\n正文：\n${body}` },
  ];
}

function arcSummaryMessages(summaries: string[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是中文小说的摘要助手。请把多章的要点小结合并成一段更高层的"弧小结"，保留人物与主线，控制在 300 字内。',
    },
    { role: 'user', content: summaries.map((s, i) => `[${i + 1}] ${s}`).join('\n') },
  ];
}

export interface EnsureSummariesParams {
  book: BookRecord;
  chapters: ChapterRecord[];
  /** inclusive last fully-read chapter index (= currentChapter - 1). */
  cutoff: number;
  model: string;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

interface Deps {
  chat: SummarizeFn;
  fs: FileGateway;
  repo: BookRepository;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

export async function ensureSummaries(deps: Deps, params: EnsureSummariesParams): Promise<void> {
  const { chat, fs, repo } = deps;
  const { book, chapters, cutoff, model, concurrency = 4, signal, onProgress } = params;
  if (cutoff < 0) return;

  const throwIfCancelled = () => {
    if (signal?.aborted) throw new AiError('cancelled', 'AI 已取消');
  };

  // 1) which chapters in [0..cutoff] need a fresh summary?
  const missing: number[] = [];
  for (let i = 0; i <= cutoff && i < chapters.length; i++) {
    const cached = await repo.getSummary(book.id, 0, i);
    if (!cached || cached.model !== model || cached.promptVersion !== SUMMARY_PROMPT_VERSION) missing.push(i);
  }

  const total = missing.length;
  let done = 0;
  await runPool(missing, concurrency, async (i) => {
    throwIfCancelled();
    const text = await readChapterText(fs, book.normalizedPath, chapters[i]); // i <= cutoff < cur → spoiler-safe
    const nl = text.indexOf('\n');
    const title = nl >= 0 ? text.slice(0, nl) : text;
    const body = nl >= 0 ? text.slice(nl + 1) : '';
    const summary = await chat(chapterSummaryMessages(title, body), signal);
    throwIfCancelled();
    await repo.putSummary({
      bookId: book.id, level: 0, idx: i, model, promptVersion: SUMMARY_PROMPT_VERSION, summary, createdAt: Date.now(),
    });
    done += 1;
    onProgress?.(done, total);
  });

  // 2) merge arc summaries for every COMPLETE arc (all its chapters <= cutoff).
  const lastCompleteArc = Math.floor((cutoff + 1) / ARC_SIZE) - 1;
  for (let arc = 0; arc <= lastCompleteArc; arc++) {
    throwIfCancelled();
    const existing = await repo.getSummary(book.id, 1, arc);
    if (existing && existing.model === model && existing.promptVersion === SUMMARY_PROMPT_VERSION) continue;
    const parts: string[] = [];
    for (let c = arc * ARC_SIZE; c < (arc + 1) * ARC_SIZE; c++) {
      const s = await repo.getSummary(book.id, 0, c);
      if (s) parts.push(s.summary);
    }
    const merged = await chat(arcSummaryMessages(parts), signal);
    throwIfCancelled();
    await repo.putSummary({
      bookId: book.id, level: 1, idx: arc, model, promptVersion: SUMMARY_PROMPT_VERSION, summary: merged, createdAt: Date.now(),
    });
  }
}
```

> Note: the concurrency pool checks `signal` before each unit and after each chat, so an abort mid-run rejects with `cancelled` while summaries saved so far persist. `readChapterText` is only ever called for `i ≤ cutoff`.

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/lib/ai/__tests__/summarize.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: 校验 + 提交**

Run: `npx tsc --noEmit` → no errors.

```bash
git add src/lib/ai/summarize.ts src/lib/ai/__tests__/summarize.test.ts
git commit -m "feat(ai): ensureSummaries — spoiler-safe chapter+arc map-reduce with cancel"
```

---

### Task 5: `selectContext`（预算 / 上卷 / 防剧透聚合）

**Files:**
- Create: `src/lib/ai/context.ts`
- Test: `src/lib/ai/__tests__/context.test.ts`

**Interfaces:**
- Consumes: `SummaryRecord`（Task 3）；`ARC_SIZE`（Task 4）。
- Produces:
  - `CONTEXT_BUDGET = 24000`（字符近似 token 预算）
  - `interface SelectedContext { contextText: string; includedChapterIdx: number[]; usedArcs: number[] }`
  - `selectContext(p: { arcSummaries: SummaryRecord[]; chapterSummaries: SummaryRecord[]; currentChapterText: string; cutoff: number; budgetChars?: number; arcSize?: number }): SelectedContext`

- [ ] **Step 1: 写失败测试**

Create `src/lib/ai/__tests__/context.test.ts`:

```ts
import type { SummaryRecord } from '../../import/repository';
import { selectContext, CONTEXT_BUDGET } from '../context';

function chap(idx: number, summary = `ch${idx}`): SummaryRecord {
  return { bookId: 'b1', level: 0, idx, model: 'm', promptVersion: 'v1', summary, createdAt: 1 };
}
function arc(idx: number, summary = `arc${idx}`): SummaryRecord {
  return { bookId: 'b1', level: 1, idx, model: 'm', promptVersion: 'v1', summary, createdAt: 1 };
}

describe('selectContext', () => {
  it('includes recent chapter summaries + current chapter text under budget', () => {
    const r = selectContext({
      arcSummaries: [],
      chapterSummaries: [chap(0), chap(1), chap(2)],
      currentChapterText: '当前章已读原文',
      cutoff: 2,
    });
    expect(r.includedChapterIdx).toEqual([0, 1, 2]);
    expect(r.contextText).toContain('当前章已读原文');
    expect(r.contextText).toContain('ch2');
  });

  it('never includes a chapter idx greater than cutoff (spoiler-safe)', () => {
    // caller must pass only <= cutoff, but selectContext must also defend.
    const r = selectContext({
      arcSummaries: [],
      chapterSummaries: [chap(0), chap(1), chap(2), chap(3)],
      currentChapterText: '',
      cutoff: 2,
    });
    expect(Math.max(...r.includedChapterIdx)).toBeLessThanOrEqual(2);
    expect(r.includedChapterIdx).not.toContain(3);
  });

  it('rolls up to arc summaries for early chapters when over budget', () => {
    // 60 fat chapter summaries blow the budget; arcs 0,1 cover the early ones.
    const fat = 'x'.repeat(1000);
    const chapters = Array.from({ length: 60 }, (_, i) => chap(i, fat));
    const arcs = [arc(0), arc(1)];
    const r = selectContext({
      arcSummaries: arcs,
      chapterSummaries: chapters,
      currentChapterText: '',
      cutoff: 59,
      budgetChars: 8000,
    });
    expect(r.contextText.length).toBeLessThanOrEqual(8000 + 200); // within budget (+ small labels)
    expect(r.usedArcs.length).toBeGreaterThan(0);
    // most recent chapters kept as chapter-level detail
    expect(r.includedChapterIdx).toContain(59);
  });

  it('exposes a sane default budget', () => {
    expect(CONTEXT_BUDGET).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/lib/ai/__tests__/context.test.ts`
Expected: FAIL — `../context` not found.

- [ ] **Step 3: 实现 `src/lib/ai/context.ts`**

```ts
/**
 * 增量 5: 把"已读小结"聚合成一段防剧透上下文，卡在字符预算内。
 * 策略：当前章已读原文（最高优先）+ 最近章小结（次高）+ 更早用弧小结；
 * 超预算就丢最早的（弧优先保留，章优先保留近的）。纯函数可测。
 */

import type { SummaryRecord } from '../import/repository';
import { ARC_SIZE } from './summarize';

export const CONTEXT_BUDGET = 24_000;

export interface SelectedContext {
  contextText: string;
  includedChapterIdx: number[];
  usedArcs: number[];
}

export function selectContext(p: {
  arcSummaries: SummaryRecord[];
  chapterSummaries: SummaryRecord[];
  currentChapterText: string;
  cutoff: number;
  budgetChars?: number;
  arcSize?: number;
}): SelectedContext {
  const budget = p.budgetChars ?? CONTEXT_BUDGET;
  const arcSize = p.arcSize ?? ARC_SIZE;

  // Defense in depth: never let a chapter/arc past the cutoff leak in.
  const chapters = p.chapterSummaries.filter((s) => s.idx <= p.cutoff).sort((a, b) => a.idx - b.idx);
  const arcs = p.arcSummaries.filter((a) => (a.idx + 1) * arcSize - 1 <= p.cutoff).sort((a, b) => a.idx - b.idx);

  const parts: string[] = [];
  const includedChapterIdx: number[] = [];
  const usedArcs: number[] = [];
  let used = 0;
  const room = () => budget - used;

  // 1) current chapter read-so-far text (highest priority, always try first)
  const cur = p.currentChapterText.trim();
  if (cur) {
    const slice = cur.slice(0, Math.max(0, room()));
    if (slice) {
      parts.push(`【当前章·已读】\n${slice}`);
      used += slice.length + 8;
    }
  }

  // 2) recent chapter summaries, newest→oldest, until budget runs low
  const recentKept: string[] = [];
  let oldestKeptChapterIdx = p.cutoff + 1;
  for (let i = chapters.length - 1; i >= 0; i--) {
    const c = chapters[i];
    const piece = `第${c.idx + 1}章：${c.summary}`;
    if (piece.length + 1 > room()) break;
    recentKept.unshift(piece);
    includedChapterIdx.unshift(c.idx);
    oldestKeptChapterIdx = c.idx;
    used += piece.length + 1;
  }

  // 3) arc summaries for chapters older than the oldest kept chapter, newest→oldest
  const arcKept: string[] = [];
  for (let a = arcs.length - 1; a >= 0; a--) {
    const arc = arcs[a];
    const arcLastChapter = (arc.idx + 1) * arcSize - 1;
    if (arcLastChapter >= oldestKeptChapterIdx) continue; // already covered by chapter detail
    const piece = `【第${arc.idx * arcSize + 1}-${arcLastChapter + 1}章·概要】${arc.summary}`;
    if (piece.length + 1 > room()) break;
    arcKept.unshift(piece);
    usedArcs.unshift(arc.idx);
    used += piece.length + 1;
  }

  const body = [...arcKept, ...recentKept];
  const contextText = [parts[0], body.join('\n')].filter(Boolean).join('\n\n');
  return { contextText, includedChapterIdx, usedArcs };
}
```

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/lib/ai/__tests__/context.test.ts`
Expected: PASS.

- [ ] **Step 5: 校验全套 + 提交**

Run: `npx tsc --noEmit` → no errors.
Run: `npx jest src/lib/ai src/lib/import` → PASS.

```bash
git add src/lib/ai/context.ts src/lib/ai/__tests__/context.test.ts
git commit -m "feat(ai): selectContext — budget-bounded spoiler-safe aggregation (arc rollup)"
```

---

## Self-Review

**1. Spec coverage（Part A 范围）：** AiConfig+持久化+网关 filename → T1 ✓；OpenAI 兼容客户端（超时/取消/402/429/http/bad/length/网络/脱敏）→ T2 ✓；`ai_summaries`（level/model/promptVersion，双实现+级联）→ T3 ✓；`ensureSummaries`（cutoff=cur-1、只读≤cutoff、增量、并发、可中断、弧归并）→ T4 ✓；`selectContext`（预算、弧上卷、防剧透 index）→ T5 ✓。Part B（companion/AiPanel/AiSettingsModal/阅读器入口/回顾+人物/收尾）不在本 plan，待 A 绿后单独规划。

**2. Placeholder scan：** 无 TODO/TBD；每步含完整代码/断言。T1 Step3 显式要求删掉那行"占位守卫" import（已注明）。

**3. Type consistency：** `AiConfig`、`ChatMessage`/`AiError`/`ChatResult`（T2）、`SummaryRecord`（T3）、`SummarizeFn`/`SUMMARY_PROMPT_VERSION`/`ARC_SIZE`（T4）、`CONTEXT_BUDGET`/`SelectedContext`（T5）前后一致；`ensureSummaries` 用 `chat: SummarizeFn`（Part B 会用 `chatComplete` 适配成 `SummarizeFn`）。

**注意（交给实现者）：** T4 测试里对"只读 ≤cutoff"的核心断言是"存储的小结 idx 全 ≤cutoff 且 chat 次数=缺失章数、idx≥cur 无小结"；若想更硬可在 `readChapterText` 外包一层 spy 断言从未以 ≥cur 的 chapter 调用（可选增强）。
