# 增量 1 · 阅读定位（滚动记忆 + 进度条跳转 + 书签）— 设计

日期：2026-07-06 · 所属：T8 打磨 · 范围：JS-only，全程可走 OTA

## Context（为什么做）

阅读器目前只按「章」记忆进度：`ReaderScreen` 的进度保存永远写 `charOffset: 0`，杀进程重进只回到章首。web 小说单章动辄数千字，长章需要重新往下滑找回停留位置——这是当前唯一「功能性缺陷」级别的缺口。

同时缺两个长篇导航常用能力：**全书快速跳转**（现在只能一章一章点「下一章」或翻目录）与**书签**（标记位置回看）。这三者都建立在同一个「章内定位」能力上，因此合并为一个增量一次做完。

约束：不能引入新原生依赖（ipa 已固定，只能 OTA JS）。这排除了 `@react-native-community/slider`（原生），进度条必须用 RN 内置 `PanResponder` 自绘。

## 共享锚点模型

定位锚点统一为 `(chapterIndex, blockIndex)`：

- `blockIndex` = 段落在**章内**的序号。阅读器已把每章 `splitBlocks()` 成段落级 `FlatBlockItem`，key 为 `${chapterIndex}-${blockIndex}`（index 0 是标题块）。`splitBlocks` 对同一章文本确定性输出，故 blockIndex 跨会话稳定。
- 复用现有 `ProgressRecord.charOffset`（INTEGER，此前恒为 0）承载 blockIndex，语义更新为「章内段落序号」。**无 sqlite 迁移**。相关注释同步更新。

## 组件一 · 章内滚动记忆

**保存**（改 `onViewableItemsChanged`）：
- 已有逻辑取顶部可见 block。从其 key 解析 blockIndex（`key.slice(key.indexOf('-') + 1)` → number；或直接在 `FlatBlockItem` 上新增 `blockIndex` 字段，见下）。
- 在 `FlatBlockItem` 增加 `blockIndex: number` 字段（`loadChapterBlocks` 里 `i` 已在手），避免解析 key 字符串。
- 保存 `{ bookId, chapterIndex, charOffset: blockIndex, updatedAt }`，沿用现有 800ms debounce。
- `jumpToChapter` 保存时 `charOffset: 0`（跳章即回到该章开头，符合直觉）。

**恢复**（改 `init()`）：
- 读到 `progress.charOffset`（= 目标 blockIndex）。建好初始窗口后，若 blockIndex > 0，在 `blocks` 数组中 `findIndex` 出 `chapterIndex === startIndex && blockIndex === 目标` 的数组下标，`listRef.scrollToIndex({ index, animated: false })`。
- 变高文本无 `getItemLayout`，首帧目标项可能未测量 → 提供 `onScrollToIndexFailed`：按 `info.averageItemLength * info.index` 先 `scrollToOffset`，再 `setTimeout(0)` 重试 `scrollToIndex`（RN 官方推荐兜底）。
- 恢复只在初始加载做一次，用一个 `pendingRestoreRef` 标记，避免与用户滚动打架。

**纯逻辑抽取（便于 TDD）**：
- `src/lib/reader/restore.ts`：`findBlockArrayIndex(blocks, chapterIndex, blockIndex): number`（找不到返回 -1）。
- `parseBlockIndex` 若走 key 解析亦抽为纯函数并单测；采用字段方案则测 `loadChapterBlocks` 产出的 `blockIndex` 递增正确。

## 组件二 · 进度条拖动跳转

- 底栏中间的 `进度%` 文本改为可点击 → 打开 `ProgressJumpSheet`（底部小浮层）。
- 浮层内一条自绘轨道 + 拇指，用 **`PanResponder`（RN 内置，纯 JS）** 驱动：拖动时 `fraction = clamp((gestureX - trackLeft) / trackWidth, 0, 1)`，`targetIndex = round(fraction * (total - 1))`，实时预览 `chapters[targetIndex].title`；松手 `onRelease(targetIndex)` → `jumpToChapter`，关闭浮层。
- **纯逻辑抽取**：`src/lib/reader/seek.ts`：`fractionToChapterIndex(fraction, total)` 与 `chapterIndexToFraction(index, total)`，边界 clamp、空书/单章处理，单测覆盖。浮层组件只做手势→fraction 与渲染。
- 轨道尺寸用 `onLayout` 拿 `trackWidth`，避免写死。

