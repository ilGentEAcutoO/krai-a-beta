import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, headline, mean, median, pathOf, ratio, usdFor, wilson } from '../src/eval.js';

const T = (verdict, confidence, path, latencyMs, jevInput = 1000) => ({
  verdict, confidence, path, latencyMs,
  probabilities: null,
  signals: {},
  usage: { judge: { jev: { calls: 1, input: jevInput, output: 0 }, gemini: {}, errors: [] } },
});
const R = (id, cls, final, turns, extra = {}) => ({
  id, class: cls, alsoOk: [], lang: 'th', category: 'x', tags: [],
  expertTurn: 1, scriptTurns: turns.length,
  final, finalConfidence: 0.9,
  ok: final === cls, safe: final === cls,
  endedBy: 'script-end', turnsPlayed: turns.length,
  turnsToCorrect: final === cls ? 1 : null,
  lagVsExpert: final === cls ? 0 : null,
  usd: { judge: 0.0001 },
  turns,
  ...extra,
});

test('pathOf labels escalation paths like v2', () => {
  assert.equal(pathOf({ engine: 'rule' }), 'rule');
  assert.equal(pathOf({ engine: 'jev' }), 'jev');
  assert.equal(pathOf({ engine: 'gemini', probabilities: { SCAM: 1 } }), 'jev>gemini');
  assert.equal(pathOf({ engine: 'gemini' }), 'gemini-only');
  assert.equal(pathOf({ engine: 'rules-fallback' }), 'rules-fallback');
});

test('usdFor prices Jev input tokens only', () => {
  const u = usdFor({ jev: { calls: 1, input: 1_000_000, output: 500 }, gemini: {} });
  assert.equal(u, 0.042);
});

test('wilson returns an honest interval on small n', () => {
  assert.deepEqual(wilson(0, 0), null);
  const [lo, hi] = wilson(29, 29);
  assert.ok(lo > 0.85 && hi === 1);
  const [lo2, hi2] = wilson(0, 19);
  assert.equal(lo2, 0);
  assert.ok(hi2 < 0.2);
});

test('computeMetrics: confusion, recall, false alarms, latency', () => {
  const results = [
    R('s1', 'SCAM', 'SCAM', [T('SCAM', 0.9, 'jev', 300)]),
    R('s2', 'SCAM', 'UNSURE', [T('UNSURE', 0.5, 'jev', 400)]),
    R('l1', 'LEGIT', 'LEGIT', [T('LEGIT', 0.85, 'jev', 200)]),
    R('l2', 'LEGIT', 'SCAM', [T('SCAM', 0.82, 'rule', 10)]),
    R('u1', 'UNSURE', 'UNSURE', [T('UNSURE', 0.6, 'jev', 250)]),
  ];
  const m = computeMetrics(results);
  assert.equal(m.calls, 5);
  assert.deepEqual(m.confusion.SCAM, { SCAM: 1, LEGIT: 0, UNSURE: 1 });
  assert.equal(m.scam.recall, 0.5);
  assert.equal(m.scam.precisionVsLegit, 0.5);
  assert.deepEqual(m.scam.missedAsUnsure, ['s2']);
  assert.equal(m.legit.falseScamAlarm, 0.5);
  assert.deepEqual(m.legit.falseScamIds, ['l2']);
  assert.equal(m.unsure.keptUnsure, 1);
  assert.equal(m.accuracy, 0.6);
  assert.equal(m.latency.judgeMedianMs, 250);
  assert.equal(m.latency.byPath.jev.turns, 4);
  assert.equal(m.latency.byPath.rule.turns, 1);
});

test('computeMetrics: alsoOk counts as safe but not exact', () => {
  const r = R('u2', 'UNSURE', 'LEGIT', [T('LEGIT', 0.7, 'jev', 200)], { alsoOk: ['LEGIT'], safe: true });
  const m = computeMetrics([r]);
  assert.equal(m.accuracy, 0);
  assert.equal(m.safeAccuracy, 1);
});

test('headline renders the one-line verdict', () => {
  const results = [R('s1', 'SCAM', 'SCAM', [T('SCAM', 0.9, 'jev', 300)])];
  const m = computeMetrics(results);
  const h = headline(m, { totalThb: 0.03 });
  assert.match(h, /SCAM recall 100%/);
  assert.match(h, /0 of 0 legit calls flagged/);
  assert.match(h, /0\.30 s per turn/);
});

test('mean/median/ratio ignore non-finite input', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(mean([1, 2, NaN]), 1.5);
  assert.equal(ratio(1, 0), null);
});
