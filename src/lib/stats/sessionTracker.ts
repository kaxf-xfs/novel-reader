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
      // Discard against wall-clock elapsed time since the segment started,
      // not the accrued *active* time: a segment that idled out after only
      // 1s of activity but spanned a long real-world gap is still a
      // legitimate (if mostly idle) session and should be kept, whereas a
      // segment flushed within a few seconds of starting is noise.
      if (at === null || now - at < MIN_SESSION_MS) return null;
      return { startedAt: at, durationMs };
    },
  };
}
