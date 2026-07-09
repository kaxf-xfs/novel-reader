/**
 * 增量 5: AI 伴读配置（OpenAI 兼容）。纯逻辑 + 通过 SettingsGateway 持久化，
 * 存在与阅读设置分开的 ai-config.json。sanitizeAiConfig 是唯一信任边界，永不抛。
 */

import type { SettingsGateway } from '../settings/store';

export interface AiConfig {
  /** OpenAI-compatible base URL, e.g. https://api.deepseek.com (no trailing slash). */
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  /** Unix ms when the user consented to sending book text; null = not consented. */
  consentAt: number | null;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  enabled: false,
  consentAt: null,
};

function cleanBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_AI_CONFIG.baseUrl;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https:\/\/.+/i.test(trimmed)) return DEFAULT_AI_CONFIG.baseUrl;
  return trimmed;
}

export function sanitizeAiConfig(patch: Partial<AiConfig> | null | undefined): AiConfig {
  const p = patch ?? {};
  const model = typeof p.model === 'string' && p.model.trim() ? p.model.trim() : DEFAULT_AI_CONFIG.model;
  return {
    baseUrl: cleanBaseUrl(p.baseUrl),
    apiKey: typeof p.apiKey === 'string' ? p.apiKey.trim() : DEFAULT_AI_CONFIG.apiKey,
    model,
    enabled: Boolean(p.enabled),
    consentAt: typeof p.consentAt === 'number' && Number.isFinite(p.consentAt) ? p.consentAt : null,
  };
}

export async function loadAiConfig(gateway: SettingsGateway): Promise<AiConfig> {
  let raw: string | null;
  try {
    raw = await gateway.read();
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
  if (!raw) return { ...DEFAULT_AI_CONFIG };
  try {
    return sanitizeAiConfig(JSON.parse(raw) as Partial<AiConfig>);
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export async function saveAiConfig(gateway: SettingsGateway, config: AiConfig): Promise<void> {
  await gateway.write(JSON.stringify(sanitizeAiConfig(config)));
}
