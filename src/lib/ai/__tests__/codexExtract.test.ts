import type { ChatMessage, ChatResult } from '../client';
import { extractCodex, type CodexBlock, type RosterEntry } from '../codexExtract';

function block(items: { idx: number; summary: string }[]): CodexBlock {
  return { items };
}

describe('extractCodex', () => {
  it('stamps every idx to the block maxIdx, ignoring any self-reported idx in the LLM JSON', async () => {
    const chat = jest.fn(
      async (): Promise<ChatResult> => ({
        content: JSON.stringify({
          characters: [{ name: '张三', idx: 9999, aliases: [], identity: ['少年侠客'], groups: ['无名派'] }],
          terms: [{ name: '无名剑', category: '物品', def: '一把普通铁剑', idx: 9999 }],
          relations: [{ from: '张三', to: '李四', kind: '同门' }],
        }),
        finishReason: 'stop',
      }),
    );
    const blocks = [block([{ idx: 3, summary: 's3' }, { idx: 5, summary: 's5' }])];
    const [result] = await extractCodex({ chat }, { blocks, roster: [] });
    expect(result.maxIdx).toBe(5);
    expect(result.partial.characters?.[0]).toMatchObject({ name: '张三', firstChapterIdx: 5 });
    expect(result.partial.characters?.[0].identity).toEqual([{ text: '少年侠客', idx: 5 }]);
    expect(result.partial.terms?.[0].def).toEqual([{ text: '一把普通铁剑', idx: 5 }]);
    expect(result.partial.relations?.[0]).toEqual({ from: '张三', to: '李四', kind: '同门', idx: 5 });
  });

  it('a whole block with unparseable JSON degrades to empty, never throws', async () => {
    const chat = jest.fn(async (): Promise<ChatResult> => ({ content: '不是 JSON，抱歉', finishReason: 'stop' }));
    const blocks = [block([{ idx: 1, summary: 's1' }])];
    const [result] = await extractCodex({ chat }, { blocks, roster: [] });
    expect(result.partial).toEqual({ characters: [], terms: [], relations: [] });
  });

  it('drops a single bad entity (missing name) but keeps the rest of the same block', async () => {
    const chat = jest.fn(
      async (): Promise<ChatResult> => ({
        content: JSON.stringify({
          characters: [{ aliases: [] }, { name: '王五', identity: ['配角'] }],
          terms: [],
          relations: [],
        }),
        finishReason: 'stop',
      }),
    );
    const blocks = [block([{ idx: 2, summary: 's2' }])];
    const [result] = await extractCodex({ chat }, { blocks, roster: [] });
    expect(result.partial.characters?.map((c) => c.name)).toEqual(['王五']);
  });

  it('bisects a truncated block into two sub-blocks with their own recomputed maxIdx', async () => {
    const calls: number[] = [];
    const chat = jest.fn(async (messages: ChatMessage[]): Promise<ChatResult> => {
      const userText = messages[1].content;
      calls.push(userText.split('\n').length); // 记录每次调用喂了几条摘要
      if (userText.includes('[2]')) {
        // 父块（两条摘要）永远截断，逼迫二分
        return { content: 'x', finishReason: 'length' };
      }
      return { content: JSON.stringify({ characters: [{ name: 'X' }], terms: [], relations: [] }), finishReason: 'stop' };
    });
    const blocks = [block([{ idx: 3, summary: 's3' }, { idx: 7, summary: 's7' }])];
    const [result] = await extractCodex({ chat }, { blocks, roster: [] });
    expect(calls.length).toBe(3); // 1 次父块（截断）+ 2 次子块
    expect(result.maxIdx).toBe(7); // 顶层结果的 maxIdx 仍是整块的 maxIdx
    expect(result.partial.characters?.length).toBe(2); // 两个子块各贡献一个 X
  });

  it('caps bisection recursion depth so an always-truncated block terminates', async () => {
    const chat = jest.fn(async (): Promise<ChatResult> => ({ content: 'never valid', finishReason: 'length' }));
    const items = Array.from({ length: 20 }, (_, i) => ({ idx: i, summary: `s${i}` }));
    const blocks = [block(items)];
    await expect(extractCodex({ chat }, { blocks, roster: [] })).resolves.toBeDefined();
    // 20 条摘要每次对半分：20→10→5→3→2(depth4 停止细分，直接按当前子块尝试解析)
    // 深度封顶保证了这里不会无限递归/调用数不会失控增长。
    expect(chat.mock.calls.length).toBeLessThan(50);
  });

  it('injects the roster into the prompt when provided, and a fallback note when empty', async () => {
    const chat = jest.fn(async (_messages: ChatMessage[]): Promise<ChatResult> => ({ content: '{}', finishReason: 'stop' }));
    const roster: RosterEntry[] = [{ name: '张三', aliases: ['三公子'] }];
    const blocks = [block([{ idx: 0, summary: 's0' }])];

    await extractCodex({ chat }, { blocks, roster });
    const withRoster = (chat.mock.calls[0][0] as ChatMessage[])[0].content;
    expect(withRoster).toContain('张三');
    expect(withRoster).toContain('三公子');

    await extractCodex({ chat }, { blocks, roster: [] });
    const withoutRoster = (chat.mock.calls[1][0] as ChatMessage[])[0].content;
    expect(withoutRoster).toContain('暂无已知人物名册');
  });
});
