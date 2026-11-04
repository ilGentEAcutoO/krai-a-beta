// /arena replay page (B22): static, no model calls. Everything shown comes
// from /arena/data.json, built by scripts/build-arena.mjs from an arena run.
// Language: krai.js owns the TH/EN toggle; we render in kraiLang() and
// re-render on 'krai:lang'. Transcript text is shown exactly as recorded.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const pct = (n, d) => (d ? `${Math.round((1000 * n) / d) / 10}%` : '—');
let LANG = 'en';
const L = (th, en) => (LANG === 'th' ? th : en);
const P = (pair) => (Array.isArray(pair) ? L(pair[0], pair[1]) : pair);

const OUTCOME = {
  blocked: { th: 'บล็อก', en: 'Blocked' },
  escalated: { th: 'ฝากข้อความ ให้เจ้าของตัดสิน', en: 'Message left for the owner' },
  allowed: { th: 'ปิดเป็นสายจริง', en: 'Closed as a real call' },
};
const out = (o) => (OUTCOME[o] ? L(OUTCOME[o].th, OUTCOME[o].en) : o);
const ACTION = { hangup: ['วางสาย', 'hang up'], 'take-message': ['ฝากข้อความ', 'take message'], continue: ['ถามต่อ', 'keep asking'] };
const KIND = {
  backchannel: ['KRAI-A', 'KRAI-A'], askWho: ['KRAI-A · ถามชื่อ', 'KRAI-A · asks who'], askCallback: ['KRAI-A · ขอเบอร์ทางการ', 'KRAI-A · asks for an official number'], askPurpose: ['KRAI-A · ถามธุระ', 'KRAI-A · asks the purpose'],
  takeMessage: ['KRAI-A · รับฝาก', 'KRAI-A · takes a message'], ack: ['KRAI-A', 'KRAI-A'], closeScam: ['KRAI-A · ปิดสาย (มิจ)', 'KRAI-A · closes (scam)'], close: ['KRAI-A · ปิดสาย', 'KRAI-A · closes'],
  disclosure: ['KRAI-A · แจ้งเปิดสายซ้ำในภาษาผู้โทร', "KRAI-A · disclosure in the caller's language"],
  trapFiller: ['KRAI-A · กับดัก', 'KRAI-A · trap'], trap: ['KRAI-A · กับดัก (Spark 1.3)', 'KRAI-A · trap (Spark 1.3)'], 'trap-canned': ['KRAI-A · กับดัก (ประโยคสำรอง)', 'KRAI-A · trap (canned line)'], 'trap-closing': ['KRAI-A · กับดัก ปิดสาย', 'KRAI-A · trap, closing'],
};
const GENDER = { f: '♀', m: '♂' };

