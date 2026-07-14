import { fireEvent } from '@testing-library/react-native';
import { renderWithSettings } from '../../test-utils/render';
import { EMPTY_CODEX, type Codex } from '../../lib/ai/codex';
import { CodexModal } from '../CodexModal';

function defaultProps() {
  return base;
}

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
  currentChapterLabel: '第十章',
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
    const { findByTestId } = renderWithSettings(<CodexModal {...base} complete={false} currentChapterLabel="第四十二章 破阵" onComplete={onComplete} />);
    const btn = await findByTestId('codex-complete');
    expect(btn).toHaveTextContent('第四十二章 破阵', { exact: false });
    fireEvent.press(btn);
    expect(onComplete).toHaveBeenCalled();
  });

  it('shows the complete-to-progress button label as-is when the chapter title is not of the form "第N章" (e.g. front matter)', async () => {
    const { findByTestId } = renderWithSettings(<CodexModal {...base} complete={false} currentChapterLabel="楔子" />);
    const btn = await findByTestId('codex-complete');
    expect(btn).toHaveTextContent('楔子', { exact: false });
    expect(btn).not.toHaveTextContent('第楔子章', { exact: false });
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
    // 增量 8.5: RelationRoster（Task 9）取代了旧 RelationshipGraph 的整体网状图，
    // 节点 testID 前缀相应从 graph-node- 变为 roster-node-。
    fireEvent.press(await findByTestId('roster-node-甲'));
    expect(await findByTestId('codex-character-detail')).toHaveTextContent('主角', { exact: false });
  });
});

describe('CodexModal — search and full field display (增量 8.5)', () => {
  it('filters the character list by typing in the search box', () => {
    const codex: Codex = {
      characters: [
        { name: '张三', aliases: [], identity: [], groups: [], firstChapterIdx: 0 },
        { name: '李四', aliases: [], identity: [], groups: [], firstChapterIdx: 0 },
      ],
      terms: [],
      relations: [],
    };
    const { getByTestId, queryByText } = renderWithSettings(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.changeText(getByTestId('codex-character-search'), '张');
    expect(queryByText('张三')).toBeTruthy();
    expect(queryByText('李四')).toBeFalsy();
  });

  it('character detail card shows aliases, groups, and events (previously never rendered)', () => {
    const codex: Codex = {
      characters: [{
        name: '张三',
        aliases: [{ text: '玄天真人', idx: 0 }],
        identity: [{ text: '身份描述', idx: 0 }],
        groups: [{ name: '青云门', idx: 0 }],
        firstChapterIdx: 0,
        events: [{ text: '初入宗门', idx: 0 }],
      }],
      terms: [],
      relations: [],
    };
    const { getByTestId, getByText } = renderWithSettings(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.press(getByTestId('codex-character-张三'));
    expect(getByText('玄天真人')).toBeTruthy();
    expect(getByText('青云门')).toBeTruthy();
    expect(getByText('初入宗门')).toBeTruthy();
  });

  it('character detail prefers bio over raw identity fragments when bio is present', () => {
    const codex: Codex = {
      characters: [{
        name: '张三', aliases: [], groups: [], firstChapterIdx: 0,
        identity: [{ text: '零散身份碎片', idx: 0 }],
        bio: [{ text: '整合后的连贯简介', idx: 0 }],
      }],
      terms: [],
      relations: [],
    };
    const { getByTestId, getByText, queryByText } = renderWithSettings(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.press(getByTestId('codex-character-张三'));
    expect(getByText('整合后的连贯简介')).toBeTruthy();
    expect(queryByText('零散身份碎片')).toBeFalsy();
  });

  it('terms tab groups by category with section headers', () => {
    const codex: Codex = {
      characters: [],
      terms: [
        { name: '青云诀', category: '功法', def: [{ text: 'x', idx: 0 }], firstChapterIdx: 0 },
        { name: '天南国', category: '地理', def: [{ text: 'y', idx: 0 }], firstChapterIdx: 0 },
      ],
      relations: [],
    };
    const { getByTestId, getByText } = renderWithSettings(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.press(getByTestId('codex-tab-terms'));
    expect(getByText('功法')).toBeTruthy();
    expect(getByText('地理')).toBeTruthy();
  });

  it('relation tab renders RelationRoster, not the old spatial graph', () => {
    const codex: Codex = {
      characters: [{ name: '张三', aliases: [], identity: [], groups: [{ name: '青云门', idx: 0 }], firstChapterIdx: 0 }],
      terms: [],
      relations: [],
    };
    const { getByTestId } = renderWithSettings(<CodexModal {...defaultProps()} codex={codex} />);
    fireEvent.press(getByTestId('codex-tab-graph'));
    expect(getByTestId('relation-roster')).toBeTruthy();
  });
});
