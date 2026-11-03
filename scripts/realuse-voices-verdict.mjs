#!/usr/bin/env node
// B21 part 2: does what Meta's ear mishears change the verdict?
// Re-judges every caller turn with Spark on (a) the script text and (b) the
// ASR transcript of each audio condition from scripts/realuse-voices.mjs,
// in call order (earlier caller turns stay in the conversation).
//
//   node scripts/realuse-voices-verdict.mjs --env <file> --asr <dir with asr.json> --conds phone,noisy --max-usd 1.2
//
// Output <asr dir>/verdicts.json: per turn the verdict on text vs on each
// condition, and per condition: agreement with the text verdict, scams
// caught (SCAM by the last caller turn) and legit calls wrongly called SCAM.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpark } from '../app/src/spark.js';
import { decideSpark } from '../app/src/policy.js';
import { createCache } from '../app/src/cache.js';
import { DISCLOSURE_LINE_TH } from '../app/src/trap.js';
import { RX_LINES_BY_LANG } from '../app/src/receptionist.js';
import fewshot from '../app/src/fewshot.json' with { type: 'json' };
import { createBudgetMeter } from './arena.mjs';
import { NEW_CLIPS } from './realuse-voices.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
if (args.env && fs.existsSync(args.env)) {
  for (const line of fs.readFileSync(args.env, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const DIR = path.resolve(args.asr || path.join(ROOT, 'eval-results', 'realuse-voices-edges-2026-11-03'));
const BIAS = args.bias || 'th';
const CONDS = String(args.conds || 'phone,noisy').split(',');
const DEMO = path.resolve(args.demo || path.join(ROOT, '..', 'hack-google', 'app', 'public'));
// Expected outcome of the new single-turn clips (what a careful human would say).
export const NEW_EXPECTED = {
  '01': 'SCAM', '02': 'SCAM', '03': 'LEGIT', '04': 'LEGIT', '05': 'SCAM',
  '06': 'SCAM', '07': 'SCAM', '08': 'UNSURE', '09': 'UNSURE', '10': 'LEGIT',
};

function calls() {
  const demo = JSON.parse(fs.readFileSync(path.join(DEMO, 'demo', 'scenarios.json'), 'utf8'));
  const out = [];
  for (const [key, lang, field] of [['scenarios', 'th', 'textTh'], ['scenariosEn', 'en', 'textEn']]) {
    for (const s of demo[key]) {
      out.push({ id: `${s.id}-${lang}`, lang, expected: s.expected, turns: s.turns.filter((t) => t.audio && t[field]).map((t) => ({ role: t.role, text: t[field], clip: path.basename(t.audio, '.mp3') })) });
    }
  }
  for (const [id, lang, , , text] of NEW_CLIPS) {
    const opener = lang === 'th' ? DISCLOSURE_LINE_TH : RX_LINES_BY_LANG[lang].disclosure[0];
    out.push({ id, lang, expected: NEW_EXPECTED[id.split('-')[1]], turns: [{ role: 'ai', text: opener }, { role: 'caller', text, clip: id }] });
  }
  return out;
}

async function main() {
  const asr = JSON.parse(fs.readFileSync(path.join(DIR, 'asr.json'), 'utf8'));
  const meter = createBudgetMeter({ capUsd: Number(args['max-usd']) || 1.2 });
  const cache = createCache({ max: 5000 });
  const spark = createSpark({ fetch: meter.fetchFor('spark'), apiKey: process.env.META_MODEL_API_KEY, cache, fewshots: fewshot.cases || [], categories: fewshot.categories || [] });
  const rows = [];
  let stopped = null;
  outer: for (const call of calls()) {
    for (const cond of ['text', ...CONDS]) {
      if (!meter.canSpend()) { stopped = 'budget'; break outer; }
      const convo = [];
      const trail = [];
      for (const t of call.turns) {
        let text = t.text;
        if (t.role === 'caller' && cond !== 'text') {
          const hit = asr[`${t.clip}|${cond}|${BIAS}`];
          if (!hit) throw new Error(`no ASR for ${t.clip}|${cond}|${BIAS} in ${DIR}`);
          text = hit.transcript;
        }
        convo.push({ role: t.role === 'ai' ? 'ai' : 'caller', text });
        if (t.role !== 'caller') continue;
        const j = await spark.judgeTurn({ turns: convo, lang: call.lang });
        const p = decideSpark(j);
        trail.push({ clip: t.clip, verdict: p.verdict, confidence: Number((p.confidence ?? j.confidence).toFixed(2)), engine: j.engine, error: j.error || null });
      }
      rows.push({ call: call.id, lang: call.lang, expected: call.expected, cond, trail, final: trail.at(-1)?.verdict, anyScam: trail.some((x) => x.verdict === 'SCAM') });
      console.log(call.id.padEnd(26), cond.padEnd(7), trail.map((x) => `${x.verdict}${x.engine === 'spark-fallback' ? '!' : ''}`).join(' > '), `· ${meter.m.spent.toFixed(3)} USD`);
    }
  }
  const byCond = {};
  for (const cond of ['text', ...CONDS]) {
    const rs = rows.filter((r) => r.cond === cond);
    const ref = Object.fromEntries(rows.filter((r) => r.cond === 'text').map((r) => [r.call, r]));
    const turns = rs.filter((r) => ref[r.call]).flatMap((r) => r.trail.map((x, i) => [x.verdict, ref[r.call].trail[i]?.verdict]));
    const scams = rs.filter((r) => r.expected === 'SCAM');
    const legit = rs.filter((r) => r.expected === 'LEGIT');
    byCond[cond] = {
      turnAgreementWithText: `${turns.filter(([a, b]) => a === b).length}/${turns.length}`,
      scamsCaught: `${scams.filter((r) => r.anyScam).length}/${scams.length}`,
      legitCalledScam: `${legit.filter((r) => r.anyScam).length}/${legit.length}`,
      fallbacks: rs.reduce((n, r) => n + r.trail.filter((x) => x.engine === 'spark-fallback').length, 0),
    };
  }
  fs.writeFileSync(path.join(DIR, 'verdicts.json'), JSON.stringify({ bias: BIAS, conds: CONDS, stopped, spentUsd: Number(meter.m.spent.toFixed(4)), byCond, rows }, null, 1));
  console.log(JSON.stringify({ stopped, spentUsd: Number(meter.m.spent.toFixed(4)), byCond }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
