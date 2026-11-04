import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { buildReport } from '../src/report.js';
import { DISCLOSURE_TH, defang, formatReport, templateParams } from '../src/notify/format.js';
import { postJson } from '../src/notify/http.js';
import { telegram } from '../src/notify/telegram.js';
import { whatsapp } from '../src/notify/whatsapp.js';
import { line } from '../src/notify/line.js';
import { createGuard, enabledChannels, notifyAfterReport, notifyReport, reportKey } from '../src/notify/index.js';

const C = (text) => ({ role: 'caller', text });
const A = (text) => ({ role: 'ai', text });
const TURNS = [
  A('ระบบผู้ช่วยรับสายอัตโนมัติรับสายแทนเจ้าของเบอร์ ขอทราบชื่อและธุระค่ะ'),
  C('ผมร้อยตำรวจเอกสมชาย จาก สภ.เมือง มีหมายจับคดีฟอกเงินในชื่อคุณ'),
  C('ต้องโอนเงินไปตรวจสอบที่บัญชี 123-4-56789-0 ธนาคารกสิกร ด่วน เข้าลิงก์ https://evil.example/pay ด้วย'),
];
const MODEL = {
  claimedIdentity: { value: 'ร้อยตำรวจเอกสมชาย สภ.เมือง', quote: 'ผมร้อยตำรวจเอกสมชาย จาก สภ.เมือง' },
  tactic: 'fake-police', callType: 'scam', verdict: 'SCAM', confidence: 0.95,
  intel: [{ type: 'organisation', value: 'สภ.เมือง', quote: 'จาก สภ.เมือง' }],
};
const REPORT = buildReport({ model: MODEL, turns: TURNS, now: Date.UTC(2026, 10, 4) });

const SECRETS = {
  TELEGRAM_BOT_TOKEN: '123456:SECRET-TG', TELEGRAM_CHAT_ID: '-1001',
  WHATSAPP_TOKEN: 'SECRET-WA', WHATSAPP_PHONE_NUMBER_ID: '1065', WHATSAPP_TO: '+66812345678',
  LINE_CHANNEL_ACCESS_TOKEN: 'SECRET-LINE', LINE_TO: 'U4af498',
};
const ENV = { NOTIFY_ENABLED: '1', ...SECRETS };

// fetch double: answers per URL host; records every call.
function fakeFetch(responder = okResponder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = await responder(url, init, calls.length);
    return { status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}
function okResponder(url) {
  if (url.includes('telegram')) return { status: 200, body: { ok: true, result: { message_id: 42 } } };
  if (url.includes('graph.facebook')) return { status: 200, body: { messages: [{ id: 'wamid.X' }] } };
  return { status: 200, body: { sentMessages: [{ id: '777', quoteToken: 'q' }] } };
}
const quiet = () => {};

test('format: Thai report with disclosure, defanged caller link, no transcript lines', () => {
  const text = formatReport(REPORT);
  assert.match(text, /Krai-A/);
  assert.ok(text.includes(DISCLOSURE_TH));
  assert.ok(text.includes('🔴'));
  assert.ok(text.includes(REPORT.headlineTh));
  assert.ok(text.includes('hxxps://evil[.]example/pay'), text);
  assert.ok(!text.includes('https://evil.example'));
  assert.ok(!text.includes('ขอทราบชื่อและธุระ'), 'receptionist lines never appear');
  assert.ok(!text.includes('หมายจับคดีฟอกเงิน'), 'raw caller lines never appear (only verified values)');
  assert.ok(text.includes('https://thaipoliceonline.go.th'), 'official next-step link kept');
  assert.equal(defang('http://a.b'), 'hxxp://a[.]b');
});

test('format: respects the length limit and keeps the disclosure', () => {
  const big = { ...REPORT, nextSteps: Array.from({ length: 10 }, (_, k) => ({ id: `s${k}`, th: 'ก'.repeat(390) })) };
  const text = formatReport(big, { maxChars: 1500 });
  assert.ok(text.length <= 1500, String(text.length));
  assert.ok(text.includes(DISCLOSURE_TH));
  const tiny = formatReport(big, { maxChars: 200 });
  assert.ok(tiny.length <= 200 && tiny.endsWith(DISCLOSURE_TH));
});

test('format: strips control and bidi characters from caller values', () => {
  const r = { ...REPORT, intel: [{ type: 'name', labelTh: 'ชื่อ', value: 'A‮B\nC\u0000D' }] };
  const text = formatReport(r);
  assert.ok(text.includes('- ชื่อ: A B C D'), text);
});

test('templateParams: three single-line params', () => {
  const p = templateParams(REPORT);
  assert.equal(p.length, 3);
  for (const s of p) assert.ok(!/[\n\t]/.test(s) && s.length <= 900);
  assert.equal(p[2], DISCLOSURE_TH);
});

test('telegram: exact URL, headers and body', async () => {
  const f = fakeFetch();
  const r = await telegram.send(REPORT, ENV, { fetch: f });
  assert.deepEqual(r, { ok: true, channel: 'telegram', id: '42', attempts: 1 });
  const [c] = f.calls;
  assert.equal(c.url, 'https://api.telegram.org/bot123456:SECRET-TG/sendMessage');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(Object.keys(c.body).sort(), ['chat_id', 'link_preview_options', 'text']);
  assert.equal(c.body.chat_id, '-1001');
  assert.deepEqual(c.body.link_preview_options, { is_disabled: true });
  assert.equal(c.body.text, formatReport(REPORT, { maxChars: 4000 }));
  assert.ok(c.body.text.length <= 4096);
});

test('whatsapp: text message request', async () => {
  const f = fakeFetch();
  const r = await whatsapp.send(REPORT, ENV, { fetch: f });
  assert.deepEqual(r, { ok: true, channel: 'whatsapp', id: 'wamid.X', attempts: 1 });
  const [c] = f.calls;
  assert.equal(c.url, 'https://graph.facebook.com/v26.0/1065/messages');
  assert.equal(c.init.headers.Authorization, 'Bearer SECRET-WA');
  assert.equal(c.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(c.body, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '+66812345678', type: 'text',
    text: { preview_url: false, body: formatReport(REPORT, { maxChars: 4000 }) },
  });
});

test('whatsapp: template request when WHATSAPP_TEMPLATE is set', async () => {
  const f = fakeFetch();
  await whatsapp.send(REPORT, { ...ENV, WHATSAPP_TEMPLATE: 'krai_a_report', WHATSAPP_TEMPLATE_LANG: 'th' }, { fetch: f });
  assert.deepEqual(f.calls[0].body, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '+66812345678', type: 'template',
    template: {
      name: 'krai_a_report', language: { code: 'th' },
      components: [{ type: 'body', parameters: templateParams(REPORT).map((text) => ({ type: 'text', text })) }],
    },
  });
});

