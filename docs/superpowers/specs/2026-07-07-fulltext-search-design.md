# 增量 2 · 书内全文搜索 — 设计

日期：2026-07-07 · 所属：T8 打磨 · 范围：JS-only，全程可走 OTA

## Context（为什么做）

长篇小说读到后面常想「上次那段情节/伏笔在哪一章」。目前只能翻目录（按章标题）或一章章找。需要在**整本正文**里搜关键词，直接跳到出现的段落。大文件（15–20MB）**绝不整本进内存**是硬约束，所以搜索必须按章流式扫描。

## 核心设计

搜索与阅读器**同源**：逐章 `readChapterText`（已存在，按字节范围读单章）→ `splitBlocks`（已存在，阅读器同一套分段）→ 逐段找词。命中锚点 `(chapterIndex, blockIndex)` 与阅读器 block 一一对应，点结果直接复用**增量 1 的 `jumpToChapter(ch, blockIndex)`** 精确落位。

**主题自适应是第一要求**：搜索面板与正文高亮的底色/字色/强调色全部来自 `resolveTheme(settings.themeId)`（与阅读器、TocSheet 同一套），不写死任何配色。命中高亮 = 当前主题 `accent` 的低透明标记。

## 纯逻辑层（`src/lib/reader/search.ts`）

- `interface HighlightSegment { text: string; match: boolean }`
- `splitHighlight(text: string, term: string): HighlightSegment[]`
  - 大小写不敏感，把 `text` 切成命中/非命中段（左到右、不重叠、保留原文大小写）。`term` 为空 → 返回单个 `{text, match:false}`。结果片段与正文高亮**共用**此函数。
- `makeSearchSnippet(blockText: string, term: string, opts?: { before?: number; after?: number }): string`
  - 以首个命中为中心取窗口（默认 before=12、after=40 字），越界处补 `…`。term 不在则返回 `blockText` 头部（防御）。
- `hexToRgba(hex: string, alpha: number): string`
  - 把 `#rrggbb` 转 `rgba(r,g,b,a)`，供高亮底色 `hexToRgba(theme.accent, 0.22)`（RN 不接受 hex+alpha）。

## 搜索运行器（`src/lib/reader/searchBook.ts`）

- `interface SearchResult { chapterIndex: number; chapterTitle: string; blockIndex: number; snippet: string }`
- `interface SearchOutcome { results: SearchResult[]; capped: boolean }`
- `searchBook(deps: { fs: FileGateway; normalizedPath: string; chapters: ChapterRecord[]; term: string; cap?: number }): Promise<SearchOutcome>`
  - `term.trim()` 为空 → `{ results: [], capped: false }`。
  - 按 `chapters` 顺序：`readChapterText` → `splitBlocks` → 遍历**正文段（blockIndex ≥ 1，跳过标题块）**；段内含 term（大小写不敏感）→ push 一条结果（**每段至多一条**，snippet 以段内首个命中为中心）。章标题另由「章节」页签覆盖，故正文搜索不搜标题块。
  - 累计达 `cap`（默认 300）→ `capped=true`，停止扫描。
  - 一次只驻留一章文本 + 结果数组（≤cap），不整本进内存。注入 `FakeFileGateway` + 播种章节可单测。

## UI · TocSheet 加「全文」页签（`src/reader/TocSheet.tsx`）

- 顶部加 `章节 / 全文` 分段切换（复用现有主题化样式）。
- **章节**页：保持现状（`filterChapters` 按标题过滤 + 点章跳转）。
- **全文**页：搜索框 `onSubmitEditing` 触发（非逐键，因扫描较重）→ 转圈 → 渲染结果列表：每行「章标题 · 高亮片段」，片段用 `splitHighlight(snippet, term)` 渲染，命中段底色 `hexToRgba(theme.accent, 0.22)`。状态：搜索中转圈、无结果「没有找到」、命中超上限「仅显示前 300 条」。点结果 → `onSelectResult(chapterIndex, blockIndex, term)` 后 `onClose`。
- 新增 props（可选，保持 TocSheet 为受控展示组件、不做 I/O）：
  - `onFullTextSearch?: (term: string) => Promise<SearchOutcome>`
  - `onSelectResult?: (chapterIndex: number, blockIndex: number, term: string) => void`

## 阅读页正文高亮（`src/screens/ReaderScreen.tsx`）

- 新增 `highlightTerm: string | null` state。
- `jumpToChapter` 增加第三参 `term: string | null = null`，方法内 `setHighlightTerm(term)`：
  - 上一章/下一章/目录选章/书签回跳都走默认 `term=null` → **清除**高亮。
  - 搜索结果走 `onSelectResult` → `jumpToChapter(ch, block, term)` → 设高亮。
- 正文渲染：body 段在 `highlightTerm` 存在时用 `splitHighlight(item.text, highlightTerm)` 渲染为多个 `<Text>`，命中段 `backgroundColor: hexToRgba(theme.accent, 0.22)`；首行缩进 `　　` 照旧前置。标题块不受影响。
- `onFullTextSearch` 由 reader 提供：`(term) => searchBook({ fs, normalizedPath: book.normalizedPath, chapters, term })`，注入 TocSheet。
- 高亮**持续到下次导航**（读者滚动时保留），符合确认的预期。

## 数据流

```
目录→全文页 输入词 提交
  → onFullTextSearch(term) → searchBook(逐章 readChapterText→splitBlocks→找词, cap 300)
  → 结果列表(splitHighlight 高亮片段)
点结果 → onSelectResult(ch, block, term) → 关闭面板
  → jumpToChapter(ch, block, term): 设 highlightTerm + 增量1 遮罩落位
  → 正文该段 splitHighlight 标色；任何非搜索导航清除 highlightTerm
```

## 测试策略

- **纯逻辑**（严格断言）：`splitHighlight`（多处/无/空词/大小写）、`makeSearchSnippet`（窗口/省略号/短文/未命中）、`hexToRgba`（#rrggbb→rgba、边界）。
- **searchBook**（`FakeFileGateway` 播种多章）：命中章正确的 chapterIndex/blockIndex/snippet；只搜正文段不搜标题；每段至多一条；cap 截断置 `capped`；空词/无命中返回空。
- **组件**（RNTL 13）：TocSheet 切到全文页出现搜索框；注入假 `onFullTextSearch` 提交 → 结果渲染；点结果 → `onSelectResult(ch,block,term)` + 关闭。ReaderScreen：`onSelectResult` → 正文出现命中高亮（`splitHighlight` 段带 accent 底色，用 `toHaveStyle` 断言）；随后普通跳章 → 高亮清除。

## Verify

- 本地：新单测 + 组件测试全绿；`tsc --noEmit` 干净；`expo export --platform ios` 成功。
- 真机：目录→全文→搜词→出结果(高亮片段)→点→落到该段且正文命中词标色；切主题后搜索面板与高亮随之变色；上一章后高亮消失。

## 明确不做（本增量）

- 跨书全局搜索（仅当前书）。
- 正则/通配/分词（仅大小写不敏感子串）。
- 搜索历史、结果内「上一个/下一个」跳转、命中计数徽标。
- 为搜索建持久化倒排索引（逐章即时扫描足够；书库个人规模、按需触发）。
