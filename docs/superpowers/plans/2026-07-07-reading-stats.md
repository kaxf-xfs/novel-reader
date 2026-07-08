# 阅读时长统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 记录真实阅读时长并在一个专属「阅读统计」页展示总时长、今日/本周、连续打卡、每本书累计。

**Architecture:** 纯逻辑三件套（会话状态机 `sessionTracker` + 聚合 `aggregate` + `ReadingSession` 持久化）严格单测；`useReadingSession` hook 把状态机接进 `ReaderScreen`（onScroll→activity、AppState/空闲/卸载→flush→落库）；`StatsScreen`（极简卡片流，主题自适应）与书架卡片消费聚合结果。

**Tech Stack:** Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript strict · Jest 29 + jest-expo · @testing-library/react-native 13.

## Global Constraints

- **无新原生依赖**：只用 `AppState`（RN 内置）、`expo-sqlite`（已用）、`Date`。禁止改 `package.json` 依赖 —— 必须走 OTA。
- **主题自适应**：统计页所有颜色来自 `resolveTheme(settings.themeId)`（`src/lib/settings/styles.ts`），不写死配色。
- **纯逻辑与 React 解耦**：`sessionTracker`/`aggregate` 不 import `react` 或 `react-native`，便于严格单测。
- 计时口径：前台计时；连续 **3 分钟（IDLE_TIMEOUT_MS = 180000）** 无操作暂停；切后台立即结算；单段 **< 5 秒（MIN_SESSION_MS = 5000）** 丢弃。
- 路径别名 `@/*` → `src/*` 已配；测试用 `InMemoryBookRepository` + `FakeFileGateway`（`src/test-utils/fakes.ts`）。
- SQLite 生产实现**不做单测**（原生模块不在 Jest 环境跑）；靠 tsc strict 保证类型，逻辑覆盖走 `InMemoryBookRepository`。

---

## File Structure

- `src/lib/import/repository.ts` (Modify) — 加 `ReadingSession` 类型、`BookRepository.addSession/listSessions`、`InMemoryBookRepository` 实现。
- `src/lib/import/sqliteRepository.ts` (Modify) — `reading_sessions` 表 DDL + `addSession/listSessions`。
- `src/lib/stats/aggregate.ts` (Create) — 纯聚合函数（total/today/week/streak/buckets/perBook/format）。
- `src/lib/stats/sessionTracker.ts` (Create) — 纯会话状态机。
- `src/reader/useReadingSession.ts` (Create) — React hook：状态机 + AppState + 空闲 interval + flush 落库。
- `src/screens/ReaderScreen.tsx` (Modify) — 接 hook：`onScroll` 触发 activity、`persist` 落库。
- `src/screens/StatsScreen.tsx` (Create) — 极简卡片流统计页。
- `App.tsx` (Modify) — `Screen` 联合加 `stats`，渲染 `StatsScreen`，给 `LibraryScreen` 传 `onOpenStats`。
- `src/screens/LibraryScreen.tsx` (Modify) — 顶栏统计入口按钮 + 卡片/行显示单本 "读了 Xh"。
- 测试：`src/lib/stats/__tests__/aggregate.test.ts`、`src/lib/stats/__tests__/sessionTracker.test.ts`、`src/reader/__tests__/useReadingSession.test.tsx`、`src/screens/__tests__/StatsScreen.test.tsx`、`src/lib/import/__tests__/repository.session.test.ts`，并扩展 `LibraryScreen.test.tsx`。

---

### Task 1: ReadingSession 持久化（repository）

**Files:**
- Modify: `src/lib/import/repository.ts`
- Modify: `src/lib/import/sqliteRepository.ts`
- Test: `src/lib/import/__tests__/repository.session.test.ts`

**Interfaces:**
- Produces:
  - `interface ReadingSession { id: string; bookId: string; startedAt: number; durationMs: number }`
  - `BookRepository.addSession(s: ReadingSession): Promise<void>`
  - `BookRepository.listSessions(): Promise<ReadingSession[]>`（返回全部，不排序保证；调用方自行聚合）

- [ ] **Step 1: Write the failing test**

Create `src/lib/import/__tests__/repository.session.test.ts`:

```ts
import { InMemoryBookRepository, type ReadingSession } from '../repository';

function session(over: Partial<ReadingSession> = {}): ReadingSession {
  return { id: 's1', bookId: 'b1', startedAt: 1000, durationMs: 60000, ...over };
}

describe('InMemoryBookRepository reading sessions', () => {
  it('adds and lists sessions', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addSession(session({ id: 's1', durationMs: 60000 }));
    await repo.addSession(session({ id: 's2', durationMs: 30000 }));
    const all = await repo.listSessions();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('cascades session deletion when the book is deleted', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBook({
      id: 'b1', title: 'T', originalName: 'T.txt', encoding: 'utf-8', sizeBytes: 1,
      importedAt: 1, coverColor: '#000', strategy: 'regex', normalizedPath: '/p',
    });
    await repo.addSession(session({ id: 's1', bookId: 'b1' }));
    await repo.addSession(session({ id: 's2', bookId: 'b2' }));
    await repo.deleteBook('b1');
    const all = await repo.listSessions();
    expect(all.map((s) => s.id)).toEqual(['s2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/import/__tests__/repository.session.test.ts`
Expected: FAIL — `addSession` / `listSessions` do not exist on `InMemoryBookRepository`; `ReadingSession` not exported.

- [ ] **Step 3: Implement in `repository.ts`**

Add the type after the `Bookmark` interface:

```ts
export interface ReadingSession {
  id: string;
  bookId: string;
  /** Unix ms of when this active segment started (used to attribute the local day). */
  startedAt: number;
  /** Active reading milliseconds accrued in this segment. */
  durationMs: number;
}
```

Add to the `BookRepository` interface:

```ts
  /** 追加一段阅读会话时长。 */
  addSession(s: ReadingSession): Promise<void>;
  /** 返回全部阅读会话（顺序不保证；调用方自行聚合）。 */
  listSessions(): Promise<ReadingSession[]>;
```

In `InMemoryBookRepository` add a field and methods, and extend `deleteBook`:

```ts
  private sessions: ReadingSession[] = [];
```

