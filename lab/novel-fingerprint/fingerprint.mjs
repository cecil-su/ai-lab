#!/usr/bin/env node
// 语言指纹 daemon —— 纯计算、零依赖、确定性。
// 对抗连续生成的早期劣化主因：章末收束趋同 + 高频词堆积（见 docs/notes/2026-06-01-fanren连续生成-劣化测试.md）。
// 它只**标记候选**，不判断好坏（劣化是统计现象，不是意图）。喂回 novel-runtime 的 tick，由人/agent 决定是否重写。
//
// 用法： node fingerprint.mjs <ch1.txt> <ch2.txt> ... [--ends 120] [--ngram 2,3,4] [--min-count 3]
//   最后一个文件视为"最新章"，与前面的窗口对比。

const args = process.argv.slice(2);
const files = [];
const opt = { ends: 120, ngram: [2, 3, 4], minCount: 3, simWarn: 0.45, repeatWarn: 6, names: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ends') opt.ends = +args[++i];
  else if (a === '--ngram') opt.ngram = args[++i].split(',').map(Number);
  else if (a === '--min-count') opt.minCount = +args[++i];
  else if (a === '--names') opt.names = args[++i]; // ⑥ 名词表导出的专名/别名表，逐行
  else files.push(a);
}
if (files.length < 2) {
  console.error('需要至少 2 章。用法: node fingerprint.mjs ch1.txt ch2.txt ...');
  process.exit(1);
}

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// 只保留汉字（去标点/空白/拉丁/数字），重复检测看的是中文用词与句式。
const han = (s) => (s.match(/[一-鿿]/g) || []).join('');
// 功能词/通用词表：避免把"的/了/他/什么/自己"之类当 tic surface。只收通用词，不收书内专名/实词。
const STOP = new Set('的了在他她它我你不没是有这那就也都和与而又却把被让向从对给说想看着过要会能一个什么自己知道起来怎么这个那个还有时候因为所以但是没人'.split(''));
const allStop = (g) => [...g].every((c) => STOP.has(c));

const chapters = files.map((f) => {
  const raw = readFileSync(f, 'utf8');
  return { name: basename(f), text: han(raw), raw };
});
const latest = chapters[chapters.length - 1];
const prev = chapters.slice(0, -1);

// 专名表（来自 ⑥ 一致性表 B）：人名/地名/法宝等重复是预期的，不是劣化，滤掉才看得见真 tic。
const names = [];
if (opt.names) {
  for (const line of readFileSync(opt.names, 'utf8').split('\n')) {
    const w = han(line);
    if (w.length >= 2) names.push(w);
  }
}
// g 与任一专名互为子串 → 当作专名片段滤除。
const isName = (g) => names.some((nm) => nm.includes(g) || g.includes(nm));

