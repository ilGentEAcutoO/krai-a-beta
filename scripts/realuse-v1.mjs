#!/usr/bin/env node
// Real-use test, v1 (Google build, ../hack-google) — RE-RUN, not recorded.
// Drives the v1 live engine itself (src/liveVoice.js startSession: Gemini Live
// ASR + VAD + persona, judge = Gemini/Jev/rules via src/judge, hang-up policy
// nextAction) with the same caller audio and the same call timeline as
// scripts/realuse.mjs, through a fake client socket (the same seam v1's phone
// path uses). Audio is PCM S16 mono 16 kHz in 100 ms frames, real time.
//
//   node scripts/realuse-v1.mjs [--set th|en|all] [--calls id,..] [--condition clean|phone] [--out dir]
//
// Keys come from ../hack-google/app/.env (dotenv inside v1's config.js);
// nothing is printed. Recording to disk is forced off.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { alignFinals, buildTimeline, callOutcome, msOfPcm, pcmFrames } from './realuse-lib.mjs';
import { decodePcm } from './realuse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V1_APP = process.env.REALUSE_V1_APP || path.resolve(ROOT, '..', 'hack-google', 'app');
const RATE = 16000;
const FRAME_MS = 100;
const FRAME_BYTES = (RATE * 2 * FRAME_MS) / 1000;

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const SET = args.set || 'all';
const CONDITION = args.condition || 'clean';
const ONLY = args.calls ? new Set(args.calls.split(',')) : null;
const DATE = new Date().toISOString().slice(0, 10);
const OUT = path.resolve(ROOT, args.out || `eval-results/realuse-${DATE}`);

process.env.RECORD_AUDIO = 'off';
process.env.LIVE_RECORD_DIR = '';
process.chdir(V1_APP); // v1 config.js loads ./.env from the cwd
const imp = (p) => import(pathToFileURL(path.join(V1_APP, p)).href);
const { createLiveVoice } = await imp('src/liveVoice.js');
const judgeMod = await imp('src/judge/index.js');
const { config } = await imp('src/config.js');
const MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

const sleepUntil = (t) => new Promise((ok) => setTimeout(ok, Math.max(0, t - Date.now())));

// Looks like a `ws` server-side socket to runSession.
class FakeClient extends EventEmitter {
  constructor(onJson, onBinary) {
    super();
    this.readyState = 1;
    this.onJson = onJson;
    this.onBinary = onBinary;
  }
  send(data, opts) {
    if (opts?.binary || Buffer.isBuffer(data)) return this.onBinary(data);
    try { this.onJson(JSON.parse(String(data))); } catch { /* ignore */ }
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setImmediate(() => this.emit('close'));
  }
}

async function runCall(scenario, lang) {
  const durations = new Map();
  const pcmOf = new Map();
  for (const t of scenario.turns) {
    if (t.role !== 'caller') continue;
    const pcm = decodePcm(path.join(V1_APP, 'public', t.audio), RATE, CONDITION);
    pcmOf.set(t.audio, pcm);
    durations.set(t.audio, msOfPcm(pcm.length, RATE));
  }
  const timeline = buildTimeline(scenario, { durationOf: (t) => durations.get(t.audio), lang });
  const rec = {
    id: scenario.id, lang, expected: scenario.expected, condition: CONDITION, engine: 'v1', model: MODEL,
    events: [], finals: [], decisions: [], replies: [], errors: [], costUsd: 0, aiAudioMs: 0,
  };
  let t0 = 0;
  const now = () => (t0 ? Date.now() - t0 : -1);
  const segAt = (ms) => timeline.segments.filter((s) => s.kind === 'caller' && s.startMs <= ms).pop();
  let ended = null;
  const pendingVerdicts = [];

  const lv = createLiveVoice({
    model: MODEL,
    maxSeconds: 120,
    recordAudio: () => false,
    recordDir: '',
    log: () => {},
    judge: async (input) => {
      const t = Date.now();
      const r = await judgeMod.judgeTurn(input);
      pendingVerdicts.push({ judgeMs: Date.now() - t, engine: r.engine, signals: r.signals });
      return r;
    },
    decideAction: async (v, callerTurns) => {
      const act = judgeMod.nextAction(v, callerTurns, { maxTurns: config.maxTurnsPerCall });
      const d = rec.decisions[rec.decisions.length - 1];
      if (d && d.action == null) d.action = act;
      return act;
    },
  });

  const client = new FakeClient((m) => {
    rec.events.push({ atMs: now(), type: m.type, ...(m.role ? { role: m.role } : {}), ...(m.text ? { text: m.text } : {}), ...(m.final != null ? { final: m.final } : {}), ...(m.reason ? { reason: m.reason } : {}), ...(m.verdict ? { verdict: m.verdict } : {}) });
    if (m.type === 'transcript' && m.final && m.role === 'caller') {
      const seg = segAt(now());
      rec.finals.push({ type: 'final', text: m.text, atMs: now(), callerNo: seg?.callerNo ?? 0 });
    } else if (m.type === 'transcript' && m.final && m.role === 'ai') {
      const seg = segAt(now());
      rec.replies.push({ atMs: now(), afterCallerNo: seg?.callerNo ?? 0, reply: m.text });
    } else if (m.type === 'verdict') {
      const lastFinal = rec.finals[rec.finals.length - 1];
      const meta = pendingVerdicts.shift() || {};
      rec.decisions.push({
        callerNo: lastFinal?.callerNo ?? 0, finalAtMs: lastFinal?.atMs ?? null, atMs: now(), judgeMs: meta.judgeMs ?? null,
        verdict: m.verdict, confidence: m.confidence, engine: m.engine || meta.engine, reasonTh: m.reasonTh, action: null,
      });
    } else if (m.type === 'closing') {
      rec.closing = { atMs: now(), reason: m.reason };
    } else if (m.type === 'end') {
      ended = { atMs: now(), reason: m.reason };
    }
  }, (buf) => {
    rec.aiAudioMs += (buf.length / 2 / 24000) * 1000;
  });

  t0 = Date.now();
  lv.startSession(client, {
    lang,
    hooks: { ended: (sum) => { rec.costUsd = Number(sum?.usage?.costUsd?.usd) || 0; rec.usage = sum?.usage || null; } },
  });
  let frameNo = 0;
  for (const seg of timeline.segments) {
    const pcm = seg.kind === 'caller' ? pcmOf.get(seg.audio) : Buffer.alloc(Math.round((seg.endMs - seg.startMs) * RATE / 1000) * 2);
    for (const f of pcmFrames(pcm, FRAME_BYTES)) {
      await sleepUntil(t0 + frameNo * FRAME_MS);
      if (ended) break;
      client.emit('message', Buffer.from(f), true);
      frameNo += 1;
    }
    if (ended) break;
  }
  rec.streamedMs = now();
  const until = Date.now() + 20000;
  while (!ended && Date.now() < until) {
    // judge still running for the last turn?
    const lastFinal = rec.finals[rec.finals.length - 1];
    if (lastFinal && rec.decisions.some((d) => d.finalAtMs === lastFinal.atMs) && Date.now() > t0 + timeline.totalMs + 3000) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ended) client.emit('message', Buffer.from(JSON.stringify({ type: 'end' })), false);
  await new Promise((r) => setTimeout(r, 500));
  rec.ended = ended;
  lv.close();
  return { rec, timeline };
}

