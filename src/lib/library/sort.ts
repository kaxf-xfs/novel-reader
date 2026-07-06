/**
 * T6: order the shelf by most-recent interaction — a book's last-read time if
 * it has been opened, otherwise its import time. Recently-read and
 * recently-imported books both float to the top.
 */

export interface RecencyFields {
  importedAt: number;
  lastReadAt: number | null;
}

function effectiveTime(item: RecencyFields): number {
  return item.lastReadAt ?? item.importedAt;
}

/**
 * Returns a new array sorted by effective time descending. Stable for ties
 * (equal times keep their original relative order); does not mutate input.
 */
export function sortByRecent<T extends RecencyFields>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = effectiveTime(b.item) - effectiveTime(a.item);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ item }) => item);
}
