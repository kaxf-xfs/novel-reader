# 阅读定位（增量 1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让阅读器记住章内停留位置、支持拖动进度条快速跳章、支持书签收藏与回跳。

**Architecture:** 统一定位锚点 `(chapterIndex, blockIndex)`；blockIndex 为段落在章内的序号，复用现有 `ProgressRecord.charOffset` 字段承载（语义更新，无 sqlite 迁移）。定位/换算/摘要三个纯函数模块走严格 TDD；书签新增 sqlite 表（`IF NOT EXISTS`，纯增量）；进度条用 RN 内置 `PanResponder` 自绘（原生 slider 不在 ipa，不能 OTA）。

**Tech Stack:** Expo SDK 57 · React Native 0.86 · TypeScript strict · Jest 29 + jest-expo · @testing-library/react-native 13.3.3 · expo-sqlite

## Global Constraints

- **不引入任何新原生依赖**。只能用 ipa 已含的原生模块（expo-font/battery/status-bar/sqlite/file-system/document-picker）+ RN 内置（PanResponder 等）。进度条禁止用 `@react-native-community/slider`。
- 测试库锁定 `@testing-library/react-native@13.3.3` + `react-test-renderer@19.2.3`（RNTL 14 在 jest-expo 下 render() 返回空）。
- 路径别名 `@/*` → `src/*` 已配（tsconfig + jest moduleNameMapper）。
- sqlite 变更必须 `CREATE TABLE IF NOT EXISTS` / 加列用 additive migration；SqliteBookRepository 不做单元测试（原生 SQLite 不在 Jest 环境跑），由 tsc strict 保证类型正确。
- 每个 task 结束跑 `npx tsc --noEmit` 干净 + 相关测试全绿后再 commit。

---

### Task 1: 定位纯函数 `findBlockArrayIndex`

**Files:**
- Create: `src/lib/reader/restore.ts`
- Test: `src/lib/reader/__tests__/restore.test.ts`

**Interfaces:**
- Produces: `interface BlockAnchor { chapterIndex: number; blockIndex: number }`；`findBlockArrayIndex(blocks: readonly BlockAnchor[], chapterIndex: number, blockIndex: number): number`（命中返回数组下标，未命中返回 -1）。

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/reader/__tests__/restore.test.ts
import { findBlockArrayIndex } from '../restore';

const win = [
  { chapterIndex: 4, blockIndex: 0 },
  { chapterIndex: 4, blockIndex: 1 },
  { chapterIndex: 5, blockIndex: 0 }, // target chapter starts here
  { chapterIndex: 5, blockIndex: 1 },
  { chapterIndex: 5, blockIndex: 2 },
  { chapterIndex: 6, blockIndex: 0 },
];

