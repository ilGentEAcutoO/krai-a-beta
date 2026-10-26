// Eval harness library (new): plays corpus calls turn by turn through any
// judge backend, then scores accuracy / latency / cost. Metric shapes match
// the v2 eval so /proof can compare baseline vs Meta side by side.
import fs from 'node:fs';

// USD per 1M tokens. Jev/Gemini carried from the v2 eval; Spark from the
// Meta pricing page (read 2026-10-15, same figures the R1b probe ledger uses).
export const PRICING = {
  checkedAt: '2026-10-12',
  sources: {
    jev: 'https://docs.typesafe.ai/models.md ($42 per billion input tokens, output free)',
    gemini: 'https://ai.google.dev/gemini-api/docs/pricing (paid tier)',
    meta: 'https://dev.meta.ai/docs/pricing-rate-limits.md (Spark $1.25 in / $0.15 cached / $4.25 out)',
  },
  jev: { input: 0.042, output: 0 },
  gemini: {
    'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  },
  meta: {
    spark: { input: 1.25, cached: 0.15, output: 4.25 },
  },
  thbPerUsd: 35,
};

export const CLASSES = ['SCAM', 'LEGIT', 'UNSURE'];

export function loadCorpus(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      const c = JSON.parse(l);
      if (!c.id || !CLASSES.includes(c.class) || !Array.isArray(c.turns) || !c.turns.length) {
        throw new Error(`corpus ${file} line ${i + 1}: bad case (need id/class/turns)`);
      }
      return c;
    });
}

// 'rule' | 'jev' | 'jev>gemini' (Jev unsure, Gemini decided) | 'gemini-only'
// (Jev unavailable) | 'rules-fallback'. Spark paths (B5) extend this.
export const pathOf = (v) => (v.engine === 'gemini' ? (v.probabilities ? 'jev>gemini' : 'gemini-only') : v.engine);

export function usdFor(usage, pricing = PRICING) {
  let total = (usage.jev.input * pricing.jev.input + usage.jev.output * pricing.jev.output) / 1e6;
  for (const [model, g] of Object.entries(usage.gemini || {})) {
    const p = pricing.gemini[model] || Object.values(pricing.gemini)[0];
    total += (g.input * p.input + g.output * p.output) / 1e6;
  }
  for (const [model, g] of Object.entries(usage.meta || {})) {
    const p = pricing.meta[model] || pricing.meta.spark;
    total += ((g.input - (g.cached || 0)) * p.input + (g.cached || 0) * p.cached + g.output * p.output) / 1e6;
  }
  return total;
}

export const emptyUsage = () => ({ jev: { calls: 0, input: 0, output: 0 }, gemini: {}, meta: {}, errors: [] });

export function addUsage(a, b) {
  const out = {
    jev: { ...a.jev },
    gemini: JSON.parse(JSON.stringify(a.gemini || {})),
    meta: JSON.parse(JSON.stringify(a.meta || {})),
    errors: [...(a.errors || []), ...(b.errors || [])],
  };
  for (const k of ['calls', 'input', 'output']) out.jev[k] += b.jev[k] || 0;
  for (const [m, g] of Object.entries(b.gemini || {})) {
    const t = (out.gemini[m] ||= { calls: 0, input: 0, output: 0 });
    for (const k of ['calls', 'input', 'output']) t[k] += g[k] || 0;
  }
  for (const [m, g] of Object.entries(b.meta || {})) {
    const t = (out.meta[m] ||= { calls: 0, input: 0, cached: 0, output: 0 });
    for (const k of ['calls', 'input', 'cached', 'output']) t[k] += g[k] || 0;
  }
  return out;
}

