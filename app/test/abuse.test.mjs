import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import app from '../src/index.js';
import {
  KINDS, cleanKey, hashIp, ipBucket, issueSession, noTurnstileAllowed, protect, resetBudgetCache, signSession, siteverify, verifySession,
} from '../src/abuse.js';
import { RateLimit, sparkUsd, toMicros, utcDay, utcHour, voiceFileUsd } from '../src/budget.js';
import { VoiceCall } from '../src/voice-do.js';
import { TEST_IP, TEST_SECRET, abuseEnv, authHeaders, fakeNamespace, memStorage } from './fakes.mjs';

const spentMicros = (env) => env.BUDGET.instances.get('global')?.state.storage.store.get(`spent:${utcDay()}`) || 0;

test('cleanKey strips BOM, whitespace, CRLF and surrounding quotes', () => {
  assert.equal(cleanKey('﻿abc123'), 'abc123');
  assert.equal(cleanKey('  abc123\r\n'), 'abc123');
  assert.equal(cleanKey('"abc123"'), 'abc123');
  assert.equal(cleanKey("﻿ 'abc123' \r\n"), 'abc123');
  assert.equal(cleanKey('"\'abc\'"'), 'abc');
  assert.equal(cleanKey('ab"c'), 'ab"c', 'inner quotes untouched');
  assert.equal(cleanKey(undefined), '');
  assert.equal(cleanKey(null), '');
});

test('session token: sign/verify, expiry, IP binding, tamper', async () => {
  const ih = await hashIp(TEST_IP, TEST_SECRET);
  assert.match(ih, /^[0-9a-f]{32}$/);
  assert.notEqual(ih, await hashIp('203.0.113.8', TEST_SECRET));
  assert.notEqual(ih, await hashIp(TEST_IP, 'other-salt'), 'salted');
  const now = 1_800_000_000_000;
  const { token, expiresAt } = await signSession(TEST_SECRET, ih, now);
  assert.equal(expiresAt, now + 30 * 60 * 1000);
  assert.equal(token.includes(TEST_IP), false, 'raw IP never in the token');
  assert.deepEqual(await verifySession(token, TEST_SECRET, ih, now + 1000), { ok: true, exp: expiresAt });
  assert.equal((await verifySession(token, TEST_SECRET, ih, expiresAt)).error, 'session-expired');
  assert.equal((await verifySession(token, TEST_SECRET, await hashIp('198.51.100.1', TEST_SECRET), now)).error, 'session-invalid');
  assert.equal((await verifySession(token, 'wrong-secret', ih, now)).error, 'session-invalid');
  const [p, s] = token.split('.');
  assert.equal((await verifySession(`${p}x.${s}`, TEST_SECRET, ih, now)).error, 'session-invalid');
  assert.equal((await verifySession('a.b.c', TEST_SECRET, ih, now)).error, 'session-invalid');
  assert.equal((await verifySession('', TEST_SECRET, ih, now)).error, 'session-required');
  assert.equal((await verifySession(undefined, TEST_SECRET, ih, now)).error, 'session-required');
});

const verifyEnv = { TURNSTILE_SECRET: 'test_turnstile_secret', TURNSTILE_HOSTNAMES: 'beta.krai-a.com' };
const answer = (json, ok = true, status = 200) => async () => ({ ok, status, json: async () => json });

