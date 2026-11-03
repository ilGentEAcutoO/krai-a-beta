#!/usr/bin/env node
// B21 report: ASR + verdicts across the diverse voice set (voices-render.mjs
// + realuse.mjs), next to the earlier 10-call real-use run, and next to the
// SAME arena calls judged on their script text (so ASR's effect is isolated).
//
//   node scripts/voices-report.mjs --dir eval-results/voices-2026-11-03 \
//        [--run meta-phone-merge-rx-early.json] [--prior eval-results/realuse-2026-11-03-shipped/meta-phone-merge.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pooledCer } from './realuse-lib.mjs';
import { loadArena } from './voices-render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const DIR = path.resolve(ROOT, args.dir || 'eval-results/voices-2026-11-03');
const runFile = args.run ? path.join(DIR, args.run) : fs.readdirSync(DIR).filter((f) => /^meta-phone.*\.json$/.test(f)).map((f) => path.join(DIR, f))[0];
const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
const prior = JSON.parse(fs.readFileSync(path.resolve(ROOT, args.prior || 'eval-results/realuse-2026-11-03-shipped/meta-phone-merge.json'), 'utf8'));
const scen = JSON.parse(fs.readFileSync(path.join(DIR, 'demo', 'scenarios.json'), 'utf8'));
const meta = new Map([...scen.scenarios, ...scen.scenariosEn].map((s) => [s.id, s]));
const arena = new Map(loadArena().map((c) => [c.id, c]));

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const calls = run.calls.filter((c) => !c.fatal).map((c) => ({ ...c, m: meta.get(c.id) || {} }));
const fatal = run.calls.filter((c) => c.fatal);

// Text verdict: what Spark said in the arena on the script text, at the last
// caller turn we also played (or the arena's last turn if the call was shorter).
function textVerdict(id, nTurns) {
  const a = arena.get(id);
  if (!a) return null;
  const turns = (a.turns || []).slice(0, nTurns);
  const withV = turns.map((t) => t.rx?.spark?.verdict || t.rx?.verdict).filter(Boolean);
  return withV.at(-1) || null;
}