// English mode shows no Thai script. KRAI-A's Thai lines in these replays are
// guarded canned or Spark-written lines; EN mode shows our English translation
// of each (marked "said in Thai"), and Thai politeness particles inside the AI
// callers' English lines are shown in Latin letters. Thai-language replays are
// listed in Thai mode only. Thai mode shows every line exactly as recorded.
const TH_EN = {
  'ระบบผู้ช่วยรับสายอัตโนมัติรับสายแทนเจ้าของเบอร์ สายนี้มีการบันทึก ขอทราบชื่อและธุระค่ะ': 'An automated answering assistant is taking this call for the owner. This call is recorded. May I have your name and the reason for your call?',
  'ค่ะ': 'Yes.',
  'ขอเบอร์ทางการไว้ติดต่อกลับด้วยค่ะ': 'Could I have an official number to call you back?',
  'เจ้าของเบอร์ไม่สะดวกค่ะ จะฝากเรื่องไว้ให้นะคะ': 'The owner is not available. I will pass on your message.',
  'รับทราบค่ะ จดไว้แล้วค่ะ': 'Okay, I have noted that.',
  'ค่ะ สักครู่นะคะ': 'Yes, one moment please.',
  'เดี๋ยวนะคะ กำลังจดอยู่ค่ะ': 'Just a moment, I am writing it down.',
  'ค่ะ ช่วยพูดช้าๆ ทวนชื่อธนาคารกับชื่อหน่วยงานอีกครั้งได้ไหมคะ': 'Could you slowly repeat the bank and the name of your department?',
  'ค่ะ ขอเวลาจดสักครู่นะคะ': 'Yes, give me a moment to write it down.',
  'ค่ะ ช่วยสะกดชื่อกับรหัสพนักงานช้าๆ อีกครั้งได้ไหมคะ': 'Could you spell your name and staff ID again, slowly?',
  'ค่ะ ช่วยทวนชื่อธนาคารกับเบอร์ติดต่อกลับช้าๆ อีกครั้งได้ไหมคะ': 'Could you slowly repeat the bank and the callback number?',
  'ค่ะ ช่วยทวนยอดเงินกับเลขบัญชีที่ต้องอายัดช้าๆ อีกครั้งได้ไหมคะ': 'Could you slowly repeat the amount and the account number to be frozen?',
  'รบกวนพูดช้าๆ อีกครั้งค่ะ ขอทราบชื่อหน่วยงานเพื่อจดไว้ให้เจ้าของตัดสินใจค่ะ': 'Please say it again slowly. What is the department, so I can note it for the owner to decide?',
  'ขอโทษค่ะ ช่วยสะกดชื่อให้ฟังช้าๆ หน่อยได้ไหมคะ จะจดไว้ให้เจ้าของตัดสินใจค่ะ': 'Sorry, could you spell your name slowly? I will note it for the owner to decide.',
  'จด ชื่อ ไว้ แล้ว ค่ะ ขอ รหัส ประจำตัว กับ เบอร์ ติดต่อ กลับ ด้วย นะคะ เจ้าของ ต้อง ตัดสินใจ ค่ะ': 'I have noted the name. May I have your ID and a callback number? The owner has to decide.',
  'ขอโทษค่ะ ช่วยทวนยอดเงินกับธนาคารอีกครั้งช้าๆ จะจดไว้ให้เจ้าของตัดสินใจค่ะ': 'Sorry, could you slowly repeat the amount and the bank? I will note it for the owner to decide.',
  'รบกวน ทวน ชื่อ บัญชี ช้า ช้า อีก ครั้ง ได้ ไหม คะ จะ จด ไว้ ให้ เจ้าของ ตัดสินใจ ค่ะ': 'Could you slowly repeat the account name? I will note it for the owner to decide.',
  'รบกวน ทวน เบอร์ ติดต่อ กับ ไลน์ ช้า ช้า อีก ครั้ง ได้ ไหม คะ': 'Could you slowly repeat the contact number and the LINE id?',
  'รบกวนบอกชื่อหน่วยงานอีกครั้งช้าๆ ได้ไหมคะ จะจดไว้ให้เจ้าของตัดสินใจค่ะ': 'Could you tell me the department again, slowly? I will note it for the owner to decide.',
  'ขอโทษค่ะ รบกวนพูดช้าๆ ว่าชื่ออะไรจากหน่วยงานไหนนะคะ': 'Sorry, could you say slowly what your name is and where you are calling from?',
  'ค่ะ รบกวน สะกด ชื่อ กับ หน่วยงาน ช้าๆ อีกครั้ง ได้ไหมคะ เจ้าของ ต้อง ตัดสินใจ เองค่ะ': 'Could you spell your name and department again, slowly? The owner has to decide.',
  'ค่ะ รบกวนพูดช้าๆ อีกครั้งว่ามาจากหน่วยงานไหน เจ้าของต้องตัดสินใจเองค่ะ': 'Could you say again, slowly, where you are calling from? The owner has to decide.',
  'ค่ะ รบกวนทวนชื่อ รหัสพนักงาน และเบอร์ติดต่อกลับช้าๆ นะคะ': 'Could you slowly repeat your name, staff ID and callback number?',
  'ค่ะ เรื่องบัญชีไหนยอดเท่าไหร่ รบกวนพูดช้าๆ ให้จดหน่อยนะคะ': 'Which account, and how much? Please say it slowly so I can write it down.',
  'ค่ะ รบกวน ทวน เบอร์ติดต่อกลับ ช้าๆ อีกครั้ง ได้ไหมคะ': 'Could you repeat the callback number again, slowly?',
  'ค่ะ รบกวน บอก หน่วยงาน กับ ไอดี ไลน์ ช้าๆ ให้ จด หน่อย นะคะ': 'Could you tell me the department and the LINE id slowly, so I can write them down?',
  'ขอบคุณค่ะ จะแจ้งเจ้าของเบอร์ให้ทราบนะคะ สวัสดีค่ะ': 'Thank you. I will let the owner know. Goodbye.',
};
const THAI = /[฀-๿]/;
const PARTICLE = [[/ครับ/g, 'krub'], [/ค่ะ|คะ|ค่า/g, 'ka'], [/นะ/g, 'na']];
function enText(text) {
  if (LANG === 'th' || !THAI.test(text || '')) return { text, said: false };
  const t = String(text).trim();
  if (TH_EN[t]) return { text: TH_EN[t], said: true };
  let v = t;
  for (const [re, rep] of PARTICLE) v = v.replace(re, rep);
  return THAI.test(v) ? { text: '(a line in Thai: switch the page to Thai to read it)', said: false } : { text: v, said: false };
}
const shown = (m) => LANG === 'th' || !['th', 'mixed'].includes(m.lang);
const CLS = { scam: ['มิจ', 'Scam'], legit: ['สายจริง', 'Real'], edge: ['ไม่ใช่มิจ', 'Not a scam'] };
const CALLER = { scam: ['AI มิจ', 'AI scammer'], legit: ['ผู้โทร', 'Caller'], edge: ['ผู้โทร', 'Caller'] };
// B25 expected behaviours (scripts/arena-personas/edge.json expectedSet + built-ins)
const EXPECT = {
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
const exp = (k) => (EXPECT[k] ? P(EXPECT[k]) : k);
const isScam = (m) => m.cls === 'scam' || m.expect === 'SCAM_BLOCK' || m.expect === 'TRAP_OK';

let data = null;
let cur = null; // { m, step, queue, timer }
let speed = 1;

function stat(label, big, sub, v) {
  const c = el('div', 'k-stat');
  if (v) c.dataset.v = v;
  c.append(el('b', null, big), el('span', null, label));
  if (sub) c.append(el('em', 'sub', sub));
  return c;
}

function table(headers, rows, numFrom = 1) {
  const t = el('table', 'k-table');
  const thead = el('thead');
  const hr = el('tr');
  headers.forEach((h, i) => hr.append(el('th', i >= numFrom ? 'n' : null, h)));
  thead.append(hr);
  const tb = el('tbody');
  for (const { cells, cls } of rows) {
    const tr = el('tr', cls || null);
    cells.forEach((v, i) => tr.append(el('td', i >= numFrom ? 'n' : null, String(v))));
    tb.append(tr);
  }
  t.append(thead, tb);
  const w = el('div', 'k-table-wrap');
  w.append(t);
  return w;
}

function renderScore() {
  const a = data.totals.all;
  $('score').replaceChildren(
    stat(L('เกมทั้งหมด', 'Games played'), String(a.calls), L(`มิจ ${a.scam.n} · จริง ${a.legit.n}`, `${a.scam.n} scam · ${a.legit.n} real`)),
    stat(L('สายมิจที่ถูกบล็อก', 'Scam calls blocked'), pct(a.scam.blocked, a.scam.n), `${a.scam.blocked}/${a.scam.n}`, 'LEGIT'),
    stat(L('มิจที่หลุดเป็น "สายจริง" (พลาดหนักสุด)', 'Scams closed as real, the worst miss'), String(a.scam.allowed), L(`อีก ${a.scam.escalated} สายฝากให้เจ้าของตัดสิน`, `${a.scam.escalated} more left for the owner`), a.scam.allowed ? 'SCAM' : 'LEGIT'),
    stat(L('สายจริงที่โดนวางผิด', 'Real callers wrongly blocked'), String(a.legit.blocked), L(`จาก ${a.legit.n} สายจริง`, `of ${a.legit.n} real calls`), a.legit.blocked ? 'SCAM' : 'LEGIT'),
  );
  const row = (name, s) => ({ cells: [name, s.calls, `${s.scam.blocked}/${s.scam.n}`, s.scam.escalated, s.scam.allowed, `${s.legit.allowed}/${s.legit.n}`, s.legit.escalated, s.legit.blocked, s.scam.medianTurnToBlock ?? '—'] });
  const rows = [row(L('ทั้งหมด', 'All'), a), row('train 70%', data.totals.train), row('holdout 30%', data.totals.holdout)];
  if (data.after?.totals?.all) rows.push(row(`${L('หลังแก้', 'After the fix')} (${data.after.mode || ''})`, data.after.totals.all));
  $('splitTbl').replaceChildren(table([L('ชุด', 'Split'), L('เกม', 'Games'), L('มิจ บล็อก', 'Scam blocked'), L('มิจ ฝากข้อความ', 'Scam message'), L('มิจ หลุดเป็นสายจริง', 'Scam closed as real'), L('สายจริง ผ่าน', 'Real allowed'), L('สายจริง ฝากข้อความ', 'Real message'), L('สายจริง โดนบล็อก', 'Real blocked'), L('เทิร์นที่บล็อก (มัธยฐาน)', 'Turn of block (median)')], rows));
  const r = data.run;
  $('runNote').textContent = L(
    `ผู้โทร ${r.personaModel} (effort ${r.personaEffort}) · ผู้ตัดสิน ${r.verdictModel} · ${data.personas.scam} บทมิจ + ${data.personas.legit} บทสายจริง · สูงสุด ${r.maxTurns} เทิร์น · มิจที่ติดกับดัก ${a.trapped} สาย เก็บข้อมูลได้ ${a.intelItems} รายการ`,
    `Callers ${r.personaModel} (effort ${r.personaEffort}) · judge ${r.verdictModel} · ${data.personas.scam} scam + ${data.personas.legit} real personas · up to ${r.maxTurns} turns · ${a.trapped} scammers trapped, ${a.intelItems} intel items captured`,
  ) + (r.spentUsd != null ? L(` · ค่าใช้จ่ายทั้งรอบ $${Number(r.spentUsd).toFixed(2)}`, ` · whole run cost $${Number(r.spentUsd).toFixed(2)}`) : '')
    + (r.git ? ` · code ${r.git}` : '');
  $('srcNote').textContent = data.source;
}

// One readable row per miss: who called, what should have happened, what did.
function missItem(id, tag, expect, outcome, violations) {
  const li = el('li', 'miss');
  const top = el('div', 'miss-top');
  top.append(el('code', null, id));
  if (tag) top.append(el('span', 'miss-tag', tag));
  const body = el('div', 'miss-b');
  body.append(el('span', 'miss-k', L('ควร', 'Expected')), el('span', null, exp(expect)), el('span', 'miss-k', L('ได้', 'Got')), el('span', `miss-got ${outcome}`, out(outcome)));
  li.append(top, body);
  if (violations?.length) li.append(el('div', 'miss-v', violations.join(', ')));
  return li;
}

function renderEdge() {
  const e = data.edge;
  if (!e) return;
  $('edgeSec').hidden = false;
  $('edgeHead').replaceChildren(
    stat(L('ทำตามที่ควร', 'Met the expected behaviour'), pct(e.met, e.calls), `${e.met}/${e.calls}`, 'LEGIT'),
    stat(L('สายที่ยังไม่ตรง', 'Calls that missed'), String(e.calls - e.met), L(`จาก ${e.calls} สาย`, `of ${e.calls} calls`)),
  );
  $('edgeTbl').replaceChildren(table([L('ควรทำ', 'Expected'), L('สาย', 'Calls'), L('ตรง', 'Met'), '%'],
    Object.entries(e.byExpect).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ cells: [exp(k), v.n, v.met, pct(v.met, v.n)] }))));
  $('famTbl').replaceChildren(table([L('กลุ่ม', 'Family'), L('สาย', 'Calls'), L('ตรง', 'Met'), '%'],
    Object.entries(e.families || {}).sort().map(([k, v]) => ({ cells: [k, v.n, v.met, pct(v.met, v.n)] }))));
  const ul = $('edgeFails');
  ul.replaceChildren(...(e.failures || []).map((x) => missItem(x.id, x.family || 'edge', x.expect, x.outcome, x.violations)));
  if (!ul.childNodes.length) ul.append(el('li', 'miss', L('ไม่มี', 'None')));
  $('edgeFailN').textContent = String((e.failures || []).length);
  const src = Object.entries(e.bySource || {}).map(([k, n]) => `${k} (${n})`).join(' + ');
  $('edgeNote').textContent = L(
    `${e.personas} บทจากคลังสถานการณ์ เล่นบทละ 1 สาย · ข้อมูลจาก ${src} (สายที่เล่นซ้ำหลังแก้ใช้ผลรอบหลัง) · URGENT ผ่านเมื่อไม่ถูกบล็อกและรายงานติดป้าย "ด่วน" · HARASSMENT ผ่านเมื่อปิดสายเองและรายงานบันทึกว่าเป็นการคุกคาม`,
    `${e.personas} personas from the scenario bank, one call each · data from ${src} (calls replayed after a fix use the later result) · URGENT passes when not blocked and the report is tagged urgent · HARASSMENT passes when we close the call and the report records harassment`,
  );
}

