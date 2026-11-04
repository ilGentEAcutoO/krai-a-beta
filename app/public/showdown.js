'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = (th, en) => ((window.kraiLang ? window.kraiLang() : 'en') === 'th' ? th : en);
const THAI = /[฀-๿]/;
let DATA = null;

function badge(text, cls) { return `<span class="badge ${cls}">${esc(text)}</span>`; }
function clsBadge(v) { return v === 'SCAM' ? badge(v, 'bad') : v === 'LEGIT' ? badge(v, 'ok') : badge(v, 'warn'); }

async function loadRun(url) {
  $('runMeta').textContent = L('กำลังโหลดผลรัน…', 'Loading the run…');
  for (const id of ['headlineCard', 'matrixCard', 'callsCard', 'missCard']) $(id).hidden = true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
    render();
  } catch (e) {
    $('runMeta').textContent = L('โหลดผลรันไม่ได้ (' + e.message + ') เลือกไฟล์ results.json ด้านล่าง หรือตรวจว่า deploy มีโฟลเดอร์ eval/', 'Could not load the run (' + e.message + '). Open a results.json below, or check the deploy includes eval/.');
  }
}

function render() {
  const o = DATA, m = o.metrics;
  $('runMeta').textContent = L(`รัน ${o.ranAt} · ${o.dataset.file} · ${o.dataset.calls} สาย · backend ${o.backend} · ใช้เงิน $${o.spend.usd.toFixed(4)}`, `Run ${o.ranAt} · ${o.dataset.file} · ${o.dataset.calls} calls · backend ${o.backend} · spent $${o.spend.usd.toFixed(4)}`);
  const p100 = (x) => (x == null ? 'n/a' : (Math.round(x * 1000) / 10) + '%');
  const sec = (ms) => (ms == null ? 'n/a' : ((ms / 1000).toFixed(ms < 1000 ? 2 : 1) + ' s'));
  $('stats').innerHTML = [
    [L('จับสแกมได้', 'Scam recall'), p100(m.scam.recall), `${m.confusion.SCAM.SCAM}/${m.byClass.SCAM}`],
    [L('สายจริงโดนตัดว่าสแกม', 'Real judged SCAM'), p100(m.legit.falseScamAlarm), `${m.confusion.LEGIT.SCAM}/${m.byClass.LEGIT}`],
    [L('ตรงคลาส', 'Accuracy'), p100(m.accuracy), `safe ${p100(m.safeAccuracy)}`],
    [L('เวลา/เทิร์น (มัธยฐาน)', 'Time per turn (median)'), sec(m.latency.judgeMedianMs), `p90 ${sec(m.latency.judgeP90Ms)}`],
    [L('ค่าตัวตัดสิน/สาย', 'Judge cost per call'), L('฿' + o.costPerCall.totalThb.toFixed(2), `$${o.costPerCall.totalUsd.toFixed(5)}`), L(`$${o.costPerCall.totalUsd.toFixed(5)}`, 'metered tokens')],
    [L('เคสทายผิด', 'Misses'), String(o.misses.length), L(`${o.metrics.turns} เทิร์นทั้งหมด`, `${o.metrics.turns} turns in all`)],
  ].map(([l, n, s]) => `<div class="stat"><div class="l">${esc(l)}</div><div class="n">${esc(n)}</div><div class="s">${esc(s)}</div></div>`).join('');
  $('headline').textContent = (THAI.test(o.headline || '') && L(0, 1))
    ? `Scam recall ${p100(m.scam.recall)} (${m.confusion.SCAM.SCAM}/${m.byClass.SCAM}) · real callers judged SCAM ${m.confusion.LEGIT.SCAM}/${m.byClass.LEGIT} · exact ${p100(m.accuracy)}`
    : o.headline;
  const c = m.confusion, cl = ['SCAM', 'LEGIT', 'UNSURE'];
  $('matrix').innerHTML = '<div class="tbl"><table><tr><th></th><th>SCAM</th><th>LEGIT</th><th>UNSURE</th></tr>'
    + cl.map((e) => `<tr><th>${e}</th>${cl.map((p) => `<td><b>${c[e][p]}</b></td>`).join('')}</tr>`).join('') + '</table></div>';
  renderCalls();
  $('misses').innerHTML = o.misses.length ? `<div class="tbl"><table><tr><th>${L('เคส', 'Case')}</th><th>${L('เฉลย → ทาย', 'Expected → judged')}</th><th>trail</th><th>${L('เหตุ', 'Reason')}</th></tr>` + o.misses.map((x) =>
    `<tr><td><code>${esc(x.id)}</code></td><td>${clsBadge(x.expected)} → ${clsBadge(x.got)}${x.safe ? ' ' + badge('safe', 'warn') : ''}</td><td class="mut">${esc(x.trail)}</td><td class="mut">${esc(x.reasonEn || '')}</td></tr>`).join('') + '</table></div>'
    : `<p class="note">${L('ไม่มี ทายตรงทุกเคส', 'None: every case was judged right')}</p>`;
  for (const id of ['headlineCard', 'matrixCard', 'callsCard', 'missCard']) $(id).hidden = false;
}

