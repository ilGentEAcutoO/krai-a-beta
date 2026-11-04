// /proof renderer. Pure string builders are exported so node:test can check
// the rendering contract (pending cells never show a number); boot() only
// runs in a browser. Data: /proof/data.json (static, built by
// scripts/build-proof.mjs from measured runs). No polling.
// Language: krai.js owns the TH/EN toggle; this module renders in LANG and
// re-renders on the 'krai:lang' event. Pending markers stay bilingual.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 1000) / 10}%`);
export const sec = (ms) => (ms == null ? 'n/a' : ms < 1000 ? `${(ms / 1000).toFixed(2)} s` : `${(ms / 1000).toFixed(1)} s`);
export const usd = (x) => (x == null ? 'n/a' : x >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(x >= 0.1 ? 3 : 4)}`);
const REPO = 'https://github.com/ilGentEAcutoO/krai-a-beta';
const ORDER = ['spark', 'jev'];
const CLASSES = ['SCAM', 'LEGIT', 'UNSURE'];

let LANG = 'en';
export const setLang = (l) => { LANG = l === 'th' ? 'th' : 'en'; };
const L = (th, en) => (LANG === 'th' ? th : en);
const who = (e) => (e.role === 'meta' ? L('Meta · Muse Spark', 'Meta · Muse Spark') : L('Baseline · Jev เดิม', 'Baseline · old Jev'));

// The four numbers a judge reads first. value() returns {big, small}.
// lowerIsBetter + num() feed the side-by-side "who is better" badge.
export const HEADLINES = [
  {
    key: 'recall',
    th: 'จับสายสแกมได้',
    en: 'Scam calls caught',
    hintTh: 'ยิ่งสูงยิ่งดี',
    hintEn: 'higher is better',
    num: (m) => m.scamRecall.rate,
    value: (m) => ({ big: pct(m.scamRecall.rate), small: L(`${m.scamRecall.k}/${m.scamRecall.n} สาย · หลุดเป็นปลอดภัย ${m.unsafeMiss.k}`, `${m.scamRecall.k}/${m.scamRecall.n} calls · unsafe misses ${m.unsafeMiss.k}`) }),
  },
  {
    key: 'falseAlarm',
    th: 'สายจริงโดนตัดว่าสแกม',
    en: 'Real callers judged SCAM',
    hintTh: 'ยิ่งต่ำยิ่งดี',
    hintEn: 'lower is better',
    lowerIsBetter: true,
    num: (m) => m.falseAlarm.rate,
    value: (m) => ({ big: pct(m.falseAlarm.rate), small: L(`${m.falseAlarm.k}/${m.falseAlarm.n} สายจริง · ส่งเป็น "ไม่แน่ใจ" ${m.unsure?.legit?.k ?? 'n/a'}`, `${m.falseAlarm.k}/${m.falseAlarm.n} real calls · left UNSURE ${m.unsure?.legit?.k ?? 'n/a'}`) }),
  },
  {
    key: 'latency',
    th: 'เวลาตัดสินต่อประโยค',
    en: 'Verdict time per caller turn',
    hintTh: 'p50 · ยิ่งต่ำยิ่งดี',
    hintEn: 'p50 · lower is better',
    lowerIsBetter: true,
    num: (m) => m.latencyMs.p50,
    value: (m) => ({ big: sec(m.latencyMs.p50), small: `p95 ${sec(m.latencyMs.p95)}${m.sparkLatencyMs ? L(` · Spark อย่างเดียว ${sec(m.sparkLatencyMs.p50)} / ${sec(m.sparkLatencyMs.p95)}`, ` · Spark alone ${sec(m.sparkLatencyMs.p50)} / ${sec(m.sparkLatencyMs.p95)}`) : ''}` }),
  },
  {
    key: 'cost',
    th: 'ค่า AI ต่อ 1,000 สาย',
    en: 'Judge cost per 1,000 calls',
    hintTh: 'ยิ่งต่ำยิ่งดี',
    hintEn: 'lower is better',
    lowerIsBetter: true,
    num: (m) => m.cost.usdPer1000,
    value: (m) => ({ big: usd(m.cost.usdPer1000), small: L(`≈ ฿${m.cost.thbPer1000 == null ? 'n/a' : m.cost.thbPer1000.toFixed(2)} · ${usd(m.cost.usdPerCall)} ต่อสาย`, `${usd(m.cost.usdPerCall)} per call`) }),
  },
];

// 'better' | 'worse' | 'tie' | null for one backend against the other.
export function compare(h, mine, other) {
  if (!mine || !other) return null;
  const a = h.num(mine);
  const b = h.num(other);
  if (a == null || b == null) return null;
  if (a === b) return 'tie';
  return (a < b) === !!h.lowerIsBetter ? 'better' : 'worse';
}

// A cell nothing will fill (sealed v2 was Spark only and is spent).
export const naHtml = (entry, { compact = false } = {}) => `<div class="pending is-na">
<div class="pending-t">${L('ไม่ได้รันบนชุดนี้', 'Not run on this set')}</div>
${compact ? '' : `<p class="pending-why">${esc(entry.reason || '')}</p>`}
</div>`;

export function pendingHtml(entry, { compact = false } = {}) {
  if (entry.status === 'na') return naHtml(entry, { compact });
  return `<div class="pending">
