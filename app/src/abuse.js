// Abuse + spend guard for every route that costs Meta money (B7).
//
// ── Browser contract ────────────────────────────────────────────────────────
// 1. GET  /api/config  -> { ok, turnstile: bool, turnstileSiteKey: string|null }
//    When turnstile is true, render the widget with that site key and
//    data-action="session" (https://challenges.cloudflare.com/turnstile/v0/api.js).
// 2. POST /api/session  body { turnstileToken }  (token may be omitted when
//    /api/config says turnstile:false — local dev / no-turnstile mode)
//    -> 200 { ok:true, token, expiresAt, turnstile }
//    -> 403 { ok:false, error:'turnstile-failed' }   (reset the widget, retry)
//    -> 503 { error:'misconfigured' }  public deploy without Turnstile and
//       without the operator switch TURNSTILE_OPTIONAL=1
//    Turnstile tokens are single-use: call turnstile.reset(widgetId) after use.
// 3. Model routes need the session token:
//      POST /api/verdict/turn, POST /api/voice/file (and wonder/trap routes)
//        header  x-krai-session: <token>      (the ?s= query is NOT accepted here)
//      WS   /api/voice/live?call=<id>&s=<token>   (WS only: browsers can't set
//        WS headers; any non-upgrade request gets 426)
//    The token lives 30 min and is bound to the caller's IP (hashed; IPv6 by
//    /64). On 401 { error:'session-required' | 'session-invalid' |
//    'session-expired' } get a fresh one via step 2 and retry once.
// 4. Errors every model route may return (all JSON with messageTh/messageEn
//    to show as-is):
//      503 { error:'paused' }   kill switch on
//      503 { error:'budget' }   today's USD cap reached (resets 00:00 UTC)
//      429 { error:'rate-limited', scope, retryAfter } + Retry-After header
//      413 { error:'too-large' | 'too-many-lines' | 'line-too-long' |
//            'turn-too-long' }  verdict: <=64 KB body, <=40 lines,
//            <=2000 chars/line, <=12000 chars total
//    A live call is closed by the server after 10 minutes (close code 4008),
//    or when the kill switch is turned on mid-call (close code 4009).
// 5. GET /api/health -> { ..., paused, turnstile, budget:{ spentUsd, capUsd } }
//    (budget figure cached up to 30 s per isolate)
// ────────────────────────────────────────────────────────────────────────────
import { BUDGET_NAME, capUsd, countsTotal, doCall, fromMicros, ledgerCaps, rateName, toMicros, utcDay, voiceUsd } from './budget.js';
import { ttsWorstUsd, TTS_MAX_CHARS } from './tts.js';