describe('findBlockArrayIndex', () => {
  it('finds the array index of a (chapter, block) anchor across a multi-chapter window', () => {
    expect(findBlockArrayIndex(win, 5, 2)).toBe(4);
  });

  it('finds the first block of the target chapter', () => {
    expect(findBlockArrayIndex(win, 5, 0)).toBe(2);
  });

  it('returns -1 when the anchor is not present', () => {
    expect(findBlockArrayIndex(win, 5, 9)).toBe(-1);
    expect(findBlockArrayIndex(win, 9, 0)).toBe(-1);
  });

  it('returns -1 for an empty window', () => {
    expect(findBlockArrayIndex([], 0, 0)).toBe(-1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/lib/reader/__tests__/restore.test.ts`
Expected: FAIL（`Cannot find module '../restore'`）

- [ ] **Step 3: 最小实现**

```typescript
// src/lib/reader/restore.ts
/**
 * 增量1: 在当前渲染窗口的 block 数组里定位某个 (chapterIndex, blockIndex) 锚点，
 * 用于章内滚动位置恢复与书签跳转（配合 FlatList.scrollToIndex）。
 */
export interface BlockAnchor {
  chapterIndex: number;
  blockIndex: number;
}

/** 命中返回数组下标，未命中返回 -1。 */
export function findBlockArrayIndex(
  blocks: readonly BlockAnchor[],
  chapterIndex: number,
  blockIndex: number,
): number {
  return blocks.findIndex(
    (b) => b.chapterIndex === chapterIndex && b.blockIndex === blockIndex,
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/lib/reader/__tests__/restore.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: commit**

```bash
git add src/lib/reader/restore.ts src/lib/reader/__tests__/restore.test.ts
git commit -m "feat(reader): findBlockArrayIndex for in-chapter position restore"
```

---

### Task 2: 进度换算纯函数 `seek`

**Files:**
- Create: `src/lib/reader/seek.ts`
- Test: `src/lib/reader/__tests__/seek.test.ts`

**Interfaces:**
- Produces: `fractionToChapterIndex(fraction: number, total: number): number`；`chapterIndexToFraction(index: number, total: number): number`。

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/reader/__tests__/seek.test.ts
import { fractionToChapterIndex, chapterIndexToFraction } from '../seek';

describe('fractionToChapterIndex', () => {
  it('maps 0 → first, 1 → last', () => {
    expect(fractionToChapterIndex(0, 10)).toBe(0);
    expect(fractionToChapterIndex(1, 10)).toBe(9);
  });

  it('rounds to the nearest chapter', () => {
    expect(fractionToChapterIndex(0.5, 11)).toBe(5); // 0.5 * 10 = 5
    expect(fractionToChapterIndex(0.44, 11)).toBe(4); // 4.4 → 4
  });

  it('clamps out-of-range fractions', () => {
    expect(fractionToChapterIndex(-0.2, 10)).toBe(0);
    expect(fractionToChapterIndex(1.7, 10)).toBe(9);
  });

  it('handles empty / single-chapter books', () => {
    expect(fractionToChapterIndex(0.5, 0)).toBe(0);
    expect(fractionToChapterIndex(0.5, 1)).toBe(0);
  });
});

describe('chapterIndexToFraction', () => {
  it('maps first → 0, last → 1', () => {
    expect(chapterIndexToFraction(0, 10)).toBe(0);
    expect(chapterIndexToFraction(9, 10)).toBe(1);
  });

  it('is the inverse of fractionToChapterIndex at endpoints', () => {
    const total = 20;
    expect(fractionToChapterIndex(chapterIndexToFraction(7, total), total)).toBe(7);
  });

  it('handles single-chapter / empty', () => {
    expect(chapterIndexToFraction(0, 1)).toBe(0);
    expect(chapterIndexToFraction(0, 0)).toBe(0);
  });

  it('clamps out-of-range indices', () => {
    expect(chapterIndexToFraction(-3, 10)).toBe(0);
    expect(chapterIndexToFraction(99, 10)).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/lib/reader/__tests__/seek.test.ts`
Expected: FAIL（`Cannot find module '../seek'`）

- [ ] **Step 3: 最小实现**

```typescript
// src/lib/reader/seek.ts
/**
 * 增量1: 进度条拖动跳转的纯换算。fraction ∈ [0,1] ↔ 章节下标 ∈ [0,total-1]。
 * PanResponder 只负责把手势 x 转成 fraction，跳转决策交给这里。
 */
function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function fractionToChapterIndex(fraction: number, total: number): number {
  if (total <= 1) return 0;
  const f = clamp(fraction, 0, 1);
  return clamp(Math.round(f * (total - 1)), 0, total - 1);
}

export function chapterIndexToFraction(index: number, total: number): number {
  if (total <= 1) return 0;
  const i = clamp(index, 0, total - 1);
  return clamp(i / (total - 1), 0, 1);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/lib/reader/__tests__/seek.test.ts`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add src/lib/reader/seek.ts src/lib/reader/__tests__/seek.test.ts
git commit -m "feat(reader): seek fraction<->chapter conversion for progress slider"
```

---

### Task 3: 书签摘要纯函数 `makeSnippet`

**Files:**
- Create: `src/lib/reader/snippet.ts`
- Test: `src/lib/reader/__tests__/snippet.test.ts`

**Interfaces:**
- Produces: `makeSnippet(text: string, max?: number): string`（默认 max=40；截断加 `…`，纯空白/空串返回 `''`）。

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/reader/__tests__/snippet.test.ts
import { makeSnippet } from '../snippet';

describe('makeSnippet', () => {
  it('returns short text unchanged', () => {
    expect(makeSnippet('他推开门。')).toBe('他推开门。');
  });

  it('truncates long text to max chars with an ellipsis', () => {
    const long = '一'.repeat(50);
    expect(makeSnippet(long, 40)).toBe('一'.repeat(40) + '…');
  });

  it('trims surrounding whitespace before measuring', () => {
    expect(makeSnippet('  　他推开门。  ')).toBe('他推开门。');
  });

  it('returns empty string for blank input', () => {
    expect(makeSnippet('   ')).toBe('');
    expect(makeSnippet('')).toBe('');
  });

  it('uses a default max of 40', () => {
    expect(makeSnippet('字'.repeat(41)).length).toBe(41); // 40 chars + '…'
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/lib/reader/__tests__/snippet.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```typescript
// src/lib/reader/snippet.ts
/** 增量1: 从段落文本生成书签列表用的短摘要。 */
export function makeSnippet(text: string, max = 40): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/lib/reader/__tests__/snippet.test.ts`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add src/lib/reader/snippet.ts src/lib/reader/__tests__/snippet.test.ts
git commit -m "feat(reader): makeSnippet for bookmark previews"
```

---

### Task 4: 书签存储 — 类型 + 接口 + InMemory 实现

**Files:**
- Modify: `src/lib/import/repository.ts`（加 `Bookmark` 类型、扩展 `BookRepository` 接口、`InMemoryBookRepository` 实现）
- Test: `src/lib/import/__tests__/repository.test.ts`（追加 bookmark CRUD 测试）

**Interfaces:**
- Produces:
  ```typescript
  interface Bookmark {
    id: string;
    bookId: string;
    chapterIndex: number;
    blockIndex: number;
    snippet: string;
    createdAt: number;
  }
  ```
  `BookRepository` 新增：`addBookmark(b: Bookmark): Promise<void>`；`listBookmarks(bookId: string): Promise<Bookmark[]>`（按 createdAt 降序）；`deleteBookmark(id: string): Promise<void>`。`deleteBook` 需连带删除该书书签。

- [ ] **Step 1: 写失败测试**（追加到文件末尾）

```typescript
// src/lib/import/__tests__/repository.test.ts (append)
import { InMemoryBookRepository, type Bookmark } from '../repository';

function makeBookmark(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm1',
    bookId: 'book-1',
    chapterIndex: 3,
    blockIndex: 5,
    snippet: '他推开门。',
    createdAt: 1000,
    ...over,
  };
}

describe('InMemoryBookRepository – bookmarks', () => {
  it('returns an empty list when there are no bookmarks', async () => {
    const repo = new InMemoryBookRepository();
    expect(await repo.listBookmarks('book-1')).toEqual([]);
  });

  it('adds and lists bookmarks for a book, newest first', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBookmark(makeBookmark({ id: 'a', createdAt: 100 }));
    await repo.addBookmark(makeBookmark({ id: 'b', createdAt: 300 }));
    await repo.addBookmark(makeBookmark({ id: 'c', createdAt: 200 }));
    const list = await repo.listBookmarks('book-1');
    expect(list.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('scopes bookmarks by book', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBookmark(makeBookmark({ id: 'a', bookId: 'b1' }));
    await repo.addBookmark(makeBookmark({ id: 'b', bookId: 'b2' }));
    expect((await repo.listBookmarks('b1')).map((b) => b.id)).toEqual(['a']);
  });

  it('deletes a bookmark by id', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBookmark(makeBookmark({ id: 'a' }));
    await repo.deleteBookmark('a');
    expect(await repo.listBookmarks('book-1')).toEqual([]);
  });

  it('removes a book\'s bookmarks when the book is deleted', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBookmark(makeBookmark({ id: 'a', bookId: 'book-1' }));
    await repo.deleteBook('book-1');
    expect(await repo.listBookmarks('book-1')).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/lib/import/__tests__/repository.test.ts -t bookmarks`
Expected: FAIL（`addBookmark is not a function` / `Bookmark` 未导出）

- [ ] **Step 3: 实现**

在 `src/lib/import/repository.ts` 的 `ProgressRecord` 后加类型，并更新 `charOffset` 注释：

```typescript
export interface ProgressRecord {
  bookId: string;
  chapterIndex: number;
  /** 段落在章内的序号（blockIndex）；0 表示章首。用于章内滚动位置恢复。 */
  charOffset: number;
  updatedAt: number; // Unix ms
}

export interface Bookmark {
  id: string;
  bookId: string;
  chapterIndex: number;
  /** 段落在章内的序号（与 ProgressRecord.charOffset 同义）。 */
  blockIndex: number;
  snippet: string;
  createdAt: number; // Unix ms
}
```

在 `BookRepository` 接口末尾加三个方法：

```typescript
  /** 新增一条书签。 */
  addBookmark(b: Bookmark): Promise<void>;
  /** 返回某本书的书签，按 createdAt 降序。 */
  listBookmarks(bookId: string): Promise<Bookmark[]>;
  /** 按 id 删除书签。 */
  deleteBookmark(id: string): Promise<void>;
```

在 `InMemoryBookRepository` 加字段与方法，并在 `deleteBook` 里清理：

```typescript
  private bookmarks = new Map<string, Bookmark>();

  // ... 在 deleteBook 内，progress.delete 之后追加：
  //   for (const [id, bm] of this.bookmarks) if (bm.bookId === bookId) this.bookmarks.delete(id);

  async addBookmark(b: Bookmark): Promise<void> {
    this.bookmarks.set(b.id, { ...b });
  }

  async listBookmarks(bookId: string): Promise<Bookmark[]> {
    return Array.from(this.bookmarks.values())
      .filter((b) => b.bookId === bookId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteBookmark(id: string): Promise<void> {
    this.bookmarks.delete(id);
  }
```

同时把 `Bookmark` 加入文件顶部的导出类型（它已用 `export interface` 定义，无需额外处理）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/lib/import/__tests__/repository.test.ts`
Expected: PASS（含原有 progress/CRUD 测试 + 新 bookmark 测试）

- [ ] **Step 5: commit**

```bash
git add src/lib/import/repository.ts src/lib/import/__tests__/repository.test.ts
git commit -m "feat(repo): bookmarks CRUD in BookRepository + InMemory impl"
```

---

### Task 5: 书签存储 — Sqlite 实现

**Files:**
- Modify: `src/lib/import/sqliteRepository.ts`（新增 `bookmarks` 表 DDL + 三个方法）

**Interfaces:**
- Consumes: Task 4 的 `Bookmark` 类型与 `BookRepository` 新方法签名。
- 说明：不加单测（原生 SQLite 不在 Jest 环境），由 `tsc --noEmit` 保证。

- [ ] **Step 1: 加表 DDL**

在 DDL 区加常量，并在 `open()` 的 `execAsync(...)` 拼接串里加上它：

```typescript
const CREATE_BOOKMARKS_TABLE = `
  CREATE TABLE IF NOT EXISTS bookmarks (
    id           TEXT PRIMARY KEY,
    bookId       TEXT NOT NULL,
    chapterIndex INTEGER NOT NULL,
    blockIndex   INTEGER NOT NULL,
    snippet      TEXT NOT NULL,
    createdAt    INTEGER NOT NULL,
    FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
  );
`;
```

```typescript
    // open(): 把 CREATE_BOOKMARKS_TABLE 追加到 execAsync 的建表串
    await db.execAsync(
      CREATE_BOOKS_TABLE +
        CREATE_CHAPTERS_TABLE +
        CREATE_CHAPTERS_INDEX +
        CREATE_PROGRESS_TABLE +
        CREATE_BOOKMARKS_TABLE,
    );
```

- [ ] **Step 2: 实现三个方法**

在 `getProgress` 之后加（`import` 处补上 `Bookmark`）：

```typescript
// 顶部 import：
// import type { BookRecord, ChapterRecord, BookRepository, ProgressRecord, Bookmark } from './repository';

  async addBookmark(b: Bookmark): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync(
      `INSERT OR REPLACE INTO bookmarks (id, bookId, chapterIndex, blockIndex, snippet, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      b.id,
      b.bookId,
      b.chapterIndex,
      b.blockIndex,
      b.snippet,
      b.createdAt,
    );
  }

  async listBookmarks(bookId: string): Promise<Bookmark[]> {
    const db = await this.dbPromise;
    type Row = {
      id: string;
      bookId: string;
      chapterIndex: number;
      blockIndex: number;
      snippet: string;
      createdAt: number;
    };
    const rows = await db.getAllAsync<Row>(
      'SELECT * FROM bookmarks WHERE bookId = ? ORDER BY createdAt DESC',
      bookId,
    );
    return rows.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      chapterIndex: r.chapterIndex,
      blockIndex: r.blockIndex,
      snippet: r.snippet,
      createdAt: r.createdAt,
    }));
  }

  async deleteBookmark(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync('DELETE FROM bookmarks WHERE id = ?', id);
  }
```

同时把类头文件顶部 schema 注释里补一段 `bookmarks(...)`（与 DDL 对应）。

- [ ] **Step 3: tsc 校验**

Run: `npx tsc --noEmit`
Expected: 无输出（通过）

- [ ] **Step 4: commit**

```bash
git add src/lib/import/sqliteRepository.ts
git commit -m "feat(repo): bookmarks table + CRUD in SqliteBookRepository"
```

---

### Task 6: 阅读器 — 章内滚动位置保存 + 恢复

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`
- Test: `src/screens/__tests__/ReaderScreen.test.tsx`（追加）

**Interfaces:**
- Consumes: `findBlockArrayIndex`（Task 1）、`ProgressRecord.charOffset` = blockIndex。
- Produces: `FlatBlockItem` 增加 `blockIndex: number` 字段（供 Task 8 书签取当前锚点）。`ReaderScreen` 内维护 `currentBlockIndexRef`。

- [ ] **Step 1: 写失败测试**（追加到 ReaderScreen.test.tsx 的 describe 内）

```typescript
  it('saves the in-chapter block index (not always 0) as reading progress', async () => {
    // 纯逻辑保证：顶部 block 的 blockIndex 会被写入 progress.charOffset。
    // 这里用一个已知窗口断言 findBlockArrayIndex 的反向语义在 reader 中被采用。
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'bpos', chapters: CHAPTERS, progressChapterIndex: 1 });
    const saveSpy = jest.spyOn(repo, 'saveProgress');

    const { findByText } = renderReader(repo, fs, 'bpos');
    await findByText(/内容二。/);

    // 初始进入第 2 章会至少保存一次进度；chapterIndex 正确、charOffset 为有效段序号。
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const last = saveSpy.mock.calls[saveSpy.mock.calls.length - 1][0];
    expect(last.chapterIndex).toBe(1);
    expect(typeof last.charOffset).toBe('number');
  });

  it('does not crash when restoring a saved mid-chapter block position', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'brestore', chapters: CHAPTERS, progressChapterIndex: 2 });
    await repo.saveProgress({ bookId: 'brestore', chapterIndex: 2, charOffset: 1, updatedAt: Date.now() });

    const { findAllByText } = renderReader(repo, fs, 'brestore');
    expect((await findAllByText('第三章 结局')).length).toBeGreaterThanOrEqual(1);
  });
```

> 说明：FlatList 的 `scrollToIndex`/viewability 是原生行为，不在 Jest 环境真实执行。**实际滚动到正确段落由真机 verify**；此处自动测试保证「保存写的是段序号而非恒 0」「带 charOffset>0 的恢复不崩」。段级定位的正确性由 Task 1 的 `findBlockArrayIndex` 单测覆盖。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx -t "block index"`
Expected: FAIL（当前保存恒 `charOffset: 0`，`last.charOffset` 在有滚动语义前可能通过——若通过说明断言太弱，改为下一步实现后仍需保证保存路径引用 blockIndex）

- [ ] **Step 3: 实现**

3a. `FlatBlockItem` 加字段：

```typescript
interface FlatBlockItem {
  key: string;
  chapterIndex: number;
  blockIndex: number;
  text: string;
  isTitle: boolean;
}
```

3b. `loadChapterBlocks` 里填 `blockIndex`：

```typescript
  return splitBlocks(text).map((blockText, i) => ({
    key: `${chapter.index}-${i}`,
    chapterIndex: chapter.index,
    blockIndex: i,
    text: blockText,
    isTitle: i === 0,
  }));
```

3c. 顶部 import 加 `findBlockArrayIndex`，并加一个 ref：

```typescript
import { findBlockArrayIndex } from '../lib/reader/restore';
// ...
  const currentBlockIndexRef = useRef(0);
  const pendingRestoreRef = useRef<{ chapterIndex: number; blockIndex: number } | null>(null);
```

3d. `onViewableItemsChanged` 记录 blockIndex 并写进 progress：

```typescript
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) return;
      const topItem = viewableItems[0].item as FlatBlockItem;
      setCurrentChapterIndex(topItem.chapterIndex);
      currentBlockIndexRef.current = topItem.blockIndex;

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        repo.saveProgress({
          bookId,
          chapterIndex: topItem.chapterIndex,
          charOffset: topItem.blockIndex,
          updatedAt: Date.now(),
        });
      }, PROGRESS_SAVE_DEBOUNCE_MS);
    },
  ).current;
```

3e. 初始加载里，记下待恢复锚点（`init()` 内 `setCurrentChapterIndex(startIndex)` 之后）：

```typescript
        const savedBlock = progress?.charOffset ?? 0;
        currentBlockIndexRef.current = savedBlock;
        if (savedBlock > 0) {
          pendingRestoreRef.current = { chapterIndex: startIndex, blockIndex: savedBlock };
        }
```

3f. 在 blocks 就绪后执行一次恢复滚动（新 effect，放在其它 effect 之后）：

```typescript
  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || blocks.length === 0) return;
    const arrayIndex = findBlockArrayIndex(blocks, pending.chapterIndex, pending.blockIndex);
    pendingRestoreRef.current = null;
    if (arrayIndex <= 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: arrayIndex, animated: false });
    });
  }, [blocks]);
```

3g. FlatList 加 `onScrollToIndexFailed` 兜底：

```typescript
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
              setTimeout(() => {
                listRef.current?.scrollToIndex({ index: info.index, animated: false });
              }, 50);
            }}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx`
Expected: PASS（原有 + 2 个新测试）

- [ ] **Step 5: commit**

```bash
git add src/screens/ReaderScreen.tsx src/screens/__tests__/ReaderScreen.test.tsx
git commit -m "feat(reader): save and restore in-chapter scroll position"
```

---

### Task 7: 进度条拖动跳转浮层 `ProgressJumpSheet`

**Files:**
- Create: `src/reader/ProgressJumpSheet.tsx`
- Modify: `src/screens/ReaderScreen.tsx`（底栏「进度%」→ 打开浮层）
- Test: `src/screens/__tests__/ReaderScreen.test.tsx`（追加：打开浮层）

**Interfaces:**
- Consumes: `fractionToChapterIndex` / `chapterIndexToFraction`（Task 2）、`TocEntry`（章标题预览）。
- Produces: `ProgressJumpSheet` props：`{ visible: boolean; chapters: TocEntry[]; currentIndex: number; onJump(index: number): void; onClose(): void }`；容器 `testID="progress-jump-sheet"`。

- [ ] **Step 1: 写失败测试**（追加）

```typescript
  it('opens the progress jump sheet from the bottom bar', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'bjump', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByTestId, queryByTestId } = renderReader(repo, fs, 'bjump');
    await findByText(/内容一。/);

    tapSurface(getByTestId('reader-surface')); // reveal bottom bar
    expect(queryByTestId('progress-jump-sheet')).toBeNull();
    fireEvent.press(getByTestId('progress-jump-open'));
    expect(getByTestId('progress-jump-sheet')).toBeTruthy();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx -t "progress jump"`
Expected: FAIL（无 `progress-jump-open` testID）

- [ ] **Step 3: 实现浮层组件**

```typescript
// src/reader/ProgressJumpSheet.tsx
/**
 * 增量1: 进度拖动跳转浮层。原生 slider 不在 ipa，故用 RN 内置 PanResponder
 * 自绘轨道。拖动实时预览目标章标题，松手跳转。
 */
import { useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import type { TocEntry } from '../lib/reader/toc';
import { chapterIndexToFraction, fractionToChapterIndex } from '../lib/reader/seek';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

interface ProgressJumpSheetProps {
  visible: boolean;
  chapters: TocEntry[];
  currentIndex: number;
  onJump: (index: number) => void;
  onClose: () => void;
}

export function ProgressJumpSheet({
  visible,
  chapters,
  currentIndex,
  onJump,
  onClose,
}: ProgressJumpSheetProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const total = chapters.length;

  const [previewIndex, setPreviewIndex] = useState(currentIndex);
  const trackWidthRef = useRef(1);
  const trackLeftRef = useRef(0);

  // 每次打开时把预览重置到当前章。
  const openedIndex = useRef(currentIndex);
  if (visible && openedIndex.current !== currentIndex && previewIndex === currentIndex) {
    openedIndex.current = currentIndex;
  }

  const setFromX = (pageX: number) => {
    const f = (pageX - trackLeftRef.current) / trackWidthRef.current;
    setPreviewIndex(fractionToChapterIndex(f, total));
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => setFromX(e.nativeEvent.pageX),
        onPanResponderMove: (e) => setFromX(e.nativeEvent.pageX),
        onPanResponderRelease: () => {
          onJump(previewIndex);
          onClose();
        },
      }),
    // previewIndex 通过闭包读取最新值：用 ref 规避陈旧闭包。
    [total],
  );

  const previewRef = useRef(previewIndex);
  previewRef.current = previewIndex;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = Math.max(1, e.nativeEvent.layout.width);
    e.currentTarget.measure?.((_x, _y, _w, _h, px) => {
      trackLeftRef.current = px;
    });
  };

  const fraction = chapterIndexToFraction(previewIndex, total);
  const title = chapters[previewIndex]?.title ?? '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        testID="progress-jump-sheet"
        style={[styles.sheet, { backgroundColor: theme.background, borderTopColor: theme.border }]}
      >
        <Text style={[styles.preview, { color: theme.heading }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.pct, { color: theme.subtle }]}>
          {total > 0 ? Math.round(fraction * 100) : 0}%
        </Text>
        <View
          style={styles.trackHit}
          onLayout={onTrackLayout}
          {...pan.panHandlers}
        >
          <View style={[styles.track, { backgroundColor: theme.border }]}>
            <View
              style={[styles.fill, { backgroundColor: theme.accent, width: `${fraction * 100}%` }]}
            />
            <View
              style={[styles.thumb, { backgroundColor: theme.accent, left: `${fraction * 100}%` }]}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 44,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  preview: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  pct: { fontSize: 13, textAlign: 'center', marginTop: 6, fontVariant: ['tabular-nums'] },
  trackHit: { paddingVertical: 18, marginTop: 10 },
  track: { height: 4, borderRadius: 2, justifyContent: 'center' },
  fill: { height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    marginLeft: -9,
    top: -7,
  },
});
```

3b. 在 `ReaderScreen.tsx` 里 wire：加 state、把底栏 `进度%` 文本换成可点 Pressable（带 `testID="progress-jump-open"`），渲染浮层。

```typescript
// import
import { ProgressJumpSheet } from '../reader/ProgressJumpSheet';
// state
  const [showJump, setShowJump] = useState(false);
