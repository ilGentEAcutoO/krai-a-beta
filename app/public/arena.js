// /arena replay page (B22): static, no model calls. Everything shown comes
// from /arena/data.json, built by scripts/build-arena.mjs from an arena run.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const pct = (n, d) => (d ? `${Math.round((1000 * n) / d) / 10}%` : '—');

const OUTCOME = {
  blocked: { th: 'บล็อก', en: 'Block' },
  escalated: { th: 'ฝากข้อความ ให้เจ้าของตัดสิน', en: 'Escalate' },
  allowed: { th: 'ปิดเป็นสายจริง', en: 'Allow' },
};
const ACTION = { hangup: 'วางสาย / hang up', 'take-message': 'ฝากข้อความ / take message', continue: 'ถามต่อ / keep asking' };
const KIND = {
  backchannel: 'KRAI-A', askWho: 'KRAI-A · ถามชื่อ', askCallback: 'KRAI-A · ขอเบอร์ทางการ', askPurpose: 'KRAI-A · ถามธุระ',
  takeMessage: 'KRAI-A · รับฝาก', ack: 'KRAI-A', closeScam: 'KRAI-A · ปิดสาย (มิจ)', close: 'KRAI-A · ปิดสาย',
  disclosure: 'KRAI-A · แจ้งเปิดสายซ้ำในภาษาผู้โทร / disclosure in the caller\'s language',
  trapFiller: 'KRAI-A · กับดัก', trap: 'KRAI-A · กับดัก (Spark 1.3)', 'trap-canned': 'KRAI-A · กับดัก (ประโยคสำรอง)', 'trap-closing': 'KRAI-A · กับดัก ปิดสาย',
};
const GENDER = { f: '♀', m: '♂' };
const CLS_TH = { scam: 'มิจ', legit: 'สายจริง', edge: 'ไม่ใช่มิจ' };
const CALLER_TH = { scam: 'AI มิจ', legit: 'ผู้โทร', edge: 'ผู้โทร' };
// B25 expected behaviours (scripts/arena-personas/edge.json expectedSet + built-ins)
const EXPECT_TH = {
  HELP_MESSAGE: ['ช่วยรับฝากข้อความ ไม่บล็อก', 'take a message, never block'],
  URGENT_MESSAGE: ['เรื่องด่วนจริง ต้องรับฝาก ไม่บล็อก', 'real emergency: message, never block'],
  POLITE_CLOSE_NUISANCE: ['ปิดสายสุภาพเอง ไม่ตีเป็นมิจ', 'close politely, never SCAM'],
  HARASSMENT_RECORD: ['ปิดสายสุภาพ บันทึกเป็นการคุกคาม ไม่ตีเป็นมิจ', 'close politely, record harassment, not SCAM'],
  DECLINE_SALES: ['ปฏิเสธสุภาพ/รับฝาก ไม่ตีเป็นมิจ', 'decline or take a note, not SCAM'],
  SCAM_BLOCK: ['บล็อก', 'block'],
  TRAP_OK: ['บล็อกหรือเปิดกับดัก', 'block or trap'],
  help: ['ช่วยรับฝากข้อความ ไม่บล็อก', 'take a message, never block'],
  nuisance: ['ปิดสายสุภาพเอง ไม่ตีเป็นมิจ', 'close politely, never SCAM'],
  'not-scam': ['ไม่ตีเป็นมิจ', 'not SCAM'],
  harass: ['ปิดสายสุภาพ ไม่ตีเป็นมิจ', 'close politely, not SCAM'],
  scam: ['บล็อก', 'block'],
};

let data = null;
let cur = null; // { m, step, timer }
let speed = 1;

function scoreCell(label, en, big, sub, cls = '') {
  const c = el('div', `cell ${cls}`);
  const lab = el('div', 'lab', label);
  lab.append(el('span', null, en));
  const b = el('div', 'big', big);
  if (sub) b.append(' ', el('small', null, sub));
  c.append(lab, b);
  return c;
}

