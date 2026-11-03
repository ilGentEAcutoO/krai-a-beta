/* KRAI-A realtime demo client.
 * Mic -> PCM S16 mono 24 kHz -> OUR Worker (/api/voice/live) -> VoiceCall DO
 * -> Meta Voice WS. The browser never sees the Meta key: auth lives in the
 * DO's handshake frame (repo rule). Events arriving here are already
 * normalized by the relay (voice-shared.js parseEvent shape), so this file
 * only renders turn bands and asks /api/verdict/turn to judge finals.
 * Grey-zone finals (policy.escalate) get a Muse Wonder second opinion via
 * /api/verdict/escalate; a SCAM call can switch to trap mode (/api/trap/reply,
 * docs/trap-mode.md): each caller final gets a stalling line spoken in the
 * receptionist's voice while the intel panel fills up. Voice output is Gemini
 * TTS (Meta's API has no TTS; see "receptionist voice" below), with the
 * browser's speechSynthesis + an on-screen caption as the fallback.
 * No mic? Typed lines and sample replays (samples.json, train corpus only) are
 * fed through onEvent() as speech-start/partial/final — the voice path itself.
 * No build step, no dependency — view-source is the documentation.
 */
import { TurnAssembler, createTurnMerger } from './voice-shared.js';
import { mountReportCard } from './report-card.js';
import { paceBuffer } from './pace.js';
import { FOLLOW_UP_FALLBACK_MS, T1_WAIT_MS, askDone, followUp, newCallState, onT1, onVerdict, stageOne } from './receptionist.js';

// Disclosure (G3): every call opens with this line, spoken and pinned, before
// the first judgment. Must equal DISCLOSURE_LINE_TH / _EN in app/src/trap.js.
const DISCLOSURE_LINE_TH = 'ระบบผู้ช่วยรับสายอัตโนมัติรับสายแทนเจ้าของเบอร์ สายนี้มีการบันทึก ขอทราบชื่อและธุระค่ะ';
const DISCLOSURE_LINE_EN = 'An automated answering assistant is taking this call for the owner. This call is recorded. May I have your name and the reason for your call?';

const $ = (id) => document.getElementById(id);
const bandsEl = $('bands');
const transcriptEl = $('transcript');
const sessEl = $('sess');
const micBtn = $('micBtn');
const toastEl = $('toast');

const TARGET_HZ = 24000;
// 128 random bits (hex) — unguessable, and fits the server's [A-Za-z0-9-]{1,64}.
const callId = 'call-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
let ctx = null;
let stream = null;
let socket = null;
let sessionId = null;
let live = false;
const assembler = new TurnAssembler();
const bandNodes = new Map(); // turnId -> { band, who, txt, bar }
let untracked = 0;
const speakers = new Map();
const callLines = []; // [{ speaker:'caller'|'receptionist', text }] — whole call, page memory only
// Newest lines that fit the server caps (40 lines, 12k chars total).
function recentLines(max = 40, budget = 11000) {
  const out = [];
  let used = 0;
  for (let i = callLines.length - 1; i >= 0 && out.length < max; i--) {
    const l = { speaker: callLines[i].speaker, text: callLines[i].text.slice(0, 2000) };
    if (used + l.text.length > budget) break;
    used += l.text.length;
    out.unshift(l);
  }
  return out;
}

/* Session gate (contract: src/abuse.js). GET /api/config says whether
 * Turnstile is on; POST /api/session trades a Turnstile token (or nothing,
 * in no-turnstile mode) for a 30-min token kept in sessionStorage and sent
 * as x-krai-session (or ?s= on the WebSocket). A 401 refreshes it once. */
let sessionPromise = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => ok(window.turnstile);
    s.onerror = () => fail(new Error('turnstile-load'));
    document.head.appendChild(s);
  });
}
async function turnstileToken(siteKey) {
  const ts = await loadTurnstile();
  let box = document.getElementById('ts-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ts-box';
    box.style.margin = '8px 0';
    (micBtn?.parentElement || document.body).appendChild(box);
  }
  box.innerHTML = '';
  // Usually invisible; when Cloudflare asks for a click, say so (B12: a
  // headed run sat on "connecting relay…" with the checkbox unexplained).
  setSess('ยืนยันในกล่อง Cloudflare ก่อนเริ่ม (ถ้ามีให้กด) / complete the Cloudflare check if it asks');
  return new Promise((ok, fail) => {
    ts.render(box, {
      sitekey: siteKey,
      action: 'session',
      callback: (t) => { box.innerHTML = ''; ok(t); },
      'error-callback': () => fail(new Error('turnstile-failed')),
    });
  });
}
/* Server refusals carry messageTh/messageEn (src/abuse.js). 503 paused/budget
 * and 429 halt the demo: shown inline, replay stops — never an alert(). */
class ApiError extends Error {
  constructor(status, data = {}) {
    super(data.messageTh || data.error || ('http ' + status));
    this.status = status;
    this.code = data.error || '';
    this.messageTh = data.messageTh || '';
    this.messageEn = data.messageEn || '';
    this.retryAfter = Number(data.retryAfter) || 0;
    this.halt = status === 429 || status === 503;
  }
}

async function newSession() {
  const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  const body = {};
  if (cfg.turnstile && cfg.turnstileSiteKey) body.turnstileToken = await turnstileToken(cfg.turnstileSiteKey);
  const res = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new ApiError(res.status, data);
  try { sessionStorage.setItem('krai-session', data.token); sessionStorage.setItem('krai-session-exp', String(data.expiresAt || '')); } catch { /* storage blocked */ }
  return data.token;
}
function storedSession() {
  try {
    const t = sessionStorage.getItem('krai-session');
    const exp = Number(sessionStorage.getItem('krai-session-exp')) || 0;
    if (t && (!exp || exp - Date.now() > 60000)) return t;
  } catch { /* storage blocked */ }
  return null;
}
async function ensureSession(force = false) {
  if (!force) {
    const t = storedSession();
    if (t) return t;
  }
  if (!sessionPromise) sessionPromise = newSession().finally(() => { sessionPromise = null; });
  return sessionPromise;
}