function renderCalls() {
  const o = DATA, cf = $('classFilter').value, mo = $('missOnly').checked;
  const rows = o.runs[0].results.filter((r) => (!cf || r.class === cf) && (!mo || !r.ok));
  $('callCount').textContent = L(`แสดง ${rows.length}/${o.runs[0].results.length} สาย`, `Showing ${rows.length} of ${o.runs[0].results.length} calls`);
  if (!rows.length) { $('calls').innerHTML = `<p class="note">${L('ไม่มีสายตรงเงื่อนไข', 'No calls match the filters')}</p>`; return; }
  $('calls').innerHTML = `<div class="tbl"><table><tr><th>${L('เคส', 'Case')}</th><th>${L('เฉลย → ทาย', 'Expected → judged')}</th><th>${L('จบแบบ', 'Ended by')}</th><th>trail</th></tr>` + rows.map((r) =>
    `<tr><td><code>${esc(r.id)}</code><br><span class="mut">${esc(r.category)} · ${esc(r.lang)}</span></td>`
    + `<td>${clsBadge(r.class)} → ${clsBadge(r.final)}<br>${r.ok ? badge(L('ตรง', 'right'), 'ok') : r.safe ? badge(L('พลาดแต่ปลอดภัย', 'wrong but safe'), 'warn') : badge(L('พลาด', 'wrong'), 'bad')}</td>`
    + `<td class="mut">${esc(r.endedBy)}<br>${r.turnsPlayed} ${L('เทิร์น', 'turns')}</td>`
    + `<td><span class="mut">${esc(r.turns.map((t) => `${t.verdict}@${t.confidence}/${t.path}`).join(' > '))}</span>`
    + `<details class="trail"><summary>${L('ดูบทสนทนา', 'Show the conversation')}</summary>${L(0, 1) && r.turns.some((t) => THAI.test(`${t.caller} ${t.ai}`)) ? `<p class="note">This call is in Thai. Switch the page to Thai (top right) to read it word for word.</p>` : r.turns.map((t) =>
      `<div class="turn"><span class="who">${L('ผู้โทร', 'Caller')}:</span> ${esc(t.caller)}<br><span class="who">→ ${esc(t.verdict)} @${esc(t.confidence)} · ${esc(t.path)} · ${esc(t.latencyMs)}ms</span><br><span class="who">AI:</span> ${esc(t.ai)}</div>`).join('')}</details></td></tr>`).join('') + '</table></div>';
}

