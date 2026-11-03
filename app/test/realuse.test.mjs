import test from 'node:test';
import assert from 'node:assert/strict';
import { alignFinals, buildTimeline, callOutcome, cer, normText, percentile, pooledCer } from '../../scripts/realuse-lib.mjs';

test('normText: Thai digits, spaces and punctuation do not count', () => {
  assert.equal(normText('รหัส ๖ หลัก, OK!'), 'รหัส6หลักok');
  assert.equal(cer('สวัสดีครับ ผมโทรจาก', 'สวัสดีครับผมโทรจาก').cer, 0);
});

test('cer counts edits over the reference length', () => {
  const r = cer('abcd', 'abxd');
  assert.equal(r.edits, 1);
  assert.equal(r.refLen, 4);
  assert.equal(r.cer, 0.25);
  assert.equal(cer('abc', '').cer, 1);
  assert.equal(pooledCer([{ edits: 1, refLen: 4 }, { edits: 0, refLen: 6 }]), 0.1);
});

test('percentile is nearest-rank and ignores missing values', () => {
  assert.equal(percentile([5, 1, null, 3], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([], 50), null);
});

const scenario = {
  turns: [
    { role: 'ai', ms: 1000 },
    { role: 'caller', audio: 'a', textTh: 'หนึ่ง' },
    { role: 'ai', ms: 500 },
    { role: 'caller', audio: 'b', textTh: 'สอง' },
    { role: 'ai', ms: 9999 },
  ],
};
const tl = buildTimeline(scenario, { durationOf: (t) => (t.audio === 'a' ? 2000 : 3000), tailMs: 4000 });

test('timeline: AI lines are silence, last AI line becomes the tail', () => {
  assert.deepEqual(tl.segments.map((s) => [s.kind, s.startMs, s.endMs]), [
    ['silence', 0, 1000], ['caller', 1000, 3000], ['silence', 3000, 3500], ['caller', 3500, 6500], ['silence', 6500, 10500],
  ]);
});

test('alignFinals groups split finals under the scripted turn they follow', () => {
  const a = alignFinals(tl, [
    { atMs: 3200, text: 'หนึ่ง' },
    { atMs: 5000, text: 'สอ' },
    { atMs: 6900, text: 'ง' },
  ]);
  assert.equal(a[0].finals, 1);
  assert.equal(a[0].cer, 0);
  assert.equal(a[1].finals, 2);
  assert.equal(a[1].cer, 0);
});

test('callOutcome: scam blocked mid-demand vs after it', () => {
  const early = callOutcome('SCAM', [{ atMs: 4000, callerNo: 1, verdict: 'SCAM', action: 'continue' }], tl);
  assert.equal(early.correct, true);
  assert.equal(early.protectedBeforeDemandEnds, true);
  assert.equal(early.safeAction.kind, 'scam-verdict');
  const late = callOutcome('SCAM', [{ atMs: 9000, callerNo: 2, verdict: 'SCAM', action: 'hangup' }], tl);
  assert.equal(late.protectedBeforeDemandEnds, false);
  assert.equal(late.safeAction.msAfterDemandEnds, 2500);
});

test('callOutcome: a polite close before the demand protects but does not flag', () => {
  const o = callOutcome('SCAM', [{ atMs: 3300, callerNo: 1, verdict: 'UNSURE', action: 'continue' }], tl, { atMs: 4000, reason: 'message' });
  assert.equal(o.flagged, false);
  assert.equal(o.correct, false);
  assert.equal(o.protectedBeforeDemandEnds, true);
});

test('callOutcome: any block on a legit call is a wrong hang-up', () => {
  const o = callOutcome('LEGIT', [{ atMs: 3300, callerNo: 1, verdict: 'SCAM', action: 'hangup' }], tl);
  assert.equal(o.wrongHangup, true);
  assert.equal(o.correct, false);
  assert.equal(callOutcome('LEGIT', [{ atMs: 3300, callerNo: 1, verdict: 'LEGIT', action: 'continue' }], tl).correct, true);
});

test('silenceStats: dead air until we speak or the caller talks again; talk-over counted', async () => {
  const { silenceStats } = await import('../../scripts/realuse-lib.mjs');
  // callers at 1000-3000 and 3500-6500, timeline ends 10500 (tl above)
  const quiet = silenceStats(tl, []);
  assert.deepEqual(quiet.turns.map((t) => t.silenceMs), [500, 4000]);
  assert.equal(quiet.unanswered, 2);
  const rx = silenceStats(tl, [{ atMs: 3200, durMs: 1000 }, { atMs: 6900, durMs: 500 }]);
  assert.deepEqual(rx.turns.map((t) => t.silenceMs), [200, 400]);
  assert.equal(rx.talkOver, 1, 'the caller started at 3500 while we spoke until 4200');
  assert.equal(rx.maxMs, 400);
  const closed = silenceStats(tl, [{ atMs: 3200, durMs: 100 }], { closedAtMs: 3300 });
  assert.deepEqual(closed.turns.map((t) => t.callerNo), [1], 'turns after the close are not counted');
});
