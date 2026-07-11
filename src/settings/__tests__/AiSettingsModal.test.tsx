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

  // NOTE: the brief's Step 1 sketch called `renderModal({ update })` to inject a
  // jest.fn mock for `update`. This file's `renderModal` (established in the
  // test above) instead wires a real `AiConfigProvider` + in-memory gateway and
  // asserts persisted state via `loadAiConfig(aiGw)`. Following "reuse the
  // existing render helper, don't invent a new pattern," these two tests keep
  // that same real-gateway assertion style rather than adding mock injection.
  it('保存时带上 recapEnabled 与解析后的 recapGapDays', async () => {
    const { findByTestId, getByTestId, aiGw } = renderModal();
    fireEvent.changeText(await findByTestId('ai-recap-gap'), '3');
    fireEvent.press(getByTestId('ai-recap-enable'));
    fireEvent.press(getByTestId('ai-save'));
    await waitFor(async () => {
      const c = await loadAiConfig(aiGw);
      expect(c.recapGapDays).toBe(3);
      expect(c.recapEnabled).toBe(false); // toggled away from the true default
    });
  });

  it('recap 天数空串保存 → 回落 7', async () => {
    const { findByTestId, getByTestId, aiGw } = renderModal();
    fireEvent.changeText(await findByTestId('ai-recap-gap'), '');
    fireEvent.press(getByTestId('ai-save'));
    await waitFor(async () => {
      const c = await loadAiConfig(aiGw);
      expect(c.recapGapDays).toBe(7);
    });
  });
});
