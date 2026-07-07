import { act, fireEvent, waitFor } from '@testing-library/react-native';

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

function renderReader(
  repo: InMemoryBookRepository,
  fs: FakeFileGateway,
  bookId: string,
  onBack: () => void = () => {},
) {
  return renderWithSettings(
    <ReaderScreen repo={repo} fs={fs} bookId={bookId} onBack={onBack} />,
  );
}

/** Simulate a center tap (touch start+end, no drag) to toggle the bottom bar. */
function tapSurface(surface: Parameters<typeof fireEvent>[0]) {
  fireEvent(surface, 'touchStart', { nativeEvent: { touches: [{ pageX: 50, pageY: 300 }] } });
  fireEvent(surface, 'touchEnd', { nativeEvent: { changedTouches: [{ pageX: 50, pageY: 300 }] } });
}

describe('ReaderScreen', () => {
  it('renders the first chapter body and shows the title in the top bar', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b1', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, findAllByText } = renderReader(repo, fs, 'b1');

    expect(await findByText(/内容一。/)).toBeTruthy();
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

    await findByText(/内容一。/);
    expect(queryByText('加载上一章')).toBeNull();
  });

  it('reveals the bottom-bar controls after a tap', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b4', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByText, queryByText, getByTestId } = renderReader(repo, fs, 'b4');

    await findByText(/内容一。/);
    expect(queryByText('目录')).toBeNull(); // controls hidden (immersive) by default
    tapSurface(getByTestId('reader-surface'));
    expect(getByText('目录')).toBeTruthy();
    expect(getByText('上一章')).toBeTruthy();
    expect(getByText('下一章')).toBeTruthy();
    expect(getByText('排版')).toBeTruthy();
  });

  it('renders the system clock and battery in the top bar', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b5', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByText } = renderReader(repo, fs, 'b5');

    expect(await findByText('90%')).toBeTruthy(); // mocked battery
    expect(getByText(/^\d{2}:\d{2}$/)).toBeTruthy(); // clock HH:MM
    expect(getByText(/\d+\.\d%/)).toBeTruthy(); // book progress, one decimal, next to the title
  });

  it('keeps the slim top bar always visible and toggles the bottom bar on tap', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b6', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByTestId, queryByTestId } = renderReader(repo, fs, 'b6');

    await findByText(/内容一。/);
    const surface = getByTestId('reader-surface');

    // Slim top bar is always present; bottom bar starts hidden.
    expect(queryByTestId('reader-topbar')).not.toBeNull();
    expect(queryByTestId('reader-bottombar')).toBeNull();

    tapSurface(surface);
    expect(queryByTestId('reader-bottombar')).not.toBeNull(); // shown
    expect(queryByTestId('reader-topbar')).not.toBeNull(); // still there
    tapSurface(surface);
    expect(queryByTestId('reader-bottombar')).toBeNull(); // hidden again
  });

  it('does not reveal the bottom bar on a drag (scroll)', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b6b', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByTestId, queryByTestId } = renderReader(repo, fs, 'b6b');

    await findByText(/内容一。/);
    const surface = getByTestId('reader-surface');

    fireEvent(surface, 'touchStart', { nativeEvent: { touches: [{ pageX: 50, pageY: 300 }] } });
    fireEvent(surface, 'touchMove', { nativeEvent: { touches: [{ pageX: 50, pageY: 120 }] } });
    fireEvent(surface, 'touchEnd', { nativeEvent: { changedTouches: [{ pageX: 50, pageY: 120 }] } });

    expect(queryByTestId('reader-bottombar')).toBeNull();
  });

  it('returns to the shelf on a left-edge rightward swipe', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'bsw', chapters: CHAPTERS, progressChapterIndex: 0 });
    const onBack = jest.fn();

    const { findByText, getByTestId } = renderReader(repo, fs, 'bsw', onBack);

    await findByText(/内容一。/);
    const surface = getByTestId('reader-surface');
    fireEvent(surface, 'touchStart', { nativeEvent: { touches: [{ pageX: 10, pageY: 300 }] } });
    fireEvent(surface, 'touchMove', { nativeEvent: { touches: [{ pageX: 90, pageY: 305 }] } });
    fireEvent(surface, 'touchEnd', { nativeEvent: { changedTouches: [{ pageX: 90, pageY: 305 }] } });

    expect(onBack).toHaveBeenCalled();
  });

  it('does not go back on a rightward swipe that starts away from the left edge', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'bsw2', chapters: CHAPTERS, progressChapterIndex: 0 });
    const onBack = jest.fn();

    const { findByText, getByTestId } = renderReader(repo, fs, 'bsw2', onBack);

    await findByText(/内容一。/);
    const surface = getByTestId('reader-surface');
    fireEvent(surface, 'touchStart', { nativeEvent: { touches: [{ pageX: 200, pageY: 300 }] } });
    fireEvent(surface, 'touchMove', { nativeEvent: { touches: [{ pageX: 280, pageY: 305 }] } });
    fireEvent(surface, 'touchEnd', { nativeEvent: { changedTouches: [{ pageX: 280, pageY: 305 }] } });

    expect(onBack).not.toHaveBeenCalled();
  });

  it('opens the typography sheet from the bottom bar', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b7', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, queryByText, getByTestId } = renderReader(repo, fs, 'b7');

    await findByText(/内容一。/);
    expect(queryByText('主题')).toBeNull();

    tapSurface(getByTestId('reader-surface')); // reveal bottom bar
    fireEvent.press(await findByText('排版'));
    expect(await findByText('主题')).toBeTruthy();
  });

  it('opens the TOC and jumps to a selected chapter', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b8', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByText, getByTestId, queryByPlaceholderText, findAllByText } =
      renderReader(repo, fs, 'b8');

    await findByText(/内容一。/);
    tapSurface(getByTestId('reader-surface')); // reveal bottom bar
    fireEvent.press(getByText('目录'));

    // TOC is open (search box present); ch3 is not in the initial window, so
    // its title appears only in the TOC list.
    expect(queryByPlaceholderText('搜索章节')).not.toBeNull();
    fireEvent.press(getByText('第三章 结局'));

    // Sheet closes and the reader jumps to chapter 3.
    await waitFor(() => expect(queryByPlaceholderText('搜索章节')).toBeNull());
    expect((await findAllByText('第三章 结局')).length).toBeGreaterThanOrEqual(1);
  });

  it('saves the in-chapter block index (not always 0) as reading progress', async () => {
    // 纯逻辑保证：顶部 block 的 blockIndex 会被写入 progress.charOffset。
    // 这里用一个已知窗口断言 findBlockArrayIndex 的反向语义在 reader 中被采用。
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'bpos', chapters: CHAPTERS, progressChapterIndex: 1 });
    const saveSpy = jest.spyOn(repo, 'saveProgress');

    const { findByText, UNSAFE_getByType } = renderReader(repo, fs, 'bpos');
    await findByText(/内容二。/);

    // FlatList/VirtualizedList 的 viewability 计算依赖真实原生 onLayout 测得的
    // cell 尺寸，在 jsdom/RNTL 下不会真的跑起来——这一点已用探测确认：无论是
    // 什么都不做、还是手动对 FlatList 或其内部 ScrollView fireEvent.scroll，
    // onViewableItemsChanged 都不会被调用一次（不是「弱触发」，是完全不触发）。
    // 为了仍能对「保存路径引用 topItem.blockIndex 而非恒 0」做真实断言，且不
    // mock/替换 FlatList 或 VirtualizedList 的任何内部逻辑，这里直接拿到
    // ReaderScreen 传给 FlatList 的、真实的 onViewableItemsChanged 闭包本体，
    // 用一条从真实渲染出的 blocks 数据里取出的非 0 blockIndex 项调用它——
    // 等价于「模拟原生上报了这一项当前可见」，之后的保存路径完全是生产代码。
    const { FlatList } = require('react-native');
    const flatList = UNSAFE_getByType(FlatList);
    const topBlock = (flatList.props.data as { chapterIndex: number; blockIndex: number }[]).find(
      (b) => b.chapterIndex === 1 && b.blockIndex === 1,
    );
    expect(topBlock).toBeTruthy();
    act(() => {
      flatList.props.onViewableItemsChanged({
        viewableItems: [{ item: topBlock, key: 'probe', index: 0, isViewable: true }],
        changed: [],
      });
    });

    // 进入第 2 章、模拟其中段落被判定为可见后，会保存进度；chapterIndex 正确、
    // charOffset 是有效段序号（且非恒 0——见 topBlock.blockIndex === 1）。
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const last = saveSpy.mock.calls[saveSpy.mock.calls.length - 1][0];
    expect(last.chapterIndex).toBe(1);
    expect(typeof last.charOffset).toBe('number');
    expect(last.charOffset).toBe(1); // not always 0 — matches the probed blockIndex
  });

  it('does not crash when restoring a saved mid-chapter block position', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'brestore', chapters: CHAPTERS, progressChapterIndex: 2 });
    await repo.saveProgress({ bookId: 'brestore', chapterIndex: 2, charOffset: 1, updatedAt: Date.now() });

    const { findAllByText } = renderReader(repo, fs, 'brestore');
    expect((await findAllByText('第三章 结局')).length).toBeGreaterThanOrEqual(1);
  });

  it('applies the theme background color to the reader container', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b9', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByTestId } = renderReader(repo, fs, 'b9');

    await findByText(/内容一。/);
    expect(getByTestId('reader-root')).toHaveStyle({
      backgroundColor: resolveTheme('dark').background,
    });
  });
});