// One table for every spending route. estUsd is reserved before the call and
// replaced by the actual cost on settle (unsettled = estimate stays charged).
export const LIVE_MAX_SECONDS = 600;
// maxBodyBytes is enforced by protect() before any parsing (413). A route
// may pass protect(kind, { estimate }) to reserve a worst case computed from
// the actual request; estUsd is the flat fallback when it doesn't.
export const KINDS = {
// Per-IP daily counts sized so one visitor's worst case stays near $1.4/day
// at measured cost per call (2026-11-03: Spark verdict $0.0017 avg / $0.0032
// max, Wonder $0.025 / $0.033, trap ~$0.004, report ~$0.006, live voice
// $0.03 per 10 min). A heavy judge session (10 calls, ~60 verdicts) fits.
  verdict: { estUsd: 0.05, perMin: 30, perDay: 120, maxBodyBytes: 64 * 1024 },
  'voice-file': { estUsd: 0.014, perMin: 10, perDay: 30, maxBodyBytes: 2 * 1024 * 1024 }, // 2 MB at 8 kB/s
  'voice-live': { estUsd: voiceUsd(LIVE_MAX_SECONDS), maxConcurrent: 3, perDay: 8, maxSeconds: LIVE_MAX_SECONDS, maxBodyBytes: 0 },
  wonder: { estUsd: 0.03, perMin: 10, perDay: 15, maxBodyBytes: 64 * 1024 },
  trap: { estUsd: 0.03, perMin: 10, perDay: 30, maxBodyBytes: 64 * 1024 },
  report: { estUsd: 0.05, perMin: 6, perDay: 15, maxBodyBytes: 64 * 1024 }, // G8 case report, once per call
  // Gemini voice for live trap lines (B20): its own 'tts' ledger with its
  // own daily + cumulative caps (TTS_DAILY_USD_CAP / TTS_TOTAL_USD_CAP), so
  // voice output can never eat the Meta budget. ~$0.002 per line.
  tts: { estUsd: ttsWorstUsd('ก'.repeat(TTS_MAX_CHARS)), perMin: 20, perDay: 150, maxBodyBytes: 4096, ledger: 'tts' },
  // T1 code rules only (policy.t1Demand): no model, $0, so no budget call.
  t1: { estUsd: 0, free: true, perMin: 60, perDay: 600, maxBodyBytes: 64 * 1024 },
};
export const SESSION_LIMIT = { perMin: 10, perDay: 200 };
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const TURNSTILE_ACTION = 'session';
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const MESSAGES = {
  paused: {
    messageTh: 'เดโมพักชั่วคราว กรุณาลองใหม่ภายหลัง',
    messageEn: 'The demo is paused for now. Please try again later.',
  },
  'budget-total': {
    messageTh: 'เดโมใช้งบค่าโมเดลรวมครบเพดานแล้ว จึงหยุดตัวเองไว้ก่อน',
    messageEn: 'The demo reached its total model-spend cap and paused itself.',
  },
  budget: {
    messageTh: 'วันนี้ใช้งบค่าโมเดลของเดโมครบเพดานแล้ว ระบบจะเปิดใหม่ตอน 07:00 น. (เวลาไทย)',
    messageEn: "Today's demo model budget is used up (we cap spend per day). It resets at 00:00 UTC.",
  },
  'rate-limited': {
    messageTh: 'ใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    messageEn: 'Too many requests. Please wait a moment and try again.',
  },
  session: {
    messageTh: 'กรุณาเริ่มเซสชันใหม่ (ยืนยันว่าไม่ใช่บอท) แล้วลองอีกครั้ง',
    messageEn: 'Please start a new session (bot check) and try again.',
  },
  'too-large': {
    messageTh: 'ข้อมูลที่ส่งมายาวเกินกำหนด',
    messageEn: 'The request is larger than this demo accepts.',
  },
  misconfigured: {
    messageTh: 'ระบบยังตั้งค่าไม่ครบ ปิดการใช้โมเดลไว้ก่อน',
    messageEn: 'The server is not fully configured; model routes are closed.',
  },
};

