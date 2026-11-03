// Receptionist turn-taking (G9): the caller never talks into dead air.
// After every caller turn the receptionist answers at once with a canned line
// chosen by code from the call state. No model call means no wait. When the
// verdict lands (Spark, a few seconds later), code picks the next step: a
// polite close on SCAM (or the trap, if the family chose it), a take-message
// close on a LEGIT call that is done, otherwise carry on.
// Every line passes policy.guardReply and the stricter trap guard (tested).
// Speech output is the browser's speechSynthesis (th-TH): Meta's API has no
// text-to-speech, so the voice is the visitor's OS voice, not a Meta model.
// Pure module, no I/O. Vendored byte-identical to public/receptionist.js.

export const RX_LINES = {
  // turn 1: who is calling and from where
  askWho: [
    'ขอบคุณค่ะ รบกวนแจ้งชื่อและหน่วยงานที่ติดต่อมาด้วยค่ะ',
    'ค่ะ ขอทราบชื่อและโทรมาจากที่ไหนด้วยนะคะ',
  ],
  // turn 2: an official number the owner can call back
  askCallback: [
    'รับทราบค่ะ ขอเบอร์ติดต่อกลับที่เป็นเบอร์ทางการของหน่วยงานด้วยนะคะ',
    'ค่ะ รบกวนขอช่องทางติดต่อกลับที่เป็นทางการด้วยนะคะ',
  ],
  // turn 3: owner is not available, a message will be passed on
  takeMessage: [
    'ตอนนี้เจ้าของเบอร์ไม่สะดวกรับสาย จะจดเรื่องไว้แจ้งให้นะคะ มีอะไรจะฝากเพิ่มไหมคะ',
  ],
  // turn 4+: short acknowledgements, rotated
  ack: [
    'รับทราบค่ะ จดไว้แล้วนะคะ',
    'ค่ะ มีอะไรจะฝากเพิ่มอีกไหมคะ',
    'ค่ะ ขอทวนว่าต้องการให้เจ้าของเบอร์ทำอะไรคะ',
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
};

export const SCAM_POLICIES = ['close', 'trap'];

export function newCallState({ scamPolicy = 'close' } = {}) {
  return {
    callerTurns: 0,
    closed: false,
    trap: false,
    scamPolicy: SCAM_POLICIES.includes(scamPolicy) ? scamPolicy : 'close',
    used: {}, // kind -> times used (rotation)
    lastLine: null,
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

// The instant answer to a finished caller turn.
// Returns { kind, line } or null when the call is already closed.
export function onCallerTurn(state) {
  if (state.closed) return null;
  state.callerTurns += 1;
  if (state.trap) return { kind: 'trapFiller', line: pick(state, 'trapFiller') };
  const kind = state.callerTurns === 1 ? 'askWho'
    : state.callerTurns === 2 ? 'askCallback'
      : state.callerTurns === 3 ? 'takeMessage'
        : 'ack';
  return { kind, line: pick(state, kind) };
}

// The step after a verdict. verdict: SCAM | LEGIT | UNSURE; action from
// policy.nextAction ('hangup' | 'take-message' | 'continue').
// Returns { step: 'close'|'trap'|'continue', line|null, endedBy? }.
export function onVerdict(state, { verdict, action } = {}) {
  if (state.closed) return { step: 'none', line: null };
  if (verdict === 'SCAM' || action === 'hangup') {
    if (state.trap) return { step: 'continue', line: null };
    if (state.scamPolicy === 'trap') {
      state.trap = true;
      return { step: 'trap', line: null };
    }
    state.closed = true;
    return { step: 'close', line: pick(state, 'closeScam'), endedBy: 'hangup' };
  }
  if (action === 'take-message' && !state.trap) {
    state.closed = true;
    return { step: 'close', line: pick(state, 'closeLegit'), endedBy: 'hangup' };
  }
  return { step: 'continue', line: null };
}
