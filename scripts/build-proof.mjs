// Build the /proof data from measured eval runs only.
// Reads the newest run per (set, backend) in eval-results/, recomputes the
// public metrics from the raw per-turn results, copies the raw files under
// app/public/proof/runs/ (after a secret scan) and writes
// app/public/proof/data.json. A (set, backend) with no valid run is written
// as {status:'pending', command} — never estimated.
// Usage: node scripts/build-proof.mjs   (or: cd app && npm run proof:build)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLASSES, PRICING, usdFor } from '../app/src/eval.js';
import { SYSTEM as SPARK_SYSTEM, VERDICT_EFFORT, VERDICT_MODEL } from '../app/src/spark.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SETS = ['train', 'sealed', 'sealed2', 'sealedIntl', 'sealedV4'];
export const BACKENDS = ['spark', 'jev'];
export const BACKEND_INFO = {
  spark: { role: 'meta', labelTh: 'Meta · Muse Spark', labelEn: 'Meta Muse Spark (few-shot)', needs: 'META_MODEL_API_KEY' },
  jev: { role: 'baseline', labelTh: 'Baseline · Jev', labelEn: 'Baseline = our pre-hackathon Google Cloud prototype (Jev + Gemini), frozen, not part of this entry', needs: 'TYPESAFE_API_KEY, GEMINI_API_KEY' },
};
export const SET_INFO = {
  train: { labelTh: 'ชุด train', labelEn: 'train / dev set', file: 'corpus/thai-tactics.jsonl' },
  sealed: { labelTh: 'ชุด sealed (held-out)', labelEn: 'sealed held-out set', file: 'corpus/sealed.jsonl' },
  sealed2: { labelTh: 'ชุด sealed v2 (held-out, ลงทะเบียน hash ไว้ก่อนจูน)', labelEn: 'sealed v2 held-out set (hash pre-registered before tuning)', file: 'eval/sealed-v2/sealed-v2.jsonl' },
  sealedIntl: { labelTh: 'ชุด sealed-intl (อังกฤษ จีน และอีก 7 ภาษา, ลงทะเบียน hash ไว้ก่อนจูน)', labelEn: 'sealed-intl held-out set (English, Mandarin and 7 probe languages; hash pre-registered before tuning)', file: 'eval/sealed-intl/sealed-intl.jsonl' },
  sealedV4: { labelTh: 'ชุด sealed v4 (Claude เขียน, 100 จาก 236 สายตามกติกาที่ลงทะเบียนไว้)', labelEn: 'sealed v4 held-out set (written by Claude; the pre-registered 100 of 236 calls)', file: 'eval/sealed-v4/sealed-v4.jsonl' },
};

