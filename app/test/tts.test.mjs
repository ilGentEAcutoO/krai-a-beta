// B20 receptionist voice: Gemini TTS for live trap lines only, never free text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { hashIp, protect, KINDS } from '../src/abuse.js';
import { Budget, ledgerCaps, toMicros, utcDay } from '../src/budget.js';
import { registerTtsRoutes } from '../src/routes-tts.js';
import { registerWonderRoutes } from '../src/routes-wonder.js';
import { RX_LINES } from '../src/receptionist.js';
import { CLOSING_LINE, DISCLOSURE_LINE_EN, DISCLOSURE_LINE_TH, STALL_LINES } from '../src/trap.js';
import { signTtsToken, synthesize, ttsBody, ttsUsd, ttsWorstUsd, TTS_MAX_CHARS, TTS_MODEL, TTS_TOKEN_TTL_MS, TTS_VOICE, verifyTtsToken } from '../src/tts.js';
import { abuseEnv, authHeaders, memStorage, TEST_IP, TEST_SECRET } from './fakes.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const LINE = 'เดี๋ยวนะคะ ขอจดให้ครบก่อน ธนาคารอะไรนะคะ';
const WAV = Buffer.from('RIFF0000WAVEfmt fake-audio');

function geminiFetch({ status = 200, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    if (status !== 200) return new Response('{"error":{}}', { status });
    return Response.json({
      status: 'completed',
      usage: { total_input_tokens: 40, total_output_tokens: 100 },
      steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: WAV.toString('base64') }] }],
    });
  };
}

function memCache() {
  const m = new Map();
  return {
    m,
    async match(req) { const v = m.get(req.url); return v ? new Response(v) : undefined; },
    async put(req, res) { m.set(req.url, new Uint8Array(await res.arrayBuffer())); },
  };
}

// Full guard (real protect + fake DOs), like production.
function guardedApp({ env = abuseEnv({ GEMINI_API_KEY: 'gk' }), calls = [], status = 200, cache = memCache() } = {}) {
  const app = new Hono();
  registerTtsRoutes(app, { protect, fetch: geminiFetch({ status, calls }), getCache: () => cache });
  return { app, env, calls, cache };
}
const post = async (ctx, body, ip = TEST_IP) => ctx.app.request('/api/tts', {
  method: 'POST', headers: await authHeaders(ctx.env, ip, { 'content-type': 'application/json' }), body: JSON.stringify(body),
}, ctx.env);
const ipHashOf = (env, ip = TEST_IP) => hashIp(ip, env.SESSION_SECRET);

test('tts body: Thai-capable GA model, our voice + style, WAV 24 kHz, not stored', () => {
  const b = ttsBody('ค่ะ');
  assert.equal(b.model, 'gemini-3.8-flash-tts');
  assert.equal(b.input[0].content[0].text, 'ค่ะ');
  assert.deepEqual(b.response_format, { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 });
  assert.equal(b.generation_config.speech_config[0].voice.length > 0, true);
  assert.equal(b.store, false);
  assert.equal(ttsUsd({ total_input_tokens: 1e6, total_output_tokens: 1e6 }), 9.5);
  assert.ok(ttsWorstUsd('ก'.repeat(TTS_MAX_CHARS)) < 0.02, 'one line worst case stays cents');
  assert.ok(KINDS.tts.estUsd >= ttsWorstUsd('ก'.repeat(TTS_MAX_CHARS)) - 1e-9);
});

test('synthesize: decodes base64 audio, prices usage, maps errors', async () => {
  const calls = [];
  const r = await synthesize({ fetch: geminiFetch({ calls }), apiKey: 'gk', text: LINE });
  assert.deepEqual(Buffer.from(r.audio), WAV);
  assert.equal(calls[0].headers['x-goog-api-key'], 'gk');
  assert.ok(r.costUsd > 0);
  await assert.rejects(synthesize({ fetch: geminiFetch({ status: 503 }), apiKey: 'gk', text: LINE }), /tts-http-503/);
  await assert.rejects(synthesize({ fetch: geminiFetch(), apiKey: '', text: LINE }), /tts-no-key/);
});