// Secrets pasted through a Windows terminal arrive with a BOM, CRLF or quotes
// (prod returned spark-http-400 while a clean key got 402). Strip them.
export function cleanKey(raw) {
  let s = String(raw ?? '').replace(/^﻿+/, '').replace(/﻿/g, '').trim();
  while (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

const truthy = (v) => ['1', 'true', 'yes', 'on'].includes(cleanKey(v).toLowerCase());
export const isPaused = (env) => truthy(env?.KILL_SWITCH);
export const turnstileOn = (env) => Boolean(cleanKey(env?.TURNSTILE_SECRET));

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const hostnameSet = (env) =>
  new Set(String(env?.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean));

// No-turnstile sessions are a local-dev convenience. A public deployment
// (https APP_URL or any non-local hostname) refuses them unless the operator
// consciously sets TURNSTILE_OPTIONAL=1 (e.g. before the widget exists).
export function noTurnstileAllowed(env) {
  if (truthy(env?.TURNSTILE_OPTIONAL)) return true;
  if (/^https:/i.test(cleanKey(env?.APP_URL))) return false;
  return [...hostnameSet(env)].every((h) => LOCAL_HOSTS.has(h.toLowerCase()));
}

export function clientIp(request) {
  return cleanKey(request.headers.get('cf-connecting-ip')) || 'unknown';
}

// Rate-limit identity: IPv4 as-is, IPv6 bucketed to its /64 (one subscriber
// usually owns a whole /64, so per-address limits would be trivial to dodge).
export function ipBucket(ip) {
  const s = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!s.includes(':')) return s;
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  const halves = s.split('::');
  if (halves.length > 2) return s;
  const split = (x) => (x ? x.split(':') : []).flatMap((g) => (g.includes('.') ? ['0', '0'] : [g]));
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return s;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
};

// SHA-256 over a secret-salted IP: the raw IP is never stored or sent on, and
// the small IPv4 space can't be brute-forced back without SESSION_SECRET.
export async function hashIp(ip, salt) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(`krai-a-ip:${salt}:${ipBucket(ip)}`))).slice(0, 32);
}

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function signSession(secret, ipHash, now = Date.now(), ttlMs = SESSION_TTL_MS) {
  const exp = now + ttlMs;
  const payload = b64url(enc.encode(JSON.stringify({ v: 1, ih: ipHash, exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return { token: `${payload}.${b64url(sig)}`, expiresAt: exp };
}

export async function verifySession(token, secret, ipHash, now = Date.now()) {
  if (typeof token !== 'string' || !token) return { ok: false, error: 'session-required' };
  const parts = token.split('.');
  if (parts.length !== 2 || token.length > 512) return { ok: false, error: 'session-invalid' };
  let claims;
  try {
    // crypto.subtle.verify compares in constant time.
    const good = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(parts[1]), enc.encode(parts[0]));
    if (!good) return { ok: false, error: 'session-invalid' };
    claims = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
  } catch {
    return { ok: false, error: 'session-invalid' };
  }
  if (claims?.v !== 1 || typeof claims.exp !== 'number') return { ok: false, error: 'session-invalid' };
  if (claims.exp <= now) return { ok: false, error: 'session-expired' };
  if (claims.ih !== ipHash) return { ok: false, error: 'session-invalid' };
  return { ok: true, exp: claims.exp };
}

// Canonical server-side Siteverify (fail closed on every error path):
// success, expected action, and an allowlisted frontend hostname.
export async function siteverify({ env, token, ip, fetch: doFetch = (...a) => globalThis.fetch(...a) }) {
  const hostnames = hostnameSet(env);
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, reason: 'bad-token' };
  if (!hostnames.size) return { ok: false, reason: 'no-hostnames' };
  let result;
  try {
    const body = new URLSearchParams({ secret: cleanKey(env.TURNSTILE_SECRET), response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const r = await doFetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body,
    });
    if (!r.ok) throw new Error(`siteverify-${r.status}`);
    result = await r.json();
  } catch {
    return { ok: false, reason: 'siteverify-unreachable' };
  }
  if (!result?.success) return { ok: false, reason: 'not-success', codes: result?.['error-codes'] || [] };
  if (result.action !== TURNSTILE_ACTION) return { ok: false, reason: 'bad-action' };
  if (!hostnames.has(result.hostname)) return { ok: false, reason: 'bad-hostname' };
  return { ok: true };
}

const fail = (c, status, error, extra = {}, msgKey = error) =>
  c.json({ ok: false, error, ...extra, ...(MESSAGES[msgKey] || {}) }, status);

const rateLimited = (c, r) => {
  c.header('Retry-After', String(r.retryAfter || 60));
  return fail(c, 429, 'rate-limited', { scope: r.scope, retryAfter: r.retryAfter || 60 });
};

// POST /api/session handler.
export async function issueSession(c, { fetch } = {}) {
  const env = c.env || {};
  if (isPaused(env)) return fail(c, 503, 'paused');
  const secret = cleanKey(env.SESSION_SECRET);
  if (!secret || !env.RATE_LIMIT) return fail(c, 503, 'misconfigured');
  const ip = clientIp(c.req.raw);
  const ipHash = await hashIp(ip, secret);
  try {
    const r = await doCall(env.RATE_LIMIT, rateName(ipHash), 'hit', { kind: 'session', ...SESSION_LIMIT, now: Date.now() });
    if (!r.ok) return rateLimited(c, r);
  } catch {
    return fail(c, 503, 'misconfigured');
  }
  const on = turnstileOn(env);
  if (on) {
    const body = await c.req.json().catch(() => null);
    const v = await siteverify({ env, token: body?.turnstileToken, ip, fetch });
    if (!v.ok) {
      console.log(JSON.stringify({ event: 'turnstile-failed', reason: v.reason, codes: v.codes || [] }));
      return fail(c, 403, 'turnstile-failed', {}, 'session');
    }
  } else if (!noTurnstileAllowed(env)) {
    console.log(JSON.stringify({ event: 'session-refused-no-turnstile' }));
    return fail(c, 503, 'misconfigured');
  } else {
    console.log(JSON.stringify({ event: 'session-issued-no-turnstile' }));
  }
  const s = await signSession(secret, ipHash);
  return c.json({ ok: true, token: s.token, expiresAt: s.expiresAt, turnstile: on });
}

// Budget snapshot for /api/health (no secrets, no IPs). null when unknown.
// Cached per isolate for 30 s so health polling never hammers the single
// global Budget DO (the cache holds one public number, no request data).
export const BUDGET_CACHE_MS = 30_000;
let budgetCache = null;
export const resetBudgetCache = () => { budgetCache = null; };
export async function budgetStatus(env, now = Date.now()) {
  if (!env?.BUDGET) return null;
  const day = utcDay(now);
  const meta = ledgerCaps(env, 'meta');
  const shape = (b) => {
    const out = { spentUsd: b.spentUsd, capUsd: meta.dayUsd, day };
    // Cumulative cap (TOTAL_SINCE set): the demo pauses itself at the total.
    if (meta.since && Number.isFinite(meta.totalUsd)) Object.assign(out, { totalUsd: b.totalUsd, totalCapUsd: meta.totalUsd, since: meta.since });
    if (b.tts) out.tts = b.tts;
    return out;
  };
  if (budgetCache && budgetCache.day === day && now - budgetCache.at < BUDGET_CACHE_MS) return shape(budgetCache);
  try {
    const r = await doCall(env.BUDGET, BUDGET_NAME, 'status', { day, ledger: 'meta', since: meta.since });
    let tts = null;
    if (cleanKey(env.GEMINI_API_KEY)) {
      const t = ledgerCaps(env, 'tts');
      const rt = await doCall(env.BUDGET, BUDGET_NAME, 'status', { day, ledger: 'tts', since: t.since });
      tts = { spentUsd: fromMicros(rt.spentMicros), capUsd: t.dayUsd };
      if (t.since) Object.assign(tts, { totalUsd: fromMicros(rt.totalMicros), totalCapUsd: t.totalUsd });
    }
    budgetCache = { at: now, day, spentUsd: fromMicros(r.spentMicros), totalUsd: fromMicros(r.totalMicros), tts };
    return shape(budgetCache);
  } catch {
    return null;
  }
}

// Read at most `max` bytes of the body; never buffers past the cap.
export async function readCapped(request, max) {
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) return { tooLarge: true };
  if (!request.body) return { buf: new ArrayBuffer(0) };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const ch of chunks) { out.set(ch, o); o += ch.byteLength; }
  return { buf: out.buffer };
}

