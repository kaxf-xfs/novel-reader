# 书内全文搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在目录面板加「全文」页签，扫描整本正文搜关键词、跳到命中段落，并在阅读页高亮命中词——全部随阅读主题自适应。

**Architecture:** 纯逻辑（高亮切分/片段/颜色）+ 逐章流式搜索运行器（复用 `readChapterText`+`splitBlocks`，一次一章不整本进内存）；UI 把全文搜索做成 `FullTextPanel`，由 `TocSheet` 的页签在「章节/全文」间切换；阅读器提供 `searchBook` 作为搜索源、并用增量1的 `jumpToChapter(ch, block, term)` 落位+设高亮。

**Tech Stack:** Expo SDK 57 · React Native 0.86 · TypeScript strict · Jest 29 + jest-expo · @testing-library/react-native 13.3.3

## Global Constraints

- **不引入任何新原生依赖**，全程 OTA 安全（复用 `readChapterText`/`splitBlocks`/`resolveTheme`）。
- **大文件绝不整本进内存**：搜索按章 `readChapterText` 流式扫描，结果数组封顶 `cap=300`。
- **主题自适应是第一要求**：面板与高亮的所有颜色来自 `resolveTheme(settings.themeId)`；命中高亮底色 = `hexToRgba(theme.accent, 0.22)`，不写死配色。
- 匹配 = **大小写不敏感子串**（无正则/分词）。正文搜索**只搜正文段（blockIndex ≥ 1），跳过标题块**。片段窗口默认 before=12 / after=40 字。**每个命中段至多一条结果**。
- 高亮**持续到下次导航**（上一章/下一章/目录选章/书签均清除；滚动保留）。
- 测试库锁定 `@testing-library/react-native@13.3.3`；路径别名 `@/*`→`src/*`。
- 每个 task 结束 `npx tsc --noEmit` 干净 + 相关测试全绿后再 commit。

---

### Task 1: 纯逻辑 `search.ts`（splitHighlight + makeSearchSnippet + hexToRgba）

**Files:**
- Create: `src/lib/reader/search.ts`
- Test: `src/lib/reader/__tests__/search.test.ts`

**Interfaces:**
- Produces:
  - `interface HighlightSegment { text: string; match: boolean }`
  - `splitHighlight(text: string, term: string): HighlightSegment[]`
  - `makeSearchSnippet(blockText: string, term: string, opts?: { before?: number; after?: number }): string`
  - `hexToRgba(hex: string, alpha: number): string`

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/reader/__tests__/search.test.ts
import { splitHighlight, makeSearchSnippet, hexToRgba } from '../search';

describe('splitHighlight', () => {
  it('splits around a match, preserving original case', () => {
    expect(splitHighlight('x剑气y剑', '剑')).toEqual([
      { text: 'x', match: false },
      { text: '剑', match: true },
      { text: '气y', match: false },
      { text: '剑', match: true },
    ]);
  });

  it('is case-insensitive but keeps original text', () => {
    expect(splitHighlight('abcABC', 'abc')).toEqual([
      { text: 'abc', match: true },
      { text: 'ABC', match: true },
    ]);
  });

  it('returns a single non-match segment when the term is absent or empty', () => {
    expect(splitHighlight('abc', 'z')).toEqual([{ text: 'abc', match: false }]);
    expect(splitHighlight('abc', '')).toEqual([{ text: 'abc', match: false }]);
  });
});

describe('makeSearchSnippet', () => {
  it('returns the whole block when it fits the window', () => {
    expect(makeSearchSnippet('他推开门看见剑气逼来', '剑气')).toBe('他推开门看见剑气逼来');
  });

  it('windows around the first match with ellipses when truncated', () => {
    const text = '甲'.repeat(30) + '剑气' + '乙'.repeat(60);
    const snip = makeSearchSnippet(text, '剑气', { before: 12, after: 40 });
    expect(snip.startsWith('…')).toBe(true);
    expect(snip.endsWith('…')).toBe(true);
    expect(snip).toContain('剑气');
    expect(snip).toContain('甲'.repeat(12));
    expect(snip).toContain('乙'.repeat(40));
  });

  it('falls back to the head when the term is absent', () => {
    expect(makeSearchSnippet('abc', 'z')).toBe('abc');
  });
});

