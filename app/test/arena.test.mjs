import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BudgetError, LEGIT_PERSONAS, SCAM_PERSONAS, buildPlan, createBudgetMeter, playCall, scoreCall, splitOf, summarize,
} from '../../scripts/arena.mjs';

// Fake Meta chat endpoint: answers by schema name; every answer bills usage.
function fakeMeta({ verdict = 'SCAM', confidence = 0.95, signals = {}, persona = (n) => `caller line ${n}`, usage = { prompt_tokens: 1000, completion_tokens: 200 } } = {}) {
  let personaN = 0;
  const seen = [];
  const fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    const name = body.response_format?.json_schema?.name;
    seen.push({ model: body.model, name });
    let content;
    if (name === 'caller_turn') content = { line: persona(++personaN), end: false, outOfCharacter: false };
    else if (name === 'verdict') {
      content = {
        verdict, tactic: 'fake-police', confidence,
        signals: { authority: 0, urgency: 0, secrecy: 0, moneyTransfer: 0, otpRequest: 0, appInstall: 0, identityProbe: 0, injection: 0, callbackGiven: 0, ...signals },
        reasonTh: 'x', reasonEn: 'x',
      };
    } else if (name === 'hard_verdict') content = { verdict, tactic: 'x', signals: {}, evidence: [], reasonTh: 'x', reasonEn: 'x' };
    else if (name === 'trap_reply') content = { reply: 'เดี๋ยวนะคะ ขอจดก่อนค่ะ' };
    else if (name === 'trap_intel') content = { items: [] };
    else content = {};
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: JSON.stringify(content) } }], usage }), { status: 200 });
  };
  return { fetch, seen };
}

test('splitOf is deterministic and close to 70/30', () => {
  const plan = buildPlan({ scam: 200, legit: 100 });
  assert.equal(plan.length, 300);
  assert.equal(new Set(plan.map((c) => c.id)).size, 300);
  for (const c of plan.slice(0, 20)) assert.equal(splitOf(c.id), c.split);
  const hold = plan.filter((c) => c.split === 'holdout').length / plan.length;
  assert.ok(hold > 0.2 && hold < 0.4, `holdout share ${hold}`);
  // every persona appears in the first round
  const first = new Set(plan.slice(0, SCAM_PERSONAS.length * 2).map((c) => c.persona));
  for (const p of SCAM_PERSONAS) assert.ok(first.has(p.id));
  assert.ok(LEGIT_PERSONAS.every((p) => plan.some((c) => c.persona === p.id)));
});

test('budget meter sums real usage and refuses new requests at the cap', async () => {
  const { fetch } = fakeMeta();
  const meter = createBudgetMeter({ capUsd: 0.05, baseFetch: fetch });
  const f = meter.fetchFor('persona');
  const req = { method: 'POST', body: JSON.stringify({ model: 'muse-wonder-1.0', response_format: { json_schema: { name: 'caller_turn' } } }) };
  // wonder: 1000*4/1e6 + 200*20/1e6 = 0.008 per call
  let n = 0;
  await assert.rejects(async () => { for (;;) { await f('https://api.meta.ai/v1/chat/completions', req); n += 1; } }, BudgetError);
  assert.equal(n, 7); // 7 * 0.008 = 0.056 >= 0.05: the 8th is refused
  assert.ok(Math.abs(meter.m.spent - 0.056) < 1e-9);
  assert.equal(meter.m.refused, 1);
  assert.equal(meter.canSpend(), false);
});

test('a scam call is blocked by the real pipeline and scored', async () => {
  const { fetch } = fakeMeta({ verdict: 'SCAM', confidence: 0.95 });
  const meter = createBudgetMeter({ capUsd: 5, baseFetch: fetch });
  const call = { id: 'scam-police-aml-m-v0', cls: 'scam', persona: 'police-aml-m', variant: 0, mood: 'calm', split: 'train', scamPolicy: 'close' };
  const r = await playCall(call, { meter, apiKey: 'k', maxTurns: 4 });
  assert.equal(r.score.outcome, 'blocked');
  assert.equal(r.score.firstCorrectTurn, 1);
  assert.equal(r.turns.length, 1);
  // "caller line 1" is too short to decide English (MIN_EN_LETTERS), so Thai (B27)
  assert.ok(r.transcript.at(-1).text.includes('ขอบคุณค่ะ'));
  assert.ok(r.usd > 0);
});