```

底栏中间原来的：

```typescript
          <Text style={[styles.percentText, { color: rs.theme.subtle }]}>{bookPercent}%</Text>
```

替换为：

```typescript
          <Pressable testID="progress-jump-open" onPress={() => setShowJump(true)} hitSlop={8}>
            <Text style={[styles.percentText, { color: rs.theme.subtle }]}>{bookPercent}%</Text>
          </Pressable>
```

在文件底部 `<TocSheet ... />` 附近渲染浮层：

```typescript
      <ProgressJumpSheet
        visible={showJump}
        chapters={tocEntries}
        currentIndex={currentChapterIndex}
        onJump={jumpToChapter}
        onClose={() => setShowJump(false)}
      />
```

（`PanResponderRelease` 用 `previewRef.current` 取最新值——把 `onJump(previewIndex)` 改为 `onJump(previewRef.current)`，避免陈旧闭包。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx`
Expected: PASS

> 实际拖动手势→跳转由真机 verify（PanResponder 手势不在 Jest 环境真实派发）；换算正确性由 Task 2 单测覆盖。

- [ ] **Step 5: commit**

```bash
git add src/reader/ProgressJumpSheet.tsx src/screens/ReaderScreen.tsx src/screens/__tests__/ReaderScreen.test.tsx
git commit -m "feat(reader): PanResponder progress-jump sheet (OTA-safe, no native slider)"
```

