import { fireEvent, waitFor } from '@testing-library/react-native';

import type { SearchOutcome } from '../../lib/reader/searchBook';
import { renderWithSettings } from '../../test-utils/render';
import { FullTextPanel } from '../FullTextPanel';

const OUTCOME: SearchOutcome = {
  results: [
    { chapterIndex: 1, chapterTitle: '第二章 战', blockIndex: 1, snippet: '…腾起一层剑气，直逼…' },
  ],
  capped: false,
};

describe('FullTextPanel', () => {
  it('runs the search on submit and renders results', async () => {
    const onSearch = jest.fn(async () => OUTCOME);
    const { getByPlaceholderText, findByText } = renderWithSettings(
      <FullTextPanel onSearch={onSearch} onSelectResult={() => {}} />,
    );
    const input = getByPlaceholderText('搜索全文');
    fireEvent.changeText(input, '剑气');
    fireEvent(input, 'submitEditing');
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('剑气'));
    expect(await findByText(/第二章 战/)).toBeTruthy();
  });

  it('invokes onSelectResult with (chapterIndex, blockIndex, term) when a row is tapped', async () => {
    const onSearch = jest.fn(async () => OUTCOME);
    const onSelectResult = jest.fn();
    const { getByPlaceholderText, findByTestId } = renderWithSettings(
      <FullTextPanel onSearch={onSearch} onSelectResult={onSelectResult} />,
    );
    const input = getByPlaceholderText('搜索全文');
    fireEvent.changeText(input, '剑气');
    fireEvent(input, 'submitEditing');
    const row = await findByTestId('ft-result');
    fireEvent.press(row);
    expect(onSelectResult).toHaveBeenCalledWith(1, 1, '剑气');
  });

  it('shows an empty-state message when there are no results', async () => {
    const onSearch = jest.fn(async () => ({ results: [], capped: false }));
    const { getByPlaceholderText, findByText } = renderWithSettings(
      <FullTextPanel onSearch={onSearch} onSelectResult={() => {}} />,
    );
    const input = getByPlaceholderText('搜索全文');
    fireEvent.changeText(input, '不存在');
    fireEvent(input, 'submitEditing');
    expect(await findByText('没有找到')).toBeTruthy();
  });
});
