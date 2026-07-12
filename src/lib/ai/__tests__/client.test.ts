import { DEFAULT_AI_CONFIG, type AiConfig } from '../config';
import { AiError, chatComplete, type ChatMessage } from '../client';

const cfg: AiConfig = { ...DEFAULT_AI_CONFIG, apiKey: 'sk-test' };
const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('chatComplete', () => {
  it('throws no-key when apiKey is empty', async () => {
    await expect(
      chatComplete({ config: DEFAULT_AI_CONFIG, messages: msgs, fetchImpl: jest.fn() }),
    ).rejects.toMatchObject({ kind: 'no-key' });
  });

  it('returns content + finishReason on success', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: '你好' }, finish_reason: 'stop' }] }),
    ) as unknown as typeof fetch;
    const r = await chatComplete({ config: cfg, messages: msgs, fetchImpl });
    expect(r).toEqual({ content: '你好', finishReason: 'stop' });
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('maps 402 to insufficient-balance and 429 to rate-limited', async () => {
    const f402 = jest.fn(async () => jsonResponse(402, { error: { message: 'no balance' } })) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f402 })).rejects.toMatchObject({
      kind: 'insufficient-balance', status: 402,
    });
    const f429 = jest.fn(async () => jsonResponse(429, { error: { message: 'slow down' } })) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f429 })).rejects.toMatchObject({
      kind: 'rate-limited', status: 429,
    });
  });

  it('maps other non-2xx to http', async () => {
    const f = jest.fn(async () => jsonResponse(500, { error: { message: 'boom' } })) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f })).rejects.toMatchObject({ kind: 'http', status: 500 });
  });

  it('maps missing content to bad-response', async () => {
    const f = jest.fn(async () => jsonResponse(200, { choices: [] })) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f })).rejects.toMatchObject({ kind: 'bad-response' });
  });

  it('passes through finish_reason=length (degrade signal)', async () => {
    const f = jest.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }),
    ) as unknown as typeof fetch;
    const r = await chatComplete({ config: cfg, messages: msgs, fetchImpl: f });
    expect(r.finishReason).toBe('length');
  });

  it('classifies an external abort as cancelled', async () => {
    const ctrl = new AbortController();
    const fetchImpl = jest.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    }) as unknown as typeof fetch;
    const p = chatComplete({ config: cfg, messages: msgs, fetchImpl, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('classifies a timeout when the request outlives timeoutMs', async () => {
    const fetchImpl = jest.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    }) as unknown as typeof fetch;
    await expect(
      chatComplete({ config: cfg, messages: msgs, fetchImpl, timeoutMs: 10 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('maps a fetch rejection (not abort) to network', async () => {
    const f = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(chatComplete({ config: cfg, messages: msgs, fetchImpl: f })).rejects.toMatchObject({ kind: 'network' });
  });

  it('never leaks the api key in the error message', async () => {
    const f = jest.fn(async () => jsonResponse(500, { error: { message: 'server sk-test leak' } })) as unknown as typeof fetch;
    const err = (await chatComplete({ config: cfg, messages: msgs, fetchImpl: f }).catch((e) => e)) as AiError;
    expect(err.message).not.toContain('sk-test');
  });

  it('passes response_format when responseFormat is set', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }),
    ) as unknown as typeof fetch;
    await chatComplete({ config: cfg, messages: msgs, fetchImpl, responseFormat: 'json_object' });
    const [, init] = (fetchImpl as jest.Mock).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omits response_format when not set (unchanged existing behavior)', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }),
    ) as unknown as typeof fetch;
    await chatComplete({ config: cfg, messages: msgs, fetchImpl });
    const [, init] = (fetchImpl as jest.Mock).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format).toBeUndefined();
  });
});