```ts
  async addSession(s: ReadingSession): Promise<void> {
    this.sessions.push({ ...s });
  }

  async listSessions(): Promise<ReadingSession[]> {
    return this.sessions.map((s) => ({ ...s }));
  }
```

Inside the existing `deleteBook(bookId)` body, after the bookmark cleanup loop, add:

```ts
    this.sessions = this.sessions.filter((s) => s.bookId !== bookId);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/import/__tests__/repository.session.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the SQLite side (not unit-tested)**

In `src/lib/import/sqliteRepository.ts`:

Import the type: add `ReadingSession` to the existing `import type { … } from './repository';` list.

Add DDL constant after `CREATE_BOOKMARKS_TABLE`:

```ts
const CREATE_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS reading_sessions (
    id         TEXT PRIMARY KEY,
    bookId     TEXT NOT NULL,
    startedAt  INTEGER NOT NULL,
    durationMs INTEGER NOT NULL,
    FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
  );
`;

const CREATE_SESSIONS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_sessions_startedAt
    ON reading_sessions (startedAt);
`;
```

In `open()`, extend the `execAsync` DDL concatenation to include the two new statements:

```ts
    await db.execAsync(
      CREATE_BOOKS_TABLE +
        CREATE_CHAPTERS_TABLE +
        CREATE_CHAPTERS_INDEX +
        CREATE_PROGRESS_TABLE +
        CREATE_BOOKMARKS_TABLE +
        CREATE_SESSIONS_TABLE +
        CREATE_SESSIONS_INDEX,
    );
```

Add the two methods (place them after `deleteBookmark`):

```ts
  async addSession(s: ReadingSession): Promise<void> {
    const db = await this.dbPromise;
    await db.runAsync(
      `INSERT OR REPLACE INTO reading_sessions (id, bookId, startedAt, durationMs)
       VALUES (?, ?, ?, ?)`,
      s.id,
      s.bookId,
      s.startedAt,
      s.durationMs,
    );
  }

  async listSessions(): Promise<ReadingSession[]> {
    const db = await this.dbPromise;
    type Row = { id: string; bookId: string; startedAt: number; durationMs: number };
    const rows = await db.getAllAsync<Row>('SELECT * FROM reading_sessions');
    return rows.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
    }));
  }
```

- [ ] **Step 6: Verify types + full suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx jest src/lib/import`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/import/repository.ts src/lib/import/sqliteRepository.ts src/lib/import/__tests__/repository.session.test.ts
git commit -m "feat(stats): ReadingSession type + repository add/list + reading_sessions table"
```

---

### Task 2: 聚合模块 `aggregate.ts`

**Files:**
- Create: `src/lib/stats/aggregate.ts`
- Test: `src/lib/stats/__tests__/aggregate.test.ts`

**Interfaces:**
- Consumes: `ReadingSession` from `src/lib/import/repository.ts`.
- Produces (all pure, no react/react-native imports):
  - `dayNumber(ms: number): number` — TZ 无关的本地日序号（`Math.floor(Date.UTC(y,m,d)/86400000)`）。
  - `totalMs(sessions): number`
  - `todayMs(sessions, now: number): number`
  - `thisWeekMs(sessions, now: number): number` — 周一为周首。
  - `activeDays(sessions): number`
  - `currentStreak(sessions, now: number): number`
  - `longestStreak(sessions): number`
  - `dailyBuckets(sessions, now: number, days?: number): number[]` — 长度 `days`（默认 14），index 0 最旧、末位今天。
  - `perBookMs(sessions): Map<string, number>`
  - `averageDailyMs(sessions): number` — `total / activeDays`（无则 0）。
  - `formatDuration(ms: number): string` — `< 1 分` / `M 分` / `H.h 小时`(<10h,去尾零) / `H 小时`(≥10h)。

- [ ] **Step 1: Write the failing test**

Create `src/lib/stats/__tests__/aggregate.test.ts`:

```ts
import type { ReadingSession } from '../../import/repository';
import {
  dayNumber, totalMs, todayMs, thisWeekMs, activeDays,
  currentStreak, longestStreak, dailyBuckets, perBookMs, averageDailyMs, formatDuration,
} from '../aggregate';

const MIN = 60_000;
const HOUR = 3_600_000;

// A fixed local wall-clock reference: 2026-07-07 (Tuesday) 10:00 local.
function at(y: number, m: number, d: number, h = 10): number {
  return new Date(y, m - 1, d, h, 0, 0).getTime();
}
function sess(startedAt: number, durationMs: number, bookId = 'b1', id = String(startedAt)): ReadingSession {
  return { id, bookId, startedAt, durationMs };
}

describe('dayNumber', () => {
  it('is stable within a local day and +1 across days', () => {
    expect(dayNumber(at(2026, 7, 7, 23))).toBe(dayNumber(at(2026, 7, 7, 1)));
    expect(dayNumber(at(2026, 7, 8, 0)) - dayNumber(at(2026, 7, 7, 0))).toBe(1);
  });
});

describe('totalMs / todayMs / thisWeekMs', () => {
  const now = at(2026, 7, 7, 10); // Tuesday
  const sessions = [
    sess(at(2026, 7, 7, 9), 30 * MIN),  // today
    sess(at(2026, 7, 6, 20), 20 * MIN), // yesterday (Mon, same week)
    sess(at(2026, 6, 30, 20), 40 * MIN),// last week (prev Tue)
  ];
  it('sums everything', () => {
    expect(totalMs(sessions)).toBe(90 * MIN);
  });
  it('sums only today', () => {
    expect(todayMs(sessions, now)).toBe(30 * MIN);
  });
  it('sums Monday..today for this week', () => {
    expect(thisWeekMs(sessions, now)).toBe(50 * MIN); // today + Monday
  });
});