<div class="pending-t">รอรันจริง <span>/ pending live run</span></div>
${compact ? '' : `<p class="pending-why">${entry.backend === 'spark' ? L('ยังไม่มีผลวัดจาก Meta ไม่มีการประมาณแทน', 'No Meta measurement yet; nothing is estimated.') : L('ยังไม่มีผลวัดชุดนี้', 'Not measured on this set yet.')}${entry.reason && entry.reason !== 'not-run' ? ` (${esc(entry.reason)})` : ''}</p>`}
<div class="cmd"><code>${esc(entry.command)}</code><button type="button" class="copy" data-copy="${esc(entry.command)}">${L('คัดลอก', 'Copy')}</button></div>
${compact ? '' : `<p class="pending-needs">${L('ต้องมี env', 'needs env')}: <code>${esc(entry.needs)}</code></p>`}
</div>`;
}

export function headlineCell(entry, h, other = null) {
  const head = `<div class="who ${entry.role}">${esc(who(entry))}</div>`;
  if (entry.status !== 'done') return `<div class="cell is-pending">${head}${pendingHtml(entry, { compact: true })}</div>`;
  const v = h.value(entry.metrics);
  const alarm = h.key === 'recall' && entry.metrics.unsafeMiss.k > 0 ? ' is-bad' : '';
  const cmp = compare(h, entry.metrics, other?.status === 'done' ? other.metrics : null);
  const badge = cmp ? `<span class="cmp ${cmp}">${{ better: L('ดีกว่า', 'better'), worse: L('แย่กว่า', 'worse'), tie: L('เท่ากัน', 'tie') }[cmp]}</span>` : '';
  return `<div class="cell${alarm}">${head}<div class="big">${esc(v.big)}${badge}</div><div class="small">${esc(v.small)}</div></div>`;
}

export function headlinesHtml(set) {
  return HEADLINES.map((h) => `<article class="hl">
<h3>${esc(L(h.th, h.en))}<small>${esc(L(h.hintTh, h.hintEn))}</small></h3>
<div class="pair">${ORDER.map((b) => headlineCell(set.runs[b], h, set.runs[ORDER.find((x) => x !== b)])).join('')}</div>
</article>`).join('');
}

const PIPELINE = {
  full: ['Spark → กฎในโค้ด → Wonder เฉพาะโซนเทา (เหมือนแอปจริง)', 'Spark → code rules → Wonder for the grey zone only (as in the app)'],
  policy: ['Spark → กฎในโค้ด', 'Spark → code rules'],
  raw: ['คำตัดสินดิบของ Spark', 'raw Spark verdict'],
};

const ROWS = [
  ['จับสแกมได้', 'Scam recall', (m) => `${pct(m.scamRecall.rate)} <span>(${m.scamRecall.k}/${m.scamRecall.n})</span>`],
  ['สแกมหลุดเป็นปลอดภัย', 'Unsafe misses', (m) => `${m.unsafeMiss.k}${m.unsafeMiss.ids.length ? ` <span>${esc(m.unsafeMiss.ids.join(', '))}</span>` : ''}`],
  ['สายจริงโดนตัดว่าสแกม', 'False alarm', (m) => `${pct(m.falseAlarm.rate)} <span>(${m.falseAlarm.k}/${m.falseAlarm.n})</span>`],
  ['สายจริงที่ตัดสินไม่ได้ (รับฝากข้อความ)', 'Real caller left UNSURE', (m) => (m.unsure ? `${pct(m.unsure.legit.rate)} <span>(${m.unsure.legit.k}/${m.unsure.legit.n})</span>` : 'n/a')],
  ['ทุกสายที่จบแบบไม่แน่ใจ', 'Final UNSURE, all calls', (m) => (m.unsure ? `${pct(m.unsure.final.rate)} <span>(${m.unsure.final.k}/${m.unsure.final.n}) · scam ${m.unsure.scam.k}</span>` : 'n/a')],
  ['ตรงคลาส', 'Accuracy', (m) => `${pct(m.accuracy.rate)} <span>(${m.accuracy.k}/${m.accuracy.n})</span>`],
  ['เวลาตัดสินต่อประโยค p50 / p95 (ทั้งระบบ)', 'Latency p50 / p95, whole pipeline', (m) => `${sec(m.latencyMs.p50)} / ${sec(m.latencyMs.p95)} <span>(${m.latencyMs.turns} turns)</span>`],
  ['เฉพาะ Spark p50 / p95 (ไม่นับ cache)', 'Spark alone p50 / p95 (no cache)', (m) => (m.sparkLatencyMs ? `${sec(m.sparkLatencyMs.p50)} / ${sec(m.sparkLatencyMs.p95)} <span>(${m.sparkLatencyMs.turns} turns)</span>` : '<span>—</span>')],
  ['ประโยคที่ส่ง Wonder ตรวจซ้ำ', 'Grey zone sent to Wonder', (m) => (m.wonder ? `${pct(m.wonder.share)} <span>(${m.wonder.turns} turns · p50 ${sec(m.wonder.p50)} · p95 ${sec(m.wonder.p95)})</span>` : '<span>—</span>')],
  ['ประโยคจนตัดสินถูก (มัธยฐาน) เทียบผู้เชี่ยวชาญ', 'Turns to a correct verdict vs the expert (median)', (m) => `${m.turnsToVerdict.medianTurnsToCorrect ?? 'n/a'} vs ${m.turnsToVerdict.medianExpertTurn ?? 'n/a'} <span>· ${L('ทันผู้เชี่ยวชาญ', 'at or before the expert')} ${m.turnsToVerdict.atOrBeforeExpert}/${m.turnsToVerdict.correct} · SCAM ${m.turnsToVerdict.scamAtOrBeforeExpert.k}/${m.turnsToVerdict.scamAtOrBeforeExpert.n}</span>`],
  ['ค่า AI ต่อสาย', 'Cost per call', (m) => `${usd(m.cost.usdPerCall)} <span>· ${usd(m.cost.usdPer1000)} / 1,000</span>`],
  ['จำนวนสาย / ประโยค', 'Calls / turns', (m) => `${m.n} / ${m.turns}`],
  ['โมเดล', 'Model', (m) => `${esc(m.models.join(', ') || 'n/a')} <span>${esc(m.engines || '')}</span>`],
  ['ขั้นตอนที่วัด', 'Pipeline', (m) => (m.config?.pipeline ? `${esc(m.config.pipeline)} <span>${esc(PIPELINE[m.config.pipeline] ? L(...PIPELINE[m.config.pipeline]) : '')}${m.config.effort ? ` · effort ${esc(m.config.effort)}` : ''}</span>` : '<span>—</span>')],
];

export function fullTableHtml(set) {
  const head = `<thead><tr><th>${L('ตัวชี้วัด', 'Metric')}</th>${ORDER.map((b) => `<th class="${set.runs[b].role}">${esc(who(set.runs[b]))}</th>`).join('')}</tr></thead>`;
  const body = ROWS.map(([th, en, f]) => `<tr><td>${esc(L(th, en))}</td>${ORDER.map((b) => {
    const e = set.runs[b];
    if (e.status === 'na') return `<td class="num pend-td">${L('ไม่ได้รัน', 'not run')}</td>`;
    return e.status === 'done' ? `<td class="num">${f(e.metrics)}</td>` : '<td class="num pend-td">รอรันจริง <span>pending</span></td>';
  }).join('')}</tr>`).join('');
  return `<table class="k-table full">${head}<tbody>${body}</tbody></table>`;
}

export function matrixHtml(entry) {
  const title = `<h4>${esc(who(entry))}</h4>`;
  if (entry.status !== 'done') return `<div class="mx">${title}${pendingHtml(entry, { compact: true })}</div>`;
  const c = entry.metrics.confusion;
  const max = Math.max(1, ...CLASSES.flatMap((e) => CLASSES.map((p) => c[e][p])));
  const cell = (e, p) => {
    const v = c[e][p];
    const kind = e === p ? 'diag' : e === 'SCAM' && p === 'LEGIT' ? 'unsafe' : 'off';
    const a = v ? 0.12 + 0.6 * (v / max) : 0;
    return `<td class="${kind}" style="--a:${a.toFixed(2)}" title="expected ${e}, judged ${p}: ${v}">${v}</td>`;
  };
  return `<div class="mx">${title}<table class="matrix"><tr><th>${L('เฉลย ↓ / ทาย →', 'expected ↓ / judged →')}</th>${CLASSES.map((p) => `<th>${p}</th>`).join('')}</tr>${CLASSES.map((e) => `<tr><th>${e}</th>${CLASSES.map((p) => cell(e, p)).join('')}</tr>`).join('')}</table></div>`;
}

export function latencyHtml(set) {
  const done = ORDER.map((b) => set.runs[b]).filter((e) => e.status === 'done');
  const max = Math.max(1, ...done.map((e) => e.metrics.latencyMs.p95 || 0));
  return ORDER.map((b) => {
    const e = set.runs[b];
    if (e.status !== 'done') return `<div class="lat"><div class="lat-l">${esc(who(e))}</div><div class="lat-p">${e.status === 'na' ? L('ไม่ได้รันบนชุดนี้', 'Not run on this set') : 'รอรันจริง / pending'}</div></div>`;
    const { p50, p95 } = e.metrics.latencyMs;
    const row = (label, a, b) => `<div class="lat"><div class="lat-l">${label}</div>
