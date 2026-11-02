// Eval runner (machine-side): plays the corpus through a judge backend.
// Costs real money: never part of `npm test` (tests drive it with a fake fetch).
// Usage: node scripts/eval.mjs [--backend jev|spark] [--sealed]
//          [--max-usd N]          spend cap; REQUIRED for spark runs
//          [--cases id,id] [--limit N]   cheap subsets (--only = --cases)
//          [--dry-run]            planned calls + USD estimate, no network
//          [--resume <runDir>]    continue a checkpointed run (same config)
//          [--finalize <runDir>]  rewrite results.json from cases.jsonl, no calls
//          [--repeat N] [--out dir] [--resummarize]
//          [--pipeline full|policy|raw]  spark only (default full = production:
//                 Spark -> policy.decideSpark -> Wonder for the grey zone ->
//                 policy.nextAction; policy = no Wonder; raw = Spark verdict as-is)
//          [--concurrency N]     cases in flight at once (default 1)
// Env: SPARK_MODEL, SPARK_EFFORT, WONDER_MODEL override the shipped defaults.
// Every finished case is appended to <runDir>/cases.jsonl as it completes, so
// a cap stop, Ctrl+C or crash never loses the measured part of a run.
// --sealed runs corpus/sealed.jsonl (held-out: never for tuning, read the
// corpus README first). Backends: jev (frozen v2 baseline) | spark (B5).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createJudge, nextAction as baselineNextAction, openingLine } from '../app/src/baseline/judge.js';
import { JEV_URL, TURN_QUESTIONS, buildState } from '../app/src/baseline/jev.js';
import { ESCALATION_SYSTEM, VERDICT_SCHEMA as GEMINI_SCHEMA } from '../app/src/baseline/gemini.js';
import {
  META_API, SYSTEM as SPARK_SYSTEM, VERDICT_EFFORT, VERDICT_MODEL, VERDICT_SCHEMA, buildMessages, createSpark,
} from '../app/src/spark.js';
import { decideSpark, nextAction as policyNextAction } from '../app/src/policy.js';
import { WONDER_MODEL, createWonder } from '../app/src/wonder.js';
import { createCache } from '../app/src/cache.js';
import fewshot from '../app/src/fewshot.json' with { type: 'json' };
import {
  PRICING, capWouldCross, computeMetrics, diagnose, headline, loadCorpus, mean, r4, ratio,
  runCase, summaryMd, usdFor,
} from '../app/src/eval.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_VERSION = 1;

// Dry-run assumptions (documented in docs/go-live.md). Worst case: byte-level
// BPE never emits more tokens than UTF-8 bytes, no prompt caching, and every
// turn spends SPARK_MAX_OUTPUT_TOKENS (same bound app/src/index.js reserves,
// since spark.js sends no max_completion_tokens). Expected: mostly-Thai text
// at ~2.5 bytes/token, ~600 output tokens (JSON verdict + low-effort
// reasoning), still no caching. Every script turn is assumed played (a
// hang-up ends a call early, so real calls are <= planned).
export const ESTIMATE = {
  worstBytesPerToken: 1,
  expectedBytesPerToken: 2.5,
  sparkMaxOutputTokens: 8192,
  sparkExpectedOutputTokens: 600,
  framingBytes: 512,
  geminiMaxOutputTokens: 8192,
  geminiExpectedOutputTokens: 300,
};

// A spark turn that never reached the model (402 billing, network, bad JSON)
// is the harness's honest UNSURE fallback, not a model answer.
const isFallbackTurn = (t) => t.path === 'spark-fallback';
const utf8Bytes = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const usd = (x) => `$${Number(x).toFixed(4)}`;

// The commit the harness ran from, so /proof can link each number to code.
function gitInfo(root) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

export const PIPELINES = ['full', 'policy', 'raw'];
// Runs written before a config key existed ran with these values.
const LEGACY_CONFIG = { effort: 'low', pipeline: 'raw', wonderModel: null, promptHash: null };