describe('hexToRgba', () => {
  it('converts #rrggbb + alpha to an rgba() string', () => {
    expect(hexToRgba('#83a99b', 0.22)).toBe('rgba(131, 169, 155, 0.22)');
    expect(hexToRgba('#b0674a', 0.22)).toBe('rgba(176, 103, 74, 0.22)');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/lib/reader/__tests__/search.test.ts`
Expected: FAIL（`Cannot find module '../search'`）

- [ ] **Step 3: 最小实现**

```typescript
// src/lib/reader/search.ts
/** 增量2: 全文搜索的纯逻辑——高亮切分、结果片段、hex→rgba。 */

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into matched / non-matched segments for `term`
 * (case-insensitive, non-overlapping, left-to-right, original case kept).
 * Shared by search-result snippets AND the in-reader highlight.
 */
export function splitHighlight(text: string, term: string): HighlightSegment[] {
  if (!term) return [{ text, match: false }];
  const lowText = text.toLowerCase();
  const lowTerm = term.toLowerCase();
  const segments: HighlightSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lowText.indexOf(lowTerm, i);
    if (idx === -1) {
      segments.push({ text: text.slice(i), match: false });
      break;
    }
    if (idx > i) segments.push({ text: text.slice(i, idx), match: false });
    segments.push({ text: text.slice(idx, idx + term.length), match: true });
    i = idx + term.length;
  }
  return segments;
}

/** A window of `blockText` centered on the first match, with ellipses. */
export function makeSearchSnippet(
  blockText: string,
  term: string,
  opts: { before?: number; after?: number } = {},
): string {
  const before = opts.before ?? 12;
  const after = opts.after ?? 40;
  const idx = term ? blockText.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (idx === -1) return blockText.slice(0, before + after + (term.length || 0));
  const start = Math.max(0, idx - before);
  const end = Math.min(blockText.length, idx + term.length + after);
  let snip = blockText.slice(start, end);
  if (start > 0) snip = '…' + snip;
  if (end < blockText.length) snip = snip + '…';
  return snip;
}

/** `#rrggbb` + alpha → `rgba(r, g, b, a)` (RN styles don't take hex+alpha). */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/lib/reader/__tests__/search.test.ts`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add src/lib/reader/search.ts src/lib/reader/__tests__/search.test.ts
git commit -m "feat(reader): search pure logic — splitHighlight/makeSearchSnippet/hexToRgba"
```

---

### Task 2: 搜索运行器 `searchBook.ts`

**Files:**
- Create: `src/lib/reader/searchBook.ts`
- Test: `src/lib/reader/__tests__/searchBook.test.ts`

**Interfaces:**
- Consumes: `readChapterText`（`./readChapter`）、`splitBlocks`（`./blocks`）、`makeSearchSnippet`（Task 1）、`FileGateway`（`../import/importBook`）、`ChapterRecord`（`../import/repository`）。
- Produces:
  - `interface SearchResult { chapterIndex: number; chapterTitle: string; blockIndex: number; snippet: string }`
  - `interface SearchOutcome { results: SearchResult[]; capped: boolean }`
  - `searchBook(deps: { fs: FileGateway; normalizedPath: string; chapters: ChapterRecord[]; term: string; cap?: number }): Promise<SearchOutcome>`

- [ ] **Step 1: 写失败测试**

```typescript
// src/lib/reader/__tests__/searchBook.test.ts
import { InMemoryBookRepository } from '../../import/repository';
import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { searchBook } from '../searchBook';

async function setup(chapters: { title: string; body: string }[]) {
  const repo = new InMemoryBookRepository();
  const fs = new FakeFileGateway();
  const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
  return { fs, normalizedPath: book.normalizedPath, chapters: await repo.getChapters('b1') };
}

describe('searchBook', () => {
  it('finds a body match with the right chapter/block and a snippet', async () => {
    const { fs, normalizedPath, chapters } = await setup([
      { title: '第一章 起', body: '风平浪静的一天。' },
      { title: '第二章 战', body: '他周身腾起一层剑气，直逼面门。' },
      { title: '第三章 终', body: '尘埃落定。' },
    ]);
    const { results, capped } = await searchBook({ fs, normalizedPath, chapters, term: '剑气' });
    expect(capped).toBe(false);
    expect(results).toHaveLength(1);
    expect(results[0].chapterIndex).toBe(1);
    expect(results[0].blockIndex).toBe(1); // body block (0 = title)
    expect(results[0].chapterTitle).toBe('第二章 战');
    expect(results[0].snippet).toContain('剑气');
  });

  it('does not match on chapter titles (only body blocks)', async () => {
    const { fs, normalizedPath, chapters } = await setup([
      { title: '第一章 剑气纵横', body: '毫无关系的一段。' },
    ]);
    const { results } = await searchBook({ fs, normalizedPath, chapters, term: '剑气' });
    expect(results).toHaveLength(0);
  });

  it('returns empty for a blank term', async () => {
    const { fs, normalizedPath, chapters } = await setup([{ title: '第一章', body: '内容' }]);
    expect(await searchBook({ fs, normalizedPath, chapters, term: '   ' })).toEqual({
      results: [],
      capped: false,
    });
  });

  it('caps results and reports capped=true', async () => {
    const chapters = Array.from({ length: 5 }, (_, i) => ({
      title: `第${i + 1}章`,
      body: '这里有剑气。',
    }));
    const { fs, normalizedPath, chapters: chs } = await setup(chapters);
    const { results, capped } = await searchBook({ fs, normalizedPath, chapters: chs, term: '剑气', cap: 3 });
    expect(results).toHaveLength(3);
    expect(capped).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/lib/reader/__tests__/searchBook.test.ts`
Expected: FAIL（`Cannot find module '../searchBook'`）

- [ ] **Step 3: 实现**

```typescript
// src/lib/reader/searchBook.ts
/** 增量2: 逐章流式全文搜索。一次只驻留一章文本 + 结果数组（≤cap）。 */
import { readChapterText } from './readChapter';
import { splitBlocks } from './blocks';
import { makeSearchSnippet } from './search';
import type { FileGateway } from '../import/importBook';
import type { ChapterRecord } from '../import/repository';

export interface SearchResult {
  chapterIndex: number;
  chapterTitle: string;
  blockIndex: number;
  snippet: string;
}

export interface SearchOutcome {
  results: SearchResult[];
  capped: boolean;
}

export interface SearchBookDeps {
  fs: FileGateway;
  normalizedPath: string;
  chapters: ChapterRecord[];
  term: string;
  cap?: number;
}

export async function searchBook({
  fs,
  normalizedPath,
  chapters,
  term,
  cap = 300,
}: SearchBookDeps): Promise<SearchOutcome> {
  const needle = term.trim();
  if (!needle) return { results: [], capped: false };
  const low = needle.toLowerCase();
  const results: SearchResult[] = [];

  for (const chapter of chapters) {
    const text = await readChapterText(fs, normalizedPath, chapter);
    const blocks = splitBlocks(text);
    // Skip the title block (index 0); chapter titles are covered by the 章节 tab.
    for (let bi = 1; bi < blocks.length; bi++) {
      if (blocks[bi].toLowerCase().includes(low)) {
        results.push({
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          blockIndex: bi,
          snippet: makeSearchSnippet(blocks[bi], needle),
        });
        if (results.length >= cap) return { results, capped: true };
      }
    }
  }
  return { results, capped: false };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/lib/reader/__tests__/searchBook.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: commit**

```bash
git add src/lib/reader/searchBook.ts src/lib/reader/__tests__/searchBook.test.ts
git commit -m "feat(reader): searchBook — per-chapter streaming full-text search"
```

---

### Task 3: `FullTextPanel` 组件（搜索框 + 结果，主题自适应）

**Files:**
- Create: `src/reader/FullTextPanel.tsx`
- Test: `src/reader/__tests__/FullTextPanel.test.tsx`

**Interfaces:**
- Consumes: `SearchOutcome`/`SearchResult`（Task 2）、`splitHighlight`/`hexToRgba`（Task 1）、`resolveTheme`+`useSettings`。
- Produces: `FullTextPanel` props `{ onSearch: (term: string) => Promise<SearchOutcome>; onSelectResult: (chapterIndex: number, blockIndex: number, term: string) => void }`；testID `fulltext-panel`；搜索框 `placeholder="搜索全文"`；结果行 testID `ft-result`。

- [ ] **Step 1: 写失败测试**

```typescript
// src/reader/__tests__/FullTextPanel.test.tsx
import { fireEvent, waitFor } from '@testing-library/react-native';

import type { SearchOutcome } from '../../lib/reader/searchBook';
import { renderWithSettings } from '../../test-utils/render';
import { FullTextPanel } from '../FullTextPanel';

const OUTCOME: SearchOutcome = {
  results: [
    { chapterIndex: 1, chapterTitle: '第二章 战', blockIndex: 1, snippet: '…腾起一层剑气，直逼…' },
  ],
  capped: false,
};

describe('FullTextPanel', () => {
  it('runs the search on submit and renders results', async () => {
    const onSearch = jest.fn(async () => OUTCOME);
    const { getByPlaceholderText, findByText } = renderWithSettings(
      <FullTextPanel onSearch={onSearch} onSelectResult={() => {}} />,
    );
    const input = getByPlaceholderText('搜索全文');
    fireEvent.changeText(input, '剑气');
    fireEvent(input, 'submitEditing');
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('剑气'));
    expect(await findByText(/第二章 战/)).toBeTruthy();
  });

  it('invokes onSelectResult with (chapterIndex, blockIndex, term) when a row is tapped', async () => {
    const onSearch = jest.fn(async () => OUTCOME);
    const onSelectResult = jest.fn();
    const { getByPlaceholderText, findByTestId } = renderWithSettings(
      <FullTextPanel onSearch={onSearch} onSelectResult={onSelectResult} />,
    );
    const input = getByPlaceholderText('搜索全文');
    fireEvent.changeText(input, '剑气');
    fireEvent(input, 'submitEditing');
    const row = await findByTestId('ft-result');
    fireEvent.press(row);
    expect(onSelectResult).toHaveBeenCalledWith(1, 1, '剑气');
  });

  it('shows an empty-state message when there are no results', async () => {
    const onSearch = jest.fn(async () => ({ results: [], capped: false }));
    const { getByPlaceholderText, findByText } = renderWithSettings(
      <FullTextPanel onSearch={onSearch} onSelectResult={() => {}} />,
    );
    const input = getByPlaceholderText('搜索全文');
    fireEvent.changeText(input, '不存在');
    fireEvent(input, 'submitEditing');
    expect(await findByText('没有找到')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/reader/__tests__/FullTextPanel.test.tsx`
Expected: FAIL（`Cannot find module '../FullTextPanel'`）

- [ ] **Step 3: 实现**

```typescript
// src/reader/FullTextPanel.tsx
/** 增量2: 目录面板「全文」页——搜索框（提交触发）+ 结果列表，主题自适应。 */
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hexToRgba, splitHighlight } from '../lib/reader/search';
import type { SearchOutcome, SearchResult } from '../lib/reader/searchBook';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

interface FullTextPanelProps {
  onSearch: (term: string) => Promise<SearchOutcome>;
  onSelectResult: (chapterIndex: number, blockIndex: number, term: string) => void;
}

export function FullTextPanel({ onSearch, onSelectResult }: FullTextPanelProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);

  const [query, setQuery] = useState('');
  const [term, setTerm] = useState(''); // the submitted term (for highlighting)
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);

  const submit = async () => {
    const q = query.trim();
    if (!q) return;
    setTerm(q);
    setLoading(true);
    try {
      setOutcome(await onSearch(q));
    } finally {
      setLoading(false);
    }
  };

  const hlBg = hexToRgba(theme.accent, 0.22);

  const renderRow = ({ item }: { item: SearchResult }) => (
    <Pressable
      testID="ft-result"
      style={({ pressed }) => [styles.row, { borderTopColor: theme.border }, pressed && styles.pressed]}
      onPress={() => onSelectResult(item.chapterIndex, item.blockIndex, term)}
    >
      <Text style={[styles.rowChapter, { color: theme.subtle }]} numberOfLines={1}>
        {item.chapterTitle}
      </Text>
      <Text style={[styles.rowSnippet, { color: theme.text }]} numberOfLines={2}>
        {splitHighlight(item.snippet, term).map((seg, i) => (
          <Text key={i} style={seg.match ? { backgroundColor: hlBg } : undefined}>
            {seg.text}
          </Text>
        ))}
      </Text>
    </Pressable>
  );

  return (
    <View testID="fulltext-panel" style={styles.container}>
      <TextInput
        style={[styles.search, { color: theme.text, borderColor: theme.border }]}
        placeholder="搜索全文"
        placeholderTextColor={theme.subtle}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
        returnKeyType="search"
        autoCorrect={false}
      />
      {loading ? (
        <ActivityIndicator color={theme.subtle} style={styles.spinner} />
      ) : outcome === null ? null : outcome.results.length === 0 ? (
        <Text style={[styles.empty, { color: theme.subtle }]}>没有找到</Text>
      ) : (
        <FlatList
          data={outcome.results}
          keyExtractor={(r, i) => `${r.chapterIndex}-${r.blockIndex}-${i}`}
          keyboardShouldPersistTaps="handled"
          renderItem={renderRow}
          ListHeaderComponent={
            <Text style={[styles.meta, { color: theme.subtle }]}>
              找到 {outcome.results.length} 处{outcome.capped ? ' · 仅显示前 300 条' : ''}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: {
    marginHorizontal: 20,
    marginVertical: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    fontSize: 15,
  },
  spinner: { marginTop: 30 },
  meta: { paddingHorizontal: 22, paddingBottom: 8, fontSize: 12 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  row: { paddingHorizontal: 22, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth },
  rowChapter: { fontSize: 12, marginBottom: 5 },
  rowSnippet: { fontSize: 14.5, lineHeight: 22 },
  pressed: { opacity: 0.6 },
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/reader/__tests__/FullTextPanel.test.tsx`
Expected: PASS（3 tests）

- [ ] **Step 5: commit**

```bash
git add src/reader/FullTextPanel.tsx src/reader/__tests__/FullTextPanel.test.tsx
git commit -m "feat(reader): FullTextPanel — theme-adaptive full-text search UI"
```

---

### Task 4: TocSheet 加「章节 / 全文」页签

**Files:**
- Modify: `src/reader/TocSheet.tsx`
- Test: `src/reader/__tests__/TocSheet.test.tsx`（追加）

**Interfaces:**
- Consumes: `FullTextPanel`（Task 3）、`SearchOutcome`（Task 2）。
- Produces: `TocSheetProps` 新增可选 `onFullTextSearch?: (term: string) => Promise<SearchOutcome>` 与 `onSelectResult?: (chapterIndex: number, blockIndex: number, term: string) => void`。仅当 `onFullTextSearch` 存在时显示页签；「全文」页渲染 `FullTextPanel`，选中结果后 `onSelectResult` + `onClose`。

- [ ] **Step 1: 写失败测试**（`src/reader/__tests__/TocSheet.test.tsx` 已存在——追加下面的 describe，并确保顶部已 import `fireEvent, waitFor` / `renderWithSettings` / `TocSheet`；`SearchOutcome` 类型 import 需新增）

```typescript
// src/reader/__tests__/TocSheet.test.tsx (append; ensure these imports exist at top)
import { fireEvent, waitFor } from '@testing-library/react-native';
import type { SearchOutcome } from '../../lib/reader/searchBook';
import { renderWithSettings } from '../../test-utils/render';
import { TocSheet } from '../TocSheet';

const CHAPTERS = [
  { index: 0, title: '第一章 起' },
  { index: 1, title: '第二章 战' },
];

describe('TocSheet full-text tab', () => {
  it('switches to 全文 and runs a full-text search that jumps to a result', async () => {
    const outcome: SearchOutcome = {
      results: [{ chapterIndex: 1, chapterTitle: '第二章 战', blockIndex: 1, snippet: '…剑气…' }],
      capped: false,
    };
    const onFullTextSearch = jest.fn(async () => outcome);
    const onSelectResult = jest.fn();
    const onClose = jest.fn();

    const { getByText, getByPlaceholderText, findByTestId } = renderWithSettings(
      <TocSheet
        visible
        chapters={CHAPTERS}
        currentIndex={0}
        onSelect={() => {}}
        onClose={onClose}
        onFullTextSearch={onFullTextSearch}
        onSelectResult={onSelectResult}
      />,
    );

    fireEvent.press(getByText('全文'));
    const input = getByPlaceholderText('搜索全文');
    fireEvent.changeText(input, '剑气');
    fireEvent(input, 'submitEditing');

    const row = await findByTestId('ft-result');
    fireEvent.press(row);
    await waitFor(() => expect(onSelectResult).toHaveBeenCalledWith(1, 1, '剑气'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows no tabs when onFullTextSearch is not provided', () => {
    const { queryByText } = renderWithSettings(
      <TocSheet visible chapters={CHAPTERS} currentIndex={0} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(queryByText('全文')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/reader/__tests__/TocSheet.test.tsx -t full-text`
Expected: FAIL（无「全文」页签）

- [ ] **Step 3: 实现**

3a. import 与 props：

```typescript
// add imports
import { FullTextPanel } from './FullTextPanel';
import type { SearchOutcome } from '../lib/reader/searchBook';

interface TocSheetProps {
  visible: boolean;
  chapters: TocEntry[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  onFullTextSearch?: (term: string) => Promise<SearchOutcome>;
  onSelectResult?: (chapterIndex: number, blockIndex: number, term: string) => void;
}
```

3b. 组件顶部加模式 state（在 `const [query, setQuery] = useState('');` 之后）：

```typescript
  const [mode, setMode] = useState<'chapter' | 'fulltext'>('chapter');
  const hasFullText = onFullTextSearch != null;
```

3c. 在 `<View style={[styles.header ...]}>...</View>` 之后、`<TextInput ...搜索章节>` 之前，插入页签（仅当 `hasFullText`）：

```typescript
        {hasFullText && (
          <View style={[styles.tabs, { borderColor: theme.border }]}>
            {(['chapter', 'fulltext'] as const).map((m) => {
              const on = mode === m;
              return (
                <Pressable
                  key={m}
                  style={[styles.tab, on && { backgroundColor: theme.accent }]}
                  onPress={() => setMode(m)}
                >
                  <Text style={[styles.tabText, { color: on ? theme.background : theme.subtle }]}>
                    {m === 'chapter' ? '章节' : '全文'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
```

3d. 把现有的「搜索章节」`<TextInput>` + 章节 `<FlatList>` 包进「章节模式」分支，并加「全文模式」分支。即：把现有 `TextInput`（搜索章节）与其后的章节 `FlatList` 用条件包起来——mode==='chapter' 时渲染它们；mode==='fulltext' 且 hasFullText 时渲染：

```typescript
        {mode === 'chapter' ? (
          <>
            {/* 现有的「搜索章节」TextInput 与章节 FlatList 原样放这里 */}
          </>
        ) : (
          <FullTextPanel
            onSearch={onFullTextSearch!}
            onSelectResult={(c, b, t) => {
              onSelectResult?.(c, b, t);
              onClose();
            }}
          />
        )}
```

3e. 样式补充（加进 `StyleSheet.create({...})`）：

```typescript
  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 2,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8 },
  tabText: { fontSize: 13.5, fontWeight: '600' },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/reader/__tests__/TocSheet.test.tsx`
Expected: PASS（既有 + 2 个新测试）

- [ ] **Step 5: commit**

```bash
git add src/reader/TocSheet.tsx src/reader/__tests__/TocSheet.test.tsx
git commit -m "feat(reader): TocSheet 章节/全文 tab hosting FullTextPanel"
```

---

### Task 5: 阅读器接线（搜索源 + 跳转设高亮 + 正文高亮渲染）

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`
- Test: `src/screens/__tests__/ReaderScreen.test.tsx`（追加）

**Interfaces:**
- Consumes: `searchBook`（Task 2）、`splitHighlight`/`hexToRgba`（Task 1）、TocSheet 新 props（Task 4）、增量1 的 `jumpToChapter`。
- Produces: `jumpToChapter` 增加第三参 `term: string | null = null`（设 `highlightTerm`）；`highlightTerm` state 驱动 body 段高亮渲染。

- [ ] **Step 1: 写失败测试**（追加）

```typescript
  it('highlights the search term in the body after selecting a result', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, {
      bookId: 'bft',
      chapters: [
        { title: '第一章 起', body: '他周身腾起一层剑气，直逼面门。' },
        { title: '第二章 承', body: '风平浪静。' },
      ],
      progressChapterIndex: 0,
    });

    const { findByText, getByText, getByTestId, getAllByText, findByTestId } = renderReader(
      repo,
      fs,
      'bft',
    );
    await findByText(/剑气/);

    // open TOC → 全文 tab → search → tap result
    tapSurface(getByTestId('reader-surface'));
    fireEvent.press(getByText('目录'));
    fireEvent.press(getByText('全文'));
    const input = within(getByTestId('toc-sheet')).getByPlaceholderText('搜索全文');
    fireEvent.changeText(input, '剑气');
    fireEvent(input, 'submitEditing');
    fireEvent.press(await findByTestId('ft-result'));

    // the body '剑气' now renders with the accent highlight background
    await waitFor(() => {
      const hit = getAllByText('剑气').find((n) =>
        JSON.stringify(n.props.style ?? {}).includes('rgba'),
      );
      expect(hit).toBeTruthy();
    });
  });
```

（顶部 import 需补 `within`：`import { fireEvent, waitFor, within } from '@testing-library/react-native';`。`getAllByText('剑气')` 会同时命中搜索结果行与正文——正文命中段的 `<Text>` 带 `backgroundColor: rgba(...)`，用 `.find(...style 含 'rgba')` 挑出它即可。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx -t highlights`
Expected: FAIL（无全文页签 / 无高亮）

- [ ] **Step 3: 实现**

3a. import：

```typescript
import { splitHighlight, hexToRgba } from '../lib/reader/search';
import { searchBook } from '../lib/reader/searchBook';
```

3b. state（与其它 useState 一起）：

```typescript
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
```

3c. `jumpToChapter` 增加第三参并设高亮（在方法签名与体内）：

```typescript
  const jumpToChapter = useCallback(
    async (target: number, targetBlockIndex = 0, term: string | null = null) => {
      if (!book || !chapters) return;
      const clamped = Math.min(Math.max(target, 0), chapters.length - 1);
      const { indices, blocks: newBlocks } = await loadWindow(book, chapters, clamped);
      setHighlightTerm(term);
      pendingRestoreRef.current = { chapterIndex: clamped, blockIndex: targetBlockIndex };
      if (targetBlockIndex > 0) mask();
      setBlocks(newBlocks);
      setLo(indices[0]);
      setHi(indices[indices.length - 1]);
      setCurrentChapterIndex(clamped);
      currentBlockIndexRef.current = targetBlockIndex;
      repo.saveProgress({ bookId, chapterIndex: clamped, charOffset: targetBlockIndex, updatedAt: Date.now() });
    },
    [book, chapters, loadWindow, repo, bookId, mask],
  );
```

（`jumpToBookmark` 仍调用 `jumpToChapter(chapterIndex, blockIndex)` → 第三参默认 null → 清除高亮。上一章/下一章/目录选章同理。）

3d. 搜索源回调：

```typescript
  const runFullTextSearch = useCallback(
    (term: string) =>
      searchBook({ fs, normalizedPath: book?.normalizedPath ?? '', chapters: chapters ?? [], term }),
    [fs, book, chapters],
  );
```

3e. body 段高亮渲染——把 renderItem 的 body 分支替换为：

```typescript
              ) : (
                <Text style={rs.paragraph}>
                  {PARA_INDENT}
                  {highlightTerm
                    ? splitHighlight(item.text, highlightTerm).map((seg, i) => (
                        <Text
                          key={i}
                          style={seg.match ? { backgroundColor: hexToRgba(rs.theme.accent, 0.22) } : undefined}
                        >
                          {seg.text}
                        </Text>
                      ))
                    : item.text}
                </Text>
              )
```

3f. TocSheet 调用处加两个 props：

```typescript
      <TocSheet
        visible={showToc}
        chapters={tocEntries}
        currentIndex={currentChapterIndex}
        onSelect={jumpToChapter}
        onClose={() => setShowToc(false)}
        onFullTextSearch={runFullTextSearch}
        onSelectResult={(c, b, t) => jumpToChapter(c, b, t)}
      />
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx`
Expected: PASS（既有 + 新高亮测试）

- [ ] **Step 5: commit**

```bash
git add src/screens/ReaderScreen.tsx src/screens/__tests__/ReaderScreen.test.tsx
git commit -m "feat(reader): wire full-text search source + in-reader highlight"
```

---

### Task 6: 收尾校验 + OTA

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
  - 目录 → 切「全文」→ 输入词提交 → 出结果（章标题 + 高亮片段）。
  - 点结果 → 落到该段，正文命中词标色（当前主题强调色）。
  - 切换阅读主题 → 搜索面板与高亮随之变色。
  - 上一章 / 目录选章 → 高亮消失。
  - 大书（凡人 15MB）搜索耗时可接受、无 OOM。

---

## Self-Review

**Spec coverage：**
- 逐章流式搜索、不整本进内存、cap 300 → Task 2 ✓
- splitHighlight / makeSearchSnippet / hexToRgba → Task 1 ✓
- 只搜正文段（blockIndex≥1）、每段一条、大小写不敏感子串、片段 12/40 → Task 2 + Task 1 ✓
- TocSheet 章节/全文 页签、主题自适应、结果高亮/空态/封顶提示 → Task 3（FullTextPanel）+ Task 4（tabs）✓
- 正文高亮、jumpToChapter term 参、非搜索导航清除 → Task 5 ✓
- 搜索源 searchBook 注入、跳转复用增量1 → Task 5 ✓
- OTA 安全、无新原生依赖 → Global Constraints ✓

**Placeholder scan：** 无 TBD/TODO；每个代码步骤含完整代码。

**Type consistency：** `SearchResult`/`SearchOutcome`（Task 2）在 Task 3/4/5 一致；`FullTextPanel` props（Task 3）与 TocSheet 使用（Task 4）一致；`onFullTextSearch`/`onSelectResult`（Task 4）与 ReaderScreen 传参（Task 5）一致；`splitHighlight`/`hexToRgba`（Task 1）在 Task 3/5 一致；`jumpToChapter(target, blockIndex, term)` 三参在 Task 5 定义、TocSheet onSelect（两处调用）兼容（少传的参用默认值）。

**测试边界（诚实标注）：** FlatList 滚动/遮罩揭开、PanResponder 等原生行为不在 Jest 执行——搜索/高亮的纯逻辑与组件交互（提交、结果、点选、高亮渲染）均可测；实际滚动落位与大文件性能由真机 verify。
