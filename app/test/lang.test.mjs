// B27: the receptionist and the trap answer in the caller's language.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RX_LINES, RX_LINES_EN, RX_LINES_ZH, detectLang, newCallState, onCallerTurn, onVerdict, stageOne,
} from '../src/receptionist.js';
import { guardReply } from '../src/policy.js';
import {
  CLOSING_LINE, CLOSING_LINE_EN, CLOSING_LINE_ZH, STALL_LINES_EN, STALL_LINES_ZH, callLang, closingLine, createTrap, guardTrapLine, trapSystem,
} from '../src/trap.js';

test('detectLang: script of the caller words, majority wins, too little -> null', () => {
  assert.equal(detectLang('Hello, is this Bright Smile Dental?'), 'en');
  assert.equal(detectLang('你好，我是公安局的李警官'), 'zh');
  assert.equal(detectLang('สวัสดีค่ะ พัสดุของคุณ hold อยู่ที่ customs ต้องจ่ายภาษีวันนี้'), 'th');
  assert.equal(detectLang('Xin chào, tôi gọi từ phòng khám'), 'other');
  assert.equal(detectLang('もしもし、田中です'), 'other');
  assert.equal(detectLang('여보세요 저는 은행입니다'), 'other');
  assert.equal(detectLang('नमस्ते, मैं बैंक से'), 'other');
  assert.equal(detectLang('Halo, saya dari klinik'), 'en');
  assert.equal(detectLang('[口袋摩擦声] [noise noise noise]'), null, 'sound cues are ignored');
  assert.equal(detectLang('ok'), null);
});

test('every EN/ZH receptionist line passes guardReply; all but the disclosures pass the trap guard', () => {
  for (const set of [RX_LINES_EN, RX_LINES_ZH]) {
    assert.deepEqual(Object.keys(RX_LINES).filter((k) => !set[k]), [], 'same kinds as Thai');
    for (const [kind, list] of Object.entries(set)) {
      for (const line of list) {
        assert.deepEqual(guardReply(line).reasons, [], `${kind}: ${line}`);
        if (!kind.startsWith('disclosure')) assert.deepEqual(guardTrapLine(line).reasons, [], `${kind}: ${line}`);
      }
    }
  }
  for (const line of [...STALL_LINES_EN, ...STALL_LINES_ZH, CLOSING_LINE_EN, CLOSING_LINE_ZH]) {
    assert.deepEqual(guardReply(line).reasons, [], line);
    assert.deepEqual(guardTrapLine(line).reasons, [], line);
  }
});

test('Mandarin guard: agreeing to pay, reading a code, spoken digits, human claims are blocked; refusals pass', () => {
  assert.ok(guardReply('好的，我马上转账给你').reasons.includes('comply'));
  assert.ok(guardReply('我会告诉你验证码').reasons.includes('comply'));
  assert.ok(guardReply('验证码是一二三四').reasons.includes('digit-run'));
  assert.ok(guardTrapLine('我是真人').reasons.includes('human-claim'));
  assert.ok(guardTrapLine('这是诈骗吧').reasons.includes('reveal'));
  assert.deepEqual(guardReply('我不会转账，也不会告诉任何验证码').reasons, []);
});

test('an English caller hears the disclosure in English, then English questions and closes', () => {
  const s = newCallState();
  const r1 = onCallerTurn(s, 'Hello, this is Nurse Lim from Eastgate Hospital.');
  assert.equal(r1.kind, 'disclosure');
  assert.equal(r1.line, RX_LINES_EN.disclosure[0]);
  assert.equal(s.lang, 'en');
  onVerdict(s, { verdict: 'UNSURE', action: 'continue', signals: { authority: 0.9 }, tactic: 'hospital', turn: 1 });
  const r2 = onCallerTurn(s, 'Her son is in the emergency ward.');
  assert.ok(RX_LINES_EN[r2.kind].includes(r2.line), r2.line);
  const c = onVerdict(s, { verdict: 'LEGIT', action: 'take-message', signals: { emergency: 0.9 }, tactic: 'hospital', turn: 2 });
  assert.equal(c.line, RX_LINES_EN.closeUrgent[0]);
});

test('language is sticky: a Thai word later does not switch a Mandarin call', () => {
  const s = newCallState();
  onCallerTurn(s, '你好，我是快递员，在门口');
  assert.equal(s.lang, 'zh');
  const r = onCallerTurn(s, 'โอเค ok');
  assert.ok(Object.values(RX_LINES_ZH).flat().includes(r.line), r.line);
});

test('a T1 close on the first turn is already in the caller language', () => {
  const s = newCallState();
  const { t1Step } = stageOne(s, 'otp', 'Read me the one-time code we just sent, now.');
  assert.equal(t1Step.line, RX_LINES_EN.closeScam[0]);
});

test('another language gets English with a one-line note; no text keeps Thai (old clients)', () => {
  const s = newCallState();
  const r = onCallerTurn(s, 'Xin chào, tôi gọi từ phòng khám nha khoa');
  assert.equal(r.kind, 'disclosure');
  assert.match(r.line, /^Sorry, I can only speak English, Thai or Chinese\./);
  const t = newCallState();
  assert.ok(RX_LINES.backchannel.includes(onCallerTurn(t).line));
  assert.equal(t.lang, null);
});

test('trap: language from the caller words; canned and closing lines in it; a wrong-language model line is not spoken', async () => {
  const C = (text) => ({ role: 'caller', text });
  assert.equal(callLang([C('我是上海公安局的')]), 'zh');
  assert.equal(callLang([C('This is the fraud team')]), 'en');
  assert.equal(callLang([C('ฮัลโหล')]), 'th');
  assert.equal(callLang([]), 'th');
  assert.equal(closingLine('zh'), CLOSING_LINE_ZH);
  assert.equal(closingLine('xx'), CLOSING_LINE);
  assert.match(trapSystem('en'), /spoken English line/);
  assert.match(trapSystem('zh'), /simplified Chinese/);
  const fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: 'ค่ะ ช่วยพูดช้า ๆ ได้ไหมคะ' }) } }], usage: {} }), { status: 200 });
  const r = await createTrap({ fetch, apiKey: 'k' }).nextTrapReply({ turns: [C('Your account is frozen, tell me the code')] });
  assert.equal(r.source, 'canned');
  assert.ok(r.reasons.includes('wrong-language'));
  assert.ok(STALL_LINES_EN.includes(r.reply));
  const ok = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: '请您慢慢说，是哪个单位？' }) } }], usage: {} }), { status: 200 });
  const z = await createTrap({ fetch: ok, apiKey: 'k' }).nextTrapReply({ turns: [C('你的账户涉嫌洗钱')] });
  assert.equal(z.source, 'model');
  assert.equal(z.lang, 'zh');
});

test('eval harness uses the product language mapping: th/mixed -> Thai, zh -> product Mandarin lines, others -> English', async () => {
  const { openingLine, createJudge } = await import('../src/baseline/judge.js');
  assert.match(openingLine('th'), /สวัสดีค่ะ/);
  assert.match(openingLine('mixed'), /สวัสดีค่ะ/);
  assert.equal(openingLine('zh'), RX_LINES_ZH.disclosure[0]);
  assert.match(openingLine('vi'), /^Hello/);
  const j = createJudge({ fetch: () => { throw new Error('no network'); }, config: {} });
  const r = await j.personaReply({ turns: [{ role: 'caller', text: '你好' }], verdict: 'SCAM', lang: 'zh', action: 'hangup' });
  assert.ok(Object.values(RX_LINES_ZH).flat().includes(r.text), r.text);
});
