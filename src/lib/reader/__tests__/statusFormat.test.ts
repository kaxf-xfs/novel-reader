import { formatClock, formatBattery } from '../statusFormat';

describe('formatClock', () => {
  it('formats hours and minutes zero-padded, 24-hour', () => {
    expect(formatClock(new Date(2026, 6, 6, 9, 5))).toBe('09:05');
    expect(formatClock(new Date(2026, 6, 6, 22, 48))).toBe('22:48');
    expect(formatClock(new Date(2026, 6, 6, 0, 0))).toBe('00:00');
  });
});

describe('formatBattery', () => {
  it('formats a 0..1 level as a rounded percentage', () => {
    expect(formatBattery(0.85)).toBe('85%');
    expect(formatBattery(1)).toBe('100%');
    expect(formatBattery(0)).toBe('0%');
  });

  it('rounds to the nearest percent', () => {
    expect(formatBattery(0.844)).toBe('84%');
    expect(formatBattery(0.846)).toBe('85%');
  });

  it('shows a dash for an unknown level (negative)', () => {
    expect(formatBattery(-1)).toBe('—');
  });
});