// Sealed v2 (pre-registered at a1629c8, app/public/proof/sealed-v2-preregistration-2026-11-03.md).
// Spark only, one run per build; the set is spent after these runs, so a
// backend with no run here is 'na' (not pending: nothing will fill it).
export const SEALED_V2 = {
  file: 'eval/sealed-v2/sealed-v2.jsonl',
  datasetHash: '460019af829e5516',
  prereg: 'proof/sealed-v2-preregistration-2026-11-03.md',
  roles: {
    a1629c8: { th: 'baseline: prompt ก่อนจูนในสนาม', en: 'baseline: prompt before arena tuning' },
    f22b890: { th: 'production ก่อนหน้า', en: 'previous production' },
    '8d58388': { th: 'B28 = build ที่ส่งขึ้นจริง', en: 'B28 = the shipped build' },
  },
};
// Sealed-intl (pre-registered at 4be00fb/7886737,
// app/public/proof/sealed-intl-preregistration-2026-11-03.md). Spark only, run
// once on the final build B29 (c786af2) on Nov 4; the set is spent.
export const SEALED_INTL = {
  file: 'eval/sealed-intl/sealed-intl.jsonl',
  datasetHash: '66603339401e91af',
  prereg: 'proof/sealed-intl-preregistration-2026-11-03.md',
  roles: {
    c786af2: { th: 'B29 = build ที่ส่งขึ้นจริง (รันครั้งเดียว)', en: 'B29 = the shipped build (run once)' },
  },
  notes: {
    en: [
      'Run once on the final build B29 (c786af2), from a clean checkout of that commit, after the build was committed and declared final. Nothing was tuned after the result.',
      'The pre-registration named two runs (baseline 62d7c8b and the final build). Only the final build was run: the Meta credits left on Nov 4 covered one run. There is no baseline number on this set.',
      'B29 changes (after B28) were measured on train and in arena replays only, never on sealed v2: sealed v2 was already spent on B28.',
    ],
    th: [
      'รันครั้งเดียวบน build สุดท้าย B29 (c786af2) จาก checkout สะอาดของ commit นั้น หลัง commit และประกาศเป็น build สุดท้ายแล้ว ไม่มีการจูนหลังเห็นผล',
      'ใบลงทะเบียนระบุไว้สองรัน (baseline 62d7c8b และ build สุดท้าย) แต่รันแค่ build สุดท้าย เพราะเครดิต Meta ที่เหลือวันที่ 4 พ.ย. พอแค่รันเดียว ชุดนี้จึงไม่มีตัวเลข baseline',
      'การแก้ของ B29 (หลัง B28) วัดบนชุด train และ arena replay เท่านั้น ไม่ได้วัดบน sealed v2 เพราะ sealed v2 ใช้ไปกับ B28 แล้ว',
    ],
  },
};
// Sealed v4 (pre-registered at db36fc6, subset amendment 7675e71,
// app/public/proof/sealed-v4-preregistration-2026-11-04.md). Written by Claude
// (claude-opus-5-5); run once on B30 (13fcaae) on the pre-registered subset:
// the first 100 ids by sha256("v4-subset:"+id). 136 calls stay sealed.
export const SEALED_V4 = {
  file: 'eval/sealed-v4/sealed-v4.jsonl',
  datasetHash: 'd08d264c976ae865',
  subset: 'hash-subset v4-subset:100 (pre-registered)',
  prereg: 'proof/sealed-v4-preregistration-2026-11-04.md',
  roles: {
    '13fcaae': { th: 'B30 = build ที่ส่งขึ้นจริง (รันครั้งเดียว)', en: 'B30 = the shipped build (run once)' },
  },
  notes: {
    en: [
      'Written by Claude (claude-opus-5-5, Anthropic, Batch API, Nov 4) from one brief per call; the label comes from the brief. The judge is Meta (Muse Spark, with Muse Wonder for the grey zone), a different model family. The calls are synthetic and aimed at hard cases: adversarial callers, ASR noise, dialects, code-switching, slow burns and legit look-alikes.',
      'Run once on the shipped build B30 (13fcaae), from a clean checkout, after B30 was committed and declared final. Nothing was tuned after the result.',
      'Only 100 of the 236 calls were run: the first 100 ids by sha256("v4-subset:" + id). That rule was committed before any run or tuning, because the Meta credits left could not pay for all 236. The other 136 calls stay sealed and unread for after the hackathon.',
      'Most missed scams end UNSURE: the receptionist takes a message and does not put the caller through, but it does not hang up either. 4 scams ended LEGIT, the worst error.',
      'Earlier numbers belong to earlier builds: sealed-intl to B29 (c786af2), sealed v2 to B28 (8d58388). B30 was not measured on them.',
    ],
    th: [
      'Claude (claude-opus-5-5 ของ Anthropic ผ่าน Batch API วันที่ 4 พ.ย.) เขียนสายจากโจทย์ทีละสาย เฉลยมาจากโจทย์ ตัวตัดสินคือ Meta (Muse Spark และ Muse Wonder ในโซนกำกวม) คนละตระกูลโมเดลกัน เป็นข้อมูลสังเคราะห์ที่เน้นกรณียาก: ผู้โทรที่พยายามหลอกระบบ เสียงถอดความเพี้ยน ภาษาถิ่น สลับภาษา หลอกช้า และสายจริงที่หน้าตาเหมือนมิจฉาชีพ',
      'รันครั้งเดียวบน build ที่ส่งขึ้นจริง B30 (13fcaae) จาก checkout สะอาด หลัง commit และประกาศเป็น build สุดท้ายแล้ว ไม่มีการจูนหลังเห็นผล',
      'รันแค่ 100 จาก 236 สาย: 100 id แรกเมื่อเรียงตาม sha256("v4-subset:" + id) กติกานี้ commit ไว้ก่อนรันและก่อนจูนใดๆ เพราะเครดิต Meta ที่เหลือจ่ายทั้ง 236 สายไม่ไหว อีก 136 สายยังปิดผนึกและไม่มีใครเปิดอ่าน ไว้ใช้หลังจบการแข่งขัน',
      'สายมิจฉาชีพที่พลาดส่วนใหญ่จบที่ UNSURE: ระบบรับฝากข้อความโดยไม่ต่อสายให้เจ้าของ แต่ก็ไม่ได้วางสาย มี 4 สายที่จบเป็น LEGIT ซึ่งเป็นความผิดพลาดที่แย่ที่สุด',
      'ตัวเลขก่อนหน้าเป็นของ build ก่อนหน้า: sealed-intl ของ B29 (c786af2), sealed v2 ของ B28 (8d58388) B30 ไม่ได้วัดบนชุดเหล่านั้น',
    ],
  },
};
export const isSealedV4 = (o) => String(o.dataset?.file || '').includes('sealed-v4') || o.runConfig?.datasetHash === SEALED_V4.datasetHash;
export const isSealedIntl = (o) => String(o.dataset?.file || '').includes('sealed-intl') || o.runConfig?.datasetHash === SEALED_INTL.datasetHash;
// Train runs whose recorded commit is not the build they measured (run on the
// working tree just before the build commit; judge files identical).
export const TRAIN_NOTES = {
  'train-spark-b29-a': { en: 'B29 draft (bank fraud-team rule only, uncommitted working tree)', th: 'ร่าง B29 (กฎ "ฝ่ายทุจริตของธนาคาร" อย่างเดียว ยังไม่ commit)' },
  'train-spark-b29-final': { en: 'B29 judge (committed as c786af2 right after this run, judge files unchanged)', th: 'ตัวตัดสิน B29 (commit เป็น c786af2 ทันทีหลังรันนี้ ไฟล์ตัวตัดสินไม่เปลี่ยน)' },
};
export const isSealedV2 = (o) => String(o.dataset?.file || '').includes('sealed-v2') || o.runConfig?.datasetHash === SEALED_V2.datasetHash;

export const commandFor = (set, backend) => (set === 'sealedV4'
  ? `node scripts/eval.mjs --sealed-file ${SEALED_V4.file} --hash-subset v4-subset:100 --backend ${backend} --pipeline full --max-usd 1.8 --concurrency 4 && node scripts/build-proof.mjs`
  : set === 'sealedIntl'
  ? `node scripts/eval.mjs --sealed-file ${SEALED_INTL.file} --backend ${backend} --pipeline full --max-usd 5 --concurrency 4 && node scripts/build-proof.mjs`
  : set === 'sealed2'
  ? `node scripts/eval.mjs --sealed-file ${SEALED_V2.file} --backend ${backend} --pipeline full --max-usd 5 && node scripts/build-proof.mjs`
  : `cd app && npm run eval:${set}:${backend} && npm run proof:build`);