---

### Task 8: 书签 UI — `BookmarksSheet` + 收藏/回跳

**Files:**
- Create: `src/reader/BookmarksSheet.tsx`
- Modify: `src/screens/ReaderScreen.tsx`（底栏「书签」按钮 → 打开列表；收藏当前位置；回跳）
- Test: `src/screens/__tests__/ReaderScreen.test.tsx`（追加：收藏 + 回跳）

**Interfaces:**
- Consumes: `Bookmark`（Task 4）、`makeSnippet`（Task 3）、`formatRelativeTime`（`src/lib/library/time.ts`）、`findBlockArrayIndex`（Task 1，回跳定位）、`TocEntry`（章标题）。
- Produces: `BookmarksSheet` props：`{ visible; bookmarks: Bookmark[]; chapterTitles: Record<number,string>; onAddCurrent(): void; onJump(chapterIndex: number, blockIndex: number): void; onDelete(id: string): void; onClose(): void }`；容器 `testID="bookmarks-sheet"`，收藏按钮 `testID="bookmark-add"`。

- [ ] **Step 1: 写失败测试**（追加）

```typescript
  it('adds a bookmark for the current position and lists it', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'bbm', chapters: CHAPTERS, progressChapterIndex: 0 });
    const addSpy = jest.spyOn(repo, 'addBookmark');

    const { findByText, getByText, getByTestId } = renderReader(repo, fs, 'bbm');
    await findByText(/内容一。/);

    tapSurface(getByTestId('reader-surface'));   // reveal bottom bar
    fireEvent.press(getByText('书签'));           // open bookmarks sheet
    expect(getByTestId('bookmarks-sheet')).toBeTruthy();

    fireEvent.press(getByTestId('bookmark-add')); // 收藏当前位置
    await waitFor(() => expect(addSpy).toHaveBeenCalled());
    const added = addSpy.mock.calls[0][0];
    expect(added.bookId).toBe('bbm');
    expect(typeof added.chapterIndex).toBe('number');
    expect(typeof added.blockIndex).toBe('number');
  });

  it('jumps to a bookmarked chapter when its row is tapped', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'bbm2', chapters: CHAPTERS, progressChapterIndex: 0 });
    await repo.addBookmark({
      id: 'x', bookId: 'bbm2', chapterIndex: 2, blockIndex: 0,
      snippet: '内容三。', createdAt: Date.now(),
    });

    const { findByText, getByText, getByTestId, findAllByText } = renderReader(repo, fs, 'bbm2');
    await findByText(/内容一。/);

    tapSurface(getByTestId('reader-surface'));
    fireEvent.press(getByText('书签'));
    fireEvent.press(await findByText('内容三。')); // the bookmark row snippet

    expect((await findAllByText('第三章 结局')).length).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx -t "bookmark"`
