import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/index.js';
import { VoiceCall } from '../src/voice-do.js';
import { TurnAssembler, VOICE_FILE, VOICE_MODES, VOICE_WS, WS_OPEN, createRelay, buildHandshake, looksLikeWav, parseEvent, transcribeFile } from '../src/voice.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('handshake carries auth in the frame, fixed PCM encoding', () => {
  const h = buildHandshake({ apiKey: 'k', mode: 'ENDPOINTING', languageBias: ['Thai'], keywords: ['โอทีพี'] });
  assert.equal(h.authorization.accessToken, 'Bearer k');
  assert.equal(h.audioEncoding, 'PCM_24KHZ');
  assert.equal(h.mode, 'ENDPOINTING');
  assert.deepEqual(h.languageBias, ['Thai']);
  assert.deepEqual(VOICE_WS, 'wss://api.meta.ai/v1/asr/realtime');
  assert.deepEqual(VOICE_MODES, ['PUSH_TO_TALK', 'ENDPOINTING', 'DIARIZATION']);
  assert.throws(() => buildHandshake({ apiKey: 'k', mode: 'NOPE' }), /bad-voice-mode/);
  assert.throws(() => buildHandshake({}), /missing-voice-key/);
});

test('parseEvent normalizes every documented event, never throws', () => {
  assert.deepEqual(parseEvent(JSON.stringify({ sessionId: 's1' })), { type: 'ready', sessionId: 's1' });
  assert.deepEqual(parseEvent({ event: 'speechStart', turnId: 't1' }), { type: 'speech-start', turnId: 't1' });
  assert.deepEqual(
    parseEvent({ event: 'transcript', transcript: 'สวัสดี', final: false, audioProcessedMs: 800 }),
    { type: 'partial', turnId: null, transcript: 'สวัสดี', audioProcessedMs: 800 },
  );
  assert.deepEqual(
    parseEvent({ type: 'transcript', transcript: 'สวัสดีครับ', final: true }),
    { type: 'final', turnId: null, transcript: 'สวัสดีครับ', audioProcessedMs: 0 },
  );
  assert.deepEqual(parseEvent({ event: 'speechEnd', turnId: 't1' }), { type: 'speech-end', turnId: 't1' });
  assert.deepEqual(
    parseEvent({ event: 'speechComplete', turnId: 't1', transcript: 'สวัสดีครับ' }),
    { type: 'speech-complete', turnId: 't1', transcript: 'สวัสดีครับ' },
  );
  assert.deepEqual(parseEvent({ event: 'speaker', turnId: 't1', label: 'A' }), { type: 'speaker', turnId: 't1', label: 'A' });
  assert.deepEqual(parseEvent({ event: 'error', message: 'boom' }), { type: 'error', message: 'boom' });
  assert.deepEqual(parseEvent('{oops'), { type: 'unknown' });
  assert.deepEqual(parseEvent({ event: 'something-new' }), { type: 'unknown' });
  assert.deepEqual(parseEvent(null), { type: 'unknown' });
});

test('TurnAssembler keys overlapping turns on turnId, prefers complete text', () => {
  const a = new TurnAssembler();
  a.feed({ type: 'speech-start', turnId: 't1' });
  a.feed({ type: 'partial', turnId: null, transcript: 'สวัส' });
  a.feed({ type: 'speech-start', turnId: 't2' });
  a.feed({ type: 'partial', turnId: null, transcript: 'ว่าไง' });
  a.feed({ type: 'speech-complete', turnId: 't1', transcript: 'สวัสดีครับ' });
  a.feed({ type: 'final', turnId: 't2', transcript: 'ว่าไงครับ' });
  assert.deepEqual(a.texts(), ['สวัสดีครับ', 'ว่าไงครับ']);
  assert.equal(a.byId('t1').partials.length, 1);
  a.reset();
  assert.deepEqual(a.texts(), []);
});

test('transcribeFile posts the probe-compatible multipart shape', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ transcript: 'hello' }) };
  };
  const wav = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]);
  const r = await transcribeFile({ fetch, apiKey: 'k', wavBytes: wav.buffer });
  assert.equal(r.transcript, 'hello');
  assert.equal(calls[0].url, VOICE_FILE);
  const form = calls[0].init.body;
  assert.deepEqual(JSON.parse(await form.get('request').text()), {
    model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK', languageBias: ['Thai'],
  });
  assert.equal(form.get('audio').size, 12);
});

