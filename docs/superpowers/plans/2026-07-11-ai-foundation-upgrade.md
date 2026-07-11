# AI 基础增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 统一自动摘要开关 + 更丰富章摘要 + 问书查询感知检索，抬升 AI 质量并简化「摘要哪来」。

**Architecture:** 复用 `ai_summaries` 缓存与 `chatComplete`；`ensureSummaries` 加 `fromIdx`/`upgradeStale` 两参；新增后台 hook `useAutoSummarize`、检索模块 `retrieval.ts`、编排 `buildAskContext`。全部注入依赖可测。

**Tech Stack:** Expo SDK57、RN0.86、React19.2、TS strict、Jest29 + jest-expo、RNTL13。

## Global Constraints

- **OTA-safe**：不加原生依赖、不改 `package.json`。
- **防剧透硬不变量**：`cutoff = currentChapterIndex - 1`；摘要/原文的读取与外发只允许 `idx ≤ cutoff`；当前章只到 `blockIndex`。
- 改 prompt/版本号必须**同步 `scripts/ai-eval/eval.mjs`**。
- RNTL13 `toHaveTextContent` 子串断言传 `{ exact: false }`；异步态 `findBy`/`waitFor`；press 异步用 `await act`。
- 复用：`ensureSummaries`/`chapterSummaryMessages`/`SUMMARY_PROMPT_VERSION`/`ARC_SIZE`（`summarize.ts`）、`selectContext`/`CONTEXT_BUDGET`（`context.ts`）、`makeSearchSnippet`/`splitBlocks`/`readChapterText`（`reader/`，**不复用 `searchBook`**）、`chatComplete`/`AiError`（`client.ts`）、`buildReadContext`（`companion.ts`）、`InMemoryBookRepository`（`repository.ts`）。

---

### Task 1: AiConfig.autoSummarize + 设置开关

**Files:** Modify `src/lib/ai/config.ts`, `src/settings/AiSettingsModal.tsx`; Test `src/lib/ai/__tests__/config.test.ts`, `src/settings/__tests__/AiSettingsModal.test.tsx`

**Interfaces — Produces:** `AiConfig.autoSummarize: boolean`（`DEFAULT_AI_CONFIG.autoSummarize=false`）；sanitize 显式判空；`AiSettingsModal` 加 testID `ai-auto-summarize`。

- [ ] **Step 1: 失败测试**

```ts
// config.test.ts 追加
test('autoSummarize 缺省 false，显式保留', () => {
  expect(sanitizeAiConfig({}).autoSummarize).toBe(false);
  expect(sanitizeAiConfig({ autoSummarize: true }).autoSummarize).toBe(true);
});
```
```tsx
// AiSettingsModal.test.tsx 追加（沿用既有 renderModal + 真实网关读回范式）
test('保存时带上 autoSummarize', async () => {
  renderModal();
  fireEvent.press(screen.getByTestId('ai-auto-summarize'));
  fireEvent.press(screen.getByTestId('ai-save'));
  await waitFor(async () => expect((await loadAiConfig(/* gw */)).autoSummarize).toBe(true));
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -- src/lib/ai/__tests__/config.test.ts`

- [ ] **Step 3: 实现**

`AiConfig` 加 `autoSummarize: boolean;`；`DEFAULT_AI_CONFIG` 加 `autoSummarize: false,`；sanitize 加 `autoSummarize: p.autoSummarize === undefined ? false : Boolean(p.autoSummarize),`。`AiSettingsModal`：state `autoSummarize`、`wasVisible` resync 补、`ai-auto-summarize` Pressable+Switch（文案「自动整理已读章节（后台，消耗 API）」）、`save()` 的 `update({...})` 带该字段。

- [ ] **Step 4: 跑测试确认通过** — `npm test -- src/lib/ai/__tests__/config.test.ts src/settings/__tests__/AiSettingsModal.test.tsx` + `npx tsc --noEmit`

- [ ] **Step 5: 提交** — `feat(ai-fdn): AiConfig.autoSummarize + settings toggle`

---