// A cell that will not be filled: sealed v2 was pre-registered for Spark only
// and is spent. Rendered as "not run on this set", never as pending.
export function naEntry(set, backend, reason) {
  return { status: 'na', set, backend, ...BACKEND_INFO[backend], reason };
}

export function pendingEntry(set, backend, reason = 'not-run') {
  return {
    status: 'pending',
    set,
    backend,
    ...BACKEND_INFO[backend],
    reason,
    command: commandFor(set, backend),
  };
}

export const backendOf = (o) => (o.backend === 'jev-baseline' || o.backend === 'jev' ? 'jev' : o.backend === 'spark' ? 'spark' : null);
export const setOf = (o) => (isSealedV4(o) ? 'sealedV4' : isSealedIntl(o) ? 'sealedIntl' : isSealedV2(o) ? 'sealed2' : o.dataset?.sealed ? 'sealed' : 'train');

// Nearest-rank percentile (same rule as app/src/eval.js).
export function percentile(xs, q) {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1))];
}
const rate = (k, n) => (n ? Math.round((k / n) * 1e4) / 1e4 : null);

// Results of run 1 (the reported run; repeats only feed stability).
export const resultsOf = (o) => o.runs?.[0]?.results || [];

// A spark run where Spark never answered is a measurement of the fallback,
// not of the model. eval.mjs refuses to write those; this is the second lock.
export function invalidReason(o) {
  if (backendOf(o) !== 'spark') return null;
  const turns = resultsOf(o).flatMap((r) => r.turns || []);
  if (!turns.length) return 'no-turns';
  if (turns.every((t) => t.path === 'spark-fallback')) return 'all-turns-fallback';
  return null;
}

export function summarizeRun(o, pricing = PRICING) {
  const results = resultsOf(o);
  const n = results.length;
  const turns = results.flatMap((r) => r.turns || []);
  const confusion = Object.fromEntries(CLASSES.map((e) => [e, Object.fromEntries(CLASSES.map((p) => [p, results.filter((r) => r.class === e && r.final === p).length]))]));
  const count = (cls) => results.filter((r) => r.class === cls).length;
  const correct = results.filter((r) => r.final === r.class);
  const unsafe = results.filter((r) => r.class === 'SCAM' && r.final === 'LEGIT');
  const falseAlarm = results.filter((r) => r.class === 'LEGIT' && r.final === 'SCAM');

  const lat = turns.map((t) => t.latencyMs);
  // Spark stage alone (what a live turn waits on before the code policy acts);
  // cache hits are excluded so a repeat line does not flatter the model.
  const sparkLat = turns.filter((t) => Number.isFinite(t.sparkLatencyMs) && t.path !== 'spark-cache').map((t) => t.sparkLatencyMs);
  const wonderTurns = turns.filter((t) => String(t.path).endsWith('>wonder'));
  const usdPerCall = results.map((r) => (r.turns || []).reduce((s, t) => s + usdFor(t.usage?.judge || { jev: { input: 0, output: 0 } }, pricing), 0));
  const meanUsd = n ? usdPerCall.reduce((s, x) => s + x, 0) / n : null;

  const ttc = correct.map((r) => r.turnsToCorrect).filter(Number.isFinite);
  const lags = correct.filter((r) => Number.isFinite(r.turnsToCorrect) && Number.isFinite(r.expertTurn)).map((r) => r.turnsToCorrect - r.expertTurn);
  const scamCorrect = correct.filter((r) => r.class === 'SCAM' && Number.isFinite(r.expertTurn));

  const models = [...new Set(turns.map((t) => t.model).filter(Boolean))];
  const paths = {};
  for (const t of turns) paths[t.path] = (paths[t.path] || 0) + 1;

  return {
    n,
    turns: turns.length,
    byClass: Object.fromEntries(CLASSES.map((c) => [c, count(c)])),
    accuracy: { k: correct.length, n, rate: rate(correct.length, n) },
    scamRecall: { k: confusion.SCAM.SCAM, n: count('SCAM'), rate: rate(confusion.SCAM.SCAM, count('SCAM')) },
    falseAlarm: { k: falseAlarm.length, n: count('LEGIT'), rate: rate(falseAlarm.length, count('LEGIT')), ids: falseAlarm.map((r) => r.id) },
    unsafeMiss: { k: unsafe.length, n: count('SCAM'), ids: unsafe.map((r) => r.id) },
    unsure: {
      final: { k: results.filter((r) => r.final === 'UNSURE').length, n, rate: rate(results.filter((r) => r.final === 'UNSURE').length, n) },
      legit: { k: confusion.LEGIT.UNSURE, n: count('LEGIT'), rate: rate(confusion.LEGIT.UNSURE, count('LEGIT')) },
      scam: { k: confusion.SCAM.UNSURE, n: count('SCAM'), rate: rate(confusion.SCAM.UNSURE, count('SCAM')) },
    },
    confusion,
    latencyMs: { p50: percentile(lat, 0.5), p95: percentile(lat, 0.95), turns: lat.filter(Number.isFinite).length },
    sparkLatencyMs: sparkLat.length ? { p50: percentile(sparkLat, 0.5), p95: percentile(sparkLat, 0.95), turns: sparkLat.length } : null,
    wonder: wonderTurns.length ? {
      turns: wonderTurns.length,
      share: rate(wonderTurns.length, turns.length),
      p50: percentile(wonderTurns.map((t) => t.latencyMs), 0.5),
      p95: percentile(wonderTurns.map((t) => t.latencyMs), 0.95),
    } : null,
    config: o.runConfig ? {
      model: o.runConfig.model, effort: o.runConfig.effort ?? null, pipeline: o.runConfig.pipeline ?? (backendOf(o) === 'spark' ? 'raw' : null),
      wonderModel: o.runConfig.wonderModel ?? null, fewshotHash: o.runConfig.fewshotHash ?? null,
    } : null,
    paths,
    turnsToVerdict: {
      correct: correct.length,
      medianTurnsToCorrect: percentile(ttc, 0.5),
      medianExpertTurn: percentile(results.map((r) => r.expertTurn), 0.5),
      medianLagVsExpert: percentile(lags, 0.5),
      atOrBeforeExpert: lags.filter((x) => x <= 0).length,
      scamAtOrBeforeExpert: { k: scamCorrect.filter((r) => r.turnsToCorrect <= r.expertTurn).length, n: count('SCAM') },
    },
    cost: {
      usdPerCall: meanUsd,
      usdPer1000: meanUsd == null ? null : meanUsd * 1000,
      thbPer1000: meanUsd == null ? null : meanUsd * 1000 * pricing.thbPerUsd,
      scope: o.costPerCall?.scope || 'Judge only. Excludes speech-to-text, TTS and telephony.',
      pricingCheckedAt: pricing.checkedAt,
    },
    models,
    engines: o.setup?.engines || null,
    fallbackTurns: turns.filter((t) => t.path === 'spark-fallback').length,
    serviceErrors: turns.flatMap((t) => t.usage?.judge?.errors || []).length,
  };
}

