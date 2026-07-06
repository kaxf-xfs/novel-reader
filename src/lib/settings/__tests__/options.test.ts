import { FONT_BOUNDS, FONT_IDS, THEME_IDS } from '../settings';
import { FONT_OPTIONS, THEME_OPTIONS, stepValue } from '../options';

describe('stepValue', () => {
  it('increments by the bound step', () => {
    expect(stepValue(18, FONT_BOUNDS, +1)).toBe(19);
  });

  it('decrements by the bound step', () => {
    expect(stepValue(18, FONT_BOUNDS, -1)).toBe(17);
  });

  it('does not exceed the maximum', () => {
    expect(stepValue(FONT_BOUNDS.max, FONT_BOUNDS, +1)).toBe(FONT_BOUNDS.max);
  });

  it('does not drop below the minimum', () => {
    expect(stepValue(FONT_BOUNDS.min, FONT_BOUNDS, -1)).toBe(FONT_BOUNDS.min);
  });

  it('rounds float steps to avoid drift', () => {
    // 1.2 + 0.1 in float is 1.3000000000000003; expect a clean value
    expect(stepValue(1.2, { min: 1.2, max: 2.4, step: 0.1 }, +1)).toBeCloseTo(1.3, 5);
    expect(Number.isInteger(stepValue(1.2, { min: 1.2, max: 2.4, step: 0.1 }, +1) * 10)).toBe(
      true,
    );
  });
});

describe('option lists', () => {
  it('has a labeled option for every font id', () => {
    expect(FONT_OPTIONS.map((o) => o.id).sort()).toEqual([...FONT_IDS].sort());
    for (const opt of FONT_OPTIONS) expect(opt.label.length).toBeGreaterThan(0);
  });

  it('has a labeled option for every theme id', () => {
    expect(THEME_OPTIONS.map((o) => o.id).sort()).toEqual([...THEME_IDS].sort());
    for (const opt of THEME_OPTIONS) expect(opt.label.length).toBeGreaterThan(0);
  });
});