function group(key) {
  const m = new Map();
  for (const c of calls) {
    const k = key(c);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  return [...m].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}
const turnsOf = (cs) => cs.flatMap((c) => c.asr || []);
const heard = (cs) => turnsOf(cs).filter((t) => t.finals > 0);
function row(label, cs) {
  const t = turnsOf(cs);
  const h = heard(cs);
  const correct = cs.filter((c) => c.outcome?.correct).length;
  return `| ${label} | ${cs.length} | ${h.length}/${t.length} | ${pct(pooledCer(h))} | ${correct}/${cs.length} |`;
}
const table = (title, key) => [`| ${title} | calls | turns heard | CER (heard) | verdict correct |`, '|---|---|---|---|---|', ...group(key).map(([k, cs]) => row(k, cs))].join('\n');

const scams = calls.filter((c) => c.expected === 'SCAM');
const legit = calls.filter((c) => c.expected === 'LEGIT');
const flagged = scams.filter((c) => c.outcome?.finalVerdict === 'SCAM' || c.outcome?.flagged).length;
const wrongHang = legit.filter((c) => c.outcome?.wrongHangup).length;
const priorCalls = prior.calls.filter((c) => !c.fatal);
const priorHeard = priorCalls.flatMap((c) => c.asr || []).filter((t) => t.finals > 0);
const byLang = (cs, lang) => cs.filter((c) => (c.m?.lang || c.lang) === lang);

// Audio vs text verdict on the same call.
const vs = calls.map((c) => {
  const n = (c.m.turns || []).filter((t) => t.role === 'caller').length;
  return { id: c.id, expected: c.expected, audio: c.outcome?.finalVerdict || null, text: textVerdict(c.id, n) };
});
const agree = vs.filter((v) => v.text && v.audio === v.text).length;
const withText = vs.filter((v) => v.text).length;
const textCorrect = vs.filter((v) => v.text === v.expected).length;
const audioCorrect = vs.filter((v) => v.audio === v.expected).length;

const worst = heard(calls).map((t) => ({ ...t })).sort((a, b) => b.cer - a.cer).slice(0, 8);
const worstRows = worst.map((t) => {
  const c = calls.find((x) => (x.asr || []).some((a) => a.ref === t.ref && a.hyp === t.hyp));
  return `| ${c?.id} t${t.callerNo} | ${c?.m.voice} · ${c?.m.mood} · ${c?.m.lang} | ${pct(t.cer)} | ${t.ref.slice(0, 70)} | ${t.hyp.slice(0, 70)} |`;
});

const md = `# Caller-voice variety vs Meta ASR — ${run.ranAt?.slice(0, 10)} (B21)

**What:** ${calls.length} arena calls (train split only; arena holdout untouched), ${turnsOf(calls).length} caller turns,
rendered with **Gemini TTS in ${new Set(calls.map((c) => c.m.voice)).size} voices** (${[...new Set(calls.filter((c) => c.m.gender === 'f').map((c) => c.m.voice))].join(', ')} female;
${[...new Set(calls.filter((c) => c.m.gender === 'm').map((c) => c.m.voice))].join(', ')} male), delivery set from the arena persona's mood
(${[...new Set(calls.map((c) => c.m.mood))].join(', ')}), in Thai, English and Thai-English code-switch.
Every turn went through a **phone line** (8 kHz, 300-3400 Hz, mu-law, line noise) and was streamed in real
time through the shipped pipeline (\`scripts/realuse.mjs\` against \`wrangler dev\` of ${run.git}):
\`/api/voice/live\` → **muse-voice-transcribe-1.0** → T1 → **Spark** (${run.verdictModel}, ${run.verdictEffort}) → receptionist.
Caller voices are **synthetic**: this measures robustness to voice variety, not real human callers.
Model spend: Meta $${calls.reduce((n, c) => n + (c.costUsd || 0), 0).toFixed(3)} (pipeline meter); Gemini TTS for rendering < $0.25.
${fatal.length ? `\nCalls that failed to run: ${fatal.map((c) => `${c.id} (${c.fatal})`).join(', ')}.\n` : ''}
## Headline

| | this run (diverse voices) | earlier real-use run (${priorCalls.length} v1 demo calls, phone) |
|---|---|---|
| Pooled CER, heard turns | **${pct(pooledCer(heard(calls)))}** | ${pct(pooledCer(priorHeard))} |
| CER Thai | ${pct(pooledCer(heard(byLang(calls, 'th'))))} | ${pct(pooledCer(priorCalls.filter((c) => c.lang === 'th').flatMap((c) => c.asr || []).filter((t) => t.finals > 0)))} |
| CER English | ${pct(pooledCer(heard(byLang(calls, 'en'))))} | ${pct(pooledCer(priorCalls.filter((c) => c.lang === 'en').flatMap((c) => c.asr || []).filter((t) => t.finals > 0)))} |
| CER code-switch | ${pct(pooledCer(heard(byLang(calls, 'mixed'))))} | — |
| Turns heard (not lost to the line closing) | ${heard(calls).length}/${turnsOf(calls).length} | ${priorHeard.length}/${priorCalls.flatMap((c) => c.asr || []).length} |
| Final verdict correct | ${calls.filter((c) => c.outcome?.correct).length}/${calls.length} | ${priorCalls.filter((c) => c.outcome?.correct).length}/${priorCalls.length} |
| Scams flagged | ${flagged}/${scams.length} | ${priorCalls.filter((c) => c.expected === 'SCAM' && c.outcome?.flagged).length}/${priorCalls.filter((c) => c.expected === 'SCAM').length} |
| Wrong hang-ups on legit calls | ${wrongHang}/${legit.length} | ${priorCalls.filter((c) => c.expected === 'LEGIT' && c.outcome?.wrongHangup).length}/${priorCalls.filter((c) => c.expected === 'LEGIT').length} |

**Audio vs script text, same calls:** the verdict from audio matched Spark's verdict on the script text in
${agree}/${withText} calls. Correct on text ${textCorrect}/${vs.length}, correct from audio ${audioCorrect}/${vs.length}.

## By voice

${table('voice', (c) => `${c.m.voice} (${c.m.gender})`)}

## By gender, language, delivery

${table('gender', (c) => c.m.gender)}

${table('language', (c) => c.m.lang)}

${table('delivery (arena mood)', (c) => c.m.mood)}

## Per call

| call | expected | voice · mood · lang | CER per turn | audio verdict | text verdict |
|---|---|---|---|---|---|
${calls.map((c) => {
  const v = vs.find((x) => x.id === c.id);
  return `| ${c.id} | ${c.expected} | ${c.m.voice} · ${c.m.mood} · ${c.m.lang} | ${(c.asr || []).map((a) => (a.finals ? (a.cer * 100).toFixed(0) + '%' : 'unheard')).join(' / ')} | ${v.audio || '—'} | ${v.text || '—'} |`;
}).join('\n')}

## Worst turns

| turn | voice | CER | said | heard |
|---|---|---|---|---|
${worstRows.join('\n')}

Raw: \`${path.basename(runFile)}\` (events, finals, decisions per call), \`demo/scenarios.json\` (voice + style per call).
Rendered audio stays local (eval-results/ is gitignored).
`;
fs.writeFileSync(path.join(DIR, 'README.md'), md);
console.log(md.split('## By voice')[0]);
