import { fireEvent, render } from '@testing-library/react-native';

import type { BookRecord } from '../../lib/import/repository';
import { RenameBookModal } from '../RenameBookModal';

function makeBook(over: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'bk1',
    title: '旧名',
    originalName: '旧名.txt',
    encoding: 'utf-8',
    sizeBytes: 10,
    importedAt: 1,
    coverColor: '#E8D5B7',
    strategy: 'regex',
    normalizedPath: 'file:///bk1.txt',
    ...over,
  };
}

describe('RenameBookModal', () => {
  it('prefills the current title and saves the trimmed value', () => {
    const onSave = jest.fn();
    const { getByPlaceholderText, getByTestId } = render(
      <RenameBookModal visible book={makeBook()} onSave={onSave} onClose={() => {}} />,
    );
    const input = getByPlaceholderText('书名');
    expect(input.props.value).toBe('旧名');
    fireEvent.changeText(input, '  新名  ');
    fireEvent.press(getByTestId('rename-save'));
    expect(onSave).toHaveBeenCalledWith('新名');
  });

  it('does not save a blank or unchanged title', () => {
    const onSave = jest.fn();
    const { getByPlaceholderText, getByTestId } = render(
      <RenameBookModal visible book={makeBook()} onSave={onSave} onClose={() => {}} />,
    );
    const save = getByTestId('rename-save');
    fireEvent.press(save); // unchanged from '旧名'
    fireEvent.changeText(getByPlaceholderText('书名'), '   ');
    fireEvent.press(save); // blank
    expect(onSave).not.toHaveBeenCalled();
  });
});
