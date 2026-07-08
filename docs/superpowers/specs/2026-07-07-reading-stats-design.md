# 增量 4 · 阅读时长统计 — 设计

日期：2026-07-07 · 所属：T8 打磨 · 范围：JS-only，全程可走 OTA

## Context（为什么做）

自用阅读器读到后面，想知道"我在这本/这个 App 上花了多少时间、有没有坚持每天读"。目前完全没有时间维度的记录。目标：**记录真实阅读时长**并在一个专属「阅读统计」页里展示总时长、今日/本周、连续打卡、每本书累计。核心难点是**时间要计得准**——不能"手机亮着人走开了"还在刷时长——以及**不新增原生依赖**（必须走 OTA，见 AGENTS.md）。

## 关键约束

- **无新原生依赖**：只用 `AppState`（RN 内置）、`expo-sqlite`（已在用）、`Date`。禁止新增需要重出 ipa 的包。
- **不整本进内存**：本增量只涉及会话时长与聚合，天然轻量；沿用既有滑窗阅读架构，不触碰。
- **主题自适应**：统计页背景/字色/强调色全部来自 `resolveTheme(settings.themeId)`，与阅读页/目录/搜索一致，不写死配色。
- 计时口径：**前台 + 空闲超时暂停**（下方定义）。

## 计时（`src/lib/stats/sessionTracker.ts`，纯逻辑）

一个可注入"当前时间"的纯状态机，不依赖 React，`jest.useFakeTimers()` 严格单测。

- **概念**：一次"阅读会话"累计**活跃毫秒**。状态在 `active`（计时中）与 `paused`（不计时）间切换。
- **开始**：进入阅读页 → `start(now)`，进入 `active`。
- **活动信号**：滚动/翻页调用 `activity(now)`：
  - 若当前 `active`，累加自上次标记以来的活跃时间，并**重置空闲计时**。
  - 若当前 `paused`（因空闲被暂停），则**恢复** `active`（新的一段从 `now` 起算）。
- **空闲暂停**：距上次 `activity` 超过 `IDLE_TIMEOUT_MS`（默认 **3 分钟 = 180000**）→ 进入 `paused`，这段空闲不计入。
- **后台暂停**：`AppState` 变为非 `active`（背景/inactive）→ `pause(now)`，立即结算当前活跃段并进入 `paused`；回前台后下一次 `activity` 恢复。
- **结束/落库**：离开阅读页、切后台、或空闲暂停时，通过 `flush()` 产出一段 `{ bookId, startedAt, durationMs }`。**`durationMs < MIN_SESSION_MS`（默认 5000）的丢弃**，避免误触噪声；落库后累计清零。
- **接口（示意）**：
  ```ts
  interface SessionTracker {
    start(nowMs: number): void;
    activity(nowMs: number): void;       // 滚动/翻页
    setForeground(active: boolean, nowMs: number): void;
    tickIdle(nowMs: number): void;       // 由 setInterval 驱动，检查空闲超时
    flush(nowMs: number): { durationMs: number } | null;  // 结算，产出可落库时长
  }
  ```
- **常量**：`IDLE_TIMEOUT_MS = 180000`、`MIN_SESSION_MS = 5000`（模块内导出，便于测试引用）。

### React 接线（`ReaderScreen`）

- 挂载/获得焦点：`tracker.start()`。
- `onScroll`（已有）里调用 `tracker.activity(Date.now())`（可节流，逻辑测试覆盖状态机本身，不测节流）。
- `AppState.addEventListener('change', …)` → `tracker.setForeground(state === 'active', Date.now())`；切后台时 `flush` 并 `repo.addSession`。
- `setInterval` 周期（如 30s）`tracker.tickIdle(Date.now())`，跨过空闲阈值时暂停。
- 卸载/`onBack`：`flush` → 若非空 `repo.addSession({ id, bookId, startedAt, durationMs })`。

## 数据 + 聚合

### 持久化（`repository.ts` / `sqliteRepository.ts`）

新增记录类型与表，`InMemoryBookRepository` 同步实现：

```ts
interface ReadingSession {
  id: string;
  bookId: string;
  startedAt: number;   // Unix ms（本地起始时刻，用于归属"日"）
  durationMs: number;  // 活跃毫秒
}
```

```sql
CREATE TABLE IF NOT EXISTS reading_sessions (
  id         TEXT PRIMARY KEY,
  bookId     TEXT NOT NULL,
  startedAt  INTEGER NOT NULL,
  durationMs INTEGER NOT NULL,
  FOREIGN KEY (bookId) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_startedAt ON reading_sessions (startedAt);
```