// Hono middleware: kill switch -> session -> per-IP rate limit -> body cap
// -> estimate -> budget reserve. Sets c.get('settle')(usdActual) and
// c.get('abuse') (meta for the live relay). Every failure path returns before
// any Meta call.
//
// opts.estimate(c, { body: ArrayBuffer }) -> number | Response (or a Promise
//   of either). Return the worst-case USD to reserve (see worstCaseUsd in
//   budget.js), or a Response (e.g. 413/400) to reject without reserving.
//   The body is already read (size-capped) and cached, so c.req.json() /
//   c.req.arrayBuffer() still work in the estimator and in the handler.
export function protect(kind, opts = {}) {
  const k = KINDS[kind];
  if (!k) throw new Error(`protect: unknown kind ${kind}`);
  const estimate = typeof opts.estimate === 'function' ? opts.estimate : null;
  return async (c, next) => {
    const env = c.env || {};
    if (isPaused(env)) return fail(c, 503, 'paused');
    const secret = cleanKey(env.SESSION_SECRET);
    if (!secret || !env.RATE_LIMIT || !env.BUDGET) return fail(c, 503, 'misconfigured');

    const ipHash = await hashIp(clientIp(c.req.raw), secret);
    // ?s= exists only because browsers can't set WebSocket headers.
    const token = c.req.header('x-krai-session') || (kind === 'voice-live' ? c.req.query('s') : undefined);
    const s = await verifySession(token, secret, ipHash);
    if (!s.ok) return fail(c, 401, s.error, {}, 'session');

    const now = Date.now();
    const day = utcDay(now);
    const liveId = kind === 'voice-live' ? crypto.randomUUID() : null;
    const rl = env.RATE_LIMIT;
    const rlName = rateName(ipHash);
    try {
      const r = liveId
        ? await doCall(rl, rlName, 'liveAcquire', {
          id: liveId, now, maxConcurrent: k.maxConcurrent, perDay: k.perDay, ttlMs: (k.maxSeconds + 60) * 1000,
        })
        : await doCall(rl, rlName, 'hit', { kind, perMin: k.perMin, perDay: k.perDay, now });
      if (!r.ok) return rateLimited(c, r);
    } catch {
      return fail(c, 503, 'misconfigured');
    }
    const release = async () => {
      if (liveId) await doCall(rl, rlName, 'liveRelease', { id: liveId }).catch(() => {});
    };

    let body = new ArrayBuffer(0);
    if (k.maxBodyBytes > 0) {
      const r = await readCapped(c.req.raw, k.maxBodyBytes);
      if (r.tooLarge) return fail(c, 413, 'too-large', { maxBytes: k.maxBodyBytes });
      body = r.buf;
      c.req.bodyCache.arrayBuffer = Promise.resolve(body);
    }
    // A free kind spends nothing: skip the budget round trip (still paused,
    // session and rate limited above).
    if (k.free) {
      c.set('settle', async () => {});
      c.set('abuse', { kind, ipHash, day, estMicros: 0, liveId: null, maxSeconds: 0 });
      await next();
      return;
    }
    let estUsd = k.estUsd;
    if (estimate) {
      const e = await estimate(c, { body });
      if (e instanceof Response) {
        await release();
        return e;
      }
      if (!Number.isFinite(e) || e < 0) {
        await release();
        throw new Error(`protect(${kind}): estimate must be a non-negative number`);
      }
      estUsd = e;
    }

    const estMicros = toMicros(estUsd);
    const ledger = k.ledger || 'meta';
    const caps = ledgerCaps(env, ledger);
    const capMicros = toMicros(caps.dayUsd);
    const totalCapMicros = Number.isFinite(caps.totalUsd) ? toMicros(caps.totalUsd) : null;
    const counted = countsTotal(caps, day);
    let reserved;
    try {
      reserved = await doCall(env.BUDGET, BUDGET_NAME, 'reserve', { day, micros: estMicros, capMicros, ledger, totalCapMicros, since: caps.since });
    } catch {
      await release();
      return fail(c, 503, 'misconfigured');
    }
    if (!reserved.ok) {
      await release();
      if (reserved.scope === 'total') {
        return fail(c, 503, 'budget-total', { ledger, budget: { totalUsd: fromMicros(reserved.totalMicros), totalCapUsd: caps.totalUsd, since: caps.since } });
      }
      return fail(c, 503, 'budget', { ledger, budget: { spentUsd: fromMicros(reserved.spentMicros), capUsd: caps.dayUsd } });
    }

    let settled = false;
    const settle = async (usdActual) => {
      if (settled) return;
      settled = true;
      const deltaMicros = toMicros(usdActual) - estMicros;
      if (!deltaMicros) return;
      await doCall(env.BUDGET, BUDGET_NAME, 'settle', { day, deltaMicros, ledger, since: caps.since, counted }).catch((e) =>
        console.log(JSON.stringify({ event: 'settle-failed', kind, error: String(e.message) })));
    };
    c.set('settle', settle);
    c.set('abuse', { kind, ipHash, day, estMicros, liveId, maxSeconds: k.maxSeconds || 0, ledger });
    await next();
    // A live call that never reached the relay (bad id, no key, DO error)
    // spent nothing: refund it and free the slot. Accepted calls are metered
    // and released by the VoiceCall DO on close / 10-minute alarm.
    if (liveId && c.res?.status !== 101 && !settled) {
      await settle(0);
      await release();
    }
  };
}
