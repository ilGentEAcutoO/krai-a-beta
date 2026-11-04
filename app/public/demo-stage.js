/* demo-live: the voice-first call stage. No build step.
 *
 * Listens to voice-client.js ('krai:call' events on document) and draws the
 * call: who is speaking (level rings from the real audio analysers in
 * window.kraiLevels), a live waveform, captions, the scam-risk needle and a
 * chip per judged sentence, the hang-up moment, then points to the report.
 * Also the mode tabs (recorded calls / live mic) and the recorded-call list
 * with its language chips (window.kraiDemo from voice-client.js).
 */
const $ = (id) => document.getElementById(id);
const lang = () => (window.kraiLang?.() === 'th' ? 'th' : 'en');
const L = (th, en) => (lang() === 'th' ? th : en);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const consoleEl = $('dsConsole');
const statusText = $('dsStatusText');
const clockEl = $('dsClock');
const langName = $('dsLangName');
const callerEl = $('dsCaller');
const aiEl = $('dsAi');
const callerAv = callerEl.querySelector('.ds-av');
const aiAv = aiEl.querySelector('.ds-av');
const capEl = $('dsCap');
const capWho = $('dsCapWho');
const capNote = $('dsCapNote');
const capText = $('dsCapText');
const needle = $('dsNeedle');
const verdictEl = $('dsVerdict');
const verdictSub = $('dsVerdictSub');
const turnsEl = $('dsTurns');
const idleEl = $('dsIdle');
const endEl = $('dsEnd');
const stopBtn = $('dsStopBtn');
const srcEl = $('dsSrc');
const eng = { asr: $('engAsr'), t1: $('engT1'), spark: $('engSpark'), wonder: $('engWonder') };

const LANG_NAMES = { th: ['ไทย', 'Thai'], en: ['อังกฤษ', 'English'], zh: ['จีนกลาง', 'Mandarin'], vi: ['เวียดนาม', 'Vietnamese'] };
const VERDICT_WORD = { SCAM: ['มิจฉาชีพ', 'Scam'], UNSURE: ['ไม่แน่ใจ', 'Unsure'], LEGIT: ['ปกติ', 'Normal'] };
const TACTIC_EN = { 'fake-police': 'posing as police', 'bank-security': 'fake bank security', 'parcel-customs': 'parcel at customs', 'parcel-courier': 'parcel story', delivery: 'delivery', hospital: 'hospital', investment: 'investment pitch', romance: 'romance', 'family-in-trouble': 'family in trouble', prize: 'prize', none: 'no scam script', other: 'other' };

const st = {
  state: 'idle', mode: null, lang: null, startedAt: 0, endedAt: 0, tick: 0, raf: 0,
  speaker: null, verdict: null, risk: 0.5, turns: 0, verdicts: [], recorded: null, last: null,
};

