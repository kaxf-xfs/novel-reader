/**
 * 增量 5: OpenAI 兼容 chat completions 客户端。注入 fetchImpl 可测；
 * AbortController + 超时；错误分类；日志/错误信息脱敏 api key。非流式。
 */

import type { AiConfig } from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AiErrorKind =
  | 'no-key'
  | 'cancelled'
  | 'timeout'
  | 'insufficient-balance'
  | 'rate-limited'
  | 'http'
  | 'bad-response'
  | 'network';

export class AiError extends Error {
  kind: AiErrorKind;
  status?: number;
  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
  }
}

export interface ChatResult {
  content: string;
  finishReason: string | null;
}

export interface ChatOptions {
  config: AiConfig;
  messages: ChatMessage[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

function redact(text: string, key: string): string {
  return key ? text.split(key).join('***') : text;
}

export async function chatComplete(opts: ChatOptions): Promise<ChatResult> {
  const { config, messages, signal, maxTokens, temperature, timeoutMs = 60_000 } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  if (!config.apiKey) throw new AiError('no-key', 'AI 未配置 API key');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const res = await doFetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
        ...(temperature != null ? { temperature } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        detail = body?.error?.message ?? '';
      } catch {
        detail = '';
      }
      const msg = redact(`AI 请求失败 (${res.status})${detail ? ': ' + detail : ''}`, config.apiKey);
      if (res.status === 402) throw new AiError('insufficient-balance', msg, 402);
      if (res.status === 429) throw new AiError('rate-limited', msg, 429);
      throw new AiError('http', msg, res.status);
    }

    let body: { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new AiError('bad-response', 'AI 返回无法解析');
    }
    const choice = body.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string') throw new AiError('bad-response', 'AI 返回缺少内容');
    return { content, finishReason: choice?.finish_reason ?? null };
  } catch (e) {
    if (e instanceof AiError) throw e;
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') {
      throw timedOut
        ? new AiError('timeout', 'AI 请求超时')
        : new AiError('cancelled', 'AI 请求已取消');
    }
    const raw = e instanceof Error ? e.message : String(e);
    throw new AiError('network', redact(`网络错误: ${raw}`, config.apiKey));
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
