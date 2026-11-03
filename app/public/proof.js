// /proof renderer. Pure string builders are exported so node:test can check
// the rendering contract (pending cells never show a number); boot() only
// runs in a browser. Data: /proof/data.json (static, built by
// scripts/build-proof.mjs from measured runs). No polling.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 1000) / 10}%`);
export const sec = (ms) => (ms == null ? 'n/a' : ms < 1000 ? `${(ms / 1000).toFixed(2)} s` : `${(ms / 1000).toFixed(1)} s`);
export const usd = (x) => (x == null ? 'n/a' : x >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(x >= 0.1 ? 3 : 4)}`);
const REPO = 'https://github.com/ilGentEAcutoO/krai-a-beta';
const ORDER = ['spark', 'jev'];
const CLASSES = ['SCAM', 'LEGIT', 'UNSURE'];

// The four numbers a judge reads first. value() returns {big, small}.
// lowerIsBetter + num() feed the side-by-side "who is better" badge.
export const HEADLINES = [
  {
    key: 'recall',
    th: 'จับสายสแกมได้',
    en: 'Scam calls caught (higher is better)',
    num: (m) => m.scamRecall.rate,
    value: (m) => ({ big: pct(m.scamRecall.rate), small: `${m.scamRecall.k}/${m.scamRecall.n} สาย · หลุดเป็นปลอดภัย ${m.unsafeMiss.k} · unsafe misses ${m.unsafeMiss.k}` }),
  },
  {
    key: 'falseAlarm',
    th: 'สายจริงโดนตัดว่าสแกม',
    en: 'Real callers judged SCAM (lower is better)',
    lowerIsBetter: true,
    num: (m) => m.falseAlarm.rate,
    value: (m) => ({ big: pct(m.falseAlarm.rate), small: `${m.falseAlarm.k}/${m.falseAlarm.n} สายจริง · ส่งเป็น "ไม่แน่ใจ" ${m.unsure?.legit?.k ?? 'n/a'} · left UNSURE ${m.unsure?.legit?.k ?? 'n/a'}` }),
  },
  {
    key: 'latency',
    th: 'เวลาตัดสินต่อประโยค',
    en: 'Verdict time per caller turn, p50 (lower is better)',
    lowerIsBetter: true,
    num: (m) => m.latencyMs.p50,
    value: (m) => ({ big: sec(m.latencyMs.p50), small: `p95 ${sec(m.latencyMs.p95)}${m.sparkLatencyMs ? ` · Spark อย่างเดียว ${sec(m.sparkLatencyMs.p50)} / ${sec(m.sparkLatencyMs.p95)}` : ''}` }),
  },
  {
    key: 'cost',
    th: 'ค่า AI ต่อ 1,000 สาย',
    en: 'Judge cost per 1,000 calls (lower is better)',
    lowerIsBetter: true,
    num: (m) => m.cost.usdPer1000,
    value: (m) => ({ big: usd(m.cost.usdPer1000), small: `≈ ฿${m.cost.thbPer1000 == null ? 'n/a' : m.cost.thbPer1000.toFixed(2)} · ${usd(m.cost.usdPerCall)} ต่อสาย / per call` }),
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

export function pendingHtml(entry, { compact = false } = {}) {
  return `<div class="pending">
<div class="pending-t">รอรันจริง <span>/ pending live run</span></div>
${compact ? '' : `<p class="pending-why">${entry.backend === 'spark' ? 'ยังไม่มีผลวัดจาก Meta — ไม่มีการประมาณแทน · No Meta measurement yet; nothing is estimated.' : 'ยังไม่มีผลวัดชุดนี้ · Not measured on this set yet.'}${entry.reason && entry.reason !== 'not-run' ? ` (${esc(entry.reason)})` : ''}</p>`}
<div class="cmd"><code>${esc(entry.command)}</code><button type="button" class="copy" data-copy="${esc(entry.command)}">คัดลอก</button></div>
${compact ? '' : `<p class="pending-needs">ต้องมี env · needs: <code>${esc(entry.needs)}</code></p>`}
</div>`;
}

export function headlineCell(entry, h, other = null) {
  const head = `<div class="who ${entry.role}"><b>${esc(entry.labelTh)}</b><span>${esc(entry.role === 'meta' ? 'Meta model' : 'baseline')}</span></div>`;
  if (entry.status !== 'done') return `<div class="cell is-pending">${head}${pendingHtml(entry, { compact: true })}</div>`;
  const v = h.value(entry.metrics);
  const alarm = h.key === 'recall' && entry.metrics.unsafeMiss.k > 0 ? ' is-bad' : '';
  const cmp = compare(h, entry.metrics, other?.status === 'done' ? other.metrics : null);
  const badge = cmp ? `<span class="cmp ${cmp}">${{ better: 'ดีกว่า · better', worse: 'แย่กว่า · worse', tie: 'เท่ากัน · tie' }[cmp]}</span>` : '';
  return `<div class="cell${alarm}">${head}<div class="big">${esc(v.big)}${badge}</div><div class="small">${esc(v.small)}</div></div>`;
}

export function headlinesHtml(set) {
  return HEADLINES.map((h) => `<article class="hl">