test('siteverify: success needs success + action + allowlisted hostname', async () => {
  let sent;
  const good = async (url, init) => {
    sent = { url, body: String(init.body) };
    return { ok: true, status: 200, json: async () => ({ success: true, action: 'session', hostname: 'beta.krai-a.com' }) };
  };
  assert.deepEqual(await siteverify({ env: verifyEnv, token: 'tok', ip: TEST_IP, fetch: good }), { ok: true });
  assert.equal(sent.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.match(sent.body, /response=tok/);
  assert.match(sent.body, /remoteip=203\.0\.113\.7/);
});

test('siteverify failure paths all fail closed', async () => {
  const v = (fetch, extra = {}) => siteverify({ env: { ...verifyEnv, ...extra.env }, token: extra.token ?? 'tok', ip: TEST_IP, fetch });
  assert.equal((await v(answer({ success: false, 'error-codes': ['invalid-input-response'] }))).reason, 'not-success');
  assert.equal((await v(answer({ success: true, action: 'login', hostname: 'beta.krai-a.com' }))).reason, 'bad-action');
  assert.equal((await v(answer({ success: true, action: 'session', hostname: 'evil.example' }))).reason, 'bad-hostname');
  assert.equal((await v(answer({}, false, 500))).reason, 'siteverify-unreachable');
  assert.equal((await v(async () => { throw new Error('net'); })).reason, 'siteverify-unreachable');
  assert.equal((await v(answer({ success: true }), { token: '' })).reason, 'bad-token');
  assert.equal((await v(answer({ success: true }), { token: 'x'.repeat(2049) })).reason, 'bad-token');
  assert.equal((await v(answer({ success: true }), { env: { TURNSTILE_HOSTNAMES: '' } })).reason, 'no-hostnames');
});

function sessionApp(fetch) {
  const a = new Hono();
  a.post('/api/session', (c) => issueSession(c, { fetch }));
  return a;
}
const postSession = (a, env, body = {}) => a.request('/api/session', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': TEST_IP },
  body: JSON.stringify(body),
}, env);

test('POST /api/session: no-turnstile mode issues a working token', async () => {
  const env = abuseEnv();
  const res = await app.request('/api/session', { method: 'POST', headers: { 'cf-connecting-ip': TEST_IP } }, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.turnstile, false);
  assert.ok(body.expiresAt > Date.now());
  const ok = await verifySession(body.token, TEST_SECRET, await hashIp(TEST_IP, TEST_SECRET));
  assert.equal(ok.ok, true);
  for (const inst of env.RATE_LIMIT.instances.values()) {
    assert.equal(JSON.stringify([...inst.state.storage.store]).includes(TEST_IP), false, 'raw IP never stored');
  }
  assert.ok(env.RATE_LIMIT.names.every((n) => !n.includes(TEST_IP)), 'DO names use the hash');
});

test('POST /api/session: turnstile mode verifies first; failure is 403', async () => {
  const env = abuseEnv(verifyEnv);
  const bad = await postSession(sessionApp(answer({ success: false, 'error-codes': ['timeout-or-duplicate'] })), env, { turnstileToken: 'used' });
  assert.equal(bad.status, 403);
  const badBody = await bad.json();
  assert.equal(badBody.error, 'turnstile-failed');
  assert.ok(badBody.messageTh && badBody.messageEn);
  assert.equal(badBody.token, undefined);
  const missing = await postSession(sessionApp(answer({ success: true, action: 'session', hostname: 'beta.krai-a.com' })), env, {});
  assert.equal(missing.status, 403, 'turnstile on + no token');
  const good = await postSession(sessionApp(answer({ success: true, action: 'session', hostname: 'beta.krai-a.com' })), env, { turnstileToken: 'fresh' });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).turnstile, true);
});

test('POST /api/session: misconfigured without SESSION_SECRET, rate limited per IP', async () => {
  const none = await app.request('/api/session', { method: 'POST' }, { RATE_LIMIT: fakeNamespace(RateLimit) });
  assert.equal(none.status, 503);
  assert.equal((await none.json()).error, 'misconfigured');
  const env = abuseEnv();
  let last;
  for (let i = 0; i < 11; i++) last = await app.request('/api/session', { method: 'POST', headers: { 'cf-connecting-ip': TEST_IP } }, env);
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) >= 1);
});

// A stand-in route the way wonder.js / trap.js will use protect().
function guardedApp(kind, handler) {
  const a = new Hono();
  let calls = 0;
  a.post('/x', protect(kind), async (c) => {
    calls++;
    return handler ? handler(c) : c.json({ ok: true });
  });
  return { a, calls: () => calls };
}
const hit = async (a, env, ip = TEST_IP) => a.request('/x', { method: 'POST', headers: await authHeaders(env, ip) }, env);

