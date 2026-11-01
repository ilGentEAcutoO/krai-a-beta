import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Budget, RateLimit, capUsd, doCall, fromMicros, sparkUsd, toMicros, utcDay, voiceUsd, wavSeconds,
} from '../src/budget.js';
import { PRICING } from '../src/eval.js';
import { fakeNamespace, memStorage } from './fakes.mjs';

test('cost math: Spark usage x PRICING, voice per second, micro-dollar rounding', () => {
  const p = PRICING.meta.spark;
  const usd = sparkUsd({ prompt_tokens: 4000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 1000 } });
  assert.equal(usd, (3000 * p.input + 1000 * p.cached + 200 * p.output) / 1e6);
  assert.equal(sparkUsd({ input: 10, output: 5 }), (10 * p.input + 5 * p.output) / 1e6, 'short names too');
  assert.equal(sparkUsd({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 99 } }), (10 * p.cached) / 1e6, 'cached capped at input');
  assert.equal(sparkUsd(undefined), 0);
  assert.equal(voiceUsd(3600), 0.18);
  assert.equal(voiceUsd(600), 0.03);
  assert.equal(voiceUsd(-5), 0);
  assert.equal(toMicros(0.0123456), 12346);
  assert.equal(fromMicros(12346), 0.012346);
  assert.equal(toMicros(-1), 0);
});

test('capUsd defaults to 5, honours a numeric DAILY_USD_CAP', () => {
  assert.equal(capUsd({}), 5);
  assert.equal(capUsd({ DAILY_USD_CAP: '' }), 5);
  assert.equal(capUsd({ DAILY_USD_CAP: 'abc' }), 5);
  assert.equal(capUsd({ DAILY_USD_CAP: '12.5' }), 12.5);
  assert.equal(capUsd({ DAILY_USD_CAP: '0' }), 0);
});

test('utcDay switches at 00:00 UTC (07:00 Bangkok)', () => {
  assert.equal(utcDay(Date.parse('2026-11-01T23:59:59Z')), '2026-11-01');
  assert.equal(utcDay(Date.parse('2026-11-02T00:00:00Z')), '2026-11-02');
});

function wav({ byteRate = 32000, dataBytes = 32000 } = {}) {
  const buf = new ArrayBuffer(44 + dataBytes);
  const dv = new DataView(buf);
  const put = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  put(0, 'RIFF'); dv.setUint32(4, 36 + dataBytes, true); put(8, 'WAVE');
  put(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, byteRate / 2, true); dv.setUint32(28, byteRate, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  put(36, 'data'); dv.setUint32(40, dataBytes, true);
  return buf;
}

test('wavSeconds reads byteRate + data size; truncated header falls back', () => {
  assert.equal(wavSeconds(wav({ byteRate: 32000, dataBytes: 64000 })), 2);
  assert.equal(wavSeconds(wav({ byteRate: 48000, dataBytes: 24000 })), 0.5);
  const tiny = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69, 0, 0]).buffer;
  assert.equal(wavSeconds(tiny), 0);
});

test('Budget: reserve under cap, refuse over cap, settle replaces estimate', async () => {
  const b = new Budget({ storage: memStorage() }, {});
  const day = '2026-11-01';
  assert.deepEqual(await b.reserve({ day, micros: 400, capMicros: 1000 }), { ok: true, spentMicros: 400 });
  assert.deepEqual(await b.reserve({ day, micros: 600, capMicros: 1000 }), { ok: true, spentMicros: 1000 });
  assert.deepEqual(await b.reserve({ day, micros: 1, capMicros: 1000 }), { ok: false, spentMicros: 1000 });
  // actual cost of the second call was 100, not 600
  assert.deepEqual(await b.settle({ day, deltaMicros: -500 }), { ok: true, spentMicros: 500 });
  assert.equal((await b.reserve({ day, micros: 500, capMicros: 1000 })).ok, true);
  assert.equal((await b.settle({ day, deltaMicros: -99999 })).spentMicros, 0, 'never negative');
  assert.deepEqual(await b.status({ day: '2026-11-02' }), { ok: true, spentMicros: 0 }, 'new UTC day starts at 0');
});

