/**
 * T6: format a timestamp as a compact "last read" label for the shelf.
 *
 * < 1 min → 刚刚 (also for future timestamps from clock skew)
 * < 1 h   → N分钟前
 * < 1 day → N小时前
 * < 1 wk  → N天前
 * else    → YYYY-MM-DD (local date)
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时前`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}天前`;

  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
