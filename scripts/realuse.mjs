#!/usr/bin/env node
// Real-use test, Meta build (B12). Streams the SAME recorded caller audio the
// v1 (Google) demo uses into the live pipeline at real-time speed, exactly as
// the /demo-live page does: PCM S16 mono 24 kHz in 100 ms binary frames over
// /api/voice/live, each final judged by /api/verdict/turn on the whole call,
// grey verdicts escalated to Wonder, and a SCAM call switched to trap mode so
// later caller turns get /api/trap/reply lines.
//
//   node scripts/realuse.mjs --base http://localhost:8787 [--calls scam-police,..]
//        [--set th|en|all] [--condition clean|phone] [--out eval-results/realuse-<date>]
//
// The receptionist side of the line is silence (the recorded AI line length);
// the Meta build only talks in trap mode. Needs ffmpeg on PATH. Never prints
// keys: the key lives in the Worker (.dev.vars / wrangler secret).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignFinals, buildTimeline, callOutcome, msOfPcm, pcmFrames, silenceStats, ttsMs } from './realuse-lib.mjs';
import { FOLLOW_UP_FALLBACK_MS, followUp, newCallState, onCallerTurn, onT1, onVerdict } from '../app/src/receptionist.js';
import { sparkUsd } from '../app/src/budget.js';
import { createTurnMerger } from '../app/src/voice.js';
import { VERDICT_EFFORT, VERDICT_MODEL } from '../app/src/spark.js';
import { DISCLOSURE_LINE_TH } from '../app/src/trap.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V1 = process.env.REALUSE_V1_DIR || path.resolve(ROOT, '..', 'hack-google', 'app', 'public');
const RATE = 24000;
const FRAME_MS = 100;
const FRAME_BYTES = (RATE * 2 * FRAME_MS) / 1000;

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const BASE = args.base || 'http://localhost:8787';
const SET = args.set || 'all';
const CONDITION = args.condition || 'clean';
const ONLY = args.calls ? new Set(args.calls.split(',')) : null;
const DATE = new Date().toISOString().slice(0, 10);
const OUT = path.resolve(ROOT, args.out || `eval-results/realuse-${DATE}`);
const TRAP = args.trap !== '0';
// --rx 1 (default): G9 receptionist answers every caller turn, as voice-client.js does.
const RX = args.rx !== '0';
// --t1 1 (default): fire POST /api/verdict/t1 next to /turn, as voice-client.js does.
const T1 = args.t1 !== '0';
const SCAM_POLICY = args.scam === 'trap' ? 'trap' : 'close';
const EARLY = args.early === '1'; // receptionist 'early ask' variant
const TAG = args.tag ? '-' + args.tag.replace(/[^a-z0-9-]/gi, '') : '';
// Local wrangler dev only: give every call its own client IP so the per-IP
// daily voice-live cap (meant for the public site) doesn't stop a test batch.
// Production overwrites cf-connecting-ip, so this cannot bypass it there.
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(BASE);
let callIp = null;
const ipHeaders = () => (LOCAL && callIp ? { 'cf-connecting-ip': callIp } : {});
// Speculative judging of partials was tried on 2026-11-03 (2x Spark cost,
// 0 early blocks in 20 calls) and removed; see eval-results/realuse-*/README.md.
const SPECULATE = false;
// --merge 1 mirrors the tail-fragment merger in voice-client.js.
const MERGE = args.merge !== '0'; // on by default, like voice-client.js
// The commit the SERVER runs (pass --git when it differs from this tree).
const GIT = args.git || execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim();

