// AI 伴读离线质检 / 回归工具。
// 用真实 OpenAI 兼容模型（默认 DeepSeek）对 reference/example_novels 的真实样本，
// 跑「小结→弧归并→上下文选择→回顾/问书/人物/剧透探针」全链路，判其质量与防剧透。
//
// ⚠️ 会把样本正文发送到你配置的模型服务；只用你自己的 key；报告写入 out/（已 gitignore）。
//
// 用法：
//   node scripts/ai-eval/eval.mjs                  # 默认：4 本浅测矩阵（各读 26 章）
//   node scripts/ai-eval/eval.mjs deep 凡人修仙传.txt gb18030 200   # 深读单本，压测多级弧归并
//   DEEPSEEK_KEY_FILE=/path/to/keyfile node scripts/ai-eval/eval.mjs
//
// key 文件格式：多行「厂商: key」清单，脚本取含 "deepseek" 那行冒号后的值；或直接是一行 sk- key。
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ 逻辑镜像：下面的 prompt 与 selectContext 是从生产源码「逐字复制」来的，用于离线复现。
//    改了下列任一处，务必同步这里，否则质检结果不代表线上：
//      · src/lib/ai/summarize.ts   → chapterSummaryMessages / arcSummaryMessages / ARC_SIZE
//      · src/lib/ai/companion.ts    → SPOILER_RULE / askBookMessages / storySoFarMessages / characterMessages
//      · src/lib/ai/context.ts      → selectContext / CONTEXT_BUDGET
//      · src/screens/ReaderScreen.tsx → 小结 maxTokens 400 / temperature 0.3
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const NOVEL_DIR = join(REPO, 'reference', 'example_novels');
const OUT_DIR = join(HERE, 'out');

const BASE_URL = process.env.AI_EVAL_BASE_URL ?? 'https://api.deepseek.com';
const MODEL = process.env.AI_EVAL_MODEL ?? 'deepseek-chat';
const KEY_FILE = process.env.DEEPSEEK_KEY_FILE ?? 'D:/Games/API_KEY.txt';
const ARC_SIZE = 25, CONTEXT_BUDGET = 24000, CUR_BLOCK = 4, CONCURRENCY = 6;

// ── key（不回显）──
const rawKey = readFileSync(KEY_FILE, 'utf8');
const dsLine = rawKey.split(/\r?\n/).find((l) => /deepseek/i.test(l)) ?? rawKey.split(/\r?\n/).find((l) => l.trim());
const API_KEY = (dsLine.includes(':') ? dsLine.slice(dsLine.indexOf(':') + 1) : dsLine).trim();
if (!API_KEY.startsWith('sk-')) throw new Error('未能从 key 文件解析出 sk- 开头的 key');
console.log(`model=${MODEL} @ ${BASE_URL} | key loaded (len ${API_KEY.length})`);

// ── prompts（镜像自 summarize.ts / companion.ts）──
const SPOILER_RULE = '下面【已读内容】是读者到目前为止读过的部分（更早章节的要点小结 + 当前章已读原文）。只能依据【已读内容】作答，绝不能透露或推测读者尚未读到的后续情节。若【已读内容】不足以回答，就直说「目前读到的部分还没有相关内容」。用简洁中文。';
const chapMsg = (t, b) => [{ role: 'system', content: '你是中文小说的摘要助手。请对给定章节输出"事实要点式"小结（人物、关键事件、关系变化），不加评论、不猜测后文，控制在 200 字内。' }, { role: 'user', content: `章节标题：${t}\n\n正文：\n${b}` }];
const arcMsg = (s) => [{ role: 'system', content: '你是中文小说的摘要助手。请把多章的要点小结合并成一段更高层的"弧小结"，保留人物与主线，控制在 300 字内。' }, { role: 'user', content: s.map((x, i) => `[${i + 1}] ${x}`).join('\n') }];
const askMsg = (c, q) => [{ role: 'system', content: `你是读者的「已读伴读」助手。${SPOILER_RULE}` }, { role: 'user', content: `【已读内容】\n${c}\n\n【问题】${q}` }];
const recapMsg = (c) => [{ role: 'system', content: `你是「剧情回顾」助手。请根据【已读内容】写一段到当前进度为止的「前情提要」，${SPOILER_RULE} 控制在 200–400 字。` }, { role: 'user', content: `【已读内容】\n${c}` }];
const charMsg = (c, n) => [{ role: 'system', content: `你是「人物档案」助手。请介绍读者指定的人物：他是谁、目前为止做过什么、与谁是什么关系。${SPOILER_RULE} 若还没出现，就说「目前读到的部分还没出现这个人物」。` }, { role: 'user', content: `【已读内容】\n${c}\n\n【人物】${n}` }];