/* Every /api call goes through here: attaches the session, retries once on 401. */
async function apiFetch(url, init = {}, retried = false) {
  const headers = new Headers(init.headers || {});
  headers.set('x-krai-session', await ensureSession(retried));
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && !retried) return apiFetch(url, init, true);
  return res;
}
async function apiJson(url, body) {
  const res = await apiFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new ApiError(res.status, data);
  return data;
}

const apiNotice = $('apiNotice');
// Inline (not a toast, not an alert): stays until the next successful verdict.
function showHalt(e) {
  apiNotice.textContent = '';
  const th = document.createElement('span');
  th.textContent = (e.messageTh || 'เดโมไม่พร้อมตอนนี้') + (e.retryAfter ? ' (รอ ' + e.retryAfter + ' วินาที)' : '');
  const en = document.createElement('span');
  en.className = 'en';
  en.textContent = e.messageEn || ('HTTP ' + e.status + (e.code ? ' · ' + e.code : ''));
  apiNotice.append(th, en);
  apiNotice.hidden = false;
  stopReplay('หยุดเล่นแล้ว — เซิร์ฟเวอร์ปฏิเสธ (' + (e.code || e.status) + ')');
}
// Every judge/escalate/trap/file failure lands here; returns the inline text.
function failed(e, prefix) {
  if (e?.halt) showHalt(e);
  return prefix + ' (' + e.message + ')';
}
const clearHalt = () => { apiNotice.hidden = true; };

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 6000);
}

function setSess(t) {
  sessEl.textContent = t;
}

function bandFor(turnId) {
  if (!bandNodes.has(turnId)) {
    const band = document.createElement('div');
    band.className = 'band listening';
    band.innerHTML = '<div class="who"></div><div class="txt">กำลังฟัง…</div><div class="bar"><i></i></div>';
    bandsEl.appendChild(band);
    bandNodes.set(turnId, { band, who: band.querySelector('.who'), txt: band.querySelector('.txt'), bar: band.querySelector('.bar i') });
  }
  return bandNodes.get(turnId);
}

function pinFinal(turn, turnId, speaker) {
  const node = bandNodes.get(turnId);
  if (node) node.band.remove();
  bandNodes.delete(turnId);
  const div = document.createElement('div');
  div.className = 'band final' + (speaker === 'B' ? ' speaker-B' : '');
  const text = (turn.complete || turn.final || turn.partials[turn.partials.length - 1] || '').trim() || '(silence)';
  div.innerHTML = '<div class="who"></div>';
  div.querySelector('.who').textContent = 'turn ' + turnId + (speaker ? ' · speaker ' + speaker : '');
  const p = document.createElement('div');
  p.textContent = text;
  div.appendChild(p);
  const v = document.createElement('div');
  v.className = 'verdict';
  v.textContent = 'กำลังตัดสิน…';
  div.appendChild(v);
  transcriptEl.appendChild(div);
  div.scrollIntoView({ block: 'nearest' });
  if (text !== '(silence)') {
    callLines.push({ speaker: 'caller', text });
    // Spark starts now; stage 1 waits up to T1_WAIT_MS for the T1 code rules
    // so a hard demand is closed, never answered with a question.
    const holder = { turn: null };
    const t1p = trap.on ? Promise.resolve(null) : fetchT1(turnId);
    stage1(t1p, v, holder, text);
    return trap.on ? trapTurn(v) : judgeTurn(turnId, text, v, holder);
  }
  return trap.on ? trapTurn(v) : judgeTurn(turnId, text, v, null);
}

const TIER = { SCAM: 'Block', LEGIT: 'Allow', UNSURE: 'Escalate' };
// The one place a turn is sent to the judge.
const postVerdict = (body) => apiJson('/api/verdict/turn', body);

async function judgeTurn(turnId, text, node, holder = null) {
  try {
    // Judge the whole call so far (context matters: authority in turn 1 backs a
    // transfer demand in turn 3); the newest caller line is already in callLines.
    const lines = callLines.length ? recentLines() : [{ speaker: 'caller', text }];
    const data = await postVerdict({ turnId, turnCount: callLines.filter((l) => l.speaker === 'caller').length || 1, lines });
    const verdict = data.policy?.verdict || 'UNSURE';
    call.verdict = verdict;
    const conf = typeof data.policy?.confidence === 'number' ? ' · ' + Math.round(data.policy.confidence * 100) + '%' : '';
    const rule = data.policy?.rule ? ' · ' + data.policy.rule : '';
    node.innerHTML = '';
    const chip = document.createElement('span');
    chip.className = 'tier tier-' + (TIER[verdict] || 'Escalate');
    chip.textContent = TIER[verdict] || verdict;
    const detail = document.createElement('span');
    detail.textContent = (data.spark?.tactic || '—') + conf + rule + ' → ' + (data.action || '—');
    node.append(chip, detail);
    clearHalt();
    // Stage 2 from Spark's fields for this turn; Wonder (if asked) can only close.
    afterVerdict(verdict, data.action, { signals: data.spark?.signals, tactic: data.spark?.tactic, turn: holder?.turn ?? null });
    if (data.policy?.escalate) await escalate(node, data.spark);
  } catch (e) {
    node.textContent = failed(e, 'ตัดสินไม่ได้');
  }
}