test('Budget: first reserve of a day prunes days older than yesterday', async () => {
  const storage = memStorage();
  storage.store.set('spent:2026-10-01', 5);
  storage.store.set('spent:2026-10-31', 7);
  const b = new Budget({ storage }, {});
  await b.reserve({ day: '2026-11-01', micros: 1, capMicros: 10 });
  assert.deepEqual([...storage.store.keys()].sort(), ['spent:2026-10-31', 'spent:2026-11-01']);
});

test('Budget over fetch-RPC via doCall; unknown op is 404', async () => {
  const ns = fakeNamespace(Budget);
  const r = await doCall(ns, 'global', 'reserve', { day: '2026-11-01', micros: 5, capMicros: 10 });
  assert.equal(r.ok, true);
  assert.equal((await doCall(ns, 'global', 'status', { day: '2026-11-01' })).spentMicros, 5);
  assert.equal((await doCall(ns, 'global', 'reserve', { day: 'not-a-day', micros: 1, capMicros: 10 })).ok, false);
  await assert.rejects(doCall(ns, 'global', 'drop-table', {}), /do-drop-table-404/);
});

test('RateLimit: per-minute then per-day windows with Retry-After', async () => {
  const rl = new RateLimit({ storage: memStorage() }, {});
  const t0 = Date.parse('2026-11-01T10:00:10Z');
  for (let i = 0; i < 3; i++) assert.equal((await rl.hit({ kind: 'verdict', perMin: 3, perDay: 5, now: t0 })).ok, true);
  const blocked = await rl.hit({ kind: 'verdict', perMin: 3, perDay: 5, now: t0 + 1000 });
  assert.deepEqual(blocked, { ok: false, scope: 'minute', retryAfter: 49 });
  assert.equal((await rl.hit({ kind: 'other', perMin: 3, perDay: 5, now: t0 })).ok, true, 'kinds are independent');
  const t1 = t0 + 60000;
  assert.equal((await rl.hit({ kind: 'verdict', perMin: 3, perDay: 5, now: t1 })).ok, true);
  assert.equal((await rl.hit({ kind: 'verdict', perMin: 3, perDay: 5, now: t1 })).ok, true);
  const day = await rl.hit({ kind: 'verdict', perMin: 3, perDay: 5, now: t1 });
  assert.equal(day.scope, 'day');
  assert.equal(day.retryAfter, Math.ceil((Date.parse('2026-11-02T00:00:00Z') - t1) / 1000));
  assert.equal((await rl.hit({ kind: 'verdict', perMin: 3, perDay: 5, now: Date.parse('2026-11-02T00:00:01Z') })).ok, true);
});

test('RateLimit: live slots cap concurrency, expire, release, and count per day', async () => {
  const rl = new RateLimit({ storage: memStorage() }, {});
  const now = Date.parse('2026-11-01T10:00:00Z');
  const opts = { maxConcurrent: 2, perDay: 3, ttlMs: 60000 };
  assert.equal((await rl.liveAcquire({ id: 'a', now, ...opts })).ok, true);
  assert.equal((await rl.liveAcquire({ id: 'b', now, ...opts })).ok, true);
  const full = await rl.liveAcquire({ id: 'c', now, ...opts });
  assert.equal(full.ok, false);
  assert.equal(full.scope, 'concurrent');
  assert.ok(full.retryAfter >= 1);
  await rl.liveRelease({ id: 'a' });
  assert.equal((await rl.liveAcquire({ id: 'c', now, ...opts })).ok, true, 'release frees a slot');
  // slots expire even if the release is lost; the daily counter still caps
  const later = now + 61000;
  const day = await rl.liveAcquire({ id: 'd', now: later, ...opts });
  assert.equal(day.ok, false);
  assert.equal(day.scope, 'day');
});