// B27: per caller language (expected vs got), with the Thai-only before run
function renderLang() {
  const r = data.regional;
  if (!r) return;
  $('langSec').hidden = false;
  const a = r.after;
  const tot = Object.values(a).reduce((s, e) => ({ n: s.n + e.n, met: s.met + e.met }), { n: 0, met: 0 });
  $('langHead').textContent = L(
    `${tot.met}/${tot.n} สายทำตามที่ควร (${pct(tot.met, tot.n)}) · ไม่มีสายมิจที่ถูกปิดเป็นสายจริง`,
    `${tot.met} of ${tot.n} regional calls met the expected behaviour (${pct(tot.met, tot.n)}) · no scam closed as a real call`,
  );
  const cards = $('langCards');
  cards.replaceChildren();
  const card = (label, e, sub, cls) => {
    const c = el('article', `lc ${cls || ''}`);
    const head = el('div', 'lc-h');
    head.append(el('b', null, label), el('span', null, sub));
    const big = el('div', 'lc-n', pct(e.met, e.n));
    big.append(el('small', null, ` ${e.met}/${e.n}`));
    const bar = el('div', 'lc-bar');
    const fill = el('i');
    fill.style.width = `${e.n ? (100 * e.met) / e.n : 0}%`;
    bar.append(fill);
    const facts = el('ul', 'lc-f');
    facts.append(
      el('li', null, L(`บล็อกมิจ ${e.scam.blocked}/${e.scam.n}`, `Scams blocked ${e.scam.blocked}/${e.scam.n}`)),
      el('li', null, L(`ฉุกเฉินผ่าน ${e.urgent.met}/${e.urgent.n}`, `Emergencies through ${e.urgent.met}/${e.urgent.n}`)),
      el('li', null, L(`ผู้โทรบอกว่าฟังไม่เข้าใจ ${e.notUnderstood}`, `Said they didn't understand ${e.notUnderstood}`)),
    );
    c.append(head, big, bar, facts);
    return c;
  };
  if (r.before?.en) cards.append(card('English', r.before.en, L('ก่อนแก้: ตอบเป็นไทยอย่างเดียว', 'Before: Thai-only replies'), 'before'));
  for (const k of r.order) {
    const full = ['en', 'zh'].includes(k);
    cards.append(card(a[k].name, a[k], full ? L('ชุดเต็ม', 'Full set') : L('ทดลอง 15 สาย', 'Probe, 15 calls'), full ? 'full' : ''));
  }
  const row = (label, e, cls) => {
    const nonScam = e.legit.n + e.nuisance.n;
    return { cls, cells: [label, e.n, `${e.met} (${pct(e.met, e.n)})`, `${e.scam.blocked}/${e.scam.n}`, `${e.legit.falseScam + e.nuisance.falseScam}/${nonScam}`, `${e.urgent.met}/${e.urgent.n}`, `${e.notUnderstood}/${e.n}`] };
  };
  const rows = [];
  if (r.before?.en) rows.push(row(L('English · ก่อนแก้ (ตอบเป็นไทยอย่างเดียว)', 'English · before (Thai-only replies)'), r.before.en, 'is-before'));
  for (const k of r.order) rows.push(row(`${a[k].name}${['en', 'zh'].includes(k) ? '' : ' · probe'}`, a[k]));
  $('langTbl').replaceChildren(table([L('ภาษา', 'Language'), L('สาย', 'Calls'), L('ตรงที่ควร', 'Met'), L('บล็อกมิจ', 'Scams blocked'), L('ไม่ใช่มิจแต่โดนตีเป็นมิจ', 'Non-scam flagged SCAM'), L('ฉุกเฉินผ่าน', 'Emergencies'), L('ผู้โทรบอกว่าฟังไม่เข้าใจ', 'Said they did not understand')], rows));
  const ul = $('langFails');
  ul.replaceChildren(...(r.failures || []).map((x) => missItem(x.id, x.lang?.toUpperCase() || '', x.expect, x.outcome, x.violations)));
  if (!ul.childNodes.length) ul.append(el('li', 'miss', L('ไม่มี', 'None')));
  $('langFailN').textContent = String((r.failures || []).length);
  $('langNote').textContent = L(
    `ข้อมูลจาก ${r.sources.join(' + ')} · ภาษาเลือกจากตัวอักษรที่ผู้โทรพูด (โค้ด ไม่ใช่โมเดล) แล้วคงไว้ทั้งสาย · ประโยคเปิดสายแรกยังเป็นภาษาไทยเพราะยังไม่รู้ภาษาผู้โทร จึงนับ "ฟังไม่เข้าใจ" หลังคำตอบแรกเท่านั้น · probe = 15 สายต่อภาษา เล็กและหยาบ`,
    `Data from ${r.sources.join(' + ')} · the reply language is picked from the caller's script (code, not a model) and kept for the call · the opening line is Thai for every call (nothing is known yet), so "did not understand" counts only after the first reply · probes are 15 calls per language: small, indicative only.`,
  );
}