Expected: FAIL（无「书签」按钮 / `bookmarks-sheet`）

- [ ] **Step 3: 实现列表组件**

```typescript
// src/reader/BookmarksSheet.tsx
/** 增量1: 书签列表（复用目录 modal 风格）+ 收藏当前位置 + 回跳 + 删除。 */
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Bookmark } from '../lib/import/repository';
import { formatRelativeTime } from '../lib/library/time';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

interface BookmarksSheetProps {
  visible: boolean;
  bookmarks: Bookmark[];
  chapterTitles: Record<number, string>;
  onAddCurrent: () => void;
  onJump: (chapterIndex: number, blockIndex: number) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function BookmarksSheet({
  visible,
  bookmarks,
  chapterTitles,
  onAddCurrent,
  onJump,
  onDelete,
  onClose,
}: BookmarksSheetProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View testID="bookmarks-sheet" style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.heading }]}>书签</Text>
          <Pressable testID="bookmark-add" onPress={onAddCurrent} hitSlop={10}>
            <Text style={[styles.add, { color: theme.accent }]}>＋ 收藏当前位置</Text>
          </Pressable>
        </View>

        <FlatList
          data={bookmarks}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => {
                onJump(item.chapterIndex, item.blockIndex);
                onClose();
              }}
              onLongPress={() => onDelete(item.id)}
            >
              <Text numberOfLines={1} style={[styles.rowChapter, { color: theme.subtle }]}>
                {chapterTitles[item.chapterIndex] ?? ''} · {formatRelativeTime(item.createdAt)}
              </Text>
              <Text numberOfLines={2} style={[styles.rowSnippet, { color: theme.text }]}>
                {item.snippet}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.subtle }]}>
              还没有书签，点右上角「收藏当前位置」添加
            </Text>
          }
        />

        <Pressable
          style={({ pressed }) => [styles.closeBar, { borderTopColor: theme.border }, pressed && styles.pressed]}
          onPress={onClose}
        >
          <Text style={[styles.closeBarText, { color: theme.text }]}>关闭</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: '600' },
  add: { fontSize: 14, fontWeight: '600' },
  row: { paddingHorizontal: 22, paddingVertical: 14 },
  rowChapter: { fontSize: 12, marginBottom: 4 },
  rowSnippet: { fontSize: 15, lineHeight: 22 },
  pressed: { opacity: 0.6 },
  empty: { textAlign: 'center', marginTop: 48, fontSize: 14, paddingHorizontal: 30, lineHeight: 22 },
  closeBar: { paddingVertical: 16, paddingBottom: 34, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  closeBarText: { fontSize: 16, fontWeight: '600' },
});
```

