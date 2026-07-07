# 书名重命名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在书架长按一本书，通过菜单「重命名」改掉书架显示书名并持久化。

**Architecture:** 存储层给 `BookRepository` 加 `updateBookTitle`（InMemory + Sqlite）；书架长按由「直接删除」改为菜单（重命名/删除/取消），「重命名」打开一个轻色调 `RenameBookModal`（预填输入框），保存后写库并刷新。封面由 `buildCover(title)` 按当前标题渲染，重命名后自动跟随。

**Tech Stack:** Expo SDK 57 · React Native 0.86 · TypeScript strict · Jest 29 + jest-expo · @testing-library/react-native 13.3.3 · expo-sqlite

## Global Constraints

- **不引入任何新原生依赖**（只用 ipa 已含原生模块 + RN 内置）。全程 OTA 安全。
- 本增量**只编辑书名**（不加 author 字段、不改 coverColor、不做封面自定义）。
- 测试库锁定 `@testing-library/react-native@13.3.3`；路径别名 `@/*` → `src/*`。
- `SqliteBookRepository` 不做单元测试（原生 SQLite 不在 Jest 环境），由 `tsc --noEmit` 保证。
- `RenameBookModal` 用书架浅色调（非 reader 主题）：testID `rename-modal`、保存钮 testID `rename-save`、输入框 `placeholder="书名"`。保存在「trim 后为空」或「与原书名相同」时**禁用**。
- 删除保持**单次破坏性点按**（菜单里 `style:'destructive'` 的「删除」直接删，无二级确认）。
- 每个 task 结束 `npx tsc --noEmit` 干净 + 相关测试全绿后再 commit。

---

### Task 1: 存储层 `updateBookTitle`（接口 + InMemory）

**Files:**
- Modify: `src/lib/import/repository.ts`（`BookRepository` 接口加方法 + `InMemoryBookRepository` 实现）
- Test: `src/lib/import/__tests__/repository.test.ts`（追加）

**Interfaces:**
- Produces: `BookRepository.updateBookTitle(bookId: string, title: string): Promise<void>`（未知 id → no-op）。

- [ ] **Step 1: 写失败测试**（追加到文件末尾）

```typescript
// src/lib/import/__tests__/repository.test.ts (append)
describe('InMemoryBookRepository – updateBookTitle', () => {
  function seedBook(repo: InMemoryBookRepository, over: Partial<BookRecord> = {}) {
    const book: BookRecord = {
      id: 'bk1',
      title: '旧名',
      originalName: '旧名.txt',
      encoding: 'utf-8',
      sizeBytes: 10,
      importedAt: 1,
      coverColor: '#E8D5B7',
      strategy: 'regex',
      normalizedPath: 'file:///bk1.txt',
      ...over,
    };
    return repo.addBook(book).then(() => book);
  }

  it('changes the title and leaves other fields unchanged', async () => {
    const repo = new InMemoryBookRepository();
    await seedBook(repo);
    await repo.updateBookTitle('bk1', '新名');
    const books = await repo.listBooks();
    expect(books[0].title).toBe('新名');
    expect(books[0].originalName).toBe('旧名.txt');
    expect(books[0].normalizedPath).toBe('file:///bk1.txt');
  });

  it('is a no-op for an unknown book id', async () => {
    const repo = new InMemoryBookRepository();
    await seedBook(repo);
    await repo.updateBookTitle('nope', '新名');
    const books = await repo.listBooks();
    expect(books[0].title).toBe('旧名');
  });
});
```

（`BookRecord` 已在该测试文件顶部或既有 import 中可用；若未导入，将 `BookRecord` 加入现有 `import type { ... } from '../repository';`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/lib/import/__tests__/repository.test.ts -t updateBookTitle`
Expected: FAIL（`repo.updateBookTitle is not a function`）

- [ ] **Step 3: 实现**

在 `src/lib/import/repository.ts` 的 `BookRepository` 接口里，`deleteBook` 之后加：

```typescript
  /** Updates a book's display title. No-op if the book does not exist. */
  updateBookTitle(bookId: string, title: string): Promise<void>;