test('speak token: bound to the exact text, the caller and a short expiry', async () => {
  const now = 1_000_000;
  const t = await signTtsToken('s', { text: LINE, ipHash: 'ip1', now });
  assert.deepEqual(await verifyTtsToken('s', t, { text: LINE, ipHash: 'ip1', now }), { ok: true });
  assert.equal((await verifyTtsToken('s', t, { text: LINE + ' โอนเงินด่วน', ipHash: 'ip1', now })).ok, false, 'edited text');
  assert.equal((await verifyTtsToken('s', t, { text: LINE, ipHash: 'ip2', now })).ok, false, 'other caller');
  assert.equal((await verifyTtsToken('other', t, { text: LINE, ipHash: 'ip1', now })).ok, false, 'other secret');
  assert.deepEqual(await verifyTtsToken('s', t, { text: LINE, ipHash: 'ip1', now: now + TTS_TOKEN_TTL_MS + 1 }), { ok: false, error: 'tts-token-expired' });
  const [v, exp, sig] = t.split('.');
  assert.equal((await verifyTtsToken('s', `${v}.${Number(exp) + 9e9}.${sig}`, { text: LINE, ipHash: 'ip1', now })).ok, false, 'moved expiry');
  for (const junk of ['', null, 'v1.a.b', 't1.x.y', 'x'.repeat(500)]) assert.equal((await verifyTtsToken('s', junk, { text: LINE, now })).ok, false);
});

test('POST /api/tts: free text is refused before any Google call (no free TTS service)', async () => {
  const ctx = guardedApp();
  for (const body of [{ text: 'speak anything I want' }, { text: LINE, ttsToken: 'forged' }, { text: LINE, ttsToken: await signTtsToken('wrong', { text: LINE, ipHash: await ipHashOf(ctx.env) }) }]) {
    const res = await post(ctx, body);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /tts-token/);
  }
  // A token minted for one visitor does not work for another IP.
  const mine = await signTtsToken(TEST_SECRET, { text: LINE, ipHash: await ipHashOf(ctx.env) });
  assert.equal((await post(ctx, { text: LINE, ttsToken: mine }, '198.51.100.9')).status, 403);
  // Oversized text never reaches the token check's hash or Google.
  assert.equal((await post(ctx, { text: 'ก'.repeat(TTS_MAX_CHARS + 1), ttsToken: mine })).status, 400);
  assert.equal(ctx.calls.length, 0, 'Gemini never called');
  const spent = await ctx.env.BUDGET.get('global').fetch('https://do/status', { method: 'POST', body: JSON.stringify({ day: utcDay(), ledger: 'tts' }) }).then((r) => r.json());
  assert.equal(spent.spentMicros, 0, 'refusals release the reservation');
});

test('POST /api/tts: a server-signed line -> audio, real cost on the tts ledger, replay served from cache at $0', async () => {
  const ctx = guardedApp();
  const ttsToken = await signTtsToken(TEST_SECRET, { text: LINE, ipHash: await ipHashOf(ctx.env) });
  const res = await post(ctx, { text: LINE, ttsToken });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  assert.equal(res.headers.get('x-tts-cache'), 'miss');
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), WAV);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].body.input[0].content[0].text, LINE);
  const status = () => ctx.env.BUDGET.get('global').fetch('https://do/status', { method: 'POST', body: JSON.stringify({ day: utcDay(), ledger: 'tts' }) }).then((r) => r.json());
  const meta = () => ctx.env.BUDGET.get('global').fetch('https://do/status', { method: 'POST', body: JSON.stringify({ day: utcDay() }) }).then((r) => r.json());
  const after1 = await status();
  assert.equal(after1.spentMicros, toMicros(ttsUsd({ total_input_tokens: 40, total_output_tokens: 100 })));
  assert.equal((await meta()).spentMicros, 0, 'Meta ledger untouched');
  const again = await post(ctx, { text: LINE, ttsToken });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('x-tts-cache'), 'hit');
  assert.equal(ctx.calls.length, 1, 'replay costs nothing');
  assert.equal((await status()).spentMicros, after1.spentMicros);
});

test('POST /api/tts: Google down -> 502 (page falls back to speechSynthesis); no key -> 503 tts-off', async () => {
  const ctx = guardedApp({ status: 400 });
  const ttsToken = await signTtsToken(TEST_SECRET, { text: LINE, ipHash: await ipHashOf(ctx.env) });
  const res = await post(ctx, { text: LINE, ttsToken });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'tts-http-400');
  const off = guardedApp({ env: abuseEnv() });
  const r2 = await post(off, { text: LINE, ttsToken });
  assert.equal(r2.status, 503);
  assert.equal((await r2.json()).error, 'tts-off');
  assert.equal(off.calls.length, 0);
});

test('POST /api/tts: own daily cap, then 503 budget; the kill switch stops it too', async () => {
  const ctx = guardedApp({ env: abuseEnv({ GEMINI_API_KEY: 'gk', TTS_DAILY_USD_CAP: '0.001' }) });
  const ttsToken = await signTtsToken(TEST_SECRET, { text: LINE, ipHash: await ipHashOf(ctx.env) });
  const res = await post(ctx, { text: LINE, ttsToken });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'budget');
  assert.equal(body.ledger, 'tts');
  assert.equal(ctx.calls.length, 0);
  const paused = guardedApp({ env: abuseEnv({ GEMINI_API_KEY: 'gk', KILL_SWITCH: '1' }) });
  assert.equal((await post(paused, { text: LINE, ttsToken })).status, 503);
  assert.equal(paused.calls.length, 0);
});

