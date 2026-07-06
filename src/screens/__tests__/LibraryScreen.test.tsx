import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Buffer } from 'buffer';
import * as DocumentPicker from 'expo-document-picker';

import { InMemoryBookRepository } from '../../lib/import/repository';
import { FakeFileGateway, seedReader } from '../../test-utils/fakes';
import { LibraryScreen } from '../LibraryScreen';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const mockedPicker = DocumentPicker as jest.Mocked<typeof DocumentPicker>;

function makeSetup() {
  const repo = new InMemoryBookRepository();
  const fs = new FakeFileGateway();
  return { repo, fs };
}

describe('LibraryScreen', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders an imported book with chapter count, strategy and progress', async () => {
    const { repo, fs } = makeSetup();
    await seedReader(repo, fs, {
      title: '测试小说',
      chapters: [
        { title: '第一章 开始', body: '内容一' },
        { title: '第二章 发展', body: '内容二' },
        { title: '第三章 结局', body: '内容三' },
      ],
      progressChapterIndex: 0,
    });

    const { findByText } = render(
      <LibraryScreen repo={repo} fs={fs} onOpenBook={() => {}} />,
    );

    expect(await findByText('测试小说')).toBeTruthy();
    expect(await findByText('3 章 · regex · 0%')).toBeTruthy();
  });

  it('calls onOpenBook with the book id when a row is tapped', async () => {
    const { repo, fs } = makeSetup();
    const book = await seedReader(repo, fs, {
      title: '点开我',
      chapters: [{ title: '第一章 A', body: 'a' }],
    });

    const onOpenBook = jest.fn();
    const { findByText } = render(
      <LibraryScreen repo={repo} fs={fs} onOpenBook={onOpenBook} />,
    );

    fireEvent.press(await findByText('点开我'));
    expect(onOpenBook).toHaveBeenCalledWith(book.id);
  });

  it('long-press → confirm removes the book from the list', async () => {
    const { repo, fs } = makeSetup();
    await seedReader(repo, fs, {
      title: '删除我',
      chapters: [{ title: '第一章 A', body: 'a' }],
    });

    // Auto-confirm the destructive alert button.
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const del = buttons?.find((b) => b.style === 'destructive');
      del?.onPress?.();
    });

    const { findByText, queryByText } = render(
      <LibraryScreen repo={repo} fs={fs} onOpenBook={() => {}} />,
    );

    fireEvent(await findByText('删除我'), 'longPress');

    await waitFor(() => expect(queryByText('删除我')).toBeNull());
    expect(await repo.listBooks()).toHaveLength(0);
  });

  it('import flow adds a newly picked book to the shelf', async () => {
    const { repo, fs } = makeSetup();

    const novel = ['第一章 山边小村', '内容一。', '第二章 入门', '内容二。', '第三章 出师', '内容三。'].join('\n');
    const uri = 'file:///picked.txt';
    fs.registerFile(uri, new Uint8Array(Buffer.from(novel, 'utf8')));

    mockedPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri, name: '新书.txt', size: novel.length, mimeType: 'text/plain' }],
    } as never);

    const { findByText, getByText } = render(
      <LibraryScreen repo={repo} fs={fs} onOpenBook={() => {}} />,
    );

    // Empty shelf initially.
    await findByText('书架空空如也');

    fireEvent.press(getByText('导入'));

    expect(await findByText('新书')).toBeTruthy();
    expect(await repo.listBooks()).toHaveLength(1);
  });
});