test('whatsapp: closed 24h window error is reported by code, not retried', async () => {
  const f = fakeFetch(() => ({ status: 400, body: { error: { code: 131047, message: 'Re-engagement message' } } }));
  const r = await whatsapp.send(REPORT, ENV, { fetch: f });
  assert.deepEqual(r, { ok: false, channel: 'whatsapp', error: 'http-400:131047', attempts: 1 });
  assert.equal(f.calls.length, 1);
});

test('line: push request with retry key', async () => {
  const f = fakeFetch();
  const r = await line.send(REPORT, ENV, { fetch: f, retryKey: '123e4567-e89b-12d3-a456-426614174000' });
  assert.deepEqual(r, { ok: true, channel: 'line', id: '777', attempts: 1 });
  const [c] = f.calls;
  assert.equal(c.url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(c.init.headers.Authorization, 'Bearer SECRET-LINE');
  assert.equal(c.init.headers['X-Line-Retry-Key'], '123e4567-e89b-12d3-a456-426614174000');
  assert.deepEqual(c.body, { to: 'U4af498', messages: [{ type: 'text', text: formatReport(REPORT, { maxChars: 4904 }) }] });
});

test('line: generated retry key is a UUID and a 409 after retry counts as delivered', async () => {
  const f = fakeFetch((url, init, n) => (n === 1 ? { status: 503, body: {} } : { status: 409, body: {} }));
  const r = await line.send(REPORT, ENV, { fetch: f });
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 2);
  const k = f.calls[0].init.headers['X-Line-Retry-Key'];
  assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(f.calls[1].init.headers['X-Line-Retry-Key'], k, 'same key on retry');
});

test('http: timeout ~ timeoutMs; non-idempotent timeout is not retried, idempotent once', async () => {
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  let n = 0;
  const counted = (...a) => { n += 1; return hang(...a); };
  const t0 = Date.now();
  const r = await postJson(counted, 'https://x.test', { body: {}, timeoutMs: 50 });
  assert.equal(r.error, 'timeout');
  assert.equal(n, 1);
  assert.ok(Date.now() - t0 < 1000);
  n = 0;
  const r2 = await postJson(counted, 'https://x.test', { body: {}, timeoutMs: 50, idempotent: true, pauseMs: 1 });
  assert.equal(r2.attempts, 2);
  assert.equal(n, 2);
});

test('http: 5xx/network retried at most once; 4xx never', async () => {
  let n = 0;
  const r = await postJson(async () => { n += 1; return { status: 500, json: async () => ({}) }; }, 'https://x.test', { body: {}, pauseMs: 1 });
  assert.equal(n, 2);
  assert.equal(r.status, 500);
  n = 0;
  await postJson(async () => { n += 1; throw new Error('boom'); }, 'https://x.test', { body: {}, pauseMs: 1 });
  assert.equal(n, 2);
  n = 0;
  await postJson(async () => { n += 1; return { status: 401, json: async () => ({}) }; }, 'https://x.test', { body: {}, pauseMs: 1 });
  assert.equal(n, 1);
});

