/**
 * T5: ExpoSettingsGateway — production SettingsGateway backed by
 * expo-file-system v15. Persists a single small JSON blob at
 *   <documentDirectory>/settings.json
 *
 * NOT unit-tested (native file-system operations don't run in Jest/Node); the
 * pure store logic is covered by store.test.ts via InMemorySettingsGateway.
 */

import { File, Paths } from 'expo-file-system';
import type { SettingsGateway } from './store';

export class ExpoSettingsGateway implements SettingsGateway {
  constructor(private readonly filename: string = 'settings.json') {}

  private file(): File {
    return new File(Paths.document, this.filename);
  }

  async read(): Promise<string | null> {
    const file = this.file();
    if (!file.exists) return null;
    return file.text();
  }

  async write(json: string): Promise<void> {
    this.file().write(json);
  }
}