test('protect: kill switch answers 503 paused before anything else', async () => {
  for (const v of ['1', 'true', ' TRUE\r\n']) {
    const env = abuseEnv({ KILL_SWITCH: v });
    const { a, calls } = guardedApp('wonder');
    const res = await hit(a, env);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'paused');
    assert.ok(body.messageTh && body.messageEn);
    assert.equal(calls(), 0);
    assert.equal(env.BUDGET.instances.size, 0, 'no budget touch');
  }
  const off = abuseEnv({ KILL_SWITCH: '0' });
  assert.equal((await hit(guardedApp('wonder').a, off)).status, 200);
});

test('protect: session required, IP-bound, and misconfig fails closed', async () => {
  const env = abuseEnv();
  const { a, calls } = guardedApp('trap');
  const none = await a.request('/x', { method: 'POST', headers: { 'cf-connecting-ip': TEST_IP } }, env);
  assert.equal(none.status, 401);
  assert.equal((await none.json()).error, 'session-required');
  const stolen = await a.request('/x', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '198.51.100.9', 'x-krai-session': (await authHeaders(env))['x-krai-session'] },
  }, env);
  assert.equal(stolen.status, 401, 'token from another IP');
  const viaQuery = await a.request(`/x?s=${encodeURIComponent((await authHeaders(env))['x-krai-session'])}`, {
    method: 'POST', headers: { 'cf-connecting-ip': TEST_IP },
  }, env);
  assert.equal(viaQuery.status, 401, '?s= is accepted only on the WebSocket route');
  assert.equal(calls(), 0);
  const noDo = await hit(a, { SESSION_SECRET: TEST_SECRET });
  assert.equal(noDo.status, 503);
  assert.equal((await noDo.json()).error, 'misconfigured');
});

test('protect: per-IP rate limit returns 429 + Retry-After; other IPs unaffected', async () => {
  const env = abuseEnv();
  const { a, calls } = guardedApp('trap');
  assert.ok(KINDS.trap.perMin < KINDS.trap.perDay);
  for (let i = 0; i < KINDS.trap.perMin; i++) assert.equal((await hit(a, env)).status, 200);
  const res = await hit(a, env);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.error, 'rate-limited');
  assert.equal(body.scope, 'minute');
  assert.equal(body.resting, undefined, 'a minute limit is "wait a moment", not resting');
  assert.equal(res.headers.get('retry-after'), String(body.retryAfter));
  assert.equal(calls(), KINDS.trap.perMin);
  assert.equal((await hit(a, env, '198.51.100.20')).status, 200);
});

test('P1-1: per-IP daily limits are lowered; a daily 429 says the live demo is resting', async () => {
  assert.equal(KINDS.verdict.perDay, 60);
  assert.equal(KINDS['voice-file'].perDay, 10);
  assert.equal(KINDS.wonder.perDay, 6);
  assert.equal(KINDS.trap.perDay, 15);
  assert.equal(KINDS.report.perDay, 6);
  // One IP's worst case at measured max cost per call stays well under $1/day.
  const maxUsd = { verdict: 0.0032, 'voice-file': 0.014, wonder: 0.033, trap: 0.004, report: 0.006 };
  const perIp = Object.entries(maxUsd).reduce((s, [k, usd]) => s + KINDS[k].perDay * usd, 0);
  assert.ok(perIp < 0.65, `per-IP text-model worst case ${perIp}`);
  // A judge's 5 full live calls fit (recorded calls use <= 4 verdicts, 1 report).
  assert.ok(KINDS.verdict.perDay >= 5 * 8 && KINDS.report.perDay >= 5 && KINDS.wonder.perDay >= 5 && KINDS.trap.perDay >= 5 * 3);
  const env = abuseEnv();
  const { a, calls } = guardedApp('wonder');
  for (let i = 0; i < KINDS.wonder.perDay; i++) assert.equal((await hit(a, env)).status, 200);
  const res = await hit(a, env);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.scope, 'day');
  assert.equal(body.resting, true);
  assert.match(body.messageEn, /Live demo is resting/);
  assert.match(body.messageEn, /recorded calls/);
  assert.ok(body.messageTh);
  assert.equal(calls(), KINDS.wonder.perDay);
});