test('a legit call that the pipeline flags is a wrong hang-up; LEGIT is allowed', async () => {
  const legitCall = { id: 'legit-hospital-appt-f-v0', cls: 'legit', persona: 'hospital-appt-f', variant: 0, mood: 'calm', split: 'holdout', scamPolicy: 'close' };
  const bad = await playCall(legitCall, { meter: createBudgetMeter({ capUsd: 5, baseFetch: fakeMeta({ verdict: 'SCAM' }).fetch }), apiKey: 'k', maxTurns: 3 });
  assert.equal(bad.score.wrongHangup, true);
  const good = await playCall(legitCall, { meter: createBudgetMeter({ capUsd: 5, baseFetch: fakeMeta({ verdict: 'LEGIT', confidence: 0.95, signals: { callbackGiven: 0.9 } }).fetch }), apiKey: 'k', maxTurns: 5 });
  assert.equal(good.score.outcome, 'allowed');
  assert.equal(good.score.wrongHangup, false);
  const s = summarize([{ ...bad, status: 'done' }, { ...good, status: 'done' }]);
  assert.equal(s.all.legit.blocked, 1);
  assert.equal(s.holdout.legit.allowed, 1);
});

test('T1 hard demand closes before Spark is needed; trap policy keeps the line open', async () => {
  const otp = () => 'รบกวนบอกรหัส OTP ที่ส่งไปให้ผมหน่อยครับ';
  const meter = createBudgetMeter({ capUsd: 5, baseFetch: fakeMeta({ verdict: 'UNSURE', confidence: 0.6, persona: otp }).fetch });
  const call = { id: 'scam-bank-frozen-f-v0', cls: 'scam', persona: 'bank-frozen-f', variant: 0, mood: 'calm', split: 'train', scamPolicy: 'close' };
  const r = await playCall(call, { meter, apiKey: 'k', maxTurns: 4 });
  assert.equal(r.score.t1Turn, 1);
  assert.equal(r.score.outcome, 'blocked');
  const t = await playCall({ ...call, scamPolicy: 'trap' }, { meter, apiKey: 'k', maxTurns: 3 });
  assert.equal(t.score.trapped, true);
  assert.equal(t.turns.length, 3);
  assert.ok(t.turns[1].rx.trap);
});

test('scripted replay plays recorded caller lines without the persona model', async () => {
  const { fetch, seen } = fakeMeta({ verdict: 'UNSURE', confidence: 0.6 });
  const meter = createBudgetMeter({ capUsd: 5, baseFetch: fetch });
  const call = { id: 'legit-condo-office-f-v0', cls: 'legit', persona: 'condo-office-f', variant: 0, mood: 'calm', split: 'holdout', scamPolicy: 'close' };
  const r = await playCall(call, { meter, apiKey: 'k', maxTurns: 8, script: ['สวัสดีค่ะ นิติบุคคลคอนโดค่ะ', 'พรุ่งนี้ปิดน้ำสองชั่วโมงค่ะ'] });
  assert.equal(r.turns.length <= 2, true);
  assert.equal(seen.some((x) => x.name === 'caller_turn'), false);
});

test('scoreCall: unsure scam is escalated, not blocked', () => {
  const s = scoreCall({ cls: 'scam' }, [{ turn: 1, rx: { verdict: 'UNSURE', lines: [] } }, { turn: 2, rx: { verdict: 'UNSURE', lines: [{ kind: 'close' }], endedBy: 'hangup' } }]);
  assert.equal(s.outcome, 'escalated');
  assert.equal(s.correct, false);
  assert.equal(s.closedAs, 'take-message');
});

test('a persona that breaks character ends the call as persona-refused, unscored by the pipeline', async () => {
  const meter = createBudgetMeter({ capUsd: 5, baseFetch: fakeMeta({ persona: () => 'ขอโทษค่ะ ฉันไม่สามารถสวมบทบาทเป็นมิจฉาชีพได้' }).fetch });
  const call = { id: 'scam-job-task-f-v0', cls: 'scam', persona: 'job-task-f', variant: 0, mood: 'calm', split: 'train', scamPolicy: 'close' };
  const r = await playCall(call, { meter, apiKey: 'k', maxTurns: 4 });
  assert.equal(r.endedBy, 'persona-refused');
  assert.equal(r.turns.length, 0);
});
