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

// ---- eval.mjs runner: cap, checkpoint/resume, dry-run, subsets ----
// Fake fetch only: the real Meta API is never called from tests.
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { capWouldCross } from '../src/eval.js';
import { readCheckpoint, runEval } from '../../scripts/eval.mjs';

const CASE = (id, cls, n = 2) => ({
  id, class: cls, lang: 'th', category: 'x', expertTurn: 1,
  turns: Array.from({ length: n }, (_, i) => `${id} line ${i + 1}`),
});
const CORPUS = [CASE('a1', 'SCAM'), CASE('a2', 'LEGIT'), CASE('a3', 'UNSURE'), CASE('a4', 'SCAM'), CASE('a5', 'LEGIT')];

function tempRoot(corpus = CORPUS) {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'evalrun-'));
  fs.mkdirSync(nodePath.join(root, 'corpus'));
  fs.writeFileSync(nodePath.join(root, 'corpus', 'thai-tactics.jsonl'), corpus.map((c) => JSON.stringify(c)).join('\n'));
  fs.writeFileSync(nodePath.join(root, 'corpus', 'sealed.jsonl'), JSON.stringify(CASE('s1', 'SCAM')));
  return root;
}

// Every chat call bills exactly $0.10 (80,000 uncached input tokens at $1.25/1M).
function fakeMeta({ onPost } = {}) {
  const calls = { get: 0, post: 0 };
  const fetch = async (url, init = {}) => {
    if ((init.method || 'GET') === 'GET') {
      calls.get += 1;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    calls.post += 1;
    if (onPost) onPost(calls.post);
    const content = JSON.stringify({
      verdict: 'UNSURE', tactic: 'none', confidence: 0.5,
      signals: {}, reasonTh: 'not clear', reasonEn: 'Not clear yet.',
    });
    return new Response(JSON.stringify({
      model: 'muse-spark-fake',
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 80000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
    }), { status: 200 });
  };
  return { fetch, calls };
}
const quiet = { log: () => {}, err: () => {} };
const ENV = { META_MODEL_API_KEY: 'test-key-not-real' };

test('capWouldCross: running average, first-case estimate, no cap', () => {
  assert.equal(capWouldCross({ spentUsd: 0.4, doneCases: 2, capUsd: 0.5 }).stop, true);
  assert.equal(capWouldCross({ spentUsd: 0.4, doneCases: 2, capUsd: 0.61 }).stop, false);
  assert.equal(capWouldCross({ spentUsd: 0, doneCases: 0, capUsd: 0.05, firstCaseEstimateUsd: 0.1 }).stop, true);
  assert.equal(capWouldCross({ spentUsd: 99, doneCases: 1, capUsd: Infinity }).stop, false);
});

test('spark run refuses to start without --max-usd (zero network)', async () => {
  const root = tempRoot();
  try {
    const { fetch, calls } = fakeMeta();
    const r = await runEval({ argv: ['--backend', 'spark'], fetch, env: ENV, root, ...quiet });
    assert.equal(r.exitCode, 2);
    assert.equal(calls.get + calls.post, 0);
    assert.equal(fs.existsSync(nodePath.join(root, 'eval-results')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cap stops before the next case would cross it and writes a partial result', async () => {
  const root = tempRoot();
  try {
    const { fetch, calls } = fakeMeta();
    const out = nodePath.join(root, 'eval-results', 'train-spark-cap');
    const r = await runEval({ argv: ['--backend', 'spark', '--max-usd', '0.5', '--out', out], fetch, env: ENV, root, ...quiet });
    assert.equal(r.exitCode, 4);
    assert.equal(r.stopReason, 'max-usd');
    assert.equal(calls.post, 4, 'two 2-turn cases at $0.10/turn; a third would reach $0.60');
    const o = JSON.parse(fs.readFileSync(nodePath.join(out, 'results.json'), 'utf8'));
    assert.equal(o.partial, true);
    assert.equal(o.stopReason, 'max-usd');
    assert.deepEqual([o.progress.completed, o.progress.total], [2, 5]);
    assert.ok(o.spend.usd <= 0.5 + 1e-9);
    assert.ok(Math.abs(o.spend.usd - 0.4) < 1e-9);
    assert.match(o.headline, /^PARTIAL 2\/5/);
    assert.match(fs.readFileSync(nodePath.join(out, 'summary.md'), 'utf8'), /PARTIAL RUN/);
    assert.deepEqual(readCheckpoint(out).cases.map((c) => c.id), ['a1', 'a2']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resume skips finished ids, keeps the cap cumulative, and completes the run', async () => {
  const root = tempRoot();
  try {
    const out = nodePath.join(root, 'eval-results', 'train-spark-res');
    await runEval({ argv: ['--backend', 'spark', '--max-usd', '0.5', '--out', out], fetch: fakeMeta().fetch, env: ENV, root, ...quiet });
    // same cap: already at $0.40 of $0.50 -> stops at once, no new spend
    const same = fakeMeta();
    const r0 = await runEval({ argv: ['--resume', out], fetch: same.fetch, env: ENV, root, ...quiet });
    assert.equal(r0.stopReason, 'max-usd');
    assert.equal(same.calls.post, 0);
    // raised cap: runs only a3..a5
    const more = fakeMeta();
    const r = await runEval({ argv: ['--resume', out, '--max-usd', '5'], fetch: more.fetch, env: ENV, root, ...quiet });
    assert.equal(r.exitCode, 0);
    assert.equal(more.calls.post, 6);
    const o = JSON.parse(fs.readFileSync(nodePath.join(out, 'results.json'), 'utf8'));
    assert.equal(o.partial, false);
    assert.equal(o.fullSet, true);
    assert.deepEqual(o.runs[0].results.map((x) => x.id), ['a1', 'a2', 'a3', 'a4', 'a5']);
    assert.ok(Math.abs(o.spend.usd - 1.0) < 1e-9);
    assert.equal(readCheckpoint(out).cases.length, 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resume refuses a model, dataset, backend or subset mismatch (zero network)', async () => {
  const root = tempRoot();
  try {
    const out = nodePath.join(root, 'eval-results', 'train-spark-mm');
    await runEval({ argv: ['--backend', 'spark', '--max-usd', '0.5', '--out', out], fetch: fakeMeta().fetch, env: ENV, root, ...quiet });
    const msgs = [];
    const f = fakeMeta();
    const bad = await runEval({ argv: ['--resume', out, '--max-usd', '5'], fetch: f.fetch, env: { ...ENV, SPARK_MODEL: 'muse-spark-9' }, root, log: () => {}, err: (m) => msgs.push(m) });
    assert.equal(bad.exitCode, 2);
    assert.match(msgs.join('\n'), /REFUSING to resume.*model/);
    const be = await runEval({ argv: ['--resume', out, '--backend', 'jev'], fetch: f.fetch, env: ENV, root, ...quiet });
    assert.equal(be.exitCode, 2);
    const sub = await runEval({ argv: ['--resume', out, '--limit', '1'], fetch: f.fetch, env: ENV, root, ...quiet });
    assert.equal(sub.exitCode, 2);
    fs.appendFileSync(nodePath.join(root, 'corpus', 'thai-tactics.jsonl'), `\n${JSON.stringify(CASE('a6', 'SCAM'))}`);
    const ds = await runEval({ argv: ['--resume', out, '--max-usd', '5'], fetch: f.fetch, env: ENV, root, ...quiet });
    assert.equal(ds.exitCode, 2);
    assert.equal(f.calls.get + f.calls.post, 0);
    assert.equal(readCheckpoint(out).cases.length, 2, 'checkpoint untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('interrupt (SIGINT path) flushes the finished cases as partial and logs the in-flight spend', async () => {
  const root = tempRoot();
  try {
    const out = nodePath.join(root, 'eval-results', 'train-spark-int');
    const hooks = {};
    const stop = { requested: false };
    let snapshot = null;
    const { fetch } = fakeMeta({
      onPost: (n) => {
        if (n === 4) { // case 2 in flight after its first billed turn: what Ctrl+C writes
          snapshot = hooks.flush('interrupted');
          stop.requested = true;
        }
      },
    });
    const r = await runEval({ argv: ['--backend', 'spark', '--max-usd', '5', '--out', out], fetch, env: ENV, root, stop, hooks, ...quiet });
    assert.equal(snapshot.partial, true);
    assert.equal(snapshot.stopReason, 'interrupted');
    assert.equal(snapshot.progress.completed, 1);
    assert.ok(Math.abs(snapshot.spend.abandonedUsd - 0.1) < 1e-9, 'billed turn of the in-flight case is counted');
    assert.equal(r.stopReason, 'interrupted');
    const ck = readCheckpoint(out);
    assert.equal(ck.abandoned.length, 1);
    assert.equal(ck.abandoned[0].id, 'a2');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run makes zero network calls and sizes the real few-shot prompt', async () => {
  const root = tempRoot();
  const realFetch = globalThis.fetch;
  let globalCalls = 0;
  globalThis.fetch = async () => { globalCalls += 1; throw new Error('network in dry-run'); };
  try {
    const { fetch, calls } = fakeMeta();
    const lines = [];
    const r = await runEval({ argv: ['--backend', 'spark', '--dry-run', '--max-usd', '0.5'], fetch, env: ENV, root, log: (m) => lines.push(m), err: () => {} });
    assert.equal(r.exitCode, 0);
    assert.equal(calls.get + calls.post + globalCalls, 0);
    assert.equal(r.plan.cases, 5);
    assert.equal(r.plan.calls, 10, 'sum of script turns');
    assert.ok(r.plan.requestBytes > 5 * 2 * 5000, 'every request carries the full few-shot prompt');
    assert.ok(r.plan.worstUsd > r.plan.expectedUsd && r.plan.expectedUsd > 0);
    assert.match(lines.join('\n'), /DRY RUN \(no network\)[\s\S]*worst-case USD/);
    assert.equal(fs.existsSync(nodePath.join(root, 'eval-results')), false, 'dry-run writes nothing');
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--cases / --limit select cheap subsets; unknown ids refuse', async () => {
  const root = tempRoot();
  try {
    const dry = (argv) => runEval({ argv: ['--backend', 'spark', '--dry-run', ...argv], fetch: fakeMeta().fetch, env: ENV, root, ...quiet });
    assert.deepEqual((await dry(['--cases', 'a4,a2'])).estimates.map((e) => e.id), ['a2', 'a4']);
    assert.deepEqual((await dry(['--limit', '2'])).estimates.map((e) => e.id), ['a1', 'a2']);
    assert.deepEqual((await dry(['--only', 'a3'])).estimates.map((e) => e.id), ['a3']);
    assert.equal((await dry(['--cases', 'nope'])).exitCode, 2);
    assert.equal((await dry(['--limit', '0'])).exitCode, 2);

    const out = nodePath.join(root, 'eval-results', 'train-spark-smoke');
    const f = fakeMeta();
    const r = await runEval({ argv: ['--backend', 'spark', '--max-usd', '5', '--cases', 'a3,a5', '--out', out], fetch: f.fetch, env: ENV, root, ...quiet });
    assert.equal(r.exitCode, 0);
    assert.equal(f.calls.post, 4);
    assert.equal(r.out.fullSet, false);
    assert.deepEqual([r.out.progress.completed, r.out.progress.setTotal], [2, 5]);
    assert.match(r.out.headline, /^SUBSET 2\/5/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
