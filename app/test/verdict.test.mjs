import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.js';
import { abuseEnv, authHeaders } from './fakes.mjs';

// Every model route sits behind protect('verdict'): session + rate + budget.
const withGuard = (env) => abuseEnv(env);
const post = async (body, env) => app.request('/api/verdict/turn', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(await authHeaders(env)) },
  body: JSON.stringify(body),
}, env);

test('POST /api/verdict/turn validates before spending a cent', async () => {
  const realFetch = globalThis.fetch;
  let metaCalls = 0;
  globalThis.fetch = async () => { metaCalls++; throw new Error('must not call Meta'); };
  try {
    const noKey = await post({ lines: [{ speaker: 'caller', text: 'ฮัลโหล' }] }, withGuard({}));
    assert.equal(noKey.status, 500);
    const env = withGuard({ META_MODEL_API_KEY: 'k' });
    const empty = await post({ lines: [] }, env);
    assert.equal(empty.status, 400);
    const blank = await post({ lines: [{ speaker: 'caller', text: '   ' }] }, env);
    assert.equal(blank.status, 400);
    const garbage = await app.request('/api/verdict/turn', { method: 'POST', headers: await authHeaders(env), body: 'not-json{{{' }, env);
    assert.equal(garbage.status, 400);
    assert.equal(env.BUDGET.instances.size, 0, 'invalid bodies are rejected before any reservation');
    const noSession = await app.request('/api/verdict/turn', { method: 'POST', body: '{}' }, env);
    assert.equal(noSession.status, 401);
    assert.equal(metaCalls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('POST /api/verdict/turn: input caps -> 413 before reserving, worst-case reserve scales with input', async () => {
  const realFetch = globalThis.fetch;
  let metaCalls = 0;
  globalThis.fetch = async () => { metaCalls++; throw new Error('must not call Meta'); };
  try {
    const env = withGuard({ META_MODEL_API_KEY: 'k' });
    const line = (text) => ({ speaker: 'caller', text });
    const many = await post({ lines: Array.from({ length: 41 }, () => line('ฮัลโหล')) }, env);
    assert.equal(many.status, 413);
    assert.equal((await many.json()).error, 'too-many-lines');
    const long = await post({ lines: [line('ก'.repeat(2001))] }, env);
    assert.equal((await long.json()).error, 'line-too-long');
    const total = await post({ lines: Array.from({ length: 7 }, () => line('ก'.repeat(1900))) }, env);
    assert.equal(total.status, 413);
    assert.equal((await total.json()).error, 'turn-too-long');
    const huge = await app.request('/api/verdict/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders(env)) },
      body: JSON.stringify({ lines: [line('x')], pad: 'x'.repeat(70 * 1024) }),
    }, env);
    assert.equal(huge.status, 413, '>64 KB rejected before parsing');
    assert.equal((await huge.json()).error, 'too-large');
    assert.equal(env.BUDGET.instances.size, 0, 'no reservation for any rejected body');
    assert.equal(metaCalls, 0);

    // Meta down (402, not billed): the reservation is the worst case for the
    // input size and is fully refunded afterwards.
    globalThis.fetch = async () => ({ ok: false, status: 402, json: async () => ({}) });
    const reserved = [];
    const budget = env.BUDGET;
    const orig = budget.get.bind(budget);
    budget.get = (id) => {
      const stub = orig(id);
      return {
        fetch: async (url, init) => {
          if (String(url).endsWith('/reserve')) reserved.push(JSON.parse(init.body).micros);
          return stub.fetch(url, init);
        },
      };
    };
    await post({ lines: [line('สวัสดี')] }, env);
    await post({ lines: [line('ก'.repeat(1999)), line('ข'.repeat(1999))] }, env);
    assert.equal(reserved.length, 2);
    assert.ok(reserved[1] > reserved[0], 'bigger input reserves more');
    assert.ok(reserved[0] > 30000, 'covers prompt overhead + max output (> $0.03)');
    assert.ok(reserved[1] < 150000, 'bounded by the caps (< $0.15)');
    assert.deepEqual([...env.BUDGET.instances.get('global').state.storage.store.values()], [0]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('POST /api/verdict/turn: Spark SCAM + demand rule -> Block/hangup', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
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
    }, withGuard({ META_MODEL_API_KEY: '﻿"k"\r\n' }));
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
    assert.equal(calls[0].auth, 'Bearer k', 'key cleaned of BOM/quotes/CRLF before use');
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
    const env = withGuard({ META_MODEL_API_KEY: 'k' });
    const res = await post({ lines: [{ speaker: 'caller', text: 'ฮัลโหล ได้ยินไหม' }] }, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.spark.verdict, 'UNSURE');
    assert.equal(data.spark.engine, 'spark-fallback');
    assert.equal(data.policy.verdict, 'UNSURE');
    assert.equal(data.action, 'continue');
    const spent = [...env.BUDGET.instances.get('global').state.storage.store.values()];
    assert.deepEqual(spent, [0], 'a refused (402) call is not charged');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('POST /api/verdict/t1: instant code rule, no model call, no budget reservation', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not call any model'); };
  try {
    const env = withGuard({ META_MODEL_API_KEY: 'k' });
    const t1 = async (lines) => app.request('/api/verdict/t1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders(env)) },
      body: JSON.stringify({ turnId: 't9', lines }),
    }, env);
    const hit = await t1([{ speaker: 'caller', text: 'รบกวนบอกรหัส OTP ที่ส่งไปให้ผมหน่อยครับ' }]);
    assert.equal(hit.status, 200);
    const j = await hit.json();
    assert.deepEqual([j.ok, j.t1, j.turnId], [true, 'otp', 't9']);
    // a warning against the act is not a demand; receptionist lines never count
    const warn = await (await t1([{ speaker: 'caller', text: 'ธนาคารไม่มีนโยบายขอรหัส OTP ทางโทรศัพท์ครับ' }, { speaker: 'ai', text: 'บอกรหัส OTP มาหน่อย' }])).json();
    assert.equal(warn.t1, null);
    assert.equal((await t1([])).status, 400);
    assert.equal(calls, 0);
    assert.equal(env.BUDGET.instances.size, 0, 'a free route never touches the budget');
    const noSession = await app.request('/api/verdict/t1', { method: 'POST', body: '{}' }, env);
    assert.equal(noSession.status, 401);
  } finally {
    globalThis.fetch = realFetch;
  }
});