// ---- T3: Muse Wonder second opinion for the grey zone ----
async function escalate(node, spark) {
  const box = document.createElement('div');
  box.className = 'wonder';
  box.innerHTML = '<span class="tier tier-Wonder">Wonder</span> <span class="wtxt">กำลังตรวจละเอียด…</span>';
  node.after(box);
  const txt = box.querySelector('.wtxt');
  try {
    const data = await apiJson('/api/verdict/escalate', {
      lines: recentLines(),
      spark,
      turnCount: callLines.filter((l) => l.speaker === 'caller').length,
    });
    const w = data.wonder;
    const verdict = data.policy?.verdict || 'UNSURE';
    call.verdict = verdict;
    const conf = typeof data.policy?.confidence === 'number' ? ' · ' + Math.round(data.policy.confidence * 100) + '%' : '';
    const chip = document.createElement('span');
    chip.className = 'tier tier-' + (TIER[verdict] || 'Escalate');
    chip.textContent = TIER[verdict] || verdict;
    txt.textContent = (w?.engine === 'wonder' ? '' : '(ใช้ผลเดิม) ') + (w?.reasonTh || '') + conf + ' → ' + (data.action || '—');
    txt.before(chip, ' ');
    if (w?.evidence?.length) {
      const ul = document.createElement('ul');
      ul.className = 'evidence';
      for (const q of w.evidence) {
        const li = document.createElement('li');
        li.textContent = '“' + q + '”';
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    afterVerdict(verdict, data.action);
  } catch (e) {
    txt.textContent = failed(e, 'ตรวจละเอียดไม่ได้') + ' — ใช้ผลเดิม';
  }
}

// ---- trap mode: กับดัก 10 นาที ----
const trapCard = $('trapCard');
const trapBtn = $('trapBtn');
const trapClock = $('trapClock');
const trapStatus = $('trapStatus');
const intelEl = $('intel');
const TRAP_MS = 10 * 60 * 1000;
// trapToken: server-signed {start time, reply count}; the 10-min / 20-reply
// caps are enforced from it on the server. startedAt here only drives the clock.
const trap = { on: false, startedAt: 0, intel: [], tick: null, busy: false, token: null };
let speaking = false;

function offerTrap() {
  if (!trapCard.hidden) return;
  trapCard.hidden = false;
  trapStatus.textContent = 'สายนี้เข้าข่ายมิจฉาชีพ — เปิดกับดักเพื่อถ่วงเวลาและเก็บข้อมูลที่ผู้โทรเผยออกมา';
}

const mmss = (ms) => {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
function renderClock() {
  const ms = trap.on ? Date.now() - trap.startedAt : 0;
  trapClock.textContent = mmss(Math.min(ms, TRAP_MS)) + ' / 10:00';
  trapClock.classList.toggle('over', trap.on && ms >= TRAP_MS);
}

function setTrap(on) {
  trap.on = on;
  rx.state.trap = on;
  trapBtn.setAttribute('aria-pressed', String(on));
  trapBtn.textContent = on ? '■ ปิดกับดัก / Stop trap' : '⏳ เปิดกับดัก / Start trap';
  trapBtn.classList.toggle('live', on);
  clearInterval(trap.tick);
  if (on) {
    trap.startedAt = Date.now();
    trap.token = null; // a new trap: the first reply issues a fresh token
    trap.tick = setInterval(renderClock, 1000); // local clock display only, no network
    trapStatus.textContent = 'กับดักทำงาน — ผู้ช่วยจะตอบช้า ๆ ถามซ้ำ ให้สะกด เพื่อถ่วงเวลา';
  } else {
    trapStatus.textContent = 'ปิดกับดักแล้ว';
    stopAudio();
  }
  renderClock();
}
trapBtn.addEventListener('click', () => setTrap(!trap.on));

const INTEL_LABEL = {
  'bank-account': 'บัญชีม้า', bank: 'ธนาคาร', name: 'ชื่อที่อ้าง', badge: 'เลขประจำตัว/คดี', phone: 'เบอร์โทร',
  'line-id': 'LINE', url: 'ลิงก์', amount: 'ยอดที่เรียก', organisation: 'หน่วยงานที่อ้าง',
};
function renderIntel() {
  intelEl.innerHTML = '';
  if (!trap.intel.length) {
    intelEl.innerHTML = '<p class="empty">ยังไม่มี — เลขบัญชี ไลน์ ชื่อ ที่ผู้โทรพูดออกมาจะขึ้นตรงนี้</p>';
    return;
  }
  for (const it of trap.intel) {
    const row = document.createElement('div');
    row.className = 'intel-row';
    const k = document.createElement('span');
    k.className = 'ik';
    k.textContent = INTEL_LABEL[it.type] || it.type;
    const v = document.createElement('span');
    v.className = 'iv';
    v.textContent = it.value;
    const q = document.createElement('span');
    q.className = 'iq';
    q.textContent = '“' + it.quote + '”';
    row.append(k, v, q);
    intelEl.appendChild(row);
  }
}

function pinReply(text, { who = 'receptionist · กับดัก', sub = '' } = {}) {
  const div = document.createElement('div');
  div.className = 'band final speaker-ai';
  div.innerHTML = '<div class="who"></div>';
  div.querySelector('.who').textContent = who;
  const p = document.createElement('div');
  p.textContent = text;
  div.appendChild(p);
  if (sub) {
    const en = document.createElement('div');
    en.className = 'sub-en';
    en.textContent = sub;
    div.appendChild(en);
  }
  transcriptEl.appendChild(div);
  div.scrollIntoView({ block: 'nearest' });
  return div;
}

// ---- receptionist turn-taking (G9, src/receptionist.js) ----
// Every caller turn gets an instant canned line; the verdict then decides:
// SCAM -> polite close (or the trap, per the family's choice), LEGIT done ->
// take-message close. The voice is Gemini TTS (voice output only: Meta's API
// has no text-to-speech), speechSynthesis as the fallback; see speak().
const scamPolicyEl = $('scamPolicy');
const rx = { state: newCallState({ scamPolicy: scamPolicyEl?.value }) };
scamPolicyEl?.addEventListener('change', () => { rx.state.scamPolicy = scamPolicyEl.value; });
let lastCallerActivity = 0;
const RX_WHO = {
  askWho: 'receptionist · ถามชื่อ', askCallback: 'receptionist · ขอเบอร์ทางการ', takeMessage: 'receptionist · รับฝากเรื่อง',
  askPurpose: 'receptionist · ถามธุระ', backchannel: 'receptionist',
  ack: 'receptionist', trapFiller: 'receptionist · กับดัก', close: 'receptionist · ปิดสาย',
  disclosure: 'receptionist · แจ้งว่าเป็นระบบอัตโนมัติ',
};
// The caller is speaking right now (a live turn band) or was heard in the
// last 300 ms: a follow-up started now would collide with them.
const callerTalking = () => bandNodes.size > 0 || Date.now() - lastCallerActivity < 300;
function say(line, who = 'receptionist') {
  if (!line) return Promise.resolve();
  callLines.push({ speaker: 'receptionist', text: line });
  const band = pinReply(line, { who });
  if (band) spokenBands.set(line, band);
  return speak(line);
}
// Bands of question lines still playing, by text (cancel target).
const spokenBands = new Map();
// A close or trap was decided while a question was still queued or playing
// (late T1, a SCAM verdict): stop it so a hard demand goes straight to the
// close, strike it in the transcript and drop it from the call record.
function cancelAsk(c) {
  if (!c) return;
  stopAudio(); // Gemini audio + any speechSynthesis fallback
  const band = spokenBands.get(c.line);
  if (band) {
    band.classList.add('cancelled');
    const who = band.querySelector('.who');
    if (who) who.textContent += ' · ยกเลิก (ปิดสายแทน) / cancelled';
  }
  for (let i = callLines.length - 1; i >= 0; i--) {
    if (callLines[i].speaker === 'receptionist' && callLines[i].text === c.line) {
      callLines.splice(i, 1);
      break;
    }
  }
}
// T1: code rules for an explicit hard demand (OTP / app / transfer now),
// no model, answered in milliseconds by POST /api/verdict/t1. A hit lets the
// receptionist act at once; Spark's verdict still decides what is recorded.
async function fetchT1(turnId) {
  try {
    const data = await apiJson('/api/verdict/t1', { turnId, lines: recentLines() });
    return data.t1 || null;
  } catch {
    return null; // T1 is a shortcut only; the Spark verdict still runs
  }
}
function t1Chip(node, rule) {
  const chip = document.createElement('div');
  chip.className = 'verdict t1';
  chip.innerHTML = '<span class="tier tier-Block">Block</span> <span></span>';
  chip.lastChild.textContent = 'T1 ' + rule + ' · กฎโค้ดตัดสินทันที / instant code rule (Spark กำลังยืนยัน)';
  node.before(chip);
}
// `text` = the caller's final words: the receptionist answers in their language (B27).
async function stage1(t1p, node, holder, text) {
  const rule = await Promise.race([t1p, new Promise((ok) => setTimeout(() => ok(undefined), T1_WAIT_MS))]);
  if (rule) t1Chip(node, rule);
  const { t1Step, reply } = stageOne(rx.state, rule || null, text);
  if (t1Step) applyStep(t1Step);
  if (reply) {
    say(reply.line, RX_WHO[reply.kind] || reply.kind).then(() => askDone(rx.state, reply.line));
    holder.turn = reply.turn;
    // No verdict in time (slow model, error): ask the next unasked question anyway.
    setTimeout(() => applyStep(followUp(rx.state, { turn: reply.turn, callerTalking: callerTalking() })), FOLLOW_UP_FALLBACK_MS);
  }
  // T1 slower than the wait: it still closes, just after the stage-1 line.
  if (rule === undefined) {
    const late = await t1p;
    if (late && !rx.state.t1) {
      t1Chip(node, late);
      applyStep(onT1(rx.state, late));
    }
  }
}
function applyStep(r) {
  if (r.cancelAsk) cancelAsk(r.cancelAsk);
  if (r.step === 'close') {
    say(r.line, RX_WHO.close);
    speechDone.then(() => {
      if (live) stop({ report: false });
      if (replay.on) stopReplay('จบสายแล้ว — ผู้ช่วยวางสายสุภาพ');
      endCall(r.endedBy);
    });
  } else if (r.step === 'trap') {
    offerTrap();
    if (!trap.on) setTrap(true);
  } else if (r.step === 'ask') {
    say(r.line, RX_WHO[r.kind] || 'receptionist').then(() => askDone(rx.state, r.line));
  }
}
function afterVerdict(verdict, action, { signals, tactic, turn } = {}) {
  const wasT1 = rx.state.t1 && !rx.state.t1Overruled;
  const r = onVerdict(rx.state, { verdict, action, signals, tactic, turn, callerTalking: callerTalking() });
  if (wasT1 && rx.state.t1Overruled) toast('T1 overruled: Spark said ' + verdict + ' (สายปิดไปแล้ว ไม่เปิดใหม่)');
  if (r.step === 'close' || r.step === 'trap' || r.step === 'ask') applyStep(r);
  else if (verdict === 'SCAM') {
    offerTrap();
  }
}

// ---- one call: disclosure at the start, family report at the end ----
// call.opened: the disclosure was spoken; call.reported: the report card is
// mounted (a later mic start / typed line / replay begins a new call).
const call = { opened: false, reported: false, verdict: null };
const reportEl = $('reportCard');
const endCallBtn = $('endCallBtn');
const callerCount = () => callLines.filter((l) => l.speaker === 'caller').length;
function openCall() {
  if (call.reported) resetCall();
  if (call.opened) return;
  call.opened = true;
  callLines.push({ speaker: 'receptionist', text: DISCLOSURE_LINE_TH });
  transcriptEl.querySelector('.empty')?.remove();
  pinReply(DISCLOSURE_LINE_TH, { who: 'receptionist · เปิดสาย / opening', sub: DISCLOSURE_LINE_EN });
  speak(DISCLOSURE_LINE_TH);
  endCallBtn.hidden = false;
}
function endCall(endedBy) {
  if (call.reported || !callerCount()) return;
  call.reported = true;
  endCallBtn.hidden = true;
  mountReportCard(reportEl, { apiJson, lines: recentLines(), intel: trap.intel, endedBy, verdict: call.verdict || 'UNSURE' });
}

// ---- receptionist voice (B20) ----
// Voice OUTPUT only: Meta's Model API has no text-to-speech, so the
// receptionist speaks in one Gemini TTS voice (src/tts.js). Every decision in
// the call is still a Meta model. Three sources, best first:
//   1. fixed lines (disclosure, questions, closes, canned trap lines):
//      pre-generated static files, /audio/manifest.json -> plays at once;
//   2. a trap line Spark just wrote: POST /api/tts with the server's speak
//      token for that exact line (the route refuses anything else);
//   3. fallback when 1-2 fail, are capped or paused: the browser's
//      speechSynthesis (th-TH). The caption under the mic shows every line,
//      so a device with no Thai voice still gets every word.
// Lines play one after another. Mic frames are replaced by silence while
// anything is queued or playing (`speaking`), so our own voice never comes
// back as a caller turn.
let speechDone = Promise.resolve(); // replay waits on this between lines
const voice = {
  ctx: null, manifest: null, decoded: new Map(), current: null, chain: Promise.resolve(), pending: 0,
  gen: 0, cancelled: null, cancel: null, thaiVoice: null,
};
const captionEl = $('rxCaption');
const captionText = $('rxCaptionText');
const captionSrc = $('rxCaptionSrc');
function newCancel() {
  voice.cancelled = new Promise((ok) => { voice.cancel = ok; });
}
newCancel();
function playbackCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!voice.ctx && AC) voice.ctx = new AC();
  return voice.ctx;
}
// Browsers start audio only after a user gesture: every press resumes it.
for (const ev of ['pointerdown', 'keydown']) {
  addEventListener(ev, () => {
    const c = playbackCtx();
    if (c && c.state !== 'running') c.resume().catch(() => {});
  }, { capture: true, passive: true });
}
function loadManifest() {
  if (!voice.manifest) voice.manifest = fetch('/audio/manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return voice.manifest;
}
loadManifest();
function hasThaiVoice() {
  if (voice.thaiVoice === null && 'speechSynthesis' in window) {
    const vs = speechSynthesis.getVoices();
    if (vs.length) voice.thaiVoice = vs.find((v) => /^th/i.test(v.lang)) || false;
  }
  return Boolean(voice.thaiVoice);
}
if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', () => { voice.thaiVoice = null; hasThaiVoice(); });

function decode(bytes) {
  const c = playbackCtx();
  if (!c) return Promise.resolve(null);
  return new Promise((ok, fail) => {
    const p = c.decodeAudioData(bytes, ok, fail);
    if (p && typeof p.then === 'function') p.then(ok, fail);
  });
}
// -> { buf, src } or null (null = fall back to the browser voice).
async function audioFor(text, ttsToken) {
  const m = await loadManifest();
  const file = m?.lines?.[text.trim()];
  if (file) {
    const url = '/audio/' + file;
    if (!voice.decoded.has(url)) {
      voice.decoded.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('audio ' + r.status)))).then(decode));
    }
    const buf = await voice.decoded.get(url).catch((e) => { voice.decoded.delete(url); throw e; });
    return buf ? { buf, src: 'static' } : null;
  }
  if (!ttsToken) return null;
  const res = await apiFetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ttsToken }) });
  if (!res.ok) throw new Error('tts ' + res.status);
  const raw = await decode(await res.arrayBuffer());
  // Same pace as the fixed lines: trim pauses + the median stretch (pace.js).
  const buf = raw && paceBuffer(playbackCtx(), raw, Number(m?.liveTempo) || 1);
  return buf ? { buf, src: 'live' } : null;
}
function playBuffer(buf) {
  const c = playbackCtx();
  return new Promise((done) => {
    let fired = false;
    const end = () => {
      if (fired) return;
      fired = true;
      voice.current = null;
      done();
    };
    try {
      if (c.state !== 'running') c.resume().catch(() => {});
      const node = c.createBufferSource();
      node.buffer = buf;
      node.connect(c.destination);
      node.onended = end;
      voice.current = node;
      node.start();
      // Engines that never fire onended (suspended context): end on the clock.
      setTimeout(end, buf.duration * 1000 + 1500);
    } catch {
      end();
    }
  });
}
function speakBrowser(text) {
  // No speech engine at all: caption only, with time to read it.
  if (!('speechSynthesis' in window)) return new Promise((ok) => setTimeout(ok, 600 + text.length * 60));
  return new Promise((done) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'th-TH';
    u.rate = 1.1; // brisk, like the AI voice (user: "much too slow")
    if (hasThaiVoice()) u.voice = voice.thaiVoice;
    let fired = false;
    const end = () => {
      if (fired) return;
      fired = true;
      done();
    };
    u.onend = end;
    u.onerror = end;
    setTimeout(end, 1500 + text.length * 150); // engines that never fire onend
    speechSynthesis.speak(u);
  });
}
const CAPTION_SRC = {
  static: 'เสียง AI · Gemini TTS (voice output only — Meta API has no TTS)',
  live: 'เสียง AI · Gemini TTS (voice output only — Meta API has no TTS)',
  browser: 'เสียงเบราว์เซอร์ (สำรอง) / browser voice (fallback)',
  none: 'เครื่องนี้ไม่มีเสียงไทย อ่านซับแทน / no Thai voice on this device: read the caption',
};
function showCaption(text, src) {
  if (!captionEl) return;
  captionText.textContent = text;
  captionSrc.textContent = CAPTION_SRC[src] || '';
  captionEl.dataset.src = src;
  captionEl.hidden = false;
}
function hideCaption() {
  // A device that can't voice Thai keeps the last line on screen.
  if (captionEl && captionEl.dataset.src !== 'none') captionEl.hidden = true;
}
function speak(text, { ttsToken = null } = {}) {
  if (!text) return Promise.resolve();
  const gen = voice.gen;
  const cancelled = voice.cancelled;
  voice.pending += 1;
  speaking = true;
  // Fetch + decode now, in parallel with whatever is still playing.
  const ready = audioFor(text, ttsToken).catch(() => null);
  const mine = voice.chain.then(async () => {
    if (gen !== voice.gen) return;
    const a = await Promise.race([ready, cancelled.then(() => 'cancel')]);
    if (a === 'cancel' || gen !== voice.gen) return;
    if (a) {
      showCaption(text, a.src);
      await Promise.race([playBuffer(a.buf), cancelled]);
    } else {
      showCaption(text, hasThaiVoice() ? 'browser' : 'none');
      await Promise.race([speakBrowser(text), cancelled]);
    }
    if (gen === voice.gen) hideCaption();
  }).finally(() => {
    voice.pending = Math.max(0, voice.pending - 1);
    if (!voice.pending) speaking = false;
  });
  voice.chain = mine.catch(() => {});
  speechDone = voice.chain;
  return mine;
}
// Stop the line playing now and drop every queued one.
function stopAudio() {
  voice.gen += 1;
  voice.cancel?.();
  newCancel();
  try { voice.current?.stop(); } catch { /* already ended */ }
  voice.current = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (captionEl) {
    captionEl.hidden = true;
    captionEl.dataset.src = '';
  }
}