<div class="bar"><i class="p95 ${e.role}" style="width:${(100 * b) / max}%"></i><i class="p50 ${e.role}" style="width:${(100 * a) / max}%"></i></div>
<div class="lat-n">p50 <b>${sec(a)}</b> · p95 <b>${sec(b)}</b></div></div>`;
    const sp = e.metrics.sparkLatencyMs;
    return row(esc(who(e)), p50, p95) + (sp && e.metrics.wonder ? row(`${esc(who(e))}<small>${L('Spark อย่างเดียว', 'Spark alone')}</small>`, sp.p50, sp.p95) : '');
  }).join('');
}

export function provenanceHtml(set) {
  return ORDER.map((b) => {
    const e = set.runs[b];
    if (e.status !== 'done') return `<div class="prov"><h4>${esc(who(e))}</h4>${pendingHtml(e)}</div>`;
    const commit = e.git.commit ? `<a href="${REPO}/commit/${esc(e.git.commit)}">${esc(e.git.commit.slice(0, 7))}</a> <span>(${esc(e.git.source)})</span>` : `${L('ไม่มี', 'none')} <span>(${esc(e.git.source)})</span>`;
    return `<div class="prov"><h4>${esc(who(e))}</h4><dl>
<dt>${L('รันเมื่อ', 'Ran at')}</dt><dd>${esc(e.ranAt)}</dd>
<dt>${L('ชุดข้อมูล', 'Dataset')}</dt><dd><code>${esc(e.dataset)}</code></dd>
<dt>${L('โค้ด', 'Commit')}</dt><dd>${commit}</dd>
<dt>${L('ผลดิบ', 'Raw')}</dt><dd><a href="/${esc(e.raw.results)}">results.json</a>${e.raw.summary ? ` · <a href="/${esc(e.raw.summary)}">summary.md</a>` : ''}</dd>
<dt>${L('รันซ้ำ', 'Re-run')}</dt><dd><div class="cmd"><code>${esc(e.command)}</code><button type="button" class="copy" data-copy="${esc(e.command)}">${L('คัดลอก', 'Copy')}</button></div></dd>
</dl></div>`;
  }).join('');
}

// Every Spark train run in order: what changed and what it did to the numbers.
export function historyHtml(history = []) {
  if (!history.length) return `<p class="k-muted">${L('ยังไม่มีรัน Spark บนชุด train', 'No Spark train run yet')}</p>`;
  const head = `<thead><tr><th>${L('รัน', 'Run')}</th><th>${L('ตั้งค่า', 'Config')}</th><th class="n">${L('จับสแกม', 'Scams caught')}</th><th class="n">${L('สายจริงโดนตัด', 'Real judged SCAM')}</th><th class="n">${L('สายจริงไม่แน่ใจ', 'Real left UNSURE')}</th><th class="n">p50 / p95</th><th class="n">${L('$ / สาย', '$ / call')}</th></tr></thead>`;
  const rows = history.map((h) => `<tr${h.partial ? ' class="is-partial"' : ''}><td>${h.role ? `<b>${esc(L(h.role.th, h.role.en))}</b><br>` : ''}${esc(String(h.ranAt).slice(0, 16).replace('T', ' '))}${h.partial ? ` <span>partial ${h.progress.completed}/${h.progress.total}</span>` : ''}${h.git ? ` <span>${esc(h.git)}</span>` : ''}${h.raw ? ` <a href="/${esc(h.raw)}">results.json</a>` : ''}</td>