<h3>${esc(h.th)}<small>${esc(h.en)}</small></h3>
<div class="pair">${ORDER.map((b) => headlineCell(set.runs[b], h, set.runs[ORDER.find((x) => x !== b)])).join('')}</div>
</article>`).join('');
}

const ROWS = [
  ['SCAM recall', 'จับสแกมได้', (m) => `${pct(m.scamRecall.rate)} <span>(${m.scamRecall.k}/${m.scamRecall.n})</span>`],
  ['Unsafe misses', 'สแกมหลุดเป็นปลอดภัย', (m) => `${m.unsafeMiss.k}${m.unsafeMiss.ids.length ? ` <span>${esc(m.unsafeMiss.ids.join(', '))}</span>` : ''}`],
  ['False alarm', 'สายจริงโดนตัดว่าสแกม', (m) => `${pct(m.falseAlarm.rate)} <span>(${m.falseAlarm.k}/${m.falseAlarm.n})</span>`],
  ['Real caller left UNSURE', 'สายจริงที่ตัดสินไม่ได้ (รับฝากข้อความ)', (m) => (m.unsure ? `${pct(m.unsure.legit.rate)} <span>(${m.unsure.legit.k}/${m.unsure.legit.n})</span>` : 'n/a')],
  ['Final UNSURE, all calls', 'ทุกสายที่จบแบบไม่แน่ใจ', (m) => (m.unsure ? `${pct(m.unsure.final.rate)} <span>(${m.unsure.final.k}/${m.unsure.final.n}) · scam ${m.unsure.scam.k}</span>` : 'n/a')],
  ['Accuracy', 'ตรงคลาส', (m) => `${pct(m.accuracy.rate)} <span>(${m.accuracy.k}/${m.accuracy.n})</span>`],
  ['Latency p50 / p95', 'เวลาตัดสินต่อประโยค (ทั้งระบบ)', (m) => `${sec(m.latencyMs.p50)} / ${sec(m.latencyMs.p95)} <span>(${m.latencyMs.turns} turns)</span>`],
  ['Spark alone p50 / p95', 'เฉพาะ Spark (ไม่นับ cache)', (m) => (m.sparkLatencyMs ? `${sec(m.sparkLatencyMs.p50)} / ${sec(m.sparkLatencyMs.p95)} <span>(${m.sparkLatencyMs.turns} turns)</span>` : '<span>—</span>')],
  ['Grey zone to Wonder', 'ประโยคที่ส่ง Wonder ตรวจซ้ำ', (m) => (m.wonder ? `${pct(m.wonder.share)} <span>(${m.wonder.turns} turns · p50 ${sec(m.wonder.p50)} · p95 ${sec(m.wonder.p95)})</span>` : '<span>—</span>')],
  ['Turns to verdict', 'ประโยคจนตัดสินถูก (มัธยฐาน) เทียบผู้เชี่ยวชาญ', (m) => `${m.turnsToVerdict.medianTurnsToCorrect ?? 'n/a'} vs ${m.turnsToVerdict.medianExpertTurn ?? 'n/a'} <span>· ทันผู้เชี่ยวชาญ ${m.turnsToVerdict.atOrBeforeExpert}/${m.turnsToVerdict.correct} · SCAM ${m.turnsToVerdict.scamAtOrBeforeExpert.k}/${m.turnsToVerdict.scamAtOrBeforeExpert.n}</span>`],
  ['Cost / call', 'ค่า AI ต่อสาย', (m) => `${usd(m.cost.usdPerCall)} <span>· ${usd(m.cost.usdPer1000)} / 1,000</span>`],
  ['Calls / turns', 'จำนวนสาย / ประโยค', (m) => `${m.n} / ${m.turns}`],
  ['Model', 'โมเดล', (m) => `${esc(m.models.join(', ') || 'n/a')} <span>${esc(m.engines || '')}</span>`],
  ['Pipeline', 'ขั้นตอนที่วัด', (m) => (m.config?.pipeline ? `${esc(m.config.pipeline)} <span>${esc(PIPELINE_TH[m.config.pipeline] || '')}${m.config.effort ? ` · effort ${esc(m.config.effort)}` : ''}</span>` : '<span>—</span>')],
];

const PIPELINE_TH = {
  full: 'Spark → กฎในโค้ด → Wonder เฉพาะโซนเทา (เหมือนแอปจริง)',
  policy: 'Spark → กฎในโค้ด',
  raw: 'คำตัดสินดิบของ Spark',
};

export function fullTableHtml(set) {
  const head = `<tr><th>ตัวชี้วัด <span>metric</span></th>${ORDER.map((b) => `<th class="${set.runs[b].role}">${esc(set.runs[b].labelTh)}</th>`).join('')}</tr>`;
  const body = ROWS.map(([en, th, f]) => `<tr><td>${esc(th)}<span>${esc(en)}</span></td>${ORDER.map((b) => {
    const e = set.runs[b];
    return e.status === 'done' ? `<td class="num">${f(e.metrics)}</td>` : '<td class="num muted">รอรันจริง <span>pending</span></td>';
  }).join('')}</tr>`).join('');
  return `<table class="full">${head}${body}</table>`;
}

export function matrixHtml(entry) {
  const title = `<h4>${esc(entry.labelTh)} <span>${esc(entry.labelEn)}</span></h4>`;
  if (entry.status !== 'done') return `<div class="mx">${title}${pendingHtml(entry, { compact: true })}</div>`;
  const c = entry.metrics.confusion;
  const max = Math.max(1, ...CLASSES.flatMap((e) => CLASSES.map((p) => c[e][p])));
  const cell = (e, p) => {
    const v = c[e][p];
    const kind = e === p ? 'diag' : e === 'SCAM' && p === 'LEGIT' ? 'unsafe' : 'off';
    const a = v ? 0.12 + 0.6 * (v / max) : 0;
    return `<td class="${kind}" style="--a:${a.toFixed(2)}" title="expected ${e}, judged ${p}: ${v}">${v}</td>`;
  };
  return `<div class="mx">${title}<table class="matrix"><tr><th>เฉลย ↓ / ทาย →</th>${CLASSES.map((p) => `<th>${p}</th>`).join('')}</tr>${CLASSES.map((e) => `<tr><th>${e}</th>${CLASSES.map((p) => cell(e, p)).join('')}</tr>`).join('')}</table></div>`;
}

export function latencyHtml(set) {
  const done = ORDER.map((b) => set.runs[b]).filter((e) => e.status === 'done');
  const max = Math.max(1, ...done.map((e) => e.metrics.latencyMs.p95 || 0));
  return ORDER.map((b) => {
    const e = set.runs[b];
    if (e.status !== 'done') return `<div class="lat"><div class="lat-l">${esc(e.labelTh)}</div><div class="lat-p">รอรันจริง / pending</div></div>`;
    const { p50, p95 } = e.metrics.latencyMs;
    const row = (label, a, b) => `<div class="lat"><div class="lat-l">${label}</div>
