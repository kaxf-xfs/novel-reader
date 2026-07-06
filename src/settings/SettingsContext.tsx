/**
 * T5: app-wide reader settings context.
 *
 * Loads persisted settings once on mount (defaults until then), exposes the
 * current `ReaderSettings` plus an `update(patch)` that merges + sanitizes +
 * persists (fire-and-forget). Both the reader and the typography sheet read
 * from here so changes are instant everywhere.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  type ReaderSettings,
} from '../lib/settings/settings';
import { loadSettings, saveSettings, type SettingsGateway } from '../lib/settings/store';

interface SettingsContextValue {
  settings: ReaderSettings;
  /** True once the persisted settings have been loaded from disk. */
  ready: boolean;
  update: (patch: Partial<ReaderSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

interface SettingsProviderProps {
  gateway: SettingsGateway;
  children: ReactNode;
}

export function SettingsProvider({ gateway, children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSettings(gateway).then((loaded) => {
      if (cancelled) return;
      setSettings(loaded);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  const update = useCallback(
    (patch: Partial<ReaderSettings>) => {
      setSettings((prev) => {
        const next = sanitizeSettings({ ...prev, ...patch });
        // Persist without blocking the UI; failures are non-fatal.
        void saveSettings(gateway, next);
        return next;
      });
    },
    [gateway],
  );

  return (
    <SettingsContext.Provider value={{ settings, ready, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