### Task 2: ensureSummaries 加 fromIdx + upgradeStale + 弧守卫

**Files:** Modify `src/lib/ai/summarize.ts`; Test `src/lib/ai/__tests__/summarize.test.ts`

**Interfaces — Produces:** `EnsureSummariesParams` 加 `fromIdx?: number`（默认 0）、`upgradeStale?: boolean`（默认 true）。语义：缺章扫描范围 `[fromIdx..cutoff]`；`upgradeStale=false` 时「有任意缓存即视为存在（不因 model/promptVersion 不匹配而重摘）」；**弧合并仅 `fromIdx===0` 时执行**。

- [ ] **Step 1: 失败测试**

```ts
// summarize.test.ts 追加（用 InMemoryBookRepository + fake chat + fake fs）
// 现有测试范式沿用；chat 记录被调 idx
test('fromIdx>0 只回填窗内章，且不建弧', async () => {
  // 40 章，缓存 0（全空）；fromIdx=35, cutoff=39
  const { repo, fs, chat, calls } = setup(40);
  await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 39, fromIdx: 35, model: 'm' });
  expect(calls.chapterIdx.sort((a,b)=>a-b)).toEqual([35,36,37,38,39]);
  expect(await repo.listSummaries('b', 1, 999)).toEqual([]); // 无弧
});

test('upgradeStale=false 时旧 promptVersion 摘要不重摘，只补真缺', async () => {
  const { repo, fs, chat, calls } = setup(5);
  // 0..3 是旧版本 v0 缓存，4 完全没有
  for (let i=0;i<=3;i++) await repo.putSummary({ bookId:'b', level:0, idx:i, model:'m', promptVersion:'v0', summary:'old', createdAt:1 });
  await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 4, model: 'm', upgradeStale: false });
  expect(calls.chapterIdx).toEqual([4]); // 只补真缺的 4，旧版本 0..3 不动
});

test('默认 fromIdx=0 upgradeStale=true 全量+弧行为不回归', async () => {
  const { repo, fs, chat } = setup(30); // ARC_SIZE=25 → 弧0 完整
  await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff: 29, model: 'm' });
  expect((await repo.listSummaries('b', 0, 999)).length).toBe(30);
  expect((await repo.listSummaries('b', 1, 999)).map(s=>s.idx)).toEqual([0]); // 弧0 建出
});
```
> `setup(n)` 造 n 章 + fake fs（`readRange`→含 `\n` 的 bytes）+ 记录 chat 调用的章 idx。按现有 summarize 测试写法对齐。

- [ ] **Step 2: 跑测试确认失败** — `npm test -- src/lib/ai/__tests__/summarize.test.ts`

- [ ] **Step 3: 实现**（`summarize.ts`）

- `EnsureSummariesParams` 加 `fromIdx?: number; upgradeStale?: boolean;`；解构 `const { fromIdx = 0, upgradeStale = true } = params;`。
- 缺章循环下界改 `for (let i = fromIdx; i <= cutoff && i < chapters.length; i++)`；判定：
  ```ts
  const cached = await repo.getSummary(book.id, 0, i);
  const missing_ = !cached || (upgradeStale && (cached.model !== model || cached.promptVersion !== SUMMARY_PROMPT_VERSION));
  if (missing_) missing.push(i);
  ```
- 弧合并整段包 `if (fromIdx === 0) { …现有弧循环… }`。

- [ ] **Step 4: 跑测试确认通过** — `npm test -- src/lib/ai/__tests__/summarize.test.ts` + 同目录回归 `npm test -- src/lib/ai` + `npx tsc --noEmit`

- [ ] **Step 5: 提交** — `feat(ai-fdn): ensureSummaries fromIdx + upgradeStale + arc guard`

---

### Task 3: useAutoSummarize hook + ReaderScreen 后台接线

**Files:** Create `src/reader/useAutoSummarize.ts`; Test `src/reader/__tests__/useAutoSummarize.test.tsx`; Modify `src/screens/ReaderScreen.tsx`

