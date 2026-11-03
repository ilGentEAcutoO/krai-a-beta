#!/usr/bin/env node
// Merge the real-use runs into results.json + README.md (B12).
//   node scripts/realuse-report.mjs [--dir eval-results/realuse-<date>]
// Inputs in --dir (any subset): meta-<cond>.json, meta-<cond>-spec.json,
// v1-<cond>.json. The v1 RECORDED numbers come from the v1 demo's
// scenarios.json (Oct 16 run, text in — no ASR, no timings).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cer, percentile, pooledCer } from './realuse-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dirArg = argv[argv.indexOf('--dir') + 1];
const DIR = path.resolve(ROOT, argv.includes('--dir') ? dirArg : `eval-results/realuse-${new Date().toISOString().slice(0, 10)}`);
const V1_PUBLIC = process.env.REALUSE_V1_DIR || path.resolve(ROOT, '..', 'hack-google', 'app', 'public');

const runs = {};
for (const f of fs.readdirSync(DIR).filter((x) => /^(meta|v1)-.*\.json$/.test(x))) {
  runs[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
}

const r1 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const sec = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1) + ' s');

function perCall(c) {
  if (c.fatal) return { id: `${c.id}-${c.lang}`, expected: c.expected, fatal: c.fatal };
  const o = c.outcome;
  return {
    id: `${c.id}-${c.lang}`,
    expected: c.expected,
    finalVerdict: o.finalVerdict,
    correct: o.correct,
    flagged: o.flagged,
    safeAction: o.safeAction,
    protectedBeforeDemandEnds: o.protectedBeforeDemandEnds,
    callEnded: o.ended || null,
    wrongHangup: o.wrongHangup,
    asr: c.asr.map((a) => ({ callerNo: a.callerNo, cer: r1(a.cer), finals: a.finals, ref: a.ref, hyp: a.hyp })),
    latency: c.latency,
    decisions: (c.decisions || []).map((d) => ({
      callerNo: d.callerNo, atMs: d.atMs, verdict: d.verdict, confidence: d.confidence, rule: d.rule, action: d.action,
      engine: d.engine, speculative: Boolean(d.speculative), ...(d.partial ? { partial: d.partial } : {}),
    })),
    speculativeCalls: (c.speculative || []).length,
    replies: (c.replies || []).filter((r) => r.reply).map((r) => ({
      callerNo: r.callerNo ?? r.afterCallerNo, reply: r.reply, source: r.source ?? null, guarded: r.guarded ?? null, guardReasons: r.guardReasons || [],
    })),
    errors: c.errors || [],
    costUsd: r1(c.costUsd),
  };
}

function totals(calls) {
  const ok = calls.filter((c) => !c.fatal);
  const scams = ok.filter((c) => c.expected === 'SCAM');
  // A turn the engine never heard because it had already closed the line
  // (v1 takes a message and hangs up) is not an ASR error: it is left out of
  // CER and counted as closedTurns instead.
  const heard = (c) => c.asr.filter((a) => {
    const eos = c.latency.find((l) => l.callerNo === a.callerNo)?.eosMs;
    return !(a.finals === 0 && c.outcome.ended && eos != null && c.outcome.ended.atMs < eos);
  });
  const asr = ok.flatMap((c) => heard(c).map((a) => ({ ...a, lang: c.lang })));
  const closedTurns = ok.reduce((n, c) => n + c.asr.length - heard(c).length, 0);
  const cerOf = (lang) => r1(pooledCer(ok.filter((c) => !lang || c.lang === lang).flatMap(heard)));
  const lat = ok.flatMap((c) => c.latency);
  const pick = (k) => lat.map((l) => l[k]).filter((x) => x != null);
  return {
    calls: calls.length,
    failedRuns: calls.length - ok.length,
    correct: ok.filter((c) => c.outcome.correct).length,
    scamCalls: scams.length,
    scamsFlagged: scams.filter((c) => c.outcome.flagged).length,
    scamsProtectedBeforeDemandEnds: scams.filter((c) => c.outcome.protectedBeforeDemandEnds).length,
    scamFirstBlockTurn: scams.map((c) => c.outcome.safeAction?.callerNo ?? null),
    scamFirstBlockMsAfterDemandEnds: scams.map((c) => c.outcome.safeAction?.msAfterDemandEnds ?? null),
    legitWrongHangups: ok.filter((c) => c.expected !== 'SCAM' && c.outcome.wrongHangup).length,
    cerAll: cerOf(null),
    cerTh: cerOf('th'),
    cerEn: cerOf('en'),
    splitTurns: asr.filter((a) => a.finals > 1).length,
    missedTurns: asr.filter((a) => a.finals === 0).length,
    closedTurns,
    eosToFinalMs: { p50: percentile(pick('eosToFirstFinalMs'), 50), p95: percentile(pick('eosToFirstFinalMs'), 95) },
    eosToDecisionMs: { p50: percentile(pick('eosToDecisionMs'), 50), p95: percentile(pick('eosToDecisionMs'), 95), n: pick('eosToDecisionMs').length },
    eosToFinalVerdictMs: { p50: percentile(pick('eosToFinalVerdictMs'), 50), p95: percentile(pick('eosToFinalVerdictMs'), 95) },
    judgeMs: { p50: percentile(pick('judgeMs'), 50), p95: percentile(pick('judgeMs'), 95) },
    replies: ok.reduce((n, c) => n + (c.replies || []).filter((r) => r.reply).length, 0),
    guardedReplies: ok.reduce((n, c) => n + (c.replies || []).filter((r) => r.reply && r.guarded).length, 0),
    costUsd: r1(ok.reduce((n, c) => n + (Number(c.costUsd) || 0), 0)),
  };
}

