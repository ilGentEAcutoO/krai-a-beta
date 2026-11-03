// Meta Voice client (new): realtime protocol + chunked file transcription.
// Realtime: the Worker/DO opens VOICE_WS, sends the handshake frame (auth
// lives ONLY in that frame — the Authorization header is ignored), streams
// PCM_24KHZ binary frames, and parses events into turns (TurnAssembler).
// Chunked: POST a WAV to VOICE_FILE (fallback + accuracy measurement).
export const VOICE_WS = 'wss://api.meta.ai/v1/asr/realtime';
export const VOICE_FILE = 'https://api.meta.ai/v1/asr/transcribe';
export const VOICE_MODEL = 'muse-voice-transcribe-1.0';
export const VOICE_MODES = ['PUSH_TO_TALK', 'ENDPOINTING', 'DIARIZATION'];

// languageBias stays ['Thai'] for every call, English and Mandarin callers
// included (B27, scripts/realuse-voices.mjs, 3 runs x 70 phone-band clips):
// Thai CER 5.2% with ['Thai'] vs 6.2% with ['Thai','English','Mandarin
// Chinese'] and 5.9% with no bias (Thai worse in 3 of 3 runs); English WER
// 6.4 / 6.2 / 6.1% and Mandarin CER 4.9 / 4.3 / 5.4% are the same within
// run-to-run noise. A Meta session cannot change its bias mid-call.
export function buildHandshake({ apiKey, mode = 'PUSH_TO_TALK', languageBias = ['Thai'], keywords = [] } = {}) {
  if (!VOICE_MODES.includes(mode)) throw new Error(`bad-voice-mode: ${mode}`);
  if (!apiKey) throw new Error('missing-voice-key');
  return {
    // Meta rejects the session without it ("You must specify the 'model'
    // attribute") — found on the first live run, 2026-11-01.
    model: VOICE_MODEL,
    authorization: { accessToken: `Bearer ${apiKey}` },
    audioEncoding: 'PCM_24KHZ',
    mode,
    languageBias,
    ...(keywords.length ? { keywords } : {}),
  };
}

// Wire events use an `event` (or `type`) discriminator. Never throws:
// garbage becomes { type:'unknown' } so one bad frame can't kill the call.
export function parseEvent(raw) {
  let msg;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { type: 'unknown' };
  }
  if (!msg || typeof msg !== 'object') return { type: 'unknown' };
  if (msg.sessionId && !msg.event && !msg.type) return { type: 'ready', sessionId: String(msg.sessionId) };
  const name = msg.event || msg.type || msg.kind;
  switch (name) {
    case 'speechStart':
    case 'speech_start':
      return { type: 'speech-start', turnId: msg.turnId ?? null };
    case 'speechEnd':
    case 'speech_end':
      return { type: 'speech-end', turnId: msg.turnId ?? null };
    case 'speechComplete':
    case 'speech_complete':
      return { type: 'speech-complete', turnId: msg.turnId ?? null, transcript: String(msg.transcript || '') };
    case 'transcript':
      return {
        type: msg.final ? 'final' : 'partial',
        turnId: msg.turnId ?? null,
        transcript: String(msg.transcript || ''),
        audioProcessedMs: Number(msg.audioProcessedMs) || 0,
      };
    case 'speaker':
      return { type: 'speaker', turnId: msg.turnId ?? null, label: String(msg.label || msg.speaker || '') };
    case 'error':
      return { type: 'error', message: String(msg.message || msg.error || 'voice-error') };
    default:
      return { type: 'unknown' };
  }
}

// Turns can overlap: every event keys on turnId. Partials carry no turnId —
// they belong to the most recent speechStart (null when none arrived yet).
export class TurnAssembler {
  constructor() {
    this.turns = [];
    this.currentTurnId = null;
  }

  feed(evt) {
    switch (evt.type) {
      case 'speech-start':
        this.currentTurnId = evt.turnId;
        this.turns.push({ turnId: evt.turnId, partials: [], final: null, complete: null, speaker: null });
        break;
      case 'partial': {
        const t = this.current();
        if (t && evt.transcript) t.partials.push(evt.transcript);
        break;
      }
      case 'final': {
        const t = this.byId(evt.turnId) || this.current();
        if (t) t.final = evt.transcript;
        break;
      }
      case 'speech-end':
        break; // boundary only; text arrives via transcript/speechComplete
      case 'speech-complete': {
        const t = this.byId(evt.turnId) || this.current();
        if (t) t.complete = evt.transcript;
        break;
      }
      case 'speaker': {
        const t = this.byId(evt.turnId) || this.current();
        if (t) t.speaker = evt.label;
        break;
      }
      default:
        break;
    }
    return this;
  }

