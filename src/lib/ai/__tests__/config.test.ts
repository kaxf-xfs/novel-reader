import { InMemorySettingsGateway } from '../../settings/store';
import {
  DEFAULT_AI_CONFIG, sanitizeAiConfig, loadAiConfig, saveAiConfig, type AiConfig,
} from '../config';

describe('sanitizeAiConfig', () => {
  it('fills defaults from an empty patch', () => {
    expect(sanitizeAiConfig({})).toEqual(DEFAULT_AI_CONFIG);
  });
  it('trims a trailing slash on baseUrl', () => {
    expect(sanitizeAiConfig({ baseUrl: 'https://api.deepseek.com/' }).baseUrl).toBe(
      'https://api.deepseek.com',
    );
  });
  it('rejects a non-https baseUrl by falling back to the default', () => {
    expect(sanitizeAiConfig({ baseUrl: 'http://evil.test' }).baseUrl).toBe(DEFAULT_AI_CONFIG.baseUrl);
    expect(sanitizeAiConfig({ baseUrl: 42 as unknown as string }).baseUrl).toBe(DEFAULT_AI_CONFIG.baseUrl);
  });
  it('trims apiKey and keeps a non-empty model, else default model', () => {
    const c = sanitizeAiConfig({ apiKey: '  sk-x  ', model: '  ' });
    expect(c.apiKey).toBe('sk-x');
    expect(c.model).toBe(DEFAULT_AI_CONFIG.model);
  });
  it('coerces enabled to boolean and consentAt to number|null', () => {
    expect(sanitizeAiConfig({ enabled: 1 as unknown as boolean }).enabled).toBe(true);
    expect(sanitizeAiConfig({ consentAt: 'x' as unknown as number }).consentAt).toBeNull();
    expect(sanitizeAiConfig({ consentAt: 123 }).consentAt).toBe(123);
  });
  it('never throws on garbage', () => {
    expect(() => sanitizeAiConfig(null as unknown as Partial<AiConfig>)).not.toThrow();
  });
});

describe('persistence', () => {
  it('round-trips through a gateway', async () => {
    const gw = new InMemorySettingsGateway();
    await saveAiConfig(gw, sanitizeAiConfig({ apiKey: 'k', enabled: true, consentAt: 5 }));
    const loaded = await loadAiConfig(gw);
    expect(loaded.apiKey).toBe('k');
    expect(loaded.enabled).toBe(true);
    expect(loaded.consentAt).toBe(5);
  });
  it('returns defaults for empty / corrupt / throwing gateway', async () => {
    const empty = new InMemorySettingsGateway();
    expect(await loadAiConfig(empty)).toEqual(DEFAULT_AI_CONFIG);
    const corrupt = new InMemorySettingsGateway();
    await corrupt.write('not json');
    expect(await loadAiConfig(corrupt)).toEqual(DEFAULT_AI_CONFIG);
  });
});
