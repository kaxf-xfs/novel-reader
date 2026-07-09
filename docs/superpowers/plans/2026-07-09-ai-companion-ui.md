# AI 伴读 · UI + 三功能（Part B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Part A 基建之上做用户可见的「AI 伴读」：配置弹窗、伴读面板、阅读器入口，先跑通「问书」端到端竖切，再加「回顾」「人物」。

**Architecture:** 新增 `AiConfigProvider`/`useAiConfig`（仿 SettingsContext）承载本地 AI 配置；`companion.ts` 纯 prompt 构造 + `buildReadContext` 编排（防剧透地拼上下文）；`AiPanel`（底部 Modal，仿 ReaderSettingsSheet/FullTextPanel）注入 `run` 回调驱动，AiSettingsModal 输入并保存 key；ReaderScreen 底栏加「AI」按钮把真实 `run`（buildReadContext + chatComplete）接上。

**Tech Stack:** Expo SDK 57 · RN 0.86 · React 19.2 · TS strict · Jest 29 + jest-expo · RNTL 13 · `fetch`。

## Global Constraints

- **无新原生依赖 / 不改 package.json**（走 OTA）。
- 主题自适应：面板/弹窗颜色取 `resolveTheme(settings.themeId)`（`src/lib/settings/styles.ts`）。
- **防剧透（S1）**：`buildReadContext` 用 `cutoff = 当前章-1`；当前章只切 `splitBlocks(...).slice(0, off+1)`；`ensureSummaries`/`selectContext` 已保证不越界（Part A）。
- key 存本地（`ai-config.json`），`secureTextEntry` 只显末 4 位；首次外发前 `consentAt` 同意门控。
- 命令：`npx jest <path>`、`npx tsc --noEmit`。仓库根 `D:\Games\novel-reader`。

**Part A 已就绪的接口（本 Part 消费，勿重造）：**
- `src/lib/ai/config.ts`：`AiConfig{ baseUrl; apiKey; model; enabled; consentAt }`、`sanitizeAiConfig`、`loadAiConfig`、`saveAiConfig`。
- `src/lib/settings/expoSettingsGateway.ts`：`new ExpoSettingsGateway('ai-config.json')`。
- `src/lib/ai/client.ts`：`chatComplete({config,messages,signal?,maxTokens?,temperature?})` → `{content,finishReason}`；`AiError{kind}`；`ChatMessage`。
- `src/lib/ai/summarize.ts`：`ensureSummaries({chat,fs,repo},{book,chapters,cutoff,model,signal,onProgress})`、`SummarizeFn`、`ARC_SIZE`。
- `src/lib/ai/context.ts`：`selectContext({arcSummaries,chapterSummaries,currentChapterText,cutoff})`→`{contextText,includedChapterIdx,usedArcs}`。
- `src/lib/reader/blocks.ts`：`splitBlocks(text)`；`src/lib/reader/readChapter.ts`：`readChapterText(fs,path,chapter)`。

---

### Task 1: AiConfigContext（Provider + useAiConfig）+ App 接线

**Files:**
- Create: `src/settings/AiConfigContext.tsx`
- Create: `src/test-utils/renderWithAiConfig.tsx`
- Modify: `App.tsx`
- Test: `src/settings/__tests__/AiConfigContext.test.tsx`

**Interfaces:**
- Consumes: `AiConfig`/`loadAiConfig`/`saveAiConfig`/`sanitizeAiConfig`（config.ts）；`SettingsGateway`/`InMemorySettingsGateway`（store.ts）。
- Produces:
  - `AiConfigProvider({ gateway, children })`
  - `useAiConfig(): { aiConfig: AiConfig; ready: boolean; update: (patch: Partial<AiConfig>) => void }`
  - `renderWithAiConfig(ui, gateway?)` 测试帮助（返回 `{ ...RTL, gateway }`）

- [ ] **Step 1: 写失败测试**

Create `src/settings/__tests__/AiConfigContext.test.tsx`:

