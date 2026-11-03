#!/usr/bin/env node
// Receptionist voice (B20): pre-generate every FIXED spoken line with Gemini
// TTS into app/public/audio/*.mp3 + manifest.json, so the demo plays them
// instantly with zero run-time cost. Meta's API has no TTS; this is voice
// output only, every decision in a call stays a Meta model.
//
//   node scripts/tts-pregen.mjs                 # generate missing lines (TTS_VOICE)
//   node scripts/tts-pregen.mjs --force         # regenerate all
//   node scripts/tts-pregen.mjs --dry-run       # list lines + estimated cost
//   node scripts/tts-pregen.mjs --samples Kore,Erinome,Sulafat --out <dir>
//        # voice audition: 3 lines per voice, a phone-band (8 kHz mu-law)
//        # copy, and Meta ASR CER on that copy (needs META_MODEL_API_KEY)
//
// Keys come from the environment or --env <file> (GEMINI_API_KEY,
// META_MODEL_API_KEY); never printed. Needs ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RX_LINES } from '../app/src/receptionist.js';
import { CLOSING_LINE, DISCLOSURE_LINE_EN, DISCLOSURE_LINE_TH, STALL_LINES } from '../app/src/trap.js';
import { PACE_MAX_PAUSE_MS, PACE_TARGET_SYL_PER_SEC, TTS_MODEL, TTS_STYLE, TTS_VOICE, synthesize } from '../app/src/tts.js';
import { transcribeFile } from '../app/src/voice.js';
import { cer } from './realuse-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app', 'public', 'audio');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));

function loadEnv(file) {
  if (!file || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(args.env);
const GEMINI = process.env.GEMINI_API_KEY || '';
// Takes per line (best by Meta ASR). flash-tts allows 100 requests/day, shared with prod.
const TAKES = Math.max(1, Math.min(3, Number(args.takes) || 2));

// Every line the receptionist can say that code (not a model) wrote.
export function fixedLines() {
  const all = [DISCLOSURE_LINE_TH, DISCLOSURE_LINE_EN, ...Object.values(RX_LINES).flat(), ...STALL_LINES, CLOSING_LINE];
  // --add "<line>": a fixed line that lands in code right after its audio (keeps main green).
  if (args.add) all.push(...String(args.add).split('|'));
  return [...new Set(all.map((s) => s.trim()).filter(Boolean))];
}
// Gemini TTS has a low per-minute quota: back off on 429 instead of failing.
async function tts(text, voice) {
  for (let i = 0; ; i++) {
    try {
      return await synthesize({ apiKey: GEMINI, text, voice });
    } catch (e) {
      if (!/tts-http-429|tts-http-5|tts-timeout/.test(e.message) || i >= 8) throw e;
      const wait = 15000 * (i + 1);
      console.log(`  ${e.message}, retry in ${wait / 1000}s`);
      await new Promise((ok) => setTimeout(ok, wait));
    }
  }
}
// Name changes with the prompt + pace, so a browser/CDN never serves an old take.
const fileFor = (voice, text) => `${voice.toLowerCase()}-${crypto.createHash('sha256').update(JSON.stringify([TTS_STYLE, PACE_TARGET_SYL_PER_SEC, PACE_MAX_PAUSE_MS, text])).digest('hex').slice(0, 12)}.mp3`;

// ---- pace: trim, cap pauses, stretch to the target syllable rate ----
const RATE = 24000;
const MAXBUF = { maxBuffer: 64 << 20 };
const PCM_IN = ['-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0'];
const PCM_OUT = ['-f', 's16le', '-ar', String(RATE), '-ac', '1', 'pipe:1'];
const PAUSE = PACE_MAX_PAUSE_MS / 1000;
// Leading/trailing silence off; every inner pause longer than 250 ms cut to 250 ms.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,'
  + 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,'
  + `silenceremove=stop_periods=-1:stop_duration=${PAUSE}:stop_threshold=-45dB:stop_silence=${PAUSE}`;
const isThai = (t) => /[฀-๿]/.test(t);
export const TEMPO_RANGE = [1, 1.6]; // only ever faster; atempo above ~1.6 starts to smear Thai tones

export function syllables(texts) {
  const out = execFileSync('python', ['-X', 'utf8', path.join(ROOT, 'scripts', 'syllables.py')], { input: JSON.stringify(texts), ...MAXBUF });
  return JSON.parse(out.toString());
}
const secOf = (raw) => raw.length / 2 / RATE;
export function pace(wav, syl, text) {
  const trimmed = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-af', TRIM, ...PCM_OUT], { input: wav, ...MAXBUF });
  const target = isThai(text) ? PACE_TARGET_SYL_PER_SEC.th : PACE_TARGET_SYL_PER_SEC.en;
  const raw0 = syl / secOf(trimmed);
  const tempo = Math.round(Math.min(TEMPO_RANGE[1], Math.max(TEMPO_RANGE[0], target / raw0)) * 1000) / 1000;
  const raw = tempo > 1.005 ? execFileSync('ffmpeg', ['-v', 'error', ...PCM_IN, '-af', `atempo=${tempo}`, ...PCM_OUT], { input: trimmed, ...MAXBUF }) : trimmed;
  return { raw, syl, rawSylPerSec: Number(raw0.toFixed(2)), tempo, sec: Number(secOf(raw).toFixed(2)), sylPerSec: Number((syl / secOf(raw)).toFixed(2)) };
}
const rawToWav = (raw) => execFileSync('ffmpeg', ['-v', 'error', ...PCM_IN, '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { input: raw, ...MAXBUF });
function rawToMp3(raw, out) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...PCM_IN, '-c:a', 'libmp3lame', '-b:a', '48k', out], { input: raw });
}
function wavToMp3(wav, out) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'pipe:0', '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', out], { input: wav });
}
// What a phone line does: 8 kHz, 300-3400 Hz, G.711 mu-law; back to 16 kHz WAV.
function phoneWav(wav) {
  const mulaw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-af', 'highpass=f=300,lowpass=f=3400,aresample=8000', '-ac', '1', '-c:a', 'pcm_mulaw', '-f', 'wav', 'pipe:1'], { input: wav, ...MAXBUF });
  return execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-af', 'aresample=16000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { input: mulaw, ...MAXBUF });
}
async function asrCerOf(text, wav) {
  if (!process.env.META_MODEL_API_KEY || !isThai(text)) return null;
  const t = await transcribeFile({ apiKey: process.env.META_MODEL_API_KEY, wavBytes: phoneWav(wav) });
  return { transcript: t.transcript, ...cer(text, t.transcript) };
}