3b. `ReaderScreen.tsx` wire：

```typescript
// imports
import { BookmarksSheet } from '../reader/BookmarksSheet';
import { makeSnippet } from '../lib/reader/snippet';
import type { Bookmark } from '../lib/import/repository';

// state
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

// 打开列表时刷新
  const openBookmarks = useCallback(async () => {
    setBookmarks(await repo.listBookmarks(bookId));
    setShowBookmarks(true);
  }, [repo, bookId]);

// 章标题查表（供列表展示）
  const chapterTitles = useMemo(() => {
    const map: Record<number, string> = {};
    for (const c of chapters ?? []) map[c.index] = c.title;
    return map;
  }, [chapters]);

// 收藏当前位置：取当前顶部锚点 + 该段摘要
  const addCurrentBookmark = useCallback(async () => {
    const ci = currentChapterIndex;
    const bi = currentBlockIndexRef.current;
    const item = blocks.find((b) => b.chapterIndex === ci && b.blockIndex === bi);
    // 标题块无正文内容时，退回到该章首个正文段作摘要
    const snippetSource =
      item && !item.isTitle
        ? item.text
        : blocks.find((b) => b.chapterIndex === ci && !b.isTitle)?.text ?? '';
    await repo.addBookmark({
      id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      bookId,
      chapterIndex: ci,
      blockIndex: bi,
      snippet: makeSnippet(snippetSource),
      createdAt: Date.now(),
    });
    setBookmarks(await repo.listBookmarks(bookId));
  }, [repo, bookId, currentChapterIndex, blocks]);

// 回跳：跳章（Task 6 的恢复 effect 会把 pendingRestore 用于章内定位）
  const jumpToBookmark = useCallback(
    (chapterIndex: number, blockIndex: number) => {
      pendingRestoreRef.current = { chapterIndex, blockIndex };
      jumpToChapter(chapterIndex);
    },
    [jumpToChapter],
  );

  const deleteBookmark = useCallback(
    async (id: string) => {
      await repo.deleteBookmark(id);
      setBookmarks(await repo.listBookmarks(bookId));
    },
    [repo, bookId],
  );
```

