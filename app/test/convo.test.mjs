// Conversation flow (Nov 4): no repeated questions, one question per AI
// turn, the caller answers before the next question, closes that fit the
// reason and the call language, and never a goodbye on top of our own question.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSE_BY_TURN, MAX_ASKS, RX_LINES, RX_LINES_BY_LANG, endOfCall, followUp, newCallState, onCallerTurn, onVerdict, saysNumber, stageOne,
} from '../src/receptionist.js';
import { T } from '../src/policy.js';

const QUESTIONS = ['askWho', 'askCallback', 'askPurpose', 'askMessage', 'askMore', 'disclosure'];
const isQuestion = (kind) => QUESTIONS.includes(kind);

// One caller turn the way voice-client.js runs it: stage 1, the verdict, then
// the 5 s fallback (which must add nothing once the verdict answered).
function turn(s, { text = null, verdict = 'UNSURE', action = 'continue', signals = {}, tactic = 'none' } = {}) {
  const { reply } = stageOne(s, null, text);
  const lines = [];
  if (reply) lines.push(reply);
  const v = onVerdict(s, { verdict, action, signals, tactic, turn: reply?.turn ?? null });
  if (v.line) lines.push(v);
  const f = followUp(s, { turn: reply?.turn ?? null });
  if (f.line) lines.push(f);
  return lines;
}

test('a caller who dodges every question: no slot asked more than twice, the second ask is a different line', () => {
  for (const lang of ['th', 'en', 'zh']) {
    const s = newCallState();
    s.lang = lang;
    const said = [];
    for (let i = 0; i < 6 && !s.closed; i++) said.push(...turn(s, { action: i >= 3 ? 'take-message' : 'continue' }));
    const asks = said.filter((r) => isQuestion(r.kind));
    for (const kind of ['askWho', 'askCallback', 'askPurpose']) {
      // the opening disclosure already asked who + why once
      const n = asks.filter((r) => r.kind === kind).length + (kind === 'askCallback' ? 0 : 1);
      assert.ok(n <= MAX_ASKS, `${lang} ${kind} asked ${n} times`);
    }
    const lines = asks.map((r) => r.line);
    assert.equal(new Set(lines).size, lines.length, `${lang}: no line said twice: ${lines.join(' | ')}`);
  }
});

test('a slot the caller already gave is never asked', () => {
  const s = newCallState();
  const said = [
    ...turn(s, { text: 'ติดต่อจากโรงพยาบาลค่ะ โทรกลับที่ 02 123 4567', verdict: 'LEGIT', signals: { authority: 0.8, callbackGiven: 0.9 }, tactic: 'hospital' }),
    ...turn(s, { text: 'ไม่มีค่ะ', verdict: 'LEGIT', signals: { authority: 0.8, callbackGiven: 0.9 }, tactic: 'hospital' }),
    ...turn(s, { text: 'แค่นี้ค่ะ', verdict: 'LEGIT', signals: { authority: 0.8, callbackGiven: 0.9 }, tactic: 'hospital' }),
  ];
  assert.deepEqual(said.filter((r) => ['askWho', 'askCallback', 'askPurpose'].includes(r.kind)), []);
  assert.deepEqual(said.filter((r) => isQuestion(r.kind)).map((r) => r.kind), ['askMessage', 'askMore', 'askMore']);
});

test('one question per AI turn: stage 1, the verdict and the fallback never chain two', () => {
  const s = newCallState();
  const script = [
    { text: 'Hello, this is Anna from City Water.', signals: { authority: 0.8 }, tactic: 'utility' },
    { text: 'It is about the meter reading.', signals: { authority: 0.8 }, tactic: 'utility' },
    { text: 'Call us on 02 555 0100.', signals: { authority: 0.8, callbackGiven: 0.9 }, tactic: 'utility' },
  ];
  for (const t of script) {
    const said = turn(s, t);
    assert.ok(said.filter((r) => isQuestion(r.kind)).length <= 1, JSON.stringify(said));
  }
  // the language disclosure is the question of its turn: stage 2 adds none
  const z = newCallState();
  const said = turn(z, { text: 'Xin chào, tôi gọi từ phòng khám nha khoa về lịch hẹn', signals: {}, tactic: 'none' });
  assert.deepEqual(said.map((r) => r.kind), ['disclosure']);
});

test('the early question never re-asks the slot the caller is answering now', () => {
  const s = newCallState();
  turn(s, { text: 'สวัสดีค่ะ จากบริษัทขนส่ง', signals: { authority: 0.8 }, tactic: 'parcel-courier' });
  assert.equal(s.lastAsk.kind, 'askCallback');
  // turn 2 answers it (the verdict is not in yet): stage 1 does not ask the callback again
  const { reply } = stageOne(s, null, 'เบอร์ศูนย์สองหนึ่งสองสามสี่ห้าหกค่ะ');
  assert.notEqual(reply.kind, 'askCallback');
  // ... and if the verdict then says it was dodged, the rephrase comes after the NEXT turn
  onVerdict(s, { verdict: 'UNSURE', action: 'continue', signals: { authority: 0.8, callbackGiven: 0 }, tactic: 'parcel-courier', turn: reply.turn });
  const r3 = stageOne(s, null, 'ค่ะ').reply;
  assert.equal(r3.kind, 'askCallback');
  assert.equal(r3.line, RX_LINES.askCallback[1], 'rephrased, not the same line');
});

