/** 增量 8.5: 图鉴人物/词条的搜索过滤（纯函数，仿 src/lib/reader/toc.ts 的 filterChapters）。 */
import type { Character, Term } from './codex';

export function filterCharacters(chars: Character[], q: string): Character[] {
  const query = q.trim().toLowerCase();
  if (query === '') return chars.slice();
  return chars.filter((c) => {
    if (c.name.toLowerCase().includes(query)) return true;
    if (c.aliases.some((a) => a.text.toLowerCase().includes(query))) return true;
    if (c.groups.some((g) => g.name.toLowerCase().includes(query))) return true;
    if ((c.bio ?? []).some((b) => b.text.toLowerCase().includes(query))) return true;
    if ((c.identity ?? []).some((i) => i.text.toLowerCase().includes(query))) return true;
    return false;
  });
}

export function filterTerms(terms: Term[], q: string): Term[] {
  const query = q.trim().toLowerCase();
  if (query === '') return terms.slice();
  return terms.filter((t) => {
    if (t.name.toLowerCase().includes(query)) return true;
    if ((t.def ?? []).some((d) => d.text.toLowerCase().includes(query))) return true;
    if ((t.gloss ?? []).some((g) => g.text.toLowerCase().includes(query))) return true;
    return false;
  });
}