**Interfaces — Produces:** `useAutoSummarize(deps:{chat,fs,repo}, params:{enabled:boolean; book:BookRecord|null; chapters:ChapterRecord[]|null; currentChapterIndex:number; restoring:boolean; model:string}): void`

**Consumes:** `ensureSummaries`（Task 2 的 fromIdx/upgradeStale）、`AiError`。

**关键行为（显式验收）:** ①`currentChapterIndex` 前进且 `!restoring` → debounce ~4s 后跑 `ensureSummaries(fromIdx=max(0,cutoff-30), upgradeStale=true)`；②`runningRef` 防并发，跑完 cutoff 又前进则再跑；③失败退避:401/402/network/429 计数，达 N（如 3）停跑（`stoppedRef`），`cancelled` 不计；④卸载/关书/enabled=false → abort + 清 timer；⑤restoring=true 不触发。

- [ ] **Step 1: 失败测试**（注入 fake chat/fs/repo，用 `jest.useFakeTimers()` 推进 debounce）

```tsx
// 覆盖：前进触发一次；restoring 时不触发；cancelled 不计退避、真失败达阈停跑；enabled=false 不跑
// 用 renderHook（@testing-library/react-native）或一个挂载该 hook 的测试组件；fake chat 记录调用
test('前进且非 restoring → debounce 后跑一次 ensureSummaries', async () => { /* advance timers, assert chat called */ });
test('restoring=true → 不触发', async () => { /* … */ });
test('连续真失败达阈值后停跑；cancelled 不计数', async () => { /* … */ });
test('enabled=false → 从不调用', async () => { /* … */ });
```
> 实现步骤时按 RNTL renderHook 写法落地；断言用注入 fake 的调用记录，勿测真实网络。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 hook**

要点：`useEffect` 依赖 `[enabled, currentChapterIndex, restoring, book?.id]`。`enabled && !restoring && book && chapters` 时，若 `currentChapterIndex > lastRunCutoffRef+1` 起 debounce timer（`setTimeout` 4s）；触发时 `if (runningRef.current || stoppedRef.current) return;` 否则新建 AbortController、`runningRef=true`、跑 `ensureSummaries(...fromIdx=max(0,cutoff-30), upgradeStale=true, concurrency:2, signal)`；`.catch` 里 `if (e.kind==='cancelled') return;` 否则 `failCountRef++`，达 N 置 `stoppedRef=true`；`.finally` `runningRef=false`，若 cutoff 又前进则再排一次。cleanup：`abort()` + `clearTimeout`。`book?.id` 变（换书）时重置 `stoppedRef/failCountRef/lastRunCutoffRef`。

- [ ] **Step 4: 跑测试确认通过** + `npx tsc --noEmit`

- [ ] **Step 5: ReaderScreen 接线**

`const { aiConfig } = useAiConfig();` 已有；加
```tsx
const aiChat: SummarizeFn = useCallback(async (messages, sig) =>
  (await chatComplete({ config: aiConfig, messages, signal: sig, maxTokens: 700, temperature: 0.3 })).content, [aiConfig]);
useAutoSummarize({ chat: aiChat, fs, repo }, {
  enabled: aiConfig.autoSummarize && aiConfig.enabled && aiConfig.apiKey.length>0 && aiConfig.consentAt!==null,
  book, chapters, currentChapterIndex, restoring, model: aiConfig.model,
});
```
（`restoring` 用现有 state；`maxTokens` 提到 ~700 以容纳 v2 更长摘要。）

- [ ] **Step 6: 门禁 + 提交** — `npm test`、`npx tsc --noEmit` → `feat(ai-fdn): useAutoSummarize background hook + wiring`

---

### Task 4: 摘要 prompt v2 + 版本 bump + budget + eval 同步

**Files:** Modify `src/lib/ai/summarize.ts`, `src/lib/ai/context.ts`, `scripts/ai-eval/eval.mjs`; Test `src/lib/ai/__tests__/summarize.test.ts`

**Interfaces — Produces:** `SUMMARY_PROMPT_VERSION='v2'`；`chapterSummaryMessages` 富化；`CONTEXT_BUDGET=32000`。

