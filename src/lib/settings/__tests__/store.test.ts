import { DEFAULT_SETTINGS } from '../settings';
import {
  InMemorySettingsGateway,
  loadSettings,
  saveSettings,
} from '../store';

describe('settings store', () => {
  it('returns the defaults when nothing has been saved', async () => {
    const gw = new InMemorySettingsGateway();
    expect(await loadSettings(gw)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips saved settings', async () => {
    const gw = new InMemorySettingsGateway();
    const next = { ...DEFAULT_SETTINGS, fontSize: 24, themeId: 'sepia' as const };
    await saveSettings(gw, next);
    expect(await loadSettings(gw)).toEqual(next);
  });

  it('sanitizes settings on save (clamps out-of-range)', async () => {
    const gw = new InMemorySettingsGateway();
    await saveSettings(gw, { ...DEFAULT_SETTINGS, fontSize: 9999 });
    const loaded = await loadSettings(gw);
    expect(loaded.fontSize).toBe(30); // FONT_BOUNDS.max
  });

  it('falls back to defaults when the stored blob is corrupt JSON', async () => {
    const gw = new InMemorySettingsGateway();
    await gw.write('{ this is not json');
    expect(await loadSettings(gw)).toEqual(DEFAULT_SETTINGS);
  });

  it('fills in missing fields from a partial stored blob', async () => {
    const gw = new InMemorySettingsGateway();
    await gw.write(JSON.stringify({ fontSize: 20 }));
    const loaded = await loadSettings(gw);
    expect(loaded.fontSize).toBe(20);
    expect(loaded.themeId).toBe(DEFAULT_SETTINGS.themeId);
  });

  it('does not throw when the gateway read fails', async () => {
    const gw = new InMemorySettingsGateway();
    gw.read = async () => {
      throw new Error('disk error');
    };
    expect(await loadSettings(gw)).toEqual(DEFAULT_SETTINGS);
  });
});
