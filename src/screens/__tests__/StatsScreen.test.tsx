import { render, waitFor } from '@testing-library/react-native';
import { InMemoryBookRepository, type ReadingSession } from '../../lib/import/repository';
import { InMemorySettingsGateway } from '../../lib/settings/store';
import { SettingsProvider } from '../../settings/SettingsContext';
import { StatsScreen } from '../StatsScreen';

const HOUR = 3_600_000;
const MIN = 60_000;

function renderStats(sessions: ReadingSession[], books: { id: string; title: string }[] = []) {
  const repo = new InMemoryBookRepository();
  for (const b of books) {
    void repo.addBook({
      id: b.id, title: b.title, originalName: `${b.title}.txt`, encoding: 'utf-8',
      sizeBytes: 1, importedAt: 1, coverColor: '#000', strategy: 'regex', normalizedPath: `/p/${b.id}`,
    });
  }
  for (const s of sessions) void repo.addSession(s);
  const onBack = jest.fn();
  const utils = render(
    <SettingsProvider gateway={new InMemorySettingsGateway()}>
      <StatsScreen repo={repo} onBack={onBack} />
    </SettingsProvider>,
  );
  return { ...utils, onBack };
}

function todayAt(h: number): number {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.getTime();
}

describe('StatsScreen', () => {
  it('shows total reading time and the top book', async () => {
    const { findByTestId, getByText } = renderStats(
      [
        { id: 's1', bookId: 'b1', startedAt: todayAt(9), durationMs: 2 * HOUR },
        { id: 's2', bookId: 'b2', startedAt: todayAt(10), durationMs: 30 * MIN },
      ],
      [
        { id: 'b1', title: '凡人修仙传' },
        { id: 'b2', title: '晚明' },
      ],
    );
    // NOTE: with this fixture today/week/avg all coincide with the total
    // (both sessions are "today"), so several nodes render "2.5 小时" —
    // scope the total assertion to the hero card via testID to disambiguate.
    const heroTotal = await findByTestId('stats-hero-total');
    expect(heroTotal).toHaveTextContent('2.5 小时'); // total
    expect(getByText('凡人修仙传')).toBeTruthy(); // top book by time
  });

  it('shows an empty state when there are no sessions', async () => {
    const { findByText } = renderStats([]);
    expect(await findByText(/开始阅读/)).toBeTruthy();
  });

  it('renders on the current theme background', async () => {
    const { findByTestId } = renderStats([
      { id: 's1', bookId: 'b1', startedAt: todayAt(9), durationMs: HOUR },
    ]);
    const root = await findByTestId('stats-screen');
    // dark ("墨隐") is the default theme background (DEFAULT_SETTINGS.themeId === 'dark').
    expect(root).toHaveStyle({ backgroundColor: '#14161b' });
  });
});