describe('activeDays / streaks', () => {
  const now = at(2026, 7, 7, 10);
  it('counts distinct active days', () => {
    const s = [sess(at(2026, 7, 7, 9), MIN), sess(at(2026, 7, 7, 22), MIN), sess(at(2026, 7, 5, 9), MIN)];
    expect(activeDays(s)).toBe(2);
  });
  it('current streak counts back from today', () => {
    const s = [sess(at(2026, 7, 7, 9), MIN), sess(at(2026, 7, 6, 9), MIN), sess(at(2026, 7, 5, 9), MIN)];
    expect(currentStreak(s, now)).toBe(3);
  });
  it('current streak still holds when today is empty but yesterday read', () => {
    const s = [sess(at(2026, 7, 6, 9), MIN), sess(at(2026, 7, 5, 9), MIN)];
    expect(currentStreak(s, now)).toBe(2);
  });
  it('current streak is 0 when neither today nor yesterday read', () => {
    const s = [sess(at(2026, 7, 4, 9), MIN)];
    expect(currentStreak(s, now)).toBe(0);
  });
  it('longest streak finds the longest run', () => {
    const s = [
      sess(at(2026, 7, 1, 9), MIN), sess(at(2026, 7, 2, 9), MIN), sess(at(2026, 7, 3, 9), MIN),
      sess(at(2026, 7, 6, 9), MIN), // gap then single
    ];
    expect(longestStreak(s)).toBe(3);
  });
});

describe('dailyBuckets', () => {
  it('places sessions into last-N-day buckets, last = today', () => {
    const now = at(2026, 7, 7, 10);
    const s = [sess(at(2026, 7, 7, 9), 5 * MIN), sess(at(2026, 7, 6, 9), 3 * MIN), sess(at(2026, 6, 1, 9), 99 * MIN)];
    const b = dailyBuckets(s, now, 14);
    expect(b).toHaveLength(14);
    expect(b[13]).toBe(5 * MIN); // today
    expect(b[12]).toBe(3 * MIN); // yesterday
    expect(b.reduce((a, c) => a + c, 0)).toBe(8 * MIN); // out-of-window dropped
  });
});

