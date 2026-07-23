/* @jest-environment node */
/**
 * T2: Chapter parsing module tests.
 *
 * Fixture novels live in reference/example_novels (9 books).
 * Tests use real decoded text via decodeToUtf8 from T1.
 *
 * Pre-chapter content (text before the first detected title) is NOT covered
 * by any Chapter object — the first Chapter.startOffset points to the
 * first title line's start. This is intentional per spec.
 */
import path from 'path';
import fs from 'fs';
import { decodeToUtf8 } from '../../encoding/index';
import { parseChapters, looksLikeAdLine } from '../index';
import type { Chapter, ParseResult } from '../index';
import { describeCorpus } from '../../../test-utils/corpus';

const NOVELS_DIR = path.resolve(__dirname, '../../../../reference/example_novels');

function readNovel(filename: string, maxMB = 15): string {
  const bytes = new Uint8Array(fs.readFileSync(path.join(NOVELS_DIR, filename)));
  const sample = bytes.slice(0, maxMB * 1024 * 1024);
  return decodeToUtf8(sample);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkInvariants(result: ParseResult, text: string): void {
  const { chapters } = result;
  if (chapters.length === 0) return;

  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    // level must be 0 or 1
    expect([0, 1]).toContain(c.level);
    // title non-empty
    expect(c.title.length).toBeGreaterThan(0);
    // start < end
    expect(c.startOffset).toBeLessThan(c.endOffset);
    // offsets in range
    expect(c.startOffset).toBeGreaterThanOrEqual(0);
    expect(c.endOffset).toBeLessThanOrEqual(text.length);
    // adjacency
    if (i + 1 < chapters.length) {
      expect(c.endOffset).toBe(chapters[i + 1].startOffset);
    }
  }
  // last chapter ends at text.length
  expect(chapters[chapters.length - 1].endOffset).toBe(text.length);
  // startOffsets strictly increasing
  for (let i = 1; i < chapters.length; i++) {
    expect(chapters[i].startOffset).toBeGreaterThan(chapters[i - 1].startOffset);
  }
}

// ---------------------------------------------------------------------------
// looksLikeAdLine
// ---------------------------------------------------------------------------