function renderScore() {
  const a = data.totals.all;
  const box = $('score');
  box.innerHTML = '';
  box.append(
    scoreCell('เกมทั้งหมด', 'games played', String(a.calls), `มิจ ${a.scam.n} · จริง ${a.legit.n}`),
    scoreCell('มิจที่ถูกบล็อก', 'scam calls blocked', pct(a.scam.blocked, a.scam.n), `${a.scam.blocked}/${a.scam.n}`, 'good'),
    scoreCell('มิจที่หลุดเป็น "สายจริง"', 'scam closed as legit (worst miss)', String(a.scam.allowed), `อีก ${a.scam.escalated} สายฝากให้เจ้าของตัดสิน`, a.scam.allowed ? 'bad' : 'good'),
    scoreCell('สายจริงที่โดนวางผิด', 'legit callers wrongly blocked', String(a.legit.blocked), `/${a.legit.n}`, a.legit.blocked ? 'bad' : 'good'),
  );
  const t = el('table');
  t.innerHTML = '<thead><tr><th>ชุด / split</th><th>เกม</th><th>มิจ บล็อก</th><th>มิจ ฝากข้อความ</th><th>มิจ หลุดเป็นสายจริง</th><th>สายจริง ผ่าน</th><th>สายจริง ฝากข้อความ</th><th>สายจริง โดนบล็อก</th><th>เทิร์นที่บล็อก (มัธยฐาน)</th></tr></thead>';
  const tb = el('tbody');
  const row = (name, s) => {
    const tr = el('tr');
    for (const v of [name, s.calls, `${s.scam.blocked}/${s.scam.n}`, s.scam.escalated, s.scam.allowed, `${s.legit.allowed}/${s.legit.n}`, s.legit.escalated, s.legit.blocked, s.scam.medianTurnToBlock ?? '—']) tr.append(el('td', null, String(v)));
    tb.append(tr);
  };
  row('ทั้งหมด / all', a);
  row('train 70%', data.totals.train);
  row('holdout 30%', data.totals.holdout);
  if (data.after?.totals?.all) row(`หลังแก้ / after (${data.after.mode || ''})`, data.after.totals.all);
  t.append(tb);
  $('splitTbl').replaceChildren(t);
  const r = data.run;
  $('runNote').textContent = `ผู้โทร ${r.personaModel} (effort ${r.personaEffort}) · ผู้ตัดสิน ${r.verdictModel} · ${data.personas.scam} บทมิจ + ${data.personas.legit} บทสายจริง · สูงสุด ${r.maxTurns} เทิร์น · ดักมิจที่ถูกกับดัก ${a.trapped} สาย เก็บข้อมูลได้ ${a.intelItems} รายการ`
    + (r.spentUsd != null ? ` · ค่าใช้จ่ายทั้งรอบ $${Number(r.spentUsd).toFixed(2)}` : '')
    + (r.git ? ` · code ${r.git}` : '');
  $('srcNote').textContent = data.source;
}

