# 续读回顾卡（Resume Recap Card）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 隔 N 天回来续读时，在阅读页顶部弹一次「前情回顾」卡，复用已缓存章摘要给出 2–3 句提醒；缓存不足则按需有界回填。

**Architecture:** 纯逻辑（`recap.ts`：`isRecapDue` / `buildResumeRecap` / `generateRecentRecap`）+ 展示组件（`ResumeRecapCard`）+ 配置扩展（`AiConfig` 两字段）+ `ReaderScreen` 接线。全部注入依赖、可单测。防剧透靠 `idx ≤ cutoff`；成本靠「只吃缓存 / 只回填最近窗口」。

**Tech Stack:** Expo SDK 57、RN 0.86、React 19.2、TS strict、Jest 29 + jest-expo、@testing-library/react-native 13。

## Global Constraints

- **OTA-safe**：不新增原生依赖、不改 `package.json`。只用 RN 内置 + `expo-file-system` + `fetch`。
- 路径别名 `@/*` → `src/*`（tsconfig + jest 均配）。相对/别名导入沿用同目录既有风格。
- **防剧透硬不变量**：`cutoff = currentChapterIndex - 1`；一切摘要读取/外发只允许 `idx ≤ cutoff`，绝不碰当前章及之后。
- **成本有界**：缓存合成不调 `ensureSummaries`（全书大回填）；「生成回顾」只覆盖 `recent` 窗口（默认 6 章）。
- RNTL 13 的 `toHaveTextContent` 默认精确匹配——子串断言要传 `{ exact: false }`。
- 中文 UI 文案按本计划所写**逐字**使用。
- 复用既有：`chapterSummaryMessages`/`SUMMARY_PROMPT_VERSION`（`src/lib/ai/summarize.ts`）、`readChapterText`（`src/lib/reader/readChapter.ts`）、`chatComplete`/`ChatMessage`（`src/lib/ai/client.ts`）、`InMemoryBookRepository`（`src/lib/import/repository.ts`）、`runAi`/`AiSettingsModal` 现有范式。

---

### Task 1: AiConfig 增 recap 字段 + sanitize

**Files:**
- Modify: `src/lib/ai/config.ts`
- Test: `src/lib/ai/__tests__/config.test.ts`（若不存在则创建）

**Interfaces:**
- Produces: `AiConfig` 增 `recapEnabled: boolean`、`recapGapDays: number`；`DEFAULT_AI_CONFIG` 增 `recapEnabled: true`、`recapGapDays: 7`；`sanitizeAiConfig` 处理这两字段。

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/ai/__tests__/config.test.ts （追加或新建）
import { sanitizeAiConfig, DEFAULT_AI_CONFIG } from '../config';