// ---- one call, turn by turn ----
export async function runCase(c, { judge, meter, opening }) {
  const turns = [{ role: 'ai', text: opening(c.lang) }];
  const log = [];
  let endedBy = 'script-end';
  for (let i = 0; i < c.turns.length; i++) {
    turns.push({ role: 'caller', text: c.turns[i] });
    meter.take();
    const v = await judge.judgeTurn({ turns, lang: c.lang });
    const judgeUsage = meter.take();
    const action = judge.nextAction(v, i + 1, { maxTurns: 12 });
    const p = await judge.personaReply({ turns, verdict: v, lang: c.lang, action });
    turns.push({ role: 'ai', text: p.text });
    log.push({
      turn: i + 1,
      caller: c.turns[i],
      verdict: v.verdict,
      confidence: v.confidence,
      engine: v.engine,
      path: pathOf(v),
      model: v.model || null,
      latencyMs: v.latencyMs,
      probabilities: v.probabilities || null,
      signals: v.signals,
      reasonEn: v.reasonEn,
      reasonEngine: v.reasonEngine,
      action,
      ai: p.text,
      usage: { judge: judgeUsage },
      usd: { judge: usdFor(judgeUsage) },
    });
    if (action !== 'continue') {
      endedBy = action;
      break;
    }
  }
  const final = log[log.length - 1];
  const okSet = [c.class, ...(c.alsoOk || [])];
  let ttc = null;
  if (final.verdict === c.class) {
    ttc = log.length;
    for (let k = log.length - 1; k >= 0 && log[k].verdict === c.class; k--) ttc = k + 1;
  }
  return {
    id: c.id,
    class: c.class,
    alsoOk: c.alsoOk || [],
    lang: c.lang,
    category: c.category,
    tags: c.tags || [],
    expertTurn: c.expertTurn,
    scriptTurns: c.turns.length,
    final: final.verdict,
    finalConfidence: final.confidence,
    ok: final.verdict === c.class,
    safe: okSet.includes(final.verdict),
    endedBy,
    turnsPlayed: log.length,
    turnsToCorrect: ttc,
    lagVsExpert: ttc == null ? null : ttc - c.expertTurn,
    usd: { judge: log.reduce((s, t) => s + t.usd.judge, 0) },
    turns: log,
  };
}

// ---- stats ----
const sorted = (xs) => xs.filter(Number.isFinite).sort((a, b) => a - b);
function pct(xs, q) {
  const a = sorted(xs);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1))];
}
export const median = (xs) => pct(xs, 0.5);
export const mean = (xs) => { const a = sorted(xs); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
export const ratio = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : null);
export const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);

// Wilson 95% interval: an honest range for a rate measured on a small n.
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.round(Math.max(0, mid - half) * 1000) / 1000, Math.round(Math.min(1, mid + half) * 1000) / 1000];
}