async function trapTurn(node) {
  node.innerHTML = '<span class="tier tier-Trap">Trap</span> <span class="ttxt">กำลังคิดคำตอบถ่วงเวลา…</span>';
  const txt = node.querySelector('.ttxt');
  if (trap.busy) { txt.textContent = 'รวมไปกับเทิร์นถัดไป'; return; }
  trap.busy = true;
  try {
    const data = await apiJson('/api/trap/reply', { lines: recentLines(), intel: trap.intel, trapToken: trap.token });
    if (data.trapToken) trap.token = data.trapToken;
    if (typeof data.elapsedMs === 'number') trap.startedAt = Date.now() - data.elapsedMs; // follow the server clock
    if (!trap.on) return; // switched off while waiting
    trap.intel = Array.isArray(data.intel) ? data.intel : trap.intel;
    renderIntel();
    txt.textContent = (data.guarded ? 'ประโยคสำรอง (guard)' : 'Spark') + ' · ' + mmss(data.elapsedMs)
      + ' · เทิร์น ' + data.callerTurns + '/' + (data.limits?.maxTurns || 20);
    callLines.push({ speaker: 'receptionist', text: data.reply });
    pinReply(data.reply);
    speak(data.reply, { ttsToken: data.ttsToken });
    if (data.done) {
      setTrap(false);
      trapStatus.textContent = 'ครบเวลาหรือจำนวนเทิร์นของกับดัก — จบสายแล้ว ข้อมูลที่เก็บได้อยู่ด้านล่าง';
      if (live) stop({ report: false });
      endCall('trap-done');
    }
  } catch (e) {
    txt.textContent = failed(e, 'กับดักตอบไม่ได้');
  } finally {
    trap.busy = false;
  }
}