function renderEdge() {
  const e = data.edge;
  const sec = $('edgeSec');
  if (!e) return;
  sec.hidden = false;
  $('edgeHead').textContent = `${e.met}/${e.calls} สายทำตามที่ควร (${pct(e.met, e.calls)}) · ${e.calls} calls, ${e.met} met the expected behaviour`;
  const t = el('table');
  t.innerHTML = '<thead><tr><th>ควรทำ / expected</th><th>สาย</th><th>ตรง</th><th>%</th></tr></thead>';
  const tb = el('tbody');
  for (const [k, v] of Object.entries(e.byExpect).sort((a, b) => b[1].n - a[1].n)) {
    const tr = el('tr');
    const lab = EXPECT_TH[k] || [k, k];
    for (const x of [`${lab[0]} · ${lab[1]}`, v.n, v.met, pct(v.met, v.n)]) tr.append(el('td', null, String(x)));
    tb.append(tr);
  }
  t.append(tb);
  $('edgeTbl').replaceChildren(t);
  const f = el('table');
  f.innerHTML = '<thead><tr><th>กลุ่ม / family</th><th>สาย</th><th>ตรง</th><th>%</th></tr></thead>';
  const fb = el('tbody');
  for (const [k, v] of Object.entries(e.families || {}).sort()) {
    const tr = el('tr');
    for (const x of [k, v.n, v.met, pct(v.met, v.n)]) tr.append(el('td', null, String(x)));
    fb.append(tr);
  }
  f.append(fb);
  $('famTbl').replaceChildren(f);
  const ul = $('edgeFails');
  ul.replaceChildren(...(e.failures || []).map((x) => {
    const exp = EXPECT_TH[x.expect] || [x.expect, x.expect];
    return el('li', null, `${x.id} (${x.family || 'edge'}): ควร ${exp[0]} · ได้ ${OUTCOME[x.outcome]?.th || x.outcome}${x.violations?.length ? ` · ${x.violations.join(', ')}` : ''}`);
  }));
  if (!ul.childNodes.length) ul.append(el('li', null, 'ไม่มี / none'));
  const src = Object.entries(e.bySource || {}).map(([k, n]) => `${k} (${n})`).join(' + ');
  $('edgeNote').textContent = `${e.personas} บทจากคลังสถานการณ์ เล่นบทละ 1 สาย · ข้อมูลจาก ${src} (สายที่เล่นซ้ำหลังแก้ใช้ผลรอบหลัง) · URGENT ผ่านเมื่อไม่ถูกบล็อกและรายงานติดป้าย "ด่วน" · HARASSMENT ผ่านเมื่อปิดสายเองและรายงานบันทึกว่าเป็นการคุกคาม`;
}

// B27: per caller language (expected vs got), with the Thai-only before run
function renderLang() {
  const r = data.regional;
  if (!r) return;
  $('langSec').hidden = false;
  const a = r.after;
  const tot = Object.values(a).reduce((s, e) => ({ n: s.n + e.n, met: s.met + e.met }), { n: 0, met: 0 });
  $('langHead').textContent = `${tot.met}/${tot.n} สายทำตามที่ควร (${pct(tot.met, tot.n)}) · ${tot.n} regional calls, ${tot.met} met the expected behaviour · ไม่มีสายมิจที่ถูกปิดเป็นสายจริง / no scam closed as legit`;
  const t = el('table');
  t.innerHTML = '<thead><tr><th>ภาษา / language</th><th>สาย</th><th>ตรงที่ควร / met</th><th>บล็อกมิจ / scams blocked</th><th>สายจริงโดนตีเป็นมิจ / non-scam flagged SCAM</th><th>ฉุกเฉินผ่าน / emergencies</th><th>ผู้โทรบอกว่าฟังไม่เข้าใจ / said they did not understand</th></tr></thead>';
  const tb = el('tbody');
  const row = (label, e, cls) => {
    const tr = el('tr', cls);
    const nonScam = e.legit.n + e.nuisance.n;
    for (const x of [label, e.n, `${e.met} (${pct(e.met, e.n)})`, `${e.scam.blocked}/${e.scam.n}`, `${e.legit.falseScam + e.nuisance.falseScam}/${nonScam}`, `${e.urgent.met}/${e.urgent.n}`, `${e.notUnderstood}/${e.n}`]) tr.append(el('td', null, String(x)));
    tb.append(tr);
  };
  if (r.before?.en) row('English · ก่อนแก้ (ตอบเป็นไทยอย่างเดียว) / before: Thai-only replies', r.before.en, 'muted');
  for (const k of r.order) row(`${a[k].name}${['en', 'zh'].includes(k) ? '' : ' · probe'}`, a[k]);
  t.append(tb);
  $('langTbl').replaceChildren(t);
  const ul = $('langFails');
  ul.replaceChildren(...(r.failures || []).map((x) => {
    const exp = EXPECT_TH[x.expect] || [x.expect, x.expect];
    return el('li', null, `${x.lang?.toUpperCase() || ''} ${x.id}: ควร ${exp[0]} · ได้ ${OUTCOME[x.outcome]?.th || x.outcome}${x.violations?.length ? ` · ${x.violations.join(', ')}` : ''}`);
  }));
  if (!ul.childNodes.length) ul.append(el('li', null, 'ไม่มี / none'));
  $('langNote').textContent = `ข้อมูลจาก ${r.sources.join(' + ')} · ภาษาเลือกจากตัวอักษรที่ผู้โทรพูด (โค้ด ไม่ใช่โมเดล) แล้วคงไว้ทั้งสาย · ประโยคเปิดสายแรกยังเป็นภาษาไทยเพราะยังไม่รู้ภาษาผู้โทร จึงนับ "ฟังไม่เข้าใจ" หลังคำตอบแรกเท่านั้น (จับคำภาษาอังกฤษ/จีน) · probe = 15 สายต่อภาษา เล็กและหยาบ · The opening line is Thai for every call (nothing is known yet), so "did not understand" counts only after the first reply (English/Mandarin phrases). Probes are 15 calls per language: small, indicative only.`;
}