// ---- audio ----
// clean = the recorded file as-is; phone = what a phone line does to it
// (8 kHz band limit, mu-law, light line noise), back up to 24 kHz.
export function decodePcm(file, rate = RATE, condition = CONDITION) {
  const filters = condition === 'phone'
    ? ['-af', 'aresample=8000,highpass=f=300,lowpass=f=3400,aresample=' + rate]
    : [];
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, ...filters, '-f', 's16le', '-ac', '1', '-ar', String(rate), '-'], { maxBuffer: 64 << 20 });
  if (condition !== 'phone') return pcm;
  // mu-law round trip + ~-45 dBFS noise, deterministic (seeded LCG).
  const out = Buffer.alloc(pcm.length);
  let seed = 12345;
  for (let i = 0; i < pcm.length; i += 2) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((seed / 0x7fffffff) - 0.5) * 360;
    let s = pcm.readInt16LE(i) + noise;
    const sign = s < 0 ? -1 : 1;
    const mu = Math.log1p(255 * Math.min(1, Math.abs(s) / 32768)) / Math.log1p(255);
    const q = Math.round(mu * 127) / 127;
    s = sign * ((Math.expm1(q * Math.log1p(255)) / 255) * 32768);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s))), i);
  }
  return out;
}

const sleepUntil = (t) => new Promise((ok) => setTimeout(ok, Math.max(0, t - Date.now())));

async function json(url, body, token) {
  const t0 = Date.now();
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...ipHeaders(), ...(token ? { 'x-krai-session': token } : {}) },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, ms: Date.now() - t0 };
}

async function session() {
  const r = await json('/api/session', {});
  if (!r.data.token) throw new Error(`session refused ${r.status} ${r.data.error || ''}`);
  return r.data.token;
}

// Same window as voice-client.js recentLines(): newest 40 lines / 11k chars.
function recentLines(lines, max = 40, budget = 11000) {
  const out = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    const l = { speaker: lines[i].speaker, text: lines[i].text.slice(0, 2000) };
    if (used + l.text.length > budget) break;
    used += l.text.length;
    out.unshift(l);
  }
  return out;
}