// ---------- small helpers ----------
const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
function setState(s) {
  st.state = s;
  consoleEl.dataset.state = s;
  statusText.textContent = {
    idle: L('พร้อม', 'Ready'), live: L('สายสด', 'Live call'), playing: L('กำลังเล่นสายที่อัดไว้', 'Recorded call'),
    typed: L('สายทดลอง (พิมพ์)', 'Typed call'), ended: L('วางสายแล้ว', 'Call ended'),
  }[s] || s;
}
function setLangName(l) {
  st.lang = l;
  const n = LANG_NAMES[l];
  langName.textContent = n ? L(n[0], n[1]) : '—';
}
function light(k, on) { eng[k]?.classList.toggle('on', on); }
function setSpeaker(who) {
  st.speaker = who;
  callerEl.classList.toggle('on', who === 'caller');
  aiEl.classList.toggle('on', who === 'ai');
  $('dsCallerState').textContent = who === 'caller' ? L('กำลังพูด', 'speaking') : L('ผู้โทร', 'Caller');
  $('dsAiState').textContent = who === 'ai' ? L('กำลังพูด', 'speaking') : (st.state === 'idle' || st.state === 'ended' ? L('รับสายแทน', 'answering for Mom') : L('กำลังฟัง', 'listening'));
  light('asr', who === 'caller');
  if (who) wake();
}
function setCaption(who, text, { translated = false } = {}) {
  capEl.dataset.who = who || '';
  capWho.textContent = who === 'caller' ? L('ผู้โทร', 'Caller') : who === 'ai' ? L('ใครอะ', 'KRAI-A') : L('ซับไตเติลสด', 'Live captions');
  capNote.textContent = translated ? L('· แปลจากภาษาไทย', '· translated from Thai') : '';
  capText.textContent = text;
}
function riskOf(v, conf) {
  const c = typeof conf === 'number' ? Math.max(0, Math.min(1, conf)) : 0.6;
  if (v === 'SCAM') return 0.62 + 0.38 * c;
  if (v === 'LEGIT') return 0.38 - 0.38 * c;
  return 0.5;
}
function setVerdict(v, conf, sub) {
  st.verdict = v;
  st.conf = conf;
  verdictEl.dataset.v = v || '';
  verdictEl.textContent = v ? L(VERDICT_WORD[v][0], VERDICT_WORD[v][1]) + (typeof conf === 'number' ? ' · ' + Math.round(conf * 100) + '%' : '') : L('รอฟัง', 'Listening');
  verdictSub.textContent = sub || '';
  st.risk = v ? riskOf(v, conf) : 0.5;
  needle.style.setProperty('--x', (st.risk * 100).toFixed(1) + '%');
  needle.style.setProperty('--o', v ? '1' : '.35');
  if (v && !reduced) {
    verdictEl.classList.remove('bump');
    void verdictEl.offsetWidth;
    verdictEl.classList.add('bump');
    setTimeout(() => verdictEl.classList.remove('bump'), 320);
  }
}
function addTurnChip(d) {
  const chip = document.createElement('span');
  chip.className = 'ds-turn';
  chip.dataset.v = d.verdict || '';
  chip.dataset.e = d.engine;
  const i = document.createElement('i');
  const b = document.createElement('b');
  b.textContent = d.engine === 'wonder' ? 'Wonder' : d.engine === 't1' ? L('กฎ T1', 'T1 rule') : L('ประโยค ', 'S') + (d.turn || st.turns);
  const t = document.createElement('span');
  const word = d.verdict ? L(VERDICT_WORD[d.verdict][0], VERDICT_WORD[d.verdict][1]) : '';
  const time = d.engine === 't1' ? L('ทันที', 'instant') : (d.latencyMs ? (d.latencyMs / 1000).toFixed(1) + ' s' : '');
  t.textContent = word + (time ? ' · ' + time : '');
  chip.append(i, b, t);
  turnsEl.append(chip);
}
function emptyTurns() {
  turnsEl.replaceChildren();
  turnsEl.dataset.empty = L('ทุกประโยคได้คำตัดสินของตัวเองตรงนี้', 'Each sentence gets its own verdict here.');
}

// While Spark judges a sentence: a moving shimmer and a plain "checking" line,
// so the screen never looks frozen.
const meterEl = document.querySelector('.ds-meter');
function checking(on) {
  meterEl.classList.toggle('checking', on);
  if (on) verdictSub.textContent = L('กำลังตรวจประโยคนี้…', 'Checking this sentence…');
}

// ---------- clock ----------
function startClock() {
  st.startedAt = performance.now();
  st.endedAt = 0;
  clearInterval(st.tick);
  st.tick = setInterval(() => { clockEl.textContent = mmss(performance.now() - st.startedAt); }, 250);
  clockEl.textContent = '00:00';
}
function stopClock() {
  clearInterval(st.tick);
  st.endedAt = performance.now();
}