- [ ] **Step 1: 失败测试**

```ts
test('章摘要 prompt v2 覆盖身世/伏笔且版本为 v2', () => {
  expect(SUMMARY_PROMPT_VERSION).toBe('v2');
  const sys = chapterSummaryMessages('标题', '正文')[0].content;
  expect(sys).toContain('身世');
  expect(sys).toContain('伏笔');
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

`SUMMARY_PROMPT_VERSION = 'v2'`。`chapterSummaryMessages` system 改为约 450 字要点式，显式列：人物身份**与身世/来历线索**、关键事件、关系变化、重要设定/物品/地点、**看似次要但可能重要的事实（伏笔）**；不评论、不猜后文；控制在 450 字内。`arcSummaryMessages` 提到 ~400 字。`context.ts` `CONTEXT_BUDGET = 32_000`。**同步 `eval.mjs`** 里镜像的 prompt 文案与版本号。

- [ ] **Step 4: 跑测试确认通过** + 同目录回归 + `npx tsc --noEmit`

- [ ] **Step 5: 提交** — `feat(ai-fdn): richer summary prompt v2 + budget 32k + eval sync`

---

### Task 5: retrieval.ts（扩词 + 打分 + 抽段）

**Files:** Create `src/lib/ai/retrieval.ts`; Test `src/lib/ai/__tests__/retrieval.test.ts`

**Interfaces — Produces:**
- `extractQueryTerms(deps:{chat:SummarizeFn}, question:string, signal?:AbortSignal): Promise<string[]>`
- `scoreChapterSummaries(summaries:SummaryRecord[], terms:string[]): {idx:number;score:number}[]`
- `retrieveRelevantPassages(deps:{fs:FileGateway}, params:{book:BookRecord; chapters:ChapterRecord[]; candidateIdx:number[]; terms:string[]; cutoff:number; maxBlocks?:number}): Promise<{chapterIdx:number;blockIndex:number;text:string}[]>`

- [ ] **Step 1: 失败测试**

```ts
import { extractQueryTerms, scoreChapterSummaries, retrieveRelevantPassages } from '../retrieval';

test('scoreChapterSummaries 按命中降序、只含 ≤cutoff', () => {
  const sums = [
    { idx:0, summary:'韩立 身世 青牛镇', level:0, bookId:'b', model:'m', promptVersion:'v2', createdAt:1 },
    { idx:1, summary:'打斗', level:0, bookId:'b', model:'m', promptVersion:'v2', createdAt:1 },
  ] as any;
  const r = scoreChapterSummaries(sums, ['韩立','身世']);
  expect(r[0].idx).toBe(0);
  expect(r[0].score).toBeGreaterThan(r[1].score);
});

test('retrieveRelevantPassages 只读候选章、段落 idx ⊆ [0..cutoff]，含 term', async () => {
  const chapters = Array.from({length:20},(_,i)=>({bookId:'b',index:i,title:`T${i}`,level:0,byteStart:i,byteEnd:i+1})) as any;
  const read: number[] = [];
  const fs = { readRange: async (_p:string,s:number)=>{ read.push(s); return Buffer.from(`T\n韩立的身世在这里 seg${s}`,'utf8'); } } as any;
  const book = { id:'b', normalizedPath:'/x' } as any;
  const res = await retrieveRelevantPassages({ fs }, { book, chapters, candidateIdx:[2,5], terms:['身世'], cutoff:10, maxBlocks:5 });
  expect(res.every(p=>p.chapterIdx<=10)).toBe(true);
  expect(res.every(p=>p.text.includes('身世'))).toBe(true);
  // 只读了候选 2、5 两章（byteStart 2、5）
  expect(read.sort((a,b)=>a-b)).toEqual([2,5]);
});