test('protect: daily cap reached -> 503 budget with honest message, no handler', async () => {
  const env = abuseEnv({ DAILY_USD_CAP: '0.5' });
  const { a, calls } = guardedApp('wonder'); // est $0.03; hour ceiling 0.5/6 > 0.03
  env.BUDGET.get('global');
  env.BUDGET.instances.get('global').state.storage.store.set(`spent:${utcDay()}`, toMicros(0.45)); // earlier hours
  assert.equal((await hit(a, env)).status, 200);
  const res = await hit(a, env);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'budget');
  assert.equal(body.scope, 'day');
  assert.equal(body.resting, true);
  assert.match(body.messageEn, /UTC/);
  assert.match(body.messageEn, /Live demo is resting/);
  assert.ok(body.messageTh);
  assert.deepEqual(body.budget, { spentUsd: 0.48, capUsd: 0.5 });
  assert.equal(calls(), 1);
});

test('P1-1: hourly ceiling (cap/6) -> 503 budget scope hour + Retry-After, friendly copy', async () => {
  const env = abuseEnv({ DAILY_USD_CAP: '0.3' }); // hour ceiling $0.05
  const { a, calls } = guardedApp('wonder'); // est $0.03, handler settles nothing (estimate stays)
  assert.equal((await hit(a, env)).status, 200);
  const res = await hit(a, env);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'budget');
  assert.equal(body.scope, 'hour');
  assert.equal(body.resting, true);
  assert.match(body.messageEn, /Live demo is resting for a bit/);
  assert.match(body.messageEn, /recorded calls/);
  assert.ok(body.messageTh);
  assert.equal(res.headers.get('retry-after'), String(body.retryAfter));
  assert.ok(body.retryAfter >= 1 && body.retryAfter <= 3600);
  assert.equal(body.budget.hourCapUsd, 0.05);
  assert.equal(calls(), 1);
});

test('protect: settle replaces the estimate; unsettled keeps it; idempotent', async () => {
  const env = abuseEnv();
  const { a } = guardedApp('wonder', async (c) => {
    await c.get('settle')(0.0123);
    await c.get('settle')(5); // ignored
    return c.json({ ok: true });
  });
  await hit(a, env);
  assert.equal(spentMicros(env), toMicros(0.0123));
  await hit(guardedApp('wonder').a, env); // handler never settles
  assert.equal(spentMicros(env), toMicros(0.0123) + toMicros(KINDS.wonder.estUsd));
  resetBudgetCache();
  const health = await (await app.request('/api/health', {}, env)).json();
  assert.equal(health.paused, false);
  assert.equal(health.turnstile, false);
  assert.deepEqual(health.budget, { spentUsd: 0.0423, capUsd: 5, day: utcDay() });
  assert.equal(JSON.stringify(health).includes(TEST_SECRET), false);
});

test('GET /api/config exposes only the public site key', async () => {
  const empty = await (await app.request('/api/config', {}, {})).json();
  assert.deepEqual(empty, { ok: true, turnstile: false, turnstileSiteKey: null });
  const set = await (await app.request('/api/config', {}, { TURNSTILE_SITE_KEY: 'site-key-placeholder', TURNSTILE_SECRET: 'test_x' })).json();
  assert.deepEqual(set, { ok: true, turnstile: true, turnstileSiteKey: 'site-key-placeholder' });
});

