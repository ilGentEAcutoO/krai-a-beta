import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PICKS, buildSamples, readJsonl } from '../../scripts/build-samples.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const train = readJsonl(path.join(ROOT, 'corpus', 'thai-tactics.jsonl'));
const sealed = readJsonl(path.join(ROOT, 'corpus', 'sealed.jsonl'));
const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'public', 'samples.json'), 'utf8'));

test('build-samples: committed samples.json is exactly what the script builds', () => {
  assert.deepEqual(committed, buildSamples(train, sealed));
});

test('samples.json: train only, disjoint from sealed (ids and caller lines)', () => {
  const sealedIds = new Set(sealed.map((c) => c.id));
  const sealedLines = new Set(sealed.flatMap((c) => c.turns.map((t) => t.trim())));
  const byId = new Map(train.map((c) => [c.id, c]));
  assert.ok(committed.samples.length >= 6 && committed.samples.length <= 12);
  for (const s of committed.samples) {
    assert.ok(!sealedIds.has(s.id), `sealed id leaked: ${s.id}`);
    const c = byId.get(s.id);
    assert.ok(c, `not in train: ${s.id}`);
    assert.deepEqual(s.turns, c.turns, `${s.id}: turns must be the train turns verbatim`);
    assert.equal(s.class, c.class);
    for (const t of s.turns) assert.ok(!sealedLines.has(t.trim()), `${s.id}: sealed caller line`);
    assert.ok(s.labelTh && s.labelEn, `${s.id}: picker labels`);
  }
});

test('samples.json: covers the demo story', () => {
  const s = committed.samples;
  const has = (fn, what) => assert.ok(s.some(fn), `missing ${what}`);
  has((x) => x.category === 'fake-police' && x.class === 'SCAM', 'fake-police SCAM');
  has((x) => x.category === 'bank-security' && x.class === 'SCAM', 'bank-security SCAM');
  has((x) => x.tags.includes('injection'), 'injection attempt');
  has((x) => x.class === 'LEGIT' && ['hospital', 'delivery'].includes(x.category), 'LEGIT hospital/delivery');
  has((x) => x.class === 'UNSURE', 'UNSURE');
  has((x) => x.tags.includes('slow-burn'), 'slow-burn');
  has((x) => x.tags.includes('code-switch'), 'code-switch');
  has((x) => x.lang === 'en', 'an English call');
});

test('build-samples: rejects sealed ids, sealed lines and unknown ids', () => {
  const t = [{ id: 'a', class: 'SCAM', lang: 'th', category: 'x', tags: [], turns: ['hello'], source: 'b3-new' }];
  const sealedRow = { id: 'a', turns: ['other'] };
  assert.throws(() => buildSamples(t, [sealedRow], [['a', 'th', 'en']]), /sealed id/);
  assert.throws(() => buildSamples(t, [{ id: 'z', turns: ['hello'] }], [['a', 'th', 'en']]), /sealed caller line/);
  assert.throws(() => buildSamples(t, [], [['missing', 'th', 'en']]), /not in train/);
  const sealedSource = [{ ...t[0], source: 'b3-sealed' }];
  assert.throws(() => buildSamples(sealedSource, [], [['a', 'th', 'en']]), /sealed-source/);
  assert.equal(buildSamples(t, [], [['a', 'th', 'en']]).samples[0].labelEn, 'en');
});

test('build-samples: picks are unique', () => {
  const ids = PICKS.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
});
