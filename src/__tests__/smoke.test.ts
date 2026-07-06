describe('toolchain smoke test', () => {
  it('runs TypeScript through jest-expo', () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(2, 3)).toBe(5);
  });
});