test('transcribeFile surfaces Meta error codes (billing, timeouts)', async () => {
  const denied = async () => ({ ok: false, status: 402, json: async () => ({ error: { code: 'billing_not_configured' } }) });
  await assert.rejects(transcribeFile({ fetch: denied, apiKey: 'k', wavBytes: new ArrayBuffer(16) }), /billing_not_configured/);
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => {
    const e = new Error('x');
    e.name = 'AbortError';
    rej(e);
  }));
  await assert.rejects(transcribeFile({ fetch: slow, apiKey: 'k', wavBytes: new ArrayBuffer(16), timeoutMs: 20 }), /voice-timeout/);
});

test('looksLikeWav checks the RIFF/WAVE magic', () => {
  const good = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 87, 65, 86, 69, 5]);
  assert.equal(looksLikeWav(good.buffer), true);
  assert.equal(looksLikeWav(new Uint8Array([1, 2, 3]).buffer), false);
  assert.equal(looksLikeWav(new ArrayBuffer(0)), false);
});

const wavBody = () => new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69, 0, 0]).buffer;

test('POST /api/voice/file validates before spending a cent', async () => {
  const noKey = await app.request('/api/voice/file', { method: 'POST', body: wavBody() }, {});
  assert.equal(noKey.status, 500);
  const empty = await app.request('/api/voice/file', { method: 'POST', body: new ArrayBuffer(0) }, { META_MODEL_API_KEY: 'k' });
  assert.equal(empty.status, 400);
  const bad = await app.request('/api/voice/file', { method: 'POST', body: new Uint8Array([1, 2, 3, 4]).buffer }, { META_MODEL_API_KEY: 'k' });
  assert.equal(bad.status, 400);
  const big = await app.request('/api/voice/file', { method: 'POST', body: new ArrayBuffer(2 * 1024 * 1024 + 1) }, { META_MODEL_API_KEY: 'k' });
  assert.equal(big.status, 413);
});

test('public/voice-shared.js is a byte-identical vendor of src/voice.js', () => {
  const src = readFileSync(join(HERE, '../src/voice.js'), 'utf8');
  const pub = readFileSync(join(HERE, '../public/voice-shared.js'), 'utf8');
  assert.equal(pub, src, 're-copy: Copy-Item app/src/voice.js app/public/voice-shared.js');
});

function fakeSocket() {
  const handlers = {};
  return {
    sent: [],
    readyState: WS_OPEN,
    closed: false,
    send(d) { this.sent.push(d); },
    close() { this.closed = true; this.readyState = 3; },
    addEventListener(ev, fn) { ((handlers[ev] ||= []).push(fn)); },
    emit(ev, arg) { for (const fn of handlers[ev] || []) fn(arg); },
  };
}

function makeRelay(opts = {}) {
  const metas = [];
  const toClient = [];
  const finals = [];
  const relay = createRelay({
    apiKey: 'k',
    openMeta: (url) => {
      const s = fakeSocket();
      s.url = url;
      metas.push(s);
      return s;
    },
    sendToClient: (text) => toClient.push(JSON.parse(text)),
    onFinal: (t) => finals.push(t),
    ...opts,
  });
  return { relay, metas, toClient, finals };
}

test('relay: handshake first, ready gates forwarding, drops counted', () => {
  const { relay, metas, toClient } = makeRelay();
  relay.clientConnected();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].url, VOICE_WS);
  assert.equal(metas[0].sent.length, 0, 'nothing before Meta open');
  metas[0].emit('open');
  const hs = JSON.parse(metas[0].sent[0]);
  assert.equal(hs.authorization.accessToken, 'Bearer k');
  assert.equal(hs.mode, 'ENDPOINTING');
  relay.onClientMessage(new ArrayBuffer(8));
  assert.equal(relay.stats.dropped, 1, 'audio before ready is dropped, not buffered');
  metas[0].emit('message', { data: JSON.stringify({ sessionId: 's1' }) });
  assert.deepEqual(toClient.at(-1), { type: 'ready', sessionId: 's1' });
  assert.equal(relay.session().ready, true);
  relay.onClientMessage(new ArrayBuffer(8));
  assert.equal(relay.stats.forwarded, 1);
  assert.equal(metas[0].sent.length, 2);
});