function onEvent(ev) {
  switch (ev.type) {
    case 'ready':
      sessionId = ev.sessionId;
      setSess('call ' + callId + ' · session ' + sessionId);
      break;
    case 'speech-start': {
      lastCallerActivity = Date.now();
      const id = ev.turnId ?? 'u' + (++untracked);
      const b = bandFor(id);
      b.who.textContent = 'turn ' + id;
      b.band.className = 'band listening';
      b.txt.textContent = 'กำลังฟัง…';
      assembler.feed({ type: 'speech-start', turnId: id });
      break;
    }
    case 'partial': {
      const id = ev.turnId ?? [...bandNodes.keys()].pop() ?? 'u' + (++untracked);
      const b = bandFor(id);
      b.band.className = 'band partial';
      b.who.textContent = 'turn ' + id + ' · partial';
      b.txt.textContent = ev.transcript;
      b.bar.style.width = Math.min(100, Math.round((ev.audioProcessedMs / 15000) * 100)) + '%';
      assembler.feed({ type: 'partial', turnId: id, transcript: ev.transcript });
      lastCallerActivity = Date.now();
      break;
    }
    case 'final':
    case 'speech-complete': {
      const id = ev.turnId ?? [...bandNodes.keys()].pop();
      if (id == null) break;
      assembler.feed({ type: ev.type === 'final' ? 'final' : 'speech-complete', turnId: id, transcript: ev.transcript });
      const turn = assembler.byId(id);
      const judged = turn ? pinFinal(turn, id, speakers.get(id)) : bandNodes.get(id)?.band.remove();
      bandNodes.delete(id);
      speakers.delete(id);
      return judged; // typed/replayed lines await this; the relay socket ignores it
    }
    case 'speech-end':
      break;
    case 'speaker':
      if (ev.turnId) speakers.set(ev.turnId, ev.label);
      break;
    case 'turns':
      setSess('reconnected · ' + (ev.texts?.length || 0) + ' turns on server');
      break;
    case 'error':
      toast('Voice: ' + (ev.message || 'error'));
      break;
    default:
      break;
  }
}