async function runCall(scenario, lang) {
  callIp = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
  const token = await session();
  const durations = new Map();
  const pcmOf = new Map();
  for (const t of scenario.turns) {
    if (t.role !== 'caller') continue;
    const pcm = decodePcm(path.join(V1, t.audio));
    pcmOf.set(t.audio, pcm);
    durations.set(t.audio, msOfPcm(pcm.length, RATE));
  }
  const timeline = buildTimeline(scenario, { durationOf: (t) => durations.get(t.audio), lang });
  const callId = 'realuse-' + scenario.id + '-' + lang + '-' + Date.now().toString(36);
  const wsUrl = BASE.replace(/^http/, 'ws') + '/api/voice/live?call=' + encodeURIComponent(callId) + '&s=' + encodeURIComponent(token);
  const ws = new WebSocket(wsUrl, LOCAL ? { headers: ipHeaders() } : undefined);
  ws.binaryType = 'arraybuffer';

  const rec = {
    id: scenario.id, lang, expected: scenario.expected, condition: CONDITION,
    events: [], finals: [], decisions: [], replies: [], errors: [], http: [], costUsd: 0,
  };
  let t0 = 0;
  const now = () => (t0 ? Date.now() - t0 : -1);
  // voice-client.js openCall(): the disclosure is the call's first line.
  const callLines = [{ speaker: 'receptionist', text: DISCLOSURE_LINE_TH }];
  // What the caller hears from us: { atMs, durMs, source, kind, text }.
  rec.speech = [{ atMs: 0, durMs: ttsMs(DISCLOSURE_LINE_TH), source: 'disclosure', kind: 'disclosure', text: DISCLOSURE_LINE_TH }];
  const rxState = newCallState({ scamPolicy: SCAM_POLICY, early: EARLY });
  rec.closedAtMs = null;
  const sayLine = (text, source, kind) => {
    rec.speech.push({ atMs: now(), durMs: ttsMs(text), source, kind, text });
    callLines.push({ speaker: 'receptionist', text });
  };
  rec.t1 = [];
  async function checkT1(final) {
    const r = await json('/api/verdict/t1', { turnId: final.turnId, lines: recentLines(callLines) }, token);
    rec.http.push({ route: 't1', status: r.status, ms: r.ms });
    rec.t1.push({ callerNo: final.callerNo, atMs: now(), ms: r.ms, status: r.status, rule: r.data.t1 || null });
    if (!r.data.t1 || rxState.t1 || rec.closedAtMs != null) return;
    rec.decisions.push({ callerNo: final.callerNo, finalAtMs: final.atMs, atMs: now(), ms: r.ms, status: r.status, engine: 't1', rule: r.data.t1, verdict: 'SCAM', action: 'hangup' });
    const step = onT1(rxState, r.data.t1);
    if (step.step === 'trap') trap.on = true;
    if (step.step === 'close') {
      sayLine(step.line, 'receptionist', 'close');
      rec.closedAtMs = now();
    }
  }
  // voice-client.js afterVerdict(): code picks the step once a verdict lands.
  // Is a scripted caller segment playing right now? (voice-client: a live band)
  const callerTalking = () => timeline.segments.some((sg) => sg.kind === 'caller' && sg.startMs <= now() && now() < sg.endMs);
  rec.stage2 = [];
  const applyStep = (r, why) => {
    if (r.step === 'trap') trap.on = true;
    if (r.step === 'close') {
      sayLine(r.line, 'receptionist', 'close');
      rec.closedAtMs = now();
    }
    if (r.step === 'ask') sayLine(r.line, 'receptionist', r.kind);
    if (r.step === 'ask' || r.dropped) rec.stage2.push({ atMs: now(), turn: rxState.callerTurns, why, kind: r.kind || null, dropped: Boolean(r.dropped) });
  };
  const afterVerdict = (verdict, action, extra = {}) => {
    if (!RX) {
      if (verdict === 'SCAM' && TRAP) trap.on = true; // pre-G9: the family presses the trap
      return;
    }
    applyStep(onVerdict(rxState, { verdict, action, ...extra, callerTalking: callerTalking() }), 'verdict');
  };
  const trap = { on: false, token: null, busy: false, intel: [] };
  const pending = new Set();
  let readyAt = null;
  let turnSeq = 0;
  rec.speculative = [];
  let partialTurn = null;

  const track = (p) => {
    pending.add(p);
    p.finally(() => pending.delete(p));
    return p;
  };

  async function judge(final) {
    const callerCount = callLines.filter((l) => l.speaker === 'caller').length || 1;
    const r = await json('/api/verdict/turn', { turnId: final.turnId, turnCount: callerCount, lines: recentLines(callLines) }, token);
    rec.http.push({ route: 'verdict', status: r.status, ms: r.ms });
    const d = {
      callerNo: final.callerNo, finalAtMs: final.atMs, atMs: now(), ms: r.ms, status: r.status,
      verdict: r.data.policy?.verdict || null, confidence: r.data.policy?.confidence ?? null, rule: r.data.policy?.rule || null,
      escalate: Boolean(r.data.policy?.escalate), action: r.data.action || null, tactic: r.data.spark?.tactic || null,
      signals: r.data.spark?.signals || null, sparkError: r.data.spark?.error || null, t1: r.data.t1 || null,
      engine: r.data.spark?.engine || 'spark', sparkLatencyMs: r.data.spark?.latencyMs ?? null, error: r.status !== 200 ? r.data.error || `http-${r.status}` : null,
    };
    if (r.data.spark?.usage && !r.data.spark?.cached) rec.costUsd += sparkUsd(r.data.spark.usage);
    if (r.status !== 200) {
      rec.errors.push({ atMs: now(), where: 'verdict', status: r.status, error: d.error });
      rec.decisions.push(d);
      return;
    }
    rec.decisions.push(d);
    // Stage 2 from Spark's fields for this turn (voice-client judgeTurn).
    afterVerdict(d.verdict, d.action, { signals: d.signals, tactic: d.tactic, turn: final.rxTurn ?? null });
    if (d.escalate) {
      const w = await json('/api/verdict/escalate', { lines: recentLines(callLines), spark: r.data.spark, turnCount: callerCount }, token);
      rec.http.push({ route: 'escalate', status: w.status, ms: w.ms });
      rec.costUsd += Number(w.data.costUsd) || 0;
      rec.decisions.push({
        callerNo: final.callerNo, finalAtMs: final.atMs, atMs: now(), ms: w.ms, status: w.status, engine: 'wonder',
        verdict: w.data.policy?.verdict || null, confidence: w.data.policy?.confidence ?? null, rule: w.data.policy?.rule || null,
        action: w.data.action || null, reasonTh: w.data.wonder?.reasonTh || null, evidence: w.data.wonder?.evidence || [],
        error: w.status !== 200 ? w.data.error || `http-${w.status}` : null,
      });
      afterVerdict(w.data.policy?.verdict || null, w.data.action || null);
    }
  }

  async function trapTurn(final) {
    if (trap.busy) {
      rec.replies.push({ callerNo: final.callerNo, skipped: 'busy' });
      return;
    }
    trap.busy = true;
    try {
      const r = await json('/api/trap/reply', { lines: recentLines(callLines), intel: trap.intel, trapToken: trap.token }, token);
      rec.http.push({ route: 'trap', status: r.status, ms: r.ms });
      rec.costUsd += Number(r.data.costUsd) || 0;
      if (r.data.trapToken) trap.token = r.data.trapToken;
      if (Array.isArray(r.data.intel)) trap.intel = r.data.intel;
      rec.replies.push({
        callerNo: final.callerNo, finalAtMs: final.atMs, atMs: now(), ms: r.ms, status: r.status,
        reply: r.data.reply || null, source: r.data.source || null, guarded: r.data.guarded ?? null,
        guardReasons: r.data.guardReasons || [], intel: (r.data.intel || []).map((i) => ({ type: i.type, value: i.value })),
        error: r.status !== 200 ? r.data.error || `http-${r.status}` : null,
      });
      if (r.data.reply && rec.closedAtMs == null) sayLine(r.data.reply, 'trap', r.data.source || 'trap');
    } finally {
      trap.busy = false;
    }
  }

  const finalsById = new Map();
  function callerTurn(final, text) {
    if (rec.closedAtMs != null) return; // the receptionist already closed the call
    callLines.push({ speaker: 'caller', text });
    if (RX) {
      const r = onCallerTurn(rxState);
      if (r) {
        sayLine(r.line, 'receptionist', r.kind);
        final.rxTurn = r.turn;
        setTimeout(() => { if (rec.closedAtMs == null) applyStep(followUp(rxState, { turn: r.turn, callerTalking: callerTalking() }), 'fallback'); }, FOLLOW_UP_FALLBACK_MS);
      }
      if (T1 && !trap.on) track(checkT1(final)).catch(() => {});
    }
    track(trap.on ? trapTurn(final) : judge(final)).catch((e) => rec.errors.push({ atMs: now(), where: 'judge', error: String(e.message) }));
  }
  const merger = createTurnMerger({
    onTurn: ({ turnId, text, merged }) => {
      const base = finalsById.get(turnId);
      if (merged.length) rec.merges = (rec.merges || 0) + merged.length;
      // the judged moment is now (after the grace window), the turn is the first one's
      callerTurn({ ...base, text, atMs: now() }, text);
    },
  });

  // Exactly what voice-client.js onEvent() does with a relay frame.
  function onEvent(ev) {
    rec.events.push({ atMs: now(), type: ev.type, turnId: ev.turnId ?? null, ...(ev.transcript != null ? { text: ev.transcript } : {}), ...(ev.message ? { message: ev.message } : {}) });
    if (ev.type === 'ready') readyAt = Date.now();
    if (ev.type === 'error') rec.errors.push({ atMs: now(), where: 'voice', error: ev.message });
    if (ev.type === 'speech-start') {
      partialTurn = ev.turnId ?? 'u' + (turnSeq + 1);
      if (MERGE) merger.speechStart(ev.turnId);
    }
    if (ev.type === 'final' || ev.type === 'speech-complete') {
      const text = String(ev.transcript || '').trim();
      const seg = timeline.segments.filter((s) => s.kind === 'caller' && s.startMs <= now()).pop();
      const final = { turnId: ev.turnId ?? 'u' + (++turnSeq), type: ev.type, text, atMs: now(), callerNo: seg?.callerNo ?? 0, eosMs: seg?.endMs ?? null };
      rec.finals.push(final);
      if (!text) return;
      if (MERGE) {
        finalsById.set(final.turnId, final);
        merger.final(final.turnId, text);
        return;
      }
      callerTurn(final, text);
    }
  }

  ws.addEventListener('message', (m) => {
    if (typeof m.data !== 'string') return;
    try { onEvent(JSON.parse(m.data)); } catch { /* one bad frame never kills the call */ }
  });
  let closed = null;
  ws.addEventListener('close', (e) => { closed = { code: e.code, reason: e.reason, atMs: now() }; });
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => fail(new Error('ws-open-failed')), { once: true });
  });
  const openedAt = Date.now();
  while (!readyAt && !closed && Date.now() - openedAt < 15000) await new Promise((r) => setTimeout(r, 50));
  rec.metaReadyMs = readyAt ? readyAt - openedAt : null;
  if (!readyAt) {
    rec.errors.push({ where: 'voice', error: 'meta-not-ready' });
    ws.close();
    return { rec, timeline };
  }

  // Stream the call at real time on an absolute clock (no drift).
  t0 = Date.now();
  let frameNo = 0;
  for (const seg of timeline.segments) {
    const pcm = seg.kind === 'caller' ? pcmOf.get(seg.audio) : Buffer.alloc(Math.round((seg.endMs - seg.startMs) * RATE / 1000) * 2);
    for (const f of pcmFrames(pcm, FRAME_BYTES)) {
      await sleepUntil(t0 + frameNo * FRAME_MS);
      if (closed) break;
      // Copy into its own ArrayBuffer: a Node Buffer may be a view on a pool.
      ws.send(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
      frameNo += 1;
    }
  }
  rec.streamedMs = now();
  merger.flush();
  // Let the last verdicts / trap replies land.
  const waitUntil = Date.now() + 20000;
  while (pending.size && Date.now() < waitUntil) await new Promise((r) => setTimeout(r, 100));
  ws.close(1000, 'done');
  rec.closed = closed;
  return { rec, timeline };
}

