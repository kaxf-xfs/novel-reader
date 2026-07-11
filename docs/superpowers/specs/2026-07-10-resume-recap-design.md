# 续读回顾卡（Resume Recap Card）— 设计规范

> 增量 6。个人 iOS 小说阅读器的 AI 进阶功能之一。JS-only OTA 交付。

## 背景与目标

追更党的真实痛点:**隔了很久回来续读,想不起前情**。App 已有精确进度（`ProgressRecord.chapterIndex` + `charOffset`）、章级摘要缓存（`ai_summaries` level 0，增量 5 建立）。二者恰好拼出一个低成本、防剧透的「续读回顾」。

AI 面板里已有的「回顾」tab 是**手动、每次现算完整前情提要（200–400 字）**。本功能不同:它是**被动 surface + 复用缓存、只在久别重逢时弹一次、只给 2–3 句提醒**,让读者一眼想起「我读到哪了、刚才在讲什么」。

本功能是三个后续增量的第一个:
- **增量 6 · 续读回顾卡**（本规范）
- 增量 7 · 已读图鉴（世界观设定词典 + 人物图鉴/关系速查）
- 增量 8 · AI 创作坊（二创 + 角色对话）

## 产品决策

1. **只在「隔 N 天没读这本书」续读时弹一次**卡片,平时完全不出现。不做每章首速览、不做常驻回顾条。
2. **N 默认 7 天,可在 AI 设置里调**（开关 `recapEnabled` + 阈值 `recapGapDays`）。
3. **有缓存 → 一次廉价合成调用出 2–3 句**;缓存不足 → 只显「生成回顾」按钮,点击才走**有界回填**,绝不静默触发全书大回填。
4. 卡片可 `×` 关闭,本次打开一次性;关掉后本次不再出现（直到下次满足间隔）。

## 核心不变量

**防剧透（硬）**:回顾只用 `idx ≤ cutoff` 的已读章摘要,`cutoff = currentChapterIndex - 1`;绝不读取/外发当前章及之后。与 `buildReadContext` 同一条边界。

**成本有界（硬）**:
- 缓存合成只吃已缓存摘要（输入短、便宜），不调 `ensureSummaries`（那是可能极慢的全书大回填）。
- 「生成回顾」只对 `recent` 窗口（默认 6 章，全在 `≤cutoff`）里缺失的章逐章摘要→落库→合成。调用数 ≤~7，**与书长无关**。不走 `ensureSummaries` 全量、不走 `storySoFar` 完整提要。两条路径产物形态一致（都是 2–3 句）。

**同意门控**:卡片仅在 `aiConfig.enabled && apiKey 非空 && consentAt !== null` 时才可能出现（合成会外发已读内容）。

## 数据流

```
进书 → init 加载 book/chapters/progress（已有 Promise.all）
     → lastReadAt = progress.updatedAt（墙钟、按书；init 快照旧值，本次滚动写回不自污染）
     → startIndex = min(progress.chapterIndex, len-1)（局部变量，非异步 state）
     → due = isRecapDue({lastReadAt, now, gapDays, currentChapterIndex: startIndex})
              && recapEnabled && enabled && apiKey && consentAt
     → recapEvaluatedRef 一次性守卫（防 effect 重跑/StrictMode 双弹）
     → due ? 挂 ResumeRecapCard : 不挂

卡片 mount → loadCachedRecap(signal)
           → buildResumeRecap 取 recent∩已缓存(过滤当前 model/promptVersion)
           → 命中≥min(window,cutoff+1,3) ? 一次 recapMessages 合成 → text
                                          : needs-generation
           → text 态 | needs-generation 态（显「生成回顾」按钮）
按钮 → generateRecap(onProgress, signal)
     → generateRecentRecap 只补 recent 缺失章（readChapterText→chapterSummaryMessages→putSummary）
     → recapMessages 合成 → text
× → onDismiss（abort 在途 + 隐藏，本次不再弹）
```

## 组件设计

**配置** `src/lib/ai/config.ts`
- `AiConfig` 增 `recapEnabled: boolean`（默认 true）、`recapGapDays: number`（默认 7）。
- `sanitizeAiConfig` 显式判空（非裸 `Boolean`）:`recapEnabled: p.recapEnabled === undefined ? true : Boolean(p.recapEnabled)`；`recapGapDays: clamp(Number.isFinite(p.recapGapDays) ? p.recapGapDays : 7, 0, 90)`（下限 0 供真机即时验证）。

**回顾逻辑** `src/lib/ai/recap.ts`（复用 `summarize.ts` 的 `chapterSummaryMessages`/`SUMMARY_PROMPT_VERSION`）
- `isRecapDue({ lastReadAt, now, gapDays, currentChapterIndex }): boolean` — 纯。
- `recapMessages(summaries: string[]): ChatMessage[]` — 合成 2–3 句、防剧透的 prompt。
- `buildResumeRecap(deps:{chat,repo}, {bookId,currentChapterIndex,model,windowChapters?=6}): Promise<{kind:'text';text}|{kind:'needs-generation'}>` — 缓存路径，命中过滤 model/promptVersion，测试硬断言发给 chat 的摘要 `idx ≤ cutoff`。
- `generateRecentRecap(deps:{chat,fs,repo}, {book,chapters,currentChapterIndex,model,windowChapters?=6,signal,onProgress}): Promise<string>` — 有界回填，只碰 `recent ∩ ≤cutoff`。

**UI** `src/reader/ResumeRecapCard.tsx`（仿 `AiPanel` 注入回调 + 主题自适应）
- Props `{ visible, chapterLabel, gapDays, loadCachedRecap, generateRecap, onDismiss }`。
- 态:loading→(text | needs-generation→generating(进度/取消)→text)→error;`×` 关闭。
- 根 View 吞触摸（避免穿透到正文 surface 误切 chrome）。顶栏（`paddingTop:52`）下方绝对定位浮层，JSX 顺序 surface→卡片→顶栏。

**接线** `src/screens/ReaderScreen.tsx`
- 用 `progress.updatedAt` 当 lastReadAt（不新增 `listSessions`）。
- init 内用局部 `startIndex` 算 due；`recapEvaluatedRef` 一次性。
- `loadCachedRecap` = `buildResumeRecap`（`cachedChat` 短 maxTokens + signal）；`generateRecap` = `generateRecentRecap`。

## 测试策略

- `sanitizeAiConfig`:recap 默认 true 不被判假、clamp 0–90。
- `isRecapDue`:间隔阈值、`currentChapterIndex>0`、null lastReadAt、gapDays=0。
- `buildResumeRecap`:有缓存合成、无缓存 needs-generation、model/promptVersion 不匹配算未命中、**发给 chat 的摘要 idx ⊆ [0..cutoff]**、window 选取。
- `generateRecentRecap`:只回填 recent 缺失章、进度回调、abort 保留既有、不碰 `≥cutoff`。
- `ResumeRecapCard`:text 态 / needs-generation→按钮→generating→text / dismiss abort / cancel。
- `AiSettingsModal`:recap 控件 + 空串/超界解析 + 保存。
- 门禁:`npm test` 全绿 / tsc 干净 / `expo export ios` 成功 / 0 act 警告。

## 隐私 / 取舍

复用增量 5 的既定取舍:key 明文存 `ai-config.json`、外发前同意门控、只发 `≤cutoff` 已读内容。续读回顾的合成调用同受 consent 门控。

## 明确不做

每章首「上章速览」、常驻回顾条、书架续读入口内联回顾、剧情预测。图鉴/二创归增量 7/8。