```tsx
import { Text, Pressable } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { InMemorySettingsGateway } from '../../lib/settings/store';
import { loadAiConfig } from '../../lib/ai/config';
import { renderWithAiConfig } from '../../test-utils/renderWithAiConfig';
import { useAiConfig } from '../AiConfigContext';

function Probe() {
  const { aiConfig, update } = useAiConfig();
  return (
    <>
      <Text testID="key">{aiConfig.apiKey}</Text>
      <Pressable testID="set" onPress={() => update({ apiKey: 'sk-123', enabled: true })}>
        <Text>set</Text>
      </Pressable>
    </>
  );
}

describe('AiConfigContext', () => {
  it('updates and persists ai config through the gateway', async () => {
    const gw = new InMemorySettingsGateway();
    const { getByTestId, findByTestId } = renderWithAiConfig(<Probe />, gw);
    await findByTestId('key');
    fireEvent.press(getByTestId('set'));
    await waitFor(() => expect(getByTestId('key').props.children).toBe('sk-123'));
    await waitFor(async () => expect((await loadAiConfig(gw)).apiKey).toBe('sk-123'));
  });
});
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/settings/__tests__/AiConfigContext.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: 实现 `src/settings/AiConfigContext.tsx`**

```tsx
/** 增量 5: 本地 AI 配置的 Context（仿 SettingsContext）。 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { DEFAULT_AI_CONFIG, loadAiConfig, sanitizeAiConfig, saveAiConfig, type AiConfig } from '../lib/ai/config';
import type { SettingsGateway } from '../lib/settings/store';

interface AiConfigContextValue {
  aiConfig: AiConfig;
  ready: boolean;
  update: (patch: Partial<AiConfig>) => void;
}

const AiConfigContext = createContext<AiConfigContextValue | null>(null);

export function AiConfigProvider({ gateway, children }: { gateway: SettingsGateway; children: ReactNode }) {
  const [aiConfig, setAiConfig] = useState<AiConfig>(DEFAULT_AI_CONFIG);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAiConfig(gateway).then((c) => {
      if (cancelled) return;
      setAiConfig(c);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  const update = useCallback(
    (patch: Partial<AiConfig>) => {
      setAiConfig((prev) => {
        const next = sanitizeAiConfig({ ...prev, ...patch });
        void saveAiConfig(gateway, next);
        return next;
      });
    },
    [gateway],
  );

  return <AiConfigContext.Provider value={{ aiConfig, ready, update }}>{children}</AiConfigContext.Provider>;
}

export function useAiConfig(): AiConfigContextValue {
  const ctx = useContext(AiConfigContext);
  if (!ctx) throw new Error('useAiConfig must be used within an AiConfigProvider');
  return ctx;
}
```

- [ ] **Step 4: 实现测试帮助 `src/test-utils/renderWithAiConfig.tsx`**

```tsx
import { render, type RenderResult } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { InMemorySettingsGateway } from '../lib/settings/store';
import { AiConfigProvider } from '../settings/AiConfigContext';

export interface RenderWithAiConfigResult extends RenderResult {
  gateway: InMemorySettingsGateway;
}

export function renderWithAiConfig(
  ui: ReactElement,
  gateway: InMemorySettingsGateway = new InMemorySettingsGateway(),
): RenderWithAiConfigResult {
  const result = render(<AiConfigProvider gateway={gateway}>{ui}</AiConfigProvider>);
  return { ...result, gateway };
}
```

- [ ] **Step 5: 跑到 GREEN**

Run: `npx jest src/settings/__tests__/AiConfigContext.test.tsx`
Expected: PASS.

- [ ] **Step 6: App.tsx 挂 Provider**

In `App.tsx`: add imports

```ts
import { ExpoSettingsGateway } from './src/lib/settings/expoSettingsGateway';
import { AiConfigProvider } from './src/settings/AiConfigContext';
```

Add an ai gateway instance next to the others:

```ts
  const aiGateway = useMemo(() => new ExpoSettingsGateway('ai-config.json'), []);
```

Wrap the existing tree inside `SettingsProvider` with `AiConfigProvider`:

```tsx
    <SettingsProvider gateway={settingsGateway}>
      <AiConfigProvider gateway={aiGateway}>
        <View style={styles.container}>
          {/* ...unchanged... */}
        </View>
      </AiConfigProvider>
    </SettingsProvider>
```

(`ExpoSettingsGateway` may already be imported — if so don't duplicate.)

- [ ] **Step 7: 校验 + 提交**

Run: `npx tsc --noEmit` → no errors. Run: `npx jest src/settings` → PASS.

```bash
git add src/settings/AiConfigContext.tsx src/test-utils/renderWithAiConfig.tsx src/settings/__tests__/AiConfigContext.test.tsx App.tsx
git commit -m "feat(ai): AiConfigProvider/useAiConfig + app wiring"
```

---

### Task 2: `companion.ts`（prompt 构造 + buildReadContext 编排）

**Files:**
- Create: `src/lib/ai/companion.ts`
- Test: `src/lib/ai/__tests__/companion.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`（client）；`SummarizeFn`/`ensureSummaries`/`ARC_SIZE`（summarize）；`selectContext`（context）；`readChapterText`（readChapter）；`splitBlocks`（blocks）；`BookRepository`/`BookRecord`/`ChapterRecord`（repository）；`FileGateway`（importBook）。
- Produces:
  - `type AiMode = 'recap' | 'ask' | 'character'`
  - `askBookMessages(context: string, question: string): ChatMessage[]`
  - `storySoFarMessages(context: string): ChatMessage[]`
  - `characterMessages(context: string, name: string): ChatMessage[]`
  - `interface BuildContextParams { book; chapters; currentChapterIndex; currentBlockIndex; model; signal?; onProgress? }`
  - `buildReadContext(deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository }, params: BuildContextParams): Promise<{ contextText: string; includedChapterIdx: number[] }>`

- [ ] **Step 1: 写失败测试**

Create `src/lib/ai/__tests__/companion.test.ts`:

```ts
import { FakeFileGateway, seedReader } from '../../../test-utils/fakes';
import { InMemoryBookRepository } from '../../import/repository';
import { askBookMessages, storySoFarMessages, characterMessages, buildReadContext } from '../companion';

describe('prompt builders', () => {
  it('askBookMessages embeds question + forbids spoilers', () => {
    const m = askBookMessages('CTX', '主角叫什么？');
    expect(m[0].role).toBe('system');
    expect(m[0].content).toMatch(/不.*剧透|尚未读到|已读/);
    expect(m[m.length - 1].content).toContain('主角叫什么？');
    expect(m[m.length - 1].content).toContain('CTX');
  });
  it('storySoFarMessages is a recap prompt over the context', () => {
    const m = storySoFarMessages('CTX');
    expect(m[0].content).toMatch(/回顾|前情/);
    expect(m[m.length - 1].content).toContain('CTX');
  });
  it('characterMessages embeds the name', () => {
    const m = characterMessages('CTX', '张三');
    expect(m[m.length - 1].content).toContain('张三');
  });
});