test('saysNumber: digits, Thai digits and spoken digit runs; short counts are not a number', () => {
  for (const t of ['call 02 345 6100', '๐๘๑๒๓๔๕๖๗', 'ศูนย์ แปด หนึ่ง สอง สาม สี่ ห้า', 'zero two three four five six one', '零二三四五六七八']) assert.ok(saysNumber(t), t);
  for (const t of ['at 9 am', 'room 1203', 'สองคน', 'two or three days', '']) assert.ok(!saysNumber(t), t);
});

test('close timing: a take-message right after our question waits one caller turn', () => {
  const s = newCallState({ early: false });
  s.lang = 'en'; // an English call (opened in English)
  turn(s, { signals: { authority: 0.8 }, tactic: 'delivery' }); // asks the callback
  const t2 = onCallerTurn(s, 'Sure, 02 345 6100.');
  // stage 2 for turn 2 asks, then a late Wonder take-message arrives for the same turn
  assert.equal(onVerdict(s, { verdict: 'LEGIT', action: 'continue', signals: { authority: 0.8, callbackGiven: 0.9 }, tactic: 'delivery', turn: t2.turn }).step, 'ask');
  const late = onVerdict(s, { verdict: 'LEGIT', action: 'take-message', turn: t2.turn });
  assert.equal(late.step, 'continue');
  assert.equal(s.closed, false);
  const t3 = onCallerTurn(s, 'No, that is all. Thanks.');
  assert.equal(t3.kind, 'backchannel');
  const c = onVerdict(s, { verdict: 'LEGIT', action: 'continue', signals: {}, tactic: 'delivery', turn: t3.turn });
  assert.equal(c.step, 'close');
  assert.equal(c.kind, 'closeLegit');
  // the 5 s fallback closes too when no verdict comes
  const f = newCallState({ early: false });
  turn(f, { signals: { authority: 0.8 }, tactic: 'delivery' });
  const ft = onCallerTurn(f);
  onVerdict(f, { verdict: 'LEGIT', action: 'continue', signals: { authority: 0.8 }, tactic: 'delivery', turn: ft.turn });
  onVerdict(f, { verdict: 'LEGIT', action: 'take-message', turn: ft.turn });
  const ft2 = onCallerTurn(f);
  assert.equal(followUp(f, { turn: ft2.turn }).step, 'close');
});

test('close timing: with nothing asked, take-message closes at once; SCAM always closes at once', () => {
  const s = newCallState();
  const r = onCallerTurn(s);
  assert.equal(onVerdict(s, { verdict: 'LEGIT', action: 'take-message', tactic: 'hospital', turn: r.turn }).step, 'close');
  // SCAM right after our own question: immediate, and the question is cancelled
  const z = newCallState();
  turn(z, { signals: { authority: 0.9 }, tactic: 'bank-security' });
  const q = onCallerTurn(z);
  assert.ok(isQuestion(q.kind));
  const c = onVerdict(z, { verdict: 'SCAM', action: 'hangup', turn: q.turn });
  assert.equal(c.step, 'close');
  assert.equal(c.kind, 'closeScam');
  assert.equal(c.cancelAsk.line, q.line);
  // a close already due never turns a SCAM into a polite message close
  const d = newCallState({ early: false });
  turn(d, { signals: { authority: 0.9 }, tactic: 'bank-security' });
  const d2 = onCallerTurn(d);
  onVerdict(d, { verdict: 'UNSURE', action: 'continue', signals: { authority: 0.9 }, tactic: 'bank-security', turn: d2.turn });
  onVerdict(d, { verdict: 'UNSURE', action: 'take-message', turn: d2.turn });
  const d3 = onCallerTurn(d);
  assert.equal(onVerdict(d, { verdict: 'SCAM', action: 'hangup', turn: d3.turn }).kind, 'closeScam');
});

test('no early question on the turn the policy closes every non-scam call', () => {
  assert.equal(CLOSE_BY_TURN, T.unsureMaxTurns, 'kept in step with policy.T.unsureMaxTurns');
  const s = newCallState();
  s.lang = 'en';
  for (let i = 1; i < CLOSE_BY_TURN; i++) turn(s, { signals: { authority: 0.8 }, tactic: 'delivery' });
  const r = onCallerTurn(s, 'That is everything.');
  assert.equal(r.kind, 'backchannel');
  const c = onVerdict(s, { verdict: 'LEGIT', action: 'take-message', tactic: 'delivery', signals: {}, turn: r.turn });
  assert.equal(c.step, 'close');
});