// ---------- waveform + level rings (runs only while a call is on) ----------
const canvas = $('dsWave');
const g = canvas.getContext('2d');
const HIST = 160;
const hist = { caller: new Float32Array(HIST), ai: new Float32Array(HIST) };
let histPos = 0;
const buf = new Float32Array(1024);
let lastSample = 0;
function level(an) {
  if (!an) return 0;
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.min(1, Math.sqrt(sum / buf.length) * 4.2);
}
function draw(now) {
  st.raf = 0;
  const lv = window.kraiLevels || {};
  const lc = level(lv.caller);
  const la = level(lv.ai);
  callerAv.style.setProperty('--lv', lc.toFixed(3));
  aiAv.style.setProperty('--lv', la.toFixed(3));
  if (now - lastSample > 45) {
    lastSample = now;
    hist.caller[histPos] = lc;
    hist.ai[histPos] = la;
    histPos = (histPos + 1) % HIST;
  }
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const step = w / HIST;
  const bw = Math.max(1.5, step * 0.58);
  for (let k = 0; k < HIST; k++) {
    const idx = (histPos + k) % HIST;
    const c = hist.caller[idx];
    const a = hist.ai[idx];
    const v = Math.max(c, a);
    const x = k * step + (step - bw) / 2;
    const hh = Math.max(2, v * (h * 0.92));
    const fade = 0.25 + 0.75 * (k / HIST);
    g.fillStyle = v < 0.015 ? `rgba(255,255,255,${0.12 * fade})` : (c >= a ? `rgba(255,197,107,${fade})` : `rgba(140,200,255,${fade})`);
    const y = (h - hh) / 2;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, bw, hh, bw / 2);
    else g.rect(x, y, bw, hh);
    g.fill();
  }
  const active = st.state === 'live' || st.state === 'playing' || st.state === 'typed' || lc > 0.01 || la > 0.01;
  if (active || hist.caller.some((x) => x > 0.01) || hist.ai.some((x) => x > 0.01)) {
    if (!active) { // decay the history to flat after the call
      for (let k = 0; k < HIST; k++) { hist.caller[k] *= 0.9; hist.ai[k] *= 0.9; }
    }
    st.raf = requestAnimationFrame(draw);
  }
}
function wake() {
  if (!st.raf && !document.hidden) st.raf = requestAnimationFrame(draw);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
addEventListener('resize', wake, { passive: true });

// ---------- overlays ----------
function show(el, on) {
  el.classList.toggle('show', on);
  el.toggleAttribute('inert', !on);
}
function showEnd(d) {
  st.endDetail = d;
  // The latest verdict wins (Spark can land after a code-rule close).
  const t1 = st.verdicts.some((x) => x.engine === 't1');
  const v = st.verdict || d.verdict || 'UNSURE';
  endEl.dataset.v = v;
  const hungUp = d.closedByUs && (v === 'SCAM' || t1);
  $('dsEndTitle').textContent = hungUp ? L('ใครอะ วางสายมิจแล้ว', 'KRAI-A hung up on a scammer')
    : v === 'SCAM' ? L('สายนี้เป็นมิจ', 'Scam call: nothing was given away')
      : v === 'LEGIT' ? L('สายปกติ รับฝากเรื่องไว้ให้แล้ว', 'A normal call: message taken')
        : L('ยังไม่แน่ชัด ส่งให้ครอบครัวตรวจ', 'Not clear: flagged for the family');
  $('dsEndText').textContent = v === 'SCAM'
    ? L('ไม่มีเงิน รหัส หรือข้อมูลของแม่หลุดออกไป ครอบครัวได้รายงานพร้อมคำพูดจริงของผู้โทร', "No money, codes or Mom's details left the call. The family gets a report with the caller's exact words.")
    : v === 'LEGIT' ? L('ไม่ตัดสายจริง ผู้ช่วยจดเรื่องไว้ให้ ครอบครัวโทรกลับได้ด้วยเบอร์ทางการ', 'A real caller is never cut off. The assistant took the message for the family.')
      : L('ผู้ช่วยไม่ทำตามที่ผู้โทรขอ และส่งให้ครอบครัวตรวจผ่านช่องทางทางการ', 'The assistant did nothing the caller asked and sent it to the family to check.');
  const stats = $('dsEndStats');
  stats.replaceChildren();
  const add = (t) => stats.append(Object.assign(document.createElement('span'), { textContent: t }));
  add(L('เวลาในสาย ', 'Call time ') + mmss((st.endedAt || performance.now()) - st.startedAt));
  add(st.turns + L(' ประโยคที่ตัดสิน', st.turns === 1 ? ' sentence judged' : ' sentences judged'));
  const sparks = st.verdicts.filter((x) => x.engine === 'spark' && x.latencyMs);
  if (sparks.length) add('Spark ' + (sparks.reduce((a, x) => a + x.latencyMs, 0) / sparks.length / 1000).toFixed(1) + L(' วิ. เฉลี่ย', ' s avg'));
  if (st.verdicts.some((x) => x.engine === 't1')) add(L('กฎโค้ดปิดสายทันที', 'closed by code at once'));
  if (st.lang) add(L('ภาษา', 'Language') + ': ' + langName.textContent);
  show(endEl, true);
}

// ---------- call events ----------
function resetStage() {
  checking(false);
  stopClock();
  st.turns = 0;
  st.verdicts = [];
  st.verdict = null;
  emptyTurns();
  setVerdict(null);
  setSpeaker(null);
  setCaption(null, L('คำพูดของทั้งสองฝั่งจะขึ้นตรงนี้', 'What both sides say shows up here.'));
  clockEl.textContent = '00:00';
  for (const k of Object.keys(eng)) light(k, false);
  show(endEl, false);
}

document.addEventListener('krai:call', (e) => {
  const d = e.detail;
  switch (d.type) {
    case 'reset':
      st.endDetail = null;
      resetStage();
      break;
    case 'recorded':
      st.recorded = d.call;
      markCurrent(d.call.id);
      break;
    case 'open':
      show(idleEl, false);
      show(endEl, false);
      st.mode = d.mode;
      setState(d.mode === 'recorded' ? 'playing' : d.mode === 'live' ? 'live' : 'typed');
      setLangName(st.recorded && d.mode === 'recorded' ? st.recorded.lang : d.lang);
      startClock();
      srcEl.textContent = d.mode === 'recorded' ? provenance() : d.mode === 'live'
        ? L('สายสด: เสียงไมค์ของคุณ → ถอดเสียง → Muse Spark ทุกประโยคตอนนี้', 'Live: your mic → speech to text → Muse Spark on every sentence, right now')
        : L('ตัดสินสดด้วย Muse Spark ตอนนี้', 'Judged live by Muse Spark right now');
      stopBtn.hidden = d.mode !== 'recorded';
      wake();
      break;
    case 'playing':
      if (!d.on) stopBtn.hidden = true;
      break;
    case 'turn':
      break;
    case 'speaker':
      setSpeaker(d.who);
      break;
    case 'caption':
      setCaption(d.who, d.text, { translated: d.translated });
      if (d.who === 'caller' && d.final) { light('t1', true); light('spark', true); checking(true); }
      break;
    case 'verdict':
      st.verdicts.push(d);
      if (d.engine !== 'wonder' && d.engine !== 't1') st.turns = Math.max(st.turns, d.turn || 0);
      if (d.engine === 't1') st.turns = Math.max(st.turns, d.turn || 0);
      light('t1', false);
      light('spark', false);
      checking(false);
      if (d.engine === 'wonder') light('wonder', false);
      addTurnChip(d);
      if (st.state === 'ended' && st.endDetail) queueMicrotask(() => showEnd(st.endDetail));
      setVerdict(d.verdict, d.confidence, [
        d.engine === 't1' ? L('กฎโค้ด: ขอเงินหรือรหัสตรง ๆ', 'Code rule: a hard demand') : d.reason || '',
      ].filter(Boolean).join(' · ').slice(0, 140));
      break;
    case 'wonder':
      light('wonder', d.state === 'start');
      break;
    case 'end':
      checking(false);
      stopClock();
      setState('ended');
      setSpeaker(null);
      stopBtn.hidden = true;
      showEnd(d);
      break;
    default:
      break;
  }
});

// The recorded run, in plain words (filled by scripts/demo-capture.mjs).
let callsMeta = null;
function provenance() {
  const when = callsMeta?.recordedAt ? new Date(callsMeta.recordedAt) : null;
  const date = when ? when.toLocaleString(lang() === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return L('เล่นจากการรันจริงหนึ่งครั้ง', 'Played back from one real run') + (date ? ' · ' + date : '')
    + (callsMeta?.build ? ' · build ' + callsMeta.build : '')
    + L(' · คำตัดสินและเวลาตามที่วัดได้ ไม่ได้แก้ไข', ' · verdicts and timings as measured, unedited');
}

// ---------- tabs ----------
const tabs = [$('tabRec'), $('tabLive')];
function selectTab(t, focus = false) {
  for (const b of tabs) {
    const on = b === t;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $(b.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) t.focus();
  try { sessionStorage.setItem('ds-tab', t.id); } catch { /* storage blocked */ }
}
for (const b of tabs) {
  b.addEventListener('click', () => selectTab(b));
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    selectTab(tabs[(tabs.indexOf(b) + 1) % tabs.length], true);
  });
}
try {
  const saved = sessionStorage.getItem('ds-tab');
  if (saved && $(saved)) selectTab($(saved));
} catch { /* storage blocked */ }

// ---------- recorded call list ----------
const langsEl = $('dsLangs');
const callsEl = $('dsCalls');
let calls = [];
let filter = 'all';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>';
function chipOrder() {
  const first = lang() === 'th' ? ['th', 'en'] : ['en', 'th'];
  return [...first, 'zh', 'vi'].filter((l) => calls.some((c) => c.lang === l));
}
function renderLangs() {
  const items = [['all', L('ทุกภาษา', 'All'), '']];
  for (const l of chipOrder()) {
    const c = calls.find((x) => x.lang === l);
    items.push([l, c.chip, c.probe ? L('ทดสอบ', 'probe') : '']);
  }
  langsEl.replaceChildren(...items.map(([id, label, small]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.lang = id;
    b.setAttribute('aria-pressed', String(filter === id));
    b.append(label);
    if (small) b.append(' ', Object.assign(document.createElement('small'), { textContent: small }));
    b.title = id === 'all' ? '' : L(LANG_NAMES[id][0], LANG_NAMES[id][1]);
    b.addEventListener('click', () => { filter = id; renderLangs(); renderCalls(); });
    return b;
  }));
}
function sortedCalls() {
  const order = chipOrder();
  return calls.filter((c) => filter === 'all' || c.lang === filter)
    .sort((a, b) => (a.class === 'SCAM' ? 0 : 1) - (b.class === 'SCAM' ? 0 : 1) || order.indexOf(a.lang) - order.indexOf(b.lang));
}
function renderCalls() {
  const cur = st.state === 'playing' ? st.recorded?.id : null;
  callsEl.replaceChildren(...sortedCalls().map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ds-call';
    b.dataset.id = c.id;
    if (c.probe) b.dataset.probe = '';
    b.setAttribute('aria-current', String(cur === c.id));
    const lg = Object.assign(document.createElement('span'), { className: 'lg', textContent: c.chip });
    const mid = document.createElement('span');
    const title = Object.assign(document.createElement('b'), { textContent: c.title[lang()] || c.title.en });
    const sub = Object.assign(document.createElement('span'), { className: 's', textContent: (c.sub?.[lang()] || c.sub?.en || '') });
    const ex = Object.assign(document.createElement('span'), { className: 'ex' });
    ex.dataset.v = c.class;
    ex.append(document.createElement('i'), L('คาดว่า: ', 'Expected: ') + L(VERDICT_WORD[c.class][0], VERDICT_WORD[c.class][1]) + ' · ' + L(c.langName.th, c.langName.en)
      + (c.durationMs ? ' · ' + mmss(c.durationMs) : ''));
    mid.append(title, sub, ex);
    const pl = document.createElement('span');
    pl.className = 'pl';
    pl.innerHTML = cur === c.id ? STOP : PLAY;
    b.append(lg, mid, pl);
    b.setAttribute('aria-label', (cur === c.id ? L('หยุด: ', 'Stop: ') : L('เล่น: ', 'Play: ')) + title.textContent);
    b.addEventListener('click', () => {
      if (st.state === 'playing' && st.recorded?.id === c.id) window.kraiDemo?.stop();
      else play(c.id);
    });
    return b;
  }));
}
function markCurrent() { renderCalls(); }
function play(id) {
  window.kraiDemo?.play(id);
  if (matchMedia('(max-width:1060px)').matches) consoleEl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}