## 组件三 · 书签

**存储**（`BookRepository` 扩展 + 两个实现）：
- 新表 `bookmarks(id TEXT PK, bookId TEXT, chapterIndex INT, blockIndex INT, snippet TEXT, createdAt INT)`，`CREATE TABLE IF NOT EXISTS`——纯增量、安全。
- 接口新增：`addBookmark(b)`, `listBookmarks(bookId): Bookmark[]`（按 createdAt desc）, `deleteBookmark(id)`。`InMemoryBookRepository` 与 `SqliteBookRepository` 均实现；`deleteBook` 连带删除该书书签。
- `snippet`：当前顶部段文本前 ~40 字（去标题块；标题块则取其后首个正文段），供列表展示。抽 `makeSnippet(text, max=40)` 纯函数并单测。

**UI**：
- 底栏新增「书签」按钮：加当前顶部可见位置为书签（chapterIndex + blockIndex + snippet）。加成功给轻量视觉反馈（按钮态/短暂文案切换，不引原生 haptics/toast）。
- 书签列表复用 TocSheet 式全屏 modal（`BookmarksSheet`）：每行显示章标题 + snippet + 相对时间，点击 `jumpToChapter` 后 `scrollToIndex` 到该 block（复用组件一的定位逻辑），左侧/尾部提供删除。空态给一行提示。

## 数据流

```
滚动 → onViewableItemsChanged → (chapterIndex, blockIndex) → debounce → saveProgress(charOffset=blockIndex)
启动 → getProgress → loadWindow(startIndex) → findBlockArrayIndex → scrollToIndex(+onScrollToIndexFailed 兜底)
跳转 → ProgressJumpSheet(PanResponder) → fractionToChapterIndex → jumpToChapter
书签 → addBookmark(当前锚点+snippet) ; BookmarksSheet → jumpToChapter + scrollToIndex
```

## 测试策略（TDD）

纯逻辑 Jest 严格断言：
- `restore.findBlockArrayIndex`：命中/未命中/跨章窗口。
- `seek.fractionToChapterIndex` / `chapterIndexToFraction`：0/1 边界、单章、往返一致。
- `makeSnippet`：截断、去空白、短文本原样、标题块跳过。
- repository 书签 CRUD：增/列表序/删/随书删除（`InMemory` 与 `Sqlite` 各一套，复用现有 repository.test 结构）。

组件/集成（RNTL 13，复用 `renderWithSettings` + `seedReader`）：
- 播种 progress `charOffset>0` → 渲染后断言发生 `scrollToIndex`（spy `listRef` 或断言目标 block 可见路径）。
- 点「进度%」→ 出现跳转浮层；模拟 PanResponder 释放到某 fraction → `jumpToChapter` 被调用且落在预期章（用 seek 纯函数边界值驱动）。
- 点「书签」→ `addBookmark` 被调用且参数为当前锚点；打开 `BookmarksSheet` 列出，点击跳转关闭。

## Verify

- 本地：新单测 + 组件测试全绿；`tsc --noEmit` 干净；`expo export --platform ios` 成功。
- CI 门禁：push 前 verify 全绿才发 OTA。
- 手动（真机）：长章滑到中部→杀进程→重进回到原段；拖进度条到 80% 跳转正确；加书签→书签列表→跳回原位。

## 明确不做（本增量）

- 像素级精确恢复（改字号后逐字对齐）：段级恢复已足够，不追求像素。
- 跨设备同步书签/进度：本地 sqlite 即可。
- 全文搜索、书籍管理：分属增量 2 / 3。
- 原生能力（haptics、原生 slider）：OTA 约束下不引入。
