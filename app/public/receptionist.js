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
// B27 caller language: the receptionist answers in the caller's language
// (Thai, English or Mandarin; any other language gets English with a one-line
// note). Decided in code from the script of the caller's own words
// (detectLang), once at least MIN_LANG_CHARS letters are heard, then sticky
// for the call. Until then the Thai lines are used. The owner's report stays
// Thai (report.js), with the caller's original quotes.
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

// B27: the same closed set of lines in English and Mandarin (same meaning,
// polite female receptionist). Every line passes guardReply and the trap
// guard (tested). 'disclosure' replaces stage 1 on the turn the caller's
// language is first known to be non-Thai: the opening disclosure was Thai.
export const DISCLOSURE_EN = 'An automated answering assistant is taking this call for the owner. This call is recorded. May I have your name and the reason for your call?';
export const RX_LINES_EN = {
  backchannel: ['Okay.', 'I see, okay.', 'Mm-hm, okay.'],
  askWho: ['May I have your name and where you are calling from?', 'Could I have your name and organisation, please?'],
  askCallback: ['Could I have an official number to call you back?', 'What is an official callback number, please?'],
  askPurpose: ['What is the call about, please?'],
  takeMessage: ['The owner is not available right now. I will pass on your message.'],
  ack: ['Okay, I have noted that.', 'Is there anything else you would like to add?'],
  trapFiller: ['Okay, just a moment please.', 'Just a moment, I am writing this down.', 'Okay, give me a moment to note that.'],
  closeScam: ['Thank you. The owner will check this through official channels. Goodbye.'],
  closeLegit: ['Thank you. I will let the owner know. Goodbye.'],
  closeUrgent: ['Understood, this is urgent. I will tell the owner right away.'],
  disclosure: [DISCLOSURE_EN],
  // any other language: English, with a one-line note first
  disclosureOther: [`Sorry, I can only speak English, Thai or Chinese. ${DISCLOSURE_EN}`],
};
export const RX_LINES_ZH = {
  backchannel: ['好的。', '嗯，好的。', '嗯，明白。'],
  askWho: ['请问您贵姓，是哪个单位的？', '请问您的姓名和单位？'],
  askCallback: ['请留一个官方的回拨电话。', '请问有官方的联系电话吗？'],
  askPurpose: ['请问您有什么事？'],
  takeMessage: ['机主现在不方便接听，我会帮您转达。'],
  ack: ['好的，已经记下来了。', '还有什么需要转达的吗？'],
  trapFiller: ['好的，请稍等。', '稍等，我正在记录。', '好的，让我记下来。'],
  closeScam: ['谢谢。这件事机主会通过官方渠道自己核实。先这样，再见。'],
  closeLegit: ['谢谢，我会转告机主。再见。'],
  closeUrgent: ['明白了，这是急事，我会马上通知机主。'],
  disclosure: ['您好，这是自动接听助理，代机主接听电话，本通话会被录音。请问您贵姓，有什么事？'],
};
export const RX_LINES_BY_LANG = { th: RX_LINES, en: RX_LINES_EN, zh: RX_LINES_ZH };
export const RX_LANGS = ['th', 'en', 'zh'];

// Script of the caller's words -> 'th' | 'en' | 'zh' | 'other' | null (too
// little to tell). Exact character classes, no model: Thai script -> th,
// Han without kana -> zh, Latin -> en; kana, Hangul, Devanagari and
// Vietnamese letters -> other (answered in English with the note).
// Code-switching goes to the majority script (Han counts double: one
// character carries about a word). Sound cues in [brackets] are ignored.
export const MIN_LANG_CHARS = 4;
const VI_LETTERS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi;
export function detectLang(text) {
  const t = String(text || '').replace(/\[[^\]]*\]/g, ' ');
  const n = (re) => (t.match(re) || []).length;
  const thai = n(/[\u0E01-\u0E5B]/g);
  const kana = n(/[\u3040-\u30FF]/g);
  const han = n(/[\u3400-\u4DBF\u4E00-\u9FFF]/g);
  const hangul = n(/[\uAC00-\uD7AF\u1100-\u11FF]/g);
  const deva = n(/[\u0900-\u097F]/g);
  const latin = n(/[A-Za-z]/g);
  const vi = n(VI_LETTERS);
  const score = { th: thai, zh: kana ? 0 : 2 * han, en: latin + vi, other: 2 * (kana + hangul + deva + (kana ? han : 0)) };
  const [best, v] = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (v < MIN_LANG_CHARS) return null;
  if (best === 'en' && vi >= 2) return 'other';
  return best;
}

// Sets state.lang once (sticky). Returns true when this call decided a
// non-Thai language (stage 1 then repeats the disclosure in it).
export function noteCallerText(state, text) {
  if (state.lang || text == null) return false;
  const l = detectLang(text);
  if (!l) return false;
  state.lang = l === 'other' ? 'en' : l;
  state.langOther = l === 'other';
  state.langNew = state.lang !== 'th';
  return state.langNew;
}

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
    lang: null, // B27: 'th' | 'en' | 'zh' once decided from the caller's words (sticky)
    langOther: false, // the caller's language is none of the three: English + a note
    langNew: false, // decided this turn and not yet announced with the disclosure
    used: {}, // kind -> times used (rotation)
    lastLine: null,
    // A question line handed to the speaker but not finished yet. A close or
    // a trap decided meanwhile (T1 hard demand, SCAM verdict) cancels it, so a
    // hard demand goes straight to the closing line (see cancelAsk below).
    pendingAsk: null,
  };
}


function pick(state, kind) {
  const list = (RX_LINES_BY_LANG[state.lang] || RX_LINES)[kind] || RX_LINES[kind];
  const n = state.used[kind] || 0;
  let line = list[n % list.length];
  if (line === state.lastLine && list.length > 1) line = list[(n + 1) % list.length];
  state.used[kind] = n + 1;
  state.lastLine = line;
  return line;
}

// Stage 1: the instant answer to a finished caller turn. text (optional):
// what the caller just said, used only to decide the reply language.
// Returns { kind, line, turn } or null when the call is already closed.
export function onCallerTurn(state, text = null) {
  if (state.closed) return null;
  state.callerTurns += 1;
  const turn = state.callerTurns;
  noteCallerText(state, text);
  const announce = state.langNew;
  state.langNew = false;
  if (state.trap) return { kind: 'trapFiller', line: pick(state, 'trapFiller'), turn };
  if (announce) {
    // the opening disclosure was Thai: say it again in the caller's language
    state.asked.askWho = true; // it asks for the name and the reason
    return { kind: 'disclosure', line: pick(state, state.langOther ? 'disclosureOther' : 'disclosure'), turn };
  }
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
export function stageOne(state, t1Rule, text = null) {
  // decide the language first, so a T1 close is already in the caller's language
  noteCallerText(state, text);
  const t1Step = t1Rule && !state.t1 ? onT1(state, t1Rule) : null;
  return { t1Step, reply: onCallerTurn(state, text) };
}