describe('sanitizeAiConfig recap fields', () => {
  test('缺字段时 recapEnabled 默认 true（不被裸 Boolean 判假）', () => {
    const c = sanitizeAiConfig({ baseUrl: 'https://api.deepseek.com' });
    expect(c.recapEnabled).toBe(true);
    expect(c.recapGapDays).toBe(7);
  });
  test('recapEnabled=false 被保留', () => {
    expect(sanitizeAiConfig({ recapEnabled: false }).recapEnabled).toBe(false);
  });
  test('recapGapDays 非有限值回落 7', () => {
    expect(sanitizeAiConfig({ recapGapDays: NaN }).recapGapDays).toBe(7);
    expect(sanitizeAiConfig({ recapGapDays: undefined }).recapGapDays).toBe(7);
  });
  test('recapGapDays clamp 到 0–90', () => {
    expect(sanitizeAiConfig({ recapGapDays: -5 }).recapGapDays).toBe(0);
    expect(sanitizeAiConfig({ recapGapDays: 999 }).recapGapDays).toBe(90);
    expect(sanitizeAiConfig({ recapGapDays: 0 }).recapGapDays).toBe(0);
  });
  test('DEFAULT_AI_CONFIG 带默认', () => {
    expect(DEFAULT_AI_CONFIG.recapEnabled).toBe(true);
    expect(DEFAULT_AI_CONFIG.recapGapDays).toBe(7);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/ai/__tests__/config.test.ts`
Expected: FAIL（字段不存在 / 默认为 false）

- [ ] **Step 3: 实现**

`AiConfig` 接口加：
```ts
  /** 续读回顾卡开关。 */
  recapEnabled: boolean;
  /** 隔多少天没读才弹回顾卡（0–90，0 = 只要有进度就弹，用于验证）。 */
  recapGapDays: number;
```
`DEFAULT_AI_CONFIG` 加 `recapEnabled: true, recapGapDays: 7,`。
`sanitizeAiConfig` 的 return 加：
```ts
    recapEnabled: p.recapEnabled === undefined ? true : Boolean(p.recapEnabled),
    recapGapDays: clampGap(p.recapGapDays),
```
并加辅助（文件内）：
```ts
function clampGap(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_AI_CONFIG.recapGapDays;
  return Math.min(90, Math.max(0, Math.round(n)));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/ai/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/ai/config.ts src/lib/ai/__tests__/config.test.ts
git commit -m "feat(recap): AiConfig recapEnabled/recapGapDays + sanitize"
```

---

### Task 2: recap.ts — isRecapDue（纯）

**Files:**
- Create: `src/lib/ai/recap.ts`
- Test: `src/lib/ai/__tests__/recap.test.ts`

**Interfaces:**
- Produces: `isRecapDue({ lastReadAt: number | null; now: number; gapDays: number; currentChapterIndex: number }): boolean`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/ai/__tests__/recap.test.ts
import { isRecapDue } from '../recap';

const DAY = 86_400_000;
describe('isRecapDue', () => {
  const now = 10_000 * DAY;
  test('间隔 ≥ gapDays 且有进度 → true', () => {
    expect(isRecapDue({ lastReadAt: now - 8 * DAY, now, gapDays: 7, currentChapterIndex: 5 })).toBe(true);
  });
  test('间隔不足 → false', () => {
    expect(isRecapDue({ lastReadAt: now - 3 * DAY, now, gapDays: 7, currentChapterIndex: 5 })).toBe(false);
  });
  test('currentChapterIndex=0（无前情）→ false', () => {
    expect(isRecapDue({ lastReadAt: now - 30 * DAY, now, gapDays: 7, currentChapterIndex: 0 })).toBe(false);
  });
  test('lastReadAt=null → false', () => {
    expect(isRecapDue({ lastReadAt: null, now, gapDays: 7, currentChapterIndex: 5 })).toBe(false);
  });
  test('gapDays=0 → 只要有进度即 true', () => {
    expect(isRecapDue({ lastReadAt: now, now, gapDays: 0, currentChapterIndex: 5 })).toBe(true);
    expect(isRecapDue({ lastReadAt: now, now, gapDays: 0, currentChapterIndex: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/ai/__tests__/recap.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/lib/ai/recap.ts （首段）
const DAY_MS = 86_400_000;

export interface IsRecapDueParams {
  lastReadAt: number | null;
  now: number;
  gapDays: number;
  currentChapterIndex: number;
}

export function isRecapDue({ lastReadAt, now, gapDays, currentChapterIndex }: IsRecapDueParams): boolean {
  if (lastReadAt == null) return false;
  if (currentChapterIndex <= 0) return false;
  return now - lastReadAt >= gapDays * DAY_MS;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/ai/__tests__/recap.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/ai/recap.ts src/lib/ai/__tests__/recap.test.ts
git commit -m "feat(recap): isRecapDue pure gate"
```

---

### Task 3: recap.ts — recapMessages + buildResumeRecap + generateRecentRecap

**Files:**
- Modify: `src/lib/ai/recap.ts`
- Test: `src/lib/ai/__tests__/recap.test.ts`

**Interfaces:**
- Consumes: `SummarizeFn`、`ChatMessage`、`SUMMARY_PROMPT_VERSION`、`chapterSummaryMessages`（`./summarize`）；`readChapterText`（`../reader/readChapter`）；`BookRecord`/`ChapterRecord`/`BookRepository`（`../import/repository`）；`FileGateway`（`../import/importBook`）。
- Produces:
  - `recapMessages(summaries: string[]): ChatMessage[]`
  - `buildResumeRecap(deps: { chat: SummarizeFn; repo: BookRepository }, params: { bookId: string; currentChapterIndex: number; model: string; windowChapters?: number; signal?: AbortSignal }): Promise<{ kind: 'text'; text: string } | { kind: 'needs-generation' }>`
  - `generateRecentRecap(deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository }, params: { book: BookRecord; chapters: ChapterRecord[]; currentChapterIndex: number; model: string; windowChapters?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<string>`

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 src/lib/ai/__tests__/recap.test.ts
import { buildResumeRecap, generateRecentRecap, recapMessages } from '../recap';
import { SUMMARY_PROMPT_VERSION } from '../summarize';
import { InMemoryBookRepository, type BookRecord, type ChapterRecord } from '../../import/repository';
import type { ChatMessage } from '../client';

const MODEL = 'deepseek-chat';
function cachedSummary(repo: InMemoryBookRepository, bookId: string, idx: number, model = MODEL, pv = SUMMARY_PROMPT_VERSION) {
  return repo.putSummary({ bookId, level: 0, idx, model, promptVersion: pv, summary: `第${idx}章要点`, createdAt: 1 });
}

describe('recapMessages', () => {
  test('system 提示含防剧透与 2-3 句约束', () => {
    const m = recapMessages(['a', 'b']);
    expect(m[0].role).toBe('system');
    expect(m[0].content).toContain('不得剧透');
    expect(m[1].content).toContain('a');
  });
});

describe('buildResumeRecap（缓存路径）', () => {
  test('近窗命中≥阈值 → 合成 text，且只发 idx≤cutoff 的摘要', async () => {
    const repo = new InMemoryBookRepository();
    // cur=10 → cutoff=9；缓存 5..9（含）+ 一个越界 10 用来验证不外发
    for (let i = 5; i <= 10; i++) await cachedSummary(repo, 'b1', i);
    let sent: ChatMessage[] = [];
    const chat = async (msgs: ChatMessage[]) => { sent = msgs; return '合成回顾'; };
    const r = await buildResumeRecap({ chat, repo }, { bookId: 'b1', currentChapterIndex: 10, model: MODEL });
    expect(r).toEqual({ kind: 'text', text: '合成回顾' });
    // 断言：user 消息里不含「第10章」（越界），含「第9章」
    expect(sent[1].content).toContain('第9章要点');
    expect(sent[1].content).not.toContain('第10章要点');
  });

  test('近窗命中不足 → needs-generation（不调用 chat）', async () => {
    const repo = new InMemoryBookRepository();
    await cachedSummary(repo, 'b1', 0); // 远处 1 条，近窗 0 命中
    const chat = jest.fn(async () => 'x');
    const r = await buildResumeRecap({ chat, repo }, { bookId: 'b1', currentChapterIndex: 30, model: MODEL });
    expect(r).toEqual({ kind: 'needs-generation' });
    expect(chat).not.toHaveBeenCalled();
  });

  test('model/promptVersion 不匹配算未命中', async () => {
    const repo = new InMemoryBookRepository();
    for (let i = 5; i <= 9; i++) await cachedSummary(repo, 'b1', i, 'old-model');
    const chat = jest.fn(async () => 'x');
    const r = await buildResumeRecap({ chat, repo }, { bookId: 'b1', currentChapterIndex: 10, model: MODEL });
    expect(r).toEqual({ kind: 'needs-generation' });
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('generateRecentRecap（有界回填）', () => {
  const book = { id: 'b1', normalizedPath: '/x' } as BookRecord;
  const chapters: ChapterRecord[] = Array.from({ length: 40 }, (_, i) => ({
    bookId: 'b1', index: i, title: `T${i}`, level: 0 as const, byteStart: i, byteEnd: i + 1,
  }));
  // readChapterText 用 fs.readRange(path, start, end) → bytes → utf8；首行为标题
  const fs = { readRange: async (_p: string, s: number, _e: number) => Buffer.from(`T\n正文${s}`, 'utf8') } as any;

  test('只回填 recent 内缺失章、报进度、合成 → 不碰 ≥cutoff', async () => {
    const repo = new InMemoryBookRepository();
    const readIdx: number[] = [];
    // 用 spy 包 readChapterText 不方便；改为断言 putSummary 的 idx 集合
    const chat = async (msgs: ChatMessage[]) =>
      msgs[0].content.includes('前情回顾') ? '最终回顾' : '章摘要';
    const progress: Array<[number, number]> = [];
    const text = await generateRecentRecap(
      { chat, fs, repo },
      { book, chapters, currentChapterIndex: 30, model: MODEL, windowChapters: 6,
        onProgress: (d, t) => progress.push([d, t]) },
    );
    expect(text).toBe('最终回顾');
    // cutoff=29，window=6 → recent=[24..29]，全缺失 → 落库这 6 条
    const cached = await repo.listSummaries('b1', 0, 100);
    expect(cached.map((s) => s.idx).sort((a, b) => a - b)).toEqual([24, 25, 26, 27, 28, 29]);
    expect(cached.every((s) => s.idx <= 29)).toBe(true);
    expect(progress[progress.length - 1]).toEqual([6, 6]);
  });

  test('已缓存的 recent 章不重复回填', async () => {
    const repo = new InMemoryBookRepository();
    for (let i = 24; i <= 27; i++) await cachedSummary(repo, 'b1', i);
    let chapterCalls = 0;
    const chat = async (msgs: ChatMessage[]) => {
      if (msgs[0].content.includes('前情回顾')) return '最终回顾';
      chapterCalls++; return '章摘要';
    };
    await generateRecentRecap({ chat, fs, repo }, { book, chapters, currentChapterIndex: 30, model: MODEL, windowChapters: 6 });
    expect(chapterCalls).toBe(2); // 只有 28、29 需要回填
  });
});
```

> 注：`fs` 只需满足 `readChapterText` 的调用；按 `readChapter.ts` 的实际接口构造最小 fake（本 fake 用 `readAsBytes` 占位，实现步骤时对齐真实签名）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/lib/ai/__tests__/recap.test.ts`
Expected: FAIL（函数未定义）

- [ ] **Step 3: 实现**

```ts
// 追加到 src/lib/ai/recap.ts
import type { FileGateway } from '../import/importBook';
import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import { readChapterText } from '../reader/readChapter';
import type { ChatMessage, SummarizeFn } from './client'; // 若 SummarizeFn 来自 summarize，则从 './summarize' 引入
import { SUMMARY_PROMPT_VERSION, chapterSummaryMessages, type SummarizeFn } from './summarize';

const DEFAULT_WINDOW = 6;

export function recapMessages(summaries: string[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '把下列已读章节要点合成一段简短「前情回顾」(2-3 句)，帮读者快速想起读到哪了。' +
        '只依据所给要点，不得剧透或推测后续，简洁中文。',
    },
    { role: 'user', content: summaries.map((s, i) => `[${i + 1}] ${s}`).join('\n') },
  ];
}

function recentRange(currentChapterIndex: number, windowChapters: number): { cutoff: number; from: number } {
  const cutoff = currentChapterIndex - 1;
  const from = Math.max(0, cutoff - windowChapters + 1);
  return { cutoff, from };
}

export async function buildResumeRecap(
  deps: { chat: SummarizeFn; repo: BookRepository },
  params: { bookId: string; currentChapterIndex: number; model: string; windowChapters?: number; signal?: AbortSignal },
): Promise<{ kind: 'text'; text: string } | { kind: 'needs-generation' }> {
  const window = params.windowChapters ?? DEFAULT_WINDOW;
  const { cutoff, from } = recentRange(params.currentChapterIndex, window);
  if (cutoff < 0) return { kind: 'needs-generation' };
  const all = await deps.repo.listSummaries(params.bookId, 0, cutoff); // idx ≤ cutoff（防剧透）
  const hits = all.filter(
    (s) => s.idx >= from && s.idx <= cutoff && s.model === params.model && s.promptVersion === SUMMARY_PROMPT_VERSION,
  );
  const needed = Math.min(window, cutoff + 1, 3);
  if (hits.length < needed) return { kind: 'needs-generation' };
  const text = await deps.chat(recapMessages(hits.map((s) => s.summary)), params.signal);
  return { kind: 'text', text };
}

export async function generateRecentRecap(
  deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository },
  params: {
    book: BookRecord; chapters: ChapterRecord[]; currentChapterIndex: number; model: string;
    windowChapters?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void;
  },
): Promise<string> {
  const window = params.windowChapters ?? DEFAULT_WINDOW;
  const { cutoff, from } = recentRange(params.currentChapterIndex, window);
  // 找 recent 内需要回填的章（缺失或 model/pv 不匹配），全部 ≤ cutoff
  const missing: number[] = [];
  for (let i = from; i <= cutoff && i < params.chapters.length; i++) {
    const c = await deps.repo.getSummary(params.book.id, 0, i);
    if (!c || c.model !== params.model || c.promptVersion !== SUMMARY_PROMPT_VERSION) missing.push(i);
  }
  const total = missing.length;
  let done = 0;
  for (const i of missing) {
    if (params.signal?.aborted) throw new Error('cancelled');
    const raw = await readChapterText(deps.fs, params.book.normalizedPath, params.chapters[i]); // i ≤ cutoff → spoiler-safe
    const nl = raw.indexOf('\n');
    const title = nl >= 0 ? raw.slice(0, nl) : raw;
    const body = nl >= 0 ? raw.slice(nl + 1) : '';
    const summary = await deps.chat(chapterSummaryMessages(title, body), params.signal);
    await deps.repo.putSummary({
      bookId: params.book.id, level: 0, idx: i, model: params.model,
      promptVersion: SUMMARY_PROMPT_VERSION, summary, createdAt: Date.now(),
    });
    done += 1;
    params.onProgress?.(done, total);
  }
  const hits = await deps.repo.listSummaries(params.book.id, 0, cutoff);
  const recent = hits.filter((s) => s.idx >= from && s.idx <= cutoff);
  return deps.chat(recapMessages(recent.map((s) => s.summary)), params.signal);
}
```

> 实现步骤时校正两处：(a) `SummarizeFn` 的真实来源（`summarize.ts` 已导出，勿重复导入）；(b) `readChapterText` 的真实 fs 签名，对齐后修正测试 fake。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/lib/ai/__tests__/recap.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/ai/recap.ts src/lib/ai/__tests__/recap.test.ts
git commit -m "feat(recap): recapMessages + buildResumeRecap + generateRecentRecap"
```

---

### Task 4: ResumeRecapCard 组件

**Files:**
- Create: `src/reader/ResumeRecapCard.tsx`
- Test: `src/reader/__tests__/ResumeRecapCard.test.tsx`

**Interfaces:**
- Consumes: `useSettings`/`resolveTheme`（同 `AiPanel`）。
- Produces: `ResumeRecapCard(props: { visible: boolean; chapterLabel: string; gapDays: number; loadCachedRecap: (signal: AbortSignal) => Promise<{ kind: 'text'; text: string } | { kind: 'needs-generation' }>; generateRecap: (onProgress: (d: number, t: number) => void, signal: AbortSignal) => Promise<string>; onDismiss: () => void })`
- testID：`resume-recap-card` / `recap-text` / `recap-generate` / `recap-progress` / `recap-dismiss`。

- [ ] **Step 1: 写失败测试**

```tsx
// src/reader/__tests__/ResumeRecapCard.test.tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ResumeRecapCard } from '../ResumeRecapCard';
import { SettingsProvider } from '../../settings/SettingsContext';

function wrap(ui: React.ReactElement) {
  return render(<SettingsProvider>{ui}</SettingsProvider>);
}

const baseProps = {
  visible: true, chapterLabel: '第 12 章', gapDays: 7,
  loadCachedRecap: async () => ({ kind: 'text' as const, text: '前情回顾内容' }),
  generateRecap: async () => '生成结果',
  onDismiss: jest.fn(),
};

test('缓存命中 → 展示回顾文字', async () => {
  wrap(<ResumeRecapCard {...baseProps} />);
  expect(await screen.findByTestId('recap-text')).toHaveTextContent('前情回顾内容', { exact: false });
});

test('needs-generation → 显按钮，点击后回填并展示结果', async () => {
  const generateRecap = jest.fn(async (onP: (d: number, t: number) => void) => { onP(1, 2); return '生成结果'; });
  wrap(<ResumeRecapCard {...baseProps}
    loadCachedRecap={async () => ({ kind: 'needs-generation' as const })}
    generateRecap={generateRecap} />);
  const btn = await screen.findByTestId('recap-generate');
  await act(async () => { fireEvent.press(btn); });
  expect(generateRecap).toHaveBeenCalled();
  expect(await screen.findByTestId('recap-text')).toHaveTextContent('生成结果', { exact: false });
});

test('× 关闭 → onDismiss', async () => {
  const onDismiss = jest.fn();
  wrap(<ResumeRecapCard {...baseProps} onDismiss={onDismiss} />);
  await screen.findByTestId('recap-text');
  fireEvent.press(screen.getByTestId('recap-dismiss'));
  expect(onDismiss).toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/reader/__tests__/ResumeRecapCard.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现**

要点：
- `useEffect` 依赖 `visible`：`visible` 变 true 时新建 `AbortController`，调 `loadCachedRecap(signal)`，据结果置 `state = 'text' | 'need-gen'`；`visible` 变 false / 卸载时 `abort()`。
- `need-gen` 点击 `recap-generate`：新建 controller，`setState('generating')`，`generateRecap(onProgress, signal)` → 成功置 `text`，失败置 `error`；`recap-progress` 显示 `正在整理最近章节… {done}/{total}`（testID `recap-progress`）。
- 顶层容器：绝对定位浮层（`position:'absolute'`, top 按顶栏高度，left/right margin），**根 View 用 `Pressable`（空 `onPress`）或 `onStartShouldSetResponder={() => true}` 吞触摸**，避免穿透 surface。
- `recap-dismiss`（`×`）→ `onDismiss`。
- 主题：`resolveTheme(settings.themeId)`，配色对齐 `AiPanel`（背景/border/subtle/accent）。
- 顶部小标题类似「读到 {chapterLabel} · 上次是 {gapDays} 天前」（陈述性，非强制文案，可按主题微调）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/reader/__tests__/ResumeRecapCard.test.tsx`
Expected: PASS（0 act 警告）

- [ ] **Step 5: 提交**

```bash
git add src/reader/ResumeRecapCard.tsx src/reader/__tests__/ResumeRecapCard.test.tsx
git commit -m "feat(recap): ResumeRecapCard component"
```

---

### Task 5: AiSettingsModal 加续读回顾开关 + 天数

**Files:**
- Modify: `src/settings/AiSettingsModal.tsx`
- Test: `src/settings/__tests__/AiSettingsModal.test.tsx`

**Interfaces:**
- Consumes: `useAiConfig().update`（已有）。
- Produces: 新增控件 testID `ai-recap-enable`（套 Pressable，同 `ai-enable` 范式）、`ai-recap-gap`（`TextInput`, `keyboardType="number-pad"`）。`save()` 带上 `recapEnabled`、`recapGapDays`（字符串解析 → `parseInt` → NaN 回落 7 → clamp 0–90）。

- [ ] **Step 1: 写失败测试**

```tsx
// 追加到 src/settings/__tests__/AiSettingsModal.test.tsx
test('保存时带上 recapEnabled 与解析后的 recapGapDays', async () => {
  const update = jest.fn();
  // 复用该测试文件既有的 render helper（注入 fake gateway / useAiConfig）
  renderModal({ update }); // ← 对齐文件里已有的渲染方式
  fireEvent.changeText(screen.getByTestId('ai-recap-gap'), '3');
  fireEvent.press(screen.getByTestId('ai-recap-enable'));
  fireEvent.press(screen.getByTestId('ai-save'));
  await waitFor(() => expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ recapGapDays: 3 }),
  ));
});

test('recap 天数空串保存 → 回落 7', async () => {
  const update = jest.fn();
  renderModal({ update });
  fireEvent.changeText(screen.getByTestId('ai-recap-gap'), '');
  fireEvent.press(screen.getByTestId('ai-save'));
  await waitFor(() => expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ recapGapDays: 7 }),
  ));
});
```

> 实现步骤时按该测试文件**既有**的 render/mock 方式改写 `renderModal`（沿用增量 5 建立的 fake gateway + `AiConfigProvider`），不要新造范式。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- src/settings/__tests__/AiSettingsModal.test.tsx`
Expected: FAIL（控件/字段不存在）

- [ ] **Step 3: 实现**

- 加 state：`const [recapEnabled, setRecapEnabled] = useState(aiConfig.recapEnabled);` `const [recapGap, setRecapGap] = useState(String(aiConfig.recapGapDays));`
- `wasVisible` 开合 resync 里补：`setRecapEnabled(aiConfig.recapEnabled); setRecapGap(String(aiConfig.recapGapDays));`
- 在「启用 AI 伴读」行下方加一段：
  ```tsx
  <Pressable testID="ai-recap-enable" onPress={() => setRecapEnabled((v) => !v)} style={styles.row}>
    <Text style={[styles.label, { color: theme.text, marginBottom: 0 }]}>久别续读时弹前情回顾</Text>
    <Switch value={recapEnabled} onValueChange={setRecapEnabled} />
  </Pressable>
  <Text style={[styles.label, { color: theme.subtle }]}>隔多少天没读才回顾</Text>
  <TextInput testID="ai-recap-gap" style={input} value={recapGap} onChangeText={setRecapGap}
    placeholder="7" placeholderTextColor={theme.subtle} keyboardType="number-pad" />
  ```
- `save()` 改为：
  ```ts
  const parsed = parseInt(recapGap, 10);
  const recapGapDays = Number.isNaN(parsed) ? 7 : Math.min(90, Math.max(0, parsed));
  update({ baseUrl, apiKey, model, enabled, recapEnabled, recapGapDays });
  onClose();
  ```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- src/settings/__tests__/AiSettingsModal.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/settings/AiSettingsModal.tsx src/settings/__tests__/AiSettingsModal.test.tsx
git commit -m "feat(recap): AiSettingsModal recap toggle + gap-days"
```

---

### Task 6: ReaderScreen 接线 + 挂卡

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`

**Interfaces:**
- Consumes: `isRecapDue`/`buildResumeRecap`/`generateRecentRecap`（`../lib/ai/recap`）、`ResumeRecapCard`（`../reader/ResumeRecapCard`）、已有 `aiConfig`、`chatComplete`。

- [ ] **Step 1: 接线（无独立单元测试；随 verify 门禁 + 真机验证）**

- init `Promise.all` 结果里已有 `progress`；在成功分支内、`setCurrentChapterIndex(startIndex)` 附近，用**局部** `startIndex` 计算：
  ```ts
  const lastReadAt = progress?.updatedAt ?? null;
  if (!recapEvaluatedRef.current) {
    recapEvaluatedRef.current = true;
    const due = isRecapDue({ lastReadAt, now: Date.now(), gapDays: aiConfig.recapGapDays, currentChapterIndex: startIndex })
      && aiConfig.recapEnabled && aiConfig.enabled && aiConfig.apiKey.length > 0 && aiConfig.consentAt !== null;
    if (due) setShowRecap(true);
  }
  ```
  新增 `const recapEvaluatedRef = useRef(false);`、`const [showRecap, setShowRecap] = useState(false);`。
- 回调：
  ```ts
  const cachedChat: SummarizeFn = async (messages, sig) =>
    (await chatComplete({ config: aiConfig, messages, signal: sig, maxTokens: 200, temperature: 0.3 })).content;
  const loadCachedRecap = useCallback((signal: AbortSignal) =>
    buildResumeRecap({ chat: cachedChat, repo }, { bookId, currentChapterIndex, model: aiConfig.model, signal }),
    [aiConfig, repo, bookId, currentChapterIndex]);
  const generateRecap = useCallback((onProgress: (d: number, t: number) => void, signal: AbortSignal) => {
    if (!book || !chapters) return Promise.reject(new Error('book not loaded'));
    return generateRecentRecap({ chat: cachedChat, fs, repo },
      { book, chapters, currentChapterIndex, model: aiConfig.model, onProgress, signal });
  }, [aiConfig, book, chapters, fs, repo, currentChapterIndex]);
  ```
- 渲染（`<AiPanel>` 附近，JSX 顺序在 surface 之后、顶栏之前或之后按层级实测）：
  ```tsx
  {showRecap && book && (
    <ResumeRecapCard
      visible={showRecap}
      chapterLabel={currentTitle}
      gapDays={aiConfig.recapGapDays}
      loadCachedRecap={loadCachedRecap}
      generateRecap={generateRecap}
      onDismiss={() => setShowRecap(false)}
    />
  )}
  ```

- [ ] **Step 2: 全量门禁**

```bash
npm test
npx tsc --noEmit
npx expo export --platform ios
```
Expected: 测试全绿 / tsc 0 错 / iOS bundle 成功。

- [ ] **Step 3: 提交**

```bash
git add src/screens/ReaderScreen.tsx
git commit -m "feat(recap): wire ResumeRecapCard into ReaderScreen"
```

- [ ] **Step 4: 真机验证（DeepSeek key）**

按 spec 的 Verify：AI 设置阈值临时设 0 天 → 重进书 → 弹卡（有缓存直接出 2–3 句 / 无缓存显「生成回顾」→ 有界回填有进度可取消）→ `×` 后本次不再弹 → 阈值改回 7、隔不到 7 天不弹 → 关开关不弹。

---

## Self-Review 检查（作者已过）

- Spec 覆盖：产品决策 1–4、防剧透/成本不变量、四处改动均有对应 Task。✅
- 无占位符：每步含真实测试/实现代码。✅
- 类型一致：`buildResumeRecap`/`generateRecentRecap`/`ResumeRecapCard` props 在 Task 3/4/6 间签名一致；`recapEnabled`/`recapGapDays` 贯穿 Task 1/5/6。✅
- 已知实现期校正点（已在文中标注）：`SummarizeFn` 的导入来源、`readChapterText` 的 fs 真实签名、`AiSettingsModal` 测试沿用既有 render helper、卡片浮层的层级/顶栏偏移实测。
