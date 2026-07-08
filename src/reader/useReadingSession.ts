import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { ReadingSession } from '../lib/import/repository';
import { createSessionTracker, type FlushResult } from '../lib/stats/sessionTracker';

const IDLE_TICK_MS = 30_000;

export interface UseReadingSessionParams {
  bookId: string;
  persist: (s: ReadingSession) => void;
  /** Injectable clock for tests; defaults to Date.now. */
  nowFn?: () => number;
}

export function useReadingSession({
  bookId,
  persist,
  nowFn = Date.now,
}: UseReadingSessionParams): { registerActivity: () => void } {
  const trackerRef = useRef(createSessionTracker());
  // Keep the latest persist/now without re-subscribing the effect.
  const persistRef = useRef(persist);
  const nowRef = useRef(nowFn);
  persistRef.current = persist;
  nowRef.current = nowFn;

  const flushAndPersist = (result: FlushResult | null): void => {
    if (!result) return;
    const id = `${result.startedAt}-${Math.round(result.durationMs)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    persistRef.current({ id, bookId, startedAt: result.startedAt, durationMs: result.durationMs });
  };

  useEffect(() => {
    const tracker = trackerRef.current;
    tracker.start(nowRef.current());

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      const now = nowRef.current();
      const active = state === 'active';
      tracker.setForeground(active, now);
      if (!active) flushAndPersist(tracker.flush(now));
    });

    const interval = setInterval(() => {
      tracker.tickIdle(nowRef.current());
    }, IDLE_TICK_MS);

    return () => {
      clearInterval(interval);
      sub.remove();
      flushAndPersist(tracker.flush(nowRef.current()));
    };
    // bookId identifies the reading target; re-subscribe if it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  return {
    registerActivity: () => {
      trackerRef.current.activity(nowRef.current());
    },
  };
}