`BookRepository` 新增：
- `addSession(s: ReadingSession): Promise<void>`
- `listSessions(): Promise<ReadingSession[]>` —— 返回全部（个人规模每年数千行，可全量取回后在 JS 聚合）。

删书经 `ON DELETE CASCADE` 连带删该书 session（InMemory 手动删）。

### 聚合（`src/lib/stats/aggregate.ts`，纯函数，严格单测）

以 `ReadingSession[]` + "今天"（注入 `Date`/时区无关的本地日字符串）为输入：

- `totalMs(sessions): number`
- `msInRange(sessions, startMs, endMs): number`
- `dayKey(ms): string` → 本地 `YYYY-MM-DD`（归属日以 `startedAt` 计）
- `todayMs(sessions, now)` / `thisWeekMs(sessions, now)`（周一为周首）
- `activeDays(sessions): number`（有 session 的不同日数）
- `currentStreak(sessions, now): number`（连续到今天/昨天为止的天数）
- `longestStreak(sessions): number`
- `dailyBuckets(sessions, now, days): number[]`（最近 `days` 天每日 ms，给 sparkline，默认 14）
- `perBookMs(sessions): Map<bookId, number>` → 供"读得最多"与书架卡片
- `averageDailyMs(sessions): number`（总时长 / 活跃天数）
- `formatDuration(ms): string` → `"128 小时"` / `"47 分"` / `"< 1 分"`（阶梯规则明确，单测覆盖边界）

## UI（款式 C · 极简卡片流 / `src/screens/StatsScreen.tsx`）

主题自适应，竖向滚动、一卡一概念、大留白：

1. **强调色大卡**：累计总时长（hero，主题 accent 底、白字），副标题**真实统计**："日均 51 分 · 活跃 86 天"（不做速度折算的虚构类比）。
2. **迷你双卡**：今日 · 本周。
3. **🔥 连续阅读**卡：当前连续天数 + "最长 N 天 · 活跃 N 天" + 最近 14 天 `sparkline`（纯 `View` 柱状，不用 svg）。
4. **读得最多**卡：Top 书名 + 时长 + 占总时长百分比（无 session 时整卡不渲染）。
- 空态：无任何 session → 温和占位（"开始阅读后，这里会记录你的时间"）。

### 入口 + 接线

- 书架顶栏加统计入口（文字/字符图标，避免新图标依赖）→ `App.tsx` 的 `Screen` 联合加 `{ name: 'stats' }`，`StatsScreen` 收 `repo` + `onBack`。
- **书架卡片**顺带露出单本 "读了 Xh"：`loadLibraryItems` 额外取 `listSessions` → `perBookMs`，无记录不显示。

## 数据流

```
阅读页滚动 → tracker.activity() ；切后台/空闲/离开 → tracker.flush() → repo.addSession
统计页打开 → repo.listSessions() → aggregate.* → 卡片
书架打开   → repo.listSessions() → perBookMs → 卡片 "读了 Xh"
```

## 测试策略

- **sessionTracker**（`jest.useFakeTimers`）：活跃累加；空闲超阈值暂停、其后 activity 恢复；后台 pause 立即结算；flush 丢弃 <5s；多段累计正确。
- **aggregate**（造 session fixture，严格断言）：total / today / week 边界（跨午夜、跨周一）；currentStreak（今天有/昨天断/今天空但昨天有）；longestStreak；activeDays 去重；dailyBuckets 长度与归属；perBookMs 分组；formatDuration 各阶梯。
- **StatsScreen**（RNTL 13，注入 InMemory + 播种 session）：渲染总时长/今日/连续；空态占位；主题背景色。
- **LibraryScreen**：某书有 session → 卡片出现 "读了 Xh"。
- **ReaderScreen**：mock `AppState`/计时——离开阅读页触发 `repo.addSession`（至少一条、bookId 正确）；<5s 不落库。用 fake timers 断言状态机接线，不测真实滚动帧。

## Verify

- 本地：新单测全绿；`tsc --noEmit` 干净；`expo export --platform ios` 成功。
- 真机：读几分钟→回书架→进统计页看到今日时长增长；放着不动 3 分钟→时长不再涨；切后台→回来继续读→时长继续；隔天再读→连续天数 +1；切换阅读主题→统计页整套变色；书架卡片显示单本时长。

## 明确不做（本增量）

- 目标/提醒（每日阅读目标、推送）。
- 逐小时热力图、"高峰时段"、per-book 时间线明细。
- 阅读速度（字/分）估算与任何基于它的字数类比。
- 跨设备同步 / 导出统计。
- 会话跨午夜拆分（按 `startedAt` 整段归属起始日，个人规模可接受）。
