import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RX_LINES, newCallState, onCallerTurn, onVerdict } from '../src/receptionist.js';
import { guardReply } from '../src/policy.js';
import { guardTrapLine } from '../src/trap.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('every receptionist line passes guardReply and the stricter trap guard', () => {
  for (const [kind, list] of Object.entries(RX_LINES)) {
    for (const line of list) {
      assert.ok(guardReply(line).ok, `${kind}: ${line} ${guardReply(line).reasons}`);
      assert.deepEqual(guardTrapLine(line).reasons, [], `${kind}: ${line}`);
    }
  }
});

test('public/receptionist.js is a byte-identical vendor of src/receptionist.js', () => {
  assert.equal(readFileSync(join(HERE, '../public/receptionist.js'), 'utf8'), readFileSync(join(HERE, '../src/receptionist.js'), 'utf8'));
});

test('stage 1 is an instant neutral backchannel on every turn, never the same twice in a row', () => {
  const s = newCallState();
  const r = Array.from({ length: 6 }, () => onCallerTurn(s));
  assert.ok(r.every((x) => x.kind === 'backchannel'));
  assert.deepEqual(r.map((x) => x.turn), [1, 2, 3, 4, 5, 6]);
  for (let i = 1; i < r.length; i++) assert.notEqual(r[i].line, r[i - 1].line);
});

test('stage 2 asks only for what Spark says is still missing', async () => {
  const { followUp } = await import('../src/receptionist.js');
  const s = newCallState({ early: false });
  onCallerTurn(s);
  // caller said "police station X" (authority) and a purpose (tactic) -> skip who/purpose, ask the callback number
  const a = onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: { authority: 0.9, callbackGiven: 0 }, tactic: 'fake-police' });
  assert.equal(a.step, 'ask');
  assert.equal(a.kind, 'askCallback');
  onCallerTurn(s);
  const b = onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 2, signals: { authority: 0.9, callbackGiven: 0.9 }, tactic: 'fake-police' });
  assert.equal(b.kind, 'askMessage', 'callback given; all known -> offer to take a message (a question)');
  // a stale verdict (older turn) or a second verdict for the same turn adds nothing
  assert.equal(onVerdict(s, { verdict: 'UNSURE', turn: 1, signals: {} }).step, 'continue');
  assert.equal(followUp(s, { turn: 2 }).step, 'continue');
});

test('stage 2 is dropped when the caller is already talking; fallback asks without a verdict', async () => {
  const { followUp } = await import('../src/receptionist.js');
  const s = newCallState({ early: false });
  onCallerTurn(s);
  const r = onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: {}, tactic: 'none', callerTalking: true });
  assert.equal(r.dropped, true);
  assert.equal(r.line, null);
  onCallerTurn(s);
  const f = followUp(s, { turn: 2 });
  assert.equal(f.kind, 'askCallback', 'nothing known yet: the opening already asked who and why, so the callback (never asked) comes first');
  assert.equal(onVerdict(s, { verdict: 'UNSURE', turn: 2, signals: { authority: 0.9 } }).step, 'continue', 'verdict after fallback adds no second line');
});

test('a SCAM verdict still closes while the caller talks (safety beats politeness)', () => {
  const s = newCallState();
  onCallerTurn(s);
  assert.equal(onVerdict(s, { verdict: 'SCAM', action: 'hangup', turn: 1, callerTalking: true }).step, 'close');
});

test('SCAM closes politely by default and the call stays closed', () => {
  const s = newCallState();
  onCallerTurn(s);
  assert.equal(onVerdict(s, { verdict: 'UNSURE', action: 'continue' }).step, 'continue');
  const r = onVerdict(s, { verdict: 'SCAM', action: 'hangup' });
  assert.equal(r.step, 'close');
  assert.equal(r.line, RX_LINES.closeScam[0]);
  assert.equal(onCallerTurn(s), null);
  assert.equal(onVerdict(s, { verdict: 'SCAM' }).step, 'none');
});

test('SCAM with the trap policy switches to trap fillers', () => {
  const s = newCallState({ scamPolicy: 'trap' });
  onCallerTurn(s);
  assert.deepEqual(onVerdict(s, { verdict: 'SCAM', action: 'hangup' }), { step: 'trap', line: null });
  assert.equal(onCallerTurn(s).kind, 'trapFiller');
  assert.equal(onVerdict(s, { verdict: 'SCAM', action: 'hangup' }).step, 'continue');
});