<td>${esc(h.config?.model || '')} <span>${esc(h.config?.effort || '')} · ${esc(h.config?.pipeline || '')}${h.config?.fewshotHash ? ` · few-shot ${esc(h.config.fewshotHash.slice(0, 7))}` : ''}</span></td>
<td class="n">${h.scamRecall.k}/${h.scamRecall.n}</td><td class="n">${h.falseAlarm.k}/${h.falseAlarm.n}</td><td class="n">${h.legitUnsure ? `${h.legitUnsure.k}/${h.legitUnsure.n}` : 'n/a'}</td>
<td class="n">${sec(h.latencyMs.p50)} / ${sec(h.latencyMs.p95)}</td><td class="n">${usd(h.usdPerCall)}</td></tr>`).join('');
  return `<table class="k-table full hist">${head}<tbody>${rows}</tbody></table>`;
}

// Sealed v2 in plain words: what was run, in what order, and how small n is.
// Numbers come from data.json; the CI is Wilson 95% (same as eval.mjs).
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export function sealedV2Html(runs = [], prereg = null) {
  if (!runs.length) return '';
  const head = runs[runs.length - 1];
  const ci = wilson(head.scamRecall.k, head.scamRecall.n);
  const fa = wilson(head.falseAlarm.k, head.falseAlarm.n);
  const day = esc(String(head.ranAt).slice(0, 10));
  const range = (x) => (x ? `${pct(x[0])}–${pct(x[1])}` : 'n/a');
  const items = runs.map((r) => `<li>${r.role ? `<b>${esc(L(r.role.th, r.role.en))}</b> ` : ''}<code>${esc(r.git || '?')}</code>: ${L('จับสแกม', 'scams caught')} ${r.scamRecall.k}/${r.scamRecall.n} · ${L('สายจริงโดนตัดว่าสแกม', 'legit judged SCAM')} ${r.falseAlarm.k}/${r.falseAlarm.n} · ${L('สายจริงไม่แน่ใจ', 'legit left UNSURE')} ${r.legitUnsure ? `${r.legitUnsure.k}/${r.legitUnsure.n}` : 'n/a'}${r.legitUnsureIds?.length ? ` (<code>${r.legitUnsureIds.map(esc).join(', ')}</code>)` : ''} · ${L('ตรงคลาส', 'exact')} ${r.accuracy.k}/${r.accuracy.n}</li>`).join('');
  return `<div class="pf-story k-card" style="margin-top:16px"><p><b>${L('Sealed v2 พูดตรง ๆ', 'Sealed v2, stated plainly')}.</b> ${L(
    `60 สายที่ไม่เคยใช้จูน (สแกม ${head.scamRecall.n} สายจริง ${head.falseAlarm.n}) ลงทะเบียน hash ไว้ที่ a1629c8 ก่อนเริ่มจูนในสนาม AI ปะทะ AI รันครั้งเดียวต่อ build เมื่อ ${day} (Spark muse-spark-1.2, pipeline เต็ม) กฎ B28 เขียนและ commit ก่อนเห็นผล sealed v2 ใด ๆ และประกาศเป็น build ที่จะส่งก่อนรัน ตัวเลขหัวหน้าเพจคือ B28 ใบลงทะเบียนระบุสอง build (baseline และ main ตอน code freeze = B28) เรารัน production ก่อนหน้า f22b890 เพิ่มอีกหนึ่งรันเพื่อเทียบ เกณฑ์ที่ลงทะเบียนไว้: ส่ง build ที่จูนแล้ว เว้นแต่สายจริงโดนตัดว่าสแกมมากกว่า baseline ผลคือ ${head.falseAlarm.k} เทียบ ${runs[0].falseAlarm.k} จึงส่ง B28 หลังจากนี้ชุดนี้ถือว่าใช้แล้ว`,
    `60 held-out calls (${head.scamRecall.n} scam, ${head.falseAlarm.n} legit), hash pre-registered at a1629c8 before any arena tuning. One run per build on ${day} (Spark muse-spark-1.2, full pipeline). The B28 rules were written and committed before any sealed v2 result was seen, and B28 was declared the shipping build before its run. The headline is B28. The pre-registration named two builds (baseline, and main at code freeze = B28); previous production f22b890 was also run once for comparison. Pre-registered decision rule: ship the tuned build unless it has more legit calls judged SCAM than the baseline; ${head.falseAlarm.k} vs ${runs[0].falseAlarm.k}, so B28 ships. The set is now spent.`)}</p>