async function samples() {
  const voices = String(args.samples).split(',').map((s) => s.trim()).filter(Boolean);
  const out = path.resolve(args.out || path.join(ROOT, 'agent-temp', 'voice-samples'));
  fs.mkdirSync(out, { recursive: true });
  const lines = [DISCLOSURE_LINE_TH, RX_LINES.askCallback[0], RX_LINES.closeScam[0]];
  const syl = syllables(lines);
  const rows = [];
  let usd = 0;
  for (const voice of voices) {
    const raws = [];
    for (const [i, text] of lines.entries()) {
      const r = await tts(text, voice);
      usd += r.costUsd;
      const p = pace(Buffer.from(r.audio), syl[i], text);
      raws.push(p.raw);
      const asr = await asrCerOf(text, rawToWav(p.raw));
      const { raw, ...m } = p;
      rows.push({ voice, text, ...m, asr });
      console.log(voice, `${m.rawSylPerSec} -> ${m.sylPerSec} syl/s (x${m.tempo})`, asr ? `CER ${(asr.cer * 100).toFixed(1)}% · ${asr.transcript}` : '');
    }
    // One file per voice: the 3 lines with 0.6 s between them, full quality + phone band.
    const gap = Buffer.alloc(Math.round(0.6 * RATE) * 2);
    const joined = Buffer.concat(raws.flatMap((r) => [r, gap]));
    rawToMp3(joined, path.join(out, `${voice}.mp3`));
    wavToMp3(phoneWav(rawToWav(joined)), path.join(out, `${voice}-phone-8k.mp3`));
  }
  const byVoice = voices.map((voice) => {
    const r = rows.filter((x) => x.voice === voice);
    const a = r.filter((x) => x.asr);
    const e = a.reduce((n, x) => n + x.asr.edits, 0);
    const n = a.reduce((m, x) => m + x.asr.refLen, 0);
    const syls = r.reduce((k, x) => k + x.syl, 0);
    const secs = r.reduce((k, x) => k + x.sec, 0);
    return { voice, pooledCer: n ? e / n : null, sylPerSec: Number((syls / secs).toFixed(2)) };
  });
  fs.writeFileSync(path.join(out, 'samples.json'), JSON.stringify({ model: TTS_MODEL, style: TTS_STYLE, pace: { target: PACE_TARGET_SYL_PER_SEC, maxPauseMs: PACE_MAX_PAUSE_MS }, lines, rows, byVoice, geminiUsd: usd }, null, 2));
  console.log(JSON.stringify({ byVoice, geminiUsd: Number(usd.toFixed(5)), out }, null, 2));
}