function summarise({ rec, timeline }) {
  const finalsWithText = rec.finals.filter((f) => f.text);
  const asr = alignFinals(timeline, finalsWithText);
  const sparkDecisions = rec.decisions.filter((d) => !d.error);
  const outcome = callOutcome(rec.expected, sparkDecisions, timeline);
  const callerSegs = timeline.segments.filter((s) => s.kind === 'caller');
  // Latency per scripted caller turn: end of speech -> first final for that
  // turn, and end of speech -> first decision on a final of that turn.
  const latency = callerSegs.map((s) => {
    const f = rec.finals.find((x) => x.callerNo === s.callerNo && x.text);
    const d = rec.decisions.find((x) => x.callerNo === s.callerNo && !x.error);
    const df = rec.decisions.find((x) => x.callerNo === s.callerNo && !x.error && !x.speculative);
    const r = rec.replies.find((x) => x.callerNo === s.callerNo && x.reply);
    const lastF = rec.finals.filter((x) => x.callerNo === s.callerNo && x.text).pop();
    return {
      callerNo: s.callerNo,
      eosMs: Math.round(s.endMs),
      eosToFirstFinalMs: f ? Math.round(f.atMs - s.endMs) : null,
      eosToLastFinalMs: lastF ? Math.round(lastF.atMs - s.endMs) : null,
      eosToDecisionMs: d ? Math.round(d.atMs - s.endMs) : null,
      eosToFinalVerdictMs: df ? Math.round(df.atMs - s.endMs) : null,
      earlyBlock: Boolean(d?.speculative),
      eosToReplyMs: r ? Math.round(r.atMs - s.endMs) : null,
      judgeMs: d?.ms ?? null,
    };
  });
  const silence = silenceStats(timeline, rec.speech, { closedAtMs: rec.closedAtMs });
  // T1 vs Spark: every T1 hit next to the Spark verdict on the same turn.
  const t1VsSpark = (rec.t1 || []).filter((t) => t.rule).map((t) => {
    const sp = rec.decisions.find((d) => d.engine !== 't1' && d.callerNo === t.callerNo && !d.error);
    return { callerNo: t.callerNo, rule: t.rule, t1AtMs: t.atMs, sparkVerdict: sp?.verdict ?? null, sparkAtMs: sp?.atMs ?? null, agree: sp ? sp.verdict === 'SCAM' : null };
  });
  return { ...rec, asr, outcome, latency, silence, t1VsSpark, timelineMs: Math.round(timeline.totalMs), timeline: timeline.segments.map(({ kind, callerNo, startMs, endMs }) => ({ kind, callerNo, startMs: Math.round(startMs), endMs: Math.round(endMs) })) };
}