<ul>${items}</ul>
<p class="k-note">${L(
    `n เล็ก: จับสแกม ${head.scamRecall.k}/${head.scamRecall.n} มีช่วงความเชื่อมั่น 95% (Wilson) ${range(ci)} · สายจริงโดนตัด ${head.falseAlarm.k}/${head.falseAlarm.n} ช่วง ${range(fa)} สาม build ต่างกันแค่สายจริงที่ส่งเป็น "ไม่แน่ใจ" 1 สาย ซึ่งอยู่ในระดับสุ่มได้ · baseline Jev ไม่ได้รันบนชุดนี้`,
    `Small n: ${head.scamRecall.k}/${head.scamRecall.n} scams caught has a 95% CI (Wilson) of ${range(ci)}; ${head.falseAlarm.k}/${head.falseAlarm.n} legit judged SCAM, ${range(fa)}. The three builds differ by one legit call left UNSURE, which is within chance. The Jev baseline was not run on this set.`)}${prereg ? ` <a href="/${esc(prereg)}">${L('ใบลงทะเบียนล่วงหน้า', 'Pre-registration')}</a>` : ''}</p></div>`;
}

// First complete tuning run against the newest complete one, numbers as recorded.
export function beforeAfterHtml(history = []) {
  const full = history.filter((h) => !h.partial);
  if (full.length < 2) return `<p class="k-muted">${L('ยังมีรันเต็มชุดไม่ถึงสองรัน', 'Fewer than two complete runs so far')}</p>`;
  const a = full[0];
  const b = full[full.length - 1];
  const day = (h) => esc(String(h.ranAt).slice(0, 16).replace('T', ' '));
  const rows = [
    [L('จับสายสแกมได้', 'Scam calls caught'), `${a.scamRecall.k}/${a.scamRecall.n}`, `${b.scamRecall.k}/${b.scamRecall.n}`],
    [L('สายจริงโดนตัดว่าสแกม', 'Real callers judged SCAM'), `${a.falseAlarm.k}/${a.falseAlarm.n}`, `${b.falseAlarm.k}/${b.falseAlarm.n}`],
    [L('สายจริงที่ส่งเป็น "ไม่แน่ใจ"', 'Real callers left UNSURE'), a.legitUnsure ? `${a.legitUnsure.k}/${a.legitUnsure.n}` : 'n/a', b.legitUnsure ? `${b.legitUnsure.k}/${b.legitUnsure.n}` : 'n/a'],
    [L('เวลาตัดสิน p50', 'Verdict time p50'), sec(a.latencyMs.p50), sec(b.latencyMs.p50)],
  ];
  return `<div class="ba">
<div class="ba-h"><span>${L('รันเต็มชุดแรก', 'First complete run')}<small>${day(a)}${a.git ? ` · ${esc(a.git)}` : ''}</small></span><span>${L('รันล่าสุด', 'Newest run')}<small>${day(b)}${b.git ? ` · ${esc(b.git)}` : ''}</small></span></div>
${rows.map(([label, x, y]) => `<div class="ba-r"><div class="ba-l">${esc(label)}</div><div class="ba-v"><b class="was">${esc(x)}</b><i aria-hidden="true">→</i><b>${esc(y)}</b></div></div>`).join('')}
</div><p class="k-note">${L(`${full.length} รันเต็มชุดบน train ตั้งแต่เริ่มจูน ตัวเลขทุกรันอยู่ในตารางด้านล่าง`, `${full.length} complete train runs since tuning began; every run is in the table below.`)}</p>`;
}

// Per caller language, counted straight from the case verdicts in data.json.
export function langHtml(set, cases = []) {
  if (!cases.length) return `<p class="k-muted">${L('ยังไม่มีรันในชุดนี้', 'No run on this set yet')}</p>`;
  const langs = [...new Set(cases.map((c) => c.lang))].sort();
  const name = { th: L('ไทย', 'Thai'), en: L('อังกฤษ', 'English') };
  const head = `<thead><tr><th>${L('ภาษาผู้โทร', 'Caller language')}</th><th class="n">${L('สาย', 'Calls')}</th>${ORDER.map((b) => `<th class="n">${esc(who(set.runs[b]))}<span>${L('ตัดสินถูก', 'judged right')}</span></th>`).join('')}${ORDER.map((b) => `<th class="n">${esc(who(set.runs[b]))}<span>${L('สแกมหลุด', 'unsafe misses')}</span></th>`).join('')}</tr></thead>`;
  const body = langs.map((lg) => {
    const cs = cases.filter((c) => c.lang === lg);
    const ok = (b) => (set.runs[b].status === 'done' ? `${cs.filter((c) => c.verdicts[b]?.ok).length}/${cs.length}` : set.runs[b].status === 'na' ? '—' : '<span class="pend-td">รอรันจริง</span>');
    const miss = (b) => (set.runs[b].status === 'done' ? String(cs.filter((c) => c.verdicts[b]?.unsafeMiss).length) : '—');
    return `<tr><td>${esc(name[lg] || lg)} <span>${esc(lg)}</span></td><td class="n">${cs.length}</td>${ORDER.map((b) => `<td class="n">${ok(b)}</td>`).join('')}${ORDER.map((b) => `<td class="n">${miss(b)}</td>`).join('')}</tr>`;
  }).join('');
  return `<table class="k-table">${head}<tbody>${body}</tbody></table>`;
}

// Real audio through the live pipeline (eval-results/realuse-*/results.json).
// Latency is shown exactly as measured, however bad.
export function realUseHtml(rows = []) {
  if (!rows.length) return `<p class="k-muted">${L('ยังไม่มีผลทดสอบด้วยเสียงจริง', 'No real-audio run published yet')}</p>`;
  const label = (r) => (r.engine === 'meta'
    ? `Meta${r.receptionist ? ' + receptionist' : ''}${r.variant ? ` (${esc(r.variant)})` : ''}${r.current ? '' : ` <span class="cmp worse">${L('build เก่า', 'superseded build')}</span>`}`
    : 'v1 (Jev + Gemini Live)');
  const th = (t, e, s) => `<th>${L(t, e)}${s ? `<span>${s}</span>` : ''}</th>`;
  const head = `<thead><tr>${th('รัน', 'Run')}${th('จับสแกม', 'Scams flagged')}${th('ตัดก่อนจบคำขอ', 'Stopped before the demand ended')}${th('สายจริงโดนวาง', 'Wrong hang-ups')}${th('CER th / en', 'CER th / en')}${th('จบประโยค→ตัดสิน', 'End of speech → decision', 'p50 / p95')}${th('เงียบนานสุด', 'Longest silence heard', 'p50 / max')}${th('ไม่ตอบ / พูดทับ', 'Unanswered / talk-over')}${th('ตอบจริงครั้งแรก', 'First real reply', 'p50 / p95')}${th('ถามซ้ำ', 'Redundant questions', L('ตัดสินโดย Jev', 'judged by Jev'))}${th('$ / สาย', '$ / call')}</tr></thead>`;
  const body = rows.map((r) => `<tr${r.engine === 'meta' && !r.current ? ' class="is-partial"' : ''}><td>${label(r)} · ${esc(r.condition)}${r.speculate ? ' · speculative' : ''} <span>${esc(r.model || '')}${r.git ? ` · ${esc(r.git)}` : ''}</span></td>