test('GET /api/health reports paused even when model routes are off', async () => {
  const res = await app.request('/api/health', {}, { KILL_SWITCH: '1' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.paused, true);
  assert.equal(body.budget, null);
});

// ---- live voice: worker guard -> DO metering -------------------------------

function fakeWs() {
  let att = null;
  return {
    sent: [], closed: null,
    send(d) { this.sent.push(d); },
    close(code, reason) { this.closed = { code, reason }; },
    serializeAttachment(v) { att = structuredClone(v); },
    deserializeAttachment() { return att; },
    addEventListener() {},
  };
}

async function withWsGlobals(fn) {
  const saved = { pair: globalThis.WebSocketPair, ws: globalThis.WebSocket, Response: globalThis.Response };
  const Real = globalThis.Response;
  globalThis.Response = class extends Real {
    constructor(body, init = {}) {
      if (init.status === 101) { super(null, { status: 200 }); this._ws101 = true; return; }
      super(body, init);
    }
    get status() { return this._ws101 ? 101 : super.status; }
  };
  globalThis.WebSocketPair = class { constructor() { this[0] = fakeWs(); this[1] = fakeWs(); } };
  globalThis.WebSocket = class { constructor() { return { ...fakeWs(), readyState: 0 }; } };
  try {
    return await fn();
  } finally {
    globalThis.WebSocketPair = saved.pair;
    globalThis.WebSocket = saved.ws;
    globalThis.Response = saved.Response;
  }
}

function liveEnv() {
  const env = abuseEnv({ META_MODEL_API_KEY: '﻿k\r\n' });
  const sockets = [];
  const state = {
    storage: memStorage(),
    acceptWebSocket(ws) { sockets.push(ws); },
    getWebSockets() { return sockets.filter((s) => !s.closed); },
    waitUntil(p) { p.catch(() => {}); },
  };
  const call = new VoiceCall(state, env);
  env.VOICE_CALL = { idFromName: (n) => n, get: () => ({ fetch: (req) => call.fetch(req) }) };
  return { env, state, sockets, call };
}

const liveReq = async (env, query = 'call=abc', ip = TEST_IP) => app.request(
  `/api/voice/live?${query}&s=${encodeURIComponent((await authHeaders(env, ip))['x-krai-session'])}`,
  { headers: { upgrade: 'websocket', 'cf-connecting-ip': ip, 'x-krai-live': '{"liveId":"forged","ipHash":"x","day":"d"}' } },
  env,
);

test('voice-live: guard reserves 10 min, DO meters seconds on close and frees the slot', async () => {
  await withWsGlobals(async () => {
    const { env, state, sockets, call } = liveEnv();
    const res = await liveReq(env);
    assert.equal(res.status, 101);
    assert.equal(spentMicros(env), toMicros(KINDS['voice-live'].estUsd), 'full 10-minute estimate reserved');
    const [rec] = [...state.storage.store.entries()].filter(([k]) => k.startsWith('live:'));
    assert.ok(rec, 'reservation recorded in DO storage');
    assert.notEqual(rec[1].liveId, 'forged', 'client-sent x-krai-live is overwritten');
    assert.equal(state.storage.alarmAt, rec[1].startedAt + 600_000, '10-minute alarm armed');
    // 120 s of streaming
    rec[1].startedAt -= 120_000;
    state.storage.store.set(rec[0], rec[1]);
    sockets[0].closed = { code: 1000 };
    await call.webSocketClose(sockets[0]);
    assert.equal(spentMicros(env), toMicros(0.18 * 120 / 3600), 'settled to seconds streamed');
    const hourStore = env.BUDGET.instances.get('global').state.storage.store;
    assert.equal(hourStore.get(`hour:meta:${utcHour()}`), toMicros(0.18 * 120 / 3600), 'hour bucket settled with the same delta');
    assert.equal(state.storage.store.has(rec[0]), false);
    await call.webSocketClose(sockets[0]);
    assert.equal(spentMicros(env), toMicros(0.006), 'second close is a no-op');
    const rl = [...env.RATE_LIMIT.instances.values()][0];
    assert.deepEqual(rl.state.storage.store.get('live'), {}, 'slot released');
  });
});

test('voice-live: 3 concurrent per IP, 4th gets 429; alarm closes at 10 minutes', async () => {
  await withWsGlobals(async () => {
    const { env, state, sockets, call } = liveEnv();
    for (let i = 0; i < 3; i++) assert.equal((await liveReq(env)).status, 101);
    const fourth = await liveReq(env);
    assert.equal(fourth.status, 429);
    assert.equal((await fourth.json()).scope, 'concurrent');
    assert.ok(fourth.headers.get('retry-after'));
    // age every call past the limit, fire the alarm
    for (const [k, v] of state.storage.store) {
      if (k.startsWith('live:')) state.storage.store.set(k, { ...v, startedAt: v.startedAt - 601_000 });
    }
    await call.alarm();
    assert.ok(sockets.every((s) => s.closed?.code === 4008), 'server closes with 4008');
    assert.ok(sockets.every((s) => s.sent.some((m) => m.includes('max-duration'))));
    assert.equal([...state.storage.store.keys()].filter((k) => k.startsWith('live:')).length, 0);
    assert.equal(spentMicros(env), 3 * toMicros(0.03), 'each charged the capped 10 minutes');
    assert.equal((await liveReq(env)).status, 101, 'slots free again');
  });
});

test('voice-live: rejected upgrade refunds and frees the slot; DO refuses unmetered sockets', async () => {
  await withWsGlobals(async () => {
    const { env, call } = liveEnv();
    const bad = await liveReq(env, 'call=no!!');
    assert.equal(bad.status, 400);
    assert.equal(spentMicros(env), 0, 'refunded');
    const rl = [...env.RATE_LIMIT.instances.values()][0];
    assert.deepEqual(rl.state.storage.store.get('live'), {});
    const direct = await call.fetch(new Request('https://x/api/voice/live?call=abc', { headers: { Upgrade: 'websocket' } }));
    assert.equal(direct.status, 403, 'no reservation header -> no socket');
    const noSession = await app.request('/api/voice/live?call=abc', { headers: { upgrade: 'websocket', 'cf-connecting-ip': TEST_IP } }, env);
    assert.equal(noSession.status, 401);
    const paused = await liveReq({ ...env, KILL_SWITCH: '1' });
    assert.equal(paused.status, 503);
  });
});

test('model routes settle actual cost: voice-file by WAV seconds, verdict by Spark usage', async () => {
  const realFetch = globalThis.fetch;
  try {
    // 2 s of 16 kHz mono 16-bit PCM
    const data = 64000;
    const buf = new ArrayBuffer(44 + data);
    const dv = new DataView(buf);
    const put = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
    put(0, 'RIFF'); put(8, 'WAVE'); put(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint32(28, 32000, true);
    put(36, 'data'); dv.setUint32(40, data, true);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ transcript: 'สวัสดี' }) });
    const env = abuseEnv({ META_MODEL_API_KEY: 'k' });
    const res = await app.request('/api/voice/file', { method: 'POST', headers: await authHeaders(env), body: buf }, env);
    assert.equal(res.status, 200);
    // Charged at the lowest plausible rate (8 kB/s), not the header's 32 kB/s.
    assert.equal(spentMicros(env), toMicros(0.18 * (buf.byteLength / 8000) / 3600));

    // Forged header (absurd byteRate) cannot make an upload cost ~0.
    const forged = buf.slice(0);
    new DataView(forged).setUint32(28, 0xffffffff, true);
    const env3 = abuseEnv({ META_MODEL_API_KEY: 'k' });
    await app.request('/api/voice/file', { method: 'POST', headers: await authHeaders(env3), body: forged }, env3);
    assert.equal(spentMicros(env3), toMicros(voiceFileUsd(forged)));
    assert.ok(spentMicros(env3) >= toMicros(0.18 * 8 / 3600));

    const usage = { prompt_tokens: 3000, completion_tokens: 150 };
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ model: 'muse-spark-1.3', usage, choices: [{ message: { content: JSON.stringify({ verdict: 'LEGIT', tactic: 'none', confidence: 0.9, signals: {}, reasonTh: 'ปกติ', reasonEn: 'Fine.' }) } }] }),
    });
    const env2 = abuseEnv({ META_MODEL_API_KEY: 'k' });
    const v = await app.request('/api/verdict/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders(env2)) },
      body: JSON.stringify({ lines: [{ speaker: 'caller', text: 'สวัสดีครับ โรงพยาบาลโทรมานัดตรวจ' }] }),
    }, env2);
    assert.equal(v.status, 200);
    assert.equal(spentMicros(env2), toMicros(sparkUsd(usage)));
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- security review fixes (B7 round 2) ------------------------------------

