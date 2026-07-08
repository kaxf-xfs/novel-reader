import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useReadingSession } from '../useReadingSession';
import type { ReadingSession } from '../../lib/import/repository';

function Harness({ persist, nowRef }: { persist: (s: ReadingSession) => void; nowRef: { t: number } }) {
  useReadingSession({ bookId: 'b1', persist, nowFn: () => nowRef.t });
  return <Text>reader</Text>;
}

describe('useReadingSession', () => {
  it('persists a session on unmount when >= 5s accrued', () => {
    const persist = jest.fn();
    const nowRef = { t: 0 };
    const { unmount } = render(<Harness persist={persist} nowRef={nowRef} />);
    nowRef.t = 8_000; // 8s of foreground reading
    unmount();
    expect(persist).toHaveBeenCalledTimes(1);
    const s = persist.mock.calls[0][0] as ReadingSession;
    expect(s.bookId).toBe('b1');
    expect(s.durationMs).toBe(8_000);
    expect(typeof s.id).toBe('string');
    expect(s.id.length).toBeGreaterThan(0);
  });

  it('does not persist a sub-5s session on unmount', () => {
    const persist = jest.fn();
    const nowRef = { t: 0 };
    const { unmount } = render(<Harness persist={persist} nowRef={nowRef} />);
    nowRef.t = 3_000;
    unmount();
    expect(persist).not.toHaveBeenCalled();
  });
});
