// Receptionist voice OUTPUT only (B20). Meta's Model API has no
// text-to-speech, so the receptionist's spoken lines are synthesized with
// Google's Gemini TTS. Every DECISION in a call (ASR, verdict, trap line,
// report) is a Meta model; this module only turns our own finished lines
// into audio.
//
// Two paths:
//   1. Fixed lines (disclosure, backchannel, questions, closes, canned trap
//      lines) are pre-generated once by scripts/tts-pregen.mjs into
//      public/audio/*.mp3 + manifest.json and played as static files: $0 at
//      run time, no Google call.
//   2. Trap lines Spark writes live are synthesized by POST /api/tts. That
//      route only speaks text THIS server produced for THIS caller: the trap
//      route returns an HMAC token over sha256(text) + the session's IP hash
//      + a 2-minute expiry, and /api/tts refuses anything else. So the route
//      can't be used as a free TTS service (B23 security check).
// Pure helpers + one fetch; no Worker globals, so node:test can drive it.

export const TTS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
// Checked live 2026-11-03 (GET /v1beta/models + speech-generation docs):
// gemini-3.8-flash-tts is the newest GA TTS and the 3.8 TTS that supports
// Thai (flash-lite-tts does not list Thai).
export const TTS_MODEL = 'gemini-3.8-flash-tts';
// Tier 1 caps flash-tts at 100 requests/day. On 429 the live route retries
// the same voice + prompt on flash-lite-tts (separate quota). The docs don't
// list Thai for lite; measured 2026-11-03 on 3 receptionist lines through a
// phone-band copy + Meta ASR: CER 0 / 0 / 1.2%.
export const TTS_FALLBACK_MODEL = 'gemini-3.8-flash-lite-tts';
// Chosen from 3 female prebuilt voices by Meta ASR CER on a phone-band copy
// of the same lines (scripts/tts-pregen.mjs --samples; B20 report).
export const TTS_VOICE = 'Sulafat';
// Pace (user, 2026-11-03: "much too slow; real people talk faster"): a brisk
// call-centre pace in the prompt, then tts-pregen.mjs trims silence, caps
// pauses at 250 ms and time-stretches (pitch kept) to ~5.75 Thai syllables/s
// measured. Live trap lines get the same trim + the median stretch in the
// browser (public/pace.js, manifest.liveTempo).
export const TTS_STYLE = 'a brisk, friendly Thai call-centre receptionist on a phone line; fast natural conversational pace, about six syllables per second, no long pauses, clear and polite';
export const PACE_TARGET_SYL_PER_SEC = { th: 5.75, en: 4.5 };
export const PACE_MAX_PAUSE_MS = 250;
export const TTS_SAMPLE_RATE = 24000;
// Pricing (USD per 1M tokens), checked 2026-11-03: text in $0.50, audio out
// $9.00; audio is 25 tokens per second.
export const TTS_PRICE = { input: 0.5, output: 9 };
export const TTS_TOKENS_PER_SEC = 25;
// Trap lines are <=160 chars (trap.guardTrapLine). The route refuses more.
export const TTS_MAX_CHARS = 200;
export const TTS_TOKEN_TTL_MS = 2 * 60 * 1000;

export function ttsBody(text, { voice = TTS_VOICE, style = TTS_STYLE, model = TTS_MODEL, sampleRate = TTS_SAMPLE_RATE } = {}) {
  const content = { type: 'text', text: String(text) };
  if (style) content.annotations = [{ type: 'speech_metadata', style }];
  return {
    model,
    input: [{ type: 'user_input', content: [content] }],
    response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: sampleRate },
    generation_config: { speech_config: [{ voice }] },
    store: false,
  };
}

export function ttsUsd(usage = {}) {
  const u = usage || {};
  const input = Number(u.total_input_tokens ?? u.input_tokens) || 0;
  const output = Number(u.total_output_tokens ?? u.output_tokens) || 0;
  return (input * TTS_PRICE.input + output * TTS_PRICE.output) / 1e6;
}

// Worst case for one line, reserved before the call. Thai speech runs
// ~10-15 chars/s; assume a very slow 4 chars/s plus 3 s of padding, and every
// UTF-8 byte (plus the style prompt) as one input token.
export function ttsWorstUsd(text) {
  const chars = [...String(text || '')].length;
  const seconds = 3 + chars / 4;
  const inTok = new TextEncoder().encode(String(text || '') + TTS_STYLE).byteLength + 64;
  return (inTok * TTS_PRICE.input + seconds * TTS_TOKENS_PER_SEC * TTS_PRICE.output) / 1e6;
}

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

// -> { audio: Uint8Array, mimeType, usage, costUsd }. Throws 'tts-...' errors.
export async function synthesize({ fetch: doFetch = (...a) => globalThis.fetch(...a), apiKey, text, timeoutMs = 20000, ...opts } = {}) {
  if (!apiKey) throw new Error('tts-no-key');
  let res;
  try {
    res = await doFetch(TTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(ttsBody(text, opts)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(/abort|timeout/i.test(String(e?.name || e?.message)) ? 'tts-timeout' : 'tts-network');
  }
  if (!res.ok) throw new Error(`tts-http-${res.status}`);
  const j = await res.json().catch(() => null);
  const part = (j?.steps || []).flatMap((s) => s?.content || []).find((p) => p?.type === 'audio' && p.data);
  if (!part) throw new Error('tts-no-audio');
  return { audio: b64ToBytes(part.data), mimeType: String(part.mime_type || 'audio/wav'), model: j.model || opts.model || TTS_MODEL, usage: j.usage || {}, costUsd: ttsUsd(j.usage) };
}

// ---- server-issued speak token ----
// token = "t1.<exp ms>.<b64url(HMAC-SHA256(key, "t1.<exp>.<ipHash>.<sha256(text)>"))>"
// key is domain-separated from SESSION_SECRET. The text itself travels next
// to the token; the server recomputes its hash, so any edit breaks the MAC.
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (ch) => ch.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hmacKey = (secret) => crypto.subtle.importKey('raw', enc.encode(`krai-tts-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export const textHash = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));

export async function signTtsToken(secret, { text, ipHash = '', now = Date.now(), ttlMs = TTS_TOKEN_TTL_MS }) {
  const exp = now + ttlMs;
  const msg = `t1.${exp}.${ipHash}.${await textHash(text)}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg));
  return `t1.${exp}.${b64url(sig)}`;
}

// -> { ok: true } or { ok: false, error }. Never throws.
export async function verifyTtsToken(secret, token, { text, ipHash = '', now = Date.now() } = {}) {
  try {
    const str = String(token || '');
    const parts = str.split('.');
    if (str.length > 120 || parts.length !== 3 || parts[0] !== 't1' || !/^\d{1,15}$/.test(parts[1])) return { ok: false, error: 'tts-token-invalid' };
    const exp = Number(parts[1]);
    const msg = `t1.${exp}.${ipHash}.${await textHash(text)}`;
    const good = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(parts[2]), enc.encode(msg));
    if (!good) return { ok: false, error: 'tts-token-invalid' };
    if (exp <= now) return { ok: false, error: 'tts-token-expired' };
    if (exp > now + TTS_TOKEN_TTL_MS + 5000) return { ok: false, error: 'tts-token-invalid' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'tts-token-invalid' };
  }
}
