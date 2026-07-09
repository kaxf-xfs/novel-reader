import { InMemoryBookRepository, type SummaryRecord } from '../repository';

function rec(over: Partial<SummaryRecord> = {}): SummaryRecord {
  return { bookId: 'b1', level: 0, idx: 0, model: 'deepseek-chat', promptVersion: 'v1', summary: 's', createdAt: 1, ...over };
}
function seedBook(repo: InMemoryBookRepository, id: string) {
  return repo.addBook({
    id, title: id, originalName: `${id}.txt`, encoding: 'utf-8', sizeBytes: 1,
    importedAt: 1, coverColor: '#000', strategy: 'regex', normalizedPath: `/p/${id}`,
  });
}

describe('InMemoryBookRepository ai summaries', () => {
  it('puts and gets a summary by (bookId, level, idx)', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putSummary(rec({ idx: 3, summary: 'chapter 3' }));
    expect(await repo.getSummary('b1', 0, 3)).toMatchObject({ idx: 3, summary: 'chapter 3' });
    expect(await repo.getSummary('b1', 0, 4)).toBeNull();
  });

  it('putSummary upserts on the same key', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putSummary(rec({ idx: 1, summary: 'old' }));
    await repo.putSummary(rec({ idx: 1, summary: 'new', model: 'other' }));
    const got = await repo.getSummary('b1', 0, 1);
    expect(got?.summary).toBe('new');
    expect(got?.model).toBe('other');
  });

  it('lists level-0 summaries up to uptoIdx in ascending order', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putSummary(rec({ idx: 2 }));
    await repo.putSummary(rec({ idx: 0 }));
    await repo.putSummary(rec({ idx: 5 }));
    await repo.putSummary(rec({ level: 1, idx: 0 })); // arc, excluded by level filter
    const list = await repo.listSummaries('b1', 0, 2);
    expect(list.map((s) => s.idx)).toEqual([0, 2]);
  });

  it('cascades summary deletion when the book is deleted', async () => {
    const repo = new InMemoryBookRepository();
    await seedBook(repo, 'b1');
    await repo.putSummary(rec({ bookId: 'b1', idx: 0 }));
    await repo.putSummary(rec({ bookId: 'b2', idx: 0 }));
    await repo.deleteBook('b1');
    expect(await repo.getSummary('b1', 0, 0)).toBeNull();
    expect(await repo.getSummary('b2', 0, 0)).not.toBeNull();
  });
});