async function main() {
  const scen = JSON.parse(fs.readFileSync(path.join(V1, 'demo', 'scenarios.json'), 'utf8'));
  const sets = [];
  if (SET === 'th' || SET === 'all') sets.push(['th', scen.scenarios]);
  if (SET === 'en' || SET === 'all') sets.push(['en', scen.scenariosEn]);
  fs.mkdirSync(OUT, { recursive: true });
  const outFile = path.join(OUT, `meta-${CONDITION}${SPECULATE ? '-spec' : ''}${MERGE ? '-merge' : ''}${RX ? '-rx' : ''}${RX && SCAM_POLICY === 'trap' ? '-trap' : ''}${EARLY ? '-early' : ''}${TAG}.json`);
  const calls = [];
  for (const [lang, list] of sets) {
    for (const s of list) {
      if (ONLY && !ONLY.has(s.id) && !ONLY.has(`${s.id}-${lang}`)) continue;
      process.stdout.write(`${s.id}-${lang} (${CONDITION}) … `);
      try {
        const res = summarise(await runCall(s, lang));
        calls.push(res);
        const o = res.outcome;
        console.log(`silence=${(res.silence.maxMs / 1000).toFixed(1)}s talkover=${res.silence.talkOver} ${o.finalVerdict || '-'} correct=${o.correct} safe=${o.safeAction ? o.safeAction.kind + '@turn' + o.safeAction.callerNo : '-'} cer=${res.asr.map((a) => a.cer.toFixed(2)).join('/')} lat=${res.latency.map((l) => l.eosToDecisionMs).join('/')}ms $${res.costUsd.toFixed(4)}`);
      } catch (e) {
        console.log('FAILED', e.message);
        calls.push({ id: s.id, lang, expected: s.expected, condition: CONDITION, fatal: String(e.message) });
      }
      fs.writeFileSync(outFile, JSON.stringify({ engine: 'meta', base: BASE, condition: CONDITION, speculate: SPECULATE, merge: MERGE, git: GIT, verdictModel: VERDICT_MODEL, verdictEffort: VERDICT_EFFORT, disclosure: true, receptionist: RX, t1: T1, early: EARLY, scamPolicy: SCAM_POLICY, ranAt: new Date().toISOString(), calls }, null, 2));
    }
  }
  console.log('wrote', path.relative(ROOT, outFile));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
