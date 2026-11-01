// Spend + rate ledgers for the public demo (B7 abuse guard).
//
// Two Durable Objects, both SQLite-backed (migration v2), both fetch-RPC so
// plain node:test can drive them with a Map-backed storage stub:
//   Budget     one global instance ("global"): USD spent per UTC day, kept in
//              integer micro-dollars so reserve/settle never drift.
//   RateLimit  one instance per salted IP hash ("ip-<hash>"), never a raw IP:
//              fixed-window counters per route kind + live-call slots.
// Storage reads/writes inside one handler run behind the DO input gate, so
// each read-modify-write below is atomic without explicit locking.
import { PRICING } from './eval.js';

export const DEFAULT_DAILY_USD_CAP = 5;
export const VOICE_USD_PER_HOUR = 0.18; // https://dev.meta.ai/docs/pricing-rate-limits.md
export const MICRO = 1e6;

export const toMicros = (usd) => Math.max(0, Math.round((Number(usd) || 0) * MICRO));
export const fromMicros = (m) => Math.round(Number(m) || 0) / MICRO;
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function capUsd(env) {
  const raw = String(env?.DAILY_USD_CAP ?? '').trim();
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_USD_CAP;
}

// Spark cost from the usage block Meta returns (OpenAI-style names first,
// then the short names our eval ledger uses).
export function sparkUsd(usage = {}, p = PRICING.meta.spark) {
  const u = usage || {};
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? u.input) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens ?? u.output) || 0;
  const cachedRaw = Number(u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? u.cached) || 0;
  const cached = Math.min(Math.max(cachedRaw, 0), input);
  return ((input - cached) * p.input + cached * p.cached + output * p.output) / 1e6;
}

export const voiceUsd = (seconds) => (Math.max(0, Number(seconds) || 0) * VOICE_USD_PER_HOUR) / 3600;

// Worst-case cost of one text-model call, for the budget reservation.
// Token upper bound: byte-level BPE never emits more tokens than UTF-8 bytes,
// so inputBytes (the bytes we will send) bounds input tokens; overheadTokens
// covers the fixed prompt (system + few-shot), maxOutputTokens the reply
// including reasoning. `price` is USD per 1M tokens { input, output }.
export function worstCaseUsd({ inputBytes = 0, overheadTokens = 0, maxOutputTokens = 0, price = PRICING.meta.spark } = {}) {
  const inTok = Math.max(0, Number(inputBytes) || 0) + Math.max(0, Number(overheadTokens) || 0);
  return (inTok * price.input + Math.max(0, Number(maxOutputTokens) || 0) * price.output) / 1e6;
}

export const utf8Bytes = (s) => new TextEncoder().encode(String(s ?? '')).byteLength;

// Lowest plausible audio rate (8 kHz, 8-bit, mono). The WAV header is client
// data, so a forged byteRate must never make an upload look shorter than the
// bytes could possibly play.
export const MIN_AUDIO_BYTES_PER_SEC = 8000;
export function voiceFileUsd(buf) {
  const bytes = buf?.byteLength || 0;
  return voiceUsd(Math.max(wavSeconds(buf), bytes / MIN_AUDIO_BYTES_PER_SEC));
}

// WAV duration from the RIFF chunks (fmt byteRate + data size). Falls back to
// 16 kHz mono 16-bit when the header is truncated, so cost is never NaN.
export function wavSeconds(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf?.buffer || []);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  let byteRate = 0;
  let dataBytes = -1;
  let o = 12;
  while (o + 8 <= bytes.byteLength) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (id === 'fmt ' && o + 20 <= bytes.byteLength) byteRate = dv.getUint32(o + 16, true); // fmt: fmt(2) ch(2) rate(4) byteRate(4)
    if (id === 'data') {
      dataBytes = Math.min(size, bytes.byteLength - (o + 8));
      break;
    }
    o += 8 + size + (size % 2);
  }
  if (dataBytes < 0) dataBytes = Math.max(0, bytes.byteLength - 44);
  return dataBytes / (byteRate > 0 ? byteRate : 32000);
}

