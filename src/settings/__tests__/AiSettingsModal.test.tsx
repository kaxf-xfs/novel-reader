import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { InMemorySettingsGateway } from '../../lib/settings/store';
import { loadAiConfig } from '../../lib/ai/config';
import { AiConfigProvider } from '../AiConfigContext';
import { SettingsProvider } from '../SettingsContext';
import { InMemorySettingsGateway as SettingsGw } from '../../lib/settings/store';
import { AiSettingsModal } from '../AiSettingsModal';

function renderModal() {
  const aiGw = new InMemorySettingsGateway();
  const onClose = jest.fn();
  const utils = render(
    <SettingsProvider gateway={new SettingsGw()}>
      <AiConfigProvider gateway={aiGw}>
        <AiSettingsModal visible onClose={onClose} />
      </AiConfigProvider>
    </SettingsProvider>,
  );
  return { ...utils, aiGw, onClose };
}

describe('AiSettingsModal', () => {
  it('saves the entered api key + enable to the gateway', async () => {
    const { findByTestId, getByTestId, aiGw } = renderModal();
    fireEvent.changeText(await findByTestId('ai-api-key'), 'sk-abc');
    fireEvent.press(getByTestId('ai-enable'));
    fireEvent.press(getByTestId('ai-save'));
    await waitFor(async () => {
      const c = await loadAiConfig(aiGw);
      expect(c.apiKey).toBe('sk-abc');
      expect(c.enabled).toBe(true);
    });
  });
});
