// VoiceCall Durable Object: the server-side half of browser -> DO -> Meta.
// The Meta key lives here (wrangler secret) — the browser only ever talks to
// us. One DO instance per call (worker routes by ?call= id), so storage keys
// need no call prefix. Hibernation API throughout: acceptWebSocket + the
// webSocket* handlers, so idle connections cost no duration (spike 41 §2).
// `env.VOICE_META_WS` overrides the Meta URL — a test seam, unset in prod.
//
// Metering (B7): the worker's protect('voice-live') already reserved a full
// 10-minute estimate and took a live slot; it hands us that reservation in
// the internal `x-krai-live` header. We record it per socket (storage, so it
// survives hibernation), close the socket at the wall-clock limit via an
// alarm, and on close settle the budget with the seconds actually streamed
// and free the slot. Settlement is idempotent (the record is deleted once).
import { VOICE_WS, createRelay } from './voice.js';
import { cleanKey, isPaused } from './abuse.js';
import { BUDGET_NAME, countsTotal, doCall, ledgerCaps, rateName, toMicros, voiceUsd } from './budget.js';

const CALL_RE = /^[A-Za-z0-9-]{1,64}$/;
const LIVE_PREFIX = 'live:';
export const MAX_DURATION_CLOSE = 4008;
export const PAUSED_CLOSE = 4009;
const ORPHAN_GRACE_MS = 60_000;

function parseLiveMeta(raw) {
  try {
    const m = JSON.parse(raw || '');
    if (typeof m?.liveId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(m.liveId)) return null;
    if (typeof m.ipHash !== 'string' || typeof m.day !== 'string') return null;
    return {
      liveId: m.liveId, ipHash: m.ipHash, day: m.day,
      estMicros: Number(m.estMicros) || 0, maxSeconds: Number(m.maxSeconds) || 600,
    };
  } catch {
    return null;
  }
}