test('HIGH-1 repro: "Upgrade: WebSocket" can no longer read a call or refund its reservation', async () => {
  await withWsGlobals(async () => {
    const { env, state, call } = liveEnv();
    state.storage.store.set('turn:t1', { turnId: 't1', text: 'เลขบัญชี 1234567890', at: '2026-11-01' });
    // Old bug: index.js lower-cased the header, the DO compared it
    // case-sensitively -> debug JSON with every turn + worker refund.
    const res = await app.request(
      `/api/voice/live?call=abc&s=${encodeURIComponent((await authHeaders(env))['x-krai-session'])}`,
      { headers: { Upgrade: 'WebSocket', 'cf-connecting-ip': TEST_IP } },
      env,
    );
    assert.equal(res.status, 101, 'treated as a real upgrade');
    assert.equal(spentMicros(env), toMicros(KINDS['voice-live'].estUsd), 'reservation kept, not refunded');
    for (const headers of [{}, { Upgrade: 'h2c' }, { Upgrade: 'WebSocket', 'x-krai-live': 'garbage' }]) {
      const direct = await call.fetch(new Request('https://x/api/voice/live?call=abc', { headers }));
      assert.ok([426, 403].includes(direct.status));
      assert.equal((await direct.text()).includes('1234567890'), false, 'no transcript over HTTP');
    }
  });
});

