# AI 基础增强（自动摘要 / 更丰富摘要 / 查询感知检索）— 设计规范

> 增量 7。经两轮 opus 审阅定稿（v3）。纯 JS-only OTA。

## 背景与目标

推进 AI 进阶功能时暴露三处**地基**问题：

1. **摘要「哪来」逻辑分散**：问书/回顾/图鉴各写一套按需回填。
2. **章摘要 200 字太短丢细节**：问「某角色身世」答得差——摘要选择性忽略了身世/伏笔类细节。
3. **问书查询无关**：`selectContext` 是位置策略（当前章原文 + 最近章摘要 + 弧概要），答案若埋在早期章就抓不到。

三点是 AI 质量地基，且下一增量「图鉴」的抽取质量也依赖它，故先做。用户已定：检索走**关键词两阶段（不加原生依赖）**；作为独立增量、先于图鉴；**质量优先**。

## 全局约束

- **OTA-safe**：不加原生依赖、不改 package.json。检索复用现有全文搜索原语 + 纯 JS 打分。
- **防剧透硬不变量**：一切摘要/原文的读取与外发只允许 `idx ≤ cutoff`（`cutoff = currentChapterIndex - 1`）；当前章只到已读段 `blockIndex`。
- 改 prompt / 版本号必须**同步 `scripts/ai-eval/eval.mjs`**（逐字镜像 prompt + 选择逻辑）。
- 复用：`ensureSummaries`/`chapterSummaryMessages`/`SUMMARY_PROMPT_VERSION`（`src/lib/ai/summarize.ts`）、`selectContext`/`CONTEXT_BUDGET`（`src/lib/ai/context.ts`）、`searchBook`/`makeSearchSnippet`/`splitBlocks`/`readChapterText`（`src/lib/reader/`）、`chatComplete`（`src/lib/ai/client.ts`）、`buildReadContext`（`src/lib/ai/companion.ts`）。

## A. 统一「自动摘要」开关

**契约**：auto **只摊平阅读位置附近的追赶窗、只建章摘要、前向跟进**；历史 backlog 补全与弧摘要构建一律归各功能按需调用的全量 `ensureSummaries(fromIdx=0)`。auto 是「预热」优化，永不是唯一路径——跳读/跨章丢的中间章、更早历史，下次用 AI 功能时全量兜底。

- `AiConfig.autoSummarize: boolean`（默认 **false**）。`sanitizeAiConfig` 显式判空。`AiSettingsModal` 加开关 `ai-auto-summarize`，文案「自动整理已读章节（后台，消耗 API）」。
- **后台 hook** `src/reader/useAutoSummarize.ts`（注入 `{chat,fs,repo}` + `{enabled,book,chapters,currentChapterIndex,model}`）：
  - 门控 `enabled && aiConfig.enabled && apiKey && consentAt`。
  - 触发：`currentChapterIndex` 前进**且非 restore/jump 瞬态**（`restoringRef` 门控）时，debounce ~4s，跑 `ensureSummaries(fromIdx=max(0,cutoff-30), upgradeStale=true)`，不建弧。
  - `runningRef` 单次守卫（同刻只一个后台运行；跑完 cutoff 又前进则再跑）。StrictMode 双挂载由「每 run 新建 AbortController + cleanup 清 timer」兜住。
  - **失败退避**：只把 401/402/额度（可停）与 网络/429（可重试）计入连续失败阈值，达 N 停跑到下次开书/改 key；**`cancelled` 绝不计数**。
  - 低并发 2、无进度 UI、卸载/关书/关开关 abort。
- **`ensureSummaries` 两处小改**（`summarize.ts`）：
  - `fromIdx=0`（追赶窗下界，只缩章摘要扫描）；**弧合并仅 `fromIdx===0` 时执行**（auto 窗内不建弧，避免残缺弧）。
  - `upgradeStale=true`：`false` 时缺章判定只认「完全没有摘要」为缺（旧 model/promptVersion 视为可用、不重摘）。auto 窗 `true`（有界升级），全量按需路径 `false`（旧摘要照用、只补真缺）。

## B. 更丰富的章摘要（prompt v2）

