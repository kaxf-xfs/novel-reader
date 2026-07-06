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

  it('renders a book cover label, title and read progress', async () => {
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

    const { findByText, getByText } = render(
      <LibraryScreen repo={repo} fs={fs} onOpenBook={() => {}} />,
    );

    expect(await findByText('测试小说')).toBeTruthy(); // title
    expect(getByText('测试')).toBeTruthy(); // generated cover label (first 2 chars)
    expect(getByText('已读 0%')).toBeTruthy();
  });

  it('shows 未读 for a book with no saved progress', async () => {
    const { repo, fs } = makeSetup();
    await seedReader(repo, fs, { title: '没读过', chapters: [{ title: '第一章 A', body: 'a' }] });

    const { findByText } = render(<LibraryScreen repo={repo} fs={fs} onOpenBook={() => {}} />);

    expect(await findByText('未读')).toBeTruthy();
  });

  it('calls onOpenBook with the book id when a cover is tapped', async () => {
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

  it('long-press → confirm removes the book from the shelf', async () => {
    const { repo, fs } = makeSetup();
    await seedReader(repo, fs, { title: '删除我', chapters: [{ title: '第一章 A', body: 'a' }] });

    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });

    const { findByText, queryByText } = render(
      <LibraryScreen repo={repo} fs={fs} onOpenBook={() => {}} />,
    );

    fireEvent(await findByText('删除我'), 'longPress');

    await waitFor(() => expect(queryByText('删除我')).toBeNull());
    expect(await repo.listBooks()).toHaveLength(0);
  });

  it('orders the most-recently-read book first', async () => {
    const { repo, fs } = makeSetup();
    await seedReader(repo, fs, {
      bookId: 'unread',
      title: '新导入未读',
      chapters: [{ title: '第一章 A', body: 'a' }],
      importedAt: 5000,
    });
    await seedReader(repo, fs, {
      bookId: 'read',
      title: '旧书刚读过',
      chapters: [{ title: '第一章 A', body: 'a' }],
      importedAt: 1000,
      lastReadAt: 9_999_999_999_999,
    });

    const { findAllByTestId } = render(
      <LibraryScreen repo={repo} fs={fs} onOpenBook={() => {}} />,
    );

    const titles = await findAllByTestId('book-title');
    expect(titles[0]).toHaveTextContent('旧书刚读过');
    expect(titles[1]).toHaveTextContent('新导入未读');
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

    const { findByText, getByText, findAllByTestId } = render(
      <LibraryScreen repo={repo} fs={fs} onOpenBook={() => {}} />,
    );

    await findByText('书架空空如也');
    fireEvent.press(getByText('导入'));

    // Title '新书' collides with its own 2-char cover label, so assert via testID.
    const titles = await findAllByTestId('book-title');
    expect(titles).toHaveLength(1);
    expect(titles[0]).toHaveTextContent('新书');
    expect(await repo.listBooks()).toHaveLength(1);
  });
});
