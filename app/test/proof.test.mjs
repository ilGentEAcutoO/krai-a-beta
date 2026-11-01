import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProof, commandFor, findSecrets, invalidReason, pendingEntry, percentile, summarizeRun,
} from '../../scripts/build-proof.mjs';
import { HEADLINES, fullTableHtml, headlineCell, headlinesHtml, matrixHtml, pendingHtml } from '../public/proof.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// One judged turn. jevInput tokens at $0.042/1M -> cost is exact.
const T = (turn, verdict, latencyMs, { path: p = 'jev', jevInput = 1_000_000 } = {}) => ({
  turn, caller: `line ${turn}`, verdict, confidence: 0.9, path: p, model: p === 'spark-fallback' ? null : 'jev-1.14.0', latencyMs,
  action: 'continue', reasonEn: 'r', ai: 'ok',
  usage: { judge: { jev: { calls: 1, input: jevInput, output: 0 }, gemini: {}, meta: {}, errors: [] } },
});
const R = (id, cls, final, turns, extra = {}) => ({
  id, class: cls, alsoOk: [], lang: 'th', category: 'x', tags: [], expertTurn: 1,
  final, ok: final === cls, safe: final === cls, endedBy: 'script-end',
  turnsPlayed: turns.length, turnsToCorrect: final === cls ? 1 : null, turns, ...extra,
});
const RUN = (backend, results, { sealed = false, ranAt = '2026-10-26T00:00:00.000Z' } = {}) => ({
  ranAt, backend, dataset: { file: 'corpus/x.jsonl', sealed, calls: results.length },
  setup: { engines: 'test' }, costPerCall: { scope: 'judge only' }, runs: [{ run: 1, results }],
});

// 10 calls: 4 SCAM (1 judged LEGIT = unsafe miss, 1 UNSURE), 4 LEGIT (1 judged SCAM), 2 UNSURE.
// Latencies 100..1000 ms, one turn each -> p50 500, p95 1000.
const FIXTURE = [
  R('s1', 'SCAM', 'SCAM', [T(1, 'SCAM', 100)]),
  R('s2', 'SCAM', 'SCAM', [T(1, 'SCAM', 200)]),
  R('s3', 'SCAM', 'LEGIT', [T(1, 'LEGIT', 300)]),
  R('s4', 'SCAM', 'UNSURE', [T(1, 'UNSURE', 400)]),
  R('l1', 'LEGIT', 'LEGIT', [T(1, 'LEGIT', 500)]),
  R('l2', 'LEGIT', 'LEGIT', [T(1, 'LEGIT', 600)]),
  R('l3', 'LEGIT', 'LEGIT', [T(1, 'LEGIT', 700)]),
  R('l4', 'LEGIT', 'SCAM', [T(1, 'SCAM', 800)]),
  R('u1', 'UNSURE', 'UNSURE', [T(1, 'UNSURE', 900)]),
  R('u2', 'UNSURE', 'UNSURE', [T(1, 'UNSURE', 1000)]),
];

test('percentile is nearest-rank like eval.js', () => {
  const xs = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  assert.equal(percentile(xs, 0.5), 500);
  assert.equal(percentile(xs, 0.95), 1000);
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([7], 0.95), 7);
});

test('summarizeRun: accuracy, unsafe miss, false alarm, latency, cost', () => {
  const m = summarizeRun(RUN('jev-baseline', FIXTURE));
  assert.equal(m.n, 10);
  assert.deepEqual(m.accuracy, { k: 7, n: 10, rate: 0.7 });
  assert.deepEqual(m.scamRecall, { k: 2, n: 4, rate: 0.5 });
  assert.equal(m.unsafeMiss.k, 1);
  assert.deepEqual(m.unsafeMiss.ids, ['s3']);
  assert.deepEqual(m.falseAlarm, { k: 1, n: 4, rate: 0.25, ids: ['l4'] });
  assert.deepEqual(m.confusion.SCAM, { SCAM: 2, LEGIT: 1, UNSURE: 1 });
  assert.equal(m.latencyMs.p50, 500);
  assert.equal(m.latencyMs.p95, 1000);
  // 1M Jev input tokens per call at $0.042/1M
  assert.ok(Math.abs(m.cost.usdPerCall - 0.042) < 1e-12);
  assert.ok(Math.abs(m.cost.usdPer1000 - 42) < 1e-9);
  assert.ok(Math.abs(m.cost.thbPer1000 - 42 * 35) < 1e-6);
  assert.equal(m.turnsToVerdict.correct, 7);
  assert.equal(m.turnsToVerdict.atOrBeforeExpert, 7);
  assert.deepEqual(m.turnsToVerdict.scamAtOrBeforeExpert, { k: 2, n: 4 });
});

test('all-fallback spark run is not a measurement', () => {
  const fb = FIXTURE.map((r) => ({ ...r, turns: r.turns.map((t) => ({ ...t, path: 'spark-fallback' })) }));
  assert.equal(invalidReason(RUN('spark', fb)), 'all-turns-fallback');
  assert.equal(invalidReason(RUN('spark', FIXTURE)), null);
  assert.equal(invalidReason(RUN('jev-baseline', fb)), null);
});

