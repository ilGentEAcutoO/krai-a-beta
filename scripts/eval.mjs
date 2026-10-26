// Eval runner (machine-side): plays the corpus through a judge backend.
// Costs real money (well under $1 per baseline run): never part of `npm test`.
// Usage: TYPESAFE_API_KEY=... GEMINI_API_KEY=... node scripts/eval.mjs [--only id,id]
//          [--repeat N] [--out dir] [--resummarize] [--sealed] [--backend jev]
// --sealed runs corpus/sealed.jsonl (held-out: never for tuning, read the
// corpus README first). Backends: jev (frozen v2 baseline). spark lands in B5.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJudge, openingLine } from '../app/src/baseline/judge.js';
import { JEV_URL } from '../app/src/baseline/jev.js';
import {
  CLASSES, PRICING, addUsage, computeMetrics, diagnose, emptyUsage,
  headline, loadCorpus, mean, r4, ratio, runCase, summaryMd, usdFor,
} from '../app/src/eval.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function parseArgs(argv) {
  const a = { backend: 'jev', only: null, repeat: 1, resummarize: false, sealed: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--backend') a.backend = String(argv[++i] || 'jev');
    else if (k === '--only') a.only = new Set(String(argv[++i] || '').split(',').filter(Boolean));
    else if (k === '--repeat') a.repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (k === '--out') a.out = path.resolve(argv[++i]);
    else if (k === '--resummarize') a.resummarize = true;
    else if (k === '--sealed') a.sealed = true;
  }
  if (!a.out) a.out = path.join(ROOT, 'eval-results', `${a.sealed ? 'sealed' : 'train'}-${a.backend}-${stamp()}`);
  return a;
}

