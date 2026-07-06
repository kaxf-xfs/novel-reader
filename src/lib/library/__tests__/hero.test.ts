import { selectHero } from '../hero';

interface Item {
  id: string;
  lastReadAt: number | null;
}
const item = (id: string, lastReadAt: number | null): Item => ({ id, lastReadAt });

describe('selectHero', () => {
  it('returns no hero when nothing has been read', () => {
    const items = [item('a', null), item('b', null)];
    const { hero, rest } = selectHero(items);
    expect(hero).toBeNull();
    expect(rest.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('picks the single read book as the hero and excludes it from rest', () => {
    const items = [item('a', null), item('b', 500), item('c', null)];
    const { hero, rest } = selectHero(items);
    expect(hero?.id).toBe('b');
    expect(rest.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('picks the most-recently-read book when several have been read', () => {
    const items = [item('a', 100), item('b', 900), item('c', 400)];
    const { hero } = selectHero(items);
    expect(hero?.id).toBe('b');
  });

  it('preserves the order of the remaining books', () => {
    const items = [item('a', 100), item('b', 900), item('c', 400)];
    expect(selectHero(items).rest.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('handles an empty shelf', () => {
    const { hero, rest } = selectHero<Item>([]);
    expect(hero).toBeNull();
    expect(rest).toEqual([]);
  });
});
