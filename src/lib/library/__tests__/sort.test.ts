import { sortByRecent } from '../sort';

interface Item {
  id: string;
  importedAt: number;
  lastReadAt: number | null;
}

const item = (id: string, importedAt: number, lastReadAt: number | null): Item => ({
  id,
  importedAt,
  lastReadAt,
});

describe('sortByRecent', () => {
  it('orders unread books by importedAt descending', () => {
    const items = [item('a', 100, null), item('b', 300, null), item('c', 200, null)];
    expect(sortByRecent(items).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('ranks a recently-read book above a more-recently-imported unread one', () => {
    const recentlyRead = item('read', 100, 999);
    const freshImport = item('fresh', 500, null);
    expect(sortByRecent([freshImport, recentlyRead]).map((i) => i.id)).toEqual([
      'read',
      'fresh',
    ]);
  });

  it('uses lastReadAt when present, otherwise importedAt', () => {
    const items = [
      item('x', 10, 50), // effective 50
      item('y', 80, null), // effective 80
      item('z', 20, 200), // effective 200
    ];
    expect(sortByRecent(items).map((i) => i.id)).toEqual(['z', 'y', 'x']);
  });

  it('does not mutate the input array', () => {
    const items = [item('a', 1, null), item('b', 2, null)];
    const copy = [...items];
    sortByRecent(items);
    expect(items).toEqual(copy);
  });

  it('is stable for equal effective times', () => {
    const items = [item('a', 100, null), item('b', 100, null), item('c', 100, null)];
    expect(sortByRecent(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
