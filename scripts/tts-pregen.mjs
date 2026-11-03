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
import { TTS_MODEL, TTS_STYLE, TTS_VOICE, synthesize } from '../app/src/tts.js';
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

// Every line the receptionist can say that code (not a model) wrote.
export function fixedLines() {
  const all = [DISCLOSURE_LINE_TH, DISCLOSURE_LINE_EN, ...Object.values(RX_LINES).flat(), ...STALL_LINES, CLOSING_LINE];
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
const fileFor = (voice, text) => `${voice.toLowerCase()}-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)}.mp3`;

function wavToMp3(wav, out) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'pipe:0', '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', out], { input: wav });
}
// What a phone line does: 8 kHz, 300-3400 Hz, G.711 mu-law, light noise; back to 16 kHz WAV.
function phoneWav(wav) {
  const mulaw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-af', 'highpass=f=300,lowpass=f=3400,aresample=8000', '-ac', '1', '-c:a', 'pcm_mulaw', '-f', 'wav', 'pipe:1'], { input: wav, maxBuffer: 64 << 20 });
  return execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-af', 'aresample=16000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { input: mulaw, maxBuffer: 64 << 20 });
}

async function samples() {
  const voices = String(args.samples).split(',').map((s) => s.trim()).filter(Boolean);
  const out = path.resolve(args.out || path.join(ROOT, 'agent-temp', 'voice-samples'));
  fs.mkdirSync(out, { recursive: true });
  const lines = [DISCLOSURE_LINE_TH, RX_LINES.askCallback[0], RX_LINES.closeScam[0]];
  const rows = [];
  let usd = 0;
  for (const voice of voices) {
    const wavs = [];
    for (const text of lines) {
      const r = await tts(text, voice);
      usd += r.costUsd;
      wavs.push(Buffer.from(r.audio));
      let asr = null;
      if (process.env.META_MODEL_API_KEY) {
        const t = await transcribeFile({ apiKey: process.env.META_MODEL_API_KEY, wavBytes: phoneWav(Buffer.from(r.audio)) });
        asr = { transcript: t.transcript, ...cer(text, t.transcript) };
      }
      rows.push({ voice, text, asr });
      console.log(voice, asr ? `CER ${(asr.cer * 100).toFixed(1)}% · ${asr.transcript}` : '');
    }
    // One file per voice: the 3 lines with a short gap, full quality + phone band.
    const list = wavs.map((w, i) => { const f = path.join(out, `.${voice}-${i}.wav`); fs.writeFileSync(f, w); return f; });
    const inputs = list.flatMap((f) => ['-i', f]);
    const filter = list.map((_, i) => `[${i}:a]apad=pad_dur=0.6[a${i}]`).join(';') + ';' + list.map((_, i) => `[a${i}]`).join('') + `concat=n=${list.length}:v=0:a=1[o]`;
    const joined = path.join(out, `.${voice}-all.wav`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[o]', joined]);
    wavToMp3(fs.readFileSync(joined), path.join(out, `${voice}.mp3`));
    wavToMp3(phoneWav(fs.readFileSync(joined)), path.join(out, `${voice}-phone-8k.mp3`));
    for (const f of [...list, joined]) fs.rmSync(f);
  }
  const byVoice = voices.map((voice) => {
    const r = rows.filter((x) => x.voice === voice && x.asr);
    const e = r.reduce((n, x) => n + x.asr.edits, 0);
    const n = r.reduce((m, x) => m + x.asr.refLen, 0);
    return { voice, pooledCer: n ? e / n : null };
  });
  fs.writeFileSync(path.join(out, 'samples.json'), JSON.stringify({ model: TTS_MODEL, style: TTS_STYLE, lines, rows, byVoice, geminiUsd: usd }, null, 2));
  console.log(JSON.stringify({ byVoice, geminiUsd: Number(usd.toFixed(5)), out }, null, 2));
}

async function pregen() {
  const voice = args.voice || TTS_VOICE;
  const lines = fixedLines();
  fs.mkdirSync(OUT, { recursive: true });
  const manifestPath = path.join(OUT, 'manifest.json');
  const prev = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const keep = prev && prev.voice === voice && prev.model === TTS_MODEL && prev.style === TTS_STYLE && !args.force ? prev.lines : {};
  const manifest = { model: TTS_MODEL, voice, style: TTS_STYLE, note: 'Voice output only: Gemini TTS, because the Meta Model API has no TTS. Every decision is a Meta model.', generated: new Date().toISOString(), lines: {} };
  let usd = 0;
  const asrCer = {};
  for (const text of lines) {
    const file = fileFor(voice, text);
    if (keep[text] === file && fs.existsSync(path.join(OUT, file))) {
      manifest.lines[text] = file;
      continue;
    }
    if (args['dry-run']) { console.log('would generate', file, text); continue; }
    // TTS can stutter (a doubled syllable): check each Thai take with Meta
    // ASR on the phone-band copy and keep the best of up to 3 takes.
    let best = null;
    for (let take = 0; take < 3; take++) {
      const r = await tts(text, voice);
      usd += r.costUsd;
      let score = 0;
      if (process.env.META_MODEL_API_KEY && /[฀-๿]/.test(text)) {
        const t = await transcribeFile({ apiKey: process.env.META_MODEL_API_KEY, wavBytes: phoneWav(Buffer.from(r.audio)) });
        score = cer(text, t.transcript).cer;
      }
      if (!best || score < best.score) best = { r, score };
      if (score <= 0.05) break;
      console.log(`  take ${take + 1} CER ${(score * 100).toFixed(1)}%, trying again`);
    }
    wavToMp3(Buffer.from(best.r.audio), path.join(OUT, file));
    manifest.lines[text] = file;
    asrCer[text] = Number(best.score.toFixed(3));
    console.log('ok', file, `CER ${(best.score * 100).toFixed(1)}%`, text);
  }
  if (args['dry-run']) return;
  // Drop files no longer referenced.
  const used = new Set(Object.values(manifest.lines));
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.mp3') && !used.has(f)) fs.rmSync(path.join(OUT, f));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ lines: lines.length, generatedUsd: Number(usd.toFixed(5)), voice, asrCer }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!GEMINI && !args['dry-run']) { console.error('GEMINI_API_KEY missing (env or --env <file>)'); process.exit(2); }
  await (args.samples ? samples() : pregen());
}