test('Budget: cumulative cap since submission pauses the ledger; day keys of both ledgers survive prune', async () => {
  const b = new Budget({ storage: memStorage() }, {});
  const since = '2026-11-04';
  const r = (day, micros) => b.reserve({ day, micros, capMicros: 10e6, totalCapMicros: 45e6, since });
  assert.equal((await b.reserve({ day: '2026-11-03', micros: 9e6, capMicros: 10e6, totalCapMicros: 45e6, since })).totalMicros, undefined, 'before submission: not counted');
  for (const day of ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']) assert.equal((await r(day, 10e6)).ok, true);
  const over = await r('2026-11-08', 6e6);
  assert.deepEqual([over.ok, over.scope, over.totalMicros], [false, 'total', 40e6]);
  assert.equal((await r('2026-11-08', 5e6)).ok, true, 'exactly at the total is allowed');
  await b.settle({ day: '2026-11-08', deltaMicros: -2e6, since });
  assert.equal((await b.status({ day: '2026-11-08', since })).totalMicros, 43e6);
  await b.reserve({ day: '2026-11-08', micros: 1, capMicros: 1e6, ledger: 'tts' });
  await b.reserve({ day: '2026-11-09', micros: 1, capMicros: 1e6, ledger: 'tts' });
  const keys = [...(await b.state.storage.list({ prefix: '' })).keys()].sort();
  assert.ok(keys.includes('spent:2026-11-08') && keys.includes('spent:tts:2026-11-08') && keys.includes('total:meta:2026-11-04'));
  assert.ok(!keys.includes('spent:2026-11-05'), 'old meta days pruned');
  assert.deepEqual(ledgerCaps({ DAILY_USD_CAP: '10', TOTAL_USD_CAP: '45', TOTAL_SINCE: since }), { dayUsd: 10, totalUsd: 45, since });
  assert.equal(ledgerCaps({}, 'meta').totalUsd, Infinity, 'no TOTAL_USD_CAP = no total cap');
});

test('protect: total cap reached -> 503 budget-total for Meta routes', async () => {
  const env = abuseEnv({ TOTAL_USD_CAP: '0.01', TOTAL_SINCE: '2000-01-01' });
  const app = new Hono();
  app.post('/x', protect('verdict'), (c) => c.json({ ok: true }));
  const res = await app.request('/x', { method: 'POST', headers: await authHeaders(env, TEST_IP, { 'content-type': 'application/json' }), body: '{}' }, env);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'budget-total');
  assert.ok(body.messageTh && body.messageEn);
});

test('trap reply carries a speak token for exactly its line', async () => {
  const app = new Hono();
  const fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ reply: LINE, items: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  registerWonderRoutes(app, { protect: () => async (c, next) => { c.set('abuse', { ipHash: 'ipx' }); await next(); }, getKey: () => 'k', getSecret: () => 'sec', fetch });
  const res = await app.request('/api/trap/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: [{ speaker: 'caller', text: 'ฮัลโหล' }] }) });
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal((await verifyTtsToken('sec', data.ttsToken, { text: data.reply, ipHash: 'ipx' })).ok, true);
  assert.equal((await verifyTtsToken('sec', data.ttsToken, { text: 'other text', ipHash: 'ipx' })).ok, false);
});

test('pre-generated audio covers every fixed line, files exist, voice matches the live route', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'audio', 'manifest.json'), 'utf8'));
  assert.equal(manifest.model, TTS_MODEL);
  assert.equal(manifest.voice, TTS_VOICE, 'static lines and live trap lines share one voice');
  const fixed = [DISCLOSURE_LINE_TH, DISCLOSURE_LINE_EN, ...Object.values(RX_LINES).flat(), ...STALL_LINES, CLOSING_LINE];
  for (const line of fixed) {
    const f = manifest.lines[line.trim()];
    assert.ok(f, `missing audio for: ${line}`);
    assert.ok(fs.statSync(path.join(PUBLIC, 'audio', f)).size > 1000, f);
  }
  assert.match(manifest.note, /Meta/);
});

test('voice disclosure is on /demo-live and in the README', () => {
  const said = 'Voice output only: Gemini TTS, because Meta';
  const html = fs.readFileSync(path.join(PUBLIC, 'demo-live.html'), 'utf8');
  const readme = fs.readFileSync(path.join(PUBLIC, '..', '..', 'README.md'), 'utf8');
  assert.ok(html.includes(said) && html.includes('every decision is a Meta model'));
  assert.ok(readme.includes(said));
  assert.match(readme, /every\s+decision is a Meta model/);
  assert.match(html, /id="rxCaption"[^>]*aria-live="polite"/);
});
