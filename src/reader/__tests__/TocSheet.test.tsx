import { fireEvent, waitFor } from '@testing-library/react-native';

import type { SearchOutcome } from '../../lib/reader/searchBook';
import { renderWithSettings } from '../../test-utils/render';
import { TocSheet } from '../TocSheet';

const chapters = [
  { index: 0, title: '第一章 山边小村' },
  { index: 1, title: '第二章 入门考验' },
  { index: 2, title: '楔子' },
];

function renderToc(overrides: Partial<React.ComponentProps<typeof TocSheet>> = {}) {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  const utils = renderWithSettings(
    <TocSheet
      visible
      chapters={chapters}
      currentIndex={0}
      onSelect={onSelect}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...utils, onSelect, onClose };
}

describe('TocSheet', () => {
  it('lists every chapter', async () => {
    const { findByText, getByText } = renderToc();
    expect(await findByText('第一章 山边小村')).toBeTruthy();
    expect(getByText('第二章 入门考验')).toBeTruthy();
    expect(getByText('楔子')).toBeTruthy();
  });

  it('filters the list by the search query', async () => {
    const { findByPlaceholderText, getByText, queryByText } = renderToc();
    fireEvent.changeText(await findByPlaceholderText('搜索章节'), '入门');
    expect(getByText('第二章 入门考验')).toBeTruthy();
    expect(queryByText('楔子')).toBeNull();
    expect(queryByText('第一章 山边小村')).toBeNull();
  });

  it('shows an empty message when nothing matches', async () => {
    const { findByPlaceholderText, getByText } = renderToc();
    fireEvent.changeText(await findByPlaceholderText('搜索章节'), '不存在的章节');
    expect(getByText('没有匹配的章节')).toBeTruthy();
  });

  it('calls onSelect with the chapter index and closes when a row is tapped', async () => {
    const { findByText, onSelect, onClose } = renderToc();
    fireEvent.press(await findByText('第二章 入门考验'));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from the bottom 关闭 button', async () => {
    const { findByText, onClose } = renderToc();
    fireEvent.press(await findByText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });
});

const CHAPTERS = [
  { index: 0, title: '第一章 起' },
  { index: 1, title: '第二章 战' },
];

describe('TocSheet full-text tab', () => {
  it('switches to 全文 and runs a full-text search that jumps to a result', async () => {
    const outcome: SearchOutcome = {
      results: [{ chapterIndex: 1, chapterTitle: '第二章 战', blockIndex: 1, snippet: '…剑气…' }],
      capped: false,
    };
    const onFullTextSearch = jest.fn(async () => outcome);
    const onSelectResult = jest.fn();
    const onClose = jest.fn();

    const { getByText, getByPlaceholderText, findByTestId } = renderWithSettings(
      <TocSheet
        visible
        chapters={CHAPTERS}
        currentIndex={0}
        onSelect={() => {}}
        onClose={onClose}
        onFullTextSearch={onFullTextSearch}
        onSelectResult={onSelectResult}
      />,
    );

    fireEvent.press(getByText('全文'));
    const input = getByPlaceholderText('搜索全文');
    fireEvent.changeText(input, '剑气');
    fireEvent(input, 'submitEditing');

    const row = await findByTestId('ft-result');
    fireEvent.press(row);
    await waitFor(() => expect(onSelectResult).toHaveBeenCalledWith(1, 1, '剑气'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows no tabs when onFullTextSearch is not provided', () => {
    const { queryByText } = renderWithSettings(
      <TocSheet visible chapters={CHAPTERS} currentIndex={0} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(queryByText('全文')).toBeNull();
  });
});
