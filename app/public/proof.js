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

// The three numbers a judge reads first. value() returns {big, small}.
export const HEADLINES = [
  {
    key: 'unsafe',
    th: 'สายสแกมที่หลุดว่าปลอดภัย',
    en: 'Unsafe misses: SCAM judged LEGIT (lower is better)',
    value: (m) => ({ big: String(m.unsafeMiss.k), small: `จาก ${m.unsafeMiss.n} สายสแกม · of ${m.unsafeMiss.n} scam calls` }),
  },
  {
    key: 'accuracy',
    th: 'ตัดสินตรงคลาส',
    en: 'Accuracy, exact class',
    value: (m) => ({ big: pct(m.accuracy.rate), small: `${m.accuracy.k}/${m.accuracy.n} สาย · calls` }),
  },
  {
    key: 'cost',
    th: 'ค่า AI ต่อ 1,000 สาย',
    en: 'Judge cost per 1,000 calls',
    value: (m) => ({ big: usd(m.cost.usdPer1000), small: `≈ ฿${m.cost.thbPer1000 == null ? 'n/a' : m.cost.thbPer1000.toFixed(2)} · ${usd(m.cost.usdPerCall)} ต่อสาย / per call` }),
  },
];

export function pendingHtml(entry, { compact = false } = {}) {
  return `<div class="pending">
<div class="pending-t">รอรันจริง <span>/ pending live run</span></div>
${compact ? '' : `<p class="pending-why">${entry.backend === 'spark' ? 'ยังไม่มีผลวัดจาก Meta — ไม่มีการประมาณแทน · No Meta measurement yet; nothing is estimated.' : 'ยังไม่มีผลวัดชุดนี้ · Not measured on this set yet.'}${entry.reason && entry.reason !== 'not-run' ? ` (${esc(entry.reason)})` : ''}</p>`}
<div class="cmd"><code>${esc(entry.command)}</code><button type="button" class="copy" data-copy="${esc(entry.command)}">คัดลอก</button></div>
${compact ? '' : `<p class="pending-needs">ต้องมี env · needs: <code>${esc(entry.needs)}</code></p>`}
</div>`;
}

export function headlineCell(entry, h) {
  const head = `<div class="who ${entry.role}"><b>${esc(entry.labelTh)}</b><span>${esc(entry.role === 'meta' ? 'Meta model' : 'baseline')}</span></div>`;
  if (entry.status !== 'done') return `<div class="cell is-pending">${head}${pendingHtml(entry, { compact: true })}</div>`;
  const v = h.value(entry.metrics);
  const alarm = h.key === 'unsafe' && entry.metrics.unsafeMiss.k > 0 ? ' is-bad' : '';
  return `<div class="cell${alarm}">${head}<div class="big">${esc(v.big)}</div><div class="small">${esc(v.small)}</div></div>`;
}

export function headlinesHtml(set) {
  return HEADLINES.map((h) => `<article class="hl">
<h3>${esc(h.th)}<small>${esc(h.en)}</small></h3>
<div class="pair">${ORDER.map((b) => headlineCell(set.runs[b], h)).join('')}</div>
</article>`).join('');
}

const ROWS = [
  ['SCAM recall', 'จับสแกมได้', (m) => `${pct(m.scamRecall.rate)} <span>(${m.scamRecall.k}/${m.scamRecall.n})</span>`],
  ['Unsafe misses', 'สแกมหลุดเป็นปลอดภัย', (m) => `${m.unsafeMiss.k}${m.unsafeMiss.ids.length ? ` <span>${esc(m.unsafeMiss.ids.join(', '))}</span>` : ''}`],
  ['False alarm', 'สายจริงโดนตัดว่าสแกม', (m) => `${pct(m.falseAlarm.rate)} <span>(${m.falseAlarm.k}/${m.falseAlarm.n})</span>`],
  ['Accuracy', 'ตรงคลาส', (m) => `${pct(m.accuracy.rate)} <span>(${m.accuracy.k}/${m.accuracy.n})</span>`],
  ['Latency p50 / p95', 'เวลาตัดสินต่อประโยค', (m) => `${sec(m.latencyMs.p50)} / ${sec(m.latencyMs.p95)} <span>(${m.latencyMs.turns} turns)</span>`],
  ['Turns to verdict', 'ประโยคจนตัดสินถูก (มัธยฐาน) เทียบผู้เชี่ยวชาญ', (m) => `${m.turnsToVerdict.medianTurnsToCorrect ?? 'n/a'} vs ${m.turnsToVerdict.medianExpertTurn ?? 'n/a'} <span>· ทันผู้เชี่ยวชาญ ${m.turnsToVerdict.atOrBeforeExpert}/${m.turnsToVerdict.correct} · SCAM ${m.turnsToVerdict.scamAtOrBeforeExpert.k}/${m.turnsToVerdict.scamAtOrBeforeExpert.n}</span>`],
  ['Cost / call', 'ค่า AI ต่อสาย', (m) => `${usd(m.cost.usdPerCall)} <span>· ${usd(m.cost.usdPer1000)} / 1,000</span>`],
  ['Calls / turns', 'จำนวนสาย / ประโยค', (m) => `${m.n} / ${m.turns}`],
  ['Model', 'โมเดล', (m) => `${esc(m.models.join(', ') || 'n/a')} <span>${esc(m.engines || '')}</span>`],
];

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
    return `<div class="lat"><div class="lat-l">${esc(e.labelTh)}</div>
<div class="bar"><i class="p95 ${e.role}" style="width:${(100 * p95) / max}%"></i><i class="p50 ${e.role}" style="width:${(100 * p50) / max}%"></i></div>
<div class="lat-n">p50 <b>${sec(p50)}</b> · p95 <b>${sec(p95)}</b></div></div>`;
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
    $('prov').innerHTML = provenanceHtml(set);
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
