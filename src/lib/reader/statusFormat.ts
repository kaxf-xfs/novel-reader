/**
 * T7: pure formatters for the reader's top-bar status (system clock + battery).
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** "HH:MM", 24-hour, zero-padded. */
export function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Formats a battery level in [0, 1] as a rounded percentage. expo-battery
 * returns -1 when the level is unknown → render an em dash.
 */
export function formatBattery(level: number): string {
  if (level < 0) return '—';
  return `${Math.round(level * 100)}%`;
}
