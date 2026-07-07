/** 增量1: 从段落文本生成书签列表用的短摘要。 */
export function makeSnippet(text: string, max = 40): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}