test('LEGIT take-message closes; LEGIT continue carries on', () => {
  const s = newCallState();
  onCallerTurn(s);
  assert.equal(onVerdict(s, { verdict: 'LEGIT', action: 'continue' }).step, 'continue', 'no turn given: no follow-up');
  const r = onVerdict(s, { verdict: 'LEGIT', action: 'take-message', tactic: 'hospital' });
  assert.equal(r.step, 'close');
  assert.equal(r.line, RX_LINES.closeLegit[0]);
});

test('B19: no take-message close before the purpose is heard; "other" is not a purpose', () => {
  const s = newCallState();
  const t1 = onCallerTurn(s);
  // Spark: a company name, tactic 'other', callback given -> policy says take-message
  const r = onVerdict(s, { verdict: 'UNSURE', action: 'take-message', tactic: 'other', signals: { authority: 0.7, callbackGiven: 0.9 }, turn: t1.turn });
  assert.equal(r.step, 'ask');
  assert.equal(r.kind, 'askPurpose');
  assert.equal(s.closed, false);
  // purpose heard (named tactic) -> the take-message closes
  const t2 = onCallerTurn(s);
  assert.notEqual(t2.kind, 'backchannel', 'turn 2: the hybrid asked a question at once');
  const r2 = onVerdict(s, { verdict: 'UNSURE', action: 'take-message', tactic: 'government-refund', signals: { callbackGiven: 0.9 }, turn: t2.turn });
  assert.equal(r2.step, 'continue', 'never a goodbye right on top of our own question');
  assert.equal(r2.closeDue, true);
  // the caller answers; the close follows that turn
  const t3 = onCallerTurn(s);
  assert.equal(t3.kind, 'backchannel', 'a close is due: no new question');
  assert.equal(onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: t3.turn, signals: {} }).step, 'close');
  // without a purpose, the gate gives up after PURPOSE_MAX_TURNS caller turns
  const s2 = newCallState();
  for (let i = 0; i < 5; i++) onCallerTurn(s2);
  assert.equal(onVerdict(s2, { verdict: 'UNSURE', action: 'take-message', tactic: 'other', turn: 5 }).step, 'close');
  // a SCAM close is never deferred
  const s3 = newCallState();
  onCallerTurn(s3);
  assert.equal(onVerdict(s3, { verdict: 'SCAM', action: 'hangup', tactic: 'other' }).step, 'close');
});

test('T1 hard demand closes at once; a later non-SCAM Spark verdict is logged as overruled', async () => {
  const { onT1 } = await import('../src/receptionist.js');
  const s = newCallState();
  onCallerTurn(s);
  const r = onT1(s, 'otp');
  assert.equal(r.step, 'close');
  assert.equal(s.t1, 'otp');
  assert.equal(onT1(s, 'app').step, 'none', 'fires once');
  assert.equal(onVerdict(s, { verdict: 'UNSURE', action: 'continue' }).step, 'none', 'never un-hung-up');
  assert.equal(s.t1Overruled, true);
  const t = newCallState({ scamPolicy: 'trap' });
  assert.equal(onT1(t, 'app').step, 'trap');
  assert.equal(onT1(newCallState(), null).step, 'none');
});

test('hybrid (default): turn 1 two-stage; from turn 2 the missing detail is asked at once and stage 2 is skipped', () => {
  const s = newCallState();
  assert.equal(onCallerTurn(s).kind, 'backchannel', 'turn 1: nothing known yet');
  assert.equal(onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: { authority: 0.9 }, tactic: 'bank-security' }).kind, 'askCallback');
  const t2 = onCallerTurn(s);
  assert.equal(t2.kind, 'askMessage', 'the caller is answering the callback question now: not re-asked early; who/why known -> offer to take a message');
  assert.equal(onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 2, signals: { authority: 0.9 } }).step, 'continue', 'no second line for turn 2');
  assert.equal(onVerdict(s, { verdict: 'SCAM', action: 'hangup', turn: 2 }).step, 'close', 'a verdict that changes the action still acts');
});

