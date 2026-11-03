#!/usr/bin/env node
// B21: how well does Meta's ear (muse-voice-transcribe-1.0) hear callers on a
// phone line, across voices, languages and audio conditions?
//
//   node scripts/realuse-voices.mjs --env <file> [--out <dir>] [--bias th,thenzh,none] [--conds phone]
//
// Clips:
//   th  25 Thai turns of the v1 demo (hack-google/app/public/demo, Gemini TTS)
//   en  25 English demo turns + 10 new flash-LITE clips in varied voices
//   zh  10 new flash-LITE Mandarin clips in varied voices
// New clips are cached in agent-temp/voice-clips/ (24 kHz WAV) so a rerun
// spends nothing on Gemini. Only flash-lite-tts is used here (flash-tts quota
// is kept for prod).
// Conditions (--conds): phone = 8 kHz band + G.711 mu-law; noisy = phone +
// street noise at 10 dB SNR; quiet = phone at -18 dB; fast = 1.3x then phone;
// dropout = phone with 60 ms gaps every 700 ms (packet loss).
// ASR: file mode (PUSH_TO_TALK), one call per clip x condition x bias.
// Results cached per key in <out>/asr.json; summary in <out>/summary.json.
// Metric: CER (th, zh, en) + WER (en) + doubling count (an immediate repeat
// in the transcript that the reference does not have, e.g. "请请", "is is").
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TTS_FALLBACK_MODEL, synthesize } from '../app/src/tts.js';
import { VOICE_FILE, VOICE_MODEL } from '../app/src/voice.js';
import { cer, normText } from './realuse-lib.mjs';

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
const DEMO = path.resolve(args.demo || path.join(ROOT, '..', 'hack-google', 'app', 'public'));
const CLIPS = path.join(ROOT, 'agent-temp', 'voice-clips');
const OUT = path.resolve(args.out || path.join(ROOT, 'eval-results', 'realuse-voices-2026-11-03'));
export const BIASES = { th: ['Thai'], thenzh: ['Thai', 'English', 'Mandarin Chinese'], none: null };
const MAXBUF = { maxBuffer: 64 << 20 };
// --rep N: an independent repeat of the same ASR calls (ASR is not deterministic).
const REP = Math.max(1, Number(args.rep) || 1);