test('relay: Meta events normalize, band by turnId, finals fire once', () => {
  const { relay, metas, toClient, finals } = makeRelay();
  relay.clientConnected();
  metas[0].emit('open');
  metas[0].emit('message', { data: JSON.stringify({ sessionId: 's' }) });
  const feed = [
    { event: 'speechStart', turnId: 't1' },
    { event: 'transcript', transcript: 'สวัส', final: false, audioProcessedMs: 400 },
    { event: 'transcript', transcript: 'สวัสดีครับ', final: true },
    { event: 'speechComplete', turnId: 't1', transcript: 'สวัสดีครับ' },
    { event: 'something-new' },
  ];
  for (const m of feed) metas[0].emit('message', { data: JSON.stringify(m) });
  const types = toClient.map((m) => m.type);
  assert.deepEqual(types, ['ready', 'speech-start', 'partial', 'final', 'speech-complete']);
  assert.deepEqual(relay.turns(), ['สวัสดีครับ']);
  assert.equal(finals.length, 2, 'final + speech-complete both persist; complete wins text');
  assert.equal(finals.at(-1).text, 'สวัสดีครับ');
  relay.onClientMessage(JSON.stringify({ type: 'get-turns' }));
  assert.deepEqual(toClient.at(-1), { type: 'turns', texts: ['สวัสดีครับ'] });
  relay.onClientMessage('not-json{{{');
  assert.equal(toClient.at(-1).type, 'turns', 'garbage control ignored');
});

test('relay: Meta drop mid-call errors once, next audio resumes', () => {
  const { relay, metas, toClient } = makeRelay();
  relay.clientConnected();
  metas[0].emit('open');
  metas[0].emit('message', { data: JSON.stringify({ sessionId: 's' }) });
  metas[0].emit('close');
  assert.match(toClient.at(-1).message, /reconnecting on next audio/);
  assert.equal(relay.session().ready, false);
  relay.onClientMessage(new ArrayBuffer(8));
  assert.equal(metas.length, 2, 'transparent re-open');
  assert.equal(relay.stats.resumed, 1);
  metas[1].emit('open');
  assert.equal(JSON.parse(metas[1].sent[0]).mode, 'ENDPOINTING', 'resume re-sends handshake');
  relay.onClientGone();
  assert.equal(metas[1].closed, true);
});

test('relay: constructor validates its contract', () => {
  assert.throws(() => createRelay({ sendToClient() {} }), /relay-needs-openMeta/);
  assert.throws(() => createRelay({ openMeta() {} }), /relay-needs-sendToClient/);
  assert.throws(() => createRelay({ openMeta() {}, sendToClient() {} }), /missing-voice-key/);
  assert.throws(() => createRelay({ openMeta() {}, sendToClient() {}, apiKey: 'k', mode: 'NOPE' }), /bad-voice-mode/);
});

function stubState() {
  const sockets = [];
  const store = new Map();
  return {
    sockets,
    store,
    acceptWebSocket(ws) { sockets.push(ws); },
    getWebSockets() { return sockets.filter((s) => !s.closed); },
    waitUntil(p) { p.catch(() => {}); },
    storage: {
      async put(k, v) { store.set(k, v); },
      async list({ prefix }) { return new Map([...store].filter(([k]) => k.startsWith(prefix))); },
      async delete(keys) { for (const k of keys) store.delete(k); },
    },
  };
}

async function withDoGlobals(fn) {
  const realPair = globalThis.WebSocketPair;
  const realWs = globalThis.WebSocket;
  const RealResponse = globalThis.Response;
  const metas = [];
  // Node's Response rejects status 101; Workers requires it for WS accept.
  globalThis.Response = class extends RealResponse {
    constructor(body, init = {}) {
      if (init.status === 101) {
        super(null, { status: 200 });
        this._ws101 = init.webSocket;
        return;
      }
      super(body, init);
    }
    get status() {
      return this._ws101 ? 101 : super.status;
    }
  };
  globalThis.WebSocketPair = class {
    constructor() {
      this[0] = fakeSocket();
      this[1] = fakeSocket();
    }
  };
  globalThis.WebSocket = class {
    constructor(url) {
      const s = fakeSocket();
      s.url = url;
      metas.push(s);
      return s;
    }
  };
  try {
    return await fn(metas);
  } finally {
    if (realPair === undefined) delete globalThis.WebSocketPair;
    else globalThis.WebSocketPair = realPair;
    globalThis.WebSocket = realWs;
    globalThis.Response = RealResponse;
  }
}