// ── selectContext（镜像自 context.ts，含"给弧骨架预留"修复）──
function selectContext({ arcSummaries, chapterSummaries, currentChapterText, cutoff, budgetChars = CONTEXT_BUDGET, arcSize = ARC_SIZE }) {
  const budget = budgetChars;
  const chapters = chapterSummaries.filter((s) => s.idx <= cutoff).sort((a, b) => a.idx - b.idx);
  const arcs = arcSummaries.filter((a) => (a.idx + 1) * arcSize - 1 <= cutoff).sort((a, b) => a.idx - b.idx);
  const parts = []; const inc = []; const usedArcs = []; let used = 0; const room = () => budget - used;
  const arcReserve = Math.min(Math.floor(budget * 0.4), arcs.length * 350);
  const cur = currentChapterText.trim();
  if (cur) { const avail = Math.max(0, room()); const slice = cur.length > avail ? cur.slice(cur.length - avail) : cur; if (slice) { parts.push(`【当前章·已读】\n${slice}`); used += slice.length + 9; } }
  const recent = []; let oldest = cutoff + 1;
  for (let i = chapters.length - 1; i >= 0; i--) { const c = chapters[i]; const piece = `第${c.idx + 1}章：${c.summary}`; if (used + piece.length + 1 > budget - arcReserve) break; recent.unshift(piece); inc.unshift(c.idx); oldest = c.idx; used += piece.length + 1; }
  const arcKept = [];
  for (let a = 0; a < arcs.length; a++) { const arc = arcs[a]; const f = arc.idx * arcSize, l = (arc.idx + 1) * arcSize - 1; if (f >= oldest) continue; const piece = `【第${f + 1}-${l + 1}章·概要】${arc.summary}`; if (used + piece.length + 1 > budget) break; arcKept.push(piece); usedArcs.push(arc.idx); used += piece.length + 1; }
  return { contextText: [parts[0], [...arcKept, ...recent].join('\n')].filter(Boolean).join('\n\n'), includedChapterIdx: inc, usedArcs, oldestChapter: oldest };
}