export function computeMetrics(results) {
  const n = results.length;
  const by = (cls) => results.filter((r) => r.class === cls);
  const confusion = Object.fromEntries(CLASSES.map((e) => [e, Object.fromEntries(CLASSES.map((p) => [p, results.filter((r) => r.class === e && r.final === p).length]))]));
  const predictedScam = results.filter((r) => r.final === 'SCAM').length;
  const scam = by('SCAM');
  const legit = by('LEGIT');
  const unsure = by('UNSURE');
  const allTurns = results.flatMap((r) => r.turns);

  const latency = {};
  for (const t of allTurns) (latency[t.path] ||= []).push(t.latencyMs);
  const latencyByPath = Object.fromEntries(Object.entries(latency).map(([k, v]) => [k, { turns: v.length, share: ratio(v.length, allTurns.length), medianMs: median(v), p90Ms: pct(v, 0.9) }]));

  const tagged = {};
  for (const r of results) for (const tag of r.tags) (tagged[tag] ||= []).push(r);

  const judgeUsd = results.map((r) => r.usd.judge);
  const correctScam = scam.filter((r) => r.ok);
  return {
    calls: n,
    turns: allTurns.length,
    byClass: Object.fromEntries(CLASSES.map((c) => [c, by(c).length])),
    byLang: { th: results.filter((r) => r.lang === 'th').length, en: results.filter((r) => r.lang === 'en').length },
    confusion,
    accuracy: ratio(CLASSES.reduce((s, c) => s + confusion[c][c], 0), n),
    safeAccuracy: ratio(results.filter((r) => r.safe).length, n),
    scam: {
      recall: ratio(confusion.SCAM.SCAM, scam.length),
      recallCi95: wilson(confusion.SCAM.SCAM, scam.length),
      precision: ratio(confusion.SCAM.SCAM, predictedScam),
      precisionVsLegit: ratio(confusion.SCAM.SCAM, confusion.SCAM.SCAM + confusion.LEGIT.SCAM),
      missedAsLegit: scam.filter((r) => r.final === 'LEGIT').map((r) => r.id),
      missedAsUnsure: scam.filter((r) => r.final === 'UNSURE').map((r) => r.id),
      medianTurnsToCorrect: median(correctScam.map((r) => r.turnsToCorrect)),
      caughtByExpertTurn: ratio(correctScam.filter((r) => r.lagVsExpert <= 0).length, scam.length),
      medianLagVsExpert: median(correctScam.map((r) => r.lagVsExpert)),
      hungUp: ratio(scam.filter((r) => r.endedBy === 'hangup').length, scam.length),
    },
    legit: {
      falseScamAlarm: ratio(confusion.LEGIT.SCAM, legit.length),
      falseScamAlarmCi95: wilson(confusion.LEGIT.SCAM, legit.length),
      falseScamIds: legit.filter((r) => r.final === 'SCAM').map((r) => r.id),
      toUnsure: ratio(confusion.LEGIT.UNSURE, legit.length),
      toUnsureIds: legit.filter((r) => r.final === 'UNSURE').map((r) => r.id),
      medianTurnsToCorrect: median(legit.filter((r) => r.ok).map((r) => r.turnsToCorrect)),
    },
    unsure: {
      keptUnsure: ratio(confusion.UNSURE.UNSURE, unsure.length),
      toScam: unsure.filter((r) => r.final === 'SCAM').map((r) => r.id),
      toLegit: unsure.filter((r) => r.final === 'LEGIT').map((r) => r.id),
    },
    medianTurnsToCorrect: median(results.filter((r) => r.ok).map((r) => r.turnsToCorrect)),
    adversarial: Object.fromEntries(Object.entries(tagged).map(([tag, rs]) => [tag, { n: rs.length, correct: rs.filter((r) => r.ok).length, safe: rs.filter((r) => r.safe).length }])),
    latency: {
      judgeMedianMs: median(allTurns.map((t) => t.latencyMs)),
      judgeP90Ms: pct(allTurns.map((t) => t.latencyMs), 0.9),
      byPath: latencyByPath,
    },
    cost: {
      judgeUsdPerCall: { mean: mean(judgeUsd), median: median(judgeUsd), max: Math.max(...judgeUsd) },
      judgeThbPerCall: { mean: mean(judgeUsd) * PRICING.thbPerUsd, max: Math.max(...judgeUsd) * PRICING.thbPerUsd },
      judgeUsdTotal: judgeUsd.reduce((s, x) => s + x, 0),
      jevTokensPerTurn: median(allTurns.filter((t) => t.usage.judge.jev.calls).map((t) => t.usage.judge.jev.input)),
      geminiEscalations: allTurns.filter((t) => t.path === 'jev>gemini' || t.path === 'gemini-only').length,
    },
    escalation: (() => {
      const decided = allTurns.filter((t) => t.path === 'jev>gemini').length;
      const timeouts = allTurns.reduce((s, t) => s + t.usage.judge.errors.filter((e) => e === 'gemini-timeout').length, 0);
      return { attempts: decided + timeouts, decidedByGemini: decided, timeouts, timeoutRate: ratio(timeouts, decided + timeouts) };
    })(),
    serviceErrors: allTurns.flatMap((t) => [...t.usage.judge.errors]),
  };
}

