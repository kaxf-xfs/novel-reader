import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { Buffer } from 'buffer';
import * as DocumentPicker from 'expo-document-picker';

import { InMemoryBookRepository } from '../../lib/import/repository';
import { InMemorySettingsGateway, loadSettings } from '../../lib/settings/store';
import { FakeFileGateway, seedReader } from '../../test-utils/fakes';
import { renderWithSettings } from '../../test-utils/render';
import { LibraryScreen } from '../LibraryScreen';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
const mockedPicker = DocumentPicker as jest.Mocked<typeof DocumentPicker>;

function makeSetup() {
  return { repo: new InMemoryBookRepository(), fs: new FakeFileGateway() };
}
function renderLib(
  repo: InMemoryBookRepository,
  fs: FakeFileGateway,
  onOpenBook: (id: string) => void = () => {},
  gateway = new InMemorySettingsGateway(),
) {
  return renderWithSettings(
    <LibraryScreen repo={repo} fs={fs} onOpenBook={onOpenBook} onOpenStats={jest.fn()} />,
    gateway,
  );
}

describe('LibraryScreen', () => {
  afterEach(() => jest.clearAllMocks());

  it('hero layout: shows the read book as 继续阅读 with progress', async () => {
    const { repo, fs } = makeSetup();
    await seedReader(repo, fs, {
      title: '测试小说',
      chapters: [
        { title: '第一章 开始', body: '一' },
        { title: '第二章 发展', body: '二' },
        { title: '第三章 结局', body: '三' },
      ],
      progressChapterIndex: 0,
    });

    const { findByText, getByText } = renderLib(repo, fs);

    expect(await findByText('继续阅读')).toBeTruthy();
    expect(getByText('测试小说')).toBeTruthy();
    expect(getByText('已读 0%')).toBeTruthy();
  });

  it('does not show 继续阅读 when no book has been read', async () => {
    const { repo, fs } = makeSetup();
    await seedReader(repo, fs, { title: '没读过', chapters: [{ title: '第一章 A', body: 'a' }] });

    const { findByText, queryByText } = renderLib(repo, fs);

    expect(await findByText('没读过')).toBeTruthy();
    expect(queryByText('继续阅读')).toBeNull();
  });

  it('calls onOpenBook when a list row is tapped', async () => {
    const { repo, fs } = makeSetup();
    const book = await seedReader(repo, fs, {
      title: '点开我',
      chapters: [{ title: '第一章 A', body: 'a' }],
    });
    const onOpenBook = jest.fn();

    const { findByText } = renderLib(repo, fs, onOpenBook);

    fireEvent.press(await findByText('点开我'));
    expect(onOpenBook).toHaveBeenCalledWith(book.id);
  });

  it('long-press → confirm removes the book', async () => {
    const { repo, fs } = makeSetup();
    await seedReader(repo, fs, { title: '删除我', chapters: [{ title: '第一章 A', body: 'a' }] });
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });

    const { findByText, queryByText } = renderLib(repo, fs);

    fireEvent(await findByText('删除我'), 'longPress');
    await waitFor(() => expect(queryByText('删除我')).toBeNull());
    expect(await repo.listBooks()).toHaveLength(0);
  });

  it('long-press → 重命名 updates the book title', async () => {
    const { repo, fs } = makeSetup();
    // NOTE: brief used 2-char titles '旧名'/'新名', but buildCover() renders the
    // first 2 chars as the cover label, which collides with a 2-char full title
    // and makes findByText/queryByText ambiguous (two identical Text nodes).
    // Using 3-char titles (cover label = first 2 chars, distinct from the full
    // title) avoids that unrelated collision while keeping the test's intent.
    await seedReader(repo, fs, { title: '旧书名', chapters: [{ title: '第一章 A', body: 'a' }] });
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === '重命名')?.onPress?.();
    });

    const { findByText, getByTestId, getByPlaceholderText, queryByText } = renderLib(repo, fs);

    fireEvent(await findByText('旧书名'), 'longPress');
    fireEvent.changeText(getByPlaceholderText('书名'), '新书名');
    fireEvent.press(getByTestId('rename-save'));

    await waitFor(() => expect(queryByText('新书名')).toBeTruthy());
    const books = await repo.listBooks();
    expect(books[0].title).toBe('新书名');
  });

  it('switching to 卡片 hides the hero and persists the choice', async () => {
    const { repo, fs } = makeSetup();
    const gateway = new InMemorySettingsGateway();
    await seedReader(repo, fs, {
      title: '测试小说',
      chapters: [{ title: '第一章 A', body: 'a' }],
      progressChapterIndex: 0,
    });

    const { findByText, getByText, queryByText } = renderLib(repo, fs, () => {}, gateway);

    expect(await findByText('继续阅读')).toBeTruthy();
    fireEvent.press(getByText('卡片'));

    await waitFor(() => expect(queryByText('继续阅读')).toBeNull());
    expect(getByText('测试小说')).toBeTruthy(); // still shown, as a card
    await waitFor(async () => {
      expect((await loadSettings(gateway)).libraryLayout).toBe('cards');
    });
  });

  it('import flow adds a newly picked book', async () => {
    const { repo, fs } = makeSetup();
    const novel = ['第一章 山边小村', '内容一。', '第二章 入门', '内容二。', '第三章 出师', '内容三。'].join('\n');
    const uri = 'file:///picked.txt';
    fs.registerFile(uri, new Uint8Array(Buffer.from(novel, 'utf8')));
    mockedPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri, name: '新书.txt', size: novel.length, mimeType: 'text/plain' }],
    } as never);

    const { findByText, getByText, findAllByTestId } = renderLib(repo, fs);

    await findByText('书架空空如也');
    fireEvent.press(getByText('导入'));

    const titles = await findAllByTestId('book-title');
    expect(titles).toHaveLength(1);
    expect(titles[0]).toHaveTextContent('新书');
  });
});
