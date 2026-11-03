// Receptionist turn-taking (G9 + two-stage reply): the caller never talks
// into dead air, and the follow-up question fits what the caller said.
// Stage 1, at once (no model): a short neutral backchannel ("ค่ะ รับทราบค่ะ").
// Stage 2, when Spark's verdict for THAT turn lands (~3.5 s): code picks the
// follow-up from Spark's structured output. SCAM gets a polite close (or the
// trap), a finished LEGIT call gets a take-message close. Otherwise it asks
// only for what the caller has not given yet: who and from where, then an
// official callback number, then the purpose, then it takes a message. It is
// still a closed set of guarded canned lines, never free text. Stage 2 is
// dropped if the caller is already speaking again. If no verdict comes within
// a few seconds, a fallback picks the next unasked question.
// Every line passes policy.guardReply and the stricter trap guard (tested).
// Speech output: Meta's API has no text-to-speech, so these fixed lines are
// pre-generated with Gemini TTS (public/audio, scripts/tts-pregen.mjs), with
// the browser's speechSynthesis as the fallback. Voice output only.
// Pure module, no I/O. Vendored byte-identical to public/receptionist.js.

export const RX_LINES = {
  // stage 1: fits anything the caller said
  backchannel: [
    'ค่ะ',
    'ค่ะ รับทราบค่ะ',
    'อ๋อ ค่ะ',
  ],
  // Follow-ups are short (~2 s spoken): a long line runs into the caller's
  // next turn, and the browser demo is half-duplex (measured, B12).
  askWho: [
    'ขอทราบชื่อและหน่วยงานด้วยค่ะ',
    'ขอชื่อและที่ที่โทรมาด้วยค่ะ',
  ],
  askCallback: [
    'ขอเบอร์ทางการไว้ติดต่อกลับด้วยค่ะ',
    'ขอช่องทางติดต่อกลับทางการด้วยค่ะ',
  ],
  askPurpose: [
    'ติดต่อมาเรื่องอะไรคะ',
  ],
  takeMessage: [
    'เจ้าของเบอร์ไม่สะดวกค่ะ จะฝากเรื่องไว้ให้นะคะ',
  ],
  ack: [
    'รับทราบค่ะ จดไว้แล้วค่ะ',
    'มีอะไรฝากเพิ่มไหมคะ',
  ],
  // trap mode: instant filler while the trap line is being written
  trapFiller: [
    'ค่ะ สักครู่นะคะ',
    'เดี๋ยวนะคะ กำลังจดอยู่ค่ะ',
    'ค่ะ ขอเวลาจดสักครู่นะคะ',
  ],
  closeScam: [
    'ขอบคุณค่ะ เรื่องนี้เจ้าของเบอร์จะตรวจสอบเองผ่านช่องทางทางการ แค่นี้ก่อนนะคะ สวัสดีค่ะ',
  ],
  closeLegit: [
    'ขอบคุณค่ะ จะแจ้งเจ้าของเบอร์ให้ทราบนะคะ สวัสดีค่ะ',
  ],
  // B25: a reported emergency. Honest: the owner gets the message and the
  // case report; nothing calls anyone automatically.
  closeUrgent: [
    'รับทราบค่ะ เป็นเรื่องด่วน จะรีบแจ้งเจ้าของเบอร์ให้ทราบทันทีค่ะ',
  ],
};

export const SCAM_POLICIES = ['close', 'trap'];
// A non-scam call is not closed before its purpose is heard, unless the
// caller has had this many turns (then the message is taken as it stands).
export const PURPOSE_MAX_TURNS = 5;
// What counts as "already given", read from Spark's signals (0..1).
export const GIVEN = { identity: 0.6, callback: 0.6, emergency: 0.6 };
// Stage-2 fallback when no verdict arrives (ms after the caller's turn).
export const FOLLOW_UP_FALLBACK_MS = 5000;
const QUESTION_ORDER = ['askWho', 'askCallback', 'askPurpose', 'takeMessage'];

