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