function renderList() {
  const list = $('matchList');
  list.replaceChildren();
  for (const m of data.matches.filter(shown)) {
    const b = el('button', 'mt');
    b.type = 'button';
    b.dataset.id = m.id;
    b.setAttribute('aria-pressed', String(cur?.m.id === m.id));
    const top = el('span', 't');
    top.append(el('span', null, `${isScam(m) ? P(CLS.scam) : P(CLS[m.cls] || m.cls)} ${GENDER[m.gender] || ''} · ${m.family || m.tactic}${m.lang && !['th', 'mixed'].includes(m.lang) ? ` · ${m.lang.toUpperCase()}` : ''}`));
    top.append(el('span', `res ${m.correct ? 'won' : 'lost'}`, m.correct ? L('ระบบชนะ', 'KRAI-A won') : L('ระบบพลาด', 'KRAI-A missed')));
    b.append(top, el('span', 'w', m.why || m.persona), el('span', 'o', `${out(m.outcome)} · ${m.turns.length} ${L('เทิร์น', 'turns')}`));
    b.addEventListener('click', () => load(m.id, true));
    list.append(b);
  }
}

function bubble(cls, label, text) {
  const m = el('div', `k-msg ${cls}`);
  const g = enText(text);
  m.append(el('span', 'k-who', g.said ? `${label} · said in Thai` : label), el('span', 'tx', g.text));
  return m;
}