// ---- new clips (flash-lite only) ----
export const NEW_CLIPS = [
  // English: scam + legit, varied voices and roles
  ['en-01', 'en', 'Puck', 'a hurried male bank officer', "Hi, this is Mark from the card security team. We've blocked a transaction of nine hundred dollars on your card. To reverse it I need the six-digit code we just sent you."],
  ['en-02', 'en', 'Kore', 'a firm female police officer', 'This is Inspector Lim from the Commercial Affairs Department. Your identity card was used to open an account for money laundering. You must not tell anyone about this call.'],
  ['en-03', 'en', 'Charon', 'a calm older male courier', "Hello, I'm outside your building with a parcel from Swiftlane Express. Should I leave it with the guard house or come back tomorrow morning?"],
  ['en-04', 'en', 'Aoede', 'a friendly female clinic receptionist', 'Good morning, this is Bright Smile Dental calling to confirm your cleaning appointment on Thursday at ten thirty. Please call us back if you need to change it.'],
  ['en-05', 'en', 'Fenrir', 'an excited young male salesman', "Congratulations! You've been selected for our premium investment program with guaranteed twenty percent monthly returns. I just need you to add me on LINE to get started."],
  ['en-06', 'en', 'Leda', 'a worried young woman', "Mum, it's me, I lost my phone so I'm using a friend's number. I'm in a bit of trouble, can you transfer some money to this account? Please don't tell Dad."],
  ['en-07', 'en', 'Orus', 'a polite male customs officer', 'This is the customs office at the airport. A package under your name contains illegal items. We will connect you to the police to clear your name right now.'],
  ['en-08', 'en', 'Zephyr', 'a cheerful female survey caller', "Hi there, I'm calling from a market research company. Do you have three minutes to answer a short survey about mobile phone plans? There's no obligation."],
  ['en-09', 'en', 'Gacrux', 'a stern older woman debt collector', 'I am calling about an overdue credit card payment of four thousand two hundred baht. If we do not receive payment by Friday, the case will be sent to our legal department.'],
  ['en-10', 'en', 'Sadaltager', 'a relaxed male neighbour', "Hey, it's Tom from next door. Your car lights are still on in the car park. Just thought you'd want to know before the battery dies."],
  // Mandarin
  ['zh-01', 'zh', 'Alnilam', '一位语速很快的男性银行客服', '您好，这里是银行风险控制中心。您的信用卡刚刚有一笔九千元的异常消费，为了取消这笔交易，请把手机收到的六位验证码告诉我。'],
  ['zh-02', 'zh', 'Laomedeia', '一位语气严肃的女警官', '我是公安局经侦大队的王警官。你的身份证被人用来开户洗钱，现在需要你配合调查，这件事不能告诉任何人。'],
  ['zh-03', 'zh', 'Iapetus', '一位和气的中年男快递员', '你好，我是快递员，你的包裹到楼下了。是放在门卫那里，还是明天上午再给你送过来？'],
  ['zh-04', 'zh', 'Despina', '一位亲切的女诊所前台', '您好，这里是牙科诊所，想跟您确认一下星期四上午十点半的洗牙预约。如果需要改时间，请回电给我们。'],
  ['zh-05', 'zh', 'Enceladus', '一位热情的年轻男推销员', '恭喜您！您被选中参加我们的高端理财计划，每个月保证百分之二十的收益。您先加我的微信，我马上帮您开通。'],
  ['zh-06', 'zh', 'Callirrhoe', '一位着急的年轻女孩', '妈，是我，我手机丢了，用朋友的电话打给你。我遇到点麻烦，你能先转点钱到这个账户吗？千万别告诉爸爸。'],
  ['zh-07', 'zh', 'Rasalgethi', '一位礼貌的男海关人员', '这里是机场海关。有一个用你名字寄的包裹里面有违禁品，我们现在帮你转接到警方，让你说明情况。'],
  ['zh-08', 'zh', 'Vindemiatrix', '一位温和的女调查员', '您好，我是市场调查公司的，想占用您三分钟时间，做一个关于手机套餐的简短问卷，您看方便吗？'],
  ['zh-09', 'zh', 'Schedar', '一位强硬的中年女催收员', '你的信用卡已经逾期，欠款四千二百元。如果星期五之前还不还款，我们会把案件转交给法务部门处理。'],
  ['zh-10', 'zh', 'Achird', '一位随和的男邻居', '喂，我是隔壁的老张。你的车灯还开着，停在停车场那边，跟你说一声，免得电瓶没电了。'],
];

