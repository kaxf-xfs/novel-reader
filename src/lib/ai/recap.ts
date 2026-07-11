const DAY_MS = 86_400_000;

export interface IsRecapDueParams {
  lastReadAt: number | null;
  now: number;
  gapDays: number;
  currentChapterIndex: number;
}

export function isRecapDue({ lastReadAt, now, gapDays, currentChapterIndex }: IsRecapDueParams): boolean {
  if (lastReadAt == null) return false;
  if (currentChapterIndex <= 0) return false;
  return now - lastReadAt >= gapDays * DAY_MS;
}