// early (hybrid, default on): from turn 2 on, when earlier verdicts already
// say what is missing, ask it at once instead of a backchannel, and skip
// stage 2 for that turn unless its verdict changes the action (close/trap).
// Turn 1 stays two-stage. Measured: first real reply 1.1 s p50 vs 3.6 s.
export function newCallState({ scamPolicy = 'close', early = true } = {}) {
  return {
    early: Boolean(early),
    callerTurns: 0,
    closed: false,
    trap: false,
    scamPolicy: SCAM_POLICIES.includes(scamPolicy) ? scamPolicy : 'close',
    t1: null, // T1 code rule that fired (otp | app | transfer-now | secrecy-transfer)
    t1Overruled: false,
    asked: {}, // question kind -> true once asked
    followed: {}, // caller turn no -> stage 2 done (or dropped)
    known: { identity: false, callback: false, purpose: false },
    urgent: false, // B25: Spark reported an emergency (accident, hospital, missing person, fire)
    verdicts: 0, // Spark verdicts seen (facts are only known after one)
    used: {}, // kind -> times used (rotation)
    lastLine: null,
    // A question line handed to the speaker but not finished yet. A close or
    // a trap decided meanwhile (T1 hard demand, SCAM verdict) cancels it, so a
    // hard demand goes straight to the closing line (see cancelAsk below).
    pendingAsk: null,
  };
}


function pick(state, kind) {
  const list = RX_LINES[kind];
  const n = state.used[kind] || 0;
  let line = list[n % list.length];
  if (line === state.lastLine && list.length > 1) line = list[(n + 1) % list.length];
  state.used[kind] = n + 1;
  state.lastLine = line;
  return line;
}

// Stage 1: the instant answer to a finished caller turn.
// Returns { kind, line, turn } or null when the call is already closed.
export function onCallerTurn(state) {
  if (state.closed) return null;
  state.callerTurns += 1;
  const turn = state.callerTurns;
  if (state.trap) return { kind: 'trapFiller', line: pick(state, 'trapFiller'), turn };
  if (state.early && turn > 1 && state.verdicts > 0) {
    state.followed[turn] = 'early';
    const kind = nextQuestion(state);
    const line = pick(state, kind);
    state.pendingAsk = { kind, line, turn };
    return { kind, line, turn };
  }
  return { kind: 'backchannel', line: pick(state, 'backchannel'), turn };
}

// The page reports that a question line finished playing (or was never
// played). Only an unfinished one can still be cancelled.
export function askDone(state, line) {
  if (state.pendingAsk && (line == null || state.pendingAsk.line === line)) state.pendingAsk = null;
}

// Close / trap decided: hand back the unfinished question to cancel, if any.
function takeCancel(state) {
  const c = state.pendingAsk;
  state.pendingAsk = null;
  return c ? { cancelAsk: c } : {};
}

// Facts from Spark's structured output; once known, they stay known.
export function learn(state, { signals, tactic } = {}) {
  const s = signals || {};
  // 'other' is Spark's "no corpus category fits": that is not a stated
  // purpose (arena B19: slow-burn callers named only a company, the purpose
  // counted as heard, and the call closed before the caller's ask).
  const named = typeof tactic === 'string' && tactic.trim() && !['none', 'other'].includes(tactic);
  if ((Number(s.authority) || 0) >= GIVEN.identity || named) state.known.identity = true;
  if ((Number(s.callbackGiven) || 0) >= GIVEN.callback) state.known.callback = true;
  if (named) state.known.purpose = true;
  if ((Number(s.emergency) || 0) >= GIVEN.emergency) {
    state.urgent = true;
    state.known.purpose = true; // an emergency is a purpose
  }
}

function nextQuestion(state) {
  const need = { askWho: !state.known.identity, askCallback: !state.known.callback, askPurpose: !state.known.purpose, takeMessage: true };
  const kind = QUESTION_ORDER.find((k) => need[k] && !state.asked[k]) || 'ack';
  if (kind !== 'ack') state.asked[kind] = true;
  return kind;
}

