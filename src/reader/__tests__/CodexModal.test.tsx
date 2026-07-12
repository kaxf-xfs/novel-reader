import { fireEvent } from '@testing-library/react-native';
import { renderWithSettings } from '../../test-utils/render';
import { EMPTY_CODEX, type Codex } from '../../lib/ai/codex';
import { CodexModal } from '../CodexModal';

const base = {
  visible: true,
  onClose: jest.fn(),
  configured: true,
  consented: true,
  onOpenSettings: jest.fn(),
  onConsent: jest.fn(),
  codex: EMPTY_CODEX,
  complete: true,
  versionMismatch: false,
  currentChapterNumber: 10,
  busy: false,
  progress: null,
  error: null,
  onComplete: jest.fn(),
  onRebuild: jest.fn(),
  onCancel: jest.fn(),
};

function codexWith(over: Partial<Codex>): Codex {
  return { ...EMPTY_CODEX, ...over };
}

describe('CodexModal', () => {
  it('shows the config gate when not configured', async () => {
    const onOpenSettings = jest.fn();
    const { findByTestId } = renderWithSettings(<CodexModal {...base} configured={false} onOpenSettings={onOpenSettings} />);
    fireEvent.press(await findByTestId('codex-open-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('shows the consent gate when configured but not consented', async () => {
    const onConsent = jest.fn();
    const { findByTestId } = renderWithSettings(<CodexModal {...base} consented={false} onConsent={onConsent} />);
    fireEvent.press(await findByTestId('codex-consent'));
    expect(onConsent).toHaveBeenCalled();
  });

  it('opens a character detail in-place (no nested Modal) and can go back to the list', async () => {
    const codex = codexWith({
      characters: [{ name: '张三', aliases: [], identity: [{ text: '少年侠客', idx: 0 }], groups: [], firstChapterIdx: 0 }],
    });
    const { findByTestId, getByTestId, queryByTestId } = renderWithSettings(<CodexModal {...base} codex={codex} />);
    fireEvent.press(await findByTestId('codex-character-张三'));
    expect(await findByTestId('codex-character-detail')).toHaveTextContent('少年侠客', { exact: false });
    expect(queryByTestId('codex-character-list')).toBeNull(); // 同一个 Modal 内切换，不是叠加的新 Modal
    fireEvent.press(getByTestId('codex-character-back'));
    expect(await findByTestId('codex-character-list')).toBeTruthy();
  });

  it('renders the terms tab grouped list', async () => {
    const codex = codexWith({
      terms: [{ name: '青云诀', category: '功法', def: [{ text: '入门吐纳法', idx: 0 }], firstChapterIdx: 0 }],
    });
    const { findByTestId, getByTestId } = renderWithSettings(<CodexModal {...base} codex={codex} />);
    fireEvent.press(await findByTestId('codex-tab-terms'));
    expect(await findByTestId('codex-term-list')).toHaveTextContent('青云诀', { exact: false });
    expect(getByTestId('codex-term-list')).toHaveTextContent('入门吐纳法', { exact: false });
  });

  it('shows the complete-to-progress button when complete=false, and triggers onComplete', async () => {
    const onComplete = jest.fn();
    const { findByTestId } = renderWithSettings(<CodexModal {...base} complete={false} currentChapterNumber={42} onComplete={onComplete} />);
    const btn = await findByTestId('codex-complete');
    expect(btn).toHaveTextContent('第42章', { exact: false });
    fireEvent.press(btn);
    expect(onComplete).toHaveBeenCalled();
  });

  it('shows the rebuild button only on version mismatch, and triggers onRebuild', async () => {
    const onRebuild = jest.fn();
    const { findByTestId, queryByTestId } = renderWithSettings(<CodexModal {...base} versionMismatch onRebuild={onRebuild} />);
    fireEvent.press(await findByTestId('codex-rebuild'));
    expect(onRebuild).toHaveBeenCalled();

    const { queryByTestId: queryNoMismatch } = renderWithSettings(<CodexModal {...base} versionMismatch={false} />);
    expect(queryNoMismatch('codex-rebuild')).toBeNull();
  });

  it('shows busy/progress/cancel, and a dedicated-red error', async () => {
    const onCancel = jest.fn();
    const { findByTestId } = renderWithSettings(
      <CodexModal {...base} busy progress={{ done: 3, total: 10 }} error="AI 请求失败，请重试。" onCancel={onCancel} />,
    );
    expect(await findByTestId('codex-progress')).toHaveTextContent('3/10', { exact: false });
    fireEvent.press(await findByTestId('codex-cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(await findByTestId('codex-error')).toHaveStyle({ color: '#d9534f' });
  });

  it('tapping a node in the graph tab switches to the characters tab with that character selected', async () => {
    const codex = codexWith({
      characters: [
        { name: '甲', aliases: [], identity: [{ text: '主角', idx: 0 }], groups: [], firstChapterIdx: 0 },
        { name: '乙', aliases: [], identity: [], groups: [], firstChapterIdx: 0 },
      ],
      relations: [{ from: '甲', to: '乙', kind: '同门', idx: 0 }],
    });
    const { findByTestId } = renderWithSettings(<CodexModal {...base} codex={codex} />);
    fireEvent.press(await findByTestId('codex-tab-graph'));
    fireEvent.press(await findByTestId('graph-node-甲'));
    expect(await findByTestId('codex-character-detail')).toHaveTextContent('主角', { exact: false });
  });
});