function turnNodes(m, t) {
  const nodes = [];
  const c = bubble('caller', `${P(CALLER[m.cls] || CALLER.legit)} ${GENDER[m.gender] || ''} · ${L('เทิร์น', 'turn')} ${t.turn}`, t.caller);
  const chips = el('div', 'chips');
  for (const ch of t.chips) {
    const s = el('span', `chip ${ch.k === 'wonder' ? 'wonder' : ch.tier}`, ch.text);
    if (ch.rule) s.title = `policy rule: ${ch.rule}`;
    chips.append(s);
  }
  if (t.tactic) chips.append(el('span', 'chip act', t.tactic));
  if (t.action) chips.append(el('span', 'chip act', `→ ${ACTION[t.action] ? P(ACTION[t.action]) : t.action}`));
  nodes.push(c);
  if (chips.childNodes.length) nodes.push(chips);
  for (const r of t.reply) {
    const cls = /^close/.test(r.kind) || r.kind === 'trap-closing' ? 'ai close' : /^trap/.test(r.kind) ? 'ai trap' : 'ai';
    nodes.push(bubble(cls, KIND[r.kind] ? P(KIND[r.kind]) : 'KRAI-A', r.text));
  }
  return nodes;
}

function endBox(m) {
  const won = m.correct;
  const box = el('div', `end ${won ? 'won' : 'lost'}`);
  const o = out(m.outcome);
  const e = m.expect ? exp(m.expect) : null;
  const head = e
    ? L(`${won ? 'ทำตามที่ควร' : 'ไม่ตรงที่ควร'}: ควร "${e}" · ได้ "${o}"`, `${won ? 'Did what it should' : 'Missed'}: expected "${e}", got "${o}"`)
    : won
    ? (m.cls === 'scam' ? L(`ระบบชนะ: บล็อกได้ที่เทิร์น ${m.firstCorrectTurn}`, `KRAI-A won: blocked at turn ${m.firstCorrectTurn}`) : L('ระบบชนะ: สายจริงได้ฝากข้อความตามปกติ', 'KRAI-A won: the real caller left a normal message'))
    : (m.cls === 'scam' ? L(`ระบบพลาด: มิจจบสายแบบ "${o}"`, `KRAI-A missed: the scam ended as "${o}"`) : L(`ระบบพลาด: สายจริงจบแบบ "${o}"`, `KRAI-A missed: the real call ended as "${o}"`));
  box.append(el('b', null, head));
  if (m.afterFix) {
    const how = m.afterFix.replay ? L('เล่นคำพูดเดิมของผู้โทรซ้ำ', 'same caller lines replayed') : L('ให้ AI บทเดิมโทรมาใหม่', 'same persona called again');
    box.append(el('div', 'small', L(`หลังแก้ (B19) ${how}: ${m.afterFix.correct ? 'ระบบชนะ' : 'ยังพลาด'} · ${out(m.afterFix.outcome)}`, `After the fix (B19), ${how}: ${m.afterFix.correct ? 'won' : 'still missed'} · ${out(m.afterFix.outcome)}`)));
  }
  if (m.intel?.length) {
    const ul = el('ul');
    for (const i of m.intel) ul.append(el('li', null, `${i.type}: ${LANG === 'th' ? i.value : String(i.value).replace(/บาท/g, 'baht')}`));
    box.append(el('div', 'small', L('ข้อมูลที่กับดักเก็บได้ (แต่งขึ้นโดย AI):', 'Intel the trap captured (invented by the AI):')), ul);
  }
  return box;
}

