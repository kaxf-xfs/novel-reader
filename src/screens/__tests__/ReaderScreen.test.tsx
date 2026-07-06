import { fireEvent, waitFor } from '@testing-library/react-native';

import { InMemoryBookRepository } from '../../lib/import/repository';
import { resolveTheme } from '../../lib/settings/styles';
import { FakeFileGateway, seedReader } from '../../test-utils/fakes';
import { renderWithSettings } from '../../test-utils/render';
import { ReaderScreen } from '../ReaderScreen';

jest.mock('expo-battery', () => ({
  getBatteryLevelAsync: jest.fn(() => Promise.resolve(0.9)),
  addBatteryLevelListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const CHAPTERS = [
  { title: '第一章 开始', body: '内容一。' },
  { title: '第二章 发展', body: '内容二。' },
  { title: '第三章 结局', body: '内容三。' },
];

function setup() {
  const repo = new InMemoryBookRepository();
  const fs = new FakeFileGateway();
  return { repo, fs };
}

function renderReader(repo: InMemoryBookRepository, fs: FakeFileGateway, bookId: string) {
  return renderWithSettings(
    <ReaderScreen repo={repo} fs={fs} bookId={bookId} onBack={() => {}} />,
  );
}

describe('ReaderScreen', () => {
  it('renders the first chapter body and shows the title in the top bar', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b1', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, findAllByText } = renderReader(repo, fs, 'b1');

    expect(await findByText('内容一。')).toBeTruthy();
    // Title appears in both the top bar and the chapter heading.
    expect((await findAllByText('第一章 开始')).length).toBeGreaterThanOrEqual(2);
  });

  it('restores reading position at the saved progress chapter', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b2', chapters: CHAPTERS, progressChapterIndex: 2 });

    const { findAllByText, findByText } = renderReader(repo, fs, 'b2');

    expect((await findAllByText('第三章 结局')).length).toBeGreaterThanOrEqual(1);
    expect(await findByText('加载上一章')).toBeTruthy();
  });

  it('does not show "加载上一章" when starting at the first chapter', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b3', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, queryByText } = renderReader(repo, fs, 'b3');

    await findByText('内容一。');
    expect(queryByText('加载上一章')).toBeNull();
  });

  it('shows the bottom-bar controls and book progress', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b4', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByText } = renderReader(repo, fs, 'b4');

    await findByText('内容一。');
    expect(getByText('目录')).toBeTruthy();
    expect(getByText('上一章')).toBeTruthy();
    expect(getByText('下一章')).toBeTruthy();
    expect(getByText('排版')).toBeTruthy();
    expect(getByText('0%')).toBeTruthy();
  });

  it('renders the system clock and battery in the top bar', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b5', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByText } = renderReader(repo, fs, 'b5');

    expect(await findByText('90%')).toBeTruthy(); // mocked battery
    expect(getByText(/^\d{2}:\d{2}$/)).toBeTruthy(); // clock HH:MM
  });

  it('toggles the chrome bars on a tap (touch start+end without a drag)', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b6', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByTestId, queryByTestId } = renderReader(repo, fs, 'b6');

    await findByText('内容一。');
    const surface = getByTestId('reader-surface');
    const tap = () => {
      fireEvent(surface, 'touchStart', { nativeEvent: { touches: [{ pageX: 50, pageY: 300 }] } });
      fireEvent(surface, 'touchEnd', { nativeEvent: { changedTouches: [{ pageX: 50, pageY: 300 }] } });
    };

    expect(queryByTestId('reader-topbar')).not.toBeNull(); // visible by default
    tap();
    expect(queryByTestId('reader-topbar')).toBeNull(); // hidden
    tap();
    expect(queryByTestId('reader-topbar')).not.toBeNull(); // shown again
  });

  it('does not toggle the chrome when the touch is a drag (scroll)', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b6b', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByTestId, queryByTestId } = renderReader(repo, fs, 'b6b');

    await findByText('内容一。');
    const surface = getByTestId('reader-surface');

    fireEvent(surface, 'touchStart', { nativeEvent: { touches: [{ pageX: 50, pageY: 300 }] } });
    fireEvent(surface, 'touchMove', { nativeEvent: { touches: [{ pageX: 50, pageY: 120 }] } });
    fireEvent(surface, 'touchEnd', { nativeEvent: { changedTouches: [{ pageX: 50, pageY: 120 }] } });

    // A drag must NOT hide the bars.
    expect(queryByTestId('reader-topbar')).not.toBeNull();
  });

  it('opens the typography sheet from the bottom bar', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b7', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, queryByText } = renderReader(repo, fs, 'b7');

    await findByText('内容一。');
    expect(queryByText('主题')).toBeNull();

    fireEvent.press(await findByText('排版'));
    expect(await findByText('主题')).toBeTruthy();
  });

  it('opens the TOC and jumps to a selected chapter', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b8', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByText, queryByPlaceholderText, findAllByText } = renderReader(
      repo,
      fs,
      'b8',
    );

    await findByText('内容一。');
    fireEvent.press(getByText('目录'));

    // TOC is open (search box present); ch3 is not in the initial window, so
    // its title appears only in the TOC list.
    expect(queryByPlaceholderText('搜索章节')).not.toBeNull();
    fireEvent.press(getByText('第三章 结局'));

    // Sheet closes and the reader jumps to chapter 3.
    await waitFor(() => expect(queryByPlaceholderText('搜索章节')).toBeNull());
    expect((await findAllByText('第三章 结局')).length).toBeGreaterThanOrEqual(1);
  });

  it('applies the theme background color to the reader container', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b9', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByTestId } = renderReader(repo, fs, 'b9');

    await findByText('内容一。');
    expect(getByTestId('reader-root')).toHaveStyle({
      backgroundColor: resolveTheme('dark').background,
    });
  });
});
