import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideSpark, escalationConfidence, guardEscalation, guardReply, nextAction,
  t1Demand, templateReasons, zeroSignals,
} from '../src/policy.js';

const S = (o) => ({ ...zeroSignals(), ...o });

test('t1Demand fires on explicit demands, not on warnings', () => {
  assert.equal(t1Demand(['รบกวนอ่านรหัส OTP ที่ได้รับให้ฟังหน่อยค่ะ']), 'otp');
  assert.equal(t1Demand(['ขอรหัส OTP ที่เพิ่งส่งไปทาง SMS ด้วยครับ เพื่อยืนยันการจัดส่ง']), 'otp', 'asked outright (live check 2026-11-03)');
  assert.equal(t1Demand(['ธนาคารไม่ขอรหัส OTP ทางโทรศัพท์นะคะ']), null, 'a warning is not a demand');
  assert.equal(t1Demand(['ขอบคุณค่ะ ไว้ติดต่อใหม่']), null);
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
  assert.equal(guardEscalation('SCAM', S({})), 'UNSURE', 'B19: a SCAM needs evidence');
  assert.equal(guardEscalation('SCAM', S({ otpRequest: 0.9 })), 'SCAM');
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
  // B30: LEGIT with no callback is heard to turn 4 (a warm 3-turn opener can still ask at turn 4)
  assert.equal(nextAction({ verdict: 'LEGIT', confidence: 0.9, signals: S({}) }, 3), 'continue');
  assert.equal(nextAction({ verdict: 'LEGIT', confidence: 0.9, signals: S({}) }, 4), 'take-message');
  // B19: an UNSURE caller with a callback is heard one turn longer (slow burns ask late)
  assert.equal(nextAction({ verdict: 'UNSURE', confidence: 0.5, signals: S({ callbackGiven: 0.7 }) }, 2), 'continue');
  assert.equal(nextAction({ verdict: 'UNSURE', confidence: 0.5, signals: S({ callbackGiven: 0.7 }) }, 3), 'take-message');
  assert.equal(nextAction({ verdict: 'SCAM', confidence: 0.9 }, 12, { maxTurns: 12 }), 'hangup');
});

test('B19: UNSURE with a risk signal escalates to Wonder; a read-out account lifts the transfer signal', async () => {
  const { decideSpark, accountTransferAsk } = await import('../src/policy.js');
  assert.equal(decideSpark({ verdict: 'UNSURE', confidence: 0.64, signals: S({ moneyTransfer: 0.75, urgency: 0.72 }) }).escalate, true);
  assert.equal(decideSpark({ verdict: 'UNSURE', confidence: 0.64, signals: S({ moneyTransfer: 0.75 }) }).escalate, false, 'unbacked risk stays with Spark');
  assert.equal(decideSpark({ verdict: 'UNSURE', confidence: 0.64, signals: S({ authority: 0.7 }) }).escalate, false);
  assert.equal(accountTransferAsk(['โอนเข้าบัญชีโรงพยาบาล 123-4-56789-0 ธนาคารกรุงไทยก่อนห้าโมงเย็นนะคะ']), true);
  assert.equal(accountTransferAsk(['เลขบัญชี สี่ ศูนย์ สอง แปด เจ็ด สาม เก้า ห้า หนึ่ง สี่ โอนเดี๋ยวนี้เลยครับ']), true);
  assert.equal(accountTransferAsk(['ไม่ต้องโอนเงินนะคะ บัญชี 1234567890 ของคุณปลอดภัย']), false);
  assert.equal(accountTransferAsk(['เบอร์ติดต่อกลับ 02-719-8845 ค่ะ']), false);
  assert.equal(accountTransferAsk(['ค่าส่ง 350 บาท จ่ายเงินสดที่หน้าประตูได้เลย']), false);
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

test('guardReply: security review B8 misses are blocked, warnings still pass', () => {
  for (const bad of [
    'ไม่ให้หรอก โอนเงินให้แล้วนะจ๊ะ', // refusal must not swallow the next clause
    'ได้จ้ะ เดี๋ยวโอนไปเลยนะ',
    'ตกลงจ้ะ จ่ายเลย',
    'รหัสที่ได้คือ ๑๒๓๔๕๖ จ้ะ', // Thai digits
    'รหัสคือ หนึ่ง สอง สาม สี่ ห้า หก จ้ะ', // spelled digits
    'the code is one two three four five six',
    'เดี๋ยวกดเข้าลิงก์ให้นะ',
    'ลงโปรแกรมที่ว่าให้',
    'ไม่ต้องโอนนะ รหัสคือ 482913', // a refusal never hides a number
  ]) assert.equal(guardReply(bad).ok, false, bad);
  for (const ok of [
    'ไม่ต้องโอนเงินนะคะ',
    'อย่ากดลิงก์ที่ใครส่งมานะคะ',
    'ห้ามบอกรหัส OTP กับใครเด็ดขาดค่ะ',
    'ไม่ต้องลงแอปอะไรค่ะ',
    "Please don't share the code.",
    'โทรมาเมื่อสองสามวันก่อนค่ะ',
  ]) assert.deepEqual(guardReply(ok), { ok: true, reasons: [] }, ok);
});

test('B19: a bare Wonder SCAM without evidence is raised to UNSURE only; "ไม่มีการขอรหัส OTP" is a refusal', async () => {
  const { guardEscalation, t1Demand } = await import('../src/policy.js');
  assert.equal(guardEscalation('SCAM', S({ authority: 0.7, urgency: 0.4, identityProbe: 0.35 })), 'UNSURE');
  assert.equal(guardEscalation('SCAM', S({})), 'UNSURE');
  assert.equal(guardEscalation('SCAM', S({ moneyTransfer: 0.6 })), 'SCAM');
  assert.equal(guardEscalation('SCAM', S({ injection: 0.8 })), 'UNSURE', 'B28: a prank with no organisation is not scam evidence');
  assert.equal(guardEscalation('SCAM', S({ injection: 0.8, authority: 0.6 })), 'SCAM', 'injection from a claimed organisation');
  assert.equal(guardEscalation('SCAM', S({ authority: 0.9, urgency: 0.8 })), 'SCAM', 'threat before the ask');
  assert.equal(t1Demand(['ย้ำว่าธนาคารไม่มีการขอรหัส OTP เด็ดขาดนะคะ']), null);
  assert.equal(t1Demand(['ธนาคารไม่ขอรหัส OTP ค่ะ']), null);
  assert.equal(t1Demand(['ขอรหัส OTP ที่เพิ่งส่งไปหน่อยครับ']), 'otp');
});

test('B25: a reported emergency is never blocked on Spark alone; a money ask still is', async () => {
  const { decideSpark } = await import('../src/policy.js');
  assert.equal(decideSpark({ verdict: 'SCAM', confidence: 0.85, signals: S({ emergency: 0.9, urgency: 0.8 }) }).verdict, 'UNSURE');
  assert.equal(decideSpark({ verdict: 'SCAM', confidence: 0.85, signals: S({ emergency: 0.9, urgency: 0.8 }) }).rule, 'emergency-guard');
  assert.equal(decideSpark({ verdict: 'SCAM', confidence: 0.9, signals: S({ emergency: 0.9, moneyTransfer: 0.9, urgency: 0.9 }) }).verdict, 'SCAM');
  assert.equal(decideSpark({ verdict: 'SCAM', confidence: 0.9, signals: S({ urgency: 0.8 }) }).verdict, 'SCAM', 'no emergency: unchanged');
});
