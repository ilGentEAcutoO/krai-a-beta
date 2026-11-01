/* KRAI-A realtime demo client.
 * Mic -> PCM S16 mono 24 kHz -> OUR Worker (/api/voice/live) -> VoiceCall DO
 * -> Meta Voice WS. The browser never sees the Meta key: auth lives in the
 * DO's handshake frame (repo rule). Events arriving here are already
 * normalized by the relay (voice-shared.js parseEvent shape), so this file
 * only renders turn bands and asks /api/verdict/turn to judge finals.
 * Grey-zone finals (policy.escalate) get a Muse Wonder second opinion via
 * /api/verdict/escalate; a SCAM call can switch to trap mode (/api/trap/reply,
 * docs/trap-mode.md): each caller final gets a stalling line spoken through
 * browser speechSynthesis while the intel panel fills up.
 * No mic? Typed lines and sample replays (samples.json, train corpus only) are
 * fed through onEvent() as speech-start/partial/final — the voice path itself.
 * No build step, no dependency — view-source is the documentation.
 */
import { TurnAssembler } from './voice-shared.js';

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
  if (text !== '(silence)') callLines.push({ speaker: 'caller', text });
  return trap.on ? trapTurn(v) : judgeTurn(turnId, text, v);
}

const TIER = { SCAM: 'Block', LEGIT: 'Allow', UNSURE: 'Escalate' };

async function judgeTurn(turnId, text, node) {
  try {
    // Judge the whole call so far (context matters: authority in turn 1 backs a
    // transfer demand in turn 3); the newest caller line is already in callLines.
    const lines = callLines.length ? recentLines() : [{ speaker: 'caller', text }];
    const data = await apiJson('/api/verdict/turn', { turnId, turnCount: callLines.filter((l) => l.speaker === 'caller').length || 1, lines });
    const verdict = data.policy?.verdict || 'UNSURE';
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
    if (data.policy?.escalate) await escalate(node, data.spark);
    else if (verdict === 'SCAM') offerTrap();
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
    if (verdict === 'SCAM') offerTrap();
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
  trapBtn.setAttribute('aria-pressed', String(on));
  trapBtn.textContent = on ? '■ ปิดกับดัก / Stop trap' : '🪤 เปิดกับดัก / Start trap';
  trapBtn.classList.toggle('live', on);
  clearInterval(trap.tick);
  if (on) {
    trap.startedAt = Date.now();
    trap.token = null; // a new trap: the first reply issues a fresh token
    trap.tick = setInterval(renderClock, 1000); // local clock display only, no network
    trapStatus.textContent = 'กับดักทำงาน — ทุกเทิร์นของผู้โทรจะได้คำตอบช้า ๆ แบบผู้สูงอายุ';
  } else {
    trapStatus.textContent = 'ปิดกับดักแล้ว';
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    speaking = false;
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

function pinReply(text) {
  const div = document.createElement('div');
  div.className = 'band final speaker-ai';
  div.innerHTML = '<div class="who">receptionist · กับดัก</div>';
  const p = document.createElement('div');
  p.textContent = text;
  div.appendChild(p);
  transcriptEl.appendChild(div);
  div.scrollIntoView({ block: 'nearest' });
}

// Browser TTS (th-TH, slow). Mic frames are dropped while it speaks so our
// own voice never comes back as a caller turn.
let speechDone = Promise.resolve(); // replay waits on this between lines
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'th-TH';
  u.rate = 0.85;
  const th = speechSynthesis.getVoices().find((v) => /^th/i.test(v.lang));
  if (th) u.voice = th;
  speaking = true;
  speechDone = new Promise((done) => {
    const end = () => { speaking = false; done(); };
    u.onend = end;
    u.onerror = end;
    setTimeout(end, 4000 + text.length * 250); // some engines never fire onend
  });
  speechSynthesis.speak(u);
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
    speak(data.reply);
    if (data.done) {
      setTrap(false);
      trapStatus.textContent = 'ครบเวลาหรือจำนวนเทิร์นของกับดัก — จบสายแล้ว ข้อมูลที่เก็บได้อยู่ด้านล่าง';
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

/* PCM S16 mono 24 kHz straight off the mic. No Opus: the Meta socket is a
 * raw-PCM socket (docs/demo-live.md §1). Resample in a worklet so the main
 * thread only forwards MessagePort buffers to our relay socket. */
const WORKLET = `
class Pcm24k extends AudioWorkletProcessor {
  constructor() { super(); this._carry = new Float32Array(0); }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const ratio = sampleRate / ${TARGET_HZ};
    const joined = new Float32Array(this._carry.length + ch.length);
    joined.set(this._carry); joined.set(ch, this._carry.length);
    const outLen = Math.floor(joined.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = joined[Math.floor(i * ratio)] || 0;
      out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    this._carry = joined.slice(Math.floor(outLen * ratio));
    this.port.postMessage(out.buffer, [out.buffer]);
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
      if (speaking) return; // trap TTS is playing: never feed our own voice back as caller speech
      if (socket === ws && ws.readyState === WebSocket.OPEN) ws.send(m.data);
    };
    setSess('relay connected, waiting for Meta session…');
  });
  ws.addEventListener('message', (m) => {
    if (typeof m.data !== 'string') return;
    try {
      onEvent(JSON.parse(m.data));
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

function stop() {
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
}

micBtn.addEventListener('click', () => (live ? stop() : start()));
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
  await callerLine(text);
});

// Fresh call for a replay: page-memory state only (the server keeps none).
function resetCall() {
  if (live) stop();
  callLines.length = 0;
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
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  replayStatus.textContent = msg || 'หยุดแล้ว / stopped';
}

async function startReplay() {
  const s = samples.find((x) => x.id === replaySelect.value);
  if (!s) return;
  resetCall();
  const run = ++replay.run;
  setReplaying(true);
  for (let i = 0; i < s.turns.length; i++) {
    if (replay.run !== run) return;
    replayStatus.textContent = 'กำลังเล่น ' + s.id + ' · เทิร์น ' + (i + 1) + '/' + s.turns.length;
    await speechDone; // a trap reply finishes speaking before the caller goes on
    if (replay.run !== run) return;
    await callerLine(s.turns[i], { kind: 'replay', run });
  }
  if (replay.run !== run) return;
  setReplaying(false);
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