<div class="bar"><i class="p95 ${e.role}" style="width:${(100 * b) / max}%"></i><i class="p50 ${e.role}" style="width:${(100 * a) / max}%"></i></div>
<div class="lat-n">p50 <b>${sec(a)}</b> · p95 <b>${sec(b)}</b></div></div>`;
    const sp = e.metrics.sparkLatencyMs;
    return row(esc(e.labelTh), p50, p95) + (sp && e.metrics.wonder ? row(`${esc(e.labelTh)}<small> · Spark อย่างเดียว</small>`, sp.p50, sp.p95) : '');
  }).join('');
}

export function provenanceHtml(set) {
  return ORDER.map((b) => {
    const e = set.runs[b];
    if (e.status !== 'done') return `<div class="prov"><h4>${esc(e.labelTh)}</h4>${pendingHtml(e)}</div>`;
    const commit = e.git.commit ? `<a href="${REPO}/commit/${esc(e.git.commit)}">${esc(e.git.commit.slice(0, 7))}</a> <span>(${esc(e.git.source)})</span>` : `ไม่มี <span>(${esc(e.git.source)})</span>`;
    return `<div class="prov"><h4>${esc(e.labelTh)}</h4><dl>
<dt>รันเมื่อ · ran at</dt><dd>${esc(e.ranAt)}</dd>
<dt>ชุดข้อมูล · dataset</dt><dd><code>${esc(e.dataset)}</code></dd>
<dt>โค้ด · commit</dt><dd>${commit}</dd>
<dt>ผลดิบ · raw</dt><dd><a href="/${esc(e.raw.results)}">results.json</a>${e.raw.summary ? ` · <a href="/${esc(e.raw.summary)}">summary.md</a>` : ''}</dd>
<dt>รันซ้ำ · re-run</dt><dd><div class="cmd"><code>${esc(e.command)}</code><button type="button" class="copy" data-copy="${esc(e.command)}">คัดลอก</button></div></dd>
</dl></div>`;
  }).join('');
}

// Every Spark train run in order: what changed and what it did to the numbers.
export function historyHtml(history = []) {
  if (!history.length) return '<p class="muted">ยังไม่มีรัน Spark บนชุด train · no Spark train run yet</p>';
  const head = '<tr><th>รัน · run</th><th>ตั้งค่า · config</th><th>จับสแกม</th><th>สายจริงโดนตัด</th><th>สายจริงไม่แน่ใจ</th><th>p50 / p95</th><th>$ / สาย</th></tr>';
  const rows = history.map((h) => `<tr${h.partial ? ' class="muted"' : ''}><td>${esc(String(h.ranAt).slice(0, 16).replace('T', ' '))}${h.partial ? ` <span>partial ${h.progress.completed}/${h.progress.total}</span>` : ''}${h.git ? ` <span>${esc(h.git)}</span>` : ''}</td>