// ---- red-team author box: client-side schema check + download ----
function checkCase(c, i) {
  const errs = [];
  const line = L('บรรทัด', 'Line');
  const need = ['id', 'class', 'lang', 'category', 'expertTurn', 'why', 'turns', 'tags', 'source'];
  for (const k of need) if (!(k in c)) errs.push(`${line} ${i}: ${L('ขาดฟิลด์', 'missing field')} ${k}`);
  if (c.class && !['SCAM', 'LEGIT', 'UNSURE'].includes(c.class)) errs.push(`${line} ${i}: ${L('class ต้องเป็น SCAM/LEGIT/UNSURE', 'class must be SCAM/LEGIT/UNSURE')}`);
  if (c.lang && !['th', 'en'].includes(c.lang)) errs.push(`${line} ${i}: ${L('lang ต้องเป็น th/en', 'lang must be th/en')}`);
  if (c.turns && (!Array.isArray(c.turns) || !c.turns.length || !c.turns.every((t) => typeof t === 'string' && t.trim()))) errs.push(`${line} ${i}: ${L('turns ต้องเป็น array ข้อความ ไม่ว่าง', 'turns must be a non-empty array of strings')}`);
  if (c.turns && (c.expertTurn < 1 || c.expertTurn > c.turns.length)) errs.push(`${line} ${i}: ${L('expertTurn ต้องอยู่', 'expertTurn must be')} 1..${c.turns.length}`);
  if (c.tags && !Array.isArray(c.tags)) errs.push(`${line} ${i}: ${L('tags ต้องเป็น array', 'tags must be an array')}`);
  if (c.alsoOk && (!Array.isArray(c.alsoOk) || !c.alsoOk.every((v) => ['SCAM', 'LEGIT', 'UNSURE'].includes(v)))) errs.push(`${line} ${i}: ${L('alsoOk ไม่ถูกต้อง', 'alsoOk is invalid')}`);
  return errs;
}
$('rtCheck').onclick = () => {
  $('rtErr').textContent = ''; $('rtOk').textContent = ''; $('rtDl').disabled = true;
  const lines = $('rtInput').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { $('rtErr').textContent = L('ยังไม่มีเคส วาง JSONL ก่อน', 'No cases yet. Paste JSONL first.'); return; }
  const errs = [], ids = new Set();
  lines.forEach((l, k) => {
    try {
      const c = JSON.parse(l);
      errs.push(...checkCase(c, k + 1));
      if (ids.has(c.id)) errs.push(`${L('บรรทัด', 'Line')} ${k + 1}: ${L('id ซ้ำ', 'duplicate id')} (${c.id})`);
      ids.add(c.id);
    } catch { errs.push(`${L('บรรทัด', 'Line')} ${k + 1}: ${L('JSON ไม่ถูกต้อง', 'invalid JSON')}`); }
  });
  if (errs.length) { $('rtErr').textContent = errs.join('\n'); return; }
  $('rtOk').textContent = L(`ผ่าน ${lines.length} เคส โหลดไฟล์แล้วส่งรวมกอง sealed ได้เลย`, `${lines.length} cases passed. Download the file and submit it to the sealed set.`);
  $('rtDl').disabled = false;
};
$('rtDl').onclick = () => {
  const blob = new Blob([$('rtInput').value.split('\n').map((l) => l.trim()).filter(Boolean).join('\n') + '\n'], { type: 'application/jsonl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'redteam-' + new Date().toISOString().slice(0, 10) + '.jsonl';
  a.click(); URL.revokeObjectURL(a.href);
};

$('runSel').onchange = (e) => loadRun(e.target.value);
$('filePick').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { try { DATA = JSON.parse(rd.result); render(); } catch { $('runMeta').textContent = L('ไฟล์นี้ไม่ใช่ results.json ที่ถูกต้อง', 'This file is not a valid results.json'); } };
  rd.readAsText(f);
};
$('classFilter').onchange = renderCalls;
$('missOnly').onchange = renderCalls;
document.addEventListener('krai:lang', () => { if (DATA) render(); });
loadRun($('runSel').value);