const tts = async (text, voice, style) => {
  for (let i = 0; ; i++) {
    try {
      return await synthesize({ apiKey: process.env.GEMINI_API_KEY, text, voice, style, model: TTS_FALLBACK_MODEL });
    } catch (e) {
      if (!/tts-http-429|tts-http-5|tts-timeout/.test(e.message) || i >= 4) throw e;
      const wait = 20000 * (i + 1); // gentle backoff
      console.log(`  ${e.message}, retry in ${wait / 1000}s`);
      await new Promise((ok) => setTimeout(ok, wait));
    }
  }
};
const ff = (input, a) => execFileSync('ffmpeg', ['-v', 'error', ...a], { input, ...MAXBUF });
const toWav16 = (file) => ff(null, ['-i', file, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1']);
const PHONE = 'highpass=f=300,lowpass=f=3400,aresample=8000';
const mulawBack = (wav) => ff(ff(wav, ['-i', 'pipe:0', '-af', PHONE, '-ac', '1', '-c:a', 'pcm_mulaw', '-f', 'wav', 'pipe:1']), ['-i', 'pipe:0', '-af', 'aresample=16000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1']);
// Conditions: each takes a clean 16 kHz WAV and returns the 16 kHz WAV that Meta hears.
export const CONDS = {
  phone: (w) => mulawBack(w),
  quiet: (w) => mulawBack(ff(w, ['-i', 'pipe:0', '-af', 'volume=-18dB', '-f', 'wav', 'pipe:1'])),
  fast: (w) => mulawBack(ff(w, ['-i', 'pipe:0', '-af', 'atempo=1.3', '-f', 'wav', 'pipe:1'])),
  // Brown noise (traffic-like rumble) mixed at about 10 dB under the speech.
  noisy: (w) => mulawBack(ff(w, ['-i', 'pipe:0', '-f', 'lavfi', '-i', 'anoisesrc=color=brown:amplitude=0.06:seed=7', '-filter_complex', '[1:a]aresample=16000[n];[0:a][n]amix=inputs=2:duration=first:normalize=0', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'])),
  // Packet loss: 60 ms of silence every 700 ms.
  dropout: (w) => mulawBack(ff(w, ['-i', 'pipe:0', '-af', "volume='if(lt(mod(t,0.7),0.06),0,1)':eval=frame", '-f', 'wav', 'pipe:1'])),
};

async function asr(wavBytes, languageBias) {
  const req = { model: VOICE_MODEL, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' };
  if (languageBias) req.languageBias = languageBias;
  for (let i = 0; ; i++) {
    const form = new FormData();
    form.append('request', new Blob([JSON.stringify(req)], { type: 'application/json' }));
    form.append('audio', new File([wavBytes], 'chunk.wav', { type: 'audio/wav' }));
    const res = await fetch(VOICE_FILE, { method: 'POST', headers: { Authorization: `Bearer ${process.env.META_MODEL_API_KEY}`, Accept: 'application/json' }, body: form, signal: AbortSignal.timeout(60000) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return String(body.transcript ?? body.text ?? '');
    if ((res.status === 429 || res.status >= 500) && i < 4) { await new Promise((ok) => setTimeout(ok, 5000 * (i + 1))); continue; }
    throw new Error(body?.error?.code || `voice-http-${res.status}`);
  }
}

// ---- metrics ----
const enWords = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
export function wer(ref, hyp) {
  const a = enWords(ref);
  const b = enWords(hyp);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return { edits: prev[b.length], n: a.length };
}
// Immediate repeats: words for English, 1-6 character units for Thai/Chinese.
function repeats(text, lang) {
  if (lang === 'en') {
    const w = enWords(text);
    return w.filter((x, i) => i > 0 && x === w[i - 1]).length;
  }
  const s = [...normText(text)];
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    for (let L = 6; L >= (lang === 'zh' ? 1 : 2); L--) {
      if (i + 2 * L > s.length) continue;
      if (s.slice(i, i + L).join('') === s.slice(i + L, i + 2 * L).join('')) { n++; i += L - 1; break; }
    }
  }
  return n;
}
export const doubling = (ref, hyp, lang) => Math.max(0, repeats(hyp, lang) - repeats(ref, lang));

// ---- clip set ----
async function clipSet() {
  const demo = JSON.parse(fs.readFileSync(path.join(DEMO, 'demo', 'scenarios.json'), 'utf8'));
  const out = [];
  for (const [key, lang, field] of [['scenarios', 'th', 'textTh'], ['scenariosEn', 'en', 'textEn']]) {
    for (const s of demo[key]) {
      for (const t of s.turns) {
        if (!t.audio || !t[field]) continue;
        out.push({ id: path.basename(t.audio, '.mp3'), lang, src: 'demo', role: t.role, voice: t.role === 'ai' ? demo.voices.ai : s.callerVoice, text: t[field], file: path.join(DEMO, t.audio) });
      }
    }
  }
  fs.mkdirSync(CLIPS, { recursive: true });
  for (const [id, lang, voice, persona, text] of NEW_CLIPS) {
    const file = path.join(CLIPS, `${id}.wav`);
    if (!fs.existsSync(file)) {
      const style = lang === 'zh' ? `${persona}，在电话里说普通话，自然语速` : `${persona} on a phone call, natural conversational pace`;
      const r = await tts(text, voice, style);
      fs.writeFileSync(file, Buffer.from(r.audio));
      console.log('tts', id, voice);
    }
    out.push({ id, lang, src: 'lite', role: 'caller', voice, text, file });
  }
  return out;
}

function summarize(rows) {
  const groups = {};
  for (const r of rows) {
    const k = `${r.lang}|${r.cond}|${r.bias}`;
    const g = (groups[k] ||= { lang: r.lang, cond: r.cond, bias: r.bias, clips: 0, cE: 0, cN: 0, wE: 0, wN: 0, doubling: 0, worst: [] });
    g.clips++; g.cE += r.cer.edits; g.cN += r.cer.refLen; g.doubling += r.doubling;
    if (r.wer) { g.wE += r.wer.edits; g.wN += r.wer.n; }
    g.worst.push([r.cer.cer, r.id]);
  }
  return Object.values(groups).map((g) => ({
    lang: g.lang, cond: g.cond, bias: g.bias, clips: g.clips,
    cer: Number((g.cE / g.cN).toFixed(4)), wer: g.wN ? Number((g.wE / g.wN).toFixed(4)) : null, doubling: g.doubling,
    worst: g.worst.sort((a, b) => b[0] - a[0]).slice(0, 3).map(([c, id]) => `${id} ${(c * 100).toFixed(1)}%`),
  })).sort((a, b) => (a.lang + a.cond + a.bias).localeCompare(b.lang + b.cond + b.bias));
}

async function main() {
  const biases = String(args.bias || 'th,thenzh,none').split(',');
  const conds = String(args.conds || 'phone').split(',');
  const langs = String(args.langs || 'th,en,zh').split(',');
  fs.mkdirSync(OUT, { recursive: true });
  const cachePath = path.join(OUT, 'asr.json');
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  const clips = (await clipSet()).filter((c) => langs.includes(c.lang));
  let calls = 0;
  let audioSec = 0;
  const rows = [];
  for (const c of clips) {
    const clean = toWav16(c.file);
    for (const cond of conds) {
      const wav = CONDS[cond](clean);
      const sec = (wav.length - 44) / 2 / 16000;
      for (const b of biases) {
        const key = `${c.id}|${cond}|${b}${REP > 1 ? `|r${REP}` : ''}`;
        if (!cache[key]) {
          cache[key] = { transcript: await asr(wav, BIASES[b]), sec: Number(sec.toFixed(2)) };
          calls++; audioSec += sec;
          if (calls % 10 === 0) fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
        }
        const hyp = cache[key].transcript;
        rows.push({ id: c.id, lang: c.lang, src: c.src, role: c.role, voice: c.voice, cond, bias: b, ref: c.text, hyp, cer: cer(c.text, hyp), wer: c.lang === 'en' ? wer(c.text, hyp) : null, doubling: doubling(c.text, hyp, c.lang) });
      }
    }
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  const summary = summarize(rows);
  const usd = (audioSec / 3600) * 0.18;
  const tag = REP > 1 ? `-r${REP}` : '';
  fs.writeFileSync(path.join(OUT, `rows${tag}.json`), JSON.stringify(rows, null, 1));
  fs.writeFileSync(path.join(OUT, `summary${tag}.json`), JSON.stringify({ rep: REP, model: VOICE_MODEL, mode: 'file PUSH_TO_TALK', biases: BIASES, conds, newCalls: calls, newAudioSec: Math.round(audioSec), newUsd: Number(usd.toFixed(4)), summary }, null, 2));
  for (const s of summary) console.log(`${s.lang} ${s.cond.padEnd(7)} ${s.bias.padEnd(6)} n=${s.clips} CER ${(s.cer * 100).toFixed(2)}%${s.wer != null ? ` WER ${(s.wer * 100).toFixed(2)}%` : ''} doubling ${s.doubling} | ${s.worst.join(', ')}`);
  console.log(JSON.stringify({ newCalls: calls, newAudioSec: Math.round(audioSec), newUsd: Number(usd.toFixed(4)), out: OUT }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