<td>${esc(h.config?.model || '')} <span>${esc(h.config?.effort || '')} · ${esc(h.config?.pipeline || '')}${h.config?.fewshotHash ? ` · few-shot ${esc(h.config.fewshotHash.slice(0, 7))}` : ''}</span></td>
<td class="num">${h.scamRecall.k}/${h.scamRecall.n}</td><td class="num">${h.falseAlarm.k}/${h.falseAlarm.n}</td><td class="num">${h.legitUnsure ? `${h.legitUnsure.k}/${h.legitUnsure.n}` : 'n/a'}</td>
<td class="num">${sec(h.latencyMs.p50)} / ${sec(h.latencyMs.p95)}</td><td class="num">${usd(h.usdPerCall)}</td></tr>`).join('');
  return `<table class="full hist">${head}${rows}</table>`;
}

// Real audio through the live pipeline (eval-results/realuse-*/results.json).
// Latency is shown exactly as measured, however bad.
export function realUseHtml(rows = []) {
  if (!rows.length) return '<p class="muted">ยังไม่มีผลทดสอบด้วยเสียงจริง · no real-audio run published yet</p>';
  const label = (r) => (r.engine === 'meta'
    ? `Meta${r.receptionist ? ' + receptionist' : ''}${r.current ? '' : ' <span class="cmp worse">build เก่า · superseded build</span>'}`
    : 'v1 (Jev + Gemini Live)');
  const head = '<tr><th>รัน · run</th><th>จับสแกม<span>scams flagged</span></th><th>ตัดก่อนจบคำขอ<span>stopped before the demand ended</span></th><th>สายจริงโดนวาง<span>wrong hang-ups</span></th><th>CER th / en</th><th>จบประโยค→ตัดสิน p50 / p95<span>end of speech → decision</span></th><th>เงียบนานสุด p50 / max<span>longest silence the caller hears</span></th><th>ไม่ตอบ / พูดทับ<span>unanswered / talk-over turns</span></th><th>$ / สาย</th></tr>';
  const body = rows.map((r) => `<tr${r.engine === 'meta' && !r.current ? ' class="muted"' : ''}><td>${label(r)} · ${esc(r.condition)}${r.speculate ? ' · speculative' : ''} <span>${esc(r.model || '')}${r.git ? ` · ${esc(r.git)}` : ''}</span></td>