test('LOW: kill switch closes running live calls and settles them', async () => {
  await withWsGlobals(async () => {
    const { env, state, sockets, call } = liveEnv();
    assert.equal((await liveReq(env)).status, 101);
    env.KILL_SWITCH = '1';
    await call.webSocketMessage(sockets[0], new ArrayBuffer(8));
    assert.equal(sockets[0].closed.code, 4009);
    assert.ok(sockets[0].sent.some((m) => m.includes('paused')));
    assert.equal([...state.storage.store.keys()].some((k) => k.startsWith('live:')), false, 'settled');
    assert.ok(spentMicros(env) < toMicros(0.001), 'charged seconds streamed, not 10 minutes');
    assert.equal(call.relay, null, 'Meta session dropped');
    const rl = [...env.RATE_LIMIT.instances.values()][0];
    assert.deepEqual(rl.state.storage.store.get('live'), {});
    const again = await call.fetch(new Request('https://x/?call=abc', { headers: { Upgrade: 'websocket' } }));
    assert.equal(again.status, 503);
  });
});

test('LOW: 10-minute alarm drops the Meta relay even while closed sockets are still listed', async () => {
  await withWsGlobals(async () => {
    const { env, state, sockets, call } = liveEnv();
    assert.equal((await liveReq(env)).status, 101);
    assert.ok(call.relay, 'relay open');
    for (const [k, v] of state.storage.store) {
      if (k.startsWith('live:')) state.storage.store.set(k, { ...v, startedAt: v.startedAt - 601_000 });
    }
    // prod: getWebSockets() can still list a socket right after close()
    state.getWebSockets = () => [...sockets];
    await call.alarm();
    assert.equal(sockets[0].closed.code, 4008);
    assert.equal(call.relay, null);
  });
});

test('LOW: DO failure after accept refunds exactly once (no later double settle)', async () => {
  await withWsGlobals(async () => {
    const { env, state, call } = liveEnv();
    const realSetAlarm = state.storage.setAlarm;
    state.storage.setAlarm = async () => { throw new Error('alarm-store-down'); };
    const res = await liveReq(env);
    assert.equal(res.status, 500);
    assert.equal(spentMicros(env), 0, 'worker refunded the reservation');
    assert.equal([...state.storage.store.keys()].some((k) => k.startsWith('live:')), false, 'no record left for the DO');
    state.storage.setAlarm = realSetAlarm;
    await call.alarm();
    assert.equal(spentMicros(env), 0, 'still refunded exactly once');
  });
});

