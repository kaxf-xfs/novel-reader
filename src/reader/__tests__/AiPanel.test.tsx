import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithSettings } from '../../test-utils/render';
import { SettingsProvider } from '../../settings/SettingsContext';
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

  it('exposes a settings entry in the header even once configured', async () => {
    const onOpenSettings = jest.fn();
    const { findByTestId } = renderWithSettings(
      <AiPanel {...base} onOpenSettings={onOpenSettings} />,
    );
    fireEvent.press(await findByTestId('ai-open-settings-top'));
    expect(onOpenSettings).toHaveBeenCalled();
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

  it('runs recap mode with no input via the generate button', async () => {
    const run = jest.fn(async () => '前情提要…');
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} run={run} />);
    fireEvent.press(await findByTestId('ai-tab-recap'));
    fireEvent.press(getByTestId('ai-generate'));
    expect(await findByTestId('ai-result')).toHaveTextContent('前情提要', { exact: false });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'recap' }));
  });

  it('runs character mode with a name', async () => {
    const run = jest.fn(async () => '张三是…');
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} run={run} />);
    fireEvent.press(await findByTestId('ai-tab-character'));
    fireEvent.changeText(getByTestId('ai-ask-input'), '张三');
    fireEvent.press(getByTestId('ai-submit'));
    expect(await findByTestId('ai-result')).toHaveTextContent('张三是', { exact: false });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'character', input: '张三' }));
  });

  it('renders errors in a dedicated red, not the theme accent', async () => {
    const run = jest.fn(async () => {
      throw new AiError('network', 'offline');
    });
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} run={run} />);
    fireEvent.changeText(await findByTestId('ai-ask-input'), 'x');
    fireEvent.press(getByTestId('ai-submit'));
    expect(await findByTestId('ai-error')).toHaveStyle({ color: '#d9534f' });
  });

  it('clears the input when switching tabs', async () => {
    const { findByTestId, getByTestId } = renderWithSettings(<AiPanel {...base} />);
    fireEvent.changeText(await findByTestId('ai-ask-input'), '张三');
    fireEvent.press(getByTestId('ai-tab-character'));
    expect(getByTestId('ai-ask-input').props.value).toBe('');
  });

  it('resets a stale result + input when the panel is closed and reopened', async () => {
    const run = jest.fn(async () => '旧结果');
    const { findByTestId, getByTestId, queryByTestId, gateway, rerender } = renderWithSettings(
      <AiPanel {...base} run={run} />,
    );
    fireEvent.changeText(await findByTestId('ai-ask-input'), '问题');
    fireEvent.press(getByTestId('ai-submit'));
    await findByTestId('ai-result');

    // close then reopen — should not show the previous result or keep the input
    rerender(
      <SettingsProvider gateway={gateway}>
        <AiPanel {...base} visible={false} run={run} />
      </SettingsProvider>,
    );
    rerender(
      <SettingsProvider gateway={gateway}>
        <AiPanel {...base} visible run={run} />
      </SettingsProvider>,
    );
    expect(queryByTestId('ai-result')).toBeNull();
    expect(getByTestId('ai-ask-input').props.value).toBe('');
  });
});
