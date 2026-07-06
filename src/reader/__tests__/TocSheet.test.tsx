import { fireEvent } from '@testing-library/react-native';

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
});
