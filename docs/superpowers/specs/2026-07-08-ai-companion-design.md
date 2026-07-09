# 增量 5 · AI 伴读（防剧透 / 到当前进度为止）— 设计

日期：2026-07-08 · 所属：T8 之后的 AI 进阶 · 范围：JS-only，全程可走 OTA

> 本 spec 由 plan-mode 设计 + opus 设计审阅（并入 S1/S2/I1/I3/I4/I5/I6）定稿。

## Context（为什么做）

NovelReader 已有精确阅读进度（`ProgressRecord.chapterIndex` + `charOffset`＝章内段号 blockIndex）、章节字节索引（`ChapterRecord.byteStart/End`）、按章读取（`readChapterText`，`src/lib/reader/readChapter.ts`）。用户自带 OpenAI 兼容模型 key（DeepSeek，便宜）。市场调研（Kindle「Story So Far / Ask This Book」、Recall Reader「Previously on / Who is this」、Readwise Ghostreader）显示：最有价值的 AI 阅读功能都靠"知道你读到哪、只用已读部分、防剧透"——正是本 App 的天然优势。

第一批三项，均"到当前进度为止 / 防剧透"：**剧情回顾 / 人物档案 / 问这本书**；接入：**通用 OpenAI 兼容**（DeepSeek 预设默认，可换豆包/智谱/OpenAI 不改代码）。

**关键现实（决定架构）：** 目标书常是网文，2000–4000 章、15–20MB。DeepSeek 上下文 ~64K–128K token：单章可整段入，但整本、乃至"读到 800 章的全部小结"都塞不进一次调用。故必须 **map-reduce + 二级归并 + token 预算滑窗**。

## 约束

- 全程 JS-only、**无新原生依赖、不改 package.json** → 走 OTA。`fetch` 内置调 API。
- key 由用户 App 内输入、本地保存（无 secure-store；明文取舍见 §隐私）。真机测试用 `D:\Games\API_KEY.txt`（不提交、日志脱敏）。
- 主题自适应：AI 面板颜色取 `resolveTheme(settings.themeId)`。
- 纯逻辑（config/client/summarize/context/companion）不 import react/react-native，注入 `fetchImpl`/fake 依赖可严格单测。

## 核心不变量（S1 · 防剧透，最重要）

**缓存的章小结只覆盖"完全读完"的章。** 设当前进度 `(cur, off)`：
- 已读完的章 = `0..cur-1` → 可生成/缓存小结、可入上下文。
- **当前章 `cur` 绝不缓存小结、绝不整章入模型**；只把已读部分原文实时切入：`splitBlocks(readChapterText(...chapters[cur])).slice(0, off+1)`（`src/lib/reader/blocks.ts`）。原文比小结更准、天然精确到段。
- `ensureSummaries` 的 cutoff = `cur-1`，**绝不对 index ≥ cur 调 `readChapterText`**。
- 边界：`off===0`（刚进 cur 章）→ 当前章只贡献标题/空，上下文＝小结 `0..cur-1`。
- **硬断言**：聚合输入的章 index 集合 ⊆ `[0..cur-1]`（当前章仅以 ≤off 的原文出现）；`ensureSummaries` 不触碰 ≥cur 的章。

## 规模策略（S2 · 千章不爆上下文）

- 常量 `CONTEXT_BUDGET`（按字符数近似 token 上限）；聚合前做**纯函数预算**，超则降级——可单测。
- **二级归并**：每 ~25 章的章小结再归并成一条**弧小结**并缓存（`ai_summaries.level`：0＝章、1＝弧）。
- **聚合选择**（纯函数 `selectContext`）：早期用弧小结、最近 M 章用章小结、当前章用已读原文切片；总量卡在 `CONTEXT_BUDGET`，超则继续上卷/缩窗。
- 「回顾」用滚动累积或弧小结；「问书」用"最近窗口章小结 + 弧小结 + 当前章原文"。
- 模型返回 `finish_reason==='length'` 或命中输入超限 → 触发上卷/缩窗重试（降级信号）。

## 架构与关键文件（复用现有分层）