// The step after a verdict for caller turn `turn`. verdict: SCAM | LEGIT |
// UNSURE; action from policy.nextAction; signals/tactic from Spark (omit for
// Wonder: it can only close, never ask). callerTalking: the caller has
// started a new turn, so stage 2 is dropped.
// Returns { step: 'close'|'trap'|'ask'|'continue'|'none', line, kind?, endedBy? }.
export function onVerdict(state, { verdict, action, signals, tactic, turn, callerTalking = false } = {}) {
  // A T1 close is never undone; a Spark verdict that disagrees is only logged.
  if (state.t1 && verdict && verdict !== 'SCAM') state.t1Overruled = true;
  if (state.closed) return { step: 'none', line: null };
  if (signals || tactic) {
    learn(state, { signals, tactic });
    state.verdicts += 1;
  }
  if (verdict === 'SCAM' || action === 'hangup') {
    if (state.trap) return { step: 'continue', line: null };
    if (state.scamPolicy === 'trap') {
      state.trap = true;
      return { step: 'trap', line: null, ...takeCancel(state) };
    }
    state.closed = true;
    return { step: 'close', line: pick(state, 'closeScam'), endedBy: 'hangup', ...takeCancel(state) };
  }
  // Never close a non-scam call before its purpose is heard (arena B19: a
  // slow-burn scammer asks for nothing until turn 4-5; closing early hands
  // the owner a message with the scammer's callback number). Keep asking
  // instead, up to PURPOSE_MAX_TURNS caller turns.
  if (action === 'take-message' && !state.trap && !state.known.purpose && state.callerTurns < PURPOSE_MAX_TURNS) {
    return followUp(state, { turn, callerTalking, fromVerdict: Boolean(signals || tactic) });
  }
  if (action === 'take-message' && !state.trap) {
    state.closed = true;
    return { step: 'close', line: pick(state, state.urgent ? 'closeUrgent' : 'closeLegit'), endedBy: 'hangup', urgent: state.urgent, ...takeCancel(state) };
  }
  return followUp(state, { turn, callerTalking, fromVerdict: Boolean(signals || tactic) });
}

// Stage 2 for one caller turn, at most once; also the no-verdict fallback.
export function followUp(state, { turn, callerTalking = false, fromVerdict = false } = {}) {
  if (state.closed || state.trap || turn == null) return { step: 'continue', line: null };
  if (turn !== state.callerTurns || state.followed[turn]) return { step: 'continue', line: null }; // stale or done
  state.followed[turn] = fromVerdict ? 'verdict' : 'fallback';
  if (callerTalking) {
    state.followed[turn] = 'dropped';
    return { step: 'continue', line: null, dropped: true };
  }
  const kind = nextQuestion(state);
  const line = pick(state, kind);
  state.pendingAsk = { kind, line, turn };
  return { step: 'ask', kind, line };
}

// T1 (policy.t1Demand via POST /api/verdict/t1): an explicit hard demand —
// OTP, app install, transfer now — found by code rules, no model. The
// receptionist acts at once, like a SCAM verdict; Spark's verdict still
// decides what is recorded for the call.
export function onT1(state, rule) {
  if (!rule || state.t1) return { step: 'none', line: null };
  state.t1 = rule;
  return onVerdict(state, { verdict: 'SCAM', action: 'hangup' });
}

// Stage 1 with the T1 result in hand (the page waits up to T1_WAIT_MS for
// POST /api/verdict/t1 before speaking). A T1 hit acts first: close, or the
// trap. So a hard demand is never answered with a question (live bug found
// on 7500187c: "ask for a callback number" played before the close).
// Returns { t1Step, reply }: t1Step from onT1 (or null), reply from
// onCallerTurn (null once the call is closed).
export const T1_WAIT_MS = 400;
export function stageOne(state, t1Rule) {
  const t1Step = t1Rule && !state.t1 ? onT1(state, t1Rule) : null;
  return { t1Step, reply: onCallerTurn(state) };
}