// ---- 信号一：跨章重复的多字词/句式 ----
function ngrams(text, n) {
  const m = new Map();
  for (let i = 0; i + n <= text.length; i++) {
    const g = text.slice(i, i + n);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}
// 全窗口每个 n-gram 的总次数 + 出现在多少章（DF）。
const total = new Map(); // gram -> count
const df = new Map(); // gram -> #chapters
for (const ch of chapters) {
  const seen = new Set();
  for (const n of opt.ngram) {
    for (const [g, c] of ngrams(ch.text, n)) {
      if (allStop(g)) continue;
      total.set(g, (total.get(g) || 0) + c);
      if (!seen.has(g)) { df.set(g, (df.get(g) || 0) + 1); seen.add(g); }
    }
  }
}
// 候选：跨 ≥2 章 且 总次数 ≥ minCount，且不是专名片段。
let cands = [...total.keys()].filter((g) => df.get(g) >= 2 && total.get(g) >= opt.minCount && !isName(g));
// 去子串：若长词 L 几乎吃掉短词 S 的出现（count(L) >= 0.8*count(S)），丢掉 S，留有意义的长词。
cands.sort((a, b) => b.length - a.length);
const drop = new Set();
for (const L of cands) {
  if (drop.has(L)) continue;
  for (let n = 2; n < L.length; n++) {
    for (let i = 0; i + n <= L.length; i++) {
      const S = L.slice(i, i + n);
      if (S !== L && total.has(S) && total.get(L) >= 0.8 * total.get(S)) drop.add(S);
    }
  }
}
// 排序按"重复负载"= 次数 ×(长度-1)：长句式 tic 比单个高频词更刺眼。
const load = (g) => total.get(g) * (g.length - 1);
const repeats = cands.filter((g) => !drop.has(g))
  .sort((a, b) => (load(b) - load(a)) || (df.get(b) - df.get(a)))
  .slice(0, 15);

// ---- 信号二：章末收束趋同 ----
// 字面层：(2a) 章末窗口的 bigram 余弦相似度；(2b) 跨章末重复的短语（最直接的"章末口头禅"）。
// 主题层（同母题换词，如"弱肉强食"被改写成"强欺弱"）超出纯计算，交 ⑤ LLM 审计兜底——见 README。
function tail(text, k) { return text.slice(-k); }
function bigrams(s) {
  const m = new Map();
  for (let i = 0; i + 2 <= s.length; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
function cosine(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let dot = 0, na = 0, nb = 0;
  for (const [g, c] of A) { na += c * c; if (B.has(g)) dot += c * B.get(g); }
  for (const c of B.values()) nb += c * c;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const tails = chapters.map((ch) => ({ name: ch.name, t: tail(ch.text, opt.ends) }));
const endPairs = [];
for (let i = 0; i < prev.length; i++) {
  endPairs.push({ a: prev[i].name, b: latest.name, sim: cosine(tail(prev[i].text, opt.ends), tail(latest.text, opt.ends)) });
}
// (2b) 在章末窗口里找跨 ≥2 章重复、非专名非功能词的短语。
const endTotal = new Map(), endDf = new Map();
for (const { t } of tails) {
  const seen = new Set();
  for (const n of opt.ngram) for (const [g] of ngrams(t, n)) {
    if (allStop(g) || isName(g)) continue;
    endTotal.set(g, (endTotal.get(g) || 0) + 1);
    if (!seen.has(g)) { endDf.set(g, (endDf.get(g) || 0) + 1); seen.add(g); }
  }
}
let endCands = [...endTotal.keys()].filter((g) => endDf.get(g) >= 2);
endCands.sort((a, b) => b.length - a.length);
const endDrop = new Set();
for (const L of endCands) for (let n = 2; n < L.length; n++) for (let i = 0; i + n <= L.length; i++) {
  const S = L.slice(i, i + n);
  if (S !== L && endTotal.has(S) && endTotal.get(L) >= 0.8 * endTotal.get(S)) endDrop.add(S);
}
const endRepeats = endCands.filter((g) => !endDrop.has(g))
  .sort((a, b) => (endDf.get(b) - endDf.get(a)) || (b.length - a.length)).slice(0, 10);

// ---- 输出 ----
const fmt = (n) => n.toFixed(3);
console.log(`\n语言指纹报告  窗口 ${chapters.length} 章，最新=${latest.name}\n${'='.repeat(48)}`);

console.log(`\n[信号一] 跨章重复词/句式（DF≥2, 总次数≥${opt.minCount}）`);
if (!repeats.length) console.log('  无 — 用词分布健康。');
else for (const g of repeats) console.log(`  ${g}\t×${total.get(g)}\t出现于 ${df.get(g)}/${chapters.length} 章`);

console.log(`\n[信号二a] 章末收束相似度（末 ${opt.ends} 字，bigram 余弦·字面层）`);
let maxSim = 0;
for (const p of endPairs) { maxSim = Math.max(maxSim, p.sim); console.log(`  ${p.a} ↔ ${p.b}\t${fmt(p.sim)}${p.sim >= opt.simWarn ? '  ⚠️ 趋同' : ''}`); }

console.log(`\n[信号二b] 跨章末重复短语（章末口头禅，末 ${opt.ends} 字内）`);
if (!endRepeats.length) console.log('  无 — 章末收束未见字面复用。');
else for (const g of endRepeats) console.log(`  ${g}\t出现于 ${endDf.get(g)}/${chapters.length} 章末`);
console.log('  ↳ 主题层趋同（同母题换词，如"弱肉强食"改写成"强欺弱"）纯计算测不出，交 ⑤ LLM 审计。');

// 重复负载：DF==全章数 的词条数（每章都在用 = 口头禅化）。
const everywhere = repeats.filter((g) => df.get(g) === chapters.length);
console.log(`\n[判定]`);
const warns = [];
if (maxSim >= opt.simWarn) warns.push(`章末字面趋同（最高相似度 ${fmt(maxSim)} ≥ ${opt.simWarn}）`);
if (endRepeats.length >= 1) warns.push(`章末口头禅：${endRepeats.slice(0, 5).join('、')} 复用于多章末尾`);
if (everywhere.length >= 1) warns.push(`口头禅化：${everywhere.join('、')} 每章都在用`);
if (repeats.length >= opt.repeatWarn) warns.push(`高频词堆积（${repeats.length} 个跨章重复词条）`);
if (warns.length) {
  console.log('  ⚠️ WARN —— 喂回 runtime tick，建议改写最新章：');
  for (const w of warns) console.log(`     · ${w}`);
  process.exitCode = 2;
} else {
  console.log('  ✅ PASS —— 未见明显语言漂移。');
}
console.log('');