/* Relay frames go through the tail-fragment merger first (voice-shared.js
 * createTurnMerger): Meta sometimes ends a turn and opens a new one for the
 * last word ("…ได้เลย" + "ค่ะ"). A final waits 400 ms; a fragment that starts
 * in that window is judged together with its sentence, as one turn. Typed and
 * replayed lines skip this (they await their own judgment). */
const merger = createTurnMerger({
  onTurn: ({ turnId, text, merged }) => {
    for (const id of merged) {
      bandNodes.get(id)?.band.remove();
      bandNodes.delete(id);
      speakers.delete(id);
    }
    onEvent({ type: 'speech-complete', turnId, transcript: text });
  },
});
function onRelayEvent(ev) {
  if (ev.type === 'speech-start') {
    merger.speechStart(ev.turnId);
    return onEvent(ev);
  }
  if (ev.type === 'final' || ev.type === 'speech-complete') {
    const id = ev.turnId ?? [...bandNodes.keys()].pop();
    if (id == null) return undefined;
    if (!String(ev.transcript || '').trim()) return onEvent(ev); // (silence) band, nothing to judge
    merger.final(id, ev.transcript);
    return undefined;
  }
  return onEvent(ev);
}

/* PCM S16 mono 24 kHz straight off the mic. No Opus: the Meta socket is a
 * raw-PCM socket (docs/demo-live.md §1). Resample in a worklet so the main
 * thread only forwards MessagePort buffers to our relay socket. */
