// Real-use test helpers (B12): pure functions shared by the runners
// (scripts/realuse.mjs for the Meta build, scripts/realuse-v1.mjs for the
// frozen Google build) and app/test/realuse.test.mjs. No I/O here.

// ---- text: Thai-aware character error rate ----
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

// Compare what was said, not how it was punctuated: NFC, lower case, Thai
// digits -> ASCII, and drop everything that is not a letter or a digit
// (spaces carry no meaning in Thai script; ASR spacing is arbitrary).
export function normText(s) {
  return String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

export function levenshtein(a, b) {
  const x = [...a];
  const y = [...b];
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

// { edits, refLen, cer } over normalised text. cer = edits / reference length.
export function cer(reference, hypothesis) {
  const r = normText(reference);
  const h = normText(hypothesis);
  const edits = levenshtein(r, h);
  return { edits, refLen: [...r].length, cer: [...r].length ? edits / [...r].length : (h ? 1 : 0) };
}

// Micro-average over many turns: sum(edits) / sum(refLen).
export function pooledCer(items) {
  let e = 0;
  let n = 0;
  for (const it of items) {
    e += it.edits;
    n += it.refLen;
  }
  return n ? e / n : null;
}

export function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[idx];
}

// ---- call timeline (same for both builds) ----
// A call from scenarios.json is ai, caller, ai, caller, ai. The receptionist
// side is silence on the caller's line (the recorded AI line length), the
// caller side is the recorded caller audio. Returns segments with absolute
// offsets in ms from the start of streaming.
export function buildTimeline(scenario, { durationOf, tailMs = 4000, leadCapMs = Infinity, lang = 'th' } = {}) {
  const segs = [];
  let at = 0;
  let callerNo = 0;
  scenario.turns.forEach((t, i) => {
    if (t.role === 'caller') {
      const ms = durationOf(t);
      callerNo += 1;
      segs.push({ kind: 'caller', idx: i, callerNo, audio: t.audio, text: (lang === 'en' ? t.textEn : t.textTh) ?? t.text ?? '', startMs: at, endMs: at + ms });
      at += ms;
    } else {
      // The last AI line is replaced by a fixed tail: the call is over by then.
      const isLast = i === scenario.turns.length - 1;
      const ms = isLast ? tailMs : Math.min(Number(t.ms) || 0, i === 0 ? leadCapMs : Infinity);
      segs.push({ kind: 'silence', idx: i, startMs: at, endMs: at + ms });
      at += ms;
    }
  });
  return { segments: segs, totalMs: at };
}

// Which scripted caller turn does an event at time `ms` belong to? The
// latest caller segment that started at or before it (ASR finals arrive
// after the audio, sometimes during the following silence).
export function callerTurnAt(timeline, ms) {
  let hit = null;
  for (const s of timeline.segments) {
    if (s.kind === 'caller' && s.startMs <= ms) hit = s;
  }
  return hit;
}

// Group ASR finals by scripted caller turn: [{ callerNo, ref, hyp, finals:n, ...cer }].
export function alignFinals(timeline, finals) {
  const out = [];
  for (const s of timeline.segments.filter((x) => x.kind === 'caller')) {
    const mine = finals.filter((f) => callerTurnAt(timeline, f.atMs)?.callerNo === s.callerNo);
    const hyp = mine.map((f) => f.text).join(' ').trim();
    out.push({ callerNo: s.callerNo, ref: s.text, hyp, finals: mine.length, ...cer(s.text, hyp) });
  }
  return out;
}

// ---- outcome of one call ----
// expected: SCAM | LEGIT | UNSURE. decisions: [{ atMs, callerNo, verdict, action }]
// in arrival order. Safe action on a scam = first SCAM verdict (the page
// offers the trap and alerts) or a hang-up; on a legit call any SCAM/hang-up
// is a wrong hang-up.
// ended: { atMs, reason } when the engine itself closed the line (v1 takes a
// message and hangs up politely); a scam call closed before the demand turn
// finished is "protected" even without a SCAM verdict — but nobody is alerted.
export function callOutcome(expected, decisions, timeline, ended = null) {
  const isBlock = (d) => d.verdict === 'SCAM' || d.action === 'hangup';
  const first = decisions.find(isBlock) || null;
  const last = decisions[decisions.length - 1] || null;
  const callerSegs = timeline.segments.filter((x) => x.kind === 'caller');
  const lastCaller = callerSegs[callerSegs.length - 1];
  const out = {
    expected,
    finalVerdict: last?.verdict || null,
    finalAction: last?.action || null,
    safeAction: null,
    wrongHangup: false,
    beforeDemandEnds: null,
  };
  if (expected === 'SCAM') {
    if (first) {
      out.safeAction = {
        callerNo: first.callerNo,
        atMs: first.atMs,
        kind: first.action === 'hangup' ? 'hangup' : 'scam-verdict',
        // Scripts put the money/OTP demand in the last caller turn: a block
        // decided before that turn's audio ends stops the call mid-demand.
        msAfterDemandEnds: lastCaller ? first.atMs - lastCaller.endMs : null,
      };
      out.beforeDemandEnds = lastCaller ? first.atMs < lastCaller.endMs : null;
    }
  } else if (first) {
    out.wrongHangup = true;
  }
  out.correct = expected === 'SCAM' ? Boolean(first) : !first && (expected !== 'LEGIT' || last?.verdict !== 'SCAM');
  out.ended = ended && Number.isFinite(ended.atMs) ? { atMs: ended.atMs, reason: ended.reason || null } : null;
  const demandEnd = lastCaller ? lastCaller.endMs : Infinity;
  const blockAt = first ? first.atMs : Infinity;
  const endAt = out.ended && out.ended.atMs < demandEnd ? out.ended.atMs : Infinity;
  // Did the line stop the demand (blocked or closed) before it was finished?
  out.protectedBeforeDemandEnds = expected === 'SCAM' ? Math.min(blockAt, endAt) < demandEnd : null;
  out.flagged = expected === 'SCAM' ? Boolean(first) : null;
  return out;
}

// ---- WAV / PCM helpers ----
export function pcmFrames(buf, frameBytes) {
  const frames = [];
  for (let i = 0; i < buf.length; i += frameBytes) frames.push(buf.subarray(i, Math.min(buf.length, i + frameBytes)));
  return frames;
}

export function msOfPcm(bytes, rate) {
  return (bytes / 2 / rate) * 1000;
}

// ---- what the caller hears (G9) ----
// Browser th-TH voice at rate 0.85: ~110 ms per Thai character (measured on
// Microsoft Pattara, 39 chars -> 4.3 s), plus start-up.
export const ttsMs = (text) => 300 + [...String(text || '')].length * 110;

// Dead air per caller turn: from the end of the caller's speech until the
// caller hears us (first speech that starts after it) or speaks again,
// whichever is first. Turns after the call was closed are not counted.
// talkOver = caller turns that start while we are still speaking: in the
// browser demo the mic sends silence then, so those words are lost.
export function silenceStats(timeline, speech = [], { closedAtMs = null } = {}) {
  const callers = timeline.segments.filter((s) => s.kind === 'caller');
  const turns = [];
  let talkOver = 0;
  callers.forEach((seg, i) => {
    if (closedAtMs != null && seg.startMs > closedAtMs) return;
    const busy = speech.some((sp) => sp.atMs < seg.startMs && sp.atMs + sp.durMs > seg.startMs);
    if (busy) talkOver += 1;
    if (closedAtMs != null && closedAtMs < seg.endMs) return;
    const heard = speech.filter((sp) => sp.atMs >= seg.endMs).map((sp) => sp.atMs).sort((a, b) => a - b)[0];
    const next = callers[i + 1]?.startMs ?? timeline.totalMs;
    const until = Math.min(heard ?? Infinity, next);
    turns.push({ callerNo: seg.callerNo, silenceMs: Math.round(until - seg.endMs), answered: heard != null && heard <= next });
  });
  const vals = turns.map((t) => t.silenceMs);
  return { turns, maxMs: vals.length ? Math.max(...vals) : null, talkOver, unanswered: turns.filter((t) => !t.answered).length };
}