function renderList() {
  const list = $('matchList');
  list.innerHTML = '';
  for (const m of data.matches) {
    const b = el('button');
    b.type = 'button';
    b.dataset.id = m.id;
    b.setAttribute('aria-pressed', 'false');
    const o = OUTCOME[m.outcome];
    const scamExpect = m.expect === 'SCAM_BLOCK' || m.expect === 'TRAP_OK';
    const t = el('span', 't', `${scamExpect ? CLS_TH.scam : CLS_TH[m.cls] || m.cls} ${GENDER[m.gender] || ''} · ${m.family || m.tactic}${m.lang && !['th', 'mixed'].includes(m.lang) ? ` · ${m.lang.toUpperCase()}` : ''}`);
    const chip = el('span', `chip ${m.correct ? 'allow' : 'block'}`, m.correct ? 'ระบบชนะ' : 'ระบบพลาด');
    t.append(' ', chip);
    b.append(t, el('span', 'w', m.why || m.persona), el('span', 'w', `${o.en} · ${m.turns.length} เทิร์น`));
    b.addEventListener('click', () => load(m.id, true));
    list.append(b);
  }
}

function bubble(cls, label, text) {
  const m = el('div', `msg ${cls}`);
  m.append(el('div', 'lbl', label), el('div', 'b', text));
  return m;
}

function turnNodes(m, t) {
  const nodes = [];
  const c = bubble('caller', `${CALLER_TH[m.cls] || 'ผู้โทร'} ${GENDER[m.gender] || ''} · เทิร์น ${t.turn}`, t.caller);
  const chips = el('div', 'chips');
  for (const ch of t.chips) {
    const s = el('span', `chip ${ch.k === 'wonder' ? 'wonder' : ch.tier}`, ch.text);
    if (ch.rule) s.title = `policy rule: ${ch.rule}`;
    chips.append(s);
  }
  if (t.tactic) chips.append(el('span', 'chip act', t.tactic));
  if (t.action) chips.append(el('span', 'chip act', `→ ${ACTION[t.action] || t.action}`));
  if (chips.childNodes.length) c.append(chips);
  nodes.push(c);
  for (const r of t.reply) {
    const cls = /^close/.test(r.kind) || r.kind === 'trap-closing' ? 'rx close' : /^trap/.test(r.kind) ? 'rx trap' : 'rx';
    nodes.push(bubble(cls, KIND[r.kind] || 'KRAI-A', r.text));
  }
  return nodes;
}

function endBox(m) {
  const won = m.correct;
  const box = el('div', `end ${won ? 'won' : 'lost'}`);
  const o = OUTCOME[m.outcome];
  const exp = m.expect ? EXPECT_TH[m.expect] : null;
  const head = exp
    ? `${won ? 'ทำตามที่ควร' : 'ไม่ตรงที่ควร'}: ควร "${exp[0]}" · ได้ "${o.th}"`
    : won
    ? (m.cls === 'scam' ? `ระบบชนะ: บล็อกได้ที่เทิร์น ${m.firstCorrectTurn}` : 'ระบบชนะ: สายจริงได้ฝากข้อความตามปกติ')
    : (m.cls === 'scam' ? `ระบบพลาด: มิจจบสายแบบ "${o.th}"` : `ระบบพลาด: สายจริงจบแบบ "${o.th}"`);
  box.append(`${head} · ${o.en}`);
  if (m.afterFix) {
    const f = OUTCOME[m.afterFix.outcome];
    const how = m.afterFix.replay ? ['เล่นคำพูดเดิมของผู้โทรซ้ำ', 'same caller lines replayed'] : ['ให้ AI บทเดิมโทรมาใหม่', 'same persona called again'];
    box.append(el('div', 'small', `หลังแก้ (B19) ${how[0]}: ${m.afterFix.correct ? 'ระบบชนะ' : 'ยังพลาด'} — ${f.th} · after the fix, ${how[1]}: ${f.en}`));
  }
  if (m.intel?.length) {
    const ul = el('ul');
    for (const i of m.intel) ul.append(el('li', null, `${i.type}: ${i.value}`));
    box.append(el('div', 'small', 'ข้อมูลที่กับดักเก็บได้ (แต่งขึ้นโดย AI) / intel captured by the trap:'), ul);
  }
  return box;
}