const WORKLET = `
class Pcm24k extends AudioWorkletProcessor {
  constructor() {
    super();
    this._carry = new Float32Array(0);
    // 100 ms per WebSocket frame. One frame per 128-sample render quantum was
    // ~370 frames/s: every one wakes the Durable Object (B12, measured).
    this._frame = new Int16Array(${TARGET_HZ / 10});
    this._fill = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const ratio = sampleRate / ${TARGET_HZ};
    const joined = new Float32Array(this._carry.length + ch.length);
    joined.set(this._carry); joined.set(ch, this._carry.length);
    const outLen = Math.floor(joined.length / ratio);
    for (let i = 0; i < outLen; i++) {
      const s = joined[Math.floor(i * ratio)] || 0;
      this._frame[this._fill++] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
      if (this._fill === this._frame.length) {
        const out = this._frame;
        this.port.postMessage(out.buffer, [out.buffer]);
        this._frame = new Int16Array(${TARGET_HZ / 10});
        this._fill = 0;
      }
    }
    this._carry = joined.slice(Math.floor(outLen * ratio));
    return true;
  }
}
registerProcessor('pcm24k', Pcm24k);
`;

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    micBtn.textContent = '🎙 ไมค์ถูกปฏิเสธ — คลิกเพื่อลองใหม่';
    toast('เปิดไมค์ไม่ได้ — หรือใช้ไฟล์ .wav ด้านล่างแทน');
    return;
  }
  ctx = new AudioContext();
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm24k');
  src.connect(node);

  live = true;
  openCall();
  micBtn.classList.add('live');
  micBtn.textContent = '■ หยุดฟัง';
  setSess('connecting relay…');
  await connect(node, false);
}

// One relay socket. If it dies before Meta's 'ready' (expired session,
// cold relay), retry ONCE with a forced fresh session and a new socket.
async function connect(node, retried) {
  let sess;
  try {
    sess = await ensureSession(retried);
  } catch (e) {
    toast('เริ่มเซสชันไม่ได้: ' + e.message);
    stop();
    return;
  }
  if (!live) return; // stopped while the session was loading
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/api/voice/live?call=' + encodeURIComponent(callId) + '&s=' + encodeURIComponent(sess));
  socket = ws;
  ws.binaryType = 'arraybuffer';
  ws.addEventListener('open', () => {
    node.port.onmessage = (m) => {
      if (socket !== ws || ws.readyState !== WebSocket.OPEN) return;
      // While our own TTS plays (disclosure / trap line) the caller's mic is
      // replaced by silence, never dropped: Meta closes a session whose audio
      // falls behind real time ("Ingress audio slower than real-time"), and
      // the caller's next sentence was lost in the reconnect (B12, measured).
      ws.send(speaking ? new ArrayBuffer(m.data.byteLength) : m.data);
    };
    setSess('relay connected, waiting for Meta session…');
  });
  ws.addEventListener('message', (m) => {
    if (typeof m.data !== 'string') return;
    try {
      onRelayEvent(JSON.parse(m.data));
    } catch { /* one bad frame never kills the call */ }
  });
  let handled = false;
  const dead = () => {
    if (handled || socket !== ws || !live) return; // stale socket or user stop
    handled = true;
    if (!sessionId && !retried) {
      setSess('reconnecting with a fresh session…');
      connect(node, true);
    } else if (!sessionId) {
      toast('ต่อ Voice ไม่ได้ตอนนี้ — ลองไฟล์ .wav ด้านล่าง หรือกลับมาใหม่');
      stop();
    } else {
      toast('สายหลุด — ข้อความที่ตัดสินแล้วอยู่ด้านล่าง');
      stop();
    }
  };
  ws.addEventListener('close', dead);
  ws.addEventListener('error', dead);
}

// The user stopping the mic is the hang-up: the report follows. Internal
// stops (new call, trap done) pass { report: false }.
function stop({ report = true } = {}) {
  merger.flush(); // a held final is still judged
  const wasLive = live;
  live = false;
  micBtn.classList.remove('live');
  micBtn.textContent = '🎙 เริ่มฟัง';
  try { socket?.close(); } catch { /* already gone */ }
  socket = null;
  try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
  stream = null;
  if (ctx) ctx.close().catch(() => {});
  ctx = null;
  sessionId = null;
  setSess('idle · ' + callId);
  if (report && wasLive) endCall('hangup');
}

micBtn.addEventListener('click', () => (live ? stop() : start()));
endCallBtn.addEventListener('click', () => {
  if (live) stop();
  else endCall('hangup');
});
setSess('idle · ' + callId);