// Mechanical "why" for a miss: the verdict trail and the evidence behind the last turn.
export function diagnose(r) {
  const last = r.turns[r.turns.length - 1];
  const strong = Object.entries(last.signals || {}).filter(([, v]) => v >= 0.5).map(([k, v]) => `${k}=${v}`);
  const p = last.probabilities;
  return {
    id: r.id,
    expected: r.class,
    got: r.final,
    safe: r.safe,
    endedBy: r.endedBy,
    trail: r.turns.map((t) => `${t.verdict}@${t.confidence}/${t.path}`).join(' > '),
    lastCallerTurn: last.caller,
    jevProbabilities: p,
    strongSignals: strong,
    reasonEn: last.reasonEn,
  };
}

const p100 = (x) => (x == null ? 'n/a' : `${Math.round(x * 1000) / 10}%`);
const sec = (ms) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)} s`);

export function headline(m, perCall) {
  const ci = m.scam.recallCi95 ? `, 95% CI ${p100(m.scam.recallCi95[0])}–${p100(m.scam.recallCi95[1])}` : '';
  return `SCAM recall ${p100(m.scam.recall)} (${m.confusion.SCAM.SCAM}/${m.byClass.SCAM} scam calls${ci}), ${m.confusion.LEGIT.SCAM} of ${m.byClass.LEGIT} legit calls flagged as scam, `
    + `median ${sec(m.latency.judgeMedianMs)} per turn (p90 ${sec(m.latency.judgeP90Ms)}), ~฿${perCall.totalThb.toFixed(2)} judge cost per call`;
}

export function summaryMd(o) {
  const m = o.metrics;
  const c = m.confusion;
  const lines = [];
  lines.push(`# Krai-a beta eval (${o.backend})`, '');
  lines.push(`Run ${o.ranAt} · ${o.dataset.file} · ${o.dataset.calls} calls / ${m.turns} judged turns · ${o.dataset.byLang.th} Thai, ${o.dataset.byLang.en} English`);
  lines.push(`Classes: SCAM ${m.byClass.SCAM} · LEGIT ${m.byClass.LEGIT} · UNSURE ${m.byClass.UNSURE} · engines: ${o.setup.engines}`, '');
  lines.push(`**Headline:** ${o.headline}`, '');
  lines.push('## Accuracy', '');
  lines.push('| metric | value |', '|---|---|');
  const ci = (r) => (r ? `${p100(r[0])}–${p100(r[1])}` : 'n/a');
  lines.push(`| SCAM recall | ${p100(m.scam.recall)} (${c.SCAM.SCAM}/${m.byClass.SCAM}; 95% CI ${ci(m.scam.recallCi95)}) |`);
  lines.push(`| SCAM precision (all calls) | ${p100(m.scam.precision)} |`);
  lines.push(`| SCAM precision vs legit only | ${p100(m.scam.precisionVsLegit)} |`);
  lines.push(`| scam missed as LEGIT (worst error) | ${m.scam.missedAsLegit.length} |`);
  lines.push(`| LEGIT false scam alarm | ${p100(m.legit.falseScamAlarm)} (${c.LEGIT.SCAM}/${m.byClass.LEGIT}; 95% CI ${ci(m.legit.falseScamAlarmCi95)}) |`);
  lines.push(`| LEGIT left UNSURE (message taken) | ${p100(m.legit.toUnsure)} |`);
  lines.push(`| UNSURE kept UNSURE | ${p100(m.unsure.keptUnsure)} · to SCAM ${m.unsure.toScam.length} · to LEGIT ${m.unsure.toLegit.length} |`);
  lines.push(`| accuracy (exact class) | ${p100(m.accuracy)} |`);
  lines.push(`| safe outcome (class or listed safe alternative) | ${p100(m.safeAccuracy)} |`);
  lines.push(`| median turns to correct verdict | all ${m.medianTurnsToCorrect} · SCAM ${m.scam.medianTurnsToCorrect} · LEGIT ${m.legit.medianTurnsToCorrect} |`);
  lines.push(`| SCAM caught by the expert's turn | ${p100(m.scam.caughtByExpertTurn)} (median lag ${m.scam.medianLagVsExpert} turns) |`);
  lines.push(`| scam calls hung up by policy | ${p100(m.scam.hungUp)} |`, '');
  lines.push('Confusion matrix (rows = expected, columns = final verdict):', '');
  lines.push('| | SCAM | LEGIT | UNSURE |', '|---|---|---|---|');
  for (const e of CLASSES) lines.push(`| **${e}** | ${c[e].SCAM} | ${c[e].LEGIT} | ${c[e].UNSURE} |`);
  lines.push('');
  lines.push('Adversarial subsets (correct / safe / n):', '');
  for (const [tag, v] of Object.entries(m.adversarial)) lines.push(`- ${tag}: ${v.correct} / ${v.safe} / ${v.n}`);
  lines.push('', '## Latency (judge, per caller turn)', '');
  lines.push(`All turns: median ${sec(m.latency.judgeMedianMs)}, p90 ${sec(m.latency.judgeP90Ms)}`, '');
  lines.push('| path | share of turns | median | p90 |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(m.latency.byPath)) lines.push(`| ${k} | ${p100(v.share)} (${v.turns}) | ${sec(v.medianMs)} | ${sec(v.p90Ms)} |`);
  lines.push('', 'rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable', '');
  lines.push('## Cost per call (judge only — receptionist lines are canned)', '');
  const pc = o.costPerCall;
  lines.push(`- Judge (Jev + Gemini escalation), measured: $${pc.judgeUsd.toFixed(6)} ≈ ฿${pc.judgeThb.toFixed(4)} per call (${pc.turnsPerCall} turns/call, Jev ${m.cost.jevTokensPerTurn} input tokens/turn, ${m.cost.geminiEscalations} Gemini escalations in ${m.turns} turns)`);
  lines.push(`- **Total judge cost ≈ $${pc.totalUsd.toFixed(5)} ≈ ฿${pc.totalThb.toFixed(3)} per call** (฿${(pc.totalThb * 1000).toFixed(0)} per 1,000 calls). ${pc.scope}`);
  lines.push(`- Prices (USD/1M tokens, checked ${o.pricing.checkedAt}): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿${o.pricing.thbPerUsd}`, '');
  if (o.stability) lines.push('## Stability', '', `${o.stability.runs} runs: same final verdict on ${p100(o.stability.sameFinalVerdict)} of calls; flipped: ${o.stability.flipped.join(', ') || 'none'}`, '');
  lines.push('## Misses (final verdict ≠ expected class)', '');
  if (!o.misses.length) lines.push('None.');
  for (const x of o.misses) {
    lines.push(`- **${x.id}** expected ${x.expected}, got ${x.got}${x.safe ? ' (listed as a safe alternative)' : ''}, ended by ${x.endedBy}`);
    lines.push(`  - trail: ${x.trail}`);
    lines.push(`  - last caller turn: "${x.lastCallerTurn}"`);
    lines.push(`  - Jev P: ${x.jevProbabilities ? Object.entries(x.jevProbabilities).map(([k, v]) => `${k} ${v}`).join(', ') : 'n/a'} · signals ≥0.5: ${x.strongSignals.join(', ') || 'none'} · reason: ${x.reasonEn}`);
  }
  lines.push('', `Service errors during run: ${m.serviceErrors.length ? m.serviceErrors.join(', ') : 'none'}`);
  lines.push(`Total spend of this eval run: $${o.spend.usd.toFixed(4)} ≈ ฿${o.spend.thb.toFixed(2)} (${o.wallSeconds}s wall time)`);
  return `${lines.join('\n')}\n`;
}