<td class="num">${r.scams.k ?? 'n/a'}/${r.scams.n ?? 'n/a'}</td><td class="num">${r.protectedBeforeDemandEnds ?? 'n/a'}</td><td class="num">${r.wrongHangups ?? 'n/a'}</td>
<td class="num">${pct(r.cer.th)} / ${pct(r.cer.en)}</td><td class="num">${sec(r.eosToDecisionMs.p50)} / ${sec(r.eosToDecisionMs.p95)}</td><td class="num">${r.longestSilenceMs?.p50 == null ? 'n/a' : `${sec(r.longestSilenceMs.p50)} / ${sec(r.longestSilenceMs.max)}`}</td><td class="num">${r.unansweredTurns ?? 'n/a'} / ${r.talkOverTurns ?? 'n/a'}</td><td class="num">${usd(r.usdPerCall)}</td></tr>`).join('');
  return `<table class="full hist">${head}${body}</table>
<p class="foot">10 สายเดียวกันทั้งสองระบบ (ไทย 5 อังกฤษ 5) เสียงผู้โทรเป็น TTS ไม่ใช่คนจริง สตรีมแบบเวลาจริง · phone = 8 kHz + mu-law + เสียงรบกวน · The same 10 calls through both builds, TTS caller voices (not humans), streamed in real time; phone = 8 kHz band-limit, mu-law and line noise.</p>`;
}

// Runs stopped early and replaced by a complete run: listed, never scored.
export function stoppedHtml(stopped = []) {
  if (!stopped.length) return '';
  return `<p class="foot">รันที่หยุดกลางทางและถูกแทนด้วยรันเต็ม (ไม่นับเป็นผล) · Stopped early, replaced by a complete run, not scored: ${stopped.map((r) => `<code>${esc(r.dir)}</code> (${esc(r.set)} ${esc(r.backend)}, ${r.progress.completed}/${r.progress.total} calls, ${esc(r.git || '?')}, ${usd(r.usd)}) → <code>${esc(r.replacedBy)}</code>`).join(' · ')}</p>`;
}

const chip = (v) => `<span class="chip ${esc(String(v || '').toLowerCase())}">${esc(v)}</span>`;

export function caseHtml(c, set) {
  const final = (b) => {
    const v = c.verdicts[b];
    if (!v) return set.runs[b].status === 'done' ? '<span class="muted">—</span>' : '<span class="chip pend">pending</span>';
    return `${chip(v.final)}${v.unsafeMiss ? '<b class="flag">หลุด</b>' : v.ok ? '' : '<b class="x">✕</b>'}`;
  };
  const turns = c.callerTurns.map((text, i) => {
    const per = ORDER.map((b) => {
      const t = c.verdicts[b]?.trail?.find((x) => x.turn === i + 1);
      if (!c.verdicts[b]) return '';
      if (!t) return `<div class="tv"><em>${esc(set.runs[b].labelTh)}</em> <span class="muted">วางสายก่อนถึงประโยคนี้ · call ended</span></div>`;
      return `<div class="tv"><em>${esc(set.runs[b].labelTh)}</em> ${chip(t.verdict)} ${Math.round((t.confidence || 0) * 100)}% · ${esc(t.path)} · ${sec(t.latencyMs)} · ${esc(t.action)}${t.reason ? `<div class="rs">${esc(t.reason)}</div>` : ''}</div>`;
    }).join('');
    return `<li><div class="caller"><span>ผู้โทร ${i + 1}${i + 1 === c.expertTurn ? ' · <b>ผู้เชี่ยวชาญรู้ตรงนี้</b>' : ''}</span>${esc(text)}</div>${per}</li>`;
  }).join('');
  const wrong = ORDER.some((b) => c.verdicts[b] && !c.verdicts[b].ok);
  return `<details class="case" data-class="${esc(c.class)}" data-wrong="${wrong ? 1 : 0}" data-q="${esc(`${c.id} ${c.category}`.toLowerCase())}">
