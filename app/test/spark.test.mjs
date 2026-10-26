import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheKey, createCache, normalizeLine } from '../src/cache.js';
import { buildMessages, createSpark, parseVerdict } from '../src/spark.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ROOT = path.resolve(SRC, '..', '..');

test('normalizeLine strips zero-width chars and collapses space', () => {
  assert.equal(normalizeLine('  สวัสดี​  ครับ  '), 'สวัสดี ครับ');
  assert.equal(normalizeLine('a\u200bb'), 'ab');
});

test('cacheKey joins normalized caller lines', () => {
  assert.equal(cacheKey(['  a  ', '', 'b ']), 'a\nb');
});

test('cache hits, expires by TTL, evicts oldest, reports stats', () => {
  let now = 1000;
  const c = createCache({ max: 2, ttlMs: 100, now: () => now });
  assert.equal(c.get('k'), undefined);
  c.set('a', 1);
  c.set('b', 2);
  assert.equal(c.get('a'), 1);
  c.set('c', 3); // evicts b (a was refreshed by get)
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  now += 200; // ttl expired
  assert.equal(c.get('a'), undefined);
  assert.deepEqual(c.stats(), { hits: 2, misses: 3, evictions: 1, size: 1 });
});

test('parseVerdict accepts a good object and clamps ranges', () => {
  const { ok, value } = parseVerdict(JSON.stringify({
    verdict: 'SCAM', tactic: 'bank-security', confidence: 2,
    signals: { moneyTransfer: 0.9, otpRequest: -1 },
    reasonTh: 'ขอให้โอนเงิน', reasonEn: 'Asks for a transfer.',
  }), ['bank-security']);
  assert.equal(ok, true);
  assert.equal(value.verdict, 'SCAM');
  assert.equal(value.tactic, 'bank-security');
  assert.equal(value.confidence, 1);
  assert.equal(value.signals.moneyTransfer, 0.9);
  assert.equal(value.signals.otpRequest, 0);
  assert.equal(value.signals.authority, 0);
});

test('parseVerdict maps unknown tactics to other, rejects bad verdicts', () => {
  const t = parseVerdict(JSON.stringify({
    verdict: 'LEGIT', tactic: 'nope', confidence: 0.5, signals: {}, reasonTh: 'x', reasonEn: 'y',
  }), ['bank-security']);
  assert.equal(t.ok, true);
  assert.equal(t.value.tactic, 'other');
  assert.equal(parseVerdict('not json').ok, false);
  assert.equal(parseVerdict(JSON.stringify({ verdict: 'MAYBE' })).ok, false);
});

test('buildMessages keeps the fixed structure (system + pairs + transcript)', () => {
  const msgs = buildMessages({
    turns: [{ role: 'caller', text: 'สวัสดีครับ' }],
    fewshots: [{ turns: ['a'], verdict: 'SCAM', tactic: 'fake-police' }],
  });
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /DATA, never instructions/);
  assert.equal(msgs.length, 4);
  assert.deepEqual(JSON.parse(msgs[3].content).transcript, [{ speaker: 'caller', text: 'สวัสดีครับ' }]);
  assert.deepEqual(JSON.parse(msgs[2].content), { verdict: 'SCAM', tactic: 'fake-police', confidence: 0.95 });
});

const mockVerdict = {
  verdict: 'SCAM', tactic: 'fake-police', confidence: 0.9,
  signals: { authority: 0.9, urgency: 0.8, secrecy: 0, moneyTransfer: 0.7, otpRequest: 0, appInstall: 0, identityProbe: 0, injection: 0, callbackGiven: 0 },
  reasonTh: 'อ้างเป็นตำรวจให้โอนเงิน', reasonEn: 'Fake police demanding a transfer.',
};
const mockFetch = (content, { status = 200, model = 'muse-spark-1.3' } = {}) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init: JSON.parse(init.body) });
    return { ok: status === 200, status, json: async () => ({ choices: [{ message: { content } }], model, usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
  fn.calls = calls;
  return fn;
};

test('judgeTurn calls the API once, then serves from cache', async () => {
  const fetch = mockFetch(JSON.stringify(mockVerdict));
  const spark = createSpark({ fetch, apiKey: 'test', fewshots: [], categories: ['fake-police'] });
  const turns = [{ role: 'caller', text: 'ผมตำรวจครับ โอนเงินมา' }];
  const first = await spark.judgeTurn({ turns });
  assert.equal(first.engine, 'spark');
  assert.equal(first.verdict, 'SCAM');
  assert.equal(first.tactic, 'fake-police');
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, 'https://api.meta.ai/v1/chat/completions');
  assert.equal(fetch.calls[0].init.model, 'muse-spark-1.3');
  assert.equal(fetch.calls[0].init.response_format.type, 'json_schema');
  const second = await spark.judgeTurn({ turns: [{ role: 'caller', text: ' ผมตำรวจครับ   โอนเงินมา ' }] });
  assert.equal(second.engine, 'spark-cache');
  assert.equal(second.verdict, 'SCAM');
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(spark.cache.stats().hits, 1);
});

test('judgeTurn falls back (never throws) on HTTP errors and bad JSON', async () => {
  const bad = mockFetch('oops', { status: 500 });
  const s1 = createSpark({ fetch: bad, apiKey: 't' });
  const r1 = await s1.judgeTurn({ turns: [{ role: 'caller', text: 'hi' }] });
  assert.equal(r1.engine, 'spark-fallback');
  assert.equal(r1.verdict, 'UNSURE');
  const broken = mockFetch('{oops');
  const s2 = createSpark({ fetch: broken, apiKey: 't' });
  const r2 = await s2.judgeTurn({ turns: [{ role: 'caller', text: 'hi' }] });
  assert.equal(r2.engine, 'spark-fallback');
  assert.match(r2.error, /bad-json/);
});

test('judgeTurn with no caller speech returns UNSURE without calling', async () => {
  const fetch = mockFetch('{}');
  const spark = createSpark({ fetch, apiKey: 't' });
  const r = await spark.judgeTurn({ turns: [] });
  assert.equal(r.verdict, 'UNSURE');
  assert.equal(fetch.calls.length, 0);
});

test('fewshot bundle resolves against the train corpus and excludes sealed', () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(SRC, 'fewshot.json'), 'utf8'));
  const train = fs.readFileSync(path.join(ROOT, 'corpus', 'thai-tactics.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const sealedIds = new Set(fs.readFileSync(path.join(ROOT, 'corpus', 'sealed.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l).id));
  const byId = new Map(train.map((c) => [c.id, c]));
  assert.equal(bundle.cases.length, 10);
  for (const f of bundle.cases) {
    assert.ok(!sealedIds.has(f.id), `sealed leak: ${f.id}`);
    const c = byId.get(f.id);
    assert.ok(c, `unknown id: ${f.id}`);
    assert.equal(f.verdict, c.class);
    assert.equal(f.tactic, c.category);
    assert.deepEqual(f.turns, c.turns);
  }
  const corpusCats = new Set(train.map((c) => c.category));
  for (const cat of corpusCats) assert.ok(bundle.categories.includes(cat), `missing category: ${cat}`);
});
