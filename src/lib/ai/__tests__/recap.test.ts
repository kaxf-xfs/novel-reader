import { isRecapDue } from '../recap';

const DAY = 86_400_000;
describe('isRecapDue', () => {
  const now = 10_000 * DAY;
  test('间隔 ≥ gapDays 且有进度 → true', () => {
    expect(isRecapDue({ lastReadAt: now - 8 * DAY, now, gapDays: 7, currentChapterIndex: 5 })).toBe(true);
  });
  test('间隔不足 → false', () => {
    expect(isRecapDue({ lastReadAt: now - 3 * DAY, now, gapDays: 7, currentChapterIndex: 5 })).toBe(false);
  });
  test('currentChapterIndex=0（无前情）→ false', () => {
    expect(isRecapDue({ lastReadAt: now - 30 * DAY, now, gapDays: 7, currentChapterIndex: 0 })).toBe(false);
  });
  test('lastReadAt=null → false', () => {
    expect(isRecapDue({ lastReadAt: null, now, gapDays: 7, currentChapterIndex: 5 })).toBe(false);
  });
  test('gapDays=0 → 只要有进度即 true', () => {
    expect(isRecapDue({ lastReadAt: now, now, gapDays: 0, currentChapterIndex: 5 })).toBe(true);
    expect(isRecapDue({ lastReadAt: now, now, gapDays: 0, currentChapterIndex: 0 })).toBe(false);
  });
});