test('MED-8: IPv6 is bucketed by /64 before hashing; IPv4 untouched', async () => {
  assert.equal(ipBucket('203.0.113.7'), '203.0.113.7');
  assert.equal(ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('2001:DB8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('2001:0db8:0001:0002::ffff'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipBucket('::ffff:198.51.100.4'), '198.51.100.4');
  assert.equal(ipBucket('[2001:db8:1:2::9]'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(await hashIp('2001:db8:1:2::1', TEST_SECRET), await hashIp('2001:db8:1:2:ffff::9', TEST_SECRET));
  assert.notEqual(await hashIp('2001:db8:1:2::1', TEST_SECRET), await hashIp('2001:db8:1:3::1', TEST_SECRET));
  // a session minted on one address of the /64 works from another
  const env = abuseEnv();
  const { a } = guardedApp('wonder');
  const token = (await authHeaders(env, '2001:db8:1:2::1'))['x-krai-session'];
  const res = await a.request('/x', { method: 'POST', headers: { 'cf-connecting-ip': '2001:db8:1:2::77', 'x-krai-session': token } }, env);
  assert.equal(res.status, 200);
});

test('MED-6: public deployment refuses no-turnstile sessions unless TURNSTILE_OPTIONAL=1', async () => {
  assert.equal(noTurnstileAllowed({}), true, 'local dev');
  assert.equal(noTurnstileAllowed({ APP_URL: 'http://localhost:8787', TURNSTILE_HOSTNAMES: 'localhost,127.0.0.1' }), true);
  assert.equal(noTurnstileAllowed({ APP_URL: 'https://beta.krai-a.com' }), false);
  assert.equal(noTurnstileAllowed({ TURNSTILE_HOSTNAMES: 'beta.krai-a.com' }), false);
  assert.equal(noTurnstileAllowed({ APP_URL: 'https://beta.krai-a.com', TURNSTILE_OPTIONAL: '1' }), true);
  const prod = abuseEnv({ APP_URL: 'https://beta.krai-a.com', TURNSTILE_HOSTNAMES: 'beta.krai-a.com' });
  const refused = await app.request('/api/session', { method: 'POST', headers: { 'cf-connecting-ip': TEST_IP } }, prod);
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).error, 'misconfigured');
  const optional = { ...prod, TURNSTILE_OPTIONAL: '1' };
  const ok = await app.request('/api/session', { method: 'POST', headers: { 'cf-connecting-ip': TEST_IP } }, optional);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).turnstile, false);
  resetBudgetCache();
  assert.equal((await (await app.request('/api/health', {}, optional)).json()).turnstile, false);
});

test('MED-7: /api/health caches the budget status for 30 s', async () => {
  resetBudgetCache();
  const env = abuseEnv();
  let calls = 0;
  const orig = env.BUDGET.get.bind(env.BUDGET);
  env.BUDGET.get = (id) => { calls++; return orig(id); };
  for (let i = 0; i < 5; i++) assert.equal((await app.request('/api/health', {}, env)).status, 200);
  assert.equal(calls, 1, 'one DO round-trip for five health hits');
  resetBudgetCache();
});

test('LOW: Spark answered but output unparsable -> settle real usage, not 0', async () => {
  const realFetch = globalThis.fetch;
  try {
    const usage = { prompt_tokens: 5000, completion_tokens: 900 };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ usage, choices: [{ message: { content: 'not json at all' } }] }) });
    const env = abuseEnv({ META_MODEL_API_KEY: 'k' });
    const res = await app.request('/api/verdict/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders(env)) },
      body: JSON.stringify({ lines: [{ speaker: 'caller', text: 'ฮัลโหล' }] }),
    }, env);
    const body = await res.json();
    assert.equal(body.spark.engine, 'spark-fallback');
    assert.equal(spentMicros(env), toMicros(sparkUsd(usage)));
  } finally {
    globalThis.fetch = realFetch;
  }
});
