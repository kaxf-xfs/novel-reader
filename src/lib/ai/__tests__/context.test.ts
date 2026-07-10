import type { SummaryRecord } from '../../import/repository';
import { selectContext, CONTEXT_BUDGET } from '../context';

function chap(idx: number, summary = `ch${idx}`): SummaryRecord {
  return { bookId: 'b1', level: 0, idx, model: 'm', promptVersion: 'v1', summary, createdAt: 1 };
}
function arc(idx: number, summary = `arc${idx}`): SummaryRecord {
  return { bookId: 'b1', level: 1, idx, model: 'm', promptVersion: 'v1', summary, createdAt: 1 };
}

describe('selectContext', () => {
  it('includes recent chapter summaries + current chapter text under budget', () => {
    const r = selectContext({
      arcSummaries: [],
      chapterSummaries: [chap(0), chap(1), chap(2)],
      currentChapterText: '当前章已读原文',
      cutoff: 2,
    });
    expect(r.includedChapterIdx).toEqual([0, 1, 2]);
    expect(r.contextText).toContain('当前章已读原文');
    expect(r.contextText).toContain('ch2');
  });

  it('never includes a chapter idx greater than cutoff (spoiler-safe)', () => {
    // caller must pass only <= cutoff, but selectContext must also defend.
    const r = selectContext({
      arcSummaries: [],
      chapterSummaries: [chap(0), chap(1), chap(2), chap(3)],
      currentChapterText: '',
      cutoff: 2,
    });
    expect(Math.max(...r.includedChapterIdx)).toBeLessThanOrEqual(2);
    expect(r.includedChapterIdx).not.toContain(3);
  });

  it('rolls up to arc summaries for early chapters when over budget', () => {
    // 60 fat chapter summaries blow the budget; arcs 0,1 cover the early ones.
    const fat = 'x'.repeat(1000);
    const chapters = Array.from({ length: 60 }, (_, i) => chap(i, fat));
    const arcs = [arc(0), arc(1)];
    const r = selectContext({
      arcSummaries: arcs,
      chapterSummaries: chapters,
      currentChapterText: '',
      cutoff: 59,
      budgetChars: 8000,
    });
    expect(r.contextText.length).toBeLessThanOrEqual(8000 + 200); // within budget (+ small labels)
    expect(r.usedArcs.length).toBeGreaterThan(0);
    // most recent chapters kept as chapter-level detail
    expect(r.includedChapterIdx).toContain(59);
  });

  it('does not leave a hole when the kept window straddles an arc boundary', () => {
    // ARC_SIZE=25, cutoff=59 → complete arcs are 0 (0..24) and 1 (25..49).
    // Budget keeps chapters back to ~idx 40, i.e. the oldest kept chapter lands
    // INSIDE arc 1's range. Arc 1 partially overlaps the kept window; it must still
    // be included so chapters 25..39 are not left blank.
    const fat = 'y'.repeat(100);
    const chapters = Array.from({ length: 60 }, (_, i) => chap(i, fat));
    const arcs = [arc(0), arc(1)]; // covers 0..24, 25..49
    const r = selectContext({
      arcSummaries: arcs,
      chapterSummaries: chapters,
      currentChapterText: '',
      cutoff: 59,
      budgetChars: 2200,
    });
    const oldestKept = Math.min(...r.includedChapterIdx);
    expect(oldestKept).toBeGreaterThan(25); // oldest kept chapter is within arc 1, not before it
    expect(oldestKept).toBeLessThanOrEqual(49);
    // The straddled arc (1) must appear — no hole between arc detail and chapter detail.
    expect(r.usedArcs).toContain(1);
  });

  it('keeps the tail of current chapter text when it exceeds budget', () => {
    const body = 'A'.repeat(100) + 'B'.repeat(100) + 'TAILMARK';
    const r = selectContext({
      arcSummaries: [],
      chapterSummaries: [],
      currentChapterText: body,
      cutoff: 5,
      budgetChars: 30,
    });
    expect(r.contextText).toContain('TAILMARK'); // tail (just-read position) preserved
    expect(r.contextText).not.toContain('AAAAA'); // opening dropped
  });

  it('keeps early-history arc coverage at deep positions (recent chapters must not starve arcs)', () => {
    // 120 read chapters whose summaries alone blow the budget. Without reserving
    // room for arcs, recent chapters fill everything and the earliest chapters end
    // up represented by NOTHING (neither chapter detail nor an arc) — a deep-read
    // content hole. selectContext must still surface the early arcs.
    const body = 'x'.repeat(250);
    const chapters = Array.from({ length: 120 }, (_, i) => chap(i, body));
    const arcs = Array.from({ length: 4 }, (_, i) => arc(i, 'A'.repeat(200))); // arcs 0..3 cover chapters 0..99
    const r = selectContext({
      arcSummaries: arcs,
      chapterSummaries: chapters,
      currentChapterText: '',
      cutoff: 119,
      budgetChars: 12000,
    });
    expect(r.usedArcs.length).toBeGreaterThan(0); // arcs included (was 0 — the bug)
    expect(r.usedArcs).toContain(0); // earliest arc present → early history not lost
    expect(Math.max(...r.includedChapterIdx)).toBe(119); // recent detail still kept
    expect(r.contextText.length).toBeLessThanOrEqual(12000 + 300); // still within budget
  });

  it('exposes a sane default budget', () => {
    expect(CONTEXT_BUDGET).toBeGreaterThan(0);
  });
});