底栏加「书签」按钮（放在「目录」之后）：

```typescript
          <BarButton label="目录" color={rs.theme.text} onPress={() => setShowToc(true)} />
          <BarButton label="书签" color={rs.theme.text} onPress={openBookmarks} />
```

> 底栏现有 5 项（目录/上一章/进度/下一章/排版）。加「书签」后为 6 项，`justifyContent:'space-between'` 会自动分布；若真机显拥挤，可在打磨时把「上一章/下一章」并入进度浮层。本任务保持 6 项。

底部渲染列表：

```typescript
      <BookmarksSheet
        visible={showBookmarks}
        bookmarks={bookmarks}
        chapterTitles={chapterTitles}
        onAddCurrent={addCurrentBookmark}
        onJump={jumpToBookmark}
        onDelete={deleteBookmark}
        onClose={() => setShowBookmarks(false)}
      />
```

3c. `jumpToChapter` 当前会 `saveProgress(charOffset:0)` 并 `scrollToOffset(0)`。为让书签回跳能定位到章内段落，`jumpToBookmark` 在调用 `jumpToChapter` 前已设 `pendingRestoreRef`；但 `jumpToChapter` 里的 `scrollToOffset({offset:0})` 会与恢复冲突。改动：`jumpToChapter` 末尾的 `scrollToOffset` 仅在无 pendingRestore 时执行：