<td class="n">${r.scams.k ?? 'n/a'}/${r.scams.n ?? 'n/a'}</td><td class="n">${r.protectedBeforeDemandEnds ?? 'n/a'}</td><td class="n">${r.wrongHangups ?? 'n/a'}</td>
<td class="n">${pct(r.cer.th)} / ${pct(r.cer.en)}</td><td class="n">${sec(r.eosToDecisionMs.p50)} / ${sec(r.eosToDecisionMs.p95)}</td><td class="n">${r.longestSilenceMs?.p50 == null ? 'n/a' : `${sec(r.longestSilenceMs.p50)} / ${sec(r.longestSilenceMs.max)}`}</td><td class="n">${r.unansweredTurns ?? 'n/a'} / ${r.talkOverTurns ?? 'n/a'}</td><td class="n">${r.realReplyMs?.p50 == null ? 'n/a' : `${sec(r.realReplyMs.p50)} / ${sec(r.realReplyMs.p95)}`}</td><td class="n">${r.redundant ? `${r.redundant.k ?? 'n/a'}/${r.redundant.n}` : 'n/a'}</td><td class="n">${usd(r.usdPerCall)}</td></tr>`).join('');
  const t1 = rows.filter((r) => r.t1 && r.engine === 'meta' && r.current);
  const t1Note = t1.length ? `<p class="k-note">${L('กฎด่วน T1 (ไม่ใช้โมเดล)', 'Instant code rule T1 (no model)')}: ${t1.map((r) => `${esc(r.condition)} fired ${r.t1.hits}×, Spark agreed ${r.t1.sparkAgree ?? 'n/a'}, on legit/unsure calls ${r.t1.onNonScam ?? 'n/a'}`).join(' · ')}</p>` : '';
  // Essential columns up front; the full table lives in the collapsible below.
  const shead = `<thead><tr>${th('รัน', 'Run')}${th('จับสแกม', 'Scams flagged')}${th('สายจริงโดนวาง', 'Wrong hang-ups')}${th('จบประโยค→ตัดสิน', 'End of speech → decision', 'p50 / p95')}${th('$ / สาย', '$ / call')}</tr></thead>`;
  const sbody = rows.map((r) => `<tr${r.engine === 'meta' && !r.current ? ' class="is-partial"' : ''}><td>${label(r)} · ${esc(r.condition)}${r.speculate ? ' · speculative' : ''} <span>${esc(r.model || '')}${r.git ? ` · ${esc(r.git)}` : ''}</span></td>
<td class="n">${r.scams.k ?? 'n/a'}/${r.scams.n ?? 'n/a'}</td><td class="n">${r.wrongHangups ?? 'n/a'}</td><td class="n">${sec(r.eosToDecisionMs.p50)} / ${sec(r.eosToDecisionMs.p95)}</td><td class="n">${usd(r.usdPerCall)}</td></tr>`).join('');
  return `<div class="k-table-wrap"><table class="k-table full hist ess">${shead}<tbody>${sbody}</tbody></table></div>
