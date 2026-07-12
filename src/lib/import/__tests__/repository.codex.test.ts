import { InMemoryBookRepository, type CodexRecord } from '../repository';

function rec(over: Partial<CodexRecord> = {}): CodexRecord {
  return {
    bookId: 'b1',
    coveredUptoIdx: 9,
    model: 'deepseek-chat',
    promptVersion: 'v1',
    json: JSON.stringify({ characters: [], terms: [], relations: [] }),
    updatedAt: 1,
    ...over,
  };
}

function seedBook(repo: InMemoryBookRepository, id: string) {
  return repo.addBook({
    id, title: id, originalName: `${id}.txt`, encoding: 'utf-8', sizeBytes: 1,
    importedAt: 1, coverColor: '#000', strategy: 'regex', normalizedPath: `/p/${id}`,
  });
}

describe('InMemoryBookRepository ai_codex', () => {
  it('putCodex + getCodex round-trip', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putCodex(rec());
    expect(await repo.getCodex('b1')).toMatchObject({ bookId: 'b1', coveredUptoIdx: 9 });
  });

  it('getCodex returns null when absent', async () => {
    const repo = new InMemoryBookRepository();
    expect(await repo.getCodex('missing')).toBeNull();
  });

  it('putCodex upserts (one row per book)', async () => {
    const repo = new InMemoryBookRepository();
    await repo.putCodex(rec({ coveredUptoIdx: 9 }));
    await repo.putCodex(rec({ coveredUptoIdx: 20 }));
    const got = await repo.getCodex('b1');
    expect(got?.coveredUptoIdx).toBe(20);
  });

  it('cascades codex deletion when the book is deleted', async () => {
    const repo = new InMemoryBookRepository();
    await seedBook(repo, 'b1');
    await seedBook(repo, 'b2');
    await repo.putCodex(rec({ bookId: 'b1' }));
    await repo.putCodex(rec({ bookId: 'b2' }));
    await repo.deleteBook('b1');
    expect(await repo.getCodex('b1')).toBeNull();
    expect(await repo.getCodex('b2')).not.toBeNull();
  });
});