describe('looksLikeAdLine', () => {
  describe('positive cases (ad/spam lines)', () => {
    test.each([
      ['本书由TXT下载站整理'],
      ['本书由 某某网 整理上传'],
      ['更多精彩请访问 www.example.com'],
      ['更多章节请登录本站'],
      ['http://www.example.com/novel'],
      ['https://example.com'],
      ['www.novel123.com 欢迎访问'],
      ['最新章节请访问'],
      ['最新章节更新最快'],
      ['txt小说下载站'],
      ['手机阅读请访问'],
      ['手机访问移动版'],
    ])('detects ad line: %s', (line) => {
      expect(looksLikeAdLine(line)).toBe(true);
    });
  });

  describe('negative cases (not ad lines)', () => {
    test.each([
      ['第一章 荒唐梦境'],
      ['第一卷 七玄门风云'],
      ['他走进了房间，看见了窗外的景色。'],
      ['楔子'],
      ['序'],
      ['后记'],
      ['番外：某某的故事'],
      ['第一百章 明月几时有'],
    ])('does not flag normal text: %s', (line) => {
      expect(looksLikeAdLine(line)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Empty / trivial input
// ---------------------------------------------------------------------------

describe('parseChapters empty input', () => {
  it('returns strategy:none for empty string', () => {
    const result = parseChapters('');
    expect(result.strategy).toBe('none');
    expect(result.chapters).toHaveLength(0);
  });

  it('returns strategy:none for whitespace-only string', () => {
    const result = parseChapters('   \n\n\t  ');
    expect(result.strategy).toBe('none');
    expect(result.chapters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fallback-size strategy
// ---------------------------------------------------------------------------

describe('parseChapters fallback-size', () => {
  const singleChapterText =
    '这是一段没有章节标题的文本。\n'.repeat(10) + '故事就这样结束了。';

  it('triggers fallback when chapter count < minChapters', () => {
    const result = parseChapters(singleChapterText);
    expect(result.strategy).toBe('fallback-size');
  });

  it('can override minChapters to prevent fallback', () => {
    // Only 0 chapters detected; if minChapters=0 it should stay regex
    // (edge case: when minChapters=0, even 0 chapters is enough)
    // Since 0 < 1, fallback still triggers with minChapters=1.
    // With minChapters=0 it returns strategy='regex' and chapters=[].
    const result = parseChapters(singleChapterText, { minChapters: 0 });
    expect(result.strategy).toBe('regex');
  });

  it('fallback chapter titles are numbered', () => {
    // Use text long enough to create multiple fallback chunks
    const longText = '这是没有标题的正文内容。\n'.repeat(500);
    const result = parseChapters(longText);
    expect(result.strategy).toBe('fallback-size');
    expect(result.chapters.length).toBeGreaterThan(0);
    expect(result.chapters[0].title).toMatch(/^第\d+节$/);
  });

  it('fallback chapters satisfy structural invariants', () => {
    const longText = '没有标题的内容行\n'.repeat(600);
    const result = parseChapters(longText);
    expect(result.strategy).toBe('fallback-size');
    checkInvariants(result, longText);
  });
});

// ---------------------------------------------------------------------------
// Structural invariants on a controlled text
// ---------------------------------------------------------------------------

describe('parseChapters structural invariants (controlled text)', () => {
  const simpleText = [
    '第一章 开始',
    '一些内容。',
    '',
    '第二章 发展',
    '更多内容。',
    '第三章 结局',
    '最终内容。',
  ].join('\n');

  it('detects 3 chapters in simple text', () => {
    const result = parseChapters(simpleText);
    expect(result.strategy).toBe('regex');
    expect(result.chapters).toHaveLength(3);
  });

  it('chapters have correct titles', () => {
    const result = parseChapters(simpleText);
    expect(result.chapters[0].title).toBe('第一章 开始');
    expect(result.chapters[1].title).toBe('第二章 发展');
    expect(result.chapters[2].title).toBe('第三章 结局');
  });

  it('structural invariants hold', () => {
    const result = parseChapters(simpleText);
    checkInvariants(result, simpleText);
  });

  it('first chapter startOffset points to its title line', () => {
    const result = parseChapters(simpleText);
    const c0 = result.chapters[0];
    expect(simpleText.slice(c0.startOffset, c0.startOffset + 5)).toBe('第一章 开');
  });

  it('chapter content includes title and body', () => {
    const result = parseChapters(simpleText);
    const c0 = result.chapters[0];
    const content = simpleText.slice(c0.startOffset, c0.endOffset);
    expect(content).toContain('第一章 开始');
    expect(content).toContain('一些内容。');
    // Does NOT include next chapter
    expect(content).not.toContain('第二章');
  });
});

// ---------------------------------------------------------------------------
// False-positive rejection
// ---------------------------------------------------------------------------

describe('false-positive rejection', () => {
  it('does not treat 第二年 as a chapter title', () => {
    const text = '第二年，韩立来到了新的地方。\n第一章 正式开始\n内容。\n第二章 继续\n内容。\n第三章 结束\n内容。';
    const result = parseChapters(text);
    const titles = result.chapters.map((c) => c.title);
    expect(titles).not.toContain('第二年，韩立来到了新的地方。');
    expect(titles.some((t) => t.includes('第二年'))).toBe(false);
  });

  it('does not treat 第五层？ as a chapter title', () => {
    const text = '他来到了第五层？那里有什么。\n第一章 开始\n内容。\n第二章 中间\n内容。\n第三章 结尾\n完。';
    const result = parseChapters(text);
    const titles = result.chapters.map((c) => c.title);
    expect(titles.some((t) => t.includes('第五层'))).toBe(false);
  });

  it('does not treat long narrative lines starting with 第X章 as chapters', () => {
    const text =
      '第二天中午时分，当韩立吃完了饭后走进了山谷。\n第一章 正文开始\n内容。\n第二章 继续\n内容。\n第三章 结束\n内容。';
    const result = parseChapters(text);
    const titles = result.chapters.map((c) => c.title);
    // "第二天..." does not match CHAPTER_RE (天 ∉ separator set) → no assertion needed
    // but make sure no super-long title slipped through
    for (const t of titles) {
      expect(t.length).toBeLessThanOrEqual(30);
    }
  });
});

// ---------------------------------------------------------------------------
// Special chapter forms
// ---------------------------------------------------------------------------

describe('special chapter forms', () => {
  it('recognizes 楔子 as level1 chapter', () => {
    const text = '楔子\n引入内容。\n第一章 正文\n内容。\n第二章 续\n内容。';
    const result = parseChapters(text);
    expect(result.chapters.some((c) => c.title === '楔子' && c.level === 1)).toBe(true);
  });

  it('recognizes 序 as level1 chapter', () => {
    const text = '序\n序言内容。\n第一章 正文\n内容。\n第二章 续\n内容。';
    const result = parseChapters(text);
    expect(result.chapters.some((c) => c.title === '序' && c.level === 1)).toBe(true);
  });

  it('recognizes 番外 as level1 chapter', () => {
    const text = '第一章 开始\n内容。\n第二章 中间\n内容。\n番外：某人的故事\n番外内容。';
    const result = parseChapters(text);
    expect(result.chapters.some((c) => c.title.startsWith('番外') && c.level === 1)).toBe(true);
  });

  it('recognizes volumes as level0', () => {
    const text = '第一卷 天地\n第一章 开始\n内容。\n第二章 续\n内容。\n第三章 尾\n尾。';
    const result = parseChapters(text);
    const vol = result.chapters.find((c) => c.level === 0);
    expect(vol).toBeDefined();
    expect(vol!.title).toBe('第一卷 天地');
  });

  it('treats 卷章同行 lines as level1', () => {
    const text =
      '第一集 风云 第一章 开始\n内容。\n第一集 风云 第二章 发展\n内容。\n第一集 风云 第三章 结束\n终。';
    const result = parseChapters(text);
    const allLevel1 = result.chapters.every((c) => c.level === 1);
    expect(allLevel1).toBe(true);
    expect(result.chapters[0].title).toBe('第一集 风云 第一章 开始');
  });
});

// ---------------------------------------------------------------------------
// Level detection
// ---------------------------------------------------------------------------

describe('level detection', () => {
  it('assigns level 0 to 卷/集/部/篇 lines without embedded 章', () => {
    const text = '第一卷 序幕\n第一章 上\n内容1。\n第二章 下\n内容2。\n第三章 尾\n内容3。';
    const result = parseChapters(text);
    const vol = result.chapters.find((c) => c.title === '第一卷 序幕');
    expect(vol?.level).toBe(0);
  });

  it('assigns level 1 to 章/回/节/话 lines', () => {
    const text = '第一章 甲\n内容。\n第二章 乙\n内容。\n第三章 丙\n内容。';
    const result = parseChapters(text);
    result.chapters.forEach((c) => expect(c.level).toBe(1));
  });

  it('assigns level 1 to 第X回 lines', () => {
    const text = '第一回 甲\n内容。\n第二回 乙\n内容。\n第三回 丙\n内容。';
    const result = parseChapters(text);
    result.chapters.forEach((c) => expect(c.level).toBe(1));
  });

  it('recognizes 第X幕 chapters (e.g. 琥珀之剑)', () => {
    const text =
      '第一幕 序章\n内容一。\n第二幕 相遇\n内容二。\n第一百三十九幕 女巫之乱（二）\n内容三。';
    const result = parseChapters(text);
    expect(result.strategy).toBe('regex');
    expect(result.chapters).toHaveLength(3);
    result.chapters.forEach((c) => expect(c.level).toBe(1));
    expect(result.chapters[2].title).toContain('第一百三十九幕');
    expect(result.chapters[2].title).toContain('女巫之乱');
  });
});

// ---------------------------------------------------------------------------
// Traditional Chinese chapter markers (繁体 話/節 vs 简体 话/节)
//
// Real-world regression: 地狱模式 (a scanlation-forum-sourced txt) uses
// traditional "第106話" per-episode markers under a repeated simplified-ish
// "第3章..." arc header. Before this fix, CHAPTER_RE's separator class only
// contained the simplified 话/节, so every "第N話" line was invisible to the
// parser and its content silently merged into the previous detected chapter.
// ---------------------------------------------------------------------------

describe('traditional Chinese chapter markers (繁体 話/節)', () => {
  it('recognizes 第X話 (traditional 話) as a level-1 chapter', () => {
    const text = '第一話 開始\n內容一。\n第二話 繼續\n內容二。\n第三話 結束\n內容三。';
    const result = parseChapters(text);
    expect(result.strategy).toBe('regex');
    expect(result.chapters).toHaveLength(3);
    result.chapters.forEach((c) => expect(c.level).toBe(1));
  });

  it('recognizes 第X節 (traditional 節) as a level-1 chapter', () => {
    const text = '第一節 開始\n內容一。\n第二節 繼續\n內容二。\n第三節 結束\n內容三。';
    const result = parseChapters(text);
    expect(result.strategy).toBe('regex');
    result.chapters.forEach((c) => expect(c.level).toBe(1));
  });

  it('splits a repeated arc-title block into per-episode chapters via 話 markers', () => {
    // Mirrors 地狱模式's actual structure: the same arc header line reprinted
    // before every episode, with the real per-episode boundary marked by a
    // traditional 第N話 line immediately below it.
    const text = [
      '第3章學園都市篇',
      '第106話 考試①',
      '內容一。',
      '第3章學園都市篇',
      '第107話考試②',
      '內容二。',
    ].join('\n');
    const result = parseChapters(text);
    const titles = result.chapters.map((c) => c.title);
    expect(titles).toContain('第106話 考試①');
    expect(titles).toContain('第107話考試②');
  });
});

// ---------------------------------------------------------------------------
// Fixture: 昊天传 (UTF-8, ~687KB)
// ---------------------------------------------------------------------------

describeCorpus('fixture:昊天传', () => {
  let text: string;
  let result: ParseResult;

  beforeAll(() => {
    text = readNovel('《昊天传》.txt');
    result = parseChapters(text);
  });

  it('strategy is regex', () => {
    expect(result.strategy).toBe('regex');
  });

  it('has at least 80 chapters', () => {
    expect(result.chapters.length).toBeGreaterThanOrEqual(80);
  });

  it('all chapters are level 1 (no volumes)', () => {
    expect(result.chapters.every((c) => c.level === 1)).toBe(true);
  });

  it('first chapter title contains 第一章 and 荒唐梦境', () => {
    const first = result.chapters[0];
    expect(first.title).toContain('第一章');
    expect(first.title).toContain('荒唐梦境');
  });

  it('structural invariants hold', () => {
    checkInvariants(result, text);
  });
});

// ---------------------------------------------------------------------------
// Fixture: 春秋风华录 (UTF-8-BOM, indented lines, ~1230KB)
// ---------------------------------------------------------------------------

describeCorpus('fixture:春秋风华录', () => {
  let text: string;
  let result: ParseResult;

  beforeAll(() => {
    text = readNovel('《春秋风华录》 .txt');
    result = parseChapters(text);
  });

  it('strategy is regex', () => {
    expect(result.strategy).toBe('regex');
  });

  it('has at least 200 chapters', () => {
    expect(result.chapters.length).toBeGreaterThanOrEqual(200);
  });

  it('has a chapter containing 北奴宫', () => {
    expect(result.chapters.some((c) => c.title.includes('北奴宫'))).toBe(true);
  });

  it('structural invariants hold', () => {
    checkInvariants(result, text);
  });
});

// ---------------------------------------------------------------------------
// Fixture: 风月大陆 (GB18030, 卷章同行, ~6866KB)
// ---------------------------------------------------------------------------

describeCorpus('fixture:风月大陆', () => {
  let text: string;
  let result: ParseResult;

  beforeAll(() => {
    text = readNovel('《风月大陆》.txt');
    result = parseChapters(text);
  });

  it('strategy is regex', () => {
    expect(result.strategy).toBe('regex');
  });

  it('has at least 300 total chapter entries', () => {
    expect(result.chapters.length).toBeGreaterThanOrEqual(300);
  });

  it('has 卷章同行 level-1 chapters (lines containing both 集 and 章)', () => {
    const combined = result.chapters.filter(
      (c) => c.level === 1 && /第.+集/.test(c.title) && /第.+章/.test(c.title),
    );
    expect(combined.length).toBeGreaterThan(50);
  });

  it('structural invariants hold', () => {
    checkInvariants(result, text);
  });
});

// ---------------------------------------------------------------------------
// Fixture: 凡人修仙传 (GB18030, 14.8MB, 卷+章)
// ---------------------------------------------------------------------------

describeCorpus('fixture:凡人修仙传', () => {
  let text: string;
  let result: ParseResult;

  beforeAll(() => {
    text = readNovel('凡人修仙传.txt');
    result = parseChapters(text);
  }, 30000);

  it('strategy is regex', () => {
    expect(result.strategy).toBe('regex');
  });

  it('has at least 1000 chapters', () => {
    const level1 = result.chapters.filter((c) => c.level === 1);
    expect(level1.length).toBeGreaterThanOrEqual(1000);
  });

  it('has at least 10 volume (level0) entries', () => {
    const vols = result.chapters.filter((c) => c.level === 0);
    expect(vols.length).toBeGreaterThanOrEqual(10);
  });

  it('first volume title is 第一卷 七玄门风云', () => {
    const vols = result.chapters.filter((c) => c.level === 0);
    expect(vols[0].title).toContain('第一卷');
    expect(vols[0].title).toContain('七玄门风云');
  });

  it('has a chapter with title containing 山边小村', () => {
    expect(result.chapters.some((c) => c.title.includes('山边小村'))).toBe(true);
  });

  it('does not contain false-positive 第二年 in titles', () => {
    const hasFalsePositive = result.chapters.some((c) => c.title.includes('第二年'));
    expect(hasFalsePositive).toBe(false);
  });

  it('structural invariants hold', () => {
    checkInvariants(result, text);
  });
});

// ---------------------------------------------------------------------------
// Fixture: 如影逐形 (UTF-8, no chapters → fallback-size)
// ---------------------------------------------------------------------------

describeCorpus('fixture:如影逐形', () => {
  let text: string;
  let result: ParseResult;

  beforeAll(() => {
    text = readNovel('如影逐形.txt');
    result = parseChapters(text);
  });

  it('strategy is fallback-size (no chapter markers detected)', () => {
    expect(result.strategy).toBe('fallback-size');
  });

  it('has multiple fallback chunks', () => {
    expect(result.chapters.length).toBeGreaterThan(10);
  });

  it('fallback chapters have numbered titles', () => {
    expect(result.chapters[0].title).toMatch(/^第\d+节$/);
  });

  it('structural invariants hold', () => {
    checkInvariants(result, text);
  });
});

// ---------------------------------------------------------------------------
// Fixture: 无职转生 (GB18030, chapter titles with ！？, ~3656KB)
// ---------------------------------------------------------------------------

describeCorpus('fixture:无职转生', () => {
  let text: string;
  let result: ParseResult;

  beforeAll(() => {
    text = readNovel('无职转生：剑，魔法帽与恋爱系统.txt');
    result = parseChapters(text);
  });

  it('strategy is regex', () => {
    expect(result.strategy).toBe('regex');
  });

  it('has at least 400 chapters', () => {
    expect(result.chapters.length).toBeGreaterThanOrEqual(400);
  });

  it('structural invariants hold', () => {
    checkInvariants(result, text);
  });
});

// ---------------------------------------------------------------------------
// Fixture: 晚明 (GB18030, 卷+章, 序, ~4578KB)
// ---------------------------------------------------------------------------

describeCorpus('fixture:晚明', () => {
  let text: string;
  let result: ParseResult;

  beforeAll(() => {
    text = readNovel('晚明.txt');
    result = parseChapters(text);
  });

  it('strategy is regex', () => {
    expect(result.strategy).toBe('regex');
  });

  it('has at least 500 chapters', () => {
    const level1 = result.chapters.filter((c) => c.level === 1);
    expect(level1.length).toBeGreaterThanOrEqual(500);
  });

  it('has at least 5 volume (level0) entries', () => {
    const vols = result.chapters.filter((c) => c.level === 0);
    expect(vols.length).toBeGreaterThanOrEqual(5);
  });

  it('has a volume with title containing 第一卷 and 沧海横流', () => {
    const vols = result.chapters.filter((c) => c.level === 0);
    const first = vols.find((c) => c.title.includes('第一卷'));
    expect(first).toBeDefined();
    expect(first!.title).toContain('沧海横流');
  });

  it('has a chapter with title containing 抢衣服的劫犯', () => {
    expect(result.chapters.some((c) => c.title.includes('抢衣服的劫犯'))).toBe(true);
  });

  it('structural invariants hold', () => {
    checkInvariants(result, text);
  });
});

// ---------------------------------------------------------------------------
// Fixture: 魔天记 (GB18030, bare 第一章 titles, ~10206KB)
// ---------------------------------------------------------------------------

describeCorpus('fixture:魔天记', () => {
  let text: string;
  let result: ParseResult;

  beforeAll(() => {
    text = readNovel('魔天记.txt');
    result = parseChapters(text);
  });

  it('strategy is regex', () => {
    expect(result.strategy).toBe('regex');
  });

  it('has at least 1500 chapters/volumes total', () => {
    expect(result.chapters.length).toBeGreaterThanOrEqual(1500);
  });

  it('has bare 第一章 chapter (no subtitle)', () => {
    expect(result.chapters.some((c) => c.title === '第一章')).toBe(true);
  });

  it('has volume titles (level0)', () => {
    const vols = result.chapters.filter((c) => c.level === 0);
    expect(vols.length).toBeGreaterThanOrEqual(5);
  });

  it('structural invariants hold', () => {
    checkInvariants(result, text);
  });
});

// ---------------------------------------------------------------------------
// Fixture: 龙魂侠影 (GB18030, 集+回, NEL line endings, ~10590KB)
// ---------------------------------------------------------------------------

describeCorpus('fixture:龙魂侠影', () => {
  let text: string;
  let result: ParseResult;

  beforeAll(() => {
    text = readNovel('龙魂侠影.txt');
    result = parseChapters(text);
  });

  it('strategy is regex', () => {
    expect(result.strategy).toBe('regex');
  });

  it('has at least 500 total entries (集-volumes + 回-chapters)', () => {
    expect(result.chapters.length).toBeGreaterThanOrEqual(500);
  });

  it('has at least 1 level0 集-volume', () => {
    const vols = result.chapters.filter((c) => c.level === 0);
    expect(vols.length).toBeGreaterThanOrEqual(1);
  });

  it('first level0 volume is 第一集 江湖血路', () => {
    const vols = result.chapters.filter((c) => c.level === 0);
    expect(vols[0].title).toContain('第一集');
    expect(vols[0].title).toContain('江湖血路');
  });

  it('has a 第一回 chapter', () => {
    expect(result.chapters.some((c) => c.title.includes('第一回'))).toBe(true);
  });

  it('structural invariants hold', () => {
    checkInvariants(result, text);
  });
});
