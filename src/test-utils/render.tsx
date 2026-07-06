/**
 * renderWithSettings — wraps a UI tree in a SettingsProvider backed by an
 * in-memory gateway, so components using `useSettings` render in tests and
 * their settings changes can be read back from the returned gateway.
 */

import { render, type RenderResult } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { InMemorySettingsGateway } from '../lib/settings/store';
import { SettingsProvider } from '../settings/SettingsContext';

export interface RenderWithSettingsResult extends RenderResult {
  gateway: InMemorySettingsGateway;
}

export function renderWithSettings(
  ui: ReactElement,
  gateway: InMemorySettingsGateway = new InMemorySettingsGateway(),
): RenderWithSettingsResult {
  const result = render(<SettingsProvider gateway={gateway}>{ui}</SettingsProvider>);
  return { ...result, gateway };
}