```

在 `InMemoryBookRepository` 里（`deleteBook` 附近）加：

```typescript
  async updateBookTitle(bookId: string, title: string): Promise<void> {
    const existing = this.books.get(bookId);
    if (!existing) return;
    this.books.set(bookId, { ...existing, title });
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/lib/import/__tests__/repository.test.ts`
Expected: PASS（既有 + 2 个新测试）

- [ ] **Step 5: commit**

```bash
git add src/lib/import/repository.ts src/lib/import/__tests__/repository.test.ts
git commit -m "feat(repo): updateBookTitle in BookRepository + InMemory impl"
```

---

### Task 2: 存储层 `updateBookTitle` — Sqlite 实现

**Files:**
- Modify: `src/lib/import/sqliteRepository.ts`

**Interfaces:**
- Consumes: Task 1 的 `updateBookTitle` 签名。
- 说明：不加单测（原生 SQLite 不在 Jest 环境），由 `tsc --noEmit` 保证。Task 1 给接口加了方法后，`SqliteBookRepository` 会暂时不满足接口而 tsc 报错；本任务消解它。

- [ ] **Step 1: 实现**

在 `src/lib/import/sqliteRepository.ts` 的 `deleteBook` 方法之后加：

```typescript
  async updateBookTitle(bookId: string, title: string): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync('UPDATE books SET title = ? WHERE id = ?', title, bookId);
  }
```

- [ ] **Step 2: tsc 校验**

Run: `npx tsc --noEmit`
Expected: 无输出（通过；Task 1 引入的接口缺失错误消解）

- [ ] **Step 3: 全套测试仍绿**

Run: `npx jest --ci`
Expected: 全绿（无回归）

- [ ] **Step 4: commit**

```bash
git add src/lib/import/sqliteRepository.ts
git commit -m "feat(repo): updateBookTitle in SqliteBookRepository"
```

---

### Task 3: `RenameBookModal` + 书架长按菜单接线

**Files:**
- Create: `src/library/RenameBookModal.tsx`
- Modify: `src/screens/LibraryScreen.tsx`
- Test: `src/library/__tests__/RenameBookModal.test.tsx`（新建）、`src/screens/__tests__/LibraryScreen.test.tsx`（追加）

**Interfaces:**
- Consumes: `updateBookTitle`（Task 1）、`BookRecord`（`src/lib/import/repository.ts`）。
- Produces: `RenameBookModal` props `{ visible: boolean; book: BookRecord | null; onSave: (title: string) => void; onClose: () => void }`；testIDs `rename-modal` / `rename-save`；输入框 `placeholder="书名"`。

- [ ] **Step 1: 写 RenameBookModal 失败测试**

```typescript
// src/library/__tests__/RenameBookModal.test.tsx
import { fireEvent, render } from '@testing-library/react-native';

import type { BookRecord } from '../../lib/import/repository';
import { RenameBookModal } from '../RenameBookModal';

function makeBook(over: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'bk1',
    title: '旧名',
    originalName: '旧名.txt',
    encoding: 'utf-8',
    sizeBytes: 10,
    importedAt: 1,
    coverColor: '#E8D5B7',
    strategy: 'regex',
    normalizedPath: 'file:///bk1.txt',
    ...over,
  };
}

