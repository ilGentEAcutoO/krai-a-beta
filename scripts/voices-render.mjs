#!/usr/bin/env node
// B21: does Meta's ASR + the pipeline hold up across MANY caller voices?
// Takes arena caller turns (train split only; the arena holdout stays unseen),
// renders each turn with Gemini TTS in a diverse voice set (male + female,
// 10 voices, varied pace and emotion; Thai, English and code-switch), and
// writes a scenario folder in the shape scripts/realuse.mjs already streams:
//
//   node scripts/voices-render.mjs --env <.env> --out eval-results/voices-<date> [--max 24]
//   REALUSE_V1_DIR=eval-results/voices-<date> node scripts/realuse.mjs \
//        --base http://127.0.0.1:8787 --condition phone --out eval-results/voices-<date>
//
// realuse.mjs then band-limits to a phone line (8 kHz, 300-3400 Hz, mu-law,
// line noise) and streams in real time through /api/voice/live
// (muse-voice-transcribe-1.0) + T1 + Spark + receptionist, like /demo-live.
// Caller voices are synthetic: this measures voice VARIETY, not real humans.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesize } from '../app/src/tts.js';

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
const OUT = path.resolve(ROOT, args.out || `eval-results/voices-${new Date().toISOString().slice(0, 10)}`);
const MAX = Number(args.max) || 24;
const MAX_TURNS = Number(args['max-turns']) || 4;
// flash-lite-tts by default: gemini-3.8-flash-tts is capped at 100 requests/day (Tier 1) and that
// quota belongs to the receptionist. Lite is also Gemini 3.8 TTS; its Thai was checked by Meta ASR.
const MODEL = args.model || 'gemini-3.8-flash-lite-tts';
const ARENA = (args.arena || 'eval-results/arena-2026-11-03,eval-results/arena-2026-11-03-pilot,eval-results/arena-2026-11-03-pilot2').split(',');

// Gender from GET /v1beta/voices (2026-11-03). The receptionist's own voice
// (Sulafat) is never used for a caller.
export const VOICES = {
  f: ['Kore', 'Leda', 'Aoede', 'Achernar', 'Gacrux'],
  m: ['Charon', 'Fenrir', 'Algenib', 'Puck', 'Iapetus'],
};
// Arena mood -> delivery. Pace and emotion vary with the persona.
export const STYLE = {
  calm: 'calm and steady, normal pace',
  pushy: 'pushy and insistent, speaking quickly',
  impatient: 'impatient and irritated, speaking rapidly',
  chatty: 'chatty and casual, relaxed pace',
  formal: 'formal and official, measured pace',
  nervous: 'nervous and hesitant, uneven pace',
  'soft-spoken': 'soft-spoken and quiet, slow pace',
  friendly: 'warm and friendly, normal pace',
  confident: 'confident and authoritative, firm',
  rushed: 'rushed and breathless, speaking very rapidly',
};

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const expectedOf = (cls) => ({ scam: 'SCAM', legit: 'LEGIT', unsure: 'UNSURE' }[cls] || 'UNSURE');

export function loadArena(dirs = ARENA) {
  const seen = new Set();
  const out = [];
  for (const d of dirs) {
    const f = path.resolve(ROOT, d, 'calls.jsonl');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      const callerTurns = (r.turns || []).map((t) => String(t.caller || '').trim()).filter(Boolean);
      if (r.split !== 'train' || !callerTurns.length || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ ...r, callerTurns });
    }
  }
  return out;
}

// Diverse, deterministic pick: every English / code-switch call first, then
// Thai calls round-robin over class, and one call per persona where possible.
export function pick(calls, max = MAX) {
  const order = (c) => hash(`voices-v1:${c.id}`);
  const sorted = [...calls].sort((a, b) => order(a).localeCompare(order(b)));
  const chosen = [];
  const personas = new Set();
  const take = (c) => { if (chosen.length < max && !chosen.includes(c)) { chosen.push(c); personas.add(c.persona); } };
  for (const c of sorted) if (c.lang !== 'th' && !personas.has(c.persona)) take(c);
  for (const cls of ['legit', 'scam', 'legit', 'scam']) {
    for (const c of sorted) if (c.cls === cls && !personas.has(c.persona)) { take(c); break; }
  }
  let i = 0;
  while (chosen.length < max && i < 10 * sorted.length) {
    const want = i % 3 === 0 ? 'legit' : 'scam';
    const c = sorted.find((x) => x.cls === want && !personas.has(x.persona)) || sorted.find((x) => !chosen.includes(x));
    if (!c) break;
    take(c);
    i++;
  }
  return chosen;
}

async function tts(text, voice, style) {
  for (let i = 0; ; i++) {
    try {
      return await synthesize({ apiKey: process.env.GEMINI_API_KEY, text, voice, style, model: MODEL, timeoutMs: 60000 });
    } catch (e) {
      if (!/429|http-5|timeout|network/.test(e.message) || i >= 10) throw e;
      await new Promise((ok) => setTimeout(ok, 15000 * Math.min(i + 1, 4)));
    }
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing (--env <file>)');
  const calls = pick(loadArena());
  const demo = path.join(OUT, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  const scen = { note: 'B21 voice-variety set: arena train callers rendered with Gemini TTS (synthetic voices).', scenarios: [], scenariosEn: [] };
  const counters = { f: 0, m: 0 };
  let usd = 0;
  let n = 0;
  for (const c of calls) {
    const g = c.gender === 'f' ? 'f' : 'm';
    const voice = VOICES[g][counters[g]++ % VOICES[g].length];
    const style = STYLE[c.mood] || STYLE.calm;
    const turns = [{ role: 'ai', ms: 7000 }];
    for (const [k, text] of c.callerTurns.slice(0, MAX_TURNS).entries()) {
      const file = `demo/${c.id}-t${k + 1}-${MODEL.includes('lite') ? 'lite' : 'flash'}.wav`;
      const abs = path.join(OUT, file);
      if (!fs.existsSync(abs)) {
        const r = await tts(text, voice, style);
        usd += r.costUsd;
        fs.writeFileSync(abs, r.audio);
      }
      n++;
      turns.push({ role: 'caller', audio: file, text, textTh: text, textEn: text });
      turns.push({ role: 'ai', ms: 3500 });
      process.stdout.write('.');
    }
    const s = { id: c.id, expected: expectedOf(c.cls), model: MODEL, voice, gender: g, mood: c.mood, style, lang: c.lang, persona: c.persona, turns };
    (c.lang === 'en' ? scen.scenariosEn : scen.scenarios).push(s);
  }
  fs.writeFileSync(path.join(demo, 'scenarios.json'), JSON.stringify(scen, null, 2));
  const voices = [...new Set(calls.map((_, i) => i))].length;
  console.log(`\n${calls.length} calls, ${n} caller turns, Gemini ~$${usd.toFixed(4)} this run, ${voices} calls -> ${path.relative(ROOT, demo)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