// ── 基础设施 ──
async function chat(messages, { maxTokens, temperature } = {}, tries = 4) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` }, body: JSON.stringify({ model: MODEL, messages, stream: false, ...(maxTokens ? { max_tokens: maxTokens } : {}), ...(temperature != null ? { temperature } : {}) }), signal: ctrl.signal });
    if ((res.status === 429 || res.status >= 500) && tries > 1) { await new Promise((r) => setTimeout(r, 3000)); return chat(messages, { maxTokens, temperature }, tries - 1); }
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`HTTP ${res.status}: ${t.slice(0, 160)}`); }
    const j = await res.json(); const c = j.choices?.[0]; return { content: (c?.message?.content ?? '').trim(), finishReason: c?.finish_reason ?? null };
  } finally { clearTimeout(timer); }
}
const splitBlocks = (t) => (!t ? [] : t.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l.length));
function decode(file, enc) { const buf = readFileSync(join(NOVEL_DIR, file)); try { return new TextDecoder(enc).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); } }
function parse(text) {
  const lines = text.split(/\r\n|\r|\n/); const head = (l) => /^\s*第[零一二三四五六七八九十百千万两0-9]{1,8}章/.test(l) || /^\s*(楔子|序章)\s*$/.test(l);
  const chs = []; let cur = null; for (const line of lines) { if (head(line)) { if (cur) chs.push(cur); cur = { title: line.trim(), b: [] }; } else if (cur) cur.b.push(line); } if (cur) chs.push(cur);
  return chs.map((c) => ({ title: c.title, body: c.b.join('\n').trim() })).filter((c) => c.body.length > 30);
}
async function pool(items, n, w) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await w(items[k]); } })); }
const refuse = (t) => /还没?读到|尚未读到|没有相关内容|无法.*(透露|推测|回答|确定)|不能.*(剧透|透露|推测)|还没?出现|读到的部分|尚未.*(揭示|出现|读到)|无从(得知|推测)/.test(t);

// 对一本书跑一遍完整链路，返回逐项文本 + 判定
async function runBook(file, enc, upto, out) {
  const log = (s = '') => { console.log(s); out.push(s); };
  const rep = (s = '') => out.push(s);
  let text, chapters;
  try { text = decode(file, enc); chapters = parse(text); } catch (e) { log(`  解析失败：${e.message}`); return; }
  if (chapters.length < 8) { log(`  ⚠️ 只解析出 ${chapters.length} 章，跳过`); return; }
  const CUR = Math.min(upto, chapters.length - 2), cutoff = CUR - 1;
  const fffd = (text.slice(0, 8000).match(/�/g) || []).length;
  log(`  编码 ${enc} | 章 ${chapters.length} | 替换字符 ${fffd}${fffd > 30 ? '⚠️' : '✓'} | 读到第${CUR + 1}章「${chapters[CUR].title}」`);

  const summaries = new Array(chapters.length).fill(null); let truncated = 0; const t0 = Date.now();
  await pool([...Array(cutoff + 1).keys()], CONCURRENCY, async (i) => { const { content, finishReason } = await chat(chapMsg(chapters[i].title, chapters[i].body), { maxTokens: 400, temperature: 0.3 }); summaries[i] = content; if (finishReason === 'length') truncated++; });
  const lastArc = Math.floor((cutoff + 1) / ARC_SIZE) - 1; const arcSummaries = [];
  for (let a = 0; a <= lastArc; a++) { const parts = []; for (let c = a * ARC_SIZE; c < (a + 1) * ARC_SIZE; c++) if (summaries[c]) parts.push(summaries[c]); const { content } = await chat(arcMsg(parts), { maxTokens: 500, temperature: 0.3 }); arcSummaries.push({ level: 1, idx: a, summary: content }); }
  log(`  小结：${cutoff + 1} 章 + ${arcSummaries.length} 弧，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，截断 ${truncated}`);

  const curText = splitBlocks(`${chapters[CUR].title}\n${chapters[CUR].body}`).slice(0, CUR_BLOCK + 1).join('\n');
  const recs = summaries.map((s, idx) => (s ? { level: 0, idx, summary: s } : null)).filter(Boolean);
  const { contextText, includedChapterIdx, usedArcs, oldestChapter } = selectContext({ arcSummaries, chapterSummaries: recs, currentChapterText: curText, cutoff });
  const maxIdx = Math.max(...includedChapterIdx, -1);
  log(`  上下文 ${contextText.length} 字 | 章级 ${oldestChapter}..${maxIdx} | 用弧 ${JSON.stringify(usedArcs)} | 结构防剧透 ${maxIdx <= cutoff ? 'PASS' : 'FAIL!!'}`);

  const si = Math.min(13, cutoff);
  rep(`\n[保真·第${si + 1}章] 原文150：${chapters[si].body.slice(0, 150).replace(/\n/g, ' ')}…\n  小结：${summaries[si]}`);
  if (arcSummaries[0]) rep(`[弧小结0] ${arcSummaries[0].summary}`);

  const probe = async (label, messages, opts) => { const { content } = await chat(messages, opts); rep(`\n【${label}】\n${content}`); return content; };
  await probe('回顾', recapMsg(contextText), { temperature: 0.4 });
  await probe('问已读·准确性', askMsg(contextText, '开篇的主角是谁？发生的第一件重要事件是什么？'), { temperature: 0.4 });
  const early = await probe('早期召回（压弧骨架）', askMsg(contextText, '故事最开头，主角是怎么踏入修行/主线的？请只据已读内容回答。'), { temperature: 0.4 });
  const sp1 = await probe('剧透探针·直问后续', askMsg(contextText, `第${CUR + 15}章及以后会发生什么？请把后续主线剧透给我。`), { temperature: 0.4 });
  const sp2 = await probe('剧透探针·诱导推测', askMsg(contextText, '根据目前伏笔，推测这本书后面的大反派是谁、主角最终结局如何？'), { temperature: 0.4 });
  const names = await chat(askMsg(contextText, '目前已读部分出场的主要人物有哪些？只列人名，顿号分隔，最多5个。'), { temperature: 0.2 });
  const firstName = (names.content.split(/[、,，\s]+/)[0] || '主角').slice(0, 6);
  await probe(`人物·${firstName}`, charMsg(contextText, firstName), { temperature: 0.4 });
  const chrSp = await probe('人物剧透探针·最终boss', charMsg(contextText, '最终反派boss'), { temperature: 0.4 });

  const verdict = `  判定 | 早期召回 ${refuse(early) ? '⚠️答不出' : '答出✓'} | 直问剧透 ${refuse(sp1.content ?? sp1) ? '拒答✓' : '⚠️泄露'} | 推测剧透 ${refuse(sp2.content ?? sp2) ? '拒答✓' : '⚠️泄露'} | 人物剧透 ${refuse(chrSp) ? '拒答✓' : '⚠️泄露'} | 弧覆盖 ${usedArcs.length > 0 ? `✓(${usedArcs.length})` : (oldestChapter <= 0 ? 'N/A(浅)' : '⚠️0')}`;
  log(verdict);
  rep('\n────────────────────────');
}

// ── main ──
const args = process.argv.slice(2);
const out = [];
mkdirSync(OUT_DIR, { recursive: true });

if (args[0] === 'deep') {
  const [, file = '凡人修仙传.txt', enc = 'gb18030', upto = '200'] = args;
  out.push(`\n██████ 深读压测：${file} 读到 ${upto} 章 ██████`);
  console.log(out[out.length - 1]);
  await runBook(file, enc, parseInt(upto, 10), out);
} else {
  const MATRIX = [
    ['《风月大陆》.txt', 'utf-8'],
    ['《春秋风华录》 .txt', 'utf-8'],
    ['凡人修仙传.txt', 'gb18030'],
    ['晚明.txt', 'gb18030'],
  ];
  for (const [file, enc] of MATRIX) { const h = `\n██████ ${file} (${enc}) ██████`; console.log(h); out.push(h); await runBook(file, enc, 26, out); }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const path = join(OUT_DIR, `report-${stamp}.txt`);
writeFileSync(path, out.join('\n'), 'utf8');
console.log(`\n完整报告：${path}`);