describe('buildReadContext (spoiler-safe)', () => {
  it('summarizes only 0..cur-1 and slices the current chapter to the read offset', async () => {
    const repo = new InMemoryBookRepository();
    const fs = new FakeFileGateway();
    const chapters = Array.from({ length: 5 }, (_, i) => ({ title: `第${i + 1}章`, body: `正文${i + 1}` }));
    const book = await seedReader(repo, fs, { bookId: 'b1', chapters });
    const chapterRecords = await repo.getChapters('b1');
    const chat = jest.fn(async () => 'SUM');

    const { contextText, includedChapterIdx } = await buildReadContext(
      { chat, fs, repo },
      { book, chapters: chapterRecords, currentChapterIndex: 3, currentBlockIndex: 0, model: 'm' },
    );

    // summaries only for chapters 0,1,2
    expect((await repo.listSummaries('b1', 0, 100)).map((s) => s.idx)).toEqual([0, 1, 2]);
    expect(await repo.getSummary('b1', 0, 3)).toBeNull();
    // included chapter idx never exceeds cutoff (2)
    expect(Math.max(...includedChapterIdx, -1)).toBeLessThanOrEqual(2);
    // current chapter (index 3) title appears via the read slice
    expect(contextText).toContain('第4章');
  });

  it('handles reading the very first chapter (cutoff -1, no summaries)', async () => {
    const repo = new InMemoryBookRepository();
    const fs = new FakeFileGateway();
    const book = await seedReader(repo, fs, { bookId: 'b1', chapters: [{ title: '第1章', body: '开头' }] });
    const chapterRecords = await repo.getChapters('b1');
    const chat = jest.fn(async () => 'SUM');
    const { includedChapterIdx } = await buildReadContext(
      { chat, fs, repo },
      { book, chapters: chapterRecords, currentChapterIndex: 0, currentBlockIndex: 0, model: 'm' },
    );
    expect(chat).not.toHaveBeenCalled();
    expect(includedChapterIdx).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/lib/ai/__tests__/companion.test.ts`
Expected: FAIL — `../companion` not found.

- [ ] **Step 3: 实现 `src/lib/ai/companion.ts`**

```ts
/**
 * 增量 5: 伴读 prompt 构造（纯）+ buildReadContext 编排（防剧透地拼上下文）。
 */

import type { BookRecord, BookRepository, ChapterRecord } from '../import/repository';
import type { FileGateway } from '../import/importBook';
import { splitBlocks } from '../reader/blocks';
import { readChapterText } from '../reader/readChapter';
import type { ChatMessage } from './client';
import { selectContext } from './context';
import { ARC_SIZE, ensureSummaries, type SummarizeFn } from './summarize';

export type AiMode = 'recap' | 'ask' | 'character';

const SPOILER_RULE =
  '下面【已读内容】是读者到目前为止读过的部分（更早章节的要点小结 + 当前章已读原文）。' +
  '只能依据【已读内容】作答，绝不能透露或推测读者尚未读到的后续情节。' +
  '若【已读内容】不足以回答，就直说「目前读到的部分还没有相关内容」。用简洁中文。';

export function askBookMessages(context: string, question: string): ChatMessage[] {
  return [
    { role: 'system', content: `你是读者的「已读伴读」助手。${SPOILER_RULE}` },
    { role: 'user', content: `【已读内容】\n${context}\n\n【问题】${question}` },
  ];
}

export function storySoFarMessages(context: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是「剧情回顾」助手。请根据【已读内容】写一段到当前进度为止的「前情提要」，${SPOILER_RULE} 控制在 200–400 字。`,
    },
    { role: 'user', content: `【已读内容】\n${context}` },
  ];
}

export function characterMessages(context: string, name: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是「人物档案」助手。请介绍读者指定的人物：他是谁、目前为止做过什么、与谁是什么关系。${SPOILER_RULE} 若还没出现，就说「目前读到的部分还没出现这个人物」。`,
    },
    { role: 'user', content: `【已读内容】\n${context}\n\n【人物】${name}` },
  ];
}

export interface BuildContextParams {
  book: BookRecord;
  chapters: ChapterRecord[];
  currentChapterIndex: number;
  currentBlockIndex: number;
  model: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export async function buildReadContext(
  deps: { chat: SummarizeFn; fs: FileGateway; repo: BookRepository },
  params: BuildContextParams,
): Promise<{ contextText: string; includedChapterIdx: number[] }> {
  const { chat, fs, repo } = deps;
  const { book, chapters, currentChapterIndex, currentBlockIndex, model, signal, onProgress } = params;
  const cutoff = currentChapterIndex - 1;

  await ensureSummaries({ chat, fs, repo }, { book, chapters, cutoff, model, signal, onProgress });

  const chapterSummaries = await repo.listSummaries(book.id, 0, cutoff);
  const lastArc = Math.floor((cutoff + 1) / ARC_SIZE) - 1;
  const arcSummaries = await repo.listSummaries(book.id, 1, lastArc);

  let currentChapterText = '';
  if (currentChapterIndex >= 0 && currentChapterIndex < chapters.length) {
    const raw = await readChapterText(fs, book.normalizedPath, chapters[currentChapterIndex]);
    currentChapterText = splitBlocks(raw).slice(0, currentBlockIndex + 1).join('\n');
  }

  const { contextText, includedChapterIdx } = selectContext({
    arcSummaries,
    chapterSummaries,
    currentChapterText,
    cutoff,
  });
  return { contextText, includedChapterIdx };
}
```

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/lib/ai/__tests__/companion.test.ts`
Expected: PASS.

- [ ] **Step 5: 校验 + 提交**

Run: `npx tsc --noEmit` → no errors.

```bash
git add src/lib/ai/companion.ts src/lib/ai/__tests__/companion.test.ts
git commit -m "feat(ai): companion prompt builders + spoiler-safe buildReadContext"
```

---

### Task 3: `AiSettingsModal`（配置输入 + 同意）

**Files:**
- Create: `src/settings/AiSettingsModal.tsx`
- Test: `src/settings/__tests__/AiSettingsModal.test.tsx`

**Interfaces:**
- Consumes: `useAiConfig`（Task 1）；`useSettings`+`resolveTheme`（主题）。
- Produces: `AiSettingsModal({ visible: boolean; onClose: () => void })`。testID：`ai-settings`、`ai-base-url`、`ai-api-key`、`ai-model`、`ai-enable`、`ai-save`。

- [ ] **Step 1: 写失败测试**

Create `src/settings/__tests__/AiSettingsModal.test.tsx`:

```tsx
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { InMemorySettingsGateway } from '../../lib/settings/store';
import { loadAiConfig } from '../../lib/ai/config';
import { AiConfigProvider } from '../AiConfigContext';
import { SettingsProvider } from '../SettingsContext';
import { InMemorySettingsGateway as SettingsGw } from '../../lib/settings/store';
import { AiSettingsModal } from '../AiSettingsModal';

function renderModal() {
  const aiGw = new InMemorySettingsGateway();
  const onClose = jest.fn();
  const utils = render(
    <SettingsProvider gateway={new SettingsGw()}>
      <AiConfigProvider gateway={aiGw}>
        <AiSettingsModal visible onClose={onClose} />
      </AiConfigProvider>
    </SettingsProvider>,
  );
  return { ...utils, aiGw, onClose };
}

describe('AiSettingsModal', () => {
  it('saves the entered api key + enable to the gateway', async () => {
    const { findByTestId, getByTestId, aiGw } = renderModal();
    fireEvent.changeText(await findByTestId('ai-api-key'), 'sk-abc');
    fireEvent.press(getByTestId('ai-enable'));
    fireEvent.press(getByTestId('ai-save'));
    await waitFor(async () => {
      const c = await loadAiConfig(aiGw);
      expect(c.apiKey).toBe('sk-abc');
      expect(c.enabled).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/settings/__tests__/AiSettingsModal.test.tsx`
Expected: FAIL — `../AiSettingsModal` not found.

- [ ] **Step 3: 实现 `src/settings/AiSettingsModal.tsx`**

```tsx
/** 增量 5: AI 配置弹窗——baseUrl / key（保密）/ model / 启用，本地保存 + 同意说明。 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { DEFAULT_AI_CONFIG } from '../lib/ai/config';
import { resolveTheme } from '../lib/settings/styles';
import { useAiConfig } from './AiConfigContext';
import { useSettings } from './SettingsContext';

export function AiSettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);
  const { aiConfig, update } = useAiConfig();

  const [baseUrl, setBaseUrl] = useState(aiConfig.baseUrl);
  const [apiKey, setApiKey] = useState(aiConfig.apiKey);
  const [model, setModel] = useState(aiConfig.model);
  const [enabled, setEnabled] = useState(aiConfig.enabled);

  // Resync when opened / config changes.
  useEffect(() => {
    if (visible) {
      setBaseUrl(aiConfig.baseUrl);
      setApiKey(aiConfig.apiKey);
      setModel(aiConfig.model);
      setEnabled(aiConfig.enabled);
    }
  }, [visible, aiConfig]);

  const save = () => {
    update({ baseUrl, apiKey, model, enabled });
    onClose();
  };

  const input = [styles.input, { color: theme.text, borderColor: theme.border }];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View testID="ai-settings" style={[styles.sheet, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.heading }]}>AI 设置</Text>

        <Text style={[styles.label, { color: theme.subtle }]}>服务地址（OpenAI 兼容）</Text>
        <TextInput testID="ai-base-url" style={input} value={baseUrl} onChangeText={setBaseUrl}
          placeholder={DEFAULT_AI_CONFIG.baseUrl} placeholderTextColor={theme.subtle} autoCapitalize="none" autoCorrect={false} />

        <Text style={[styles.label, { color: theme.subtle }]}>API Key</Text>
        <TextInput testID="ai-api-key" style={input} value={apiKey} onChangeText={setApiKey}
          placeholder="sk-…" placeholderTextColor={theme.subtle} secureTextEntry autoCapitalize="none" autoCorrect={false} />

        <Text style={[styles.label, { color: theme.subtle }]}>模型</Text>
        <TextInput testID="ai-model" style={input} value={model} onChangeText={setModel}
          placeholder={DEFAULT_AI_CONFIG.model} placeholderTextColor={theme.subtle} autoCapitalize="none" autoCorrect={false} />

        <View style={styles.row}>
          <Text style={[styles.label, { color: theme.text, marginBottom: 0 }]}>启用 AI 伴读</Text>
          <Switch testID="ai-enable" value={enabled} onValueChange={setEnabled} />
        </View>

        <Text style={[styles.note, { color: theme.subtle }]}>
          启用后，正文与章节小结会发送到你配置的 AI 服务。API Key 仅保存在本机。
        </Text>

        <Pressable testID="ai-save" onPress={save} style={[styles.save, { backgroundColor: theme.accent }]}>
          <Text style={styles.saveText}>保存</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: StyleSheet.hairlineWidth, padding: 22, paddingBottom: 40 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 12.5, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 14 },
  save: { marginTop: 20, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
```

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/settings/__tests__/AiSettingsModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: 校验 + 提交**

Run: `npx tsc --noEmit` → no errors.

```bash
git add src/settings/AiSettingsModal.tsx src/settings/__tests__/AiSettingsModal.test.tsx
git commit -m "feat(ai): AiSettingsModal — local key/baseUrl/model + enable + consent note"
```

---

### Task 4: `AiPanel`（问书竖切 + 各态，注入 run）

**Files:**
- Create: `src/reader/AiPanel.tsx`
- Test: `src/reader/__tests__/AiPanel.test.tsx`

**Interfaces:**
- Consumes: `AiMode`（companion）；`AiError`（client）；`useSettings`+`resolveTheme`。
- Produces:
  - `interface AiRunParams { mode: AiMode; input: string; onProgress: (done: number, total: number) => void; signal: AbortSignal }`
  - `interface AiPanelProps { visible; onClose; configured: boolean; consented: boolean; onOpenSettings: () => void; onConsent: () => void; run: (p: AiRunParams) => Promise<string> }`
  - `AiPanel(props)`。testID：`ai-panel`、`ai-need-config`、`ai-open-settings`、`ai-consent`、`ai-ask-input`、`ai-submit`、`ai-progress`、`ai-cancel`、`ai-result`、`ai-error`。本 Task 只启用 `ask` 模式（tab 结构留给 Task 6 扩展）。

- [ ] **Step 1: 写失败测试**

Create `src/reader/__tests__/AiPanel.test.tsx`:

```tsx
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithSettings } from '../../test-utils/render';
import { AiError } from '../../lib/ai/client';
import { AiPanel } from '../AiPanel';

const base = {
  visible: true, onClose: jest.fn(), configured: true, consented: true,
  onOpenSettings: jest.fn(), onConsent: jest.fn(),
  run: jest.fn(async () => '答案'),
};

describe('AiPanel', () => {
  it('shows the config gate when not configured', async () => {
    const onOpenSettings = jest.fn();
    const { findByTestId, getByTestId } = renderWithSettings(
      <AiPanel {...base} configured={false} onOpenSettings={onOpenSettings} />,
    );
    fireEvent.press(await findByTestId('ai-open-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(() => getByTestId('ai-ask-input')).toThrow();
  });

  it('shows the consent gate when configured but not consented', async () => {
    const onConsent = jest.fn();
    const { findByTestId } = renderWithSettings(
      <AiPanel {...base} consented={false} onConsent={onConsent} />,
    );
    fireEvent.press(await findByTestId('ai-consent'));
    expect(onConsent).toHaveBeenCalled();
  });

  it('runs an ask and renders the result', async () => {
    const run = jest.fn(async () => '主角是张三');
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} run={run} />);
    fireEvent.changeText(await findByTestId('ai-ask-input'), '主角是谁？');
    fireEvent.press(getByTestId('ai-submit'));
    expect(await findByTestId('ai-result')).toHaveTextContent('主角是张三');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ask', input: '主角是谁？' }));
  });

  it('shows a friendly error when run rejects with an AiError', async () => {
    const run = jest.fn(async () => {
      throw new AiError('insufficient-balance', 'no balance', 402);
    });
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} run={run} />);
    fireEvent.changeText(await findByTestId('ai-ask-input'), 'x');
    fireEvent.press(getByTestId('ai-submit'));
    expect(await findByTestId('ai-error')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/reader/__tests__/AiPanel.test.tsx`
Expected: FAIL — `../AiPanel` not found.

- [ ] **Step 3: 实现 `src/reader/AiPanel.tsx`**

```tsx
/** 增量 5: AI 伴读面板（底部 Modal）。注入 run 回调驱动；各态：未配置/未同意/进度/生成/结果/错误。 */
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiError } from '../lib/ai/client';
import type { AiMode } from '../lib/ai/companion';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

export interface AiRunParams {
  mode: AiMode;
  input: string;
  onProgress: (done: number, total: number) => void;
  signal: AbortSignal;
}

export interface AiPanelProps {
  visible: boolean;
  onClose: () => void;
  configured: boolean;
  consented: boolean;
  onOpenSettings: () => void;
  onConsent: () => void;
  run: (p: AiRunParams) => Promise<string>;
}

function errorText(e: unknown): string {
  if (e instanceof AiError) {
    switch (e.kind) {
      case 'no-key': return '还没配置 API Key，请先到 AI 设置填写。';
      case 'cancelled': return '已取消。';
      case 'timeout': return '请求超时，请重试。';
      case 'insufficient-balance': return 'API 余额不足。';
      case 'rate-limited': return '请求过于频繁，请稍后再试。';
      case 'network': return '网络错误，请检查连接。';
      default: return 'AI 请求失败，请重试。';
    }
  }
  return 'AI 请求失败，请重试。';
}

export function AiPanel({ visible, onClose, configured, consented, onOpenSettings, onConsent, run }: AiPanelProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const submit = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setProgress(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const answer = await run({
        mode: 'ask',
        input: q,
        onProgress: (done, total) => setProgress({ done, total }),
        signal: ctrl.signal,
      });
      setResult(answer);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const body = () => {
    if (!configured) {
      return (
        <View testID="ai-need-config" style={styles.center}>
          <Text style={[styles.hint, { color: theme.subtle }]}>还没配置 AI。填入你的 API Key 即可开始。</Text>
          <Pressable testID="ai-open-settings" onPress={onOpenSettings} style={[styles.primary, { backgroundColor: theme.accent }]}>
            <Text style={styles.primaryText}>去设置</Text>
          </Pressable>
        </View>
      );
    }
    if (!consented) {
      return (
        <View testID="ai-consent-gate" style={styles.center}>
          <Text style={[styles.hint, { color: theme.subtle }]}>
            使用 AI 伴读会把「已读」正文与小结发送到你配置的服务。仅发送到当前阅读进度为止的内容。
          </Text>
          <Pressable testID="ai-consent" onPress={onConsent} style={[styles.primary, { backgroundColor: theme.accent }]}>
            <Text style={styles.primaryText}>同意并继续</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.flex}>
        <TextInput
          testID="ai-ask-input"
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          placeholder="问一个关于已读内容的问题…"
          placeholderTextColor={theme.subtle}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={submit}
          editable={!busy}
          returnKeyType="send"
        />
        <Pressable testID="ai-submit" onPress={submit} disabled={busy} style={[styles.primary, { backgroundColor: theme.accent, opacity: busy ? 0.5 : 1 }]}>
          <Text style={styles.primaryText}>提问</Text>
        </Pressable>
        {busy && (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            {progress && (
              <Text testID="ai-progress" style={[styles.hint, { color: theme.subtle }]}>
                正在整理已读章节… {progress.done}/{progress.total}
              </Text>
            )}
            <Pressable testID="ai-cancel" onPress={cancel} hitSlop={10}>
              <Text style={[styles.cancel, { color: theme.subtle }]}>取消</Text>
            </Pressable>
          </View>
        )}
        {error && <Text testID="ai-error" style={[styles.error, { color: theme.accent }]}>{error}</Text>}
        {result && (
          <ScrollView style={styles.flex}>
            <Text testID="ai-result" style={[styles.result, { color: theme.text }]}>{result}</Text>
          </ScrollView>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View testID="ai-panel" style={[styles.sheet, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.heading }]}>AI 伴读</Text>
        {body()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '72%', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: StyleSheet.hairlineWidth, padding: 22, paddingBottom: 30 },
  flex: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 14 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 14 },
  hint: { fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  primary: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cancel: { fontSize: 13, textDecorationLine: 'underline' },
  error: { fontSize: 14, marginTop: 16, textAlign: 'center' },
  result: { fontSize: 15.5, lineHeight: 25, marginTop: 16 },
});
```

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/reader/__tests__/AiPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: 校验 + 提交**

Run: `npx tsc --noEmit` → no errors.

```bash
git add src/reader/AiPanel.tsx src/reader/__tests__/AiPanel.test.tsx
git commit -m "feat(ai): AiPanel — ask mode + config/consent/progress/result/error/cancel states"
```

---

### Task 5: 阅读器入口 + 真实 run 接线

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`
- Test: `src/screens/__tests__/ReaderScreen.test.tsx`（补一条 render-smoke）

**Interfaces:**
- Consumes: `useAiConfig`（Task 1）；`AiPanel`/`AiRunParams`（Task 4）；`AiSettingsModal`（Task 3）；`buildReadContext`/`askBookMessages`/`storySoFarMessages`/`characterMessages`（Task 2）；`chatComplete`（client）；`SummarizeFn`（summarize）。
- Produces: 阅读器底栏「AI」按钮 → 打开 `AiPanel`；真实 `run` 用 `buildReadContext` + `chatComplete`。

- [ ] **Step 1: 写 render-smoke 失败测试**

Add to `src/screens/__tests__/ReaderScreen.test.tsx`（在现有 describe 内加一条；沿用该文件已有的 seed/render 帮助，参照文件里既有用例的渲染方式，并在渲染树外层包一个 `AiConfigProvider`（`import { AiConfigProvider } from '../../settings/AiConfigContext'` + `InMemorySettingsGateway`）——因为 ReaderScreen 现在会 `useAiConfig`）：

```tsx
  it('shows the AI bottom-bar button after tapping to reveal chrome', async () => {
    // render the reader (reuse this file's existing seed+render helper), then:
    // tap the surface to reveal chrome, and assert an 'AI' BarButton exists.
    // (Follow the existing chrome-reveal pattern already used in this test file.)
  });
```

> Implementer: this file already renders `ReaderScreen` with seeded repo/fs. Wrap that render in `AiConfigProvider` (InMemory gateway) so `useAiConfig` resolves, reveal chrome the same way existing tests do, and assert `findByText('AI')` in the bottom bar. If chrome-reveal is awkward in jsdom, assert the AI panel wiring compiles by asserting the reader renders without crashing under the provider (a mount+unmount smoke). Keep it green and non-flaky.

- [ ] **Step 2: 跑到 RED / 确认现有用例**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx`
Expected: 现有用例可能因 `useAiConfig` 缺 Provider 而报错 → 说明需要接线（下一步）。

- [ ] **Step 3: 接线 ReaderScreen**

Add imports:

```ts
import { useAiConfig } from '../settings/AiConfigContext';
import { AiPanel, type AiRunParams } from '../reader/AiPanel';
import { AiSettingsModal } from '../settings/AiSettingsModal';
import { buildReadContext, askBookMessages, storySoFarMessages, characterMessages } from '../lib/ai/companion';
import { chatComplete, type SummarizeFn } from '../lib/ai/client';
```

> Note: `SummarizeFn` is exported from `../lib/ai/summarize`, not client. Import it from `../lib/ai/summarize`.

Inside `ReaderScreen`, near other hooks:

```ts
  const { aiConfig, update: updateAiConfig } = useAiConfig();
  const [showAi, setShowAi] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);

  const runAi = useCallback(
    async ({ mode, input, onProgress, signal }: AiRunParams): Promise<string> => {
      if (!book || !chapters) throw new Error('book not loaded');
      const chat: SummarizeFn = async (messages, sig) =>
        (await chatComplete({ config: aiConfig, messages, signal: sig, maxTokens: 400, temperature: 0.3 })).content;
      const { contextText } = await buildReadContext(
        { chat, fs, repo },
        {
          book,
          chapters,
          currentChapterIndex,
          currentBlockIndex: currentBlockIndexRef.current,
          model: aiConfig.model,
          signal,
          onProgress,
        },
      );
      const messages =
        mode === 'ask' ? askBookMessages(contextText, input)
        : mode === 'recap' ? storySoFarMessages(contextText)
        : characterMessages(contextText, input);
      const res = await chatComplete({ config: aiConfig, messages, signal, temperature: 0.4 });
      return res.content;
    },
    [aiConfig, book, chapters, currentChapterIndex, fs, repo],
  );
```

Add an「AI」BarButton to the bottom bar (after「排版」or before it):

```tsx
          <BarButton label="AI" color={rs.theme.accent} onPress={() => setShowAi(true)} />
```

Render the panel + settings modal near the other sheets:

```tsx
      <AiPanel
        visible={showAi}
        onClose={() => setShowAi(false)}
        configured={aiConfig.enabled && aiConfig.apiKey.length > 0}
        consented={aiConfig.consentAt !== null}
        onOpenSettings={() => { setShowAi(false); setShowAiSettings(true); }}
        onConsent={() => updateAiConfig({ consentAt: Date.now() })}
        run={runAi}
      />
      <AiSettingsModal visible={showAiSettings} onClose={() => setShowAiSettings(false)} />
```

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx`
Expected: PASS（现有用例在 AiConfigProvider 下恢复绿；新 smoke 绿）。

- [ ] **Step 5: 校验 + 提交**

Run: `npx tsc --noEmit` → no errors. Run: `npx jest src/screens src/reader` → PASS.

```bash
git add src/screens/ReaderScreen.tsx src/screens/__tests__/ReaderScreen.test.tsx
git commit -m "feat(ai): reader AI entry + real run wiring (buildReadContext + chatComplete)"
```

---

### Task 6: 「回顾」+「人物」两模式

**Files:**
- Modify: `src/reader/AiPanel.tsx`
- Test: `src/reader/__tests__/AiPanel.test.tsx`

**Interfaces:**
- Consumes: 已有 `run`（支持 `mode: 'recap' | 'ask' | 'character'`，Task 2/5 已就绪）。
- Produces: AiPanel 顶部三模式切换 `回顾 / 问书 / 人物`；`recap` 无输入直接「生成」，`ask`/`character` 有输入框（人物 placeholder 改为「输入人物名」）。testID：`ai-tab-recap`、`ai-tab-ask`、`ai-tab-character`、`ai-generate`（recap 的生成按钮）。

- [ ] **Step 1: 写失败测试**

Add to `src/reader/__tests__/AiPanel.test.tsx`:

```tsx
  it('runs recap mode with no input via the generate button', async () => {
    const run = jest.fn(async () => '前情提要…');
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} run={run} />);
    fireEvent.press(await findByTestId('ai-tab-recap'));
    fireEvent.press(getByTestId('ai-generate'));
    expect(await findByTestId('ai-result')).toHaveTextContent('前情提要');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'recap' }));
  });

  it('runs character mode with a name', async () => {
    const run = jest.fn(async () => '张三是…');
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} run={run} />);
    fireEvent.press(await findByTestId('ai-tab-character'));
    fireEvent.changeText(getByTestId('ai-ask-input'), '张三');
    fireEvent.press(getByTestId('ai-submit'));
    expect(await findByTestId('ai-result')).toHaveTextContent('张三是');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'character', input: '张三' }));
  });