// v1 recorded (scenarios.json, Oct 16 2026): text in, Gemini/Jev verdicts.
function v1Recorded() {
  const s = JSON.parse(fs.readFileSync(path.join(V1_PUBLIC, 'demo', 'scenarios.json'), 'utf8'));
  const out = [];
  for (const [lang, list] of [['th', s.scenarios], ['en', s.scenariosEn]]) {
    for (const c of list) {
      const callers = c.turns.filter((t) => t.role === 'caller');
      const firstScam = callers.findIndex((t) => t.verdict?.verdict === 'SCAM');
      const blocked = firstScam >= 0;
      out.push({
        id: `${c.id}-${lang}`, expected: c.expected, finalVerdict: c.final?.verdict || null,
        verdicts: callers.map((t) => `${t.verdict?.verdict}/${t.verdict?.engine}`),
        firstBlockTurn: blocked ? firstScam + 1 : null,
        correct: c.expected === 'SCAM' ? blocked : !blocked && c.final?.verdict === c.expected,
        wrongHangup: c.expected !== 'SCAM' && blocked,
      });
    }
  }
  return { recordedAt: s.recordedAt, engine: s.engine, calls: out };
}

// Re-score ASR against the script in the call's own language (runs before
// 2026-11-03 06:50 scored English calls against the Thai translation).
const SCEN = JSON.parse(fs.readFileSync(path.join(V1_PUBLIC, 'demo', 'scenarios.json'), 'utf8'));
for (const run of Object.values(runs)) {
  for (const c of run.calls) {
    if (c.fatal) continue;
    const sc = (c.lang === 'en' ? SCEN.scenariosEn : SCEN.scenarios).find((x) => x.id === c.id);
    const refs = sc.turns.filter((t) => t.role === 'caller').map((t) => (c.lang === 'en' ? t.textEn : t.textTh));
    c.asr = c.asr.map((a) => ({ ...a, ref: refs[a.callerNo - 1], ...cer(refs[a.callerNo - 1], a.hyp) }));
  }
}

const result = { generatedAt: new Date().toISOString(), dir: path.relative(ROOT, DIR), runs: {}, v1Recorded: v1Recorded() };
for (const [name, run] of Object.entries(runs)) {
  result.runs[name] = {
    engine: run.engine, model: run.model || null, git: run.git || null, verdictModel: run.verdictModel || null, verdictEffort: run.verdictEffort || null, disclosure: Boolean(run.disclosure), merge: Boolean(run.merge), condition: run.condition, speculate: Boolean(run.speculate), rerun: run.engine === 'v1' ? true : undefined,
    ranAt: run.ranAt, totals: totals(run.calls), calls: run.calls.map(perCall),
  };
}
fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(result, null, 2));

// ---- console table ----
const names = Object.keys(result.runs).sort();
const row = (label, f) => console.log(label.padEnd(34) + names.map((n) => String(f(result.runs[n].totals) ?? '—').padEnd(22)).join(''));
console.log(''.padEnd(34) + names.map((n) => n.padEnd(22)).join(''));
row('correct / calls', (t) => `${t.correct}/${t.calls}`);
row('scams flagged', (t) => `${t.scamsFlagged}/${t.scamCalls}`);
row('scams stopped before demand ends', (t) => `${t.scamsProtectedBeforeDemandEnds}/${t.scamCalls}`);
row('first block turn', (t) => t.scamFirstBlockTurn.join(','));
row('legit/unsure wrong hang-ups', (t) => t.legitWrongHangups);
row('CER th / en', (t) => `${t.cerTh} / ${t.cerEn}`);
row('split / missed / closed turns', (t) => `${t.splitTurns} / ${t.missedTurns} / ${t.closedTurns}`);
row('EOS->final p50/p95', (t) => `${sec(t.eosToFinalMs.p50)}/${sec(t.eosToFinalMs.p95)}`);
row('EOS->decision p50/p95', (t) => `${sec(t.eosToDecisionMs.p50)}/${sec(t.eosToDecisionMs.p95)}`);
row('judge call p50/p95', (t) => `${sec(t.judgeMs.p50)}/${sec(t.judgeMs.p95)}`);
row('replies (guarded)', (t) => `${t.replies} (${t.guardedReplies})`);
row('cost USD', (t) => t.costUsd);
console.log('wrote', path.relative(ROOT, path.join(DIR, 'results.json')));