test('a T1 hit never speaks a question first (live bug on 7500187c)', async () => {
  const { stageOne } = await import('../src/receptionist.js');
  const s = newCallState();
  onCallerTurn(s);
  onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: { authority: 0.9 }, tactic: 'parcel-courier' });
  const { t1Step, reply } = stageOne(s, 'otp');
  assert.equal(t1Step.step, 'close');
  assert.equal(reply, null, 'closed: no question, no backchannel');
  // trap policy: the trap starts and the turn gets a trap filler, never a question
  const t = newCallState({ scamPolicy: 'trap' });
  onCallerTurn(t);
  onVerdict(t, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: { authority: 0.9 }, tactic: 'bank-security' });
  const r = stageOne(t, 'app');
  assert.equal(r.t1Step.step, 'trap');
  assert.equal(r.reply.kind, 'trapFiller');
  // no T1: the normal hybrid question
  const n = newCallState();
  onCallerTurn(n);
  onVerdict(n, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: { authority: 0.9 }, tactic: 'parcel-courier' });
  assert.equal(stageOne(n, null).reply.kind, 'askMessage');
});

test('OTP turn 2, T1 slower than the wait: the playing question is cancelled before the close', async () => {
  const { askDone, onT1 } = await import('../src/receptionist.js');
  const s = newCallState();
  onCallerTurn(s); // turn 1: backchannel
  onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: { authority: 0.2 }, tactic: 'parcel-courier' });
  // turn 2 ("ขอรหัส OTP ...") with no T1 answer yet: the hybrid asks at once
  const ask = onCallerTurn(s);
  assert.notEqual(ask.kind, 'backchannel');
  // T1 arrives while that question is still playing -> close, and cancel it
  const close = onT1(s, 'otp');
  assert.equal(close.step, 'close');
  assert.deepEqual(close.cancelAsk, { kind: ask.kind, line: ask.line, turn: 2 });
  assert.equal(s.pendingAsk, null);
  // a question that already finished is not cancelled
  const t = newCallState();
  onCallerTurn(t);
  onVerdict(t, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: { authority: 0.2 }, tactic: 'parcel-courier' });
  const q = onCallerTurn(t);
  askDone(t, q.line);
  assert.equal(onT1(t, 'otp').cancelAsk, undefined);
});

test('a SCAM verdict (or trap) while a stage-2 question plays also cancels it', async () => {
  const { followUp } = await import('../src/receptionist.js');
  const s = newCallState({ early: false });
  onCallerTurn(s);
  const ask = onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: {}, tactic: 'none' });
  assert.equal(ask.step, 'ask');
  onCallerTurn(s);
  const r = onVerdict(s, { verdict: 'SCAM', action: 'hangup', turn: 2 });
  assert.equal(r.step, 'close');
  assert.equal(r.cancelAsk.line, ask.line);
  const t = newCallState({ early: false, scamPolicy: 'trap' });
  onCallerTurn(t);
  const ask2 = followUp(t, { turn: 1 });
  const tr = onVerdict(t, { verdict: 'SCAM', action: 'hangup', turn: 1 });
  assert.equal(tr.step, 'trap');
  assert.equal(tr.cancelAsk.line, ask2.line);
});

test('demo-live wires the cancel: cancelAsk stops speech before the closing line', () => {
  const js = readFileSync(join(HERE, '../public/voice-client.js'), 'utf8');
  const apply = js.slice(js.indexOf('function applyStep('));
  assert.ok(apply.indexOf('cancelAsk(r.cancelAsk)') > -1 && apply.indexOf('cancelAsk(r.cancelAsk)') < apply.indexOf("r.step === 'close'"), 'cancel runs before the close line is said');
  assert.match(js, /function cancelAsk\(c\)[\s\S]{0,200}stopAudio\(\)/);
  assert.match(js, /function stopAudio\(\)[\s\S]{0,400}speechSynthesis\.cancel\(\)/, 'stops Gemini audio and the browser fallback');
  assert.match(js, /askDone\(rx\.state/);
  assert.match(js, /await Promise\.race\(\[t1p/, 'stage 1 waits for the T1 check first');
});

test('B25: an emergency is a purpose and closes with the urgent line (no auto-call claim)', () => {
  const s = newCallState();
  const t = onCallerTurn(s);
  const r = onVerdict(s, { verdict: 'UNSURE', action: 'take-message', tactic: 'other', signals: { emergency: 0.9 }, turn: t.turn });
  assert.equal(r.step, 'close');
  assert.equal(r.line, RX_LINES.closeUrgent[0]);
  assert.equal(r.urgent, true);
  assert.doesNotMatch(r.line, /โทรหา|ติดต่อ.*ให้แล้ว|ส่ง.*แล้ว/);
});