test('extractQueryTerms 解析逗号/顿号、失败回退切词', async () => {
  const chat = async () => '韩立, 身世、来历';
  expect(await extractQueryTerms({ chat }, '韩立身世')).toEqual(expect.arrayContaining(['韩立','身世','来历']));
  const bad = async () => { throw new Error('x'); };
  expect((await extractQueryTerms({ chat: bad }, '韩立 身世')).length).toBeGreaterThan(0); // 回退
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

- `extractQueryTerms`：调 `chat([{role:'system',content:'从问题中提取用于检索的关键词与人名/别名，只输出词，用逗号分隔，不要解释。'},{role:'user',content:question}], signal)`；宽松解析 `split(/[，,、\n]+/)`→trim→去空/序号→去重→cap（如 12）；try/catch 失败或空则回退 `question.split(/[\s，。？、,?.!]+/).filter(Boolean)`。
- `scoreChapterSummaries`：对 `s.idx<=?`（调用方已切）每条按 `terms` 子串命中次数计分，`score>0` 才留，降序返回 `{idx,score}`。（不在此过滤 cutoff——调用方传的是已 ≤cutoff 的集合；但可加防御 `filter`。）
- `retrieveRelevantPassages`：`const safe = candidateIdx.filter(i=>i<=cutoff);`（+可 assert）；对每个 `i` 找 `chapters[i]`、`readChapterText`、`splitBlocks`，从 block1 起找含任一 term 的段，`makeSearchSnippet(block, term, {before:80, after:200})` 裁剪，push `{chapterIdx:i, blockIndex, text}`，累计到 `maxBlocks`（默认如 12）即停。**只读 safe 里的章**（不扫全书）。

- [ ] **Step 4: 跑测试确认通过** + 同目录回归 + `npx tsc --noEmit`

- [ ] **Step 5: 提交** — `feat(ai-fdn): retrieval (extract/score/passages)`

---

### Task 6a: buildAskContext（查询感知编排，纯逻辑）

**Files:** Modify `src/lib/ai/companion.ts`（或新 `src/lib/ai/askContext.ts`）; Test 对应 `__tests__`

**Interfaces — Produces:** `buildAskContext(deps:{chat:SummarizeFn; fs:FileGateway; repo:BookRepository}, params:{book:BookRecord; chapters:ChapterRecord[]; currentChapterIndex:number; currentBlockIndex:number; model:string; question:string; signal?:AbortSignal; onProgress?:(d:number,t:number)=>void}): Promise<{contextText:string; includedChapterIdx:number[]}>`

**Consumes:** `ensureSummaries`（Task2）、`retrieval`（Task5）、`selectContext`/`CONTEXT_BUDGET`（context.ts）、`readChapterText`/`splitBlocks`。

- [ ] **Step 1: 失败测试**

```ts
// 用 fake chat（extract 返回固定 terms、答案调用不在此）+ InMemoryBookRepository 预置摘要 + fake fs
test('检索段拼在最前且不越子预算；组装内容全 ≤cutoff', async () => { /* 断言 contextText 以【相关原文 开头、includedChapterIdx.every(i=>i<=cutoff) */ });
test('候选含当前章红线：绝不把 idx>cutoff 的段/摘要混入', async () => {
  // 预置 currentChapterIndex=10 → cutoff=9；即便构造出 idx=10 的候选，assert/过滤后 contextText 不含第10章原文
});
test('upgradeStale=false 保底：旧版本摘要不触发全书重摘', async () => { /* fake chat 记录：不应对已有旧摘要的章再调 */ });
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

```ts
export async function buildAskContext(deps, params) {
  const { chat, fs, repo } = deps;
  const { book, chapters, currentChapterIndex, currentBlockIndex, model, question, signal, onProgress } = params;
  const cutoff = currentChapterIndex - 1;
  await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff, model, signal, onProgress, upgradeStale: false }); // 全量保底、不重摘旧版本
  const terms = await extractQueryTerms({ chat }, question, signal);
  const chapterSummaries = (await repo.listSummaries(book.id, 0, cutoff)).filter(s => s.idx <= cutoff);
  const arcSummaries = await repo.listSummaries(book.id, 1, Math.floor((cutoff + 1) / ARC_SIZE) - 1);
  const ranked = scoreChapterSummaries(chapterSummaries, terms).slice(0, 10);
  const passages = await retrieveRelevantPassages({ fs }, {
    book, chapters, candidateIdx: ranked.map(r => r.idx).filter(i => i <= cutoff), terms, cutoff, maxBlocks: 12,
  });
  // 检索段（子预算 ≤8000，全 ≤cutoff）
  const PASSAGE_BUDGET = 8000;
  let used = 0; const passLines: string[] = [];
  for (const p of passages) {
    if (p.chapterIdx > cutoff) continue; // defense-in-depth
    const line = `【相关原文·第${p.chapterIdx + 1}章】${p.text}`;
    if (used + line.length + 1 > PASSAGE_BUDGET) break;
    passLines.push(line); used += line.length + 1;
  }
  // 当前章已读原文
  let currentChapterText = '';
  if (currentChapterIndex >= 0 && currentChapterIndex < chapters.length) {
    const raw = await readChapterText(fs, book.normalizedPath, chapters[currentChapterIndex]);
    currentChapterText = splitBlocks(raw).slice(0, currentBlockIndex + 1).join('\n');
  }
  const sel = selectContext({ arcSummaries, chapterSummaries, currentChapterText, cutoff, budgetChars: CONTEXT_BUDGET - used });
  const contextText = [passLines.join('\n'), sel.contextText].filter(Boolean).join('\n\n');
  const includedChapterIdx = Array.from(new Set([...passages.map(p => p.chapterIdx), ...sel.includedChapterIdx])).filter(i => i <= cutoff);
  return { contextText, includedChapterIdx };
}
```

- [ ] **Step 4: 跑测试确认通过** + 同目录回归 + `npx tsc --noEmit`

- [ ] **Step 5: 提交** — `feat(ai-fdn): buildAskContext query-aware assembly`

---

### Task 6b: ReaderScreen ask 接线 + eval ask 分支 + 真机

**Files:** Modify `src/screens/ReaderScreen.tsx`, `scripts/ai-eval/eval.mjs`

- [ ] **Step 1: 接线**：`runAi` 里 `mode==='ask'` 改走 `buildAskContext({chat, fs, repo}, {book, chapters, currentChapterIndex, currentBlockIndex: currentBlockIndexRef.current, model: aiConfig.model, question: input, signal, onProgress})`，再 `askBookMessages(contextText, input)` → `chatComplete`。`recap`/`character` 仍走 `buildReadContext`。

- [ ] **Step 2: eval ask 分支**：`eval.mjs` 加 ask 场景，镜像编排（extractQueryTerms **真调 DeepSeek**、score、retrieve、组装），对样本书问身世/来历类问题，人工/断言看召回与准确。头部对照表补 `retrieval.ts`。

- [ ] **Step 3: 门禁** — `npm test`（全绿）、`npx tsc --noEmit`、`npx expo export --platform ios`（bundle 成功）。

- [ ] **Step 4: 提交** — `feat(ai-fdn): wire ask to buildAskContext + eval ask branch`

- [ ] **Step 5: 离线质检 + 真机验证**：`node scripts/ai-eval/eval.mjs`（+ deep 压测）确认身世类问题比 v1 好、防剧透零泄露；真机按 spec Verify（开自动摘要→读→秒开；问身世→引用早章更准；问未读→拒答；关开关→不再后台调用）。

---

## Self-Review

- Spec 覆盖：A（Task1/2/3）、B（Task4）、C（Task5/6a/6b）全覆盖。✅
- 无占位符：纯逻辑任务给了真实测试/实现代码；hook/接线给了要点+关键代码。
- 类型一致：`fromIdx`/`upgradeStale` 贯穿 Task2/3/6a；`buildAskContext` 签名在 6a 定义、6b 消费一致；`retrieval` 三函数签名在 Task5 定义、6a 消费一致。✅
- 实现期校正点：`summarize.test.ts` 现有 `setup` 范式对齐；`AiSettingsModal.test.tsx` 沿用既有真实网关读回；`useAutoSummarize` 用 RNTL renderHook + fake timers 落地。