test('VoiceCall: rejects bad calls and missing keys before touching Meta', async () => {
  await withDoGlobals(async (metas) => {
    const state = stubState();
    const call = new VoiceCall(state, { META_MODEL_API_KEY: 'k' });
    const bad = await call.fetch(new Request('https://x/api/voice/live?call=no!!way', { headers: { Upgrade: 'websocket' } }));
    assert.equal(bad.status, 400);
    const noKey = new VoiceCall(stubState(), {});
    const denied = await noKey.fetch(new Request('https://x/api/voice/live', { headers: { Upgrade: 'websocket' } }));
    assert.equal(denied.status, 500);
    assert.equal(metas.length, 0, 'no outbound socket without a valid call + key');
  });
});

test('VoiceCall: WS accept -> Meta handshake -> broadcast -> persist -> cleanup', async () => {
  await withDoGlobals(async (metas) => {
    const state = stubState();
    state.store.set('turn:old', { turnId: 'old', text: 'stale', at: '2020-01-01' });
    const call = new VoiceCall(state, { META_MODEL_API_KEY: 'k' });
    const res = await call.fetch(new Request('https://x/api/voice/live?call=abc', { headers: { Upgrade: 'websocket' } }));
    assert.equal(res.status, 101);
    assert.equal(state.sockets.length, 1, 'hibernatable accept');
    assert.equal(state.store.size, 0, 'stale turns wiped on fresh call');
    assert.equal(metas.length, 1);
    metas[0].emit('open');
    assert.equal(JSON.parse(metas[0].sent[0]).authorization.accessToken, 'Bearer k');
    metas[0].emit('message', { data: JSON.stringify({ sessionId: 's9' }) });
    const serverSide = state.sockets[0];
    assert.deepEqual(JSON.parse(serverSide.sent.at(-1)), { type: 'ready', sessionId: 's9' });
    await call.webSocketMessage(serverSide, new ArrayBuffer(16));
    assert.equal(metas[0].sent.length, 2, 'PCM relayed to Meta');
    metas[0].emit('message', { data: JSON.stringify({ event: 'speechStart', turnId: 't1' }) });
    metas[0].emit('message', { data: JSON.stringify({ event: 'speechComplete', turnId: 't1', transcript: 'ฮัลโหล' }) });
    assert.equal(state.store.get('turn:t1').text, 'ฮัลโหล');
    serverSide.closed = true;
    await call.webSocketClose();
    assert.equal(metas[0].closed, true, 'last client out closes Meta');
    const debug = await call.fetch(new Request('https://x/api/voice/live?call=abc'));
    assert.deepEqual((await debug.json()).turns.map((t) => t.text), ['ฮัลโหล']);
  });
});

test('VoiceCall: message without key errors to the socket, never throws', async () => {
  await withDoGlobals(async () => {
    const call = new VoiceCall(stubState(), {});
    const ws = fakeSocket();
    await call.webSocketMessage(ws, new ArrayBuffer(4));
    assert.deepEqual(JSON.parse(ws.sent[0]), { type: 'error', message: 'missing-key' });
  });
});

test('POST /api/voice/live routes by call id, validates first', async () => {
  const noBinding = await app.request('/api/voice/live?call=a', {}, {});
  assert.equal(noBinding.status, 500);
  const stub = { calls: [], idFromName(n) { this.calls.push(n); return n; }, get() { return { fetch: async () => new Response('do-ok') }; } };
  const bad = await app.request('/api/voice/live?call=no!!', {}, { VOICE_CALL: stub });
  assert.equal(bad.status, 400);
  const ok = await app.request('/api/voice/live?call=abc', {}, { VOICE_CALL: stub });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'do-ok');
  assert.deepEqual(stub.calls, ['call-abc']);
});

test('POST /api/voice/file proxies transcripts and honest errors', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ transcript: 'สวัสดีครับ' }) });
    const ok = await app.request('/api/voice/file', { method: 'POST', body: wavBody() }, { META_MODEL_API_KEY: 'k' });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).transcript, 'สวัสดีครับ');
    globalThis.fetch = async () => ({ ok: false, status: 402, json: async () => ({ error: { code: 'billing_not_configured' } }) });
    const denied = await app.request('/api/voice/file', { method: 'POST', body: wavBody() }, { META_MODEL_API_KEY: 'k' });
    assert.equal(denied.status, 502);
    assert.match((await denied.json()).error, /billing_not_configured/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