// ---- real audio through the live pipeline (teammate "realuse") ----
// Source: eval-results/realuse-*/results.json written by scripts/realuse*.mjs:
//   { generatedAt, runs: { <name>: { engine, condition, speculate, rerun, git,
//     verdictModel, verdictEffort, ranAt, totals:{...}, calls:[...] } }, v1Recorded }
// Only computed totals go public. A Meta run counts as the shipped build only
// when its verdict model + effort match app/src/spark.js; otherwise it is
// published as a superseded build, never as the current result.
// The verdict system prompt as committed at `commit` (null when unknown).
export function promptAtCommit(commit, root = ROOT) {
  if (!commit || !/^[0-9a-f]{7,40}$/i.test(String(commit))) return null;
  try {
    const src = execFileSync('git', ['show', `${commit}:app/src/spark.js`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = src.match(/export const SYSTEM = `([\s\S]*?)`;/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function realUseRows(o, shipped = { model: VERDICT_MODEL, effort: VERDICT_EFFORT, prompt: SPARK_SYSTEM }, promptAt = promptAtCommit) {
  return Object.entries(o?.runs || {}).map(([name, r]) => {
    const t = r.totals || {};
    const meta = r.engine === 'meta';
    // Current = same verdict model, effort AND system prompt as what ships.
    const current = meta
      ? r.verdictModel === shipped.model && r.verdictEffort === shipped.effort && promptAt(r.git) === shipped.prompt
      : null;
    return {
      name,
      engine: meta ? 'meta' : 'v1',
      condition: String(r.condition || ''),
      speculate: !!r.speculate,
      rerun: !!r.rerun,
      ranAt: r.ranAt || null,
      git: r.git ? String(r.git).slice(0, 7) : null,
      model: meta ? (r.verdictModel ? `${r.verdictModel}${r.verdictEffort ? ` ${r.verdictEffort}` : ''}` : null) : (r.model || null),
      current,
      calls: t.calls ?? (r.calls || []).length,
      correct: t.correct ?? null,
      scams: { k: t.scamsFlagged ?? null, n: t.scamCalls ?? null },
      protectedBeforeDemandEnds: t.scamsProtectedBeforeDemandEnds ?? null,
      wrongHangups: t.legitWrongHangups ?? null,
      cer: { th: t.cerTh ?? null, en: t.cerEn ?? null },
      eosToDecisionMs: { p50: t.eosToDecisionMs?.p50 ?? null, p95: t.eosToDecisionMs?.p95 ?? null },
      judgeMs: { p50: t.judgeMs?.p50 ?? null, p95: t.judgeMs?.p95 ?? null },
      receptionist: meta ? (r.receptionist ?? /-rx(-|$)/.test(name)) : null, // realuse marks G9 runs with an -rx suffix
      variant: meta ? ((name.match(/-rx-(.+)$/) || [])[1] || null) : null, // e.g. short, early-short
      longestSilenceMs: { p50: t.longestSilenceMs?.p50 ?? null, max: t.longestSilenceMs?.max ?? null },
      unansweredTurns: t.unansweredTurns ?? null,
      talkOverTurns: t.talkOverTurns ?? null,
      realReplyMs: t.realReplyMs ? { p50: t.realReplyMs.p50 ?? null, p95: t.realReplyMs.p95 ?? null } : null,
      redundant: t.questionsAsked == null ? null : { k: t.redundantQuestions ?? null, n: t.questionsAsked },
      t1: t.t1Hits == null ? null : { hits: t.t1Hits, sparkAgree: t.t1SparkAgree ?? null, onNonScam: t.t1OnNonScamCalls ?? null },
      usdPerCall: Number.isFinite(t.costUsd) && t.calls ? t.costUsd / t.calls : null,
    };
  });
}

export function listRealUse(evalDir) {
  if (!fs.existsSync(evalDir)) return [];
  const dirs = fs.readdirSync(evalDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('realuse') && fs.existsSync(path.join(evalDir, d.name, 'results.json')))
    .map((d) => d.name).sort();
  if (!dirs.length) return [];
  const mtime = (d) => fs.statSync(path.join(evalDir, d, 'results.json')).mtimeMs;
  const dir = dirs.sort((a, b) => mtime(a) - mtime(b))[dirs.length - 1]; // newest results.json
  let o;
  try { o = JSON.parse(fs.readFileSync(path.join(evalDir, dir, 'results.json'), 'utf8')); } catch { return []; }
  return realUseRows(o).map((r) => ({ dir, ...r }));
}

// ---- secret scan: raw files go public, so they must carry no credentials ----
const SECRET_PATTERNS = [
  ['bearer-token', /Bearer\s+[A-Za-z0-9._~+/-]{16,}/],
  ['google-api-key', /AIza[0-9A-Za-z_-]{30,}/],
  ['sk-key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['api-key-field', /"(?:api[_-]?key|apiKey|authorization|x-api-key|secret|token)"\s*:\s*"[^"]{8,}"/i],
  ['env-assignment', /\b(?:TYPESAFE_API_KEY|TYPESAFE_AI_KEY|GEMINI_API_KEY|META_MODEL_API_KEY|JEV_KEY)\s*[=:]\s*\S{8,}/],
];
export function findSecrets(text, env = process.env) {
  const hits = SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
  for (const k of ['TYPESAFE_API_KEY', 'TYPESAFE_AI_KEY', 'TYPESAFE_AI_MAC_KEY', 'JEV_KEY', 'GEMINI_API_KEY', 'META_MODEL_API_KEY']) {
    const v = env[k];
    if (v && v.length >= 8 && text.includes(v)) hits.push(`env:${k}`);
  }
  return hits;
}

// eval-results/ is gitignored; the committed record of a run is either the
// file itself or an identical curated copy under app/public/eval/.
function gitCommitFor(file, root = ROOT) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const addedIn = (f) => {
    try {
      return git('log', '--diff-filter=A', '--format=%H', '-1', '--', path.relative(root, f).split(path.sep).join('/')) || null;
    } catch {
      return null;
    }
  };
  const direct = addedIn(file);
  if (direct) return { commit: direct, source: 'first commit that added this results.json' };
  const curated = path.join(root, 'app', 'public', 'eval');
  if (fs.existsSync(curated)) {
    const bytes = fs.readFileSync(file);
    for (const f of fs.readdirSync(curated).filter((x) => x.endsWith('.json'))) {
      const p = path.join(curated, f);
      if (!bytes.equals(fs.readFileSync(p))) continue;
      const c = addedIn(p);
      if (c) return { commit: c, source: `commit that published the identical copy app/public/eval/${f}` };
    }
  }
  return { commit: null, source: 'not committed' };
}
function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function listRuns(evalDir) {
  if (!fs.existsSync(evalDir)) return [];
  return fs.readdirSync(evalDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(evalDir, d.name, 'results.json')))
    .map((d) => {
      const file = path.join(evalDir, d.name, 'results.json');
      return { dir: d.name, file, o: JSON.parse(fs.readFileSync(file, 'utf8')) };
    })
    .filter((r) => backendOf(r.o));
}

// A run stopped by the spend cap, Ctrl+C or a crash (eval.mjs partial:true,
// or fewer calls than planned) is a measurement of a subset only.
// A --cases/--limit subset (e.g. the 5-case smoke) counts the same way:
// progress is measured against the whole set, never against the subset.
export const progressOf = (o) => ({
  completed: o.progress?.completed ?? resultsOf(o).length,
  total: o.progress?.setTotal ?? o.progress?.total ?? o.dataset?.plannedCalls ?? o.dataset?.calls ?? resultsOf(o).length,
});
export function isPartial(o) {
  // The pre-registered sealed v4 subset is the whole planned run: complete
  // when every planned call was measured (progress vs the subset, not the set).
  if (isSealedV4(o) && o.dataset?.subset === SEALED_V4.subset && o.partial !== true) {
    return !(o.progress?.completed >= o.progress?.total);
  }
  if (o.partial === true || o.fullSet === false || o.dataset?.subset) return true;
  const { completed, total } = progressOf(o);
  return Number.isFinite(completed) && Number.isFinite(total) && completed < total;
}

// Newest valid COMPLETE run per (set, backend); a partial run is used only
// when no complete run exists, and is then published as status 'partial'
// (never 'done'). Invalid runs are reported, not used.
export function pickNewest(runs) {
  const best = {};
  const partial = {};
  const rejected = [];
  for (const r of runs) {
    const bad = invalidReason(r.o);
    if (bad) {
      rejected.push({ dir: r.dir, reason: bad });
      continue;
    }
    const key = `${setOf(r.o)}:${backendOf(r.o)}`;
    const into = isPartial(r.o) ? partial : best;
    if (!into[key] || String(r.o.ranAt) > String(into[key].o.ranAt)) into[key] = r;
  }
  for (const [key, r] of Object.entries(partial)) if (!best[key]) best[key] = r;
  return { best, rejected };
}

// Checkpointed runs that never wrote results.json (hard kill): not published,
// only listed with the command that finalizes them.
export function listUnfinalized(evalDir) {
  if (!fs.existsSync(evalDir)) return [];
  return fs.readdirSync(evalDir, { withFileTypes: true })
    .filter((d) => d.isDirectory()
      && fs.existsSync(path.join(evalDir, d.name, 'cases.jsonl'))
      && !fs.existsSync(path.join(evalDir, d.name, 'results.json')))
    .map((d) => ({ dir: d.name, command: `node scripts/eval.mjs --finalize eval-results/${d.name}` }));
}

// Partial: no headline numbers on the page (proof.js renders any non-'done'
// status as pending + reason); the subset metrics ride along under a name
// that cannot be mistaken for the full-set result.
export function partialEntry(set, backend, r) {
  const { completed, total } = progressOf(r.o);
  return {
    ...pendingEntry(set, backend, `partial: ${completed}/${total} calls measured (${r.o.stopReason || (r.o.dataset?.subset ? `subset ${r.o.dataset.subset}` : 'stopped early')}) — not the full-set result`),
    status: 'partial',
    progress: { completed, total },
    stopReason: r.o.stopReason || null,
    dir: r.dir,
    ranAt: r.o.ranAt,
    resumeCommand: `node scripts/eval.mjs --resume eval-results/${r.dir} --max-usd <cap>`,
    partialMetrics: summarizeRun(r.o),
  };
}

function trailOf(r) {
  return (r.turns || []).map((t) => ({
    turn: t.turn,
    verdict: t.verdict,
    confidence: t.confidence,
    path: t.path,
    latencyMs: t.latencyMs,
    action: t.action,
    reason: t.reasonEn || null,
    ai: t.ai || null,
  }));
}

export function caseRows(set, runsByBackend, corpusById = new Map()) {
  const ids = [];
  for (const b of BACKENDS) for (const r of resultsOf(runsByBackend[b]?.o || {})) if (!ids.includes(r.id)) ids.push(r.id);
  return ids.map((id) => {
    const any = BACKENDS.map((b) => resultsOf(runsByBackend[b]?.o || {}).find((r) => r.id === id)).find(Boolean);
    const c = corpusById.get(id);
    const verdicts = {};
    for (const b of BACKENDS) {
      const r = resultsOf(runsByBackend[b]?.o || {}).find((x) => x.id === id);
      verdicts[b] = r ? {
        final: r.final,
        ok: r.final === r.class,
        safe: !!r.safe,
        unsafeMiss: r.class === 'SCAM' && r.final === 'LEGIT',
        endedBy: r.endedBy,
        turnsPlayed: r.turnsPlayed,
        turnsToCorrect: r.turnsToCorrect,
        trail: trailOf(r),
      } : null;
    }
    return {
      id,
      set,
      class: any.class,
      alsoOk: any.alsoOk || [],
      lang: any.lang,
      category: any.category,
      tags: any.tags || [],
      expertTurn: any.expertTurn,
      why: c?.why || null,
      callerTurns: c?.turns || (any.turns || []).map((t) => t.caller),
      verdicts,
    };
  });
}

function loadCorpusMap(root) {
  const m = new Map();
  for (const f of ['corpus/thai-tactics.jsonl', 'corpus/sealed.jsonl', SEALED_V2.file, SEALED_INTL.file]) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = l.trim();
      if (t) { const c = JSON.parse(t); m.set(c.id, c); }
    }
  }
  return m;
}

export function buildProof({ root = ROOT, outDir = path.join(root, 'app', 'public', 'proof'), copyRaw = true, env = process.env } = {}) {
  const evalDir = path.join(root, 'eval-results');
  const { best, rejected } = pickNewest(listRuns(evalDir));
  // Raw files go public only after the secret scan.
  const publishRaw = (r) => {
    const dest = path.join(outDir, 'runs', r.dir);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of [r.file, path.join(path.dirname(r.file), 'summary.md')].filter((p) => fs.existsSync(p))) {
      const text = fs.readFileSync(f, 'utf8');
      const hits = findSecrets(text, env);
      if (hits.length) throw new Error(`refusing to publish ${path.relative(root, f)}: secret-like content (${hits.join(', ')})`);
      fs.writeFileSync(path.join(dest, path.basename(f)), text);
    }
  };
  const corpus = loadCorpusMap(root);
  const sets = {};
  const cases = {};
  for (const set of SETS) {
    const entries = {};
    for (const b of BACKENDS) {
      const r = best[`${set}:${b}`];
      if (!r && set === 'sealed2' && b !== 'spark') {
        entries[b] = naEntry(set, b, 'not part of the pre-registered sealed v2 run (Spark only); the set is now spent');
        continue;
      }
      if (!r && set === 'sealedV4' && b !== 'spark') {
        entries[b] = naEntry(set, b, 'not part of the pre-registered sealed v4 run (Spark only)');
        continue;
      }
      if (!r && set === 'sealedIntl' && b !== 'spark') {
        entries[b] = naEntry(set, b, 'not part of the pre-registered sealed-intl run (Spark only); the set is now spent');
        continue;
      }
      if (!r) {
        const why = rejected.find((x) => x.dir.startsWith(`${set}-${b}-`));
        entries[b] = pendingEntry(set, b, why ? why.reason : 'not-run');
        continue;
      }
      if (isPartial(r.o)) {
        entries[b] = partialEntry(set, b, r);
        continue;
      }
      const raw = `proof/runs/${r.dir}/results.json`;
      const summaryFile = path.join(path.dirname(r.file), 'summary.md');
      if (copyRaw) publishRaw(r);
      const found = r.o.git?.commit ? { commit: r.o.git.commit, source: 'recorded by eval.mjs at run time' } : gitCommitFor(r.file, root);
      entries[b] = {
        status: 'done',
        set,
        backend: b,
        ...BACKEND_INFO[b],
        dir: r.dir,
        ranAt: r.o.ranAt,
        wallSeconds: r.o.wallSeconds,
        dataset: r.o.dataset?.file,
        git: { ...found, dirty: r.o.git?.dirty ?? null },
        raw: { results: raw, summary: fs.existsSync(summaryFile) ? `proof/runs/${r.dir}/summary.md` : null },
        command: commandFor(set, b),
        metrics: summarizeRun(r.o),
      };
    }
    sets[set] = { ...SET_INFO[set], runs: entries };
    cases[set] = caseRows(set, Object.fromEntries(BACKENDS.map((b) => [b, best[`${set}:${b}`]])), corpus);
  }
  const done = (s) => BACKENDS.every((b) => sets[s].runs[b].status === 'done');
  // Every complete sealed Spark run, oldest first. The second one was
  // pre-registered (app/public/proof/sealed-rerun-2026-11-03.md); the newest
  // is the headline because it is the config that ships.
  const sealedRuns = listRuns(evalDir)
    .filter((r) => setOf(r.o) === 'sealed' && backendOf(r.o) === 'spark' && !invalidReason(r.o) && !isPartial(r.o))
    .sort((a, b) => String(a.o.ranAt).localeCompare(String(b.o.ranAt)))
    .map((r) => {
      const m = summarizeRun(r.o);
      return {
        dir: r.dir, ranAt: r.o.ranAt, partial: false, progress: progressOf(r.o),
        config: m.config, git: r.o.git?.commit?.slice(0, 7) || null,
        scamRecall: m.scamRecall, falseAlarm: m.falseAlarm, unsafeMiss: m.unsafeMiss.k, legitUnsure: m.unsure.legit,
        accuracy: m.accuracy, latencyMs: m.latencyMs, sparkLatencyMs: m.sparkLatencyMs, usdPerCall: m.cost.usdPerCall,
        wonder: m.wonder,
      };
    });
  // Sealed v2: every complete Spark run, oldest first, each published raw.
  // One run per build; the newest is the headline (the build that ships).
  const sealedV2Runs = listRuns(evalDir)
    .filter((r) => setOf(r.o) === 'sealed2' && backendOf(r.o) === 'spark' && !invalidReason(r.o) && !isPartial(r.o))
    .sort((a, b) => String(a.o.ranAt).localeCompare(String(b.o.ranAt)))
    .map((r) => {
      if (copyRaw) publishRaw(r);
      const m = summarizeRun(r.o);
      const git = r.o.git?.commit?.slice(0, 7) || null;
      return {
        dir: r.dir, ranAt: r.o.ranAt, partial: false, progress: progressOf(r.o),
        config: m.config, git, role: SEALED_V2.roles[git] || null,
        raw: `proof/runs/${r.dir}/results.json`,
        scamRecall: m.scamRecall, falseAlarm: m.falseAlarm, unsafeMiss: m.unsafeMiss.k, legitUnsure: m.unsure.legit,
        legitUnsureIds: (resultsOf(r.o)).filter((x) => x.class === 'LEGIT' && x.final === 'UNSURE').map((x) => x.id),
        accuracy: m.accuracy, latencyMs: m.latencyMs, sparkLatencyMs: m.sparkLatencyMs, usdPerCall: m.cost.usdPerCall,
        wonder: m.wonder,
      };
    });
  // Sealed-intl: the one complete Spark run (B29), published raw, with a
  // per-language breakdown (English, Mandarin and 7 probe languages).
  const langRuns = (setKey, roles) => listRuns(evalDir)
    .filter((r) => setOf(r.o) === setKey && backendOf(r.o) === 'spark' && !invalidReason(r.o) && !isPartial(r.o))
    .sort((a, b) => String(a.o.ranAt).localeCompare(String(b.o.ranAt)))
    .map((r) => {
      if (copyRaw) publishRaw(r);
      const m = summarizeRun(r.o);
      const git = r.o.git?.commit?.slice(0, 7) || null;
      const rs = resultsOf(r.o);
      const byLang = {};
      for (const x of rs) {
        const k = x.lang || '?';
        const e = byLang[k] || (byLang[k] = { n: 0, scam: 0, scamCaught: 0, scamAsLegit: 0, legit: 0, legitAsScam: 0, legitUnsure: 0, exact: 0 });
        e.n += 1;
        if (x.final === x.class) e.exact += 1;
        if (x.class === 'SCAM') { e.scam += 1; if (x.final === 'SCAM') e.scamCaught += 1; if (x.final === 'LEGIT') e.scamAsLegit += 1; }
        if (x.class === 'LEGIT') { e.legit += 1; if (x.final === 'SCAM') e.legitAsScam += 1; if (x.final === 'UNSURE') e.legitUnsure += 1; }
      }
      return {
        dir: r.dir, ranAt: r.o.ranAt, partial: false, progress: progressOf(r.o),
        config: m.config, git, dirty: r.o.git?.dirty ?? null, role: roles[git] || null,
        subset: r.o.dataset?.subset || null,
        unsafeMissIds: rs.filter((x) => x.class === 'SCAM' && x.final === 'LEGIT').map((x) => x.id),
        raw: `proof/runs/${r.dir}/results.json`,
        scamRecall: m.scamRecall, falseAlarm: m.falseAlarm, unsafeMiss: m.unsafeMiss.k, legitUnsure: m.unsure.legit,
        scamMissedIds: rs.filter((x) => x.class === 'SCAM' && x.final !== 'SCAM').map((x) => x.id),
        legitUnsureIds: rs.filter((x) => x.class === 'LEGIT' && x.final === 'UNSURE').map((x) => x.id),
        safe: { k: rs.filter((x) => x.safe).length, n: rs.length },
        byLang,
        accuracy: m.accuracy, latencyMs: m.latencyMs, sparkLatencyMs: m.sparkLatencyMs, usdPerCall: m.cost.usdPerCall,
        wonder: m.wonder,
      };
    });
  const sealedIntlRuns = langRuns('sealedIntl', SEALED_INTL.roles);
  const sealedV4Runs = langRuns('sealedV4', SEALED_V4.roles);
  // Every Spark train run, oldest first: the tuning trail behind the
  // published number (train only — sealed is run once and never tuned on).
  const history = listRuns(evalDir)
    .filter((r) => setOf(r.o) === 'train' && backendOf(r.o) === 'spark' && !invalidReason(r.o))
    .sort((a, b) => String(a.o.ranAt).localeCompare(String(b.o.ranAt)))
    .map((r) => {
      const m = summarizeRun(r.o);
      const { completed, total } = progressOf(r.o);
      return {
        dir: r.dir, ranAt: r.o.ranAt, partial: isPartial(r.o), progress: { completed, total },
        config: m.config, git: r.o.git?.commit?.slice(0, 7) || null,
        note: TRAIN_NOTES[r.dir] || null,
        scamRecall: m.scamRecall, falseAlarm: m.falseAlarm, unsafeMiss: m.unsafeMiss.k, legitUnsure: m.unsure.legit,
        accuracy: m.accuracy, latencyMs: m.latencyMs, sparkLatencyMs: m.sparkLatencyMs, usdPerCall: m.cost.usdPerCall,
      };
    });
  const data = {
    version: 1,
    generatedAt: new Date().toISOString(),
    builtFromCommit: headCommit(),
    // Sealed v2 (Spark only, pre-registered) is the headline once it has a
    // complete Spark run; then sealed v1 with both backends; else train.
    // Sealed-intl (run once on the shipped build B29) leads once it exists.
    // The page opens on the "All sealed sets" overview (proof.js builds it from
    // the *Runs lists); headlineSet is the newest set with a complete run.
    defaultSet: 'overview',
    headlineSet: sets.sealedV4.runs.spark.status === 'done' ? 'sealedV4'
      : sets.sealedIntl.runs.spark.status === 'done' ? 'sealedIntl'
      : sets.sealed2.runs.spark.status === 'done' ? 'sealed2' : done('sealed') ? 'sealed' : 'train',
    pricing: PRICING,
    definitions: {
      unsafeMiss: 'SCAM call judged LEGIT at the end of the call (the caller would be put through as safe).',
      falseAlarm: 'LEGIT call judged SCAM (a real caller would be hung up on).',
      accuracy: 'Final verdict equals the expert class exactly (SCAM / LEGIT / UNSURE).',
      latency: 'Judge time per caller turn, nearest-rank p50 / p95 over all judged turns (end to end: Spark, plus Wonder on grey-zone turns).',
      sparkLatency: 'Spark call alone per caller turn (cache hits excluded): what a live turn waits on before the code policy acts.',
      unsure: 'Final verdict UNSURE: the receptionist takes a message instead of deciding. Safe, but the owner has to judge.',
      cost: 'Mean measured judge cost per call from metered tokens x app/src/eval.js PRICING; x1000 for per 1,000 calls.',
      turnsToVerdict: 'Caller turns until the verdict became (and stayed) correct, vs the corpus expertTurn.',
    },
    trainHistory: history,
    sealedRuns,
    sealedV2Runs,
    sealedV4Runs,
    sealedV4Prereg: fs.existsSync(path.join(outDir, 'sealed-v4-preregistration-2026-11-04.md')) ? SEALED_V4.prereg : null,
    sealedV4Notes: SEALED_V4.notes,
    sealedIntlRuns,
    sealedIntlPrereg: fs.existsSync(path.join(outDir, 'sealed-intl-preregistration-2026-11-03.md')) ? SEALED_INTL.prereg : null,
    sealedIntlNotes: SEALED_INTL.notes,
    sealedV2Prereg: fs.existsSync(path.join(outDir, 'sealed-v2-preregistration-2026-11-03.md')) ? SEALED_V2.prereg : null,
    sealedRerunNote: fs.existsSync(path.join(outDir, 'sealed-rerun-2026-11-03.md')) ? 'proof/sealed-rerun-2026-11-03.md' : null,
    // Runs stopped before the end and replaced by a complete run of the same
    // (set, backend): named here so nothing measured is hidden.
    stoppedRuns: listRuns(evalDir)
      .filter((r) => isPartial(r.o) && !r.o.dataset?.subset && !invalidReason(r.o))
      .filter((r) => { const b = best[`${setOf(r.o)}:${backendOf(r.o)}`]; return b && !isPartial(b.o) && b.dir !== r.dir; })
      .map((r) => ({
        dir: r.dir, set: setOf(r.o), backend: backendOf(r.o), ranAt: r.o.ranAt,
        progress: progressOf(r.o), git: r.o.git?.commit?.slice(0, 7) || null,
        usd: r.o.spend?.usd ?? null, replacedBy: best[`${setOf(r.o)}:${backendOf(r.o)}`].dir,
      })),
    realUse: listRealUse(evalDir),
    rejectedRuns: rejected,
    unfinalizedRuns: listUnfinalized(evalDir),
    sets,
    cases,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'data.json'), `${JSON.stringify(data)}\n`);
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const data = buildProof();
  for (const set of SETS) {
    for (const b of BACKENDS) {
      const e = data.sets[set].runs[b];
      if (e.status === 'partial') {
        console.log(`${set.padEnd(6)} ${b.padEnd(5)} PARTIAL ${e.progress.completed}/${e.progress.total} (${e.stopReason}) -> resume: ${e.resumeCommand}`);
        continue;
      }
      if (e.status === 'na') {
        console.log(`${set.padEnd(6)} ${b.padEnd(5)} N/A (${e.reason})`);
        continue;
      }
      if (e.status !== 'done') {
        console.log(`${set.padEnd(6)} ${b.padEnd(5)} PENDING (${e.reason}) -> ${e.command}`);
        continue;
      }
      const m = e.metrics;
      console.log(`${set.padEnd(6)} ${b.padEnd(5)} n=${m.n} acc=${m.accuracy.rate} unsafeMiss=${m.unsafeMiss.k} scamRecall=${m.scamRecall.rate} falseAlarm=${m.falseAlarm.rate} `
        + `p50=${m.latencyMs.p50}ms p95=${m.latencyMs.p95}ms $/1000=${m.cost.usdPer1000?.toFixed(4)} commit=${e.git.commit?.slice(0, 7)} (${e.dir})`);
    }
  }
  if (data.rejectedRuns.length) console.log('rejected runs:', data.rejectedRuns);
  for (const u of data.unfinalizedRuns) console.log(`unfinalized run ${u.dir} -> ${u.command}`);
  console.log('wrote app/public/proof/data.json');
}
