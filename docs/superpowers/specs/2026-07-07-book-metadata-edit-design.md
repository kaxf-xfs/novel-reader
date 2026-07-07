# 增量 3（缩）· 元数据编辑（书名重命名）— 设计

日期：2026-07-07 · 所属：T8 打磨 / 书籍管理 · 范围：JS-only，全程可走 OTA

## Context（为什么做）

导入时书名由文件名派生（去扩展名 + 去 `《》「」【】`），常常不理想：带站点名、"精校版"、卷号等噪声。用户需要能把书架上的显示书名改成干净的名字。这是书籍管理里**高频、低复杂度**的一项。

书籍管理原计划还含「章节解析手动修正」「编码手动覆盖」两项，均为**导入翻车时的补救安全网**（非高频）。用户选择：自用测试遇到坏书时直接反馈修复，不在 App 内建这两套手动工具。故本增量**只做书名重命名**；另两项记入 `docs/superpowers/backlog.md` 保留可行性分析。

## 关键事实（已勘察）

- `BookRecord` 字段：`id, title, originalName, encoding, sizeBytes, importedAt, coverColor, strategy, normalizedPath`。**无 `author` 字段**——故本增量不做作者编辑（加它需新增列 + 迁移 + 书架展示，超出"重命名"范围）。
- 书架封面由 `src/lib/library/cover.ts` 的 `buildCover(title)` 按**当前标题**渲染 → **重命名后封面自动更新**，无需改 `coverColor`。
- `normalizedPath` 以 `id`（非标题）派生 → 改标题不影响文件与阅读。
- 书架长按当前直接弹 `Alert.alert('删除这本书？', ...)`（`LibraryScreen.tsx:104-119`），三个渲染函数（row/card/hero）都接 `onLongPress={() => handleDelete(item.book)}`。

## 设计

### 存储层
`BookRepository` 新增：`updateBookTitle(bookId: string, title: string): Promise<void>`。
- `InMemoryBookRepository`：取出记录，写回 `{ ...rec, title }`；bookId 不存在则 no-op。
- `SqliteBookRepository`：`UPDATE books SET title = ? WHERE id = ?`（不单测，原生 SQLite 不在 Jest 环境，tsc 保证类型）。

单一方法而非通用 patch：当前只改 title，YAGNI。将来若加作者再扩展。

### 入口 + UI
1. 书架**长按**：把 `handleDelete` 直接弹删除，改为先弹菜单 `Alert.alert(book.title, undefined, [重命名, 删除, 取消])`：
   - 「重命名」→ 打开 `RenameBookModal`（携带该 book）。
   - 「删除」（`style: 'destructive'`）→ **直接执行删除**（`await repo.deleteBook(id); await reload()`）。此菜单里的显式「删除」点按即作为确认，替代原先单独的确认弹窗——仍是一次对话框、一次明确的破坏性点按，不做二级确认。
   - 「取消」（`style: 'cancel'`）。
2. `src/library/RenameBookModal.tsx`（新建，风格参考 `src/settings/ReaderSettingsSheet.tsx` 的 Modal + 主题）：
   - `props: { visible: boolean; book: BookRecord | null; onSave(title: string): void; onClose(): void }`。
   - 一个 `TextInput` 预填 `book.title`，`autoFocus`，`selectTextOnFocus`。
   - 「保存」按钮：`title.trim()` 非空且与原值不同才可点；点击 `onSave(trimmed)` 后关闭。空白或未改 → 禁用。
   - 「取消」关闭不保存。
   - 容器 `testID="rename-modal"`，保存钮 `testID="rename-save"`，输入框 `placeholder="书名"`。
3. `LibraryScreen` 接线：`renamingBook` state；菜单「重命名」→ `setRenamingBook(book)`；`onSave` → `await repo.updateBookTitle(book.id, title); await reload(); setRenamingBook(null)`。

### 数据流
```
长按书 → Alert 菜单 → 重命名 → RenameBookModal(预填) → 保存
  → repo.updateBookTitle(id, trimmedTitle) → reload() → 书架显示新名 + 封面自动重着色
```

### 校验 / 边界
- `title.trim()` 为空 → 禁用保存（不允许空书名）。
- 与原标题相同（trim 后）→ 禁用保存（无操作）。
- bookId 不存在（并发删除）→ repo no-op，reload 后列表自然不含它。

## 测试策略

- **repo 单测**（`src/lib/import/__tests__/repository.test.ts` 追加）：`updateBookTitle` 改标题、其他字段不变、未知 id no-op。
- **组件测试**（`src/screens/__tests__/LibraryScreen.test.tsx`）：注入 InMemory repo + 一本书 → 触发 `RenameBookModal`（可直接渲染 modal 或通过 `onSave` 路径）→ 输入新名 → 保存 → 断言 `repo` 里 title 更新且书架显示新名。因 `Alert.alert` 的菜单按钮回调在 RNTL 下不易驱动，组件测试聚焦 `RenameBookModal` 的输入/保存/禁用逻辑 + `LibraryScreen` 的 `onSave` 接线（重命名后列表刷新）；长按→菜单→选项这一段由真机 verify。
- **Sqlite**：不单测；`tsc --noEmit` 干净。

## Verify

- 本地：新单测 + 组件测试全绿；`tsc --noEmit` 干净；`expo export --platform ios` 成功。
- 真机：长按书 → 菜单 → 重命名 → 改名保存 → 书架显示新名、封面随之变；杀进程重进名字仍在（已持久化）。

## 明确不做（本增量）

- 作者编辑（无字段，暂不加）。
- 章节解析手动修正、编码手动覆盖 → 见 `docs/superpowers/backlog.md`。
- 自定义封面颜色/图片。
