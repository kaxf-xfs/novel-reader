/**
 * T5: settings persistence.
 *
 * The store depends only on a tiny `SettingsGateway` (read/write a JSON
 * string), so it is trivially unit-testable with the in-memory gateway below.
 * The device wiring (a file in documentDirectory) lives in
 * ./expoSettingsGateway.ts.
 *
 * `loadSettings` is defensive: a missing, corrupt, or partial blob — or even a
 * gateway that throws — always resolves to a valid `ReaderSettings` (defaults
 * merged in via sanitizeSettings). Reading settings must never crash the app.
 */

import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  type ReaderSettings,
} from './settings';

export interface SettingsGateway {
  /** Returns the stored JSON blob, or null if nothing has been written. */
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
}

/** In-memory gateway for tests. */
export class InMemorySettingsGateway implements SettingsGateway {
  private blob: string | null = null;

  async read(): Promise<string | null> {
    return this.blob;
  }

  async write(json: string): Promise<void> {
    this.blob = json;
  }
}

export async function loadSettings(gateway: SettingsGateway): Promise<ReaderSettings> {
  let raw: string | null;
  try {
    raw = await gateway.read();
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!raw) return { ...DEFAULT_SETTINGS };

  try {
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return sanitizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  gateway: SettingsGateway,
  settings: ReaderSettings,
): Promise<void> {
  const clean = sanitizeSettings(settings);
  await gateway.write(JSON.stringify(clean));
}
