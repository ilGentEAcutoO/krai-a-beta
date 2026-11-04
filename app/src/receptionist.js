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
    'ขอทราบธุระที่โทรมาด้วยค่ะ',
  ],
  // Conversation flow (Nov 4): every AI turn ends on a question or a closing
  // line. Once who / callback / purpose are settled, these keep the caller
  // talking (a slow burn makes its ask here) until the policy closes the call.
  askMessage: [
    'จะฝากเรื่องอะไรไว้ไหมคะ',
  ],
  askMore: [
    'มีอะไรฝากเพิ่มไหมคะ',
    'จดไว้แล้วค่ะ มีอะไรเพิ่มเติมอีกไหมคะ',
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
  // Closes (user rule, Nov 4): one short line that we pass the matter on,
  // then hang up. Never "the owner is not available / busy"; the scam close
  // adds nothing else and promises no callback.
  closeScam: [
    'รับทราบค่ะ จะส่งเรื่องต่อให้นะคะ สวัสดีค่ะ',
  ],
  closeLegit: [
    'รับทราบค่ะ เดี๋ยวจะฝากเรื่องนี้ไว้ให้นะคะ ขอบคุณค่ะ สวัสดีค่ะ',
  ],
  // B25: a reported emergency. Honest: the owner gets the message and the
  // case report; nothing calls anyone automatically.
  closeUrgent: [
    'รับทราบค่ะ เป็นเรื่องด่วน จะรีบส่งเรื่องให้ทันทีนะคะ สวัสดีค่ะ',
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
  askPurpose: ['What is the call about, please?', 'Could you tell me the reason for your call?'],
  askMessage: ['Would you like to leave a message?'],
  askMore: ['Is there anything else you would like to add?', 'I have noted that. Anything else?'],
  takeMessage: ['The owner is not available right now. I will pass on your message.'],
  ack: ['Okay, I have noted that.', 'Is there anything else you would like to add?'],
  trapFiller: ['Okay, just a moment please.', 'Just a moment, I am writing this down.', 'Okay, give me a moment to note that.'],
  closeScam: ["I'll pass this on. Goodbye."],
  closeLegit: ["Got it, I'll pass this on. Thank you, goodbye."],
  closeUrgent: ["Understood, this is urgent. I'll pass this on right away. Goodbye."],
  disclosure: [DISCLOSURE_EN],
  // any other language: English, with a one-line note first
  // short (<= 6 s) but still the full disclosure: automated + recorded (G3)
  disclosureOther: ['This is an automated assistant and the call is recorded. I can only speak English, Thai or Chinese. Who is calling, please?'],
};
export const RX_LINES_ZH = {
  backchannel: ['好的。', '嗯，好的。', '嗯，明白。'],
  askWho: ['请问您贵姓，是哪个单位的？', '请问您的姓名和单位？'],
  askCallback: ['请留一个官方的回拨电话。', '请问有官方的联系电话吗？'],
  askPurpose: ['请问您有什么事？', '请问您打电话来是为了什么事情？'],
  askMessage: ['您要留言吗？'],
  askMore: ['还有什么需要转达的吗？', '好的，记下了。还有别的吗？'],
  takeMessage: ['机主现在不方便接听，我会帮您转达。'],
  ack: ['好的，已经记下来了。', '还有什么需要转达的吗？'],
  trapFiller: ['好的，请稍等。', '稍等，我正在记录。', '好的，让我记下来。'],
  closeScam: ['我会转达的。再见。'],
  closeLegit: ['好的，我会帮您转达。谢谢，再见。'],
  closeUrgent: ['明白了，这是急事，我会马上转达。再见。'],
  disclosure: ['您好，这是自动接听助理，代机主接听电话，本通话会被录音。请问您贵姓，有什么事？'],
};
export const RX_LINES_BY_LANG = { th: RX_LINES, en: RX_LINES_EN, zh: RX_LINES_ZH };
export const RX_LANGS = ['th', 'en', 'zh'];

// Script of the caller's words -> 'th' | 'en' | 'zh' | 'other' | null (too
// little to tell). Exact character classes, no model: Thai script -> th,
// Han without kana -> zh, Latin -> en; kana, Hangul, Devanagari and
// Vietnamese letters -> other (answered in English with the note).
// Any Thai script (2+ letters) means Thai, then any Han means Mandarin, so a
// Thai or Chinese caller saying English brand words, ids or numbers keeps
// their language; otherwise the majority script decides. Sound cues in
// [brackets] are ignored.
export const MIN_LANG_CHARS = 4;
export const MIN_EN_LETTERS = 14;
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
  // Thai script wins outright: Thai callers mix in English brand names,
  // LINE ids and numbers, and must never be switched to English (B27 gate).
  if (thai >= 2) return 'th';
  // Han likewise beats Latin words inside Mandarin speech.
  if (han >= 2 && !kana && !hangul) return 'zh';
  const score = { th: thai, zh: kana ? 0 : 2 * han, en: latin + vi, other: 2 * (kana + hangul + deva + (kana ? han : 0)) };
  const [best, v] = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (v < MIN_LANG_CHARS) return null;
  // English needs a few words: a Thai caller's "Hello, hello?" (often
  // transcribed in Latin letters) must not lock the call into English.
  if (best === 'en' && latin + vi < MIN_EN_LETTERS) return null;
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
// Question planner (conversation flow, Nov 4). Three slots, each asked at
// most MAX_ASKS times (the second ask is the rephrased line); a slot Spark
// says is given is never asked again. The opening disclosure already asks
// for the name and the reason, so those count as asked once. Slots never
// asked come before rephrases. Once the slots are settled the receptionist
// offers to take a message, then asks "anything else?" (each line at most
// MAX_ASKS times), so every AI turn ends on one question or a closing line.
export const MAX_ASKS = 2;
const SLOT_ORDER = ['askWho', 'askCallback', 'askPurpose'];
const KNOWN_KEY = { askWho: 'identity', askCallback: 'callback', askPurpose: 'purpose' };
// policy.T.unsureMaxTurns: from this caller turn every non-scam call is closed
// by the policy (take-message), so stage 1 never asks early there: a question
// followed at once by a goodbye is the "close after an unanswered question".
export const CLOSE_BY_TURN = 4;
// A phone-number-shaped run in the caller's words (6+ digits, Thai digits or
// spoken digit words count): the callback slot was just answered, so the
// early question (asked before this turn's verdict) does not ask it again.
const DIGITS = /\d(?:[\s-]?\d){5,}/;
const DIGIT_WORDS = /(?:(?:ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|zero|oh|one|two|three|four|five|six|seven|eight|nine|[零〇一二两三四五六七八九幺])[\s,，、-]*){6,}/i;
// A message, not a question: >= 6 words (or >= 20 Thai letters / >= 10 Han
// characters, written without spaces) and no question ending.
const QUESTION_END = /([?？]|ไหม|มั้ย|หรือเปล่า|หรือยัง|吗|呢)\s*[.。!！]*\s*$/;
export function messageLike(text) {
  const t = String(text || '').trim();
  if (!t || QUESTION_END.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean).length;
  const thai = (t.match(/[ก-๛]/g) || []).length;
  const han = (t.match(/[㐀-鿿]/g) || []).length;
  return words >= 6 || thai >= 20 || han >= 10;
}
// Cheap code checks on the caller's own words: a number means the callback is
// given; a message-like line after we offered to take a message (or once the
// purpose is known) means the message is given, so neither is asked again.
export function noteAnswers(state, text) {
  if (text == null) return;
  if (saysNumber(text)) state.known.callback = true;
  const offered = state.lastAsk && ['askMessage', 'askMore'].includes(state.lastAsk.kind);
  if (messageLike(text) && (offered || state.known.purpose)) state.asked.askMessage = Math.max(state.asked.askMessage || 0, 1);
}

export function saysNumber(text) {
  const t = String(text || '').replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
  return DIGITS.test(t) || DIGIT_WORDS.test(t);
}

// early (hybrid, default on): from turn 2 on, when earlier verdicts already
// say what is missing, ask it at once instead of a backchannel, and skip
// stage 2 for that turn unless its verdict changes the action (close/trap).
// Turn 1 stays two-stage. Measured: first real reply 1.1 s p50 vs 3.6 s.
// The early question never re-asks the slot the caller is answering right
// now (the previous question): that waits for this turn's verdict.
export function newCallState({ scamPolicy = 'close', early = true } = {}) {
  return {
    early: Boolean(early),
    callerTurns: 0,
    closed: false,
    trap: false,
    scamPolicy: SCAM_POLICIES.includes(scamPolicy) ? scamPolicy : 'close',
    t1: null, // T1 code rule that fired (otp | app | transfer-now | secrecy-transfer)
    t1Overruled: false,
    // question kind -> times asked; the opening disclosure asked who + why
    asked: { askWho: 1, askPurpose: 1 },
    followed: {}, // caller turn no -> stage 2 done (or dropped)
    known: { identity: false, callback: false, purpose: false },
    urgent: false, // B25: Spark reported an emergency (accident, hospital, missing person, fire)
    verdicts: 0, // Spark verdicts seen (facts are only known after one)
    lang: null, // B27: 'th' | 'en' | 'zh' once decided from the caller's words (sticky)
    langOther: false, // the caller's language is none of the three: English + a note
    langNew: false, // decided this turn and not yet announced with the disclosure
    used: {}, // kind -> times used (rotation)
    lastLine: null,
    lastAsk: null, // { kind, turn }: the last question asked, after caller turn `turn`
    // A non-scam close decided right after we asked a question: the caller
    // gets to answer first, the close comes after their next turn.
    closeDue: null,
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
  // Never one step behind: what THIS caller line already answers is known
  // before any question for it is picked (stage 1 early, stage 2, fallback).
  noteAnswers(state, text);
  if (announce) {
    // the opening disclosure was Thai: say it again in the caller's language.
    // It asks for the name and the reason, and it is this turn's one question:
    // stage 2 adds no second question (it can still close or start the trap).
    state.asked.askWho = Math.max(state.asked.askWho || 0, 1);
    state.asked.askPurpose = Math.max(state.asked.askPurpose || 0, 1);
    state.followed[turn] = 'disclosure';
    state.lastAsk = { kind: 'disclosure', turn };
    return { kind: 'disclosure', line: pick(state, state.langOther ? 'disclosureOther' : 'disclosure'), turn };
  }
  if (state.early && turn > 1 && turn < CLOSE_BY_TURN && state.verdicts > 0 && !state.closeDue) {
    const skip = [];
    if (state.lastAsk && state.lastAsk.turn === turn - 1) skip.push(state.lastAsk.kind);
    if (saysNumber(text)) skip.push('askCallback');
    const kind = nextQuestion(state, { skip });
    if (kind) {
      state.followed[turn] = 'early';
      const line = pick(state, kind);
      state.pendingAsk = { kind, line, turn };
      state.lastAsk = { kind, turn };
      return { kind, line, turn };
    }
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

// The next question kind, or null when every line is used up. skip: kinds
// not to ask now (the slot the caller is answering this very turn).
export function nextQuestion(state, { skip = [] } = {}) {
  const asked = (k) => state.asked[k] || 0;
  const open = SLOT_ORDER.filter((k) => !state.known[KNOWN_KEY[k]] && asked(k) < MAX_ASKS && !skip.includes(k));
  // a slot never asked comes before a rephrase of one the caller dodged
  const kind = open.find((k) => asked(k) === 0) || open[0]
    // "anything else?" is asked once (never twice in a row); after its answer
    // nothing more is asked and the policy's take-message closes the call
    || ['askMessage', 'askMore'].find((k) => asked(k) < 1 && !skip.includes(k))
    || null;
  if (kind) state.asked[kind] = asked(kind) + 1;
  return kind;
}

// Ask `kind` now (stage 2 or the fallback).
function ask(state, kind, turn) {
  const line = pick(state, kind);
  state.pendingAsk = { kind, line, turn };
  state.lastAsk = { kind, turn };
  return { step: 'ask', kind, line };
}

// The polite non-scam close: message taken (or the urgent line).
function closeMessage(state) {
  state.closed = true;
  state.closeDue = null;
  const kind = state.urgent ? 'closeUrgent' : 'closeLegit';
  return { step: 'close', kind, line: pick(state, kind), endedBy: 'hangup', urgent: state.urgent, ...takeCancel(state) };
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
  // SCAM: immediate, even right after our own question (never extended to be polite).
  if (verdict === 'SCAM' || action === 'hangup') {
    if (state.trap) return { step: 'continue', line: null };
    if (state.scamPolicy === 'trap') {
      state.trap = true;
      return { step: 'trap', line: null, ...takeCancel(state) };
    }
    state.closed = true;
    state.closeDue = null;
    return { step: 'close', kind: 'closeScam', line: pick(state, 'closeScam'), endedBy: 'hangup', ...takeCancel(state) };
  }
  const fromVerdict = Boolean(signals || tactic);
  if (state.trap) return followUp(state, { turn, callerTalking, fromVerdict });
  // A close already due (decided after our last question): the caller has
  // answered now, so the call closes after this turn.
  if (state.closeDue && turn != null && turn > state.closeDue.turn) return closeMessage(state);
  // Never close a non-scam call before its purpose is heard (arena B19: a
  // slow-burn scammer asks for nothing until turn 4-5; closing early hands
  // the owner a message with the scammer's callback number). Keep asking
  // instead, up to PURPOSE_MAX_TURNS caller turns.
  if (action === 'take-message' && !state.known.purpose && state.callerTurns < PURPOSE_MAX_TURNS) {
    return followUp(state, { turn, callerTalking, fromVerdict });
  }
  if (action === 'take-message') {
    // We asked a question after this caller turn (early, or stage 2 already):
    // never say goodbye on top of it. The caller answers first; the close
    // follows their next turn (or the end of the call).
    const at = turn ?? state.callerTurns;
    if (state.lastAsk && state.lastAsk.turn === at && state.lastAsk.kind !== 'disclosure') {
      state.closeDue = { turn: at };
      return { step: 'continue', line: null, closeDue: true };
    }
    return closeMessage(state);
  }
  return followUp(state, { turn, callerTalking, fromVerdict });
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
  if (state.closeDue) return turn > state.closeDue.turn ? closeMessage(state) : { step: 'continue', line: null };
  const kind = nextQuestion(state);
  if (!kind) return { step: 'continue', line: null };
  return ask(state, kind, turn);
}

// The recording (or the caller) ran out while the call is still open and
// not in the trap: the polite closing line that fits the call so far.
// Returns { step: 'close', kind, line, endedBy } or null.
export function endOfCall(state) {
  if (state.closed || state.trap) return null;
  return closeMessage(state);
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