test('registry: opt-in only', () => {
  assert.deepEqual(enabledChannels(SECRETS).map((a) => a.name), [], 'secrets without NOTIFY_ENABLED send nothing');
  assert.deepEqual(enabledChannels({ NOTIFY_ENABLED: '1' }), []);
  assert.deepEqual(enabledChannels({ NOTIFY_ENABLED: '1', TELEGRAM_BOT_TOKEN: 'your-telegram-bot-token', TELEGRAM_CHAT_ID: '1' }), [], 'example placeholders are not config');
  assert.deepEqual(enabledChannels({ ...ENV, NOTIFY_ENABLED: '0' }), []);
  assert.deepEqual(enabledChannels(ENV).map((a) => a.name), ['telegram', 'whatsapp', 'line']);
  assert.deepEqual(enabledChannels({ NOTIFY_ENABLED: 'true', LINE_CHANNEL_ACCESS_TOKEN: 'x', LINE_TO: 'U' }).map((a) => a.name), ['line']);
});

test('notifyReport: one failing channel does not affect the others and nothing throws', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('telegram')) throw new Error('network down');
    return okResponder(url);
  });
  const res = await notifyReport(REPORT, ENV, { fetch: f, guard: createGuard(), log: quiet });
  const by = Object.fromEntries(res.map((r) => [r.channel, r]));
  assert.equal(by.telegram.ok, false);
  assert.equal(by.telegram.error, 'network');
  assert.equal(by.whatsapp.ok, true);
  assert.equal(by.line.ok, true);
  assert.deepEqual(await notifyReport(null, ENV, { fetch: f, log: quiet }), []);
});

test('notifyReport: results and log never contain tokens', async () => {
  const lines = [];
  const f = fakeFetch(() => ({ status: 401, body: { ok: false, description: 'Unauthorized bot123456:SECRET-TG' } }));
  const res = await notifyReport(REPORT, ENV, { fetch: f, guard: createGuard(), log: (s) => lines.push(s) });
  const out = JSON.stringify(res) + lines.join('\n');
  for (const s of Object.values(SECRETS).filter((v) => /SECRET/.test(v))) assert.ok(!out.includes(s), s);
});

test('notifyReport: at most one message per channel per call, hourly cap, verdict filter', async () => {
  const f = fakeFetch();
  const guard = createGuard();
  const env = { NOTIFY_ENABLED: '1', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1', NOTIFY_MAX_PER_HOUR: '2' };
  await notifyReport(REPORT, env, { fetch: f, guard, log: quiet });
  const again = await notifyReport({ ...REPORT, generatedAt: 'later' }, env, { fetch: f, guard, log: quiet });
  assert.equal(again[0].error, 'duplicate');
  assert.equal(f.calls.length, 1);
  await notifyReport({ ...REPORT, callerTurns: 9 }, env, { fetch: f, guard, log: quiet });
  const capped = await notifyReport({ ...REPORT, callerTurns: 10 }, env, { fetch: f, guard, log: quiet });
  assert.equal(capped[0].error, 'rate-limited');
  assert.equal(f.calls.length, 2);
  const filtered = await notifyReport({ ...REPORT, verdict: 'LEGIT' }, { ...env, NOTIFY_VERDICTS: 'SCAM,UNSURE' }, { fetch: f, guard: createGuard(), log: quiet });
  assert.deepEqual(filtered, []);
  assert.notEqual(reportKey(REPORT), reportKey({ ...REPORT, verdict: 'UNSURE' }));
});

function reportApp(fetchFn, routeStatus = 200) {
  const app = new Hono();
  app.use('/api/report', notifyAfterReport({ fetch: fetchFn, guard: createGuard() }));
  app.post('/api/report', (c) => c.json(routeStatus === 200 ? { ok: true, report: REPORT } : { ok: false, error: 'empty-call' }, routeStatus));
  return app;
}

test('middleware: delivers via waitUntil without changing the response', async () => {
  const f = fakeFetch();
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException() {} };
  const res = await reportApp(f).request('/api/report', { method: 'POST', body: '{}' }, ENV, ctx);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).report.verdict, 'SCAM');
  assert.equal(pending.length, 1);
  const out = await pending[0];
  assert.equal(out.length, 3);
  assert.equal(f.calls.length, 3);
});

test('middleware: no-op when disabled or the route failed; a crashing adapter keeps the response', async () => {
  const f = fakeFetch();
  const ctx = { waitUntil: () => assert.fail('should not schedule'), passThroughOnException() {} };
  let res = await reportApp(f).request('/api/report', { method: 'POST', body: '{}' }, SECRETS, ctx);
  assert.equal(res.status, 200);
  res = await reportApp(f, 400).request('/api/report', { method: 'POST', body: '{}' }, ENV, ctx);
  assert.equal(res.status, 400);
  assert.equal(f.calls.length, 0);
  const boom = async () => { throw new TypeError('kaput'); };
  const pending = [];
  res = await reportApp(boom).request('/api/report', { method: 'POST', body: '{}' }, ENV, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
  assert.equal(res.status, 200);
  const out = await pending[0];
  assert.ok(out.every((r) => r.ok === false));
});