function stop() {
  if (cur?.timer) clearTimeout(cur.timer);
  if (cur) cur.timer = null;
  $('playBtn').setAttribute('aria-pressed', 'false');
  $('playBtn').textContent = '▶ เล่น / Play';
}

function step() {
  if (!cur) return false;
  const feed = $('feed');
  const { m } = cur;
  if (cur.step >= cur.queue.length) {
    if (!$('endBox').firstChild) $('endBox').append(endBox(m));
    return false;
  }
  feed.append(cur.queue[cur.step++]);
  feed.scrollTop = feed.scrollHeight;
  if (cur.step >= cur.queue.length) $('endBox').replaceChildren(endBox(m));
  return true;
}

function play() {
  if (!cur) return;
  // Bring the whole stage on screen (the feed then scrolls itself to the newest bubble).
  const stage = document.querySelector('.stage');
  const r = stage.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) stage.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('playBtn').setAttribute('aria-pressed', 'true');
  $('playBtn').textContent = '❚❚ หยุด / Pause';
  const tick = () => {
    if (!step()) return stop();
    cur.timer = setTimeout(tick, 1500 / speed);
  };
  tick();
}

function load(id, autoplay = false) {
  stop();
  const m = data.matches.find((x) => x.id === id) || data.matches[0];
  if (!m) return;
  for (const b of $('matchList').children) b.setAttribute('aria-pressed', String(b.dataset.id === m.id));
  const queue = [bubble('rx sys', 'KRAI-A · เปิดสาย (ทุกสาย)', m.opening)];
  for (const t of m.turns) queue.push(...turnNodes(m, t));
  cur = { m, step: 0, queue, timer: null };
  const who = $('matchWho');
  who.textContent = `${m.cls === 'scam' || m.expect === 'SCAM_BLOCK' || m.expect === 'TRAP_OK' ? 'AI มิจ' : m.cls === 'edge' ? 'ผู้โทร (ไม่ใช่มิจ)' : 'ผู้โทรจริง'} ${GENDER[m.gender] || ''} · ${m.persona}`;
  who.append(el('span', null, `${m.id} · ภาษา ${m.lang} · โหมด ${m.scamPolicy === 'trap' ? 'กับดัก' : 'วางสายสุภาพ'}`));
  $('feed').replaceChildren();
  $('endBox').replaceChildren();
  const u = new URL(location.href);
  u.searchParams.set('m', m.id);
  history.replaceState(null, '', u);
  if (autoplay) play();
  else step();
}

$('playBtn').addEventListener('click', () => (cur?.timer ? stop() : (cur && cur.step >= cur.queue.length ? load(cur.m.id, true) : play())));
$('stepBtn').addEventListener('click', () => { stop(); step(); });
$('allBtn').addEventListener('click', () => { stop(); while (step()); });
$('speedBtn').addEventListener('click', () => {
  speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
  $('speedBtn').textContent = `${speed}×`;
});

fetch('/arena/data.json')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((d) => {
    data = d;
    renderScore();
    renderEdge();
    renderLang();
    renderList();
    load(new URL(location.href).searchParams.get('m'));
  })
  .catch((e) => {
    $('score').replaceChildren(el('div', 'empty', `โหลดข้อมูลไม่ได้ / could not load arena data (${e.message})`));
  });
