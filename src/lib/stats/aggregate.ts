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
