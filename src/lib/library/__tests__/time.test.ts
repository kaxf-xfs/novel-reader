import { formatRelativeTime } from '../time';

const NOW = 1_700_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('shows 刚刚 for under a minute', () => {
    expect(formatRelativeTime(NOW - 30 * SEC, NOW)).toBe('刚刚');
  });

  it('shows 刚刚 for a future timestamp (clock skew)', () => {
    expect(formatRelativeTime(NOW + 10 * SEC, NOW)).toBe('刚刚');
  });

  it('shows N分钟前 within the hour', () => {
    expect(formatRelativeTime(NOW - 5 * MIN, NOW)).toBe('5分钟前');
    expect(formatRelativeTime(NOW - 59 * MIN, NOW)).toBe('59分钟前');
  });

  it('shows N小时前 within the day', () => {
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe('3小时前');
  });

  it('shows N天前 within the week', () => {
    expect(formatRelativeTime(NOW - 2 * DAY, NOW)).toBe('2天前');
    expect(formatRelativeTime(NOW - 6 * DAY, NOW)).toBe('6天前');
  });

  it('shows an absolute YYYY-MM-DD date beyond a week', () => {
    expect(formatRelativeTime(NOW - 10 * DAY, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
