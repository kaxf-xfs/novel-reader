import { render, type RenderResult } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { InMemorySettingsGateway } from '../lib/settings/store';
import { AiConfigProvider } from '../settings/AiConfigContext';

export interface RenderWithAiConfigResult extends RenderResult {
  gateway: InMemorySettingsGateway;
}

export function renderWithAiConfig(
  ui: ReactElement,
  gateway: InMemorySettingsGateway = new InMemorySettingsGateway(),
): RenderWithAiConfigResult {
  const result = render(<AiConfigProvider gateway={gateway}>{ui}</AiConfigProvider>);
  return { ...result, gateway };
}