<summary><span class="cid">${esc(c.id)}<small>${esc(c.category)} · ${esc(c.lang)}</small></span><span class="col">${chip(c.class)}</span>${ORDER.map((b) => `<span class="col">${final(b)}</span>`).join('')}</summary>
<div class="case-b">${c.why ? `<p class="why">เหตุผลผู้เชี่ยวชาญ · expert: ${esc(c.why)}</p>` : ''}<ol class="turns">${turns}</ol></div>
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
    $('caseCount').textContent = `${shown.length} / ${all.length} สาย`;
    $('caseHead').innerHTML = `<span class="cid">เคส · case</span><span class="col">เฉลย</span>${ORDER.map((b) => `<span class="col">${esc(set.runs[b].labelTh)}</span>`).join('')}`;
    $('cases').innerHTML = all.length
      ? (shown.map((c) => caseHtml(c, set)).join('') || '<p class="muted pad">ไม่มีเคสตรงตัวกรอง · no cases match</p>')
      : '<p class="muted pad">ยังไม่มีรันในชุดนี้ · no run on this set yet — ดูคำสั่งด้านบน</p>';
  }

  function render() {
    const set = DATA.sets[SET];
    for (const btn of document.querySelectorAll('.seg button')) btn.setAttribute('aria-pressed', String(btn.dataset.set === SET));
    const pendingMeta = set.runs.spark.status !== 'done';
    $('banner').hidden = !pendingMeta;
    $('headlines').innerHTML = headlinesHtml(set);
    $('full').innerHTML = fullTableHtml(set);
    $('matrices').innerHTML = ORDER.map((b) => matrixHtml(set.runs[b])).join('');
    $('latency').innerHTML = latencyHtml(set);
    $('prov').innerHTML = provenanceHtml(set) + stoppedHtml(DATA.stoppedRuns || []);
    $('history').innerHTML = historyHtml(DATA.trainHistory || []);
    $('sealedRuns').innerHTML = (DATA.sealedRuns || []).length > 1
      ? `${historyHtml(DATA.sealedRuns)}<p class="foot">ชุด sealed รันสองครั้ง: ครั้งที่สองลงทะเบียนเหตุผลและเกณฑ์ตัดสินไว้ก่อนรัน (ตัวกระตุ้นคือเสียงจริง + ชุด train ไม่ได้ดู sealed) ตัวเลขหัวหน้าเพจคือรันล่าสุด = config ที่ใช้จริง · Sealed was run twice; the second run was pre-registered (trigger: real audio + train, sealed not consulted). Headline = the newest run, the config that ships.${DATA.sealedRerunNote ? ` <a href="/${esc(DATA.sealedRerunNote)}">Pre-registration</a>` : ''}</p>`
      : '';
    $('realuse').innerHTML = realUseHtml(DATA.realUse || []);
    $('setNote').textContent = `${set.labelEn} · ${set.file}`;
    renderCases();
  }

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button.copy');
    if (b) {
      const text = b.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = 'คัดลอกแล้ว';
      } catch {
        const code = b.previousElementSibling;
        const r = document.createRange();
        r.selectNodeContents(code);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        b.textContent = 'เลือกข้อความแล้ว กด Ctrl+C';
      }
      setTimeout(() => { b.textContent = 'คัดลอก'; }, 1800);
      return;
    }
    const seg = ev.target.closest('.seg button');
    if (seg && DATA) {
      SET = seg.dataset.set;
      render();
    }
  });
  for (const id of ['wrongOnly', 'classFilter']) $(id).addEventListener('change', () => DATA && renderCases());
  $('caseSearch').addEventListener('input', () => DATA && renderCases());

  fetch('/proof/data.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => {
      DATA = d;
      SET = d.defaultSet || 'train';
      for (const s of ['train', 'sealed']) {
        const btn = document.querySelector(`.seg button[data-set="${s}"] small`);
        const n = d.cases[s]?.length;
        if (btn) btn.textContent = n ? `${n} สาย` : 'ยังไม่รัน';
      }
      $('built').innerHTML = `สร้างจากผลรันเมื่อ ${esc(d.generatedAt)}${d.builtFromCommit ? ` · <a href="${REPO}/commit/${esc(d.builtFromCommit)}">${esc(d.builtFromCommit.slice(0, 7))}</a>` : ''} · ราคา ณ ${esc(d.pricing.checkedAt)} · $1 = ฿${esc(d.pricing.thbPerUsd)}`;
      $('defs').innerHTML = Object.entries(d.definitions).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
      document.body.classList.remove('loading');
      render();
    })
    .catch((e) => {
      $('loadErr').hidden = false;
      $('loadErr').textContent = `โหลดข้อมูลไม่ได้ (${e.message}) · could not load /proof/data.json`;
    });
}

if (typeof document !== 'undefined') boot();
