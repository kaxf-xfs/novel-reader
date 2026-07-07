import { makeSnippet } from '../snippet';

describe('makeSnippet', () => {
  it('returns short text unchanged', () => {
    expect(makeSnippet('他推开门。')).toBe('他推开门。');
  });

  it('truncates long text to max chars with an ellipsis', () => {
    const long = '一'.repeat(50);
    expect(makeSnippet(long, 40)).toBe('一'.repeat(40) + '…');
  });

  it('trims surrounding whitespace before measuring', () => {
    expect(makeSnippet('  　他推开门。  ')).toBe('他推开门。');
  });

  it('returns empty string for blank input', () => {
    expect(makeSnippet('   ')).toBe('');
    expect(makeSnippet('')).toBe('');
  });

  it('uses a default max of 40', () => {
    expect(makeSnippet('字'.repeat(41)).length).toBe(41); // 40 chars + '…'
  });
});
