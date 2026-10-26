/* KRAI-A realtime demo client.
 * Mic -> PCM S16 mono 24 kHz -> OUR Worker (/api/voice/live) -> VoiceCall DO
 * -> Meta Voice WS. The browser never sees the Meta key: auth lives in the
 * DO's handshake frame (repo rule). Events arriving here are already
 * normalized by the relay (voice-shared.js parseEvent shape), so this file
 * only renders turn bands and asks /api/verdict/turn to judge finals.
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
const callId = 'call-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
let ctx = null;
let stream = null;
let socket = null;
let sessionId = null;
let live = false;
const assembler = new TurnAssembler();
const bandNodes = new Map(); // turnId -> { band, who, txt, bar }
let untracked = 0;
const speakers = new Map();

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
  judgeTurn(turnId, text, v);
}

const TIER = { SCAM: 'Block', LEGIT: 'Allow', UNSURE: 'Escalate' };

async function judgeTurn(turnId, text, node) {
  try {
    const res = await fetch('/api/verdict/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnId, turnCount: transcriptEl.children.length, lines: [{ speaker: 'caller', text }] }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ('http ' + res.status));
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
  } catch (e) {
    node.textContent = 'ตัดสินไม่ได้ (' + e.message + ')';
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
      if (turn) pinFinal(turn, id, speakers.get(id));
      else bandNodes.get(id)?.band.remove();
      bandNodes.delete(id);
      speakers.delete(id);
      break;
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

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(proto + '//' + location.host + '/api/voice/live?call=' + encodeURIComponent(callId));
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('open', () => {
    node.port.onmessage = (m) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(m.data);
    };
    setSess('relay connected, waiting for Meta session…');
  });
  socket.addEventListener('message', (m) => {
    if (typeof m.data !== 'string') return;
    try {
      onEvent(JSON.parse(m.data));
    } catch { /* one bad frame never kills the call */ }
  });
  const dead = () => {
    if (!sessionId) {
      toast('ต่อ Voice ไม่ได้ตอนนี้ — ลองไฟล์ .wav ด้านล่าง หรือกลับมาใหม่');
      stop();
    } else {
      toast('สายหลุด — ข้อความที่ตัดสินแล้วอยู่ด้านล่าง');
      stop();
    }
  };
  socket.addEventListener('close', dead);
  socket.addEventListener('error', dead);

  live = true;
  micBtn.classList.add('live');
  micBtn.textContent = '■ หยุดฟัง';
  setSess('connecting relay…');
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
    const res = await fetch('/api/voice/file', { method: 'POST', body: buf });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ('http ' + res.status));
    const id = 'file-' + Date.now().toString(36);
    assembler.feed({ type: 'speech-start', turnId: id });
    assembler.feed({ type: 'speech-complete', turnId: id, transcript: data.transcript });
    pinFinal(assembler.byId(id), id, null);
  } catch (e) {
    toast('ไฟล์ fallback ล้มเหลว: ' + e.message);
  } finally {
    $('wavBtn').disabled = false;
  }
});
