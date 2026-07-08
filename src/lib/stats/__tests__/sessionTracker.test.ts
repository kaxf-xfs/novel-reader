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
    t.activity(6_000);
    t.tickIdle(6_000 + IDLE_TIMEOUT_MS); // crosses the idle threshold
    const r = t.flush(999_999);
    expect(r).toEqual({ startedAt: 0, durationMs: 6_000 });
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