function summarise({ rec, timeline }) {
  const asr = alignFinals(timeline, rec.finals.filter((f) => f.text));
  // A hang-up closes the line: count it as the decision's action.
  const outcome = callOutcome(rec.expected, rec.decisions, timeline, rec.ended);
  const latency = timeline.segments.filter((s) => s.kind === 'caller').map((s) => {
    const f = rec.finals.find((x) => x.callerNo === s.callerNo && x.text);
    const d = rec.decisions.find((x) => x.callerNo === s.callerNo);
    const r = rec.replies.find((x) => x.afterCallerNo === s.callerNo && x.atMs > s.endMs);
    return {
      callerNo: s.callerNo,
      eosMs: Math.round(s.endMs),
      eosToFirstFinalMs: f ? Math.round(f.atMs - s.endMs) : null,
      eosToDecisionMs: d ? Math.round(d.atMs - s.endMs) : null,
      eosToReplyMs: r ? Math.round(r.atMs - s.endMs) : null,
      judgeMs: d?.judgeMs ?? null,
    };
  });
  return { ...rec, asr, outcome, latency, timelineMs: Math.round(timeline.totalMs), timeline: timeline.segments.map(({ kind, callerNo, startMs, endMs }) => ({ kind, callerNo, startMs: Math.round(startMs), endMs: Math.round(endMs) })) };
}

const scen = JSON.parse(fs.readFileSync(path.join(V1_APP, 'public', 'demo', 'scenarios.json'), 'utf8'));
const sets = [];
if (SET === 'th' || SET === 'all') sets.push(['th', scen.scenarios]);
if (SET === 'en' || SET === 'all') sets.push(['en', scen.scenariosEn]);
fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, `v1-${CONDITION}.json`);
const calls = [];
for (const [lang, list] of sets) {
  for (const s of list) {
    if (ONLY && !ONLY.has(s.id) && !ONLY.has(`${s.id}-${lang}`)) continue;
    process.stdout.write(`v1 ${s.id}-${lang} (${CONDITION}) … `);
    try {
      const res = summarise(await runCall(s, lang));
      calls.push(res);
      const o = res.outcome;
      console.log(`${o.finalVerdict || '-'} correct=${o.correct} safe=${o.safeAction ? o.safeAction.kind + '@turn' + o.safeAction.callerNo : '-'} cer=${res.asr.map((a) => a.cer.toFixed(2)).join('/')} lat=${res.latency.map((l) => l.eosToDecisionMs).join('/')}ms end=${res.ended?.reason} $${res.costUsd.toFixed(4)}`);
    } catch (e) {
      console.log('FAILED', e.message);
      calls.push({ id: s.id, lang, expected: s.expected, condition: CONDITION, fatal: String(e.message) });
    }
    fs.writeFileSync(outFile, JSON.stringify({ engine: 'v1', model: MODEL, judge: 'hack-google src/judge (gemini/jev/rules)', rerun: true, condition: CONDITION, ranAt: new Date().toISOString(), calls }, null, 2));
  }
}
console.log('wrote', outFile);
process.exit(0);