document.addEventListener('krai:call', (e) => {
  if (e.detail.type === 'playing' || e.detail.type === 'end' || e.detail.type === 'reset') renderCalls();
});

function loadCalls() {
  if (!window.kraiDemo) { setTimeout(loadCalls, 60); return; }
  window.kraiDemo.calls().then((d) => {
    callsMeta = d;
    calls = d.calls || [];
    renderLangs();
    renderCalls();
  }).catch(() => {
    callsEl.textContent = L('โหลดสายที่อัดไว้ไม่ได้ ลองแท็บสวมบทมิจแทน', 'Could not load the recorded calls: try the live tab.');
  });
}
loadCalls();

// ---------- buttons ----------
stopBtn.addEventListener('click', () => window.kraiDemo?.stop());
$('dsIdlePlay').addEventListener('click', () => {
  const first = calls.find((c) => c.featured) || sortedCalls().find((c) => c.class === 'SCAM') || sortedCalls()[0];
  if (first) play(first.id);
});
$('dsIdleLive').addEventListener('click', () => {
  selectTab($('tabLive'));
  $('micBtn').focus();
});
$('dsEndAgain').addEventListener('click', () => {
  show(endEl, false);
  turnsEl.querySelector('.ds-turn:last-child')?.scrollIntoView({ block: 'nearest' });
});
$('dsEndReport').addEventListener('click', (e) => {
  e.preventDefault();
  $('owner').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
});
// A recorded call stopped by the user: back to the idle card.
document.addEventListener('krai:call', (e) => {
  if (e.detail.type === 'stopped') {
    stopClock();
    setState('idle');
    setSpeaker(null);
    show(idleEl, true);
  }
});

// ---------- language toggle: re-render dynamic text ----------
document.addEventListener('krai:lang', () => {
  setState(st.state);
  setLangName(st.lang);
  setSpeaker(st.speaker);
  if (st.verdict) setVerdict(st.verdict, st.conf, verdictSub.textContent);
  else verdictEl.textContent = L('รอฟัง', 'Listening');
  if (!turnsEl.children.length) emptyTurns();
  if (calls.length) { renderLangs(); renderCalls(); }
  if (st.mode === 'recorded') srcEl.textContent = provenance();
  if (!st.speaker && st.state === 'idle') setCaption(null, L('คำพูดของทั้งสองฝั่งจะขึ้นตรงนี้', 'What both sides say shows up here.'));
});

setState('idle');
emptyTurns();
needle.style.setProperty('--x', '50%');
show(endEl, false);
setSpeaker(null);
setVerdict(null);
setCaption(null, L('คำพูดของทั้งสองฝั่งจะขึ้นตรงนี้', 'What both sides say shows up here.'));