- 重写 `chapterSummaryMessages`：约 **450 字**，显式捕捉人物身份**与身世/来历线索**、关键事件、关系变化、重要设定/物品/地点、**伏笔性事实**；不评论、不猜后文。`arcSummaryMessages` 同增到 ~400 字。
- `SUMMARY_PROMPT_VERSION` **v1→v2**：**版本容忍迁移**——全量按需路径 `upgradeStale=false`，旧摘要照用、**绝不在一次 AI 调用里同步重刷全书**；v2 富摘要通过 ①新章立即得 v2 ②auto 近窗后台逐步升级 ③可选手动重建 铺开。深读用户升级后首次 AI 调用不阻塞、不爆花费。
- `CONTEXT_BUDGET` 24000 → 32000（DeepSeek 64K+ 足够）。**用常量、不写字面量**。
- 同步 `eval.mjs` prompt/版本 + 新增 ask 分支。

## C. 问书的查询感知检索（仅 `ask` 模式）

新模块 `src/lib/ai/retrieval.ts`：
- `extractQueryTerms(deps:{chat}, question, signal?): Promise<string[]>` — 1 次廉价调用扩关键词+别名；宽松解析 + 失败/极短回退本地切词。
- `scoreChapterSummaries(summaries, terms): {idx;score}[]` — 纯，对 `idx≤cutoff` 已缓存章摘要关键词计分，取 top-K（≈10）。
- `retrieveRelevantPassages(deps:{fs}, {book,chapters,candidateIdx,terms,cutoff,maxBlocks})` — 只对候选章（入参切 `≤cutoff` + 函数内 assert）读原文抽含 term 的段，复用 `splitBlocks` + `makeSearchSnippet`（大窗口 `{before:80,after:200}`），**不复用 `searchBook`**（它扫全书含未读章）。I/O 有界。
- `buildAskContext(deps, params)` 编排：
  1. `ensureSummaries(cutoff, fromIdx=0, upgradeStale=false)` 保底；
  2. `extractQueryTerms`；
  3. `listSummaries(0,cutoff)`（当前章=cutoff+1 天然排除）→ 打分选 top-K；
  4. `retrieveRelevantPassages` 抽段（子预算 ≤8000）；
  5. 组装：检索段（最高优先）拼最前 + `selectContext({..., budgetChars: CONTEXT_BUDGET - 检索段已用})` 产出其余（**复用 selectContext、不改其签名**）；每 passage 再过 `idx≤cutoff` 兜底。
- 接线 `ReaderScreen.runAi`：`ask` 走 `buildAskContext`；`recap`/`character` 仍走 `buildReadContext`。
- 已知取舍：超长当前章原文可饿死弧骨架（现存行为）；`CONTEXT_BUDGET`→32000 全局，recap/character 上下文也变大（花费略升）；32000 中文≈40–50k token，逼近 64K，spec 记 token 余量。

## 测试策略

- `sanitizeAiConfig(autoSummarize 默认 false)`；`ensureSummaries(fromIdx>0 只回填窗内且不建弧、upgradeStale=false 旧版本不重摘只补真缺、全量+弧不回归)`；`useAutoSummarize(前进触发一次、防并发、restore 不触发、cancelled 不计退避、401 计数停跑、StrictMode 不空打、门控/abort)`；`chapterSummaryMessages(v2 含身世/伏笔、版本号=v2)`；`retrieval(打分、idx⊆[0..cutoff]、只读候选章、大窗口、回退)`；`buildAskContext(保底、检索段优先且不越子预算、防剧透 index 集合、候选含当前章红线、复用 selectContext)`。
- 门禁：`npm test` 全绿 / tsc 干净 / `expo export ios` 成功 / 0 act 警告。
- 离线质检：改完 prompt/版本跑 `node scripts/ai-eval/eval.mjs`（+ deep 压测），确认身世类细节答得比 v1 好、防剧透零泄露、检索召回相关早章。
- 真机：开自动摘要→读几章→摘要后台攒（问书/回顾秒开）；问身世/来历细节→引用埋得较早的相关章、明显更准；问未读后续→仍拒答；关自动摘要→不再后台调用。

## 明确不做

向量 RAG（关键词两阶段够用则不上，留后续升级）；图鉴/二创（下增量）；检索用于 recap/character；auto 对全量旧 backlog 的一次性静默回填。