// Worker -> DO call (fetch RPC). Throws on non-2xx so callers fail closed.
export async function doCall(ns, name, op, body = {}) {
  const stub = ns.get(ns.idFromName(name));
  const res = await stub.fetch(`https://do.internal/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`do-${op}-${res.status}`);
  return res.json();
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const BUDGET_NAME = 'global';
export const rateName = (ipHash) => `ip-${ipHash}`;

async function dispatch(obj, ops, request) {
  const op = new URL(request.url).pathname.replace(/^\//, '');
  if (request.method !== 'POST' || !ops.includes(op)) return new Response('not-found', { status: 404 });
  const body = await request.json().catch(() => ({}));
  return Response.json(await obj[op](body || {}));
}

export class Budget {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  fetch(request) {
    return dispatch(this, ['reserve', 'settle', 'status'], request);
  }

  // Reserve an estimate before a model call. Refuses when it would cross the cap.
  async reserve({ day, micros, capMicros }) {
    if (!DAY_RE.test(String(day))) return { ok: false, error: 'bad-day', spentMicros: 0 };
    const key = `spent:${day}`;
    const prev = await this.state.storage.get(key);
    if (prev === undefined) await this.prune(day);
    const spent = Number(prev) || 0;
    const want = Math.max(0, Math.round(Number(micros) || 0));
    if (spent + want > Number(capMicros)) return { ok: false, spentMicros: spent };
    await this.state.storage.put(key, spent + want);
    return { ok: true, spentMicros: spent + want };
  }

  // Replace the estimate with the actual cost (delta may be negative).
  async settle({ day, deltaMicros }) {
    if (!DAY_RE.test(String(day))) return { ok: false, error: 'bad-day' };
    const key = `spent:${day}`;
    const spent = Math.max(0, (Number(await this.state.storage.get(key)) || 0) + Math.round(Number(deltaMicros) || 0));
    await this.state.storage.put(key, spent);
    return { ok: true, spentMicros: spent };
  }

  async status({ day }) {
    return { ok: true, spentMicros: Number(await this.state.storage.get(`spent:${day}`)) || 0 };
  }

  // Keep only today + yesterday (late settles of calls that crossed midnight).
  async prune(day) {
    const yesterday = utcDay(Date.parse(`${day}T00:00:00Z`) - 1);
    const all = await this.state.storage.list({ prefix: 'spent:' });
    const old = [...all.keys()].filter((k) => k !== `spent:${day}` && k !== `spent:${yesterday}`);
    if (old.length) await this.state.storage.delete(old);
  }
}

const BIG = 1e9;
const secondsToNextUtcDay = (now) => Math.ceil((Date.parse(`${utcDay(now)}T00:00:00Z`) + 86400000 - now) / 1000);

export class RateLimit {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  fetch(request) {
    return dispatch(this, ['hit', 'liveAcquire', 'liveRelease'], request);
  }

  // Fixed windows: per UTC minute and per UTC day. Counts only accepted hits.
  async hit({ kind, perMin = BIG, perDay = BIG, now = Date.now() }) {
    const key = `rl:${kind}`;
    const minute = Math.floor(now / 60000);
    const day = utcDay(now);
    const rec = (await this.state.storage.get(key)) || {};
    const minCount = rec.minute === minute ? rec.minCount : 0;
    const dayCount = rec.day === day ? rec.dayCount : 0;
    if (dayCount >= perDay) return { ok: false, scope: 'day', retryAfter: secondsToNextUtcDay(now) };
    if (minCount >= perMin) return { ok: false, scope: 'minute', retryAfter: Math.max(1, Math.ceil(((minute + 1) * 60000 - now) / 1000)) };
    await this.state.storage.put(key, { minute, minCount: minCount + 1, day, dayCount: dayCount + 1 });
    return { ok: true };
  }

  // Live calls: concurrent slots (each expires at ttl even if release is
  // lost) + a daily start counter.
  async liveAcquire({ id, now = Date.now(), maxConcurrent = 3, perDay = 20, ttlMs = 660000 }) {
    const live = (await this.state.storage.get('live')) || {};
    for (const [k, exp] of Object.entries(live)) if (exp <= now) delete live[k];
    const open = Object.values(live);
    if (open.length >= maxConcurrent) {
      await this.state.storage.put('live', live);
      return { ok: false, scope: 'concurrent', retryAfter: Math.max(1, Math.min(60, Math.ceil((Math.min(...open) - now) / 1000))) };
    }
    const day = await this.hit({ kind: 'voice-live', perDay, now });
    if (!day.ok) {
      await this.state.storage.put('live', live);
      return day;
    }
    live[id] = now + ttlMs;
    await this.state.storage.put('live', live);
    return { ok: true, open: open.length + 1 };
  }

  async liveRelease({ id }) {
    const live = (await this.state.storage.get('live')) || {};
    delete live[id];
    await this.state.storage.put('live', live);
    return { ok: true, open: Object.keys(live).length };
  }
}
