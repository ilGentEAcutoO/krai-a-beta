import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.js';

const post = (body, env) => app.request('/api/verdict/turn', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}, env);

test('POST /api/verdict/turn validates before spending a cent', async () => {
  const noKey = await post({ lines: [{ speaker: 'caller', text: 'ฮัลโหล' }] }, {});
  assert.equal(noKey.status, 500);
  const empty = await post({ lines: [] }, { META_MODEL_API_KEY: 'k' });
  assert.equal(empty.status, 400);
  const blank = await post({ lines: [{ speaker: 'caller', text: '   ' }] }, { META_MODEL_API_KEY: 'k' });
  assert.equal(blank.status, 400);
  const garbage = await app.request('/api/verdict/turn', { method: 'POST', body: 'not-json{{{' }, { META_MODEL_API_KEY: 'k' });
  assert.equal(garbage.status, 400);
});

test('POST /api/verdict/turn: Spark SCAM + demand rule -> Block/hangup', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        json: async () => ({
          model: 'muse-spark-1.3',
          usage: { input: 10, output: 5 },
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: 'SCAM',
                tactic: 'fake-police',
                confidence: 0.92,
                signals: { authority: 0.9, urgency: 0.8, otpRequest: 0.9 },
                reasonTh: 'อ้างตำรวจขอโอทีพี',
                reasonEn: 'Fake police asking for OTP.',
              }),
            },
          }],
        }),
      };
    };
    const res = await post({
      turnId: 't7',
      turnCount: 3,
      lines: [
        { speaker: 'ai', text: 'สวัสดีค่ะ' },
        { speaker: 'caller', text: 'ผมดาบตำรวจวิชัย มีหมายจับในชื่อคุณ รีบบอกเลขโอทีพีให้ผมเดี๋ยวนี้' },
      ],
    }, { META_MODEL_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.turnId, 't7');
    assert.equal(data.spark.verdict, 'SCAM');
    assert.equal(data.spark.tactic, 'fake-police');
    assert.equal(data.policy.verdict, 'SCAM');
    assert.equal(data.policy.rule, 'demand');
    assert.equal(data.action, 'hangup');
    assert.ok(data.t1, 'T1 lexical candidate reported alongside');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].body.messages.length > 2, 'few-shot pairs precede the live transcript');
    assert.equal(typeof data.latencyMs, 'number');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('POST /api/verdict/turn: Spark outage degrades to UNSURE, still 200', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 402, json: async () => ({ error: { code: 'billing_not_configured' } }) });
    const res = await post({ lines: [{ speaker: 'caller', text: 'ฮัลโหล ได้ยินไหม' }] }, { META_MODEL_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.spark.verdict, 'UNSURE');
    assert.equal(data.spark.engine, 'spark-fallback');
    assert.equal(data.policy.verdict, 'UNSURE');
    assert.equal(data.action, 'continue');
  } finally {
    globalThis.fetch = realFetch;
  }
});