$('wavBtn').addEventListener('click', async () => {
  const f = $('wavFile').files[0];
  if (!f) { toast('เลือกไฟล์ .wav ก่อน'); return; }
  const buf = await f.arrayBuffer();
  $('wavBtn').disabled = true;
  try {
    const res = await apiFetch('/api/voice/file', { method: 'POST', body: buf });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new ApiError(res.status, data);
    const id = 'file-' + Date.now().toString(36);
    assembler.feed({ type: 'speech-start', turnId: id });
    assembler.feed({ type: 'speech-complete', turnId: id, transcript: data.transcript });
    pinFinal(assembler.byId(id), id, null);
  } catch (e) {
    toast(failed(e, 'ไฟล์ fallback ล้มเหลว'));
  } finally {
    $('wavBtn').disabled = false;
  }
});

// ---- No mic: type the caller's lines, or replay a sample call ----
// Both drive onEvent() with the same speech-start / partial / final events the
// relay sends, so pinning, whole-call judging, Wonder escalation and trap
// replies (spoken by TTS) are the voice path itself — nothing is forked.
const typeForm = $('typeForm');
const typeInput = $('typeInput');
const typeBtn = $('typeBtn');
const replaySelect = $('replaySelect');
const replayBtn = $('replayBtn');
const replayStopBtn = $('replayStopBtn');
const replayStatus = $('replayStatus');
let localTurns = 0;
let samples = [];
const replay = { run: 0, on: false };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** One caller line through the voice event path. Resolves once it is judged
 *  (verdict + Wonder second opinion, or the trap reply). */
async function callerLine(text, { kind = 'typed', run = null } = {}) {
  const turnId = kind + '-' + (++localTurns);
  onEvent({ type: 'speech-start', turnId });
  if (run != null) {
    // Replay: the line appears as growing partials over ~1.5 s + its length.
    const total = 1500 + Math.min(4000, text.length * 35);
    const words = text.split(/(\s+)/);
    const steps = Math.max(1, Math.min(8, Math.ceil(words.length / 2)));
    for (let i = 1; i <= steps; i++) {
      await wait(total / steps);
      if (replay.run !== run) {
        bandNodes.get(turnId)?.band.remove();
        bandNodes.delete(turnId);
        return undefined;
      }
      const shown = words.slice(0, Math.ceil((words.length * i) / steps)).join('');
      onEvent({ type: 'partial', turnId, transcript: shown, audioProcessedMs: (15000 * i) / steps });
    }
  }
  return onEvent({ type: 'final', turnId, transcript: text });
}

typeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = typeInput.value.trim();
  if (!text || replay.on) return;
  typeInput.value = '';
  openCall();
  await callerLine(text);
});

// Fresh call for a replay: page-memory state only (the server keeps none).
function resetCall() {
  if (live) stop({ report: false });
  callLines.length = 0;
  call.opened = false;
  call.reported = false;
  call.verdict = null;
  rx.state = newCallState({ scamPolicy: scamPolicyEl?.value });
  reportEl.replaceChildren();
  endCallBtn.hidden = true;
  transcriptEl.innerHTML = '<p class="empty">เทิร์นที่จบแล้วจะถูกปักหมุดพร้อม tier ตรงนี้</p>';
  for (const n of bandNodes.values()) n.band.remove();
  bandNodes.clear();
  if (trap.on) setTrap(false);
  trap.intel = [];
  trap.token = null;
  renderIntel();
  trapCard.hidden = true;
  trapStatus.textContent = '';
  clearHalt();
}

function setReplaying(on) {
  replay.on = on;
  const refocus = !on && document.activeElement === replayStopBtn;
  replayBtn.hidden = on;
  replayStopBtn.hidden = !on;
  replaySelect.disabled = on || !samples.length;
  typeInput.disabled = on;
  typeBtn.disabled = on;
  if (refocus) replayBtn.focus();
}

function stopReplay(msg) {
  if (!replay.on) return;
  replay.run++;
  setReplaying(false);
  stopAudio();
  replayStatus.textContent = msg || 'หยุดแล้ว / stopped';
}

async function startReplay() {
  const s = samples.find((x) => x.id === replaySelect.value);
  if (!s) return;
  resetCall();
  const run = ++replay.run;
  setReplaying(true);
  openCall();
  for (let i = 0; i < s.turns.length; i++) {
    if (replay.run !== run) return;
    replayStatus.textContent = 'กำลังเล่น ' + s.id + ' · เทิร์น ' + (i + 1) + '/' + s.turns.length;
    await speechDone; // the receptionist / trap line finishes before the caller goes on
    if (replay.run !== run || rx.state.closed) return;
    await callerLine(s.turns[i], { kind: 'replay', run });
  }
  if (replay.run !== run) return;
  setReplaying(false);
  await speechDone;
  endCall(trap.on ? 'trap-done' : 'hangup');
  replayStatus.textContent = 'จบสายตัวอย่าง ' + s.id + ' (ผลที่คาด: ' + s.class + ') — พิมพ์ต่อได้เลย';
}
replayBtn.addEventListener('click', startReplay);
replayStopBtn.addEventListener('click', () => stopReplay());

fetch('./samples.json')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
  .then((data) => {
    samples = Array.isArray(data.samples) ? data.samples : [];
    replaySelect.innerHTML = '';
    for (const x of samples) {
      const o = document.createElement('option');
      o.value = x.id;
      o.textContent = x.labelTh + ' · ' + x.labelEn;
      replaySelect.appendChild(o);
    }
    replaySelect.disabled = !samples.length;
    replayBtn.disabled = !samples.length;
  })
  .catch(() => {
    replaySelect.innerHTML = '<option value="">โหลดสายตัวอย่างไม่ได้ — พิมพ์เองได้</option>';
  });