async function pregen() {
  const voice = args.voice || TTS_VOICE;
  const lines = fixedLines();
  const syl = syllables(lines);
  fs.mkdirSync(OUT, { recursive: true });
  const manifestPath = path.join(OUT, 'manifest.json');
  const prev = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const same = prev && prev.voice === voice && prev.model === TTS_MODEL && prev.style === TTS_STYLE && !args.force;
  const keep = same ? prev.lines : {};
  const manifest = {
    model: TTS_MODEL, voice, style: TTS_STYLE,
    note: 'Voice output only: Gemini TTS, because the Meta Model API has no TTS. Every decision is a Meta model.',
    generated: new Date().toISOString(),
    pace: { targetSylPerSec: PACE_TARGET_SYL_PER_SEC, maxPauseMs: PACE_MAX_PAUSE_MS, how: 'trim silence, cap pauses, ffmpeg atempo (pitch kept); syllables by PyThaiNLP' },
    liveTempo: 1,
    lines: {},
    measured: {},
  };
  let usd = 0;
  for (const [i, text] of lines.entries()) {
    const file = fileFor(voice, text);
    if (keep[text] === file && fs.existsSync(path.join(OUT, file)) && prev.measured?.[text]) {
      manifest.lines[text] = file;
      manifest.measured[text] = prev.measured[text];
      continue;
    }
    if (args['dry-run']) { console.log('would generate', file, `${syl[i]} syl`, text); continue; }
    // TTS can stutter (a doubled syllable): check each Thai take with Meta
    // ASR on a phone-band copy of the FINAL (paced) audio; best of 3 takes.
    let best = null;
    for (let take = 0; take < TAKES; take++) {
      const r = await tts(text, voice);
      usd += r.costUsd;
      const p = pace(Buffer.from(r.audio), syl[i], text);
      const asr = await asrCerOf(text, rawToWav(p.raw));
      const score = asr ? asr.cer : 0;
      if (!best || score < best.score) best = { p, score };
      if (score <= 0.05) break;
      console.log(`  take ${take + 1} CER ${(score * 100).toFixed(1)}%, trying again`);
    }
    rawToMp3(best.p.raw, path.join(OUT, file));
    const { raw, ...m } = best.p;
    manifest.lines[text] = file;
    manifest.measured[text] = { ...m, cer: Number(best.score.toFixed(3)) };
    console.log('ok', file, `${m.rawSylPerSec} -> ${m.sylPerSec} syl/s x${m.tempo} CER ${(best.score * 100).toFixed(1)}%`, text);
  }
  if (args['dry-run']) return;
  // Live trap lines (same voice + prompt) get the median Thai stretch in the browser.
  const tempos = Object.entries(manifest.measured).filter(([t]) => isThai(t)).map(([, m]) => m.tempo).sort((a, b) => a - b);
  manifest.liveTempo = tempos.length ? tempos[Math.floor(tempos.length / 2)] : 1;
  const used = new Set(Object.values(manifest.lines));
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.mp3') && !used.has(f)) fs.rmSync(path.join(OUT, f));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ lines: lines.length, generatedUsd: Number(usd.toFixed(5)), voice, liveTempo: manifest.liveTempo }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!GEMINI && !args['dry-run']) { console.error('GEMINI_API_KEY missing (env or --env <file>)'); process.exit(2); }
  await (args.samples ? samples() : pregen());
}