test('closing line fits the reason, in the call language', () => {
  for (const lang of ['th', 'en', 'zh']) {
    const L = RX_LINES_BY_LANG[lang];
    const mk = () => { const s = newCallState(); s.lang = lang; return s; };
    const a = mk(); const ra = onCallerTurn(a);
    assert.equal(onVerdict(a, { verdict: 'SCAM', action: 'hangup', turn: ra.turn }).line, L.closeScam[0], `${lang} scam`);
    const b = mk(); const rb = onCallerTurn(b);
    assert.equal(onVerdict(b, { verdict: 'LEGIT', action: 'take-message', tactic: 'hospital', turn: rb.turn }).line, L.closeLegit[0], `${lang} message taken`);
    const u = mk(); const ru = onCallerTurn(u);
    assert.equal(onVerdict(u, { verdict: 'UNSURE', action: 'take-message', signals: { emergency: 0.9 }, tactic: 'other', turn: ru.turn }).line, L.closeUrgent[0], `${lang} urgent`);
    const n = mk(); const rn = onCallerTurn(n);
    assert.equal(onVerdict(n, { verdict: 'UNSURE', action: 'take-message', tactic: 'utility', turn: rn.turn }).line, L.closeLegit[0], `${lang} unsure: message taken, owner decides`);
    // the recording / caller ran out: the message close (or urgent), never the scam line
    const e = mk(); onCallerTurn(e);
    assert.equal(endOfCall(e).line, L.closeLegit[0]);
    assert.equal(endOfCall(e), null, 'once closed, nothing more');
  }
  for (const [lang, bye] of [['th', /สวัสดีค่ะ$/], ['en', /goodbye\.$/i], ['zh', /再见。$/]]) {
    assert.match(RX_LINES_BY_LANG[lang].closeScam[0], bye);
    assert.match(RX_LINES_BY_LANG[lang].closeLegit[0], bye);
  }
  const t = newCallState({ scamPolicy: 'trap' });
  onCallerTurn(t);
  onVerdict(t, { verdict: 'SCAM', action: 'hangup' });
  assert.equal(endOfCall(t), null, 'the trap ends on its own closing line');
});

test('every question line reads as a question or a polite request', () => {
  for (const lang of ['th', 'en', 'zh']) {
    for (const kind of ['askWho', 'askCallback', 'askPurpose', 'askMessage', 'askMore']) {
      const list = RX_LINES_BY_LANG[lang][kind];
      assert.ok(list.length >= 1, `${lang} ${kind}`);
      for (const line of list) assert.match(line, /(\?|？|。|คะ|ค่ะ)$/, `${lang} ${kind}: ${line}`);
    }
    for (const kind of ['askMessage', 'askMore']) for (const line of RX_LINES_BY_LANG[lang][kind]) assert.match(line, /(\?|？|ไหมคะ)$/, line);
  }
});

test('a non-scam call is never closed before the policy says take-message (sealed B30 timing)', () => {
  const s = newCallState();
  for (let i = 0; i < 6; i++) turn(s, { verdict: 'LEGIT', action: 'continue', signals: { authority: 0.8, callbackGiven: 0.9 }, tactic: 'hospital' });
  assert.equal(s.closed, false);
});

test('user rule: no spoken line says the owner is unavailable or busy; every close says we pass it on, then goodbye', () => {
  const BANNED = /not available|unavailable|busy|cannot come to the phone|ไม่สะดวก|ไม่ว่าง|ไม่อยู่|不方便|没空|不在/i;
  const SPOKEN = ['backchannel', 'askWho', 'askCallback', 'askPurpose', 'askMessage', 'askMore', 'trapFiller', 'closeScam', 'closeLegit', 'closeUrgent', 'disclosure', 'disclosureOther'];
  for (const lang of ['th', 'en', 'zh']) {
    const L = RX_LINES_BY_LANG[lang];
    for (const kind of SPOKEN) for (const line of L[kind] || []) assert.doesNotMatch(line, BANNED, `${lang} ${kind}: ${line}`);
    for (const kind of ['closeScam', 'closeLegit', 'closeUrgent']) {
      for (const line of L[kind]) {
        assert.match(line, /ส่งเรื่อง|ฝากเรื่อง|pass this on|转达/, `${lang} ${kind} says we pass it on: ${line}`);
        assert.match(line, /สวัสดีค่ะ$|goodbye\.$|再见。$/i, `${lang} ${kind} ends on goodbye: ${line}`);
      }
    }
    // the scam close promises no callback and adds nothing else
    assert.doesNotMatch(L.closeScam[0], /call (you )?back|โทรกลับ|ติดต่อกลับ|回电|回拨|owner|เจ้าของ|机主/i);
  }
});
