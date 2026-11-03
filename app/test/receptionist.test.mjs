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
  const s = newCallState();
  onCallerTurn(s);
  // caller said "police station X" (authority) and a purpose (tactic) -> skip who/purpose, ask the callback number
  const a = onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: { authority: 0.9, callbackGiven: 0 }, tactic: 'fake-police' });
  assert.equal(a.step, 'ask');
  assert.equal(a.kind, 'askCallback');
  onCallerTurn(s);
  const b = onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 2, signals: { authority: 0.9, callbackGiven: 0.9 }, tactic: 'fake-police' });
  assert.equal(b.kind, 'takeMessage', 'callback never asked twice; all known -> take a message');
  // a stale verdict (older turn) or a second verdict for the same turn adds nothing
  assert.equal(onVerdict(s, { verdict: 'UNSURE', turn: 1, signals: {} }).step, 'continue');
  assert.equal(followUp(s, { turn: 2 }).step, 'continue');
});

test('stage 2 is dropped when the caller is already talking; fallback asks without a verdict', async () => {
  const { followUp } = await import('../src/receptionist.js');
  const s = newCallState();
  onCallerTurn(s);
  const r = onVerdict(s, { verdict: 'UNSURE', action: 'continue', turn: 1, signals: {}, tactic: 'none', callerTalking: true });
  assert.equal(r.dropped, true);
  assert.equal(r.line, null);
  onCallerTurn(s);
  const f = followUp(s, { turn: 2 });
  assert.equal(f.kind, 'askWho', 'nothing known yet: who is calling');
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
  const r = onVerdict(s, { verdict: 'LEGIT', action: 'take-message' });
  assert.equal(r.step, 'close');
  assert.equal(r.line, RX_LINES.closeLegit[0]);
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