describe('perBookMs / averageDailyMs', () => {
  it('groups by book', () => {
    const s = [sess(at(2026, 7, 7, 9), 10 * MIN, 'b1'), sess(at(2026, 7, 7, 10), 5 * MIN, 'b2', 'x'), sess(at(2026, 7, 6, 9), 2 * MIN, 'b1', 'y')];
    const m = perBookMs(s);
    expect(m.get('b1')).toBe(12 * MIN);
    expect(m.get('b2')).toBe(5 * MIN);
  });
  it('average = total / active days', () => {
    const s = [sess(at(2026, 7, 7, 9), 10 * MIN), sess(at(2026, 7, 5, 9), 20 * MIN)];
    expect(averageDailyMs(s)).toBe(15 * MIN);
  });
  it('average is 0 with no sessions', () => {
    expect(averageDailyMs([])).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats the stairs', () => {
    expect(formatDuration(4_000)).toBe('< 1 分');
    expect(formatDuration(90_000)).toBe('1 分');
    expect(formatDuration(59 * MIN)).toBe('59 分');
    expect(formatDuration(HOUR)).toBe('1 小时');
    expect(formatDuration(Math.round(5.24 * HOUR))).toBe('5.2 小时');
    expect(formatDuration(128 * HOUR)).toBe('128 小时');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/stats/__tests__/aggregate.test.ts`
Expected: FAIL — module `../aggregate` not found.

- [ ] **Step 3: Implement `src/lib/stats/aggregate.ts`**

```ts
/**
 * Pure aggregation over ReadingSession[]. No react / react-native imports so it
 * stays unit-testable. "Day" attribution is by a session's local start day.
 * dayNumber uses Date.UTC(local Y/M/D) so it is timezone-independent and
 * consecutive local days always differ by exactly 1 (China has no DST).
 */

import type { ReadingSession } from '../import/repository';

const DAY_MS = 86_400_000;

export function dayNumber(ms: number): number {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

export function totalMs(sessions: ReadingSession[]): number {
  return sessions.reduce((sum, s) => sum + s.durationMs, 0);
}

export function todayMs(sessions: ReadingSession[], now: number): number {
  const today = dayNumber(now);
  return sessions.reduce((sum, s) => (dayNumber(s.startedAt) === today ? sum + s.durationMs : sum), 0);
}

/** Monday is the first day of the week. */
function startOfWeekDayNumber(now: number): number {
  const d = new Date(now);
  const back = (d.getDay() + 6) % 7; // 0=Sun..6=Sat → days since Monday
  return dayNumber(now) - back;
}

export function thisWeekMs(sessions: ReadingSession[], now: number): number {
  const weekStart = startOfWeekDayNumber(now);
  const today = dayNumber(now);
  return sessions.reduce((sum, s) => {
    const dn = dayNumber(s.startedAt);
    return dn >= weekStart && dn <= today ? sum + s.durationMs : sum;
  }, 0);
}

function activeDaySet(sessions: ReadingSession[]): Set<number> {
  return new Set(sessions.map((s) => dayNumber(s.startedAt)));
}

export function activeDays(sessions: ReadingSession[]): number {
  return activeDaySet(sessions).size;
}

export function currentStreak(sessions: ReadingSession[], now: number): number {
  const days = activeDaySet(sessions);
  let cur = dayNumber(now);
  if (!days.has(cur)) cur -= 1; // today not read yet — allow the streak up to yesterday
  let streak = 0;
  while (days.has(cur)) {
    streak += 1;
    cur -= 1;
  }
  return streak;
}

export function longestStreak(sessions: ReadingSession[]): number {
  const days = [...activeDaySet(sessions)].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

export function dailyBuckets(sessions: ReadingSession[], now: number, days = 14): number[] {
  const today = dayNumber(now);
  const out = new Array<number>(days).fill(0);
  for (const s of sessions) {
    const idx = days - 1 - (today - dayNumber(s.startedAt));
    if (idx >= 0 && idx < days) out[idx] += s.durationMs;
  }
  return out;
}

export function perBookMs(sessions: ReadingSession[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) m.set(s.bookId, (m.get(s.bookId) ?? 0) + s.durationMs);
  return m;
}

export function averageDailyMs(sessions: ReadingSession[]): number {
  const d = activeDays(sessions);
  return d > 0 ? totalMs(sessions) / d : 0;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return '< 1 分';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分`;
  const hours = ms / 3_600_000;
  if (hours < 10) {
    const s = hours.toFixed(1).replace(/\.0$/, '');
    return `${s} 小时`;
  }
  return `${Math.round(hours)} 小时`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/stats/__tests__/aggregate.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats/aggregate.ts src/lib/stats/__tests__/aggregate.test.ts
git commit -m "feat(stats): pure aggregation (totals, streaks, buckets, formatDuration)"
```

---

### Task 3: 会话状态机 `sessionTracker.ts`

**Files:**
- Create: `src/lib/stats/sessionTracker.ts`
- Test: `src/lib/stats/__tests__/sessionTracker.test.ts`

**Interfaces:**
- Produces (no react / react-native imports):
  - `IDLE_TIMEOUT_MS = 180000`, `MIN_SESSION_MS = 5000` (exported consts)
  - `interface FlushResult { startedAt: number; durationMs: number }`
  - `interface SessionTracker { start(now): void; activity(now): void; setForeground(active: boolean, now): void; tickIdle(now): void; flush(now): FlushResult | null }`
  - `createSessionTracker(): SessionTracker`
- 语义：累计**活跃毫秒**；`activity` 结算并重置空闲计时（暂停态则恢复）；`setForeground(false)` 立即结算并暂停，`setForeground(true)` 仅刷新空闲基准、下一次 `activity` 才恢复计时；`tickIdle` 超 `IDLE_TIMEOUT_MS` 则只结算到最后一次活动、暂停；`flush` 结算并产出 `{startedAt,durationMs}`（`durationMs < MIN_SESSION_MS` 返回 `null` 且丢弃），随后清零。

- [ ] **Step 1: Write the failing test**

Create `src/lib/stats/__tests__/sessionTracker.test.ts`:

```ts
import { createSessionTracker, IDLE_TIMEOUT_MS, MIN_SESSION_MS } from '../sessionTracker';

describe('sessionTracker', () => {
  it('accrues active time between start and flush', () => {
    const t = createSessionTracker();
    t.start(0);
    expect(t.flush(10_000)).toEqual({ startedAt: 0, durationMs: 10_000 });
  });

  it('discards a segment shorter than MIN_SESSION_MS', () => {
    const t = createSessionTracker();
    t.start(0);
    expect(t.flush(MIN_SESSION_MS - 1)).toBeNull();
  });

  it('stops accruing after idle timeout, not counting the idle gap', () => {
    const t = createSessionTracker();
    t.start(0);
    t.activity(1_000);
    t.tickIdle(1_000 + IDLE_TIMEOUT_MS); // crosses the idle threshold
    const r = t.flush(999_999);
    expect(r).toEqual({ startedAt: 0, durationMs: 1_000 });
  });

  it('resumes on activity after an idle pause', () => {
    const t = createSessionTracker();
    t.start(0);
    t.activity(1_000);
    t.tickIdle(1_000 + IDLE_TIMEOUT_MS); // paused, accrued = 1_000
    t.activity(500_000);                 // resume
    const r = t.flush(505_000);          // +5_000
    expect(r).toEqual({ startedAt: 0, durationMs: 6_000 });
  });

  it('pauses immediately when backgrounded and ignores time while paused', () => {
    const t = createSessionTracker();
    t.start(0);
    t.setForeground(false, 5_000); // settle 5_000, pause
    const r = t.flush(999_999);
    expect(r).toEqual({ startedAt: 0, durationMs: 5_000 });
  });

  it('does not resume counting on setForeground(true) until next activity', () => {
    const t = createSessionTracker();
    t.start(0);
    t.setForeground(false, 5_000);   // paused, accrued 5_000
    t.setForeground(true, 100_000);  // foreground, but still paused
    const noMove = t.flush(200_000);
    expect(noMove).toEqual({ startedAt: 0, durationMs: 5_000 }); // no extra time
  });

  it('starts a fresh segment after a flush', () => {
    const t = createSessionTracker();
    t.start(0);
    expect(t.flush(10_000)).toEqual({ startedAt: 0, durationMs: 10_000 });
    t.activity(20_000); // continue reading
    expect(t.flush(20_000)).toEqual({ startedAt: 10_000, durationMs: 10_000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/stats/__tests__/sessionTracker.test.ts`
Expected: FAIL — module `../sessionTracker` not found.

- [ ] **Step 3: Implement `src/lib/stats/sessionTracker.ts`**

```ts
/**
 * Pure reading-session state machine. Caller feeds monotonic timestamps (ms);
 * no react / react-native / Date imports so it is fully unit-testable with
 * explicit `now` values. Accrues ACTIVE reading time only.
 */

export const IDLE_TIMEOUT_MS = 180_000; // 3 min of no activity → pause
export const MIN_SESSION_MS = 5_000; // discard flushes shorter than this

export interface FlushResult {
  startedAt: number;
  durationMs: number;
}

export interface SessionTracker {
  start(now: number): void;
  activity(now: number): void;
  setForeground(active: boolean, now: number): void;
  tickIdle(now: number): void;
  flush(now: number): FlushResult | null;
}

export function createSessionTracker(): SessionTracker {
  let isActive = false;
  let activeSince = 0; // valid only while isActive
  let accumulatedMs = 0;
  let lastActivityMs = 0;
  let startedAt: number | null = null;

  function settle(upTo: number): void {
    if (isActive) {
      accumulatedMs += Math.max(0, upTo - activeSince);
      activeSince = upTo;
    }
  }

  function resume(now: number): void {
    isActive = true;
    activeSince = now;
    lastActivityMs = now;
    if (startedAt === null) startedAt = now;
  }

  return {
    start(now: number): void {
      if (!isActive) resume(now);
      else lastActivityMs = now;
    },

    activity(now: number): void {
      if (!isActive) resume(now);
      else {
        settle(now);
        lastActivityMs = now;
      }
    },

    setForeground(active: boolean, now: number): void {
      if (active) {
        // Do not resume counting; just refresh the idle baseline. Next
        // activity() resumes.
        lastActivityMs = now;
      } else {
        settle(now);
        isActive = false;
      }
    },

    tickIdle(now: number): void {
      if (isActive && now - lastActivityMs >= IDLE_TIMEOUT_MS) {
        settle(lastActivityMs); // credit only up to the last activity
        isActive = false;
      }
    },

    flush(now: number): FlushResult | null {
      settle(now);
      const durationMs = accumulatedMs;
      const at = startedAt;
      accumulatedMs = 0;
      startedAt = isActive ? now : null;
      if (at === null || durationMs < MIN_SESSION_MS) return null;
      return { startedAt: at, durationMs };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/stats/__tests__/sessionTracker.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats/sessionTracker.ts src/lib/stats/__tests__/sessionTracker.test.ts
git commit -m "feat(stats): pure reading-session state machine (idle/background/flush)"
```

---

### Task 4: `useReadingSession` hook + 接入 ReaderScreen

**Files:**
- Create: `src/reader/useReadingSession.ts`
- Modify: `src/screens/ReaderScreen.tsx`
- Test: `src/reader/__tests__/useReadingSession.test.tsx`

**Interfaces:**
- Consumes: `createSessionTracker`, `IDLE_TIMEOUT_MS` from `src/lib/stats/sessionTracker`; `ReadingSession` from `src/lib/import/repository`; `AppState` from `react-native`.
- Produces:
  - `interface UseReadingSessionParams { bookId: string; persist: (s: ReadingSession) => void; nowFn?: () => number }`
  - `useReadingSession(params): { registerActivity: () => void }`
  - hook 行为：挂载 `start(now)`；`AppState` 变化 → `setForeground(active, now)`，切非前台时 `flush`→`persist`；`setInterval(…, 30000)` 调 `tickIdle(now)`；卸载时清 interval/监听并 `flush`→`persist`；`registerActivity()` → `tracker.activity(now)`。`persist` 收到的 `ReadingSession.id` 由 hook 生成：`` `${startedAt}-${Math.round(durationMs)}-${Math.random().toString(36).slice(2, 8)}` ``。

- [ ] **Step 1: Write the failing test**

Create `src/reader/__tests__/useReadingSession.test.tsx`:

```ts
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useReadingSession } from '../useReadingSession';
import type { ReadingSession } from '../../lib/import/repository';

function Harness({ persist, nowRef }: { persist: (s: ReadingSession) => void; nowRef: { t: number } }) {
  useReadingSession({ bookId: 'b1', persist, nowFn: () => nowRef.t });
  return <Text>reader</Text>;
}

describe('useReadingSession', () => {
  it('persists a session on unmount when >= 5s accrued', () => {
    const persist = jest.fn();
    const nowRef = { t: 0 };
    const { unmount } = render(<Harness persist={persist} nowRef={nowRef} />);
    nowRef.t = 8_000; // 8s of foreground reading
    unmount();
    expect(persist).toHaveBeenCalledTimes(1);
    const s = persist.mock.calls[0][0] as ReadingSession;
    expect(s.bookId).toBe('b1');
    expect(s.durationMs).toBe(8_000);
    expect(typeof s.id).toBe('string');
    expect(s.id.length).toBeGreaterThan(0);
  });

  it('does not persist a sub-5s session on unmount', () => {
    const persist = jest.fn();
    const nowRef = { t: 0 };
    const { unmount } = render(<Harness persist={persist} nowRef={nowRef} />);
    nowRef.t = 3_000;
    unmount();
    expect(persist).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/reader/__tests__/useReadingSession.test.tsx`
Expected: FAIL — module `../useReadingSession` not found.

- [ ] **Step 3: Implement `src/reader/useReadingSession.ts`**

```ts
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { ReadingSession } from '../lib/import/repository';
import { createSessionTracker, type FlushResult } from '../lib/stats/sessionTracker';

const IDLE_TICK_MS = 30_000;

export interface UseReadingSessionParams {
  bookId: string;
  persist: (s: ReadingSession) => void;
  /** Injectable clock for tests; defaults to Date.now. */
  nowFn?: () => number;
}

export function useReadingSession({
  bookId,
  persist,
  nowFn = Date.now,
}: UseReadingSessionParams): { registerActivity: () => void } {
  const trackerRef = useRef(createSessionTracker());
  // Keep the latest persist/now without re-subscribing the effect.
  const persistRef = useRef(persist);
  const nowRef = useRef(nowFn);
  persistRef.current = persist;
  nowRef.current = nowFn;

  const flushAndPersist = (result: FlushResult | null): void => {
    if (!result) return;
    const id = `${result.startedAt}-${Math.round(result.durationMs)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    persistRef.current({ id, bookId, startedAt: result.startedAt, durationMs: result.durationMs });
  };

  useEffect(() => {
    const tracker = trackerRef.current;
    tracker.start(nowRef.current());

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      const now = nowRef.current();
      const active = state === 'active';
      tracker.setForeground(active, now);
      if (!active) flushAndPersist(tracker.flush(now));
    });

    const interval = setInterval(() => {
      tracker.tickIdle(nowRef.current());
    }, IDLE_TICK_MS);

    return () => {
      clearInterval(interval);
      sub.remove();
      flushAndPersist(tracker.flush(nowRef.current()));
    };
    // bookId identifies the reading target; re-subscribe if it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  return {
    registerActivity: () => {
      trackerRef.current.activity(nowRef.current());
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/reader/__tests__/useReadingSession.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into ReaderScreen**

In `src/screens/ReaderScreen.tsx`:

Add import near the other `../lib`/`../reader` imports:

```ts
import { useReadingSession } from '../reader/useReadingSession';
```

Inside the `ReaderScreen` component body (after `repo`/`bookId` are in scope, near the other hooks), add:

```ts
  const { registerActivity } = useReadingSession({
    bookId,
    persist: (s) => {
      void repo.addSession(s);
    },
  });
```

On the `<FlatList …>` (the reader body, around line 520), add these two props (keep all existing props):

```tsx
            onScroll={registerActivity}
            scrollEventThrottle={250}
```

- [ ] **Step 6: Verify ReaderScreen still renders + suite green**

Run: `npx jest src/screens/__tests__/ReaderScreen.test.tsx`
Expected: PASS (existing tests unaffected — the hook starts a tracker but persists nothing during those tests since Date.now barely advances and unmounts are sub-5s).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/reader/useReadingSession.ts src/reader/__tests__/useReadingSession.test.tsx src/screens/ReaderScreen.tsx
git commit -m "feat(stats): useReadingSession hook + wire activity/flush into ReaderScreen"
```

---

### Task 5: StatsScreen（极简卡片流）+ 导航入口

**Files:**
- Create: `src/screens/StatsScreen.tsx`
- Modify: `App.tsx`
- Modify: `src/screens/LibraryScreen.tsx` (顶栏入口按钮 + 新 prop)
- Test: `src/screens/__tests__/StatsScreen.test.tsx`

**Interfaces:**
- Consumes: `BookRepository`, `ReadingSession`, `BookRecord` from `src/lib/import/repository`; aggregate functions from `src/lib/stats/aggregate`; `useSettings` + `resolveTheme`.
- Produces:
  - `StatsScreen(props: { repo: BookRepository; onBack: () => void })`
  - `LibraryScreen` 新增 prop `onOpenStats: () => void`（顶栏按钮 testID `open-stats`）。
  - `App.tsx` `Screen` 联合加 `{ name: 'stats' }`。

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/StatsScreen.test.tsx`:

```ts
import { render, waitFor } from '@testing-library/react-native';
import { InMemoryBookRepository, type ReadingSession } from '../../lib/import/repository';
import { InMemorySettingsGateway } from '../../lib/settings/store';
import { SettingsProvider } from '../../settings/SettingsContext';
import { StatsScreen } from '../StatsScreen';

const HOUR = 3_600_000;
const MIN = 60_000;

function renderStats(sessions: ReadingSession[], books: { id: string; title: string }[] = []) {
  const repo = new InMemoryBookRepository();
  for (const b of books) {
    void repo.addBook({
      id: b.id, title: b.title, originalName: `${b.title}.txt`, encoding: 'utf-8',
      sizeBytes: 1, importedAt: 1, coverColor: '#000', strategy: 'regex', normalizedPath: `/p/${b.id}`,
    });
  }
  for (const s of sessions) void repo.addSession(s);
  const onBack = jest.fn();
  const utils = render(
    <SettingsProvider gateway={new InMemorySettingsGateway()}>
      <StatsScreen repo={repo} onBack={onBack} />
    </SettingsProvider>,
  );
  return { ...utils, onBack };
}

function todayAt(h: number): number {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.getTime();
}

describe('StatsScreen', () => {
  it('shows total reading time and the top book', async () => {
    const { findByText, getByText } = renderStats(
      [
        { id: 's1', bookId: 'b1', startedAt: todayAt(9), durationMs: 2 * HOUR },
        { id: 's2', bookId: 'b2', startedAt: todayAt(10), durationMs: 30 * MIN },
      ],
      [
        { id: 'b1', title: '凡人修仙传' },
        { id: 'b2', title: '晚明' },
      ],
    );
    expect(await findByText('2.5 小时')).toBeTruthy(); // total
    expect(getByText('凡人修仙传')).toBeTruthy(); // top book by time
  });

  it('shows an empty state when there are no sessions', async () => {
    const { findByText } = renderStats([]);
    expect(await findByText(/开始阅读/)).toBeTruthy();
  });

  it('renders on the current theme background', async () => {
    const { findByTestId } = renderStats([
      { id: 's1', bookId: 'b1', startedAt: todayAt(9), durationMs: HOUR },
    ]);
    const root = await findByTestId('stats-screen');
    // warmWhite is the default theme background.
    expect(root).toHaveStyle({ backgroundColor: '#f5eed9' });
  });
});
```

> NOTE 计算校验：`findByText('2.5 小时')` — total = 2h30m = 2.5h → `formatDuration` → `"2.5 小时"`. Default theme is `warmWhite` (`#f5eed9`) per `DEFAULT_SETTINGS`; if that ever changes, update this assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/__tests__/StatsScreen.test.tsx`
Expected: FAIL — module `../StatsScreen` not found.

- [ ] **Step 3: Implement `src/screens/StatsScreen.tsx`**

```tsx
/**
 * 增量 4: StatsScreen — 极简卡片流「阅读统计」页。
 * 主题自适应（resolveTheme），竖向滚动、一卡一概念。
 */

import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { BookRecord, BookRepository, ReadingSession } from '../lib/import/repository';
import {
  averageDailyMs, activeDays, currentStreak, dailyBuckets, formatDuration,
  longestStreak, perBookMs, thisWeekMs, todayMs, totalMs,
} from '../lib/stats/aggregate';
import { resolveTheme } from '../lib/settings/styles';
import { useSettings } from '../settings/SettingsContext';

interface StatsScreenProps {
  repo: BookRepository;
  onBack: () => void;
}

export function StatsScreen({ repo, onBack }: StatsScreenProps) {
  const { settings } = useSettings();
  const theme = resolveTheme(settings.themeId);

  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([repo.listSessions(), repo.listBooks()]).then(([s, b]) => {
      if (cancelled) return;
      setSessions(s);
      setBooks(b);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const now = Date.now();
  const stats = useMemo(() => {
    const total = totalMs(sessions);
    const perBook = perBookMs(sessions);
    let topBookId: string | null = null;
    let topMs = 0;
    for (const [id, ms] of perBook) {
      if (ms > topMs) {
        topMs = ms;
        topBookId = id;
      }
    }
    const topTitle = topBookId ? books.find((b) => b.id === topBookId)?.title ?? null : null;
    return {
      total,
      today: todayMs(sessions, now),
      week: thisWeekMs(sessions, now),
      streak: currentStreak(sessions, now),
      longest: longestStreak(sessions),
      active: activeDays(sessions),
      avg: averageDailyMs(sessions),
      buckets: dailyBuckets(sessions, now, 14),
      topTitle,
      topMs,
      topPct: total > 0 ? Math.round((topMs / total) * 100) : 0,
    };
    // now intentionally excluded — computed once per render is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, books]);

  const maxBucket = Math.max(1, ...stats.buckets);
  const soft = `${theme.accent}24`; // ~14% alpha (accent is #rrggbb)

  return (
    <View testID="stats-screen" style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={14} style={styles.back}>
          <Text style={[styles.arrow, { color: theme.subtle }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: theme.heading }]}>阅读统计</Text>
        <View style={styles.back} />
      </View>

      {loaded && sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.subtle }]}>
            开始阅读后，这里会记录你的时间
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* hero — 累计总时长 */}
          <View style={[styles.card, { backgroundColor: theme.accent }]}>
            <Text style={[styles.k, { color: '#ffffffb8' }]}>累计阅读</Text>
            <Text style={[styles.hero, { color: '#ffffff' }]}>{formatDuration(stats.total)}</Text>
            <Text style={[styles.sub, { color: '#ffffffcc' }]}>
              日均 {formatDuration(stats.avg)} · 活跃 {stats.active} 天
            </Text>
          </View>

          {/* 今日 · 本周 */}
          <View style={styles.row}>
            <View style={[styles.card, styles.mini, { backgroundColor: soft }]}>
              <Text style={[styles.k, { color: theme.subtle }]}>今日</Text>
              <Text style={[styles.miniV, { color: theme.heading }]}>{formatDuration(stats.today)}</Text>
            </View>
            <View style={[styles.card, styles.mini, { backgroundColor: soft }]}>
              <Text style={[styles.k, { color: theme.subtle }]}>本周</Text>
              <Text style={[styles.miniV, { color: theme.heading }]}>{formatDuration(stats.week)}</Text>
            </View>
          </View>

          {/* 连续阅读 + 14 天柱状 */}
          <View style={[styles.card, { backgroundColor: soft }]}>
            <Text style={[styles.k, { color: theme.subtle }]}>🔥 连续阅读</Text>
            <Text style={[styles.midV, { color: theme.heading }]}>{stats.streak} 天</Text>
            <Text style={[styles.sub, { color: theme.subtle }]}>
              最长 {stats.longest} 天 · 活跃 {stats.active} 天
            </Text>
            <View style={styles.spark}>
              {stats.buckets.map((v, i) => (
                <View
                  key={i}
                  style={[
                    styles.sparkBar,
                    { height: `${Math.max(6, (v / maxBucket) * 100)}%`, backgroundColor: theme.accent },
                  ]}
                />
              ))}
            </View>
          </View>

          {/* 读得最多 */}
          {stats.topTitle && (
            <View style={[styles.card, { backgroundColor: soft }]}>
              <Text style={[styles.k, { color: theme.subtle }]}>读得最多</Text>
              <Text style={[styles.book, { color: theme.heading }]} numberOfLines={1}>
                {stats.topTitle}
              </Text>
              <Text style={[styles.sub, { color: theme.subtle }]}>
                {formatDuration(stats.topMs)} · 占总时长 {stats.topPct}%
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 64 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 28, lineHeight: 30 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  scroll: { paddingHorizontal: 18, paddingBottom: 48, gap: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80, paddingHorizontal: 40 },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  card: { borderRadius: 18, padding: 20 },
  row: { flexDirection: 'row', gap: 12 },
  mini: { flex: 1 },
  k: { fontSize: 12, fontWeight: '600' },
  hero: { fontSize: 40, fontWeight: '800', marginTop: 6, letterSpacing: -0.5 },
  sub: { fontSize: 12, marginTop: 8 },
  miniV: { fontSize: 26, fontWeight: '700', marginTop: 6 },
  midV: { fontSize: 30, fontWeight: '800', marginTop: 6 },
  book: { fontSize: 22, fontWeight: '700', marginTop: 6 },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 40, marginTop: 14 },
  sparkBar: { flex: 1, borderRadius: 2, minHeight: 3 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/__tests__/StatsScreen.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire navigation in `App.tsx`**

Change the `Screen` type:

```ts
type Screen = { name: 'library' } | { name: 'reader'; bookId: string } | { name: 'stats' };
```

Add the import:

```ts
import { StatsScreen } from './src/screens/StatsScreen';
```

Add a callback near `backToLibrary`:

```ts
  const openStats = useCallback(() => {
    setScreen({ name: 'stats' });
  }, []);
```

Replace the render switch body so all three screens render:

```tsx
        {screen.name === 'library' ? (
          <LibraryScreen repo={repo} fs={fs} onOpenBook={openBook} onOpenStats={openStats} />
        ) : screen.name === 'reader' ? (
          <ReaderScreen repo={repo} fs={fs} bookId={screen.bookId} onBack={backToLibrary} />
        ) : (
          <StatsScreen repo={repo} onBack={backToLibrary} />
        )}
```

- [ ] **Step 6: Add the stats entry button to `LibraryScreen`**

Add `onOpenStats: () => void;` to `LibraryScreenProps`, and destructure it:

```ts
export function LibraryScreen({ repo, fs, onOpenBook, onOpenStats }: LibraryScreenProps) {
```

In the header `headerRight` View (around line 307), add a stats button **before** the `LayoutToggle`:

```tsx
        <View style={styles.headerRight}>
          <Pressable
            testID="open-stats"
            onPress={onOpenStats}
            hitSlop={10}
            style={({ pressed }) => [styles.statsButton, pressed && styles.pressed]}
          >
            <Text style={styles.statsButtonText}>统计</Text>
          </Pressable>
          <LayoutToggle value={layout} onChange={(l) => update({ libraryLayout: l })} />
```

Add styles to the `StyleSheet.create({...})` block:

```ts
  statsButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#eceae3' },
  statsButtonText: { fontSize: 12.5, color: MUTED, fontWeight: '600' },
```

- [ ] **Step 7: Update the LibraryScreen test render helper**

`src/screens/__tests__/LibraryScreen.test.tsx` renders `<LibraryScreen …>` — add the new required prop. Find the render call(s) and add `onOpenStats={jest.fn()}`. Then:

Run: `npx jest src/screens/__tests__/LibraryScreen.test.tsx`
Expected: PASS (existing tests green with the new prop).

- [ ] **Step 8: Verify types + related suites**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx jest src/screens`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/screens/StatsScreen.tsx src/screens/__tests__/StatsScreen.test.tsx App.tsx src/screens/LibraryScreen.tsx src/screens/__tests__/LibraryScreen.test.tsx
git commit -m "feat(stats): StatsScreen (card flow) + library stats entry + nav wiring"
```

---

### Task 6: 书架卡片显示单本 "读了 Xh"

**Files:**
- Modify: `src/screens/LibraryScreen.tsx`
- Test: `src/screens/__tests__/LibraryScreen.test.tsx`

**Interfaces:**
- Consumes: `repo.listSessions()`, `perBookMs` + `formatDuration` from `src/lib/stats/aggregate`.
- Produces: `BookListItem` 增加 `readMs: number`；行/卡片在 `readMs > 0` 时显示 `已读 <formatDuration> 时长`（文案 `读了 <formatDuration(readMs)>`）。

- [ ] **Step 1: Write the failing test**

Add to `src/screens/__tests__/LibraryScreen.test.tsx` (new `it`, inside the existing top-level `describe`):

```ts
  it('shows accumulated reading time on a book once it has sessions', async () => {
    const repo = new InMemoryBookRepository();
    const fs = new FakeFileGateway();
    await seedReader(repo, fs, {
      bookId: 'b1', title: '凡人修仙传',
      chapters: [{ title: '第一章', body: '正文' }],
      progressChapterIndex: 0, lastReadAt: Date.now(),
    });
    await repo.addSession({ id: 's1', bookId: 'b1', startedAt: Date.now(), durationMs: 2 * 3_600_000 });

    const { findByText } = render(
      <SettingsProvider gateway={new InMemorySettingsGateway()}>
        <LibraryScreen repo={repo} fs={fs} onOpenBook={jest.fn()} onOpenStats={jest.fn()} />
      </SettingsProvider>,
    );
    expect(await findByText(/读了 2 小时/)).toBeTruthy();
  });
```

> Ensure the test file imports `seedReader`, `FakeFileGateway` from `../../test-utils/fakes`, `InMemoryBookRepository` from `../../lib/import/repository`, `InMemorySettingsGateway` from `../../lib/settings/store`, and `SettingsProvider`. Reuse whatever is already imported there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/__tests__/LibraryScreen.test.tsx -t "accumulated reading time"`
Expected: FAIL — no "读了 2 小时" text rendered.

- [ ] **Step 3: Load per-book time in `loadLibraryItems`**

Add imports at the top of `LibraryScreen.tsx`:

```ts
import { perBookMs, formatDuration } from '../lib/stats/aggregate';
```

Extend the `BookListItem` interface with:

```ts
  readMs: number;
```

Change `loadLibraryItems` to fetch sessions once and attach `readMs`:

```ts
async function loadLibraryItems(repo: BookRepository): Promise<BookListItem[]> {
  const [books, sessions] = await Promise.all([repo.listBooks(), repo.listSessions()]);
  const readByBook = perBookMs(sessions);
  const items = await Promise.all(
    books.map(async (book) => {
      const [chapters, progress] = await Promise.all([
        repo.getChapters(book.id),
        repo.getProgress(book.id),
      ]);
      const totalChapters = chapters.length;
      const progressPercent = progress
        ? chapterProgressPercent(progress.chapterIndex, totalChapters)
        : chapterProgressPercent(0, totalChapters);
      const idx = progress ? Math.min(progress.chapterIndex, Math.max(totalChapters - 1, 0)) : 0;
      return {
        book,
        totalChapters,
        progressPercent,
        importedAt: book.importedAt,
        lastReadAt: progress ? progress.updatedAt : null,
        currentChapterTitle: progress ? chapters[idx]?.title ?? null : null,
        readMs: readByBook.get(book.id) ?? 0,
      };
    }),
  );
  return sortByRecent(items);
}
```

- [ ] **Step 4: Render the time on row + card**

In `renderRow`, change the `rowMeta` line to append reading time when present:

```tsx
            <Text style={styles.rowMeta} numberOfLines={1}>
              {item.totalChapters > 0 ? `共 ${item.totalChapters} 章` : '未分章'}
              {item.readMs > 0 ? ` · 读了 ${formatDuration(item.readMs)}` : ''}
              {item.lastReadAt !== null ? ` · ${formatRelativeTime(item.lastReadAt)}` : ' · 未读'}
            </Text>
```

In `renderCard`, change the `cardMeta` line similarly:

```tsx
            <Text style={styles.cardMeta} numberOfLines={1}>
              {progressLabel(item)}
              {item.readMs > 0 ? ` · 读了 ${formatDuration(item.readMs)}` : ''}
              {item.lastReadAt !== null ? ` · ${formatRelativeTime(item.lastReadAt)}` : ''}
            </Text>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/screens/__tests__/LibraryScreen.test.tsx`
Expected: PASS (new test + existing tests green).

- [ ] **Step 6: Verify types + full suite + iOS bundle smoke**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm test`
Expected: all suites PASS, 0 act() warnings.
Run: `npx expo export --platform ios`
Expected: `Exported: dist` with no bundling error.

- [ ] **Step 7: Commit**

```bash
git add src/screens/LibraryScreen.tsx src/screens/__tests__/LibraryScreen.test.tsx
git commit -m "feat(stats): show per-book accumulated reading time on the shelf"
```

---

## Self-Review

**1. Spec coverage:**
- 计时（前台/空闲/后台/丢弃 <5s）→ Task 3 (状态机) + Task 4 (接线)。✓
- `reading_sessions` 表 + repo → Task 1。✓
- 聚合（total/today/week/streak/active/buckets/perBook/avg/format）→ Task 2。✓
- StatsScreen 四卡（hero 副标题真实统计 / 今日·本周 / 连续+14天柱状 / 读得最多）+ 空态 + 主题自适应 → Task 5。✓
- 入口按钮 + App 导航 → Task 5。✓
- 书架单本 "读了 Xh" → Task 6。✓
- "明确不做"（目标提醒、逐小时热力图、速度估算、同步、跨午夜拆分）→ 未出现在任何任务，保持不做。✓

**2. Placeholder scan:** 无 TBD/TODO；每个代码步给出完整代码；每个测试给出完整断言。✓

**3. Type consistency:**
- `ReadingSession { id, bookId, startedAt, durationMs }` 全任务一致。✓
- `FlushResult { startedAt, durationMs }`：Task 3 产出、Task 4 消费一致。✓
- `SessionTracker` 方法名 `start/activity/setForeground/tickIdle/flush` 前后一致。✓
- aggregate 函数名（`totalMs/todayMs/thisWeekMs/activeDays/currentStreak/longestStreak/dailyBuckets/perBookMs/averageDailyMs/formatDuration/dayNumber`）Task 2 定义、Task 5/6 消费一致。✓
- `LibraryScreen` 新 prop `onOpenStats` 在 Task 5 定义、Task 5/6 测试与 App 调用一致。✓
- `StatsScreen(props: { repo, onBack })` Task 5 定义与 App 调用一致。✓

**注意事项（交给实现者）：** Task 4 的严格计时断言在 hook 上（注入 `nowFn`）；ReaderScreen 仅接线，其既有测试应保持绿(会话累计极短、卸载 <5s 不落库)。若某个既有 ReaderScreen 测试因新 hook 的 interval/AppState 监听变红，用 fake timers 或在卸载后断言无副作用修正，勿改动计时语义。