describe('RenameBookModal', () => {
  it('prefills the current title and saves the trimmed value', () => {
    const onSave = jest.fn();
    const { getByPlaceholderText, getByTestId } = render(
      <RenameBookModal visible book={makeBook()} onSave={onSave} onClose={() => {}} />,
    );
    const input = getByPlaceholderText('书名');
    expect(input.props.value).toBe('旧名');
    fireEvent.changeText(input, '  新名  ');
    fireEvent.press(getByTestId('rename-save'));
    expect(onSave).toHaveBeenCalledWith('新名');
  });

  it('does not save a blank or unchanged title', () => {
    const onSave = jest.fn();
    const { getByPlaceholderText, getByTestId } = render(
      <RenameBookModal visible book={makeBook()} onSave={onSave} onClose={() => {}} />,
    );
    const save = getByTestId('rename-save');
    fireEvent.press(save); // unchanged from '旧名'
    fireEvent.changeText(getByPlaceholderText('书名'), '   ');
    fireEvent.press(save); // blank
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/library/__tests__/RenameBookModal.test.tsx`
Expected: FAIL（`Cannot find module '../RenameBookModal'`）

- [ ] **Step 3: 实现 RenameBookModal**

```typescript
// src/library/RenameBookModal.tsx
/** 增量3: 书架重命名弹窗——预填当前书名，保存 trim 后的非空/已变更标题。 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { BookRecord } from '../lib/import/repository';

interface RenameBookModalProps {
  visible: boolean;
  book: BookRecord | null;
  onSave: (title: string) => void;
  onClose: () => void;
}

export function RenameBookModal({ visible, book, onSave, onClose }: RenameBookModalProps) {
  const [text, setText] = useState('');

  // Sync the field to the book each time a (new) book is opened for rename.
  useEffect(() => {
    setText(book?.title ?? '');
  }, [book]);

  const trimmed = text.trim();
  const canSave = trimmed.length > 0 && trimmed !== (book?.title ?? '').trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <View testID="rename-modal" style={styles.card}>
          <Text style={styles.heading}>重命名</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="书名"
            placeholderTextColor="#9a958c"
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canSave) onSave(trimmed);
            }}
          />
          <View style={styles.row}>
            <Pressable style={styles.btn} onPress={onClose}>
              <Text style={styles.btnCancel}>取消</Text>
            </Pressable>
            <Pressable
              testID="rename-save"
              style={styles.btn}
              disabled={!canSave}
              onPress={() => {
                if (canSave) onSave(trimmed);
              }}
            >
              <Text style={[styles.btnSave, !canSave && styles.btnDisabled]}>保存</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  heading: { fontSize: 16, fontWeight: '700', color: '#1f1d19', marginBottom: 14 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8d3c8',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1f1d19',
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  btn: { paddingVertical: 10, paddingHorizontal: 16 },
  btnCancel: { fontSize: 15, color: '#8a8478' },
  btnSave: { fontSize: 15, fontWeight: '700', color: '#2c7a6b' },
  btnDisabled: { color: '#bcb8ae' },
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/library/__tests__/RenameBookModal.test.tsx`
Expected: PASS（2 tests）

- [ ] **Step 5: 写书架接线失败测试**（追加到 `src/screens/__tests__/LibraryScreen.test.tsx`）

```typescript
  it('long-press → 重命名 updates the book title', async () => {
    const { repo, fs } = makeSetup();
    await seedReader(repo, fs, { title: '旧名', chapters: [{ title: '第一章 A', body: 'a' }] });
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === '重命名')?.onPress?.();
    });

    const { findByText, getByTestId, getByPlaceholderText, queryByText } = renderLib(repo, fs);

    fireEvent(await findByText('旧名'), 'longPress');
    fireEvent.changeText(getByPlaceholderText('书名'), '新名');
    fireEvent.press(getByTestId('rename-save'));

    await waitFor(() => expect(queryByText('新名')).toBeTruthy());
    const books = await repo.listBooks();
    expect(books[0].title).toBe('新名');
  });
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npx jest src/screens/__tests__/LibraryScreen.test.tsx -t 重命名`
Expected: FAIL（无「重命名」菜单项 / 无 rename-save）

- [ ] **Step 7: 接线 LibraryScreen**

7a. 顶部 import 加：

```typescript
import { RenameBookModal } from '../library/RenameBookModal';
```

7b. 在 state 区（`const [error, setError] = useState<string | null>(null);` 之后）加：

```typescript
  const [renamingBook, setRenamingBook] = useState<BookRecord | null>(null);
```

7c. 把现有 `handleDelete`（长按直接弹删除）替换为菜单 `handleBookMenu`：

```typescript
  const handleBookMenu = useCallback(
    (book: BookRecord) => {
      Alert.alert(book.title, undefined, [
        { text: '重命名', onPress: () => setRenamingBook(book) },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            await repo.deleteBook(book.id);
            await reload();
          },
        },
        { text: '取消', style: 'cancel' },
      ]);
    },
    [repo, reload],
  );

  const handleRenameSave = useCallback(
    async (title: string) => {
      if (renamingBook) {
        await repo.updateBookTitle(renamingBook.id, title);
        await reload();
      }
      setRenamingBook(null);
    },
    [renamingBook, repo, reload],
  );
```

7d. 把全部 `handleDelete` 引用改名为 `handleBookMenu`——包括三处 `onLongPress={() => handleDelete(item.book)}` / `handleDelete(hero.book)`，以及 `renderRow` / `renderCard` / `heroHeader` 各自 `useCallback`/`useMemo` 依赖数组里的 `handleDelete`。（全文替换 `handleDelete` → `handleBookMenu`。）

7e. 在 `return (...)` 里，`{content()}` 之后、最外层 `</View>` 之前渲染弹窗：

```typescript
      <RenameBookModal
        visible={renamingBook !== null}
        book={renamingBook}
        onSave={handleRenameSave}
        onClose={() => setRenamingBook(null)}
      />
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npx jest src/screens/__tests__/LibraryScreen.test.tsx`
Expected: PASS（含既有「long-press → confirm removes the book」——其 destructive「删除」按钮仍在菜单里，行为不变 + 新「重命名」测试）

- [ ] **Step 9: 全量校验 + commit**

```bash
npx tsc --noEmit && npx jest --ci
git add src/library/RenameBookModal.tsx src/screens/LibraryScreen.tsx src/library/__tests__/RenameBookModal.test.tsx src/screens/__tests__/LibraryScreen.test.tsx
git commit -m "feat(library): rename a book via long-press menu"
```

---

### Task 4: 收尾校验 + OTA

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
Expected: CI `verify` 通过后 `publish-ota` 发布。

- [ ] **Step 3: 真机 verify（用户）**
  - 长按一本书 → 菜单出现「重命名 / 删除 / 取消」。
  - 重命名 → 输入新名 → 保存 → 书架显示新名、封面随标题变色。
  - 杀进程重进 → 新名仍在（已持久化）。
  - 删除仍为单次点按即删。

---

## Self-Review

**Spec coverage：**
- `updateBookTitle`（InMemory + Sqlite）→ Task 1 + Task 2 ✓
- 长按菜单（重命名/删除/取消）+ 删除保持单次破坏性点按 → Task 3 (7c) ✓
- `RenameBookModal`（预填/trim/空或未变更禁用/testIDs/placeholder）→ Task 3 (Step 3) ✓
- 重命名后 reload 刷新、封面随标题 → Task 3 (7c/7e) + 依赖 `buildCover(title)`（既有）✓
- 只编辑书名、无 author/coverColor 改动 → 范围内 ✓
- OTA 安全、无新原生依赖 → Global Constraints ✓

**Placeholder scan：** 无 TBD/TODO；每个代码步骤含完整代码。

**Type consistency：** `updateBookTitle(bookId, title)` 在 Task 1/2/3 一致；`RenameBookModal` props 在组件定义与 LibraryScreen 调用处一致；`BookRecord` 字面量在测试里字段完整、与 `repository.ts` 一致；`handleBookMenu` 重命名覆盖全部 `handleDelete` 引用（含依赖数组）。

**测试边界（诚实标注）：** `Alert.alert` 的菜单为原生弹窗，组件测试用 `jest.spyOn(Alert,'alert')` 拦截并调用对应按钮的 `onPress` 来驱动（沿用既有删除测试的模式）；真正的长按→菜单外观由真机 verify。
