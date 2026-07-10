import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithSettings } from '../../test-utils/render';
import { AiError } from '../../lib/ai/client';
import { AiPanel } from '../AiPanel';

const base = {
  visible: true, onClose: jest.fn(), configured: true, consented: true,
  onOpenSettings: jest.fn(), onConsent: jest.fn(),
  run: jest.fn(async () => '答案'),
};

describe('AiPanel', () => {
  it('shows the config gate when not configured', async () => {
    const onOpenSettings = jest.fn();
    const { findByTestId, getByTestId } = renderWithSettings(
      <AiPanel {...base} configured={false} onOpenSettings={onOpenSettings} />,
    );
    fireEvent.press(await findByTestId('ai-open-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(() => getByTestId('ai-ask-input')).toThrow();
  });

  it('shows the consent gate when configured but not consented', async () => {
    const onConsent = jest.fn();
    const { findByTestId } = renderWithSettings(
      <AiPanel {...base} consented={false} onConsent={onConsent} />,
    );
    fireEvent.press(await findByTestId('ai-consent'));
    expect(onConsent).toHaveBeenCalled();
  });

  it('runs an ask and renders the result', async () => {
    const run = jest.fn(async () => '主角是张三');
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} run={run} />);
    fireEvent.changeText(await findByTestId('ai-ask-input'), '主角是谁？');
    fireEvent.press(getByTestId('ai-submit'));
    expect(await findByTestId('ai-result')).toHaveTextContent('主角是张三');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ask', input: '主角是谁？' }));
  });

  it('shows a friendly error when run rejects with an AiError', async () => {
    const run = jest.fn(async () => {
      throw new AiError('insufficient-balance', 'no balance', 402);
    });
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} run={run} />);
    fireEvent.changeText(await findByTestId('ai-ask-input'), 'x');
    fireEvent.press(getByTestId('ai-submit'));
    expect(await findByTestId('ai-error')).toBeTruthy();
  });
});