test('findSecrets catches keys and env values, passes clean results', () => {
  assert.deepEqual(findSecrets(JSON.stringify(RUN('jev-baseline', FIXTURE)), {}), []);
  assert.ok(findSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456', {}).includes('bearer-token'));
  assert.ok(findSecrets('{"apiKey": "abcdefgh12345678"}', {}).length > 0);
  assert.ok(findSecrets('x my-secret-value-123 y', { META_MODEL_API_KEY: 'my-secret-value-123' }).includes('env:META_MODEL_API_KEY'));
});

test('buildProof: newest run per (set, backend), pending entries with commands, rejected fallback runs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-'));
  try {
    const put = (dir, o) => {
      fs.mkdirSync(path.join(root, 'eval-results', dir), { recursive: true });
      fs.writeFileSync(path.join(root, 'eval-results', dir, 'results.json'), JSON.stringify(o));
      fs.writeFileSync(path.join(root, 'eval-results', dir, 'summary.md'), '# s\n');
    };
    put('train-jev-old', RUN('jev-baseline', FIXTURE.slice(0, 2), { ranAt: '2026-10-01T00:00:00.000Z' }));
    put('train-jev-new', RUN('jev-baseline', FIXTURE, { ranAt: '2026-10-26T00:00:00.000Z' }));
    const fb = FIXTURE.map((r) => ({ ...r, turns: r.turns.map((t) => ({ ...t, path: 'spark-fallback' })) }));
    put('train-spark-402', RUN('spark', fb));
    const outDir = path.join(root, 'out');
    const d = buildProof({ root, outDir, env: {} });

    const jev = d.sets.train.runs.jev;
    assert.equal(jev.status, 'done');
    assert.equal(jev.dir, 'train-jev-new');
    assert.equal(jev.metrics.n, 10);
    assert.equal(jev.raw.results, 'proof/runs/train-jev-new/results.json');
    assert.ok(fs.existsSync(path.join(outDir, 'runs', 'train-jev-new', 'results.json')));

    const spark = d.sets.train.runs.spark;
    assert.equal(spark.status, 'pending');
    assert.equal(spark.reason, 'all-turns-fallback');
    assert.equal(spark.command, 'cd app && npm run eval:train:spark && npm run proof:build');
    assert.equal(spark.metrics, undefined, 'pending entries carry no numbers');
    assert.equal(d.sets.sealed.runs.spark.status, 'pending');
    assert.equal(d.sets.sealed.runs.jev.command, commandFor('sealed', 'jev'));
    assert.equal(d.defaultSet, 'train');
    assert.equal(d.cases.train.length, 10);
    assert.equal(d.cases.train.find((c) => c.id === 's3').verdicts.jev.unsafeMiss, true);
    assert.equal(d.cases.train[0].verdicts.spark, null);
    assert.deepEqual(d.cases.sealed, []);
    assert.ok(fs.existsSync(path.join(outDir, 'data.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildProof: a partial or subset run is published as partial n/total, never as the full-set result', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-'));
  try {
    const put = (dir, o, files = ['results.json']) => {
      fs.mkdirSync(path.join(root, 'eval-results', dir), { recursive: true });
      if (files.includes('results.json')) fs.writeFileSync(path.join(root, 'eval-results', dir, 'results.json'), JSON.stringify(o));
      if (files.includes('cases.jsonl')) fs.writeFileSync(path.join(root, 'eval-results', dir, 'cases.jsonl'), '{}\n');
    };
    const partial = (results, extra = {}) => ({
      ...RUN('spark', results, { ranAt: '2026-11-01T00:00:00.000Z' }),
      partial: true, stopReason: 'max-usd', progress: { completed: results.length, total: 120, setTotal: 120 }, ...extra,
    });
    put('train-spark-capped', partial(FIXTURE.slice(0, 4)));
    // a 5-case smoke subset that completed is still not the train result
    put('sealed-spark-smoke', {
      ...RUN('spark', FIXTURE.slice(0, 5), { sealed: true }),
      partial: false, fullSet: false, progress: { completed: 5, total: 5, setTotal: 35 }, dataset: { sealed: true, subset: '--cases (5)' },
    });
    put('train-jev-killed', null, ['cases.jsonl']);
    const d = buildProof({ root, outDir: path.join(root, 'out'), env: {} });

    const s = d.sets.train.runs.spark;
    assert.equal(s.status, 'partial');
    assert.deepEqual(s.progress, { completed: 4, total: 120 });
    assert.match(s.reason, /partial: 4\/120 calls measured \(max-usd\)/);
    assert.equal(s.metrics, undefined, 'no headline metrics for a partial run');
    assert.equal(s.partialMetrics.n, 4);
    assert.match(s.resumeCommand, /--resume eval-results\/train-spark-capped/);
    assert.equal(fs.existsSync(path.join(root, 'out', 'runs', 'train-spark-capped')), false, 'partial raw files are not published as a run');

    const sm = d.sets.sealed.runs.spark;
    assert.equal(sm.status, 'partial');
    assert.deepEqual(sm.progress, { completed: 5, total: 35 });
    assert.equal(d.defaultSet, 'train', 'a partial sealed run never makes sealed the default');
    assert.deepEqual(d.unfinalizedRuns.map((u) => u.dir), ['train-jev-killed']);
    assert.match(d.unfinalizedRuns[0].command, /--finalize eval-results\/train-jev-killed/);

    // rendering: partial reuses the pending contract (no %, no $) and shows n/total
    for (const h of HEADLINES) {
      const html = headlineCell(s, h);
      assert.doesNotMatch(html, /\d+(\.\d+)?%|\$\d/, `${h.key}: partial cell must not show a number`);
    }
    assert.match(pendingHtml(s), /4\/120/);

    // a complete run wins over a newer partial
    put('train-spark-full', RUN('spark', FIXTURE, { ranAt: '2026-10-30T00:00:00.000Z' }));
    const d2 = buildProof({ root, outDir: path.join(root, 'out2'), env: {} });
    assert.equal(d2.sets.train.runs.spark.status, 'done');
    assert.equal(d2.sets.train.runs.spark.dir, 'train-spark-full');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildProof refuses to publish a raw file containing a secret', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-'));
  try {
    const o = RUN('jev-baseline', FIXTURE);
    o.setup.engines = 'Bearer abcdefghijklmnopqrstuvwxyz0123456789';
    fs.mkdirSync(path.join(root, 'eval-results', 'train-jev-x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'eval-results', 'train-jev-x', 'results.json'), JSON.stringify(o));
    assert.throws(() => buildProof({ root, outDir: path.join(root, 'out'), env: {} }), /secret-like/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('npm scripts exist for every pending command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  for (const s of ['eval:train:spark', 'eval:sealed:spark', 'eval:sealed:jev', 'eval:train:jev', 'proof:build']) {
    assert.ok(pkg.scripts[s], `missing npm script ${s}`);
  }
  assert.match(pkg.scripts['eval:sealed:spark'], /--sealed/);
  assert.match(pkg.scripts['eval:sealed:spark'], /--backend spark/);
  for (const s of ['eval:train:spark', 'eval:sealed:spark', 'eval:smoke:spark']) {
    assert.match(pkg.scripts[s], /--max-usd \d/, `${s} carries an explicit spend cap`);
  }
  assert.match(pkg.scripts['eval:dry'], /--dry-run/);
});

// ---- rendering contract: a pending run shows the command, never a number ----
test('pending cells render "pending live run" + the command and no metric', () => {
  const p = pendingEntry('train', 'spark');
  const done = { status: 'done', role: 'baseline', labelTh: 'Baseline · Jev', labelEn: 'Jev', metrics: summarizeRun(RUN('jev-baseline', FIXTURE)) };
  const set = { runs: { spark: p, jev: done } };
  for (const h of HEADLINES) {
    const html = headlineCell(p, h);
    assert.match(html, /รอรันจริง/);
    assert.match(html, /pending live run/);
    assert.ok(html.includes('npm run eval:train:spark'));
    assert.doesNotMatch(html, /\d+(\.\d+)?%|\$\d/, `${h.key}: pending cell must not show a number`);
  }
  const hl = headlinesHtml(set);
  assert.match(hl, /70%/, 'baseline accuracy shown beside it');
  assert.equal((hl.match(/รอรันจริง/g) || []).length, 3);
  assert.match(fullTableHtml(set), /รอรันจริง/);
  assert.match(matrixHtml(p), /pending live run/);
  assert.doesNotMatch(pendingHtml({ ...p, command: '<img src=x onerror=1>' }), /<img/, 'command is escaped');
});

test('proof.html exists, is light-only, and loads proof/data.json via proof.js', () => {
  const html = fs.readFileSync(path.join(APP, 'public', 'proof.html'), 'utf8');
  assert.match(html, /<meta name="color-scheme" content="light only">/);
  assert.match(html, /src="\/proof\.js"/);
  const js = fs.readFileSync(path.join(APP, 'public', 'proof.js'), 'utf8');
  assert.match(js, /\/proof\/data\.json/);
  assert.doesNotMatch(html + js, /\b(alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(js, /setInterval/, 'static data: no polling');
  for (const page of ['index.html', 'showdown.html']) {
    assert.match(fs.readFileSync(path.join(APP, 'public', page), 'utf8'), /href="\/proof\.html"/, `${page} links to /proof`);
  }
});

test('committed proof/data.json has the Jev baseline and honest pending Spark entries', () => {
  const file = path.join(APP, 'public', 'proof', 'data.json');
  assert.ok(fs.existsSync(file), 'run: npm run proof:build');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(d.sets.train.runs.jev.status, 'done');
  for (const set of ['train', 'sealed']) {
    const s = d.sets[set].runs.spark;
    if (s.status === 'pending') {
      assert.equal(s.metrics, undefined);
      assert.match(s.command, new RegExp(`eval:${set}:spark`));
    }
  }
  const raw = path.join(APP, 'public', d.sets.train.runs.jev.raw.results);
  assert.ok(fs.existsSync(raw));
  assert.deepEqual(findSecrets(fs.readFileSync(raw, 'utf8'), {}), []);
});