// ---- metering fetch: counts tokens per engine from the real responses ----
function createMeter() {
  const blank = () => ({ jev: { calls: 0, input: 0, output: 0 }, gemini: {}, errors: [] });
  let cur = blank();
  async function meteredFetch(url, init = {}) {
    const u = String(url);
    const engine = u.startsWith(JEV_URL) ? 'jev' : 'gemini';
    const counted = (init.method || 'GET') !== 'GET';
    let res;
    try {
      res = await globalThis.fetch(url, init);
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
      if (engine === 'jev') {
        cur.jev.calls += 1;
        cur.jev.input += Number(body?.usage?.input_tokens) || 0;
        cur.jev.output += Number(body?.usage?.output_tokens) || 0;
      } else {
        const model = (u.match(/models\/([^:/]+):/) || [])[1] || 'gemini';
        const g = (cur.gemini[model] ||= { calls: 0, input: 0, output: 0 });
        const m = body?.usageMetadata || {};
        g.calls += 1;
        g.input += Number(m.promptTokenCount) || 0;
        g.output += (Number(m.candidatesTokenCount) || 0) + (Number(m.thoughtsTokenCount) || 0);
      }
    } catch {
      // unreadable body: the judge records its own failure
    }
    return res;
  }
  return { fetch: meteredFetch, take() { const t = cur; cur = blank(); return t; } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.backend !== 'jev') {
    console.error(`backend '${args.backend}' is not implemented yet (jev now, spark in B5)`);
    process.exit(2);
  }
  if (args.resummarize) {
    const file = path.join(args.out, 'results.json');
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    o.headline = headline(o.metrics, o.costPerCall);
    fs.writeFileSync(file, JSON.stringify(o, null, 2));
    fs.writeFileSync(path.join(args.out, 'summary.md'), summaryMd(o));
    console.log(o.headline);
    return;
  }
  const datasetFile = path.join(ROOT, 'corpus', args.sealed ? 'sealed.jsonl' : 'thai-tactics.jsonl');
  if (args.sealed) {
    console.log('SEALED RUN: held-out set. Use for reporting only — never tune prompts, thresholds or few-shots against it.');
  }
  const all = loadCorpus(datasetFile);
  const calls = all.filter((c) => !args.only || args.only.has(c.id));
  if (!calls.length) {
    console.error('no calls selected');
    process.exit(2);
  }

  const config = {
    typesafeApiKey: process.env.TYPESAFE_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    jevModel: process.env.JEV_MODEL || 'jev-latest',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  };
  const meter = createMeter();
  const judge = createJudge({ fetch: meter.fetch, config });

  const engines = await judge.probeEngines();
  console.log(`engines: jev ${engines.jev} (${config.jevModel}) | gemini ${engines.gemini} (${config.geminiModel})`);
  if (!engines.jev) console.warn('WARNING: Jev is not reachable; numbers will reflect the fallback path.');

  const t0 = Date.now();
  const runs = [];
  for (let k = 0; k < args.repeat; k++) {
    const results = [];
    for (const c of calls) {
      const r = await runCase(c, { judge, meter, opening: openingLine });
      results.push(r);
      console.log(`${r.ok ? 'OK ' : r.safe ? 'ok~' : 'XX '} ${r.id.padEnd(32)} exp=${r.class.padEnd(6)} got=${r.final.padEnd(6)} ${String(r.finalConfidence).padEnd(5)} end=${r.endedBy.padEnd(12)} | `
        + r.turns.map((t) => `${t.verdict[0]}${Math.round(t.confidence * 100)}/${t.path}/${t.latencyMs}ms`).join('  '));
    }
    runs.push({ run: k + 1, metrics: computeMetrics(results), misses: results.filter((r) => !r.ok).map(diagnose), results });
  }

  const m = runs[0].metrics;
  const turnsPerCall = mean(runs[0].results.map((r) => r.turnsPlayed));
  const judgeUsd = m.cost.judgeUsdPerCall.mean;
  const perCall = {
    turnsPerCall: r4(turnsPerCall),
    judgeUsd,
    judgeThb: judgeUsd * PRICING.thbPerUsd,
    totalUsd: judgeUsd,
    totalThb: judgeUsd * PRICING.thbPerUsd,
    scope: 'Judge only (Jev + Gemini escalation). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.',
  };
  const spendUsd = runs.flatMap((r) => r.results).reduce((s, r) => s + r.usd.judge, 0);
  const jevResolved = runs[0].results.flatMap((r) => r.turns).find((t) => t.model)?.model || null;

  const stability = runs.length > 1 ? (() => {
    const ids = runs[0].results.map((r) => r.id);
    const same = ids.filter((id) => new Set(runs.map((run) => run.results.find((r) => r.id === id).final)).size === 1);
    return { runs: runs.length, sameFinalVerdict: ratio(same.length, ids.length), flipped: ids.filter((id) => !same.includes(id)) };
  })() : null;

  const out = {
    ranAt: new Date().toISOString(),
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    backend: 'jev-baseline',
    dataset: { file: `corpus/${args.sealed ? 'sealed.jsonl' : 'thai-tactics.jsonl'}`, sealed: args.sealed, calls: calls.length, byClass: m.byClass, byLang: m.byLang },
    setup: {
      judge: 'app/src/baseline/judge.js (frozen v2 contract) with a metering fetch',
      receptionistLines: 'canned (no AI)',
      engines: `Jev ${config.jevModel} (${jevResolved}) · Gemini ${config.geminiModel} (escalation)`,
    },
    pricing: PRICING,
    engineStatus: engines,
    headline: headline(m, perCall),
    metrics: m,
    costPerCall: perCall,
    stability,
    misses: runs[0].misses,
    spend: { usd: spendUsd, thb: spendUsd * PRICING.thbPerUsd, note: 'Everything this eval run called (all repeats).' },
    runs: runs.map((r) => ({ run: r.run, metrics: r.run === 1 ? undefined : r.metrics, results: r.results })),
  };
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, 'results.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(args.out, 'summary.md'), summaryMd(out));
  console.log(`\n${out.headline}`);
  console.log(`spend this run: $${spendUsd.toFixed(4)} (฿${(spendUsd * PRICING.thbPerUsd).toFixed(2)}) · ${out.wallSeconds}s`);
  console.log('wrote', path.join(args.out, 'results.json'), 'and summary.md');
}

await main();