  byId(turnId) {
    return this.turns.find((t) => t.turnId === turnId) || null;
  }

  current() {
    if (this.currentTurnId == null && !this.turns.length) {
      this.turns.push({ turnId: null, partials: [], final: null, complete: null, speaker: null });
    }
    return this.byId(this.currentTurnId) || this.turns[this.turns.length - 1] || null;
  }

  // Best text per turn: post-processed complete > final > last partial.
  texts() {
    return this.turns.map((t) => t.complete || t.final || t.partials[t.partials.length - 1] || '');
  }

  reset() {
    this.turns = [];
    this.currentTurnId = null;
  }
}

// Chunked file transcription: WAV mono 16-bit (16/24 kHz) -> transcript.
// Multipart shape mirrors the R1b probe: `request` JSON part + `audio` file.
export async function transcribeFile({ fetch, apiKey, wavBytes, languageBias = ['Thai'], timeoutMs = 60000 } = {}) {
  const doFetch = fetch || globalThis.fetch;
  const req = { model: VOICE_MODEL, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK', languageBias };
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify(req)], { type: 'application/json' }));
  const bytes = wavBytes instanceof ArrayBuffer ? new Uint8Array(wavBytes) : wavBytes;
  form.append('audio', new File([bytes], 'chunk.wav', { type: 'audio/wav' }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await doFetch(VOICE_FILE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: ctrl.signal,
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = body?.error?.code || `voice-http-${res.status}`;
      throw new Error(code);
    }
    return {
      transcript: String(body.transcript ?? body.text ?? ''),
      model: VOICE_MODEL,
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('voice-timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---- realtime relay -------------------------------------------------------
// The protocol brain behind the browser -> DO -> Meta hop (spike 41). The DO
// shell (voice-do.js) injects the transport; tests inject fakes. Owns:
// Meta socket lifecycle (open -> handshake -> ready), client<->Meta
// forwarding, and the authoritative TurnAssembler keyed on turnId.
// A socket-like needs: send(), close(), readyState (1 = open),
// addEventListener('open'|'message'|'close'|'error', fn).
export const WS_OPEN = 1;
export const WS_CONNECTING = 0;
// A Meta socket that died is re-opened at most this often (B12: a dead
// session must not turn every audio frame into a new connection).
export const REOPEN_MIN_MS = 1000;

export function createRelay({
  openMeta, sendToClient, onFinal, apiKey,
  metaUrl = VOICE_WS, mode = 'ENDPOINTING', languageBias = ['Thai'], keywords = [],
  now = () => Date.now(), reopenMinMs = REOPEN_MIN_MS,
} = {}) {
  if (typeof openMeta !== 'function') throw new Error('relay-needs-openMeta');
  if (typeof sendToClient !== 'function') throw new Error('relay-needs-sendToClient');
  const handshake = buildHandshake({ apiKey, mode, languageBias, keywords }); // validates key + mode
  const assembler = new TurnAssembler();
  const stats = { metaOpens: 0, forwarded: 0, dropped: 0, resumed: 0 };
  let meta = null;
  let ready = false;
  let sessionId = null;
  let alive = true;
  let lastOpenAt = -Infinity;

  function emit(obj) {
    try {
      sendToClient(JSON.stringify(obj));
    } catch { /* client gone; shell cleans up */ }
  }

  function onMetaMessage(data) {
    const ev = parseEvent(typeof data === 'string' ? data : String(data || ''));
    if (ev.type === 'ready') {
      ready = true;
      sessionId = ev.sessionId;
      emit({ type: 'ready', sessionId });
      return;
    }
    if (ev.type === 'unknown') return;
    assembler.feed(ev);
    emit(ev);
    if (ev.type === 'final' || ev.type === 'speech-complete') {
      const turn = assembler.byId(ev.turnId) || assembler.current();
      if (turn && typeof onFinal === 'function') {
        try {
          onFinal({ turnId: turn.turnId, text: turn.complete || turn.final || '', speaker: turn.speaker });
        } catch { /* persistence is best-effort; client already has the text */ }
      }
    }
  }

  // Events from a socket we already replaced are ignored (B12: a stale
  // socket's close used to null out the live one).
  function onMetaGone(sock, reason) {
    if (sock !== meta) return;
    ready = false;
    meta = null;
    if (!alive) return;
    emit({ type: 'error', message: `meta-voice: ${reason}; reconnecting on next audio` });
  }

  // A CONNECTING socket is kept (B12 real-use bug: the browser streams
  // ~370 small frames/s from the first moment, and every frame used to close
  // the still-connecting socket and open a new one, so Meta never got ready).
  function ensureMeta() {
    if (meta && (meta.readyState === WS_OPEN || meta.readyState === WS_CONNECTING)) return meta;
    if (meta) {
      try { meta.close(); } catch { /* already dead */ }
      meta = null;
    }
    ready = false;
    if (now() - lastOpenAt < reopenMinMs) return null;
    lastOpenAt = now();
    const sock = openMeta(metaUrl);
    meta = sock;
    stats.metaOpens += 1;
    if (stats.metaOpens > 1) stats.resumed += 1;
    sock.addEventListener('open', () => {
      if (sock !== meta) return;
      try {
        sock.send(JSON.stringify(handshake));
      } catch {
        onMetaGone(sock, 'handshake-send-failed');
      }
    });
    sock.addEventListener('message', (m) => {
      if (sock === meta) onMetaMessage(m?.data ?? m);
    });
    sock.addEventListener('close', () => onMetaGone(sock, 'closed'));
    sock.addEventListener('error', () => onMetaGone(sock, 'error'));
    return sock;
  }

  return {
    stats,
    turns: () => assembler.texts(),
    turnCount: () => assembler.turns.length,
    session: () => ({ ready, sessionId, metaOpens: stats.metaOpens }),

    clientConnected() {
      alive = true;
      ensureMeta();
    },

    // Binary PCM -> Meta (dropped + counted until the Meta session is ready).
    // Text JSON -> local control ({ type:'get-turns' }).
    onClientMessage(data) {
      if (typeof data === 'string') {
        let msg = null;
        try { msg = JSON.parse(data); } catch { return; }
        if (msg?.type === 'get-turns') emit({ type: 'turns', texts: assembler.texts() });
        return;
      }
      const sock = ensureMeta();
      if (!sock || !ready || sock.readyState !== WS_OPEN) {
        stats.dropped += 1;
        return;
      }
      try {
        sock.send(data);
        stats.forwarded += 1;
      } catch {
        stats.dropped += 1;
      }
    },

    onClientGone() {
      alive = false;
      if (meta) {
        try { meta.close(); } catch { /* noop */ }
        meta = null;
      }
      ready = false;
    },
  };
}

export function looksLikeWav(bytes) {
  const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return b.length > 12
    && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 // RIFF
    && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45; // WAVE
}

// ---- tail-fragment merge (B12 real-use fix) ----
// Meta endpointing sometimes splits off the last word of a sentence as its
// own turn ("…โทรกลับได้เลย" + "ค่ะ", the new turn starts <100 ms after the
// previous one ended). Judging that fragment as a new turn costs a Spark call
// and shows a one-word band. So a final is held for graceMs. If a new turn
// starts in that window and ends within capMs, both are judged as ONE turn.
// Otherwise the held final goes out alone (latency cost: graceMs, small next
// to a multi-second verdict).
export const MERGE = { graceMs: 400, capMs: 1500 };

export function createTurnMerger({ onTurn, graceMs = MERGE.graceMs, capMs = MERGE.capMs, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof onTurn !== 'function') throw new Error('merger-needs-onTurn');
  let held = null; // { turnId, text, timer, follow }
  const flush = () => {
    if (!held) return;
    const h = held;
    held = null;
    clearTimer(h.timer);
    onTurn({ turnId: h.turnId, text: h.text, merged: h.merged || [] });
  };
  return {
    speechStart(turnId) {
      if (!held || held.follow != null) return;
      held.follow = turnId;
      clearTimer(held.timer);
      held.timer = setTimer(flush, capMs);
    },
    final(turnId, text) {
      const t = String(text || '').trim();
      if (held && held.follow != null && held.follow === turnId) {
        const h = held;
        clearTimer(h.timer);
        held = null;
        if (t) {
          onTurn({ turnId: h.turnId, text: h.text + ' ' + t, merged: [...(h.merged || []), turnId] });
        } else {
          onTurn({ turnId: h.turnId, text: h.text, merged: h.merged || [] });
        }
        return;
      }
      flush();
      if (!t) return;
      held = { turnId, text: t, follow: null, timer: setTimer(flush, graceMs) };
    },
    flush,
    pending: () => Boolean(held),
  };
}