export function parseArgs(argv, root = ROOT) {
  const a = {
    backend: 'jev', cases: null, limit: null, repeat: 1, resummarize: false, sealed: false, out: null,
    maxUsd: null, resume: null, finalize: null, dryRun: false, pipeline: 'full', concurrency: 1,
  };
  const ids = (s) => new Set(String(s || '').split(',').map((x) => x.trim()).filter(Boolean));
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--backend') a.backend = String(argv[++i] || 'jev');
    else if (k === '--only' || k === '--cases') a.cases = ids(argv[++i]);
    else if (k === '--limit') a.limit = Number(argv[++i]);
    else if (k === '--repeat') a.repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (k === '--out') a.out = path.resolve(argv[++i]);
    else if (k === '--max-usd') a.maxUsd = Number(argv[++i]);
    else if (k === '--resume') a.resume = path.resolve(String(argv[++i] || ''));
    else if (k === '--finalize') a.finalize = path.resolve(String(argv[++i] || ''));
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--resummarize') a.resummarize = true;
    else if (k === '--sealed') a.sealed = true;
    else if (k === '--pipeline') a.pipeline = String(argv[++i] || '');
    else if (k === '--concurrency') a.concurrency = Number(argv[++i]);
    else throw new Error(`unknown option ${k}`);
  }
  if (a.limit != null && !(Number.isInteger(a.limit) && a.limit > 0)) throw new Error('--limit needs a positive integer');
  if (a.maxUsd != null && !(Number.isFinite(a.maxUsd) && a.maxUsd > 0)) throw new Error('--max-usd needs a positive number');
  if (!PIPELINES.includes(a.pipeline)) throw new Error(`--pipeline must be one of ${PIPELINES.join('|')}`);
  if (!(Number.isInteger(a.concurrency) && a.concurrency >= 1 && a.concurrency <= 16)) throw new Error('--concurrency needs an integer 1..16');
  if (!a.out) a.out = path.join(root, 'eval-results', `${a.sealed ? 'sealed' : 'train'}-${a.backend}-${stamp()}`);
  return a;
}

export function selectCases(all, { cases = null, limit = null } = {}) {
  if (cases) {
    const known = new Set(all.map((c) => c.id));
    const missing = [...cases].filter((id) => !known.has(id));
    if (missing.length) throw new Error(`unknown case id(s): ${missing.join(', ')}`);
  }
  const picked = all.filter((c) => !cases || cases.has(c.id));
  return limit ? picked.slice(0, limit) : picked;
}

// Everything that must match for two invocations to be one measurement.
export function runConfig({ sealed, backend, env = process.env, datasetText = '', pipeline = 'full' }) {
  const base = {
    set: sealed ? 'sealed' : 'train',
    backend,
    datasetHash: sha256(datasetText).slice(0, 16),
  };
  if (backend === 'spark') {
    return {
      ...base,
      model: env.SPARK_MODEL || VERDICT_MODEL,
      effort: env.SPARK_EFFORT || VERDICT_EFFORT,
      pipeline,
      wonderModel: pipeline === 'full' ? env.WONDER_MODEL || WONDER_MODEL : null,
      fewshotHash: sha256(JSON.stringify(fewshot)).slice(0, 16),
      // System prompt + schema: a prompt change is a new measurement too.
      promptHash: sha256(SPARK_SYSTEM + JSON.stringify(VERDICT_SCHEMA)).slice(0, 16),
    };
  }
  return {
    ...base,
    model: `${env.JEV_MODEL || 'jev-latest'}+${env.GEMINI_MODEL || 'gemini-3.5-flash-lite'}`,
    fewshotHash: null,
  };
}

// ---- dry-run cost model: real prompt bytes, no network ----
// Replays each case's transcript with the canned receptionist lines (the
// baseline persona is canned and offline) and sizes the exact request body
// each turn would send.
export async function estimateCases(cases, backend, { pricing = PRICING, est = ESTIMATE } = {}) {
  const persona = createJudge({ fetch: () => { throw new Error('dry-run: no network'); }, config: {} });
  const sparkFixed = utf8Bytes(JSON.stringify(VERDICT_SCHEMA)) + est.framingBytes;
  const geminiFixed = utf8Bytes(ESCALATION_SYSTEM) + utf8Bytes(JSON.stringify(GEMINI_SCHEMA)) + est.framingBytes;
  const p = backend === 'spark' ? pricing.meta.spark : null;
  const g = Object.values(pricing.gemini)[0];
  const out = [];
  for (const c of cases) {
    const convo = [{ role: 'ai', text: openingLine(c.lang) }];
    let worst = 0;
    let expected = 0;
    let bytes = 0;
    for (let i = 0; i < c.turns.length; i++) {
      convo.push({ role: 'caller', text: c.turns[i] });
      if (backend === 'spark') {
        const b = utf8Bytes(JSON.stringify(buildMessages({ turns: convo, fewshots: fewshot.cases }))) + sparkFixed;
        bytes += b;
        worst += ((b / est.worstBytesPerToken) * p.input + est.sparkMaxOutputTokens * p.output) / 1e6;
        expected += ((b / est.expectedBytesPerToken) * p.input + est.sparkExpectedOutputTokens * p.output) / 1e6;
      } else {
        const jb = utf8Bytes(JSON.stringify({ model: 'jev-latest', state: buildState(convo), questions: TURN_QUESTIONS })) + est.framingBytes;
        const gb = utf8Bytes(JSON.stringify(convo)) + geminiFixed;
        bytes += jb;
        // worst: Jev every turn AND a Gemini escalation every turn
        worst += ((jb / est.worstBytesPerToken) * pricing.jev.input
          + (gb / est.worstBytesPerToken) * g.input + est.geminiMaxOutputTokens * g.output) / 1e6;
        // expected: Jev every turn, no escalation (measured ~1 in 10 turns, cheap either way)
        expected += ((jb / est.expectedBytesPerToken) * pricing.jev.input) / 1e6;
      }
      // canned "continue" line; the real reply only differs in the last turn
      const reply = await persona.personaReply({ turns: convo, verdict: 'UNSURE', lang: c.lang, action: 'continue' });
      convo.push({ role: 'ai', text: reply.text });
    }
    out.push({ id: c.id, turns: c.turns.length, requestBytes: bytes, worstUsd: worst, expectedUsd: expected });
  }
  return out;
}

