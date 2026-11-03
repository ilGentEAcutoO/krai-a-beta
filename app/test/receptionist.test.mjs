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

test('a line on every caller turn: who, callback, message, then rotating acks', () => {
  const s = newCallState();
  const kinds = [1, 2, 3, 4, 5, 6].map(() => onCallerTurn(s).kind);
  assert.deepEqual(kinds, ['askWho', 'askCallback', 'takeMessage', 'ack', 'ack', 'ack']);
  const s2 = newCallState();
  const lines = Array.from({ length: 8 }, () => onCallerTurn(s2).line);
  for (let i = 1; i < lines.length; i++) assert.notEqual(lines[i], lines[i - 1], 'never the same line twice in a row');
});

test('SCAM closes politely by default and the call stays closed', () => {
  const s = newCallState();
  onCallerTurn(s);
  assert.deepEqual(onVerdict(s, { verdict: 'UNSURE', action: 'continue' }), { step: 'continue', line: null });
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
  assert.equal(onVerdict(s, { verdict: 'LEGIT', action: 'continue' }).step, 'continue');
  const r = onVerdict(s, { verdict: 'LEGIT', action: 'take-message' });
  assert.equal(r.step, 'close');
  assert.equal(r.line, RX_LINES.closeLegit[0]);
});