<details class="k-details" style="background:#fff;margin-top:12px"><summary><span>${L('ตารางเต็มทุกคอลัมน์: CER เงียบนานสุด ไม่ตอบ/พูดทับ ตอบจริงครั้งแรก ถามซ้ำ', 'All columns: CER, longest silence, unanswered / talk-over, first real reply, redundant questions')}</span></summary>
<div class="k-details-body"><div class="k-table-wrap"><table class="k-table full hist">${head}<tbody>${body}</tbody></table></div></div></details>${t1Note}
<p class="k-note">${L('10 สายเดียวกันทั้งสองระบบ (ไทย 5 อังกฤษ 5) เสียงผู้โทรเป็น TTS ไม่ใช่คนจริง สตรีมแบบเวลาจริง · phone = 8 kHz + mu-law + เสียงรบกวน', 'The same 10 calls through both builds (5 Thai, 5 English), TTS caller voices (not humans), streamed in real time; phone = 8 kHz band-limit, mu-law and line noise.')}</p>
<p class="k-note">${L('ตอบจริงครั้งแรก = ประโยคแรกหลังผู้โทรพูดจบที่มากกว่า "ค่ะ" (คำถาม/ปิดสาย) · ถามซ้ำ = ถามสิ่งที่ผู้โทรบอกไปแล้ว ตัดสินโดย TypeSafe Jev ซึ่งแยกจาก Spark · เสียงที่อัดไว้ไม่รอคำถาม: บางเทิร์นผู้โทรพูดต่อก่อนคำถามถัดไป ระบบจึงข้ามคำถามนั้น (ได้ยินแค่ "ค่ะ") ผู้โทรจริงมักรอฟัง', 'First real reply = the first line after the caller stops that is more than a short acknowledgement ("ka", Thai for "yes") (a question or a close). Redundant = asks for something the caller already said, judged by TypeSafe Jev, independent of Spark. The recorded callers don\'t wait: when one starts the next turn before the follow-up, the follow-up is skipped and that turn only heard the acknowledgement; a live caller would usually wait.')}</p>`;
}

// Runs stopped early and replaced by a complete run: listed, never scored.
export function stoppedHtml(stopped = []) {
  if (!stopped.length) return '';
  return `<p class="k-note">${L('รันที่หยุดกลางทางและถูกแทนด้วยรันเต็ม (ไม่นับเป็นผล)', 'Stopped early, replaced by a complete run, not scored')}: ${stopped.map((r) => `<code>${esc(r.dir)}</code> (${esc(r.set)} ${esc(r.backend)}, ${r.progress.completed}/${r.progress.total} calls, ${esc(r.git || '?')}, ${usd(r.usd)}) → <code>${esc(r.replacedBy)}</code>`).join(' · ')}</p>`;
}

const chip = (v) => `<span class="v-pill" data-v="${esc(v)}">${esc(v)}</span>`;

export function caseHtml(c, set) {
  const final = (b) => {
    const v = c.verdicts[b];
    if (!v) return set.runs[b].status === 'done' || set.runs[b].status === 'na' ? '<span class="k-muted">—</span>' : '<span class="chip pend">pending</span>';
    return `${chip(v.final)}${v.unsafeMiss ? `<b class="flag">${L('หลุด', 'miss')}</b>` : v.ok ? '' : '<b class="x" aria-label="wrong">✕</b>'}`;
  };
  const turns = c.callerTurns.map((text, i) => {
    const per = ORDER.map((b) => {
      const t = c.verdicts[b]?.trail?.find((x) => x.turn === i + 1);
      if (!c.verdicts[b]) return '';
      if (!t) return `<div class="tv"><em>${esc(who(set.runs[b]))}</em> <span class="k-muted">${L('วางสายก่อนถึงประโยคนี้', 'call ended before this turn')}</span></div>`;
      return `<div class="tv"><em>${esc(who(set.runs[b]))}</em> ${chip(t.verdict)} ${Math.round((t.confidence || 0) * 100)}% · ${esc(t.path)} · ${sec(t.latencyMs)} · ${esc(t.action)}${t.reason ? `<div class="rs">${esc(t.reason)}</div>` : ''}</div>`;
    }).join('');
    return `<li><div class="caller"><span>${L('ผู้โทร', 'Caller')} ${i + 1}${i + 1 === c.expertTurn ? ` · <b>${L('ผู้เชี่ยวชาญรู้ตรงนี้', 'the expert knows here')}</b>` : ''}</span>${esc(text)}</div>${per}</li>`;
  }).join('');
  const wrong = ORDER.some((b) => c.verdicts[b] && !c.verdicts[b].ok);
  return `<details class="case" data-class="${esc(c.class)}" data-wrong="${wrong ? 1 : 0}" data-q="${esc(`${c.id} ${c.category}`.toLowerCase())}">
