import { fireEvent, waitFor } from '@testing-library/react-native';

import { InMemorySettingsGateway, loadSettings } from '../../lib/settings/store';
import { renderWithSettings } from '../../test-utils/render';
import { ReaderSettingsSheet } from '../ReaderSettingsSheet';

const noop = () => {};

describe('ReaderSettingsSheet', () => {
  it('renders the current font size', async () => {
    const { findByText } = renderWithSettings(<ReaderSettingsSheet visible onClose={noop} />);
    // default fontSize is 18 (await flushes the provider's async load in act)
    expect(await findByText('18')).toBeTruthy();
  });

  it('selecting a font persists the new fontId', async () => {
    const gateway = new InMemorySettingsGateway();
    const { findByText } = renderWithSettings(
      <ReaderSettingsSheet visible onClose={noop} />,
      gateway,
    );

    fireEvent.press(await findByText('仓耳今楷'));

    await waitFor(async () => {
      expect((await loadSettings(gateway)).fontId).toBe('cangEr');
    });
  });

  it('selecting a theme persists the new themeId', async () => {
    const gateway = new InMemorySettingsGateway();
    const { findByText } = renderWithSettings(
      <ReaderSettingsSheet visible onClose={noop} />,
      gateway,
    );

    fireEvent.press(await findByText('纸白'));

    await waitFor(async () => {
      expect((await loadSettings(gateway)).themeId).toBe('paper');
    });
  });

  it('the font-size + stepper increases fontSize and persists it', async () => {
    const gateway = new InMemorySettingsGateway();
    const { findByText, getByText, getAllByText } = renderWithSettings(
      <ReaderSettingsSheet visible onClose={noop} />,
      gateway,
    );

    await findByText('字号'); // flush mount effect
    // Steppers are ordered 字号 / 行距 / 段距 / 边距 — index 0 is font size.
    fireEvent.press(getAllByText('＋')[0]);

    expect(getByText('19')).toBeTruthy();
    await waitFor(async () => {
      expect((await loadSettings(gateway)).fontSize).toBe(19);
    });
  });
});
