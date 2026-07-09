import { Text, Pressable } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { InMemorySettingsGateway } from '../../lib/settings/store';
import { loadAiConfig } from '../../lib/ai/config';
import { renderWithAiConfig } from '../../test-utils/renderWithAiConfig';
import { useAiConfig } from '../AiConfigContext';

function Probe() {
  const { aiConfig, update } = useAiConfig();
  return (
    <>
      <Text testID="key">{aiConfig.apiKey}</Text>
      <Pressable testID="set" onPress={() => update({ apiKey: 'sk-123', enabled: true })}>
        <Text>set</Text>
      </Pressable>
    </>
  );
}

describe('AiConfigContext', () => {
  it('updates and persists ai config through the gateway', async () => {
    const gw = new InMemorySettingsGateway();
    const { getByTestId, findByTestId } = renderWithAiConfig(<Probe />, gw);
    await findByTestId('key');
    fireEvent.press(getByTestId('set'));
    await waitFor(() => expect(getByTestId('key').props.children).toBe('sk-123'));
    await waitFor(async () => expect((await loadAiConfig(gw)).apiKey).toBe('sk-123'));
  });
});