export function planSummary(estimates) {
  const sum = (k) => estimates.reduce((s, e) => s + e[k], 0);
  return {
    cases: estimates.length,
    calls: sum('turns'),
    requestBytes: sum('requestBytes'),
    worstUsd: sum('worstUsd'),
    expectedUsd: sum('expectedUsd'),
    expectedUsdPerCase: estimates.length ? sum('expectedUsd') / estimates.length : 0,
  };
}

export function dryRunText({ args, config, estimates, selection }) {
  const s = planSummary(estimates);
  const lines = [
    `DRY RUN (no network): ${config.set} set · backend ${config.backend} · model ${config.model}${config.fewshotHash ? ` · few-shot ${fewshot.cases.length} (hash ${config.fewshotHash})` : ''}`,
    `selection: ${selection}`,
    `planned cases: ${s.cases} · estimated calls (sum of script turns, upper bound): ${s.calls} · request bytes: ${s.requestBytes}`,
    `expected USD: ${usd(s.expectedUsd)} (${usd(s.expectedUsdPerCase)}/case, ~฿${(s.expectedUsd * PRICING.thbPerUsd).toFixed(2)})`,
    `worst-case USD: ${usd(s.worstUsd)} (tokens = bytes, no cache, ${config.backend === 'spark' ? `${ESTIMATE.sparkMaxOutputTokens} output tokens every turn` : 'Gemini escalation with max output every turn'})`,
  ];
  if (args.repeat > 1) lines.push(`x${args.repeat} repeats: expected ${usd(s.expectedUsd * args.repeat)}, worst ${usd(s.worstUsd * args.repeat)}`);
  if (args.maxUsd != null) {
    const fits = (k) => {
      let acc = 0;
      let n = 0;
      for (const e of estimates) { if (acc + e[k] > args.maxUsd) break; acc += e[k]; n += 1; }
      return n;
    };
    lines.push(`cap ${usd(args.maxUsd)}: expected completes ${fits('expectedUsd')}/${s.cases} cases, worst case stops after ${fits('worstUsd')}/${s.cases}`);
  } else if (config.backend === 'spark') {
    lines.push('no --max-usd given: a real spark run will refuse to start without one');
  }
  return lines.join('\n');
}

// Meta bills Wonder and Spark at different rates: key usage by the model the
// request asked for (PRICING.meta.spark | PRICING.meta.wonder).
export function metaFamily(body) {
  try {
    return /wonder/i.test(String(JSON.parse(String(body || '{}')).model || '')) ? 'wonder' : 'spark';
  } catch {
    return 'spark';
  }
}

// ---- metering fetch: counts tokens per engine from the real responses ----
export function createMeter(baseFetch = (...a) => globalThis.fetch(...a)) {
  const blank = () => ({ jev: { calls: 0, input: 0, output: 0 }, gemini: {}, meta: {}, errors: [] });
  let cur = blank();
  let totalUsd = 0; // everything metered since creation, including an in-flight case
  async function meteredFetch(url, init = {}) {
    const u = String(url);
    const engine = u.startsWith(JEV_URL) ? 'jev' : u.startsWith(META_API) ? 'meta' : 'gemini';
    const counted = (init.method || 'GET') !== 'GET';
    let res;
    try {
      res = await baseFetch(url, init);
    } catch (e) {
      if (counted) cur.errors.push(`${engine}-${e.name === 'AbortError' ? 'timeout' : 'network'}`);
      throw e;
    }
    if (!counted) return res;
    if (!res.ok) {
      cur.errors.push(`${engine}-http-${res.status}`);
      return res;
    }
    try {
      const body = await res.clone().json();
      const one = blank();
      if (engine === 'jev') {
        one.jev = { calls: 1, input: Number(body?.usage?.input_tokens) || 0, output: Number(body?.usage?.output_tokens) || 0 };
        for (const k of ['calls', 'input', 'output']) cur.jev[k] += one.jev[k];
      } else if (engine === 'meta') {
        const m = body?.usage || {};
        const family = metaFamily(init.body);
        one.meta[family] = {
          calls: 1,
          input: Number(m.prompt_tokens) || 0,
          output: Number(m.completion_tokens) || 0,
          cached: Number(m.prompt_tokens_details?.cached_tokens) || 0,
        };
        const g = (cur.meta[family] ||= { calls: 0, input: 0, cached: 0, output: 0 });
        for (const k of ['calls', 'input', 'cached', 'output']) g[k] += one.meta[family][k];
      } else {
        const model = (u.match(/models\/([^:/]+):/) || [])[1] || 'gemini';
        const m = body?.usageMetadata || {};
        one.gemini[model] = {
          calls: 1,
          input: Number(m.promptTokenCount) || 0,
          output: (Number(m.candidatesTokenCount) || 0) + (Number(m.thoughtsTokenCount) || 0),
        };
        const g = (cur.gemini[model] ||= { calls: 0, input: 0, output: 0 });
        for (const k of ['calls', 'input', 'output']) g[k] += one.gemini[model][k];
      }
      totalUsd += usdFor(one);
    } catch {
      // unreadable body: the judge records its own failure
    }
    return res;
  }
  return {
    fetch: meteredFetch,
    take() { const t = cur; cur = blank(); return t; },
    totalUsd: () => totalUsd,
  };
}