**基建**
- `src/lib/ai/config.ts`（新）：`AiConfig{ baseUrl; apiKey; model; enabled; consentAt }` + `DEFAULT_AI_CONFIG`（`https://api.deepseek.com`、`deepseek-chat`）+ `sanitizeAiConfig`（校验 https、去尾斜杠、非法回落默认、永不抛）+ `loadAiConfig/saveAiConfig`。
- 持久化复用 `SettingsGateway`（`src/lib/settings/store.ts` 的 `read()/write()`）：给 `ExpoSettingsGateway` 构造器加 `filename='settings.json'` 参数（M1），另存 `ai-config.json`，不混入 settings。
- `src/lib/ai/client.ts`（新）：`chatComplete({ config, messages, fetchImpl?, signal?, maxTokens?, temperature? }): Promise<{ content; finishReason }>` → POST `${baseUrl}/chat/completions`（Bearer、OpenAI 兼容）。**AbortController + 超时 ~60s**；错误分类：未配置 key / 取消 / 超时 / HTTP(402 余额、429 限流→指数退避) / 非 2xx（抽 JSON `error.message` 或原文）/ `choices|content` 缺失 / `finish_reason==='length'`（降级信号）。注入 `fetchImpl` 可测；日志**脱敏 key**。
- SQLite（`sqliteRepository.ts` + `repository.ts`）：加表 `ai_summaries(bookId, level, idx, model, promptVersion, summary, createdAt, PK(bookId,level,idx))`（I1：含 model/promptVersion，命中但不匹配＝miss 重生成；level 0 章/1 弧；FK CASCADE）。repo：`putSummary/getSummary/listSummaries(bookId, level, uptoIdx)`；InMemory 同步 + 删书级联。加法式 DDL（`CREATE TABLE IF NOT EXISTS`）。
- `src/lib/ai/summarize.ts`（新）：`ensureSummaries({ deps, fs, repo, book, chapters, cutoff, model, promptVersion, signal, onProgress })` — 对 `0..cutoff` 缺失/不匹配的章：`readChapterText`→**事实要点式**小结（人物/关键事件/关系，非叙述式，M3）→落库。**有界并发 4–6**、每章即落库（可续/可中断）、循环查 `signal`、429 退避（I2）。弧小结按需归并。
- `src/lib/ai/context.ts`（新，纯函数）：`selectContext({ summaries, arcSummaries, currentChapterText, budget }): Message[]`——实现 §规模策略，可单测。

**功能层（都只吃 `≤cur-1` 小结 + 当前章已读原文）**
- `src/lib/ai/companion.ts`（新，纯 prompt + 编排）：
  - `askBook(question, ctx)`：系统提示强制"只用所给（已读）内容、不得剧透、未知就明说不知道"。**主路径**。
  - `storySoFar(ctx)`：聚合→回顾。
  - `characterDossier(name, ctx)` = **askBook 的预置问题模板**（不单独建模块，I5/YAGNI）。

**UI**
- `src/reader/AiPanel.tsx`（新）：底部 sheet，仿 `src/reader/FullTextPanel.tsx`（主题自适应、注入回调范本）。三模式 回顾/问书/人物(输入名字，先不做正文点名 NER)。态：建小结进度（可取消）、生成中、结果、错误分类、未配置 key→引导设置、未同意→同意门。
- 入口：阅读器 chrome 加「AI」按钮 → 开 AiPanel（传 bookId、当前 `(cur,off)`、repo、fs、aiConfig）。
- `src/settings/AiSettingsModal.tsx`（新）：baseUrl/key/model 输入（key `secureTextEntry`、只显末 4 位）+ 启用开关 + 首次外发同意（持久化 `consentAt`，I6）。从 AiPanel/书架进入。

## 落地顺序（先主干 + 一条竖切跑通，再加另两模式）

1. `AiConfig` 模型 + sanitize + 持久化（复用带 filename 的网关）
2. `chatComplete` 客户端（注入 fetch、超时/取消、错误与 length 降级分类）
3. `ai_summaries` 表（level/model/promptVersion）+ repo 方法（双实现 + 级联）
4. `ensureSummaries`（cutoff=cur-1、要点式、并发、可中断、退避）
5. `selectContext` 纯函数（预算/上卷/防剧透 index 断言）
6. `companion.askBook` + 端到端竖切：AiPanel「问书」+ AiSettingsModal + 阅读器入口 → 真机验证
7. 加「回顾」`storySoFar` + 「人物」预置模板
8. 收尾：全量测试、tsc、`expo export ios`、真机 DeepSeek key 全流程 + 删书清缓存

## 测试策略

- 纯逻辑：`sanitizeAiConfig`（https/尾斜杠/非法回落）+ 持久化往返；`chatComplete`（注入 fetch：成功/无 key/取消/超时/402/429/非2xx/content 缺失/length 降级）；`ensureSummaries`（fake fs+repo+fake client：只小结缺失章、命中不重复、**cutoff 不越界 cur**、model/promptVersion 变则重建、abort 保留既有）；`selectContext`（预算内/超则上卷/**index 集合 ⊆ [0..cur-1]**/当前章切片止于 off）；`companion` prompt。
- 组件（RNTL 13，注入 fakes）：`AiPanel` 各态；`AiSettingsModal` 输入保存/同意门。
- Verify：`npm test` 全绿 / `tsc --noEmit` 干净 / `expo export --platform ios` 成功 / 0 act 警告。
- 真机（DeepSeek key）：填 key→同意→启用；读到中段某章「问书」问只有后文才知的→答"未知/不剧透"；问已读→答准确；「回顾」不含当前章未读后半；「人物」输名→不剧透；换 model/baseUrl 生效并重建；删书清缓存；千章书首次回填有进度、可取消、可续。

## 隐私 / 取舍

- key 明文存 `ai-config.json`（`documentDirectory`）——无 secure-store 下既定取舍；iOS 沙盒+数据保护下个人侧载可接受；日志脱敏、`secureTextEntry`、末4位显示、首次外发持久化同意门控。将来出 dev-build 可迁 expo-secure-store。
- 正文/小结会发送给用户配置的 AI 服务——同意时明示。

## 明确不做（本增量）

流式输出（先非流式）；正文点名 NER（先输入框）；人物关系**图**（需 svg，非 OTA；先文字）；划词助手（未选，后续增量）；跨设备同步；本地向量 RAG（弧小结+滑窗已够）。