<summary><span class="cid">${esc(c.id)}<small>${esc(c.category)} · ${esc(c.lang)}</small></span><span class="col">${chip(c.class)}</span>${ORDER.map((b) => `<span class="col">${final(b)}</span>`).join('')}</summary>
<div class="case-b">${c.why ? `<p class="why">${L('เหตุผลผู้เชี่ยวชาญ', 'Expert')}: ${esc(c.why)}</p>` : ''}<ol class="turns">${turns}</ol></div>
</details>`;
}

// ---------------- browser ----------------
function boot() {
  const $ = (id) => document.getElementById(id);
  let DATA = null;
  let SET = 'train';

  function renderCases() {
    const set = DATA.sets[SET];
    const all = DATA.cases[SET] || [];
    const wrongOnly = $('wrongOnly').checked;
    const cls = $('classFilter').value;
    const q = $('caseSearch').value.trim().toLowerCase();
    const shown = all.filter((c) => (!wrongOnly || ORDER.some((b) => c.verdicts[b] && !c.verdicts[b].ok))
      && (!cls || c.class === cls) && (!q || `${c.id} ${c.category}`.toLowerCase().includes(q)));
    $('caseCount').textContent = L(`${shown.length} / ${all.length} สาย`, `${shown.length} of ${all.length} calls`);
    $('caseHead').innerHTML = `<span class="cid">${L('เคส', 'Case')}</span><span class="col">${L('เฉลย', 'Expected')}</span>${ORDER.map((b) => `<span class="col">${esc(who(set.runs[b]))}</span>`).join('')}`;
    $('cases').innerHTML = all.length
      ? (shown.map((c) => caseHtml(c, set)).join('') || `<p class="k-muted pad">${L('ไม่มีเคสตรงตัวกรอง', 'No cases match the filters')}</p>`)
      : `<p class="k-muted pad">${L('ยังไม่มีรันในชุดนี้ ดูคำสั่งด้านบน', 'No run on this set yet; see the command above')}</p>`;
  }

  function render() {
    const set = DATA.sets[SET];
    for (const btn of document.querySelectorAll('[data-set]')) btn.setAttribute('aria-pressed', String(btn.dataset.set === SET));
    $('banner').hidden = set.runs.spark.status === 'done';
    $('headlines').innerHTML = headlinesHtml(set);
    $('full').innerHTML = fullTableHtml(set);
    $('matrices').innerHTML = ORDER.map((b) => matrixHtml(set.runs[b])).join('');
    $('latency').innerHTML = latencyHtml(set);
    $('prov').innerHTML = provenanceHtml(set) + stoppedHtml(DATA.stoppedRuns || []);
    $('beforeAfter').innerHTML = beforeAfterHtml(DATA.trainHistory || []);
    $('history').innerHTML = historyHtml(DATA.trainHistory || []);
    $('setStory').innerHTML = SET === 'sealed2' ? sealedV2Html(DATA.sealedV2Runs || [], DATA.sealedV2Prereg) : '';
    $('sealedRuns').innerHTML = ((DATA.sealedV2Runs || []).length
      ? `<h4>${L('Sealed v2 (60 สาย รันละครั้งต่อ build)', 'Sealed v2 (60 calls, one run per build)')}</h4><div class="k-table-wrap">${historyHtml(DATA.sealedV2Runs)}</div>${DATA.sealedV2Prereg ? `<p class="k-note"><a href="/${esc(DATA.sealedV2Prereg)}">${L('ใบลงทะเบียนล่วงหน้า', 'Pre-registration')}</a></p>` : ''}`
      : '') + ((DATA.sealedRuns || []).length > 1
      ? `<h4>${L('Sealed v1 (35 สาย)', 'Sealed v1 (35 calls)')}</h4><div class="k-table-wrap">${historyHtml(DATA.sealedRuns)}</div><p class="k-note">${L('ชุด sealed v1 รันสองครั้ง: ครั้งที่สองลงทะเบียนเหตุผลและเกณฑ์ตัดสินไว้ก่อนรัน (ตัวกระตุ้นคือเสียงจริง + ชุด train ไม่ได้ดู sealed) แท็บ sealed v1 แสดงรันล่าสุดของ v1', 'Sealed v1 was run twice; the second run was pre-registered (trigger: real audio + train, sealed not consulted). The sealed v1 tab shows the newer v1 run.')}${DATA.sealedRerunNote ? ` <a href="/${esc(DATA.sealedRerunNote)}">Pre-registration</a>` : ''}</p>`
      : '');
    $('realuse').innerHTML = realUseHtml(DATA.realUse || []);
    $('langTbl').innerHTML = langHtml(set, DATA.cases[SET] || []);
    $('setNote').textContent = `${L(set.labelTh, set.labelEn)} · ${set.file}`;
    $('built').innerHTML = `${L('สร้างจากผลรันเมื่อ', 'Built from runs at')} ${esc(DATA.generatedAt)}${DATA.builtFromCommit ? ` · <a href="${REPO}/commit/${esc(DATA.builtFromCommit)}">${esc(DATA.builtFromCommit.slice(0, 7))}</a>` : ''} · ${L('ราคา ณ', 'prices checked')} ${esc(DATA.pricing.checkedAt)}${L(` · $1 = ฿${esc(DATA.pricing.thbPerUsd)}`, '')}`;
    for (const s of ['train', 'sealed', 'sealed2']) {
      const small = document.querySelector(`[data-set="${s}"] small`);
      const n = DATA.cases[s]?.length;
      if (small) small.textContent = n ? L(`${n} สาย`, `${n} calls`) : L('ยังไม่รัน', 'not run');
    }
    renderCases();
  }

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button.copy');
    if (b) {
      const text = b.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = L('คัดลอกแล้ว', 'Copied');
      } catch {
        const code = b.previousElementSibling;
        const r = document.createRange();
        r.selectNodeContents(code);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        b.textContent = L('เลือกแล้ว กด Ctrl+C', 'Selected, press Ctrl+C');
      }
      setTimeout(() => { b.textContent = L('คัดลอก', 'Copy'); }, 1800);
      return;
    }
    const seg = ev.target.closest('[data-set]');
    if (seg && DATA) {
      SET = seg.dataset.set;
      render();
    }
  });
  for (const id of ['wrongOnly', 'classFilter']) $(id).addEventListener('change', () => DATA && renderCases());
  $('caseSearch').addEventListener('input', () => DATA && renderCases());
  document.addEventListener('krai:lang', (e) => {
    setLang(e.detail?.lang);
    if (DATA) render();
  });
  setLang(window.kraiLang?.());

  fetch('/proof/data.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => {
      DATA = d;
      SET = d.defaultSet || 'train';
      $('defs').innerHTML = Object.entries(d.definitions).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
      document.body.classList.remove('loading');
      render();
    })
    .catch((e) => {
      $('loadErr').hidden = false;
      $('loadErr').textContent = L(`โหลดข้อมูลไม่ได้ (${e.message}) ลองรีเฟรชหน้า`, `Could not load /proof/data.json (${e.message}). Reload the page to try again.`);
    });
}

if (typeof document !== 'undefined') boot();