// Free models probe (no tokens spent): proves the key works even with no billing.
async function probeMeta(fetch, apiKey) {
  try {
    const res = await fetch(`${META_API}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- checkpoint files ----
export const casesFile = (dir) => path.join(dir, 'cases.jsonl');
export const manifestFile = (dir) => path.join(dir, 'manifest.json');

// Tolerates a torn last line (process killed mid-write).
export function readCheckpoint(dir) {
  const f = casesFile(dir);
  const out = { cases: [], abandoned: [] };
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'case' && o.result?.id) out.cases.push(o);
    else if (o.type === 'abandoned') out.abandoned.push(o);
  }
  return out;
}

export const spentOf = (ck) => ck.cases.reduce((s, c) => s + (Number(c.usd) || 0), 0)
  + ck.abandoned.reduce((s, c) => s + (Number(c.usd) || 0), 0);

// Builds results.json + summary.md from cases.jsonl (the only source of truth).
export function finalizeRun(dir, { partial = null, stopReason = null, wallSeconds = null, root = ROOT, engineStatus = null } = {}) {
  const man = JSON.parse(fs.readFileSync(manifestFile(dir), 'utf8'));
  const ck = readCheckpoint(dir);
  const order = new Map(man.caseIds.map((id, i) => [id, i]));
  const runs = [];
  for (let k = 1; k <= man.repeat; k++) {
    const seen = new Map();
    for (const c of ck.cases) if (c.run === k && order.has(c.result.id)) seen.set(c.result.id, c.result);
    const results = [...seen.values()].sort((a, b) => order.get(a.id) - order.get(b.id));
    if (results.length) runs.push({ run: k, metrics: computeMetrics(results), misses: results.filter((r) => !r.ok).map(diagnose), results });
  }
  if (!runs.length) return null;
  const total = man.caseIds.length;
  const completed = runs[0].results.length;
  const allDone = runs.length === man.repeat && runs.every((r) => r.results.length === total);
  const isPartial = partial ?? !allDone;
  const allTurns = runs.flatMap((r) => r.results).flatMap((r) => r.turns);
  const fallbackTurns = allTurns.filter(isFallbackTurn).length;
  const m = runs[0].metrics;
  const judgeUsd = m.cost.judgeUsdPerCall.mean;
  const perCall = {
    turnsPerCall: r4(mean(runs[0].results.map((r) => r.turnsPlayed))),
    judgeUsd,
    judgeThb: judgeUsd * PRICING.thbPerUsd,
    totalUsd: judgeUsd,
    totalThb: judgeUsd * PRICING.thbPerUsd,
    scope: man.config.backend === 'jev'
      ? 'Judge only (Jev + Gemini escalation). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.'
      : 'Judge only (Spark few-shot, per-run cache). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.',
  };
  const spendUsd = spentOf(ck);
  const stability = runs.length > 1 && !isPartial ? (() => {
    const ids = runs[0].results.map((r) => r.id);
    const same = ids.filter((id) => new Set(runs.map((run) => run.results.find((r) => r.id === id)?.final)).size === 1);
    return { runs: runs.length, sameFinalVerdict: ratio(same.length, ids.length), flipped: ids.filter((id) => !same.includes(id)) };
  })() : null;
  const sealed = man.config.set === 'sealed';
  const head = headline(m, perCall);
  const out = {
    ranAt: man.startedAt,
    finishedAt: new Date().toISOString(),
    wallSeconds: wallSeconds ?? man.wallSeconds ?? null,
    git: man.git || gitInfo(root),
    partial: isPartial,
    progress: { completed, total, setTotal: man.setTotal ?? total, repeat: man.repeat, runsWithResults: runs.length },
    fullSet: !man.subset && total === (man.setTotal ?? total),
    stopReason: isPartial ? (stopReason || 'incomplete') : null,
    cap: { maxUsd: man.maxUsd ?? null },
    runConfig: man.config,
    validity: { turns: allTurns.length, fallbackTurns },
    backend: man.config.backend === 'jev' ? 'jev-baseline' : 'spark',
    dataset: {
      file: `corpus/${sealed ? 'sealed.jsonl' : 'thai-tactics.jsonl'}`,
      sealed,
      calls: completed,
      plannedCalls: total,
      subset: man.subset || null,
      byClass: m.byClass,
      byLang: m.byLang,
    },
    setup: {
      judge: man.config.backend === 'jev'
        ? 'app/src/baseline/judge.js (frozen v2 contract) with a metering fetch'
        : 'app/src/spark.js (few-shot + cache) with a metering fetch',
      receptionistLines: 'canned (no AI)',
      engines: man.enginesLabel,
    },
    pricing: PRICING,
    engineStatus: engineStatus ?? man.engineStatus ?? {},
    headline: isPartial ? `PARTIAL ${completed}/${total} calls (not the full-set result): ${head}`
      : man.subset ? `SUBSET ${completed}/${man.setTotal ?? total} calls (${man.subset}; not the full-set result): ${head}` : head,
    metrics: m,
    costPerCall: perCall,
    stability,
    misses: runs[0].misses,
    spend: {
      usd: spendUsd,
      thb: spendUsd * PRICING.thbPerUsd,
      abandonedUsd: ck.abandoned.reduce((s, c) => s + (Number(c.usd) || 0), 0),
      note: 'Everything this eval run called (all repeats, all resumes, incl. cases abandoned mid-way).',
    },
    runs: runs.map((r) => ({ run: r.run, metrics: r.run === 1 ? undefined : r.metrics, results: r.results })),
  };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(out, null, 2));
  const subsetNote = !isPartial && man.subset
    ? `> **SUBSET RUN** — ${completed} of ${man.setTotal ?? total} calls in the set (${man.subset}). Not the full-set result.

` : '';
  const banner = subsetNote + (isPartial
    ? `> **PARTIAL RUN** — ${completed} of ${total} calls completed (stopped: ${out.stopReason}). Not the full-set result. Resume: \`node scripts/eval.mjs --resume ${path.relative(root, dir).split(path.sep).join('/')} --max-usd <cap>\`\n\n`
    : '');
  fs.writeFileSync(path.join(dir, 'summary.md'), banner + summaryMd(out));
  return out;
}

// ---- the Spark pipeline the app runs (app/src/index.js + routes-wonder.js) ----
// raw:    Spark's own verdict with the baseline call actions (pre-tuning harness).
// policy: Spark -> policy.decideSpark -> policy.nextAction (/api/verdict/turn).
// full:   policy, and a grey-zone turn (decision.escalate) also asks Wonder,
//         as voice-client.js does via /api/verdict/escalate. Turn latency is
//         end to end (Spark + Wonder when it ran).
export function sparkPipelineJudge({ fetch, apiKey, config, cache, persona }) {
  const spark = createSpark({
    fetch, apiKey, model: config.model, effort: config.effort,
    fewshots: fewshot.cases, categories: fewshot.categories, cache,
  });
  const personaReply = (a) => persona.personaReply(a);
  if (config.pipeline === 'raw') {
    return { judgeTurn: (a) => spark.judgeTurn(a), nextAction: baselineNextAction, personaReply, cache };
  }
  const wonder = config.pipeline === 'full' ? createWonder({ fetch, apiKey, model: config.wonderModel }) : null;
  async function judgeTurn(a) {
    const t0 = Date.now();
    const s = await spark.judgeTurn(a);
    const d = decideSpark(s);
    let v = {
      ...s, sparkVerdict: s.verdict, sparkConfidence: s.confidence, sparkLatencyMs: s.latencyMs,
      verdict: d.verdict, confidence: d.confidence, rule: d.rule,
    };
    if (d.escalate && wonder) {
      const w = await wonder.judgeHard({ turns: a.turns, spark: s });
      if (w.engine === 'wonder') {
        v = {
          ...v, verdict: w.verdict, confidence: w.confidence, signals: w.signals, reasonEn: w.reasonEn,
          wonderVerdict: w.wonderVerdict, rule: w.guarded ? 'wonder-guard' : 'wonder',
          engine: s.engine === 'spark-fallback' ? 'spark-fallback' : `${s.engine}>wonder`,
        };
      } else {
        v.wonderError = w.error;
      }
    }
    v.latencyMs = Date.now() - t0;
    return v;
  }
  return { judgeTurn, nextAction: policyNextAction, personaReply, cache };
}

// ---- the run ----
// deps: fetch (injected in tests), env, root, log/err, stop ({requested}),
// hooks (receives flush(reason) for the SIGINT handler).
export async function runEval({
  argv = [], fetch = (...a) => globalThis.fetch(...a), env = process.env, root = ROOT,
  log = console.log, err = console.error, stop = { requested: false }, hooks = {},
} = {}) {
  let args;
  try {
    args = parseArgs(argv, root);
  } catch (e) {
    err(e.message);
    return { exitCode: 2 };
  }
  if (!['jev', 'spark'].includes(args.backend)) {
    err(`backend '${args.backend}' unknown (jev | spark)`);
    return { exitCode: 2 };
  }
  if (args.resummarize) {
    const file = path.join(args.out, 'results.json');
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    o.headline = headline(o.metrics, o.costPerCall);
    fs.writeFileSync(file, JSON.stringify(o, null, 2));
    fs.writeFileSync(path.join(args.out, 'summary.md'), summaryMd(o));
    log(o.headline);
    return { exitCode: 0, out: o };
  }
  if (args.finalize) {
    if (!fs.existsSync(manifestFile(args.finalize))) {
      err(`no manifest.json in ${args.finalize}`);
      return { exitCode: 2 };
    }
    const o = finalizeRun(args.finalize, { root, stopReason: 'finalized-from-checkpoint' });
    if (!o) { err('no finished cases in cases.jsonl'); return { exitCode: 2 }; }
    log(`${o.headline}\nwrote ${path.join(args.finalize, 'results.json')}`);
    return { exitCode: 0, out: o, dir: args.finalize };
  }

  // Resume: the manifest decides set/backend/cases; flags may only repeat them.
  let man = null;
  if (args.resume) {
    if (!fs.existsSync(manifestFile(args.resume))) {
      err(`cannot resume: no manifest.json in ${args.resume}`);
      return { exitCode: 2 };
    }
    man = JSON.parse(fs.readFileSync(manifestFile(args.resume), 'utf8'));
    if (args.cases || args.limit) {
      err('cannot combine --resume with --cases/--limit: the run keeps the case list it started with');
      return { exitCode: 2 };
    }
    args.sealed = man.config.set === 'sealed';
    args.backend = argv.includes('--backend') ? args.backend : man.config.backend;
    args.repeat = man.repeat;
    args.out = args.resume;
  }

  const datasetFile = path.join(root, 'corpus', args.sealed ? 'sealed.jsonl' : 'thai-tactics.jsonl');
  const datasetText = fs.readFileSync(datasetFile, 'utf8');
  if (man && !argv.includes('--pipeline')) args.pipeline = man.config.pipeline ?? LEGACY_CONFIG.pipeline;
  const config = runConfig({ sealed: args.sealed, backend: args.backend, env, datasetText, pipeline: args.pipeline });
  if (man) {
    const diff = Object.keys(config).filter((k) => config[k] !== (k in man.config ? man.config[k] : LEGACY_CONFIG[k]));
    if (diff.length) {
      err(`REFUSING to resume ${args.resume}: config mismatch (${diff.map((k) => `${k}: run=${man.config[k]} now=${config[k]}`).join('; ')}). `
        + 'A resumed run must be the same measurement. Start a new run instead.');
      return { exitCode: 2 };
    }
  }

  const all = loadCorpus(datasetFile);
  let calls;
  try {
    calls = man ? selectCases(all, { cases: new Set(man.caseIds) }) : selectCases(all, { cases: args.cases, limit: args.limit });
  } catch (e) {
    err(e.message);
    return { exitCode: 2 };
  }
  if (man) calls.sort((a, b) => man.caseIds.indexOf(a.id) - man.caseIds.indexOf(b.id));
  if (!calls.length) {
    err('no calls selected');
    return { exitCode: 2 };
  }
  const estimates = await estimateCases(calls, args.backend);
  const estById = new Map(estimates.map((e) => [e.id, e]));
  const selection = args.cases ? `--cases (${calls.length})` : args.limit ? `--limit ${args.limit}` : man ? 'resume (manifest case list)' : 'full set';

  if (args.dryRun) {
    log(dryRunText({ args, config, estimates, selection }));
    return { exitCode: 0, dryRun: true, plan: planSummary(estimates), estimates };
  }

  // Spending starts below this line.
  if (man && args.maxUsd == null) args.maxUsd = man.maxUsd ?? null;
  if (args.backend === 'spark' && args.maxUsd == null) {
    err('REFUSING to start a spark run without an explicit spend cap: pass --max-usd N (npm run eval:*:spark passes --max-usd 2). Try --dry-run first.');
    return { exitCode: 2 };
  }
  const cap = args.maxUsd ?? Infinity;
  if (args.sealed) {
    log('SEALED RUN: held-out set. Use for reporting only — never tune prompts, thresholds or few-shots against it.');
  }

  // One meter per case (cases may run concurrently); spend = finished + in flight.
  let makeJudge;
  let enginesLabel;
  let engineStatus = {};
  const probeMeter = createMeter(fetch);
  if (args.backend === 'jev') {
    const cfg = {
      typesafeApiKey: env.TYPESAFE_API_KEY || '',
      geminiApiKey: env.GEMINI_API_KEY || '',
      jevModel: env.JEV_MODEL || 'jev-latest',
      geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    };
    const engines = await createJudge({ fetch: probeMeter.fetch, config: cfg }).probeEngines();
    engineStatus = engines;
    makeJudge = (f) => createJudge({ fetch: f, config: cfg });
    enginesLabel = `Jev ${cfg.jevModel} · Gemini ${cfg.geminiModel} (escalation)`;
    log(`engines: jev ${engines.jev} (${cfg.jevModel}) | gemini ${engines.gemini} (${cfg.geminiModel})`);
    if (!engines.jev) err('WARNING: Jev is not reachable; numbers will reflect the fallback path.');
  } else {
    const apiKey = env.META_MODEL_API_KEY || '';
    const sharedCache = createCache();
    makeJudge = (f) => sparkPipelineJudge({
      fetch: f, apiKey, config, cache: sharedCache, persona: createJudge({ fetch: f, config: {} }),
    });
    const probe = await probeMeta(probeMeter.fetch, apiKey);
    engineStatus = { meta: probe };
    enginesLabel = `Spark ${config.model} effort ${config.effort} (few-shot ${fewshot.cases.length})`
      + (config.pipeline === 'raw' ? ' · raw verdict' : ' · code policy')
      + (config.pipeline === 'full' ? ` · ${config.wonderModel} for the grey zone` : '');
    log(`engines: meta ${probe} (models probe, key ${apiKey ? 'present' : 'MISSING'}) · pipeline ${config.pipeline}`);
    if (!probe) err('WARNING: Meta API is not reachable; turns will fall back to UNSURE.');
  }

  const dir = args.out;
  const fresh = !man;
  if (fresh) {
    fs.mkdirSync(dir, { recursive: true });
    man = {
      version: MANIFEST_VERSION,
      startedAt: new Date().toISOString(),
      config,
      caseIds: calls.map((c) => c.id),
      subset: args.cases || args.limit ? selection : null,
      setTotal: all.length,
      repeat: args.repeat,
      maxUsd: Number.isFinite(cap) ? cap : null,
      enginesLabel,
      engineStatus,
      git: gitInfo(root),
      wallSeconds: 0,
    };
  } else {
    man.maxUsd = Number.isFinite(cap) ? cap : null;
    man.engineStatus = engineStatus;
  }
  fs.writeFileSync(manifestFile(dir), JSON.stringify(man, null, 2));

  const ck = readCheckpoint(dir);
  const done = new Set(ck.cases.map((c) => `${c.run}:${c.result.id}`));
  const priorSpend = spentOf(ck);
  let doneWithSpend = ck.cases.length;
  let recordedUsd = 0; // finished cases of this invocation
  const t0 = Date.now();
  const priorWall = Number(man.wallSeconds) || 0;
  const wall = () => priorWall + Math.round((Date.now() - t0) / 1000);
  const append = (o) => fs.appendFileSync(casesFile(dir), `${JSON.stringify(o)}\n`);
  const inFlight = new Map(); // `${run}:${id}` -> { run, id, meter }
  const liveUsd = () => [...inFlight.values()].reduce((sum, f) => sum + f.meter.totalUsd(), 0);
  let firstOfRun = ck.cases.length === 0;

  const saveWall = () => {
    man.wallSeconds = wall();
    fs.writeFileSync(manifestFile(dir), JSON.stringify(man, null, 2));
  };
  const flush = (reason) => {
    for (const f of inFlight.values()) {
      append({ type: 'abandoned', run: f.run, id: f.id, usd: Math.max(0, f.meter.totalUsd()), at: new Date().toISOString(), reason });
    }
    inFlight.clear();
    saveWall();
    const o = finalizeRun(dir, { partial: true, stopReason: reason, wallSeconds: wall(), root, engineStatus });
    return o;
  };
  hooks.flush = flush;

  if (man.caseIds.length) {
    log(`run dir: ${dir} · ${done.size ? `resuming, ${done.size} case(s) already done, ` : ''}cap ${Number.isFinite(cap) ? usd(cap) : 'none'} · spent so far ${usd(priorSpend)} · concurrency ${args.concurrency}`);
  }

  const queue = [];
  for (let k = 1; k <= args.repeat; k++) for (const c of calls) if (!done.has(`${k}:${c.id}`)) queue.push({ run: k, c });
  let stopReason = null;
  let aborted = null;

  async function runOne({ run: k, c }) {
    const meter = createMeter(fetch);
    const key = `${k}:${c.id}`;
    inFlight.set(key, { run: k, id: c.id, meter });
    const r = await runCase(c, { judge: makeJudge(meter.fetch), meter, opening: openingLine });
    const caseUsd = meter.totalUsd();
    inFlight.delete(key);
    if (args.backend === 'spark' && firstOfRun && r.turns.every(isFallbackTurn)) {
      aborted ||= [...new Set(r.turns.flatMap((t) => t.usage.judge.errors))];
      return;
    }
    firstOfRun = false;
    append({ type: 'case', run: k, id: c.id, usd: caseUsd, at: new Date().toISOString(), result: r });
    recordedUsd += caseUsd;
    doneWithSpend += 1;
    log(`${r.ok ? 'OK ' : r.safe ? 'ok~' : 'XX '} ${r.id.padEnd(32)} exp=${r.class.padEnd(6)} got=${r.final.padEnd(6)} ${String(r.finalConfidence).padEnd(5)} end=${r.endedBy.padEnd(12)} ${usd(priorSpend + recordedUsd + liveUsd())} | `
      + r.turns.map((t) => `${t.verdict[0]}${Math.round(t.confidence * 100)}/${t.path}/${t.latencyMs}ms`).join('  '));
  }

  // One cap-checked case; false when the queue must stop.
  async function step() {
    if (!queue.length || stopReason || aborted) return false;
    if (stop.requested) { stopReason = 'interrupted'; return false; }
    const next = queue[0];
    const spent = priorSpend + recordedUsd + liveUsd();
    const check = capWouldCross({
      spentUsd: spent, doneCases: doneWithSpend, capUsd: cap,
      firstCaseEstimateUsd: estById.get(next.c.id)?.expectedUsd ?? 0,
    });
    // Every in-flight case will still spend about one average case.
    if (check.stop || spent + check.projectedUsd * (inFlight.size + 1) > cap) {
      stopReason = 'max-usd';
      log(`CAP: spent ${usd(spent)} (+${inFlight.size} in flight), next case projected ${usd(check.projectedUsd)} would cross ${usd(cap)} — stopping before ${next.c.id}.`);
      return false;
    }
    queue.shift();
    await runOne(next);
    return true;
  }
  const worker = async () => { while (await step()); };
  // The first case runs alone: it must prove the key and billing first.
  if (firstOfRun) await step();
  if (!aborted) await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  if (aborted) {
    err(`ABORT: first call never reached Spark (${aborted.join(', ') || 'fallback only'}). `
      + 'Not writing results: a run of fallbacks is not a model measurement. Fix the key/billing and re-run.');
    if (fresh && !fs.existsSync(casesFile(dir))) fs.rmSync(dir, { recursive: true, force: true });
    return { exitCode: 3 };
  }
  hooks.flush = null;
  saveWall();

  const finalCk = readCheckpoint(dir);
  const allTurns = finalCk.cases.flatMap((c) => c.result.turns);
  if (args.backend === 'spark' && allTurns.length && allTurns.every(isFallbackTurn)) {
    err('ABORT: every turn fell back (Spark never answered). Not writing results (cases.jsonl kept for diagnosis).');
    return { exitCode: 3, dir };
  }
  const out = finalizeRun(dir, { partial: stopReason ? true : null, stopReason, wallSeconds: wall(), root, engineStatus });
  if (!out) {
    err(`stopped before any case finished (${stopReason}); nothing to write.`);
    return { exitCode: stopReason ? 4 : 2, dir, stopReason };
  }
  log(`\n${out.headline}`);
  log(`spend this run: ${usd(out.spend.usd)} (฿${out.spend.thb.toFixed(2)}) · ${out.wallSeconds}s`);
  log('wrote', path.join(dir, 'results.json'), 'and summary.md');
  if (out.partial) log(`PARTIAL (${out.stopReason}): ${out.progress.completed}/${out.progress.total}. Resume: node scripts/eval.mjs --resume ${dir} --max-usd <cap>`);
  return { exitCode: out.partial ? 4 : 0, out, dir, stopReason };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const stop = { requested: false };
  const hooks = {};
  process.on('SIGINT', () => {
    if (hooks.flush) {
      const o = hooks.flush('interrupted');
      console.error(o
        ? `\nInterrupted: wrote PARTIAL ${o.progress.completed}/${o.progress.total} to results.json (resume with --resume).`
        : '\nInterrupted before any case finished; nothing to write.');
    }
    process.exit(130);
  });
  const r = await runEval({ argv: process.argv.slice(2), stop, hooks });
  process.exitCode = r.exitCode;
}