export class VoiceCall {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.relay = null;
    this.callId = null;
  }

  ensureRelay() {
    if (this.relay) return this.relay;
    const apiKey = cleanKey(this.env.META_MODEL_API_KEY);
    if (!apiKey) return null;
    this.relay = createRelay({
      apiKey,
      metaUrl: this.env.VOICE_META_WS || VOICE_WS,
      openMeta: (url) => new WebSocket(url),
      sendToClient: (text) => {
        for (const ws of this.state.getWebSockets()) {
          try { ws.send(text); } catch { /* dead socket; close handler prunes */ }
        }
      },
      onFinal: (turn) => {
        const p = this.state.storage.put(`turn:${turn.turnId ?? 'untracked'}`, {
          ...turn,
          at: new Date().toISOString(),
        });
        if (this.state.waitUntil) this.state.waitUntil(p.catch(() => {}));
      },
    });
    return this.relay;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const callId = url.searchParams.get('call') || 'demo';
    if (!CALL_RE.test(callId)) return new Response('bad-call', { status: 400 });
    this.callId = callId;

    // WebSocket upgrades only (case-insensitive). Call transcripts are
    // private: there is no HTTP read path; the client replays turns over the
    // socket with { type:'get-turns' }.
    if (String(request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('websocket-required', { status: 426 });
    }
    if (isPaused(this.env)) return new Response('paused', { status: 503 });
    if (!cleanKey(this.env.META_MODEL_API_KEY)) return new Response('missing-key', { status: 500 });
    const live = parseLiveMeta(request.headers.get('x-krai-live'));
    // With a budget binding (prod) every socket must carry a reservation.
    if (this.env.BUDGET && !live) return new Response('no-session', { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    // Fresh call (no relay yet): wipe turns left by a previous call that
    // reused this DO name, then open the Meta session while the user
    // grants mic permission.
    if (!this.relay) {
      const stale = await this.state.storage.list({ prefix: 'turn:' });
      if (stale.size) await this.state.storage.delete([...stale.keys()]);
      const relay = this.ensureRelay();
      if (relay) relay.clientConnected();
    }
    // Record the reservation LAST, right before 101. If recording fails, drop
    // the partial record: the worker sees a non-101 and refunds + frees the
    // slot itself, so the DO must not settle it a second time later.
    if (live) {
      try {
        await this.startLive(server, live);
      } catch (e) {
        await this.state.storage.delete(LIVE_PREFIX + live.liveId).catch(() => {});
        try { server.close(1011, 'live-start-failed'); } catch { /* gone */ }
        console.log(JSON.stringify({ event: 'live-start-failed', error: String(e?.message || e) }));
        return new Response('live-start-failed', { status: 500 });
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  // Kill switch reaches calls already in flight: close every metered socket,
  // settle what it streamed, and drop the Meta session.
  async closeAll(code, reason, now = Date.now()) {
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(JSON.stringify({ type: 'error', message: reason })); } catch { /* gone */ }
      try { ws.close(code, reason); } catch { /* gone */ }
      const liveId = this.liveIdOf(ws);
      if (liveId) await this.finishLive(liveId, now);
    }
    if (this.relay) {
      this.relay.onClientGone();
      this.relay = null;
    }
  }

  // Hibernation wakeups: `this.relay` may be gone after eviction — the relay
  // re-opens Meta transparently (relay.stats.resumed counts it) and the
  // client replays state via { type:'get-turns' }.
  async webSocketMessage(ws, message) {
    if (isPaused(this.env)) {
      await this.closeAll(PAUSED_CLOSE, 'paused');
      return;
    }
    const relay = this.ensureRelay();
    if (!relay) {
      try { ws.send(JSON.stringify({ type: 'error', message: 'missing-key' })); } catch { /* gone */ }
      return;
    }
    relay.onClientMessage(message);
  }

  async webSocketClose(ws) {
    const liveId = this.liveIdOf(ws);
    if (liveId) await this.finishLive(liveId, Date.now());
    this.dropRelayIfIdle();
  }

  async webSocketError(ws) {
    // Same cleanup as a close.
    return this.webSocketClose(ws);
  }

  dropRelayIfIdle() {
    if (this.state.getWebSockets().length === 0 && this.relay) {
      this.relay.onClientGone();
      this.relay = null;
    }
  }

  liveIdOf(ws) {
    try {
      return ws?.deserializeAttachment?.()?.liveId || null;
    } catch {
      return null;
    }
  }

  async startLive(ws, live) {
    const rec = { ...live, startedAt: Date.now() };
    await this.state.storage.put(LIVE_PREFIX + live.liveId, rec);
    try { ws.serializeAttachment?.({ liveId: live.liveId }); } catch { /* attachment optional */ }
    await this.scheduleAlarm(rec.startedAt + rec.maxSeconds * 1000);
  }

  async scheduleAlarm(at) {
    const s = this.state.storage;
    if (!s.setAlarm) return;
    const cur = s.getAlarm ? await s.getAlarm() : null;
    if (cur == null || at < cur) await s.setAlarm(at);
  }

  // Settle actual seconds (capped at the limit) and free the IP's live slot.
  async finishLive(liveId, now) {
    const key = LIVE_PREFIX + liveId;
    const rec = await this.state.storage.get(key);
    if (!rec) return null;
    await this.state.storage.delete(key);
    const seconds = Math.min(rec.maxSeconds, Math.max(0, (now - rec.startedAt) / 1000));
    const deltaMicros = toMicros(voiceUsd(seconds)) - rec.estMicros;
    if (this.env.BUDGET && deltaMicros) {
      await doCall(this.env.BUDGET, BUDGET_NAME, 'settle', { day: rec.day, deltaMicros, ledger: 'meta', since: ledgerCaps(this.env, 'meta').since, counted: countsTotal(ledgerCaps(this.env, 'meta'), rec.day) }).catch((e) =>
        console.log(JSON.stringify({ event: 'live-settle-failed', error: String(e.message) })));
    }
    if (this.env.RATE_LIMIT) {
      await doCall(this.env.RATE_LIMIT, rateName(rec.ipHash), 'liveRelease', { id: liveId }).catch(() => {});
    }
    return { seconds, deltaMicros };
  }

  // Wall-clock limit: close sockets past their max duration, settle orphans
  // whose close event never arrived, then re-arm for the next deadline.
  async alarm() {
    const now = Date.now();
    if (isPaused(this.env)) await this.closeAll(PAUSED_CLOSE, 'paused', now);
    const closedNow = new Set();
    for (const ws of this.state.getWebSockets()) {
      const liveId = this.liveIdOf(ws);
      if (!liveId) continue;
      const rec = await this.state.storage.get(LIVE_PREFIX + liveId);
      if (!rec || now < rec.startedAt + rec.maxSeconds * 1000) continue;
      try { ws.send(JSON.stringify({ type: 'error', message: 'max-duration' })); } catch { /* gone */ }
      try { ws.close(MAX_DURATION_CLOSE, 'max-duration'); } catch { /* gone */ }
      closedNow.add(ws);
      await this.finishLive(liveId, now);
    }
    const all = await this.state.storage.list({ prefix: LIVE_PREFIX });
    let next = null;
    for (const [key, rec] of all) {
      const deadline = rec.startedAt + rec.maxSeconds * 1000;
      if (now >= deadline + ORPHAN_GRACE_MS) await this.finishLive(key.slice(LIVE_PREFIX.length), now);
      else {
        const at = now >= deadline ? deadline + ORPHAN_GRACE_MS : deadline;
        next = next == null ? at : Math.min(next, at);
      }
    }
    if (next != null && this.state.storage.setAlarm) await this.state.storage.setAlarm(next);
    // getWebSockets() may still list sockets we just closed; stop paying for
    // the Meta session as soon as no metered caller is left on it.
    const remaining = this.state.getWebSockets().filter((ws) => !closedNow.has(ws));
    const metered = [];
    for (const ws of remaining) {
      const id = this.liveIdOf(ws);
      if (id && (await this.state.storage.get(LIVE_PREFIX + id))) metered.push(ws);
    }
    const unmeteredAllowed = !this.env.BUDGET && remaining.length > 0;
    if (this.relay && !metered.length && !unmeteredAllowed) {
      this.relay.onClientGone();
      this.relay = null;
    }
  }
}
