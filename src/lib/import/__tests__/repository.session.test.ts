import { InMemoryBookRepository, type ReadingSession } from '../repository';

function session(over: Partial<ReadingSession> = {}): ReadingSession {
  return { id: 's1', bookId: 'b1', startedAt: 1000, durationMs: 60000, ...over };
}

describe('InMemoryBookRepository reading sessions', () => {
  it('adds and lists sessions', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addSession(session({ id: 's1', durationMs: 60000 }));
    await repo.addSession(session({ id: 's2', durationMs: 30000 }));
    const all = await repo.listSessions();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('cascades session deletion when the book is deleted', async () => {
    const repo = new InMemoryBookRepository();
    await repo.addBook({
      id: 'b1', title: 'T', originalName: 'T.txt', encoding: 'utf-8', sizeBytes: 1,
      importedAt: 1, coverColor: '#000', strategy: 'regex', normalizedPath: '/p',
    });
    await repo.addSession(session({ id: 's1', bookId: 'b1' }));
    await repo.addSession(session({ id: 's2', bookId: 'b2' }));
    await repo.deleteBook('b1');
    const all = await repo.listSessions();
    expect(all.map((s) => s.id)).toEqual(['s2']);
  });
});
