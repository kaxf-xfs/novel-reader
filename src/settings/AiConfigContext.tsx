/** 增量 5: 本地 AI 配置的 Context（仿 SettingsContext）。 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { DEFAULT_AI_CONFIG, loadAiConfig, sanitizeAiConfig, saveAiConfig, type AiConfig } from '../lib/ai/config';
import type { SettingsGateway } from '../lib/settings/store';

interface AiConfigContextValue {
  aiConfig: AiConfig;
  ready: boolean;
  update: (patch: Partial<AiConfig>) => void;
}

const AiConfigContext = createContext<AiConfigContextValue | null>(null);

export function AiConfigProvider({ gateway, children }: { gateway: SettingsGateway; children: ReactNode }) {
  const [aiConfig, setAiConfig] = useState<AiConfig>(DEFAULT_AI_CONFIG);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAiConfig(gateway).then((c) => {
      if (cancelled) return;
      setAiConfig(c);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  const update = useCallback(
    (patch: Partial<AiConfig>) => {
      setAiConfig((prev) => {
        const next = sanitizeAiConfig({ ...prev, ...patch });
        void saveAiConfig(gateway, next);
        return next;
      });
    },
    [gateway],
  );

  return <AiConfigContext.Provider value={{ aiConfig, ready, update }}>{children}</AiConfigContext.Provider>;
}

export function useAiConfig(): AiConfigContextValue {
  const ctx = useContext(AiConfigContext);
  if (!ctx) throw new Error('useAiConfig must be used within an AiConfigProvider');
  return ctx;
}