```

- [ ] **Step 2: 跑到 RED**

Run: `npx jest src/reader/__tests__/AiPanel.test.tsx`
Expected: FAIL — tabs / generate 不存在。

- [ ] **Step 3: 改 AiPanel 加模式切换**

Add `mode` state and a tab row above the input; drive `submit`/generate by mode. Full replacement of the authenticated body (`configured && consented` branch) and the submit function:

```tsx
  const [mode, setMode] = useState<AiMode>('ask');

  const runMode = async (m: AiMode, text: string) => {
    if (busy) return;
    if ((m === 'ask' || m === 'character') && !text.trim()) return;
    setBusy(true); setResult(null); setError(null); setProgress(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const answer = await run({ mode: m, input: text.trim(), onProgress: (d, t) => setProgress({ done: d, total: t }), signal: ctrl.signal });
      setResult(answer);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false); setProgress(null); abortRef.current = null;
    }
  };
```

Replace the previous `submit` usages: the ask/character input submit calls `runMode(mode, input)`; the recap generate button calls `runMode('recap', '')`.

Tabs (place at top of the authenticated body):

```tsx
        <View style={styles.tabs}>
          {([['recap', '回顾'], ['ask', '问书'], ['character', '人物']] as const).map(([m, label]) => (
            <Pressable key={m} testID={`ai-tab-${m}`} onPress={() => { setMode(m); setResult(null); setError(null); }}
              style={[styles.tab, mode === m && { backgroundColor: theme.accent }]}>
              <Text style={[styles.tabText, { color: mode === m ? '#fff' : theme.subtle }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
```

Below tabs: if `mode === 'recap'` show a generate button; else show the input + 提问 button:

```tsx
        {mode === 'recap' ? (
          <Pressable testID="ai-generate" onPress={() => runMode('recap', '')} disabled={busy}
            style={[styles.primary, { backgroundColor: theme.accent, opacity: busy ? 0.5 : 1 }]}>
            <Text style={styles.primaryText}>生成回顾</Text>
          </Pressable>
        ) : (
          <>
            <TextInput testID="ai-ask-input" style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              placeholder={mode === 'character' ? '输入人物名…' : '问一个关于已读内容的问题…'}
              placeholderTextColor={theme.subtle} value={input} onChangeText={setInput}
              onSubmitEditing={() => runMode(mode, input)} editable={!busy} returnKeyType="send" />
            <Pressable testID="ai-submit" onPress={() => runMode(mode, input)} disabled={busy}
              style={[styles.primary, { backgroundColor: theme.accent, opacity: busy ? 0.5 : 1 }]}>
              <Text style={styles.primaryText}>{mode === 'character' ? '查人物' : '提问'}</Text>
            </Pressable>
          </>
        )}
```

Add styles:

```ts
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 9 },
  tabText: { fontSize: 13.5, fontWeight: '600' },
```

(Keep the busy/progress/error/result blocks unchanged; remove the now-unused standalone `submit` if fully replaced by `runMode`.)

- [ ] **Step 4: 跑到 GREEN**

Run: `npx jest src/reader/__tests__/AiPanel.test.tsx`
Expected: PASS（含新增两条 + 原有四条）。

- [ ] **Step 5: 校验 + 提交**

Run: `npx tsc --noEmit` → no errors.

```bash
git add src/reader/AiPanel.tsx src/reader/__tests__/AiPanel.test.tsx
git commit -m "feat(ai): AiPanel recap + character modes (tabs)"
```

---

### Task 7: 收尾 + 真机验证

**Files:**（无新增；仅验证）

- [ ] **Step 1: 全量校验**

Run: `npx tsc --noEmit` → no errors.
Run: `npm test` → 全绿、0 act 警告。
Run: `npx expo export --platform ios` → `Exported: dist`，无 bundling 错误。

- [ ] **Step 2: 提交（若上一步有任何 lint/格式微调）**

```bash
git add -A
git commit -m "chore(ai): finalize AI companion Part B (verify green)" || echo "nothing to commit"
```

- [ ] **Step 3: 真机验证（用户，DeepSeek key）**

- 阅读器底栏「AI」→ 面板；未配置 → 去设置填 `D:\Games\API_KEY.txt` 的 key、baseUrl `https://api.deepseek.com`、model `deepseek-chat`、启用 → 保存。
- 首次 → 同意门 → 同意。
- 读到中段某章：「问书」问一个只有后文才知的 → 应答「还没读到」；问已读情节 → 答准确。
- 「回顾」→ 到当前进度为止的前情提要，不含当前章未读后半。
- 「人物」→ 输名 → 档案不剧透。
- 千章书首次 → 面板显示「正在整理已读章节… done/total」，可「取消」。
- 换 model/baseUrl → 生效并触发重建；删书 → 其小结随之清除（Part A 已保证）。

---

## Self-Review

**1. Spec coverage：** AiConfig context+app → T1 ✓；companion prompt+防剧透 buildReadContext → T2 ✓；AiSettingsModal（key/baseUrl/model/启用/同意说明）→ T3 ✓；AiPanel 问书竖切+各态 → T4 ✓；阅读器入口+真实 run → T5 ✓；回顾+人物 → T6 ✓；收尾+真机 → T7 ✓。

**2. Placeholder scan：** T1/T2/T3/T4/T6 均含完整代码/断言。T5 的接线基于现有 ReaderScreen 结构给出确切 import/state/JSX/回调，唯 render-smoke 测试因 ReaderScreen 测试文件较复杂，指示实现者复用该文件既有 seed/render 帮助并在外层包 `AiConfigProvider`（给了确切原因与断言目标）——属可执行指示，非占位。

**3. Type consistency：** `AiMode`（'recap'|'ask'|'character'，companion 定义，AiPanel/ReaderScreen 消费）、`AiRunParams`/`AiPanelProps`（AiPanel）、`buildReadContext` 签名（companion）、`SummarizeFn`（summarize，注意从 summarize 导入而非 client）、`useAiConfig` 返回 `{aiConfig,ready,update}` 前后一致；`chatComplete` 用法与 Part A 一致。

**注意（实现者）：** T5 的 `SummarizeFn` 从 `../lib/ai/summarize` 导入（不是 client）；`chat` 传给 `buildReadContext`/`ensureSummaries` 的签名是 `(messages, signal?) => Promise<string>`，用 `chatComplete(...).content` 适配；小结与最终回答都传 `signal` 以支持取消。