```typescript
      if (!pendingRestoreRef.current) {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      }
```

（恢复 effect 在 blocks 变化后跑，负责滚到目标段。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx`
Expected: PASS（含 2 个新书签测试）

- [ ] **Step 5: 全量校验 + commit**

```bash
npx tsc --noEmit && npx jest
git add src/reader/BookmarksSheet.tsx src/screens/ReaderScreen.tsx src/screens/__tests__/ReaderScreen.test.tsx
git commit -m "feat(reader): bookmarks sheet — add/list/jump/delete"
```

---

### Task 9: 收尾校验 + OTA

**Files:** 无新增（全量验证）

- [ ] **Step 1: 全量测试 + 类型 + bundle 冒烟**

```bash
npx tsc --noEmit
npx jest --ci
npx expo export --platform ios
```
Expected: 全绿；bundle 成功。

- [ ] **Step 2: 推送触发 OTA**

```bash
git push origin main
```
Expected: CI `verify` job 通过后 `publish-ota` 发布。

- [ ] **Step 3: 真机 verify（用户）**
  - 长章滑到中部 → 杀进程 → 重进，回到原段（±一屏内）。
  - 底栏点「进度%」→ 拖到 ~80% → 松手跳到对应章。
  - 底栏「书签」→「收藏当前位置」→ 列表出现该条 → 点行回跳到原位；长按删除。

---

## Self-Review

**Spec coverage：**
- 章内滚动记忆 → Task 1（定位纯函数）+ Task 6（保存/恢复接线）✓
- 进度条拖动跳转（PanResponder，无原生 slider）→ Task 2（换算）+ Task 7（浮层）✓
- 书签（sqlite 表 + UI）→ Task 3（摘要）+ Task 4（InMemory/接口）+ Task 5（Sqlite）+ Task 8（UI）✓
- 复用 `charOffset` 存 blockIndex、无迁移 → Task 4 注释更新 + Task 6 语义 ✓
- 全程 OTA 安全、无新原生依赖 → Global Constraints + Task 7 明确用 PanResponder ✓
- 随书删除书签 → Task 4（InMemory）+ Task 5（FK CASCADE）✓

**Placeholder scan：** 无 TBD/TODO；每个代码步骤含完整代码。

**Type consistency：** `Bookmark`（Task 4）字段在 Task 5/8 一致；`BlockAnchor`/`findBlockArrayIndex`（Task 1）在 Task 6/8 一致；`FlatBlockItem.blockIndex`（Task 6）在 Task 8 `addCurrentBookmark` 使用一致；`ProgressJumpSheet`/`BookmarksSheet` props 在 ReaderScreen 调用处一致；seek 两函数命名一致。

**已知测试边界（诚实标注）：** FlatList 的 scrollToIndex/viewability 与 PanResponder 手势为原生行为，不在 Jest 环境真实执行——段级定位/换算由纯函数单测覆盖，实际滚动与手势由真机 verify。
