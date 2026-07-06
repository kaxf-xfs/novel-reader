/**
 * T8: pick the "continue reading" hero for the shelf's hero layout — the book
 * read most recently. Order-independent; the rest keep their original order.
 */

export interface HeroFields {
  lastReadAt: number | null;
}

export interface HeroSplit<T> {
  hero: T | null;
  rest: T[];
}

export function selectHero<T extends HeroFields>(items: T[]): HeroSplit<T> {
  let hero: T | null = null;
  for (const it of items) {
    if (it.lastReadAt == null) continue;
    if (hero === null || it.lastReadAt > (hero.lastReadAt ?? -Infinity)) {
      hero = it;
    }
  }
  const rest = hero === null ? items.slice() : items.filter((it) => it !== hero);
  return { hero, rest };
}
