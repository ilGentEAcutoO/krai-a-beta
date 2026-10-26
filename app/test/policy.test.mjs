import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideSpark, escalationConfidence, guardEscalation, guardReply, nextAction,
  t1Demand, templateReasons, zeroSignals,
} from '../src/policy.js';

const S = (o) => ({ ...zeroSignals(), ...o });

test('t1Demand fires on explicit demands, not on warnings', () => {
  assert.equal(t1Demand(['รบกวนอ่านรหัส OTP ที่ได้รับให้ฟังหน่อยค่ะ']), 'otp');
  assert.equal(t1Demand(['โหลดแอปตามลิงก์ที่ส่งให้เลยนะ']), 'app');
  assert.equal(t1Demand(['โอนเงินมาเดี๋ยวนี้']), 'transfer-now');
  assert.equal(t1Demand(['ห้ามวางสาย แล้วโอนเงินมาตามที่บอก']), 'secrecy-transfer');
  assert.equal(t1Demand(['ธนาคารไม่เคยขอรหัส OTP ทางโทรศัพท์ค่ะ']), null);
  assert.equal(t1Demand(['ไม่ต้องโอนเงินนะคะ']), null);
  assert.equal(t1Demand(['Never share the code with anyone.']), null);
  assert.equal(t1Demand(['tell me the otp you just got']), 'otp');
});

test('decideSpark: direct demands are SCAM whatever the verdict says', () => {
  const d = decideSpark({ verdict: 'LEGIT', confidence: 0.9, signals: S({ otpRequest: 0.9 }) });
  assert.equal(d.verdict, 'SCAM');
  assert.equal(d.rule, 'demand');
  assert.equal(d.escalate, false);
  const t = decideSpark({ verdict: 'UNSURE', confidence: 0.4, signals: S({ moneyTransfer: 0.9, authority: 0.8 }) });
  assert.equal(t.verdict, 'SCAM');
  assert.equal(t.rule, 'transfer');
});

test('decideSpark: accepts clear Spark verdicts, escalates the grey zone', () => {
  const s = decideSpark({ verdict: 'SCAM', confidence: 0.85, signals: S({}) });
  assert.deepEqual([s.verdict, s.escalate, s.rule], ['SCAM', false, 'spark']);
  const l = decideSpark({ verdict: 'LEGIT', confidence: 0.9, signals: S({}) });
  assert.deepEqual([l.verdict, l.escalate], ['LEGIT', false]);
  // LEGIT contradicted by a risk signal -> UNSURE + Wonder
  const c = decideSpark({ verdict: 'LEGIT', confidence: 0.9, signals: S({ moneyTransfer: 0.6 }) });
  assert.deepEqual([c.verdict, c.escalate, c.rule], ['UNSURE', true, 'escalate']);
  // SCAM below the bar -> UNSURE + Wonder
  const w = decideSpark({ verdict: 'SCAM', confidence: 0.6, signals: S({}) });
  assert.deepEqual([w.verdict, w.escalate], ['UNSURE', true]);
  // flat UNSURE, low confidence -> Wonder
  const u = decideSpark({ verdict: 'UNSURE', confidence: 0.3, signals: S({}) });
  assert.deepEqual([u.verdict, u.escalate], ['UNSURE', true]);
  // flat UNSURE, high confidence -> stays, no escalation
  const u2 = decideSpark({ verdict: 'UNSURE', confidence: 0.9, signals: S({}) });
  assert.deepEqual([u2.verdict, u2.escalate, u2.rule], ['UNSURE', false, 'spark']);
});

test('guardEscalation never lets Wonder clear a risky call', () => {
  assert.equal(guardEscalation('LEGIT', S({ moneyTransfer: 0.6 })), 'UNSURE');
  assert.equal(guardEscalation('LEGIT', S({ injection: 0.7 })), 'UNSURE');
  assert.equal(guardEscalation('LEGIT', S({ identityProbe: 0.6 })), 'UNSURE');
  assert.equal(guardEscalation('LEGIT', S({})), 'LEGIT');
  assert.equal(guardEscalation('SCAM', S({})), 'SCAM');
});

test('escalationConfidence blends with Spark agreement', () => {
  assert.equal(escalationConfidence('SCAM', 'SCAM', 0.8), 0.9);
  assert.equal(escalationConfidence('LEGIT', 'SCAM', 0.8), 0.6);
});

test('nextAction ends scam fast, closes legit with a message', () => {
  assert.equal(nextAction({ verdict: 'SCAM', confidence: 0.9 }, 2), 'hangup');
  assert.equal(nextAction({ verdict: 'SCAM', confidence: 0.5 }, 2), 'continue');
  assert.equal(nextAction({ verdict: 'LEGIT', confidence: 0.9, signals: S({ callbackGiven: 0.7 }) }, 2), 'take-message');
  assert.equal(nextAction({ verdict: 'LEGIT', confidence: 0.9, signals: S({}) }, 1), 'continue');
  assert.equal(nextAction({ verdict: 'UNSURE', confidence: 0.5, signals: S({ callbackGiven: 0.7 }) }, 2), 'take-message');
  assert.equal(nextAction({ verdict: 'SCAM', confidence: 0.9 }, 12, { maxTurns: 12 }), 'hangup');
});

test('guardReply blocks risky lines, allows safe ones', () => {
  assert.deepEqual(guardReply('ได้ค่ะ เดี๋ยวโอนเงินให้ทันทีค่ะ'), { ok: false, reasons: ['comply'] });
  assert.deepEqual(guardReply('รหัส OTP ที่ได้รับคือ 482913 ค่ะ').ok, false);
  assert.deepEqual(guardReply('กดลิงก์ที่ส่งไปได้เลยค่ะ').reasons, ['comply']);
  assert.deepEqual(guardReply('I will transfer the money now.').reasons, ['comply']);
  assert.deepEqual(guardReply('สัญญาณไม่ดีเลยค่ะ ได้ยินไม่ชัด').reasons, ['line-problem']);
  assert.deepEqual(guardReply('ดิฉันชื่อมาลี รับสายแทนค่ะ').reasons, ['self-name']);
  assert.deepEqual(guardReply('โทรกลับที่ 0812345678 นะคะ').reasons, ['digit-run']);
  assert.deepEqual(guardReply('คุณสมชายไม่อยู่ค่ะ', { ownerFacts: ['สมชาย'] }).reasons, ['owner-fact']);
  // safe lines pass
  assert.deepEqual(guardReply('ขอทราบชื่อกับธุระที่โทรมาหน่อยค่ะ'), { ok: true, reasons: [] });
  assert.deepEqual(guardReply('ไม่ต้องโอนเงินนะคะ ธนาคารไม่เคยขอรหัส OTP'), { ok: true, reasons: [] });
  assert.deepEqual(guardReply('Never share the code with anyone.'), { ok: true, reasons: [] });
  assert.deepEqual(guardReply('ดิฉันรับสายแทนเจ้าของเบอร์ค่ะ'), { ok: true, reasons: [] });
});

test('templateReasons narrates from the strongest signals', () => {
  const r = templateReasons('SCAM', S({ otpRequest: 0.9, authority: 0.8 }));
  assert.match(r.reasonTh, /ขอรหัส OTP/);
  assert.match(r.reasonEn, /OTP/);
  const l = templateReasons('LEGIT', S({}));
  assert.match(l.reasonTh, /ไม่ขอเงิน/);
  const u = templateReasons('UNSURE', S({}));
  assert.match(u.reasonTh, /ข้อมูลยังไม่พอ/);
});
