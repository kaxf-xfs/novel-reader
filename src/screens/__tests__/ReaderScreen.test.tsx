import { fireEvent, waitFor } from '@testing-library/react-native';

import { InMemoryBookRepository } from '../../lib/import/repository';
import { resolveTheme } from '../../lib/settings/styles';
import { FakeFileGateway, seedReader } from '../../test-utils/fakes';
import { renderWithSettings } from '../../test-utils/render';
import { ReaderScreen } from '../ReaderScreen';

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

describe('ReaderScreen', () => {
  it('renders the first chapter title and body from the seeded book', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b1', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findAllByText, findByText } = renderWithSettings(
      <ReaderScreen repo={repo} fs={fs} bookId="b1" onBack={() => {}} />,
    );

    // Title appears in both the top bar and the chapter heading.
    expect((await findAllByText('第一章 开始')).length).toBeGreaterThanOrEqual(2);
    expect(await findByText('内容一。')).toBeTruthy();
  });

  it('restores reading position at the saved progress chapter', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b2', chapters: CHAPTERS, progressChapterIndex: 2 });

    const { findAllByText, findByText } = renderWithSettings(
      <ReaderScreen repo={repo} fs={fs} bookId="b2" onBack={() => {}} />,
    );

    // Top bar reflects the saved chapter (index 2).
    expect((await findAllByText('第三章 结局')).length).toBeGreaterThanOrEqual(1);
    // Since we're past chapter 0, the "load previous" affordance is shown.
    expect(await findByText('加载上一章')).toBeTruthy();
  });

  it('does not show "加载上一章" when starting at the first chapter', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b3', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, queryByText } = renderWithSettings(
      <ReaderScreen repo={repo} fs={fs} bookId="b3" onBack={() => {}} />,
    );

    await findByText('内容一。'); // wait for initial load
    expect(queryByText('加载上一章')).toBeNull();
  });

  it('opens the typography sheet when the Aa button is pressed', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b4', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, queryByText } = renderWithSettings(
      <ReaderScreen repo={repo} fs={fs} bookId="b4" onBack={() => {}} />,
    );

    await findByText('内容一。');
    expect(queryByText('主题')).toBeNull(); // sheet closed

    fireEvent.press(await findByText('Aa'));

    expect(await findByText('主题')).toBeTruthy(); // sheet open
  });

  it('applies the theme background color to the reader container', async () => {
    const { repo, fs } = setup();
    await seedReader(repo, fs, { bookId: 'b5', chapters: CHAPTERS, progressChapterIndex: 0 });

    const { findByText, getByTestId } = renderWithSettings(
      <ReaderScreen repo={repo} fs={fs} bookId="b5" onBack={() => {}} />,
    );

    await findByText('内容一。');
    // Default theme is 'dark'.
    expect(getByTestId('reader-root')).toHaveStyle({
      backgroundColor: resolveTheme('dark').background,
    });
  });
});