function playLabel(on) {
  $('playBtn').setAttribute('aria-pressed', String(on));
  $('playTx').textContent = on ? L('หยุด', 'Pause') : L('เล่น', 'Play');
  $('playIc').textContent = on ? '❚❚' : '▶';
}

function stop() {
  if (cur?.timer) clearTimeout(cur.timer);
  if (cur) cur.timer = null;
  playLabel(false);
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
  // Bring the whole phone on screen (the feed then scrolls itself to the newest bubble).
  const stage = document.querySelector('.stage');
  const r = stage.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) stage.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  playLabel(true);
  const tick = () => {
    if (!step()) return stop();
    cur.timer = setTimeout(tick, 1500 / speed);
  };
  tick();
}

function load(id, autoplay = false, upto = 0) {
  stop();
  const list = data.matches.filter(shown);
  const m = list.find((x) => x.id === id) || list[0];
  if (!m) return;
  for (const b of $('matchList').children) b.setAttribute('aria-pressed', String(b.dataset.id === m.id));
  const queue = [bubble('sys', L('KRAI-A · เปิดสาย (ทุกสาย)', 'KRAI-A · opening line (every call)'), m.opening)];
  for (const t of m.turns) queue.push(...turnNodes(m, t));
  cur = { m, step: 0, queue, timer: null };
  $('matchWho').textContent = `${isScam(m) ? L('AI มิจ', 'AI scammer') : m.cls === 'edge' ? L('ผู้โทร (ไม่ใช่มิจ)', 'Caller (not a scam)') : L('ผู้โทรจริง', 'Real caller')} ${GENDER[m.gender] || ''} · ${m.persona}`;
  $('matchMeta').textContent = `${m.id} · ${L('ภาษา', 'language')} ${m.lang} · ${m.scamPolicy === 'trap' ? L('โหมดกับดัก', 'trap mode') : L('โหมดวางสายสุภาพ', 'polite hang-up mode')}`;
  $('feed').replaceChildren();
  $('endBox').replaceChildren();
  const u = new URL(location.href);
  u.searchParams.set('m', m.id);
  history.replaceState(null, '', u);
  if (autoplay) play();
  else {
    step();
    while (cur.step < upto && step());
  }
}

function renderAll() {
  renderScore();
  renderEdge();
  renderLang();
  renderList();
}

$('playBtn').addEventListener('click', () => (cur?.timer ? stop() : (cur && cur.step >= cur.queue.length ? load(cur.m.id, true) : play())));
$('stepBtn').addEventListener('click', () => { stop(); step(); });
$('allBtn').addEventListener('click', () => { stop(); while (step()); });
$('speedBtn').addEventListener('click', () => {
  speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
  $('speedBtn').textContent = `${speed}×`;
});
document.addEventListener('krai:lang', (e) => {
  LANG = e.detail?.lang === 'th' ? 'th' : 'en';
  if (!data) return;
  renderAll();
  if (cur) load(cur.m.id, false, cur.step);
});
LANG = window.kraiLang?.() === 'th' ? 'th' : 'en';

fetch('/arena/data.json')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((d) => {
    data = d;
    renderAll();
    load(new URL(location.href).searchParams.get('m'));
  })
  .catch((e) => {
    $('score').replaceChildren(el('div', 'empty', L(`โหลดข้อมูลสนามไม่ได้ (${e.message}) ลองรีเฟรชหน้า`, `Could not load the arena data (${e.message}). Reload the page to try again.`)));
  });
