/**
 * 增量 8.5: 图鉴润色 pass。纯函数部分：碎片指纹 + 脏检测。
 *
 * 指纹覆盖的字段集合必须和喂给润色 prompt 的字段集合完全一致——人物是
 * identity+origin+events，词条是 def。若某个字段更新了但没进指纹，会造成
 * "该更新简介却没更新"的过期问题（不是泄漏，但是体验倒退）。
 */
import type { Character, TextAtIdx, Term } from './codex';

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function sortedFragmentKey(arr: TextAtIdx[] | undefined): string {
  return (arr ?? [])
    .map((x) => JSON.stringify({ idx: x.idx, text: x.text }))
    .sort()
    .join('|');
}

export function characterFragmentHash(c: Character): string {
  const key = [
    sortedFragmentKey(c.identity),
    sortedFragmentKey(c.origin),
    sortedFragmentKey(c.events),
  ].join('##');
  return fnv1a(key);
}

export function termFragmentHash(t: Term): string {
  return fnv1a(sortedFragmentKey(t.def));
}

export function isCharacterDirty(c: Character): boolean {
  return c.bioHash !== characterFragmentHash(c);
}

export function isTermDirty(t: Term): boolean {
  return t.glossHash !== termFragmentHash(t);
}
